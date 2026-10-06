/**
 * Units, as a reader writes them.
 *
 * The compiler states a unit the way the Modelica grammar spells it — `m.s-1`,
 * `kg/m3`, `J/(kg.K)`, `Ohm`, `degC` — which is exact, machine-readable, and not
 * what a person writes on paper. This is the one place that turns that spelling
 * into symbols: `Ohm` is Ω, `degC` is °C, a leading `u` is the micro prefix, the
 * `.` between two units is a multiplication dot, and an attached exponent is
 * raised — `m·s⁻¹`, `kg/m³`, `J/(kg·K)`.
 *
 * Superscripts as CHARACTERS rather than as markup, and that is what makes one
 * string work in all four places a unit appears: a DOM row, a tooltip (which
 * cannot hold markup at all), a form label, and the plot legend, which is drawn
 * on a canvas. A `<sup>` element would have meant three renderers for one fact —
 * and wrapping the characters in `<sup>` as well shrank the exponent twice, to a
 * speck that read as a clipped glyph.
 *
 * Still not MathJax, which is the wrong tool for a label: the trace list is
 * rebuilt on every keystroke in the filter, while MathJax is a global the app
 * loads on demand and has to be flushed after each use (see the contract in
 * `solve-block.ts`). A string transform costs nothing.
 *
 * All or nothing, per unit string: the text is checked against unit grammar
 * first, and anything that does not fit comes back exactly as it was. `kg^2` and
 * `some unit` are not made prettier, they are left alone — a nearly-right unit is
 * worse than an ugly one, because it reads as authoritative.
 */

import type { Run } from "./typeset";

/**
 * One unit token: a name with an optional exponent attached (`s-1`, `m2`), or a
 * bare number, which is how the compiler writes the dimensionless unit (`1`).
 */
const TOKEN = /^(?:\d+|[A-Za-z%_][A-Za-z0-9_]*-?\d*)$/;

/** The units the compiler spells out, longest spelling first: `degC` before `deg`. */
const SYMBOLS: Array<[RegExp, string]> = [
  [/Ohm/g, "Ω"],
  [/degC/g, "°C"],
  [/deg/g, "°"],
];

/**
 * `u` in front of a unit is the micro prefix: `uF` is µF, `us` is µs.
 *
 * At the start of a token rather than of the string, so a compound unit gets it
 * too, and only in front of a letter — `u` on its own is the atomic mass unit,
 * not a prefix with nothing to prefix.
 */
const MICRO = /(^|[./()])u(?=[A-Za-z])/g;

/**
 * An exponent attached to a unit name: `m2`, `s-1`, `m/s2`.
 *
 * The name has to start with a letter, and the digits have to END the token — so a
 * unit whose name merely contains a digit (`H2O`, if a library ever declares one)
 * is left alone rather than half-raised. A bare number is the dimensionless unit,
 * and `1` keeps its own shape.
 */
const EXPONENT = /([A-Za-z%_][A-Za-z0-9_]*?)(-?\d+)(?![A-Za-z0-9_])/g;

/** The superscript spelling of the characters an exponent can contain. */
const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "-": "⁻",
};

/** `-1` as `⁻¹`, and anything without a superscript spelling left as it is. */
function raise(exponent: string): string {
  return [...exponent].map((c) => SUPERSCRIPT[c] ?? c).join("");
}

/**
 * The unit as a reader writes it, or the compiler's own string when it is not a
 * shape this understands.
 */
export function formatUnit(unit: string): string {
  const text = unit.trim();
  if (!text) return "";
  if (!isUnitGrammar(text)) return text;
  let out = text;
  for (const [pattern, symbol] of SYMBOLS) out = out.replace(pattern, symbol);
  out = out.replace(MICRO, "$1µ");
  out = out.replace(EXPONENT, (_match, base: string, exponent: string) => base + raise(exponent));
  return out.replace(/\./g, "·");
}

/**
 * The unit as runs of type, for the surfaces that can set an exponent properly.
 *
 * The exponent is the reason this exists. As a Unicode glyph `⁻²` it measures 5px of ink
 * at 11px, and no stylesheet can grow it without growing the unit's own letters — so the
 * part of the unit that carries its meaning was the smallest thing on the row. A run is a
 * real digit at a size the renderer chooses, raised: 85% of the unit, weight 500, which
 * measures 6px and, more to the point, has strokes.
 *
 * The runs join back into the FLAT spelling (`m·s-2`, symbols replaced, dot as a middot),
 * which is what makes them copyable and what the tests compare against. `formatUnit`
 * stays for the places that need one string and no markup: a tooltip, a log line, the
 * `_info.json` projection, and anywhere the reader will copy the text.
 */
export function unitRuns(unit: string): Run[] {
  const runs = formatRuns(unit);
  return runs.length > 0 ? runs : [];
}

/**
 * The unit as runs, or the compiler's own string as one plain run when it is not a shape
 * this understands — the same all-or-nothing rule as `formatUnit`.
 */
function formatRuns(raw: string): Run[] {
  const text = raw.trim();
  if (!text) return [];
  if (!isUnitGrammar(text)) return [{ text, kind: "base" }];
  const out: Run[] = [];
  // The token split, with the exponent captured: names keep their letters, an attached
  // number becomes a run of its own.
  const TOKEN_WITH_EXPONENT = /([A-Za-z%_][A-Za-z0-9_]*?)(-?\d+)(?![A-Za-z0-9_])/g;
  let cursor = 0;
  for (const match of text.matchAll(TOKEN_WITH_EXPONENT)) {
    const at = match.index ?? 0;
    if (at > cursor) out.push({ text: symbolise(text.slice(cursor, at)), kind: "base" });
    out.push({ text: symbolise(match[1]), kind: "base" });
    out.push({ text: match[2], kind: "sup" });
    cursor = at + match[0].length;
  }
  if (cursor < text.length) out.push({ text: symbolise(text.slice(cursor)), kind: "base" });
  return merge(out);
}

/**
 * Adjacent runs of the same kind, joined.
 *
 * The split above falls wherever a token ends — `m·` then `s` — which draws identically but
 * makes one unit read as four runs: more to measure, more to draw, and a `textContent`
 * nobody can predict. Merging is what makes the runs join back into the flat spelling.
 */
function merge(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (last && last.kind === run.kind && !last.dot && !run.dot) last.text += run.text;
    else out.push({ ...run });
  }
  return out;
}

/** The symbol replacements and the multiplication dot, on one piece of the string. */
function symbolise(piece: string): string {
  let out = piece;
  for (const [pattern, symbol] of SYMBOLS) out = out.replace(pattern, symbol);
  out = out.replace(MICRO, "$1µ");
  return out.replace(/\./g, "·");
}

/**
 * Whether the string is a product or quotient of unit tokens.
 *
 * Parentheses are allowed, because the compiler writes them for a compound
 * denominator (`J/(kg.K)`), but only as a denominator group and never nested.
 * This is a check for a shape that can be rewritten safely, not a unit parser:
 * anything it is not sure about is a string to leave alone.
 */
function isUnitGrammar(unit: string): boolean {
  // A decimal point is not a multiplication: `1.5` is not two units.
  if (/\d\.\d/.test(unit)) return false;
  let depth = 0;
  for (let i = 0; i < unit.length; i++) {
    const c = unit[i];
    if (c === "(") {
      if (depth > 0) return false;
      if (unit[i - 1] !== "/") return false;
      if (i + 1 >= unit.length || unit[i + 1] === ")") return false;
      depth = 1;
    } else if (c === ")") {
      if (depth === 0) return false;
      depth = 0;
    }
  }
  if (depth !== 0) return false;
  return unit
    .replace(/[()]/g, "")
    .split(/[./]/)
    .every((part) => TOKEN.test(part));
}
