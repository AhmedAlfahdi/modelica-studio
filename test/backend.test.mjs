/**
 * Simulation backend tests — run against the REAL OpenModelica installation.
 *
 * These verify the performance-critical claim the whole design rests on:
 * a parameter change must reuse the compiled binary instead of recompiling.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { buildLibs, simCacheDir } from "./helpers/build.mjs";
import path from "node:path";

const OMC_LIB = buildLibs("omc-lib", ["src/omc/backend.ts", "src/omc/locate.ts"]);
const backendMod = await import(path.join(OMC_LIB, "backend.js"));
const locateMod = await import(path.join(OMC_LIB, "locate.js"));
const { OmcBackend, parseOmcCsv, csvToResult, buildRunArgs, parseOmcDiagnostics, structuralFingerprint } = backendMod;

const OMC = locateMod.locateOmcSync();
const HAS_OMC = OMC.status === "found" && !!OMC.omcPath;

/* ------------------------------------------------------------------ */
/* Pure functions (no OMC needed)                                      */
/* ------------------------------------------------------------------ */

test("parseOmcVersion extracts the version", () => {
  assert.deepEqual(locateMod.parseOmcVersion("OpenModelica 1.27.0"), {
    version: "OpenModelica 1.27.0",
    number: "1.27.0",
  });
  assert.equal(
    locateMod.parseOmcVersion("noise\nOpenModelica 1.16.2 (something)").number,
    "1.16.2"
  );
  assert.equal(locateMod.parseOmcVersion("nothing here").version, undefined);
});

test("compareVersions orders dotted versions", () => {
  assert.ok(locateMod.compareVersions("1.16.0", "1.27.0") < 0);
  assert.ok(locateMod.compareVersions("1.27.0", "1.16.0") > 0);
  assert.equal(locateMod.compareVersions("1.27.0", "1.27.0"), 0);
  assert.ok(locateMod.compareVersions("1.9.0", "1.10.0") < 0, "numeric not lexicographic");
});

test("structuralFingerprint ignores comments and whitespace", () => {
  const a = "model M\n  Real x;\nend M;";
  const b = "model M\n\n  // a comment\n  Real  x; // trailing\nend M;";
  assert.equal(structuralFingerprint(a, "M"), structuralFingerprint(b, "M"));
  const c = "model M\n  Real y;\nend M;";
  assert.notEqual(structuralFingerprint(a, "M"), structuralFingerprint(c, "M"));
});

test("parseOmcCsv handles quoted headers", () => {
  const { header, rows } = parseOmcCsv('time,"r.i","v"\n0,1,5\n1,2,6\n');
  assert.deepEqual(header, ["time", "r.i", "v"]);
  assert.deepEqual(rows, [
    [0, 1, 5],
    [1, 2, 6],
  ]);
});

test("csvToResult transposes into columns", () => {
  const r = csvToResult(["time", "a", "b"], [[0, 1, 2], [1, 3, 4]], {
    compileMs: 0,
    simulateMs: 0,
    reusedBinary: true,
    warnings: [],
  });
  assert.deepEqual(r.time, [0, 1]);
  assert.equal(r.series.length, 2);
  assert.deepEqual(r.series[0].values, [1, 3]);
  assert.deepEqual(r.series[1].values, [2, 4]);
});

test("buildRunArgs emits -override for parameters and no recompile flags", () => {
  const args = buildRunArgs(
    {
      modelName: "M",
      source: "",
      parameters: { "r.R": "42", "c.C": "1e-3" },
      stopTime: 2,
      startTime: 0,
      numberOfIntervals: 100,
    },
    "/tmp/out.csv"
  );
  assert.ok(args.includes("-outputFormat=csv"));
  assert.ok(args.includes("-r=/tmp/out.csv"));
  assert.ok(args.includes("-override=r.R=42,c.C=1e-3"), `got ${args.join(" ")}`);
  assert.ok(args.includes("-stopTime=2"));
  assert.ok(args.includes("-stepSize=0.02"));
  // Must NOT ask for a rebuild.
  assert.ok(!args.some((a) => a.includes("buildModel")));
});

test("parseOmcDiagnostics extracts errors with source locations", () => {
  const out = [
    "[/tmp/M.mo:12:5-12:20:writable] Error: Undeclared variable x",
    "Warning: something minor",
    "Error: Undeclared variable x",
    "Notification: Automatically loaded package Modelica",
    "unrelated chatter",
  ].join("\n");
  const d = parseOmcDiagnostics(out);
  const errs = d.filter((x) => x.severity === "error");
  assert.equal(errs.length, 1, "duplicate error lines collapse");
  assert.equal(errs[0].message, "Undeclared variable x");
  assert.equal(errs[0].line, 12);
  assert.equal(errs[0].column, 5);
  assert.ok(d.some((x) => x.severity === "warning"));
});

/* ------------------------------------------------------------------ */
/* Live OMC tests                                                      */
/* ------------------------------------------------------------------ */

const MODEL = `model RCCircuit
  Modelica.Electrical.Analog.Basic.Resistor r(R=100);
  Modelica.Electrical.Analog.Basic.Capacitor c(C=1e-3);
  Modelica.Electrical.Analog.Basic.Ground g;
  Modelica.Electrical.Analog.Sources.ConstantVoltage v(V=5);
equation
  connect(v.p, r.p);
  connect(r.n, c.p);
  connect(c.n, g.p);
  connect(v.n, g.p);
end RCCircuit;`;

test("locates a working omc installation", { skip: !HAS_OMC }, async () => {
  const info = await locateMod.detectOmc();
  assert.equal(info.status, "found", info.message);
  assert.ok(info.versionNumber, "version parsed");
  assert.ok(
    locateMod.compareVersions(info.versionNumber, locateMod.MIN_OMC_VERSION) >= 0,
    `omc ${info.versionNumber} meets minimum`
  );
});

test("compiles and simulates a real MSL circuit", { skip: !HAS_OMC }, async () => {
  const backend = new OmcBackend({ omcPath: OMC.omcPath, cacheDir: simCacheDir("sim-test") });
  const res = await backend.simulate({
    modelName: "RCCircuit",
    source: MODEL,
    parameters: { "r.R": "100" },
    stopTime: 1,
    numberOfIntervals: 100,
  });

  assert.ok(res.time.length > 10, `got ${res.time.length} samples`);
  assert.ok(res.series.length > 0, "produced series");
  assert.equal(res.compileMs > 0, true, "first run compiles");

  // Capacitor charges toward 5 V with tau = R*C = 0.1 s.
  const vc = res.series.find((s) => s.name.includes("c.v"));
  if (vc) {
    const last = vc.values[vc.values.length - 1];
    assert.ok(last > 4.9 && last <= 5.0001, `capacitor reaches ~5V, got ${last}`);
  }
  backend.dispose();
});

test("parameter change REUSES the binary (the ~20ms fast path)", { skip: !HAS_OMC }, async () => {
  const backend = new OmcBackend({ omcPath: OMC.omcPath, cacheDir: simCacheDir("sim-test2") });

  const first = await backend.simulate({
    modelName: "RCCircuit",
    source: MODEL,
    parameters: { "r.R": "100" },
    stopTime: 1,
    numberOfIntervals: 100,
  });
  assert.equal(first.reusedBinary, false, "first run compiles");
  assert.ok(first.compileMs > 300, `compile should dominate, took ${first.compileMs}ms`);

  const second = await backend.simulate({
    modelName: "RCCircuit",
    source: MODEL,
    parameters: { "r.R": "250" },
    stopTime: 1,
    numberOfIntervals: 100,
  });
  assert.equal(second.reusedBinary, true, "second run MUST reuse the binary");
  assert.equal(second.compileMs, 0, "no compile time on the hot path");

  // Compare at t ~= 0.5s: tau = R*C, so larger R charges more slowly.
  const findVc = (r) => r.series.find((s) => s.name.includes("c.v"));
  const vc1 = findVc(first);
  const vc2 = findVc(second);
  if (vc1 && vc2) {
    const i = Math.min(
      vc1.values.length - 1,
      Math.round((0.5 / (first.time[first.time.length - 1] || 1)) * (vc1.values.length - 1))
    );
    assert.ok(
      vc2.values[i] < vc1.values[i],
      `larger R must charge slower: R=100 -> ${vc1.values[i]}, R=250 -> ${vc2.values[i]}`
    );
  }
  backend.dispose();
});

test("reports a compile error for invalid Modelica", { skip: !HAS_OMC }, async () => {
  const backend = new OmcBackend({ omcPath: OMC.omcPath, cacheDir: simCacheDir("sim-test3") });
  await assert.rejects(
    () =>
      backend.simulate({
        modelName: "Broken",
        source: "model Broken\n  Real x = undefinedSymbol;\nend Broken;",
        stopTime: 1,
      }),
    (err) => {
      assert.ok(/translation failed|Undeclared|not found/i.test(err.message), err.message);
      return true;
    }
  );
  backend.dispose();
});

test("detectSandbox reports a non-sandboxed environment correctly", () => {
  const s = locateMod.detectSandbox();
  assert.equal(typeof s.sandboxed, "boolean");
  // CI and a normal shell are not sandboxed; if they are, a hint must exist.
  if (s.sandboxed) {
    assert.ok(s.kind, "sandbox kind is named");
    assert.ok(s.hint && s.hint.length > 20, "sandbox hint is actionable");
  } else {
    assert.equal(s.kind, undefined);
  }
});

test("installHint is platform-appropriate and actionable", () => {
  const hint = locateMod.installHint();
  assert.ok(hint.length > 40, "hint is substantive");
  const expect =
    process.platform === "darwin" ? /macOS/ :
    process.platform === "win32" ? /Windows/ : /Linux/;
  assert.match(hint, expect, `hint should mention ${process.platform}`);
  // Must point somewhere the user can actually go.
  assert.match(hint, /openmodelica\.org|yay|dnf|apt|snap|brew/i);
});

test("every built-in example simulates to a result that actually varies", { skip: !HAS_OMC }, async () => {
  // Compiling is not enough. Two of these examples were once written so that
  // they compiled and ran but produced either no variables or a flat line — a
  // steady state reported as a successful simulation. A user pressing Simulate
  // on the first-run example would have seen an empty plot, which is exactly
  // the experience the examples exist to prevent.
  const { EXAMPLES } = await import(path.join(buildLibs("ex-lib", ["src/modelica/examples.ts"]), "examples.js"));
  const backend = new OmcBackend({ omcPath: OMC.omcPath, cacheDir: simCacheDir("example-test") });

  for (const ex of EXAMPLES) {
    const result = await backend.simulate({
      modelName: ex.name,
      source: ex.source,
      stopTime: ex.stopTime,
      numberOfIntervals: 100,
    });

    assert.ok(result.series.length > 0, `${ex.name}: produced no variables to plot`);

    const varying = result.series.filter((s) => {
      const values = (s.values ?? []).filter((v) => Number.isFinite(v));
      if (values.length < 2) return false;
      return Math.max(...values) - Math.min(...values) > 1e-9;
    });
    assert.ok(
      varying.length > 0,
      `${ex.name}: every one of its ${result.series.length} variables is constant — ` +
        `the result would plot as a flat line`
    );
  }
});

test("two runs of one model do not share a result file", async () => {
  // Everything a run writes is keyed by the model's name: the work directory, the
  // compiled binary and the result CSV (`-r=`). Two surfaces running the same model
  // at once -- a note block beside the studio, two blocks with different parameter
  // overrides, or a Sweep while a Simulate is still going -- compiled into the same
  // directory and ran with the same `-r`, and whichever finished last left its CSV
  // for both readers. So each run now waits its turn and writes its own file.
  const cacheDir = simCacheDir("mo-run-lock-");
  const backend = new OmcBackend({ omcPath: "/bin/true", cacheDir });

  const csvFor = (row) =>
    ["time,value", ...row.map(([t, v], i) => `${t},${v + i}`)].join("\n") + "\n";

  // A fake compiler and process: what matters here is the file each run is told to
  // write and the order the runs are allowed to start in.
  const seen = [];
  let concurrent = 0;
  let overlapped = false;
  let call = 0;
  backend.run = async (_cmd, args) => {
    concurrent++;
    if (concurrent > 1) overlapped = true;
    const csvPath = (/^-r=(.*)$/.exec(args.find((a) => a.startsWith("-r=")) ?? "") ?? [])[1];
    const index = call++;
    seen.push({ index, csvPath, startedAt: Date.now() });
    // The first run is slow: a second run starting before it finishes is the bug.
    await new Promise((r) => setTimeout(r, index === 0 ? 60 : 5));
    // `compile` is stubbed above, so every call here IS a run, and a run writes its
    // result file.
    fs.writeFileSync(csvPath, csvFor([[0, index], [1, index]]));
    concurrent--;
    return { stdout: "", stderr: "", code: 0 };
  };
  backend.compile = async (opts) => ({
    ok: true,
    diagnostics: [],
    workDir: path.join(cacheDir, opts.modelName),
    executable: "/bin/true",
    stem: opts.modelName,
    compileMs: 0,
  });
  fs.mkdirSync(path.join(cacheDir, "Tank"), { recursive: true });

  const opts = { modelName: "Tank", source: "model Tank\nend Tank;\n", parameters: {} };
  const [a, b] = await Promise.all([backend.simulate(opts), backend.simulate(opts)]);

  assert.ok(seen.length === 2, `both runs ran: ${JSON.stringify(seen)}`);
  assert.notEqual(seen[0].csvPath, seen[1].csvPath, "each run was given its own result file");
  assert.equal(overlapped, false, "and the second did not start while the first was running");
  assert.notEqual(
    JSON.stringify(a.series.map((s) => s.values)),
    JSON.stringify(b.series.map((s) => s.values)),
    "so neither read the other's result"
  );
});
