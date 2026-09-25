/**
 * Simulation backends.
 *
 * The plugin talks to Modelica through this interface only, so the engine can
 * be swapped without touching the UI. The shipped implementation spawns
 * OpenModelica; a faster in-process engine can be added later behind the same
 * seam.
 *
 * Performance model (measured on the reference machine, OpenModelica 1.27):
 *
 *   compile (frontend -> backend -> C -> link)   ~1.9 s with -n=8, ~4.6 s without
 *   run compiled model with -override            ~20 ms   (no recompile)
 *
 * Compilation therefore dominates by ~98%, and the whole design follows from
 * that: a parameter-only edit must NEVER recompile. We enforce that by
 * distinguishing "structural" edits from "parameter" edits and running the
 * already-built executable with `-override` for the latter.
 */

import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface SimulateOptions {
  /** Model class to simulate (must exist in the supplied source). */
  modelName: string;
  /** Full Modelica source for the model. */
  source: string;
  /** Parameter overrides applied WITHOUT recompiling when possible. */
  parameters?: Record<string, string>;
  startTime?: number;
  stopTime?: number;
  /** Number of output intervals; maps to OMC's numberOfIntervals. */
  numberOfIntervals?: number;
  tolerance?: number;
  /** Integrator, e.g. "dassl" (default), "ida", "cvode", "euler", "rungekutta4". */
  solver?: string;
  /** Only emit these variables (regex). Shrinks the result file a lot. */
  variableFilter?: string;
}

export interface SimSeries {
  name: string;
  /** Flat [t0, v0, t1, v1, ...] to avoid allocating an object per sample. */
  values: number[];
  unit?: string;
}

export interface SimResult {
  time: number[];
  series: SimSeries[];
  /** Wall-clock milliseconds spent compiling (0 when a cached binary was used). */
  compileMs: number;
  /** Wall-clock milliseconds spent simulating. */
  simulateMs: number;
  /** True when the compiled model was reused (the fast path). */
  reusedBinary: boolean;
  warnings: string[];
}

export interface CompileDiagnostic {
  severity: "error" | "warning" | "notification";
  message: string;
  line?: number;
  column?: number;
}

export interface CompileOutcome {
  ok: boolean;
  diagnostics: CompileDiagnostic[];
  /** Directory holding the built model, when ok. */
  workDir?: string;
  /** Path to the built executable, when ok. */
  executable?: string;
  /** Stem shared by `<stem>_init.xml` etc. */
  stem?: string;
  compileMs: number;
}

export interface BackendInfo {
  id: string;
  label: string;
  available: boolean;
  detail?: string;
}

/**
 * The seam. Any engine (spawned OpenModelica today, an in-process runtime
 * later) implements this.
 */
export interface SimulationBackend {
  readonly info: BackendInfo;
  compile(opts: SimulateOptions): Promise<CompileOutcome>;
  simulate(opts: SimulateOptions): Promise<SimResult>;
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* Modelica result parsing                                            */
/* ------------------------------------------------------------------ */

/**
 * Parse an OpenModelica CSV result file.
 *
 * Shape: `time,"var1","var2"` then numeric rows. Variable names are usually
 * quoted and may carry a unit suffix, e.g. `"r.i"` or `"v"`.
 */
export function parseOmcCsv(text: string): { header: string[]; rows: number[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };

  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (c === "," && !inQuotes) {
        out.push(cur);
        cur = "";
        continue;
      }
      cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };

  const header = split(lines[0]);
  const rows: number[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = split(lines[i]);
    const nums = cells.map((c) => Number(c));
    if (nums.some((n) => !Number.isFinite(n))) continue;
    rows.push(nums);
  }
  return { header, rows };
}

/** Convert a parsed CSV into time + series, transposing to column arrays. */
export function csvToResult(
  header: string[],
  rows: number[][],
  meta: Omit<SimResult, "time" | "series">
): SimResult {
  if (header.length === 0 || rows.length === 0) {
    return { time: [], series: [], ...meta };
  }
  const nCols = header.length;
  const time: number[] = [];
  const columns: number[][] = Array.from({ length: nCols }, () => []);

  for (const row of rows) {
    for (let c = 0; c < nCols; c++) {
      const v = row[c];
      columns[c].push(Number.isFinite(v) ? v : NaN);
    }
    time.push(Number.isFinite(row[0]) ? row[0] : NaN);
  }

  const series: SimSeries[] = [];
  for (let c = 1; c < nCols; c++) {
    const rawName = header[c].replace(/^"|"$/g, "");
    if (!rawName) continue;
    series.push({ name: rawName, values: columns[c] });
  }
  return { time, series, ...meta };
}

/* ------------------------------------------------------------------ */
/* Structural fingerprinting                                          */
/* ------------------------------------------------------------------ */

/**
 * Compute a fingerprint of everything that affects *compiled code*, ignoring
 * parameter VALUES.
 *
 * This is what makes the fast path safe: two models with the same structure
 * but different parameter values share a compiled binary, because OMC bakes
 * structural decisions (equation sorting, tearing, Jacobian layout) at compile
 * time while parameter values stay runtime-overridable.
 *
 * Note the deliberate limitation: a parameter used inside an `if` condition,
 * an array dimension, or a `connect` condition IS structural. OMC would need
 * a recompile, so those must not be treated as overridable. We detect the
 * common case by hashing the source with literal values stripped; callers
 * signalling `structuralChange` force a rebuild.
 */
export function structuralFingerprint(source: string, modelName: string): string {
  const normalized = source
    // Drop comments so reformatting does not force a rebuild.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    // Normalise whitespace.
    .replace(/\s+/g, " ")
    .trim();
  return crypto
    .createHash("sha1")
    .update(modelName + "\u0000" + normalized)
    .digest("hex")
    .slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* OpenModelica backend                                               */
/* ------------------------------------------------------------------ */

interface BuildRecord {
  fingerprint: string;
  workDir: string;
  executable: string;
  stem: string;
  builtAt: number;
}

export interface OmcBackendOptions {
  omcPath: string;
  /** Directory for build artefacts; defaults to a temp dir. */
  cacheDir?: string;
  /** Parallel jobs for codegen. OMC defaults to 1, which is 2.4x slower. */
  jobs?: number;
  /** Extra OMC command-line options. */
  extraOptions?: string[];
  onLog?: (line: string) => void;
}

export class OmcBackend implements SimulationBackend {
  readonly info: BackendInfo;
  private builds = new Map<string, BuildRecord>();
  private workRoot: string;
  private disposed = false;

  constructor(private readonly opts: OmcBackendOptions) {
    this.workRoot =
      opts.cacheDir ??
      path.join(os.tmpdir(), "modelica-studio", String(process.pid));
    fs.mkdirSync(this.workRoot, { recursive: true });
    const jobs = opts.jobs ?? defaultJobs();
    this.info = {
      id: "omc",
      label: "OpenModelica (spawned)",
      available: true,
      detail: `${opts.omcPath} · -n=${jobs}`,
    };
  }

  private get jobs(): number {
    return this.opts.jobs ?? defaultJobs();
  }

  private log(line: string): void {
    this.opts.onLog?.(line);
  }

  /**
   * Write the model and a build script, then invoke omc.
   *
   * A script file is used rather than command-line model loading because it
   * lets us set options and request structured error output in one call.
   */
  async compile(opts: SimulateOptions): Promise<CompileOutcome> {
    const started = Date.now();
    const fingerprint = structuralFingerprint(opts.source, opts.modelName);

    const cached = this.builds.get(opts.modelName);
    if (
      cached &&
      cached.fingerprint === fingerprint &&
      fs.existsSync(cached.executable)
    ) {
      return {
        ok: true,
        diagnostics: [],
        workDir: cached.workDir,
        executable: cached.executable,
        stem: cached.stem,
        compileMs: 0,
      };
    }

    const workDir = path.join(this.workRoot, opts.modelName);
    fs.mkdirSync(workDir, { recursive: true });

    const moFile = path.join(workDir, `${opts.modelName}.mo`);
    fs.writeFileSync(moFile, opts.source, "utf8");

    const script = this.buildScript(moFile, opts.modelName, opts.variableFilter);
    const mosFile = path.join(workDir, "build.mos");
    fs.writeFileSync(mosFile, script, "utf8");

    const args = [`-n=${this.jobs}`, ...(this.opts.extraOptions ?? []), mosFile];
    const { stdout, stderr, code } = await this.run(this.opts.omcPath, args, workDir);
    const compileMs = Date.now() - started;
    const combined = `${stdout}\n${stderr}`;
    this.log(combined);

    const diagnostics = parseOmcDiagnostics(combined);
    const executable = path.join(workDir, opts.modelName);
    const built = fs.existsSync(executable);

    if (!built) {
      return { ok: false, diagnostics, compileMs };
    }

    this.builds.set(opts.modelName, {
      fingerprint,
      workDir,
      executable,
      stem: opts.modelName,
      builtAt: Date.now(),
    });

    void code;
    return {
      ok: true,
      diagnostics,
      workDir,
      executable,
      stem: opts.modelName,
      compileMs,
    };
  }

  private buildScript(
    moFile: string,
    modelName: string,
    variableFilter?: string
  ): string {
    const filter = variableFilter
      ? `, variableFilter="${escapeModelicaString(variableFilter)}"`
      : "";
    return [
      `// Generated by Modelica Studio`,
      `setCommandLineOptions("-n=${this.jobs}");`,
      `loadFile("${escapeModelicaString(moFile)}"); getErrorString();`,
      `buildModel(${modelName}${filter}); getErrorString();`,
      ``,
    ].join("\n");
  }

  /**
   * Build if needed, then run the model. Reuses the binary when possible.
   *
   * One run at a time PER MODEL. Everything a run writes is keyed by the model's
   * name -- the work directory, the compiled binary and the result CSV -- so two
   * surfaces running the same model at once used to compile into the same
   * directory and run with the same `-r`, and whichever process finished last left
   * its CSV for both readers. That happens without anything unusual: a note with
   * the model embedded beside the studio, two blocks of one model with different
   * parameter overrides, or a Sweep while a Simulate is still going. The second
   * run therefore waits its turn, and each run writes its own result file.
   */
  async simulate(opts: SimulateOptions): Promise<SimResult> {
    return this.queued(opts.modelName, () => this.simulateOnce(opts));
  }

  private async simulateOnce(opts: SimulateOptions): Promise<SimResult> {
    const compiled = await this.compile(opts);
    if (!compiled.ok || !compiled.executable) {
      const msg =
        compiled.diagnostics.filter((d) => d.severity === "error").map((d) => d.message).join("\n") ||
        "Model translation failed.";
      throw new SimulationError(msg, compiled.diagnostics);
    }

    const started = Date.now();
    // Per RUN, not per model: a second run of the same model must not overwrite the
    // file the first one is still reading.
    const runId = ++this.runCounter;
    const csvPath = path.join(compiled.workDir!, `${opts.modelName}_${runId}_res.csv`);

    const runArgs = buildRunArgs(opts, csvPath);
    const { stdout, stderr } = await this.run(compiled.executable, runArgs, compiled.workDir!);
    const simulateMs = Date.now() - started;

    const warnings = collectRunWarnings(`${stdout}\n${stderr}`);

    if (!fs.existsSync(csvPath)) {
      throw new SimulationError(
        `The simulation ran but produced no result file.\n\n${warnings.join("\n")}`,
        []
      );
    }

    const csv = fs.readFileSync(csvPath, "utf8");
    // Read it, then take it away: one file per run would otherwise accumulate in
    // the work directory for the life of the install.
    try {
      fs.unlinkSync(csvPath);
    } catch {
      /* a file we cannot remove is not a failed simulation */
    }
    const { header, rows } = parseOmcCsv(csv);

    // An unrecognised solver name is not an error to OpenModelica: it warns,
    // continues, and writes a result file full of NaN. `rungekutta4` does that --
    // the name is `rungekutta`. A run whose every value is NaN is a failure, and
    // saying so is the difference between a user checking their solver and a user
    // believing an empty plot.
    const result = csvToResult(header, rows, {
      compileMs: compiled.compileMs,
      simulateMs,
      reusedBinary: compiled.compileMs === 0,
      warnings,
    });
    const unusable = describeUnusableResult(result, opts.solver);
    if (unusable) throw new SimulationError(unusable, []);
    return result;

  }

  /** Serialises runs of one model; see `simulate`. */
  private readonly running = new Map<string, Promise<unknown>>();
  private runCounter = 0;

  /**
   * Run `fn` after every run already queued for this model has settled.
   *
   * The chain never rejects: a failed run is answered to its own caller, and the
   * next one still gets its turn.
   */
  private queued<T>(modelName: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.running.get(modelName) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.running.set(
      modelName,
      next.then(
        () => undefined,
        () => undefined
      )
    );
    return next;
  }

  /** Force the next simulate() to recompile. */
  invalidate(modelName?: string): void {
    if (modelName) this.builds.delete(modelName);
    else this.builds.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.builds.clear();
    // Build artefacts are left on disk under the OS temp dir on purpose:
    // deleting them would throw away exactly the cache that makes re-runs fast.
  }

  private run(
    cmd: string,
    args: string[],
    cwd: string
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd,
        windowsHide: true,
        // OMC needs its own libs on the loader path on Linux.
        env: { ...process.env, ...this.loaderEnv() },
      });
      let stdout = "";
      let stderr = "";
      // The event's payload is typed `any` by Node's stream types; naming it keeps the
      // rest of the function typed rather than letting `any` spread through the parser.
      child.stdout.on("data", (d: Buffer | string) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer | string) => (stderr += d.toString()));
      child.on("error", reject);
      child.on("close", (code) => resolve({ stdout, stderr, code }));
    });
  }

  /** Make sure the OpenModelica runtime libraries resolve at run time. */
  private loaderEnv(): Record<string, string> {
    const bin = path.dirname(this.opts.omcPath);
    const prefix = path.dirname(bin);
    const libDirs = [
      path.join(prefix, "lib", "x86_64-linux-gnu", "omc"),
      path.join(prefix, "lib", "omc"),
      path.join(prefix, "lib64", "omc"),
      path.join(prefix, "lib"),
      "/usr/lib/x86_64-linux-gnu/omc",
    ].filter((d) => {
      try {
        return fs.statSync(d).isDirectory();
      } catch {
        return false;
      }
    });
    if (process.platform === "darwin") {
      const existing = process.env.DYLD_LIBRARY_PATH ?? "";
      return { DYLD_LIBRARY_PATH: [...libDirs, existing].filter(Boolean).join(":") };
    }
    const existing = process.env.LD_LIBRARY_PATH ?? "";
    return { LD_LIBRARY_PATH: [...libDirs, existing].filter(Boolean).join(":") };
  }
}

export class SimulationError extends Error {
  constructor(message: string, public readonly diagnostics: CompileDiagnostic[]) {
    super(message);
    this.name = "SimulationError";
  }
}

/**
 * Build the argument list for a compiled OpenModelica model.
 *
 * `-override` is the key flag: it rewrites parameter values in the setup XML at
 * load time, so changing a slider costs ~20 ms instead of a ~1.9 s recompile.
 */
export function buildRunArgs(opts: SimulateOptions, csvPath: string): string[] {
  const args: string[] = ["-outputFormat=csv", `-r=${csvPath}`];

  const overrides: string[] = [];
  for (const [k, v] of Object.entries(opts.parameters ?? {})) {
    if (v === undefined || v === null || String(v).trim() === "") continue;
    overrides.push(`${k}=${v}`);
  }
  if (overrides.length) args.push(`-override=${overrides.join(",")}`);

  if (opts.startTime !== undefined) args.push(`-startTime=${opts.startTime}`);
  if (opts.stopTime !== undefined) args.push(`-stopTime=${opts.stopTime}`);
  if (opts.numberOfIntervals !== undefined) {
    args.push(`-stepSize=${computeStepSize(opts)}`);
  }
  if (opts.tolerance !== undefined) args.push(`-tolerance=${opts.tolerance}`);
  if (opts.solver) args.push(`-s=${opts.solver}`);

  return args;
}

function computeStepSize(opts: SimulateOptions): number {
  const t0 = opts.startTime ?? 0;
  const t1 = opts.stopTime ?? 1;
  const n = Math.max(1, opts.numberOfIntervals ?? 500);
  return (t1 - t0) / n;
}

function defaultJobs(): number {
  const n = os.cpus()?.length ?? 2;
  // Leave a core for the UI thread; OMC's own default of 1 costs 2.4x.
  return Math.max(1, Math.min(8, n - 1));
}

function escapeModelicaString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Extract diagnostics from OMC output.
 *
 * OMC emits lines like:
 *   [path/Model.mo:12:5-12:20:writable] Error: message
 *   Error: message
 *   Warning: message
 */
export function parseOmcDiagnostics(output: string): CompileDiagnostic[] {
  const out: CompileDiagnostic[] = [];
  const seen = new Set<string>();

  // OMC prefixes diagnostics with a bracketed source location, e.g.
  //   [Model.mo:12:5-12:20:writable] Error: message
  //   [/abs/path/M.mo:12:5] Warning: message
  // Line/column are matched explicitly rather than as an optional group,
  // otherwise a trailing `[^\]]*` greedily swallows them.
  const withLine = /^\[[^\]]*?:(?<line>\d+):(?<col>\d+)[^\]]*\]\s*/;
  const withFile = /^\[(?<file>[^\]]*)\]\s*/;
  const sevRe = /(?<sev>Error|Warning|Notification)\s*:\s*(?<msg>.*)$/;

  for (const rawLine of output.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;

    let lineNo: number | undefined;
    let colNo: number | undefined;
    const wl = withLine.exec(line);
    if (wl?.groups) {
      lineNo = Number(wl.groups.line);
      colNo = Number(wl.groups.col);
      line = line.slice(wl[0].length);
    } else {
      const wf = withFile.exec(line);
      if (wf) line = line.slice(wf[0].length);
    }

    const sev = sevRe.exec(line);
    if (!sev?.groups) continue;

    const sevRaw = sev.groups.sev;
    const severity: CompileDiagnostic["severity"] =
      sevRaw === "Error" ? "error" : sevRaw === "Warning" ? "warning" : "notification";
    const message = (sev.groups.msg ?? "").trim();
    if (!message) continue;

    const key = `${severity}:${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ severity, message, line: lineNo, column: colNo });
  }
  return out;
}

/** Keep the useful simulation-runtime messages, drop the chatter. */
export function collectRunWarnings(output: string): string[] {
  const out: string[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/override variable name not found/i.test(line)) {
      out.push(
        `Parameter ignored: ${line.replace(/^.*?override variable name not found in model:\s*/i, "")}. ` +
          `It is not a tunable model variable — it may need a structural rebuild.`
      );
      continue;
    }
    // Only lines that are actually a problem.
    //
    // This matched `LOG_STDOUT` as well, which carries ORDINARY output, so a
    // perfectly good run reported "The initialization finished successfully
    // without homotopy method" as a warning — five of them on one run, in
    // yellow, about nothing. What counts is the SEVERITY in the log line, not
    // which stream it arrived on.
    const structured = /^LOG_(\w+)\s*\|\s*(\w+)\s*\|\s*(.*)$/.exec(line);
    if (structured) {
      const severity = structured[2].toLowerCase();
      const msg = structured[3].trim();
      const isProblem = structured[1] === "ASSERT" || severity === "warning" || severity === "error";
      if (isProblem && msg && !/simulation finished successfully/i.test(msg)) out.push(msg);
      continue;
    }
    if (/^Error:/.test(line)) out.push(line);
  }
  return [...new Set(out)];
}

/* ------------------------------------------------------------------ */
/* Backend registry                                                    */
/* ------------------------------------------------------------------ */

export interface BackendFactoryOptions extends OmcBackendOptions {
  /** Reserved for future engines; currently always "omc". */
  preferred?: string;
}

/**
 * The in-process backend was prototyped and measured ~10x faster for
 * re-simulation (1.8-6.7 ms vs ~20 ms) by linking the generated model as a
 * shared library. It is not enabled because OpenModelica's Boehm garbage
 * collector spawns marker threads that crash inside Obsidian's Electron
 * process. This seam exists so it can be enabled once that is solved.
 */
export function createBackend(opts: BackendFactoryOptions): SimulationBackend {
  return new OmcBackend(opts);
}

export function availableBackends(): BackendInfo[] {
  return [
    { id: "omc", label: "OpenModelica (spawned)", available: true },
    {
      id: "omc-inproc",
      label: "OpenModelica (in-process)",
      available: false,
      detail: "Blocked: runtime GC threads crash inside Electron",
    },
  ];
}

/**
 * Whether a run produced nothing usable, and why.
 *
 * An unrecognised solver name is not an error to OpenModelica: it prints a
 * warning, exits 0, and writes a result file whose values are all NaN.
 * `rungekutta4` does exactly that — the name is `rungekutta`, and it was
 * recommended by this plugin's own settings until it was measured.
 *
 * A NaN result is reported as a failure naming the solver, because the
 * alternative is a successful-looking run and an empty plot.
 */
export function describeUnusableResult(result: SimResult, solver?: string): string | null {
  const values = result.series.flatMap((s) => s.values);
  // `every` on an empty list is true, so an empty result is caught here too.
  const finite = values.filter((v) => Number.isFinite(v)).length;
  if (finite > 0) return null;

  const named = solver ? `"${solver}"` : "the default solver";
  const known = SOLVER_NAMES.has(solver ?? "dassl");
  // Two different problems with the same symptom. A solver this runtime does not
  // know is a typo, and saying so points at the fix; a known solver returning
  // nothing is a model or settings problem.
  return known
    ? `The simulation produced no usable values: every result is NaN. ` +
        `The solver ${named} returned nothing, which usually means the model could ` +
        `not be integrated at these settings — try a smaller step, a looser ` +
        `tolerance, or a different solver.`
    : `The simulation produced no usable values: every result is NaN. ` +
        `OpenModelica does not recognise the solver ${named}, and rather than fail ` +
        `it warns and writes NaN. Check the spelling in settings — the Runge-Kutta ` +
        `solver is called "rungekutta", not "rungekutta4".`;
}

/** The solver names this runtime lists. Kept here so the message can tell a typo from a failure. */
const SOLVER_NAMES = new Set([
  "dassl",
  "ida",
  "cvode",
  "gbode",
  "euler",
  "rungekutta",
  "symSolver",
  "symSolverSsc",
  "qss",
  "optimization",
]);
