/**
 * Accessible names that do not become tooltips.
 *
 * Obsidian's tooltip handler is delegated on `[aria-label]`, so ANY element with
 * one raises a tooltip — including a group or a container, whose label then pops
 * up whenever the pointer crosses anything inside it. Its own code checks a
 * `--no-tooltip` custom property for the cases where the label is for a screen
 * reader only, which is what this sets.
 *
 * Its own module because more than one surface needs it now: the studio's
 * controls, and the results bar, which is built in `plot-actions.ts`. A labelled
 * container there raised "Sweep a parameter, or keep a run to compare with" over
 * the open parameter list — a tooltip drawn in the page, behind a native popup
 * that is always above it.
 */

export function noLabelTooltip(el: HTMLElement, name: string): void {
  el.setAttribute("aria-label", name);
  el.style.setProperty("--no-tooltip", "true");
}
