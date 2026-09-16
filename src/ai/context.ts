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
    env.omcVersion
      ? `- OpenModelica ${env.omcVersion}${env.omcPath ? ` at ${env.omcPath}` : ""}`
      : "- OpenModelica: not detected, so nothing can be simulated until it is installed"
  );
  lines.push(
    env.libraryNames?.length
      ? `- Libraries indexed: ${env.libraryNames.join(", ")}`
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

  if (env.excluded.length) {
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
  limit = 40
): string {
  if (!library || library.size === 0) {
    return "## Available classes\n- The library index is still being built, so no class list is available. Use only well-known Modelica Standard Library names.";
  }

  const words = request
    .split(/[^A-Za-z]+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 3);

  const seen = new Set<string>();
  for (const word of words) {
    for (const def of library.listPlaceable(word, 12)) {
      if (seen.size >= limit) break;
      if (library.isExcluded(def.name)) continue;
      seen.add(def.name);
    }
  }
  // Nothing matched: a general sample is still more useful than nothing, because
  // it shows the shape of the namespaces.
  if (seen.size < 8) {
    for (const def of library.listPlaceable("", limit)) {
      if (seen.size >= limit) break;
      if (library.isExcluded(def.name)) continue;
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
  return out.join("\n");
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
