/**
 * A variable name as runs of type: `s_rel` is an `s` with a subscript, `der(v)` is
 * a `v` with a dot over it.
 *
 * This exists because the legend is where a curve is READ. `damper.s_rel` and
 * `damper.v_rel` differ in their last three characters, and a legend of six of
 * those at 11px is a wall of near-identical strings; typesetting says the same
 * thing in less width and in the notation the model's own documentation uses.
 *
 * It is deliberately NOT applied to the trace list. That list is an identifier
 * surface — you match a row against the model source, against a compiler warning,
 * against the text you are typing into the filter — and a typeset name is a
 * different string from the one you would type or grep for. The legend is a label
 * for a curve; the list is a control.
 *
 * The rules are the Modelica conventions, and nothing is guessed:
 *
 *  - `_x` and `[i]` are subscripts. Consecutive `_` parts become ONE subscript
 *    joined by commas (`x_a_b` is x with `a,b`), which is how the specification
 *    writes a nested subscript.
 *  - `der(x)` is a dot over x; `der(der(x))` is two. The dot goes over the
 *    VARIABLE, never over its subscript: `ṡ_rel`.
 *  - `.` separates components and keeps its own run.
 *
 * Anything this is not sure about comes back as ONE plain run, so it is drawn
 * exactly as the compiler wrote it: `previous(x)` (whose notation is a superscript
 * minus, and not worth guessing at), anything quoted, and any name whose parts do
 * not add up. A nearly-right name is worse than a plain one, for the same reason a
 * nearly-right unit is.
 */

/**
 * One piece of a name or a unit, with the type it is drawn in.
 *
 * `sup` comes from units (`m·s-2` as m·s with a raised `-2`); a name has no superscript,
 * and a unit has no derivative dot.
 */
export interface Run {
  text: string;
  kind: "base" | "sub" | "sep" | "sup";
  /** Derivative dots to draw over this run. */
  dot?: number;
}

/** `previous(x)` has a notation of its own, and this does not guess at it. */
const UNSUPPORTED = /[']|previous\(/;

/**
 * The runs a name is drawn as, or a single plain run when it is not a shape this
 * understands.
 */
export function typesetName(name: string): Run[] {
  if (UNSUPPORTED.test(name)) return [{ text: name, kind: "base" }];

  // Peel the derivatives first: the dots belong to what is inside.
  let dots = 0;
  let inner = name;
  for (;;) {
    const wrapped = /^der\((.*)\)$/.exec(inner);
    if (!wrapped) break;
    dots++;
    inner = wrapped[1];
  }

  const runs: Run[] = [];
  const parts = inner.split(".");
  parts.forEach((part, index) => {
    if (index > 0) runs.push({ text: ".", kind: "sep" });
    // `a_b_c` and `x[1,2]` — one subscript run per name, pieces joined by commas.
    const pieces = part.split(/(_[A-Za-z0-9]+|\[[^\]]*\])/).filter((piece) => piece !== "");
    const subscript: string[] = [];
    for (const piece of pieces) {
      if (piece.startsWith("_")) subscript.push(piece.slice(1));
      else if (piece.startsWith("[")) subscript.push(piece.slice(1, -1));
      else {
        if (subscript.length > 0) {
          runs.push({ text: subscript.join(","), kind: "sub" });
          subscript.length = 0;
        }
        runs.push({ text: piece, kind: "base" });
      }
    }
    if (subscript.length > 0) runs.push({ text: subscript.join(","), kind: "sub" });
  });

  if (dots > 0) {
    // Over the last thing that is a variable, not over its subscript.
    for (let i = runs.length - 1; i >= 0; i--) {
      if (runs[i].kind === "base") {
        runs[i] = { ...runs[i], dot: dots };
        break;
      }
    }
  }
  // A `_` or a bracket left in a name run means the parts did not add up — `a__b`,
  // a half-closed index — and a half-typeset name is worse than a plain one.
  if (runs.some((run) => run.kind === "base" && /[_[\]]/.test(run.text))) {
    return [{ text: name, kind: "base" }];
  }
  return runs.length > 0 ? runs : [{ text: name, kind: "base" }];
}
