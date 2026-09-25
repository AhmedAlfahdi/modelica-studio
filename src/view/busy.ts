/**
 * Showing that something is happening.
 *
 * The app carries the vocabulary, so nothing new is invented here: its
 * `.is-loading` draws an animated 3px accent bar along the TOP edge of whatever
 * carries it, absolutely positioned, which is why it cannot move anything. The
 * plugin's job is only to say WHEN — and to say it in one place, because a bar
 * left running after the work has stopped is worse than no bar at all.
 *
 * Its own module because two surfaces need it: the studio and a block embedded in
 * a note. `test/busy.test.mjs` renders both halves of this in a real DOM and
 * measures that nothing moves.
 */

import { setIcon } from "obsidian";

/**
 * Mark a surface as working, or stop.
 *
 * `percent` makes the bar determinate — the width IS the progress — which is
 * worth having for a sweep, where the count is known, and wrong for a compile,
 * where it is not.
 *
 * `aria-busy` is set alongside the class: the bar is decoration, and this is what
 * tells a screen reader that what it is looking at is being computed. Setting them
 * in one place is the point of the module.
 */
export function setBusy(el: HTMLElement | null | undefined, busy: boolean, percent?: number): void {
  if (!el) return;
  el.toggleClass("is-loading", busy);
  el.toggleClass("is-progress", busy && percent !== undefined);
  if (busy) el.setAttribute("aria-busy", "true");
  else el.removeAttribute("aria-busy");
  if (percent === undefined) el.style.removeProperty("--ms-progress");
  else el.style.setProperty("--ms-progress", `${Math.max(0, Math.min(100, percent))}%`);
}

/**
 * Turn the icon of a button that has started something into a turning one.
 *
 * `setIcon` removes the button's FIRST child and appends the new SVG. A button's
 * children are `[icon, label]`, so the first swap leaves `[label, loader]` — and
 * the second swap, the one that puts the original icon back, then removes the
 * LABEL and appends the icon, leaving `[loader, icon]`: two icons and no word.
 *
 * That is exactly what it did: after one simulation the Simulate button was a
 * spinner and a play triangle with "Simulate" gone, and every button that had been
 * through it looked the same. The label is therefore put back last, every time.
 *
 * `.svg-icon` is a fixed 14px box, so swapping one for another cannot change the
 * button's size — which is why this is done rather than adding a spinner beside
 * the label, where every button after it would move.
 */
export function setButtonBusy(
  btn: HTMLElement | null | undefined,
  busy: boolean,
  idleIcon: string
): void {
  if (!btn) return;
  const label = Array.from(btn.children).find((el) => !(el.instanceOf(SVGSVGElement)));
  setIcon(btn, busy ? "loader-2" : idleIcon);
  if (label && label.parentElement) btn.appendChild(label);
  btn.toggleClass("modelica-studio-spin", busy);
}
