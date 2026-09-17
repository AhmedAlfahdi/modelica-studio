/**
 * Local checks on a model's equations.
 *
 * The parser is structural: it reads declarations, connections and the equation
 * text, and it does not know what the equations MEAN. So a model could name a
 * variable that does not exist and nothing noticed until OpenModelica was asked
 * to compile it — which is how an AI-written model using an undeclared `m` and
 * `g` reached the compiler and came back with "Variable m not found in scope".
 *
 * These are cheap, conservative checks that run as the text is edited. They are
 * NOT a compiler and do not try to be: the aim is to name a mistake in the
 * editor, in the place it was made, instead of relaying a compiler message
 * afterwards. Anything uncertain is left alone, because a warning that fires on
 * correct code is worse than no warning.
 */

import { LibraryIndex } from "./library";

export interface ModelProblem {
  /** 1-based line within the source, when it can be determined. */
  line: number;
  message: string;
  severity: "error" | "warning";
}

/**
 * Names that are always in scope in a Modelica model.
 *
 * `time` is the independent variable, and the rest are the operators and
 * builtin functions the language provides.
 */
const IMPLICIT = new Set([
  "time", "true", "false", "der", "pre", "edge", "change", "initial", "reinit",
  "terminal", "sample", "smooth", "noEvent", "homotopy", "semiLinear",
  "inStream", "actualStream", "delay", "cardinality", "noClock", "previous",
  "hold", "backSample", "shiftSample", "subSample", "superSample",
  "abs", "sign", "sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
  "sinh", "cosh", "tanh", "exp", "log", "log10", "min", "max", "sum", "product",
  "mod", "rem", "div", "ceil", "floor", "integer", "String", "ndims", "size",
  "scalar", "vector", "matrix", "transpose", "outerProduct", "symmetric",
  "cross", "skew", "identity", "diagonal", "zeros", "ones", "fill", "linspace",
  "cat", "promote", "if", "then", "else", "elseif", "end", "for", "while",
  "loop", "in", "when", "and", "or", "not", "true", "false", "return", "break",
  "assert", "connect", "parameter", "constant", "discrete", "flow", "stream",
  "input", "output", "Real", "Integer", "Boolean", "String", "Clock", "Time",
]);

const KEYWORDS = new Set([
  "if", "then", "else", "elseif", "end", "for", "while", "loop", "in", "when",
  "and", "or", "not", "return", "break", "assert", "connect", "parameter",
  "constant", "discrete", "flow", "stream", "input", "output",
]);

/**
 * Split an identifier-bearing chunk into dotted references.
 *
 * `a.b.c` is one reference, and only its ROOT (`a`) has to be declared: `b` and
 * `c` belong to whatever `a` is.
 */
function roots(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g)) {
    const full = m[0];
    // A qualified path starting with a capital is a class reference, not a
    // component, and is checked separately.
    if (/^[A-Z]/.test(full)) continue;
    out.push(full.split(".")[0]);
  }
  return out;
}

/**
 * Whether a qualified name is a class the library knows.
 *
 * Used so `Modelica.Fluid.Vessels.OpenTank` in an equation is not reported as an
 * unknown variable. Without an index nothing is reported, because assuming the
 * worst would produce false alarms on every qualified reference.
 */
function knownClass(library: LibraryIndex | undefined, name: string): boolean | undefined {
  if (!library || library.size === 0) return undefined;
  return Boolean(library.component(name));
}

/** One declaration's raw text, for attribute checks. */
export interface DeclarationText {
  name: string;
  /** The declaration as written, one line or several. */
  text: string;
  /** 1-based line of the declaration. */
  line: number;
}

export interface CheckInput {
  /** Declared names: variables, components, parameters, `import` aliases. */
  declared: Set<string>;
  /** Declarations with their text, when available, for attribute checks. */
  declarations?: DeclarationText[];
  /** The equation section, verbatim. */
  equations: string[];
  /** True when any component comes from the library, which brings its own equations. */
  hasComponents: boolean;
  library?: LibraryIndex;
  /** Line number of the first equation, for reporting. */
  firstEquationLine: number;
  /**
   * The components the model declares, with their placement.
   *
   * A model built from library components is a DIAGRAM, and a diagram has two
   * failure modes that compile perfectly well and look broken: a part with no
   * position, which lands at the origin on top of everything else, and a part
   * with no `connect`, which is a block floating unwired. Both are worth naming
   * in the editor, where the picture is.
   */
  components?: Array<{
    id: string;
    /** Position as declared, or undefined when there is no Placement. */
    extent?: [number, number, number, number];
    /** Pin names that appear in a `connect`. */
    connectedPins: string[];
    /** True for a component placed from the library rather than declared inline. */
    fromLibrary: boolean;
  }>;
}

/**
 * Check a model and return what looks wrong.
 *
 * Two things are looked for, both of which OpenModelica would catch later and
 * less helpfully:
 *
 *   1. a name used in an equation that is not declared anywhere;
 *   2. a model with nothing to integrate — no derivative, no library component,
 *      and no `time` — which compiles to a static system and cannot be simulated.
 */
export function checkModel(input: CheckInput): ModelProblem[] {
  const problems: ModelProblem[] = [];
  const text = input.equations.join("\n");

  /* ---- 1. undeclared names ---- */
  //
  // Only report a name that appears on its own and is neither declared, nor
  // implicit, nor the tail of a component reference, nor a known library class.
  // A name that COULD be a field of a component (`tank.level`) never appears as
  // a root, so the root test is what keeps this quiet on correct code.
  const unknown = new Map<string, number>();
  let lineCursor = input.firstEquationLine;
  for (const equation of input.equations) {
    // Strip comments and strings, which are not code.
    const code = equation
      .replace(/\/\/[^\n]*/g, "")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""');
    for (const name of roots(code)) {
      if (IMPLICIT.has(name) || KEYWORDS.has(name)) continue;
      if (input.declared.has(name)) continue;
      // A capitalised root is a class reference: check it against the library.
      if (/^[A-Z]/.test(name)) continue;
      if (!unknown.has(name)) unknown.set(name, lineCursor);
    }
    lineCursor += equation.split("\n").length;
  }

  for (const [name, line] of unknown) {
    problems.push({
      line,
      severity: "error",
      message: `"${name}" is used in an equation but never declared. Add a declaration, or an import if it comes from a library.`,
    });
  }

  /* ---- 2. nothing to integrate ---- */
  if (!input.hasComponents && input.equations.length) {
    const usesTime = /\btime\b/.test(text);
    const hasDerivative = /\bder\s*\(/.test(text);
    // A discrete model advances through `when`, which is legitimate.
    const hasEvent = /\bwhen\b/.test(text);
    if (!usesTime && !hasDerivative && !hasEvent) {
      problems.push({
        line: input.firstEquationLine,
        severity: "warning",
        message:
          "Nothing here changes with time: no der(), no time, no when, and no library components. " +
          "OpenModelica will refuse this as having no time-dependent variables.",
      });
    }
  }

  /* ---- 2b. a diagram that would not look like one ---- */
  const parts = (input.components ?? []).filter((c) => c.fromLibrary);
  if (parts.length >= 2) {
    // Two components at the same place are drawn as one, and cannot be wired by
    // hand. Reported once for the pair rather than per component, or a model
    // where everything sits at the origin produces a wall of identical messages.
    const byPosition = new Map<string, string[]>();
    for (const c of parts) {
      const at = c.extent ? c.extent.join(",") : "origin";
      byPosition.set(at, [...(byPosition.get(at) ?? []), c.id]);
    }
    for (const [at, ids] of byPosition) {
      if (ids.length < 2) continue;
      const where = at === "origin" ? "no Placement, so they all land at the origin" : `the same position ${at}`;
      problems.push({
        line: input.firstEquationLine,
        severity: "warning",
        message:
          `${ids.length} components have ${where}: ${ids.join(", ")}. ` +
          `They are drawn on top of each other and cannot be wired by hand. ` +
          `Space them out with their own transformation extents.`,
      });
    }

    // A part with no connect at all is unwired. Ground and Fixed are terminal by
    // nature — they exist to be the end of a wire — so they are exempt only when
    // the model has no connects at all, which means it is not a diagram yet.
    const anyConnection = parts.some((c) => c.connectedPins.length > 0);
    if (anyConnection) {
      const loose = parts.filter((c) => c.connectedPins.length === 0).map((c) => c.id);
      if (loose.length) {
        problems.push({
          line: input.firstEquationLine,
          severity: "warning",
          message:
            `${loose.length} component${loose.length === 1 ? "" : "s"} appear in no connect: ${loose.join(", ")}. ` +
            `Every part of a diagram has to be wired to something, or attach it to a Ground or Fixed.`,
        });
      }
    }
  }

  /* ---- 3. attributes on the wrong kind of declaration ---- */
  //
  // `parameter Real x(start = 1, fixed = true)` is a common mistake, and
  // OpenModelica's answer names neither the declaration nor the attribute:
  //
  //     Modified element m not found in class Real.
  //
  // `fixed` is an attribute of a VARIABLE, describing whether its start value
  // holds. On a parameter it means nothing, because a parameter is already fixed
  // for the whole run.
  for (const eq of input.equations) void eq;
  if (input.declarations) {
    for (const d of input.declarations) {
      if (!/\bparameter\b|\bconstant\b/.test(d.text)) continue;
      if (!/\bfixed\s*=/.test(d.text)) continue;
      problems.push({
        line: d.line,
        severity: "error",
        message:
          `"${d.name}" is a parameter, so "fixed" does nothing on it and OpenModelica reports it as ` +
          `a missing element of its type. Remove fixed=true; keep start if you meant an initial value.`,
      });
    }
  }

  /* ---- 4. a qualified class that does not exist ---- */
  if (input.library && input.library.size > 0) {
    for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\b/g)) {
      const name = m[1];
      // Skip anything that is a component's field rather than a class.
      if (input.declared.has(name.split(".")[0])) continue;
      if (knownClass(input.library, name) === false) {
        problems.push({
          line: input.firstEquationLine,
          severity: "warning",
          message: `"${name}" is not a class in the indexed libraries.`,
        });
      }
    }
  }

  return problems;
}
