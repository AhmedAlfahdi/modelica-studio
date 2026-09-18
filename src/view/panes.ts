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
 * The height a bottom-anchored pane takes when the grip on its TOP edge is
 * dragged by `deltaY`.
 *
 * The pane is pinned to the bottom of the window, so its top edge IS the boundary
 * the grip draws: dragging the boundary DOWN makes the pane SHORTER. The sign is
 * the entire content of this function, and it is the thing that has been wrong
 * before -- a grip that moves against the pointer is unusable, and it is
 * invisible in a screenshot, so it has to be pinned by a test rather than by
 * reading the code.
 *
 * With the grip on the pane's BOTTOM edge the sign is the other way round, which
 * is why this is named for the edge rather than being a bare `+`.
 */
export function heightFromTopEdgeDrag(startHeight: number, deltaY: number): number {
  return startHeight - deltaY;
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
export function clampInspectorWidth(wanted: number, viewWidth: number): number {
  const MIN_INSPECTOR_W = 260;
  if (!Number.isFinite(wanted)) return MIN_INSPECTOR_W;
  if (!Number.isFinite(viewWidth) || viewWidth <= 0) return Math.max(MIN_INSPECTOR_W, wanted);
  // The canvas keeps at least this much.
  const canvasMin = 260;
  const max = Math.max(MIN_INSPECTOR_W, viewWidth - canvasMin);
  return Math.round(Math.max(MIN_INSPECTOR_W, Math.min(wanted, max)));
}
