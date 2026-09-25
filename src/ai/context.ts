/**
 * What the AI needs to know about this installation.
 *
 * Without it the model is writing Modelica for a machine it cannot see: it does
 * not know which OpenModelica version will compile the result, which solver and
 * tolerances the run will use, which libraries are indexed, or which of the
 * 4,800 placeable classes are actually available here. It therefore invents
 * class names that do not exist, picks parameters that this MSL version does not
 * have, and writes `experiment` annotations that fight the plugin's own
 * settings.
 *
 * Everything here is derived from the live installation rather than written
 * down, so a different OpenModelica version or a different library set produces
 * a different brief.
 */

import type { LibraryIndex } from "../modelica/library";

export interface AiEnvironment {
  /** `omc` path, or undefined when not found. */
  omcPath?: string;
  /** e.g. "1.27.0". */
  omcVersion?: string;
  /** Library roots that were indexed. */
  libraryRoots?: string[];
  /** Number of classes in the index. */
  classCount?: number;
  /** Names of the libraries actually indexed, e.g. "Modelica 4.1.0". */
  libraryNames?: string[];

  /** The run settings a simulation will actually use. */
  startTime: number;
  stopTime: number;
  numberOfIntervals: number;
  tolerance: number;
  /** Empty means OpenModelica's own choice. */
  solver: string;
  /** Parallel codegen jobs. */
  jobs: number;

  /** Libraries the user has excluded from search. */
  excluded: string[];
  /** Diagnostics from the last simulated model, if it failed. */
  lastError?: string;
  /** True when the model came from a built-in example. */
  fromExample?: string;
}

/**
 * Render the environment as plain text for a prompt.
 *
 * Deliberately terse and factual. A model reads this as constraints, so every
 * line is something it could otherwise get wrong, and nothing is padding.
 */
export function describeEnvironment(env: AiEnvironment): string {
  const lines: string[] = ["## This installation"];

  lines.push(
    // The VERSION, not the path: the path adds nothing a model needs to write Modelica,
    // and it describes the machine's layout to a remote service. This is the only place
    // anything about the installation is sent, and it goes only when AI assistance is on.
    env.omcVersion
      ? `- OpenModelica ${env.omcVersion}`
      : "- OpenModelica: not detected, so nothing can be simulated until it is installed"
  );
  // Basenames, whatever the caller passes: a library root is a path, and a path is the
  // user's home directory spelled out in a request to a remote service. The plugin already
  // shortens these, and this makes the guarantee the function's own rather than the
  // caller's.
  const libraryNames = (env.libraryNames ?? []).map(
    (n) => n.split(/[\\/]/).filter(Boolean).pop() ?? n
  );
  lines.push(
    libraryNames.length
      ? `- Libraries indexed: ${libraryNames.join(", ")}`
      : "- Libraries: none indexed"
  );
  if (env.classCount) {
    lines.push(`- Placeable classes available: ${env.classCount}`);
  }

  lines.push(
    `- The plugin runs the simulation, so do NOT add an \`experiment\` annotation or ` +
      `\`annotation(experiment(...))\`: the run settings below are applied by the plugin ` +
      `and an annotation would conflict with them.`
  );
  lines.push(
    `- Run settings used: startTime=${env.startTime}, stopTime=${env.stopTime}, ` +
      `numberOfIntervals=${env.numberOfIntervals}, tolerance=${env.tolerance}` +
      (env.solver ? `, solver=${env.solver}` : ", solver=OpenModelica's default")
  );
  if (env.jobs > 1) lines.push(`- Code is generated with ${env.jobs} parallel jobs.`);

  if (env.excluded?.length) {
    lines.push(
      `- These libraries are excluded by the user and must NOT be used: ${env.excluded.join(", ")}`
    );
  }
  if (env.fromExample) {
    lines.push(`- This model started life as the built-in example "${env.fromExample}".`);
  }
  if (env.lastError) {
    lines.push(`- The last simulation failed. Its output is below.`);
  }
  return lines.join("\n");
}

/**
 * A shortlist of classes relevant to a request, grouped by package.
 *
 * Chosen by asking the index for names matching the words in the request, which
 * is the difference between a model composing real MSL classes and one inventing
 * `Modelica.Fluid.Pump`. Grouped so the model can see that, for example, the
 * only `Orifice` classes live under `Modelica.Fluid.Fittings`.
 */
export function describeAvailableClasses(
  library: LibraryIndex | undefined,
  request: string,
  limit = 28
): string {
  if (!library || library.size === 0) {
    return "## Available classes\n- The library index is still being built, so no class list is available. Use only well-known Modelica Standard Library names.";
  }

  const words = request
    .split(/[^A-Za-z]+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 3);

  const seen = new Set<string>();
  /** A class worth putting in a model, as opposed to one that is a model. */
  const usable = (name: string) =>
    !/\.Examples?\.|\.Utilities\.|\.Internal\.|\.Interfaces?\./.test(name);

  // The library the request is about comes first, and it is looked up from a
  // domain word rather than by substring: "hydraulic" and Modelica.Fluid share no
  // text at all, so a name search alone offered signal-sampler blocks for a
  // hydraulic circuit. Searching inside the right package first is what puts
  // Pump, Valve and Cylinder in front of the model that needs them.
  const packages = packagesForRequest(words);
  for (const pkg of packages) {
    for (const word of meaningfulWords(words)) {
      for (const def of library.listPlaceable(`${pkg}.${word}`, 8)) {
        if (seen.size >= limit) break;
        if (!def.name.startsWith(pkg) || !usable(def.name) || library.isExcluded(def.name)) continue;
        seen.add(def.name);
      }
    }
    if (seen.size >= 12) break;
  }

  // Then a plain name search, for the components that are not under a domain
  // package: a resistor, an integrator, a mass.
  for (const word of meaningfulWords(words)) {
    for (const def of library.listPlaceable(word, 10)) {
      if (seen.size >= limit) break;
      if (!usable(def.name) || library.isExcluded(def.name)) continue;
      seen.add(def.name);
    }
  }

  // Nothing matched: a general sample is still more useful than nothing, because
  // it shows the shape of the namespaces.
  if (seen.size < 8) {
    for (const def of library.listPlaceable("", limit)) {
      if (seen.size >= limit) break;
      if (library.isExcluded(def.name)) continue;
      if (!usable(def.name)) continue;
      seen.add(def.name);
    }
  }

  const byPackage = new Map<string, string[]>();
  for (const name of seen) {
    const parts = name.split(".");
    const pkg = parts.slice(0, -1).join(".");
    const list = byPackage.get(pkg) ?? [];
    list.push(parts[parts.length - 1]);
    byPackage.set(pkg, list);
  }

  const out = ["## Available classes (these exist on this machine; use them rather than inventing names)"];
  for (const [pkg, names] of byPackage) {
    out.push(`- ${pkg}: ${names.join(", ")}`);
  }
  const detail = describeParameters(library, seen, 16, 12);
  if (detail) out.push("", detail);
  return out.join("\n");
}

/**
 * Library packages the request is about, most specific first.
 *
 * A map rather than a substring search because the domain word and the package
 * name share no text: someone asking for a hydraulic circuit is asking about
 * Modelica.Fluid, and no amount of matching "hydraulic" against class names finds
 * it. The words here are the ones a person actually writes.
 */
const DOMAIN_PACKAGES: Array<[RegExp, string[]]> = [
  [/hydraul|pneumat|fluid|liquid|pipe|valve|pump|tank|reservoir|orifice/, ["Modelica.Fluid"]],
  [/circuit|electric|voltage|current|resistor|capacitor|inductor|motor|generator|battery|diode|transistor/, ["Modelica.Electrical.Analog", "Modelica.Electrical.Machines"]],
  [/thermal|heat|temperature|cooling|radiat|furnace/, ["Modelica.Thermal.HeatTransfer", "Modelica.Thermal.FluidHeatFlow"]],
  [/mechani|mass|spring|damper|pendulum|gear|shaft|torque|inertia|linkage|robot/, ["Modelica.Mechanics.Rotational", "Modelica.Mechanics.Translational", "Modelica.Mechanics.MultiBody"]],
  [/control|controller|pid|feedback|setpoint|regulat/, ["Modelica.Blocks.Continuous", "Modelica.Blocks.Math", "Modelica.Blocks.Sources"]],
  [/magnetic|magnet|flux|coil/, ["Modelica.Magnetic"]],
];

/** The packages a request points at, in the order they should be searched. */
export function packagesForRequest(words: string[]): string[] {
  const text = words.join(" ");
  const out: string[] = [];
  for (const [pattern, packages] of DOMAIN_PACKAGES) {
    if (pattern.test(text)) out.push(...packages);
  }
  return [...new Set(out)];
}

/**
 * The words worth searching for.
 *
 * English glue matches almost any class name by substring — "with" finds
 * HoldWithDAeffects — and the result is a brief full of irrelevant blocks. Only
 * words long enough to be a term, and not one of the words every request
 * contains, are used.
 */
const STOP_WORDS = new Set([
  "the", "and", "with", "for", "that", "this", "from", "into", "using", "use",
  "model", "modelica", "simulate", "simulation", "please", "want", "need",
  "make", "create", "build", "which", "when", "then", "than", "over", "under",
  "some", "each", "have", "give", "show", "like", "would", "should",
]);

export function meaningfulWords(words: string[] | string): string[] {
  const list = typeof words === "string" ? words.split(/[^A-Za-z]+/) : words;
  return list.map((w) => w.toLowerCase()).filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
}

/**
 * The parameters of the matching classes, so a component can be configured
 * without guessing.
 *
 * A list of class names is not enough to USE a class. A model asked for a
 * hydraulic circuit set `V_flow_nominal` on a Pump, which does not have that
 * parameter, and the compiler's answer was the first the model heard about it.
 * Knowing which names exist turns a compile-and-repair round into a correct
 * answer, and the repaired model is the expensive path.
 *
 * Bounded on purpose: names and defaults only, for a handful of classes. The
 * whole MSL would be hundreds of thousands of tokens, and most of it is
 * irrelevant to any one request.
 */
export function describeParameters(
  library: LibraryIndex | undefined,
  names: Set<string>,
  maxClasses = 10,
  maxEach = 14
): string {
  if (!library || names.size === 0) return "";
  const rows: string[] = [];

  for (const name of names) {
    if (rows.length >= maxClasses) break;
    // An index without `describe` has no parameter data, which is a thinner
    // brief rather than a failure.
    const def = typeof library.describe === "function" ? library.describe(name) : undefined;
    // Only the classes with something to configure: a port or a constant is not
    // worth a line.
    const params = (def?.parameters ?? []).filter((p) => !p.name.includes("."));
    if (params.length === 0) continue;

    const shown = params.slice(0, maxEach).map((p) => {
      const bits = [p.type, p.name].filter(Boolean).join(" ");
      const init = p.defaultValue !== undefined ? ` = ${p.defaultValue}` : "";
      return `${bits}${init}`;
    });
    const more = params.length > shown.length ? `, …${params.length - shown.length} more` : "";
    rows.push(`- ${name}(${shown.join("; ")}${more})`);
  }

  if (rows.length === 0) return "";
  return [
    "### Parameters of the classes above",
    "Set a parameter ONLY by a name listed here. A name that is not listed does",
    "not exist on that class, and setting it fails to compile — leave it out and",
    "let the default apply.",
    ...rows,
  ].join("\n");
}

/**
 * Render run log entries for a prompt.
 *
 * The full compiler output, not a summary: the first line of an OpenModelica
 * error is usually `Internal error` or a file path, and the line that says what
 * is actually wrong comes several lines later.
 */
export function describeLog(
  entries: Array<{ at: string; model: string; ok: boolean; detail: string }>,
  limit = 3
): string {
  const failed = entries.filter((e) => !e.ok).slice(-limit);
  if (!failed.length) return "";

  const out = ["## Recent failed runs"];
  for (const e of failed) {
    out.push(`### ${e.model} at ${e.at}`);
    out.push("```");
    out.push(e.detail.trim() || "(no output was captured)");
    out.push("```");
  }
  return out.join("\n");
}
