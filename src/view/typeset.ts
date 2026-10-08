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
/**
 * How a derivative is written, because a dot is drawn by hand and lands where the font cannot
 * help it.
 *
 * The plugin has no glyph outlines, only `measureText`, so a dot over a run is placed by
 * arithmetic: the centre of the run's advance width, above its cap height. That is right for a
 * single narrow letter and wrong for anything else — `gamma` puts the dot over the middle of
 * five glyphs, `T` needs it above the cap where a small dot reads as a speck, and a run with a
 * subscript has no single centre at all. A reader reported exactly that, with a plot full of
 * them.
 *
 * So the notation is a choice, and the default is the one that cannot go wrong:
 *
 *  - `prime` — `V'`, `V''`. A spacing character beside the letter, not an anchor over it, so
 *    every font draws it and every measurement counts it. Newton's own notation.
 *  - `der` — `der(V)`. What the model and the trace list say, so the legend and the list agree
 *    and a name can be grepped for.
 *  - `leibniz` — `dV/dt`. Names the variable being differentiated against, which is what makes
 *    it unambiguous on a plot of things that are not all time derivatives.
 *  - `dot` — `V̇`. The convention the plugin used first, kept for anyone who wants the look and
 *    does not mind where the dot lands.
 */
export type DerivativeNotation = "dot" | "prime" | "der" | "leibniz";

let notation: DerivativeNotation = "prime";

/** Set the notation every name is drawn in. Called when the setting loads or changes. */
export function setDerivativeNotation(next: DerivativeNotation): void {
  notation = next;
}

export function derivativeNotation(): DerivativeNotation {
  return notation;
}

export function typesetName(name: string, mode: DerivativeNotation = notation): Run[] {
  if (UNSUPPORTED.test(name)) return [{ text: name, kind: "base" }];

  // Peel the derivatives first: what they modify is what is inside.
  let dots = 0;
  let inner = name;
  for (;;) {
    const wrapped = /^der\((.*)\)$/.exec(inner);
    if (!wrapped) break;
    dots++;
    inner = wrapped[1];
  }

  // `der(V)` is already what the source says: drawn as it stands, which is also the one
  // notation whose legend can be typed into the filter.
  if (dots > 0 && mode === "der") return [{ text: name, kind: "base" }];

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
    const last = (() => {
      for (let i = runs.length - 1; i >= 0; i--) if (runs[i].kind === "base") return i;
      return -1;
    })();
    if (last >= 0) {
      if (mode === "prime") {
        // A tick BESIDE the letter. ASCII, not U+2032: the legend is drawn on a canvas in the
        // reader's own font, and an apostrophe is in every one of them.
        runs[last] = { ...runs[last], text: runs[last].text + "'".repeat(dots) };
      } else if (mode === "leibniz") {
        // `dV/dt`, or `d²V/dt²` — the order rides on the `d`, where a superscript already goes.
        const base = runs[last].text;
        runs[last] = { ...runs[last], text: base };
        runs.splice(last, 0, { text: "d", kind: "sep" });
        runs.push({ text: "/dt", kind: "sep" });
        if (dots > 1) runs.splice(last + 1, 0, { text: String(dots), kind: "sup" });
      } else {
        // Over the last thing that is a variable, not over its subscript.
        runs[last] = { ...runs[last], dot: dots };
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
