/**
 * A unit, drawn into the DOM.
 *
 * One place, because a unit appears on four surfaces — a trace row, a solver answer, a
 * parameter label — and they have to agree on what an exponent looks like. The plain
 * Unicode form (`m·s⁻¹`) is what `formatUnit` returns; this draws the exponent as a real
 * `<sup>` instead, so a stylesheet can size it. Measured on the row: 5px of ink as a glyph,
 * 6px as a `<sup>` at 0.85em with weight 500, and strokes rather than a hairline.
 *
 * The element carries the flat spelling as its `title` and its `data-unit`, so the text a
 * reader copies and the value a test or a hover rule compares against are both the
 * compiler's own unit with the exponent written out (`m·s-1`), not a rendering.
 */

import { unitRuns } from "./units";

/** Append `unit` to `parent` as runs, and return the element that holds them. */
export function renderUnit(parent: HTMLElement, unit: string, cls: string): HTMLElement {
  const span = parent.createSpan({ cls });
  for (const run of unitRuns(unit)) {
    if (run.kind === "sup") {
      span.createEl("sup", { cls: "modelica-studio-run-sup", text: run.text });
      continue;
    }
    span.createSpan({ text: run.text });
  }
  // The flat spelling, for a title, for a copy, and for the hover rule that matches rows
  // sharing a unit. Without a unit there is nothing to say, and no attribute to match on.
  const flat = unitRuns(unit)
    .map((r) => r.text)
    .join("");
  if (flat) {
    span.setAttribute("data-unit", flat);
    span.setAttribute("title", `Unit: ${flat}`);
  }
  return span;
}
