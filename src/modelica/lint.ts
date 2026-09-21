/**
 * Telling the person who built the diagram what is wrong with it.
 *
 * A model assembled by dragging can be wrong in ways that compile and simulate
 * perfectly: two components that are not wired to each other, a parameter left
 * without a value. The result is a flat line or a plausible curve, which reads as
 * a fact about the physics rather than a mistake in the drawing — the hardest kind
 * of wrong to notice, because there is nothing to see.
 *
 * The connectivity half of this already existed. It was written to check what the
 * AI had produced, and it rejected five of the exchanges in this vault's own log
 * for exactly these reasons ("4 components are connected to nothing: height,
 * downward_velocity, …"). The same check applies to a model a person drew; it was
 * simply never asked.
 *
 * Pure, so the rules can be tested without a vault or a compiler.
 */

import { describeLooseDiagram } from "../ai/generate";

export interface LintFinding {
  /** `wiring` is a drawing mistake; `value` is a parameter still to be set. */
  kind: "wiring" | "value";
  message: string;
}

/**
 * Everything worth saying about a model before it is run.
 *
 * The connectivity check is static and instant, so it can be reported while the
 * user is still looking at the diagram. It is NOT extended with a guess at
 * "parameter has no value": the parser cannot tell a declaration with no default
 * (`parameter SI.Time T(start=1)`) from one whose default is an expression
 * (`parameter Real x = 2*k`) — both arrive as an undefined `defaultValue` — so a
 * check built on it would cry wolf on half the library. That question is put to
 * the compiler instead, which knows, and whose answer is the one that decides
 * whether the model runs at all.
 */
export function lintModel(
  source: string,
  opts: { isComponent?: (className: string) => boolean }
): LintFinding[] {
  const loose = describeLooseDiagram(source, opts.isComponent);
  return loose ? [{ kind: "wiring", message: loose }] : [];
}

/**
 * The report: what the drawing says, then what the compiler says.
 *
 * One place, because these are read together — a loose diagram explains a
 * compiler error about a variable with no equation, and saying only the second
 * sends the reader looking in the wrong place.
 */
export function formatLint(
  findings: LintFinding[],
  diagnostics: Array<{ severity: string; message: string; line?: number }> = [],
  checked: boolean = false
): string {
  const parts: string[] = [];
  if (findings.length > 0) {
    parts.push(findings.map((f) => `• ${f.message}`).join("\n\n"));
  }
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity !== "error");
  if (diagnostics.length > 0) {
    parts.push(
      [
        `${errors.length} error${errors.length === 1 ? "" : "s"} and ${warnings.length} warning${
          warnings.length === 1 ? "" : "s"
        } from the compiler:`,
        ...diagnostics.map((d) => `  ${d.line ? `line ${d.line}: ` : ""}${d.message}`),
      ].join("\n")
    );
  }
  if (parts.length === 0) {
    return checked
      ? "No problems found: every component is connected, and the model compiles."
      : "No problems found in the diagram. Press Check again after a change.";
  }
  return parts.join("\n\n" + "-".repeat(60) + "\n\n");
}

/** The findings as one line, for the run log. */
export function summariseLint(findings: LintFinding[]): string {
  return findings.map((f) => f.message).join(" ");
}
