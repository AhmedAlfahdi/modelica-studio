/**
 * Geometry for the resizable panes.
 *
 * Kept free of any Obsidian import so the numbers can be tested directly. These
 * are the kind of values that are only ever wrong at the edges — a very short
 * window, a request larger than the view, a stored height from a larger monitor
 * — and those are exactly the cases a test can pin down and a screenshot cannot.
 */

/** Smallest useful height for the results pane. */
export const MIN_RESULTS_H = 160;

/**
 * Width of a drag divider, in pixels.
 *
 * One number for all three, and it is the VISUAL width as well as the hit target:
 * the dividers have to look like each other or the panes stop looking like parts
 * of one window.
 */
export const DIVIDER_PX = 9;

/** Smallest useful width for the palette, in pixels. */
export const MIN_PALETTE_W = 150;

/** Palette width a fresh install starts with, and what double-click returns to. */
export const DEFAULT_PALETTE_W = 210;

/** Smallest useful width for the inspector, in pixels. */
export const MIN_INSPECTOR_W = 260;

/** Inspector width a fresh install starts with, and what double-click returns to. */
export const DEFAULT_INSPECTOR_W = 380;

/**
 * Width the canvas is always left with.
 *
 * A shared floor rather than one per clamp: the three panes are sized against
 * each other, so a diagram with nowhere to draw is the failure they all have to
 * avoid together.
 */
export const MIN_CANVAS_W = 260;

/** Default height in diagram mode, where the pane is what you are looking at. */
export const DEFAULT_RESULTS_H = 300;

/**
 * Default height in code mode.
 *
 * A plot is a reference while editing, not the subject, and the pane sits above
 * the editor: at 300px it took 38% of a 937px view and left the code about half
 * the window, which reads as mostly empty space above the text.
 */
export const CODE_RESULTS_H = 200;

/** Chrome that must stay visible besides the pane: splitter, status bar, margins. */
export const RESULTS_CHROME_H = 56;

/** Largest share of the view the results pane may take. */
export const MAX_RESULTS_FRACTION = 0.8;

/**
 * Which side of a divider the pane it sizes is on.
 *
 * `after` is a pane that follows the divider -- the inspector is to the right of
 * its divider and the results below theirs. `before` is a pane that precedes it,
 * which is the palette. The side is what decides the sign, so it is named rather
 * than left to each caller to get right.
 */
export type DividerSide = "before" | "after";

/**
 * The size a pane takes when its divider is dragged.
 *
 * The divider IS the pane's edge, so it has to move WITH the pointer: drag the
 * boundary by `delta` and the edge ends up exactly `delta` further along. A
 * handle that moves against the pointer is unusable, and that is invisible in a
 * screenshot, so it is pinned by a test rather than by reading the code.
 *
 * The sign follows from the side. Dragging the inspector's divider left (a
 * negative delta) has to WIDEN the inspector, and the palette's has to widen it
 * when dragged right.
 */
export function sizeFromDividerDrag(opts: {
  startSize: number;
  delta: number;
  side: DividerSide;
}): number {
  return opts.side === "after" ? opts.startSize - opts.delta : opts.startSize + opts.delta;
}

/**
 * Clamp a requested results height to what a view of `viewHeight` can give.
 *
 * The pane's grip sits on its TOP edge, so the pane's height is also where the
 * grip appears. There used to be a minimum but NO maximum, so the pane could be
 * dragged until it filled the window — which pushed the grip towards the top of
 * the screen and made the handle read as being at the top rather than at the
 * bottom of the editing area.
 *
 * The upper bound is derived from the measured view rather than fixed, because a
 * short window, a large interface scale or a docked side panel can each leave
 * far less room than a constant assumes.
 */
export function clampResultsHeight(wanted: number, viewHeight: number): number {
  if (!Number.isFinite(wanted)) return DEFAULT_RESULTS_H;
  if (!Number.isFinite(viewHeight) || viewHeight <= 0) {
    // Nothing measurable to clamp against: honour the request, but never below
    // the minimum.
    return Math.round(Math.max(MIN_RESULTS_H, wanted));
  }
  const max = Math.max(
    MIN_RESULTS_H,
    Math.min(viewHeight * MAX_RESULTS_FRACTION, viewHeight - RESULTS_CHROME_H)
  );
  return Math.round(Math.max(MIN_RESULTS_H, Math.min(wanted, max)));
}

/**
 * Clamp the inspector's width for a given view width.
 *
 * Same reasoning as the results pane, and the same history: the canvas needs a
 * minimum too, or the inspector can be dragged until the diagram has nowhere to
 * draw.
 */
export function clampInspectorWidth(
  wanted: number,
  viewWidth: number,
  paletteWidth = 0
): number {
  if (!Number.isFinite(wanted)) return DEFAULT_INSPECTOR_W;
  if (!Number.isFinite(viewWidth) || viewWidth <= 0) {
    return Math.round(Math.max(MIN_INSPECTOR_W, wanted));
  }
  // The canvas keeps at least this much, and so does the palette: without
  // subtracting it, a wide palette let the inspector be dragged until the
  // diagram had nothing left.
  const max = Math.max(
    MIN_INSPECTOR_W,
    viewWidth - MIN_CANVAS_W - Math.round(Math.max(0, paletteWidth)) - DIVIDER_PX * 2
  );
  return Math.round(Math.max(MIN_INSPECTOR_W, Math.min(wanted, max)));
}

/**
 * Clamp the palette's width for a given view width.
 *
 * The palette is the pane that was never resizable, so it had no clamp at all --
 * which means it also never had a reason to account for the other two. Now that
 * all three share the width, each reserves the canvas minimum AND the current
 * width of the other panel, so widening one cannot squeeze the diagram to
 * nothing.
 */
export function clampPaletteWidth(
  wanted: number,
  viewWidth: number,
  inspectorWidth = 0
): number {
  if (!Number.isFinite(wanted)) return DEFAULT_PALETTE_W;
  if (!Number.isFinite(viewWidth) || viewWidth <= 0) {
    return Math.round(Math.max(MIN_PALETTE_W, wanted));
  }
  const max = Math.max(
    MIN_PALETTE_W,
    viewWidth - MIN_CANVAS_W - Math.round(Math.max(0, inspectorWidth)) - DIVIDER_PX * 2
  );
  return Math.round(Math.max(MIN_PALETTE_W, Math.min(wanted, max)));
}
