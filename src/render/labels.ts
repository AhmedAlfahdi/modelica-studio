/**
 * Where a component's name goes.
 *
 * The name is drawn BELOW its symbol by default, which is what a reader expects and
 * what every schematic tool does. The problem is the second component: two symbols
 * stacked vertically put the upper one's name inside the lower one, and a wire routed
 * under a symbol runs straight through the name — the label lands on the drawing it is
 * supposed to explain. Zooming does not help, because the label is sized from the
 * component's on-screen size and stays put relative to it.
 *
 * So the name is treated as a small piece of furniture to be PLACED rather than a fixed
 * caption: the four sides around the symbol are tried in order, the first one that
 * overlaps nothing wins, and if every side is blocked the least-bad one is used. The
 * search is over rectangles in DEVICE pixels, because that is the space the label is
 * drawn in and the space an overlap is visible in.
 *
 * The placement is a pure function of the boxes, so it can be tested without a canvas;
 * the caller supplies `measure` because text width needs a font.
 */

export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The side of its symbol a label ended up on. */
export type LabelSide = "below" | "above" | "right" | "left";

/**
 * How far a label keeps clear of a symbol's ink, in device pixels.
 *
 * The ink box already includes the pins; this is the half-width of a pin MARKER -- a
 * ring, or the triangle an input or output connector is drawn with -- plus the stroke
 * it is drawn with. A name placed exactly on the box edge sat on the marker.
 */
export const LABEL_CLEARANCE = 4;

/** How much room a wire is given when it is treated as an obstacle. */
export const WIRE_CLEARANCE = 3;

/** The order the sides are tried in: below first, so the common case is unchanged. */
export const LABEL_SIDES: LabelSide[] = ["below", "above", "right", "left"];

/**
 * Below this on-screen size a component's name is not drawn at all.
 *
 * MSL puts a symbol's own text outside its body, so a small icon's text lands on its
 * neighbours; the same threshold is what the placement pass uses, so a label that will
 * not be painted is not placed either.
 */
export const LABEL_MIN_SCREEN = 14;

/**
 * Gap between the symbol's edge and its name, in device pixels.
 *
 * Six rather than three: the box the label clears already includes the pins, and a pin
 * marker is a ring or a triangle a few pixels across, so the gap is what keeps the
 * name off the marker rather than level with it.
 */
export const LABEL_GAP = 6;

/**
 * Height of the label's box as a multiple of its font size.
 *
 * A text baseline sits inside a line box taller than the glyphs, so a box sized at
 * exactly `fontPx` would report "no overlap" for a neighbour one pixel below the
 * descenders. 1.2 is the usual rule of thumb for a sans-serif face.
 */
export const LABEL_LINE = 1.2;

/** The label font, in one place: the box is measured with the font it is drawn in. */
export function labelFont(fontPx: number): string {
  return `${fontPx}px sans-serif`;
}

/**
 * Size of a component's name, from the component's own on-screen size.
 *
 * The SAME formula the renderer draws with. A second copy of it here would be a box
 * measured at one size and a label painted at another, which is a collision the
 * placement pass would not see.
 */
export function labelFontPx(onScreenSize: number, labelScale = 1): number {
  return Math.max(9, Math.min(13, onScreenSize / 6)) * labelScale;
}

/** A component whose name needs a place. */
export interface LabelRequest {
  id: string;
  /** The symbol's DRAWN box (not its extent), in device pixels. */
  box: Rect;
  fontPx: number;
}

/** Where a name ended up, and the box it occupies there. */
export interface LabelSpot {
  /** Anchor point for `textAlign = "center"`, `textBaseline = "top"`. */
  x: number;
  y: number;
  box: Rect;
  side: LabelSide;
}

/** Measures a string's width in the label font. */
export type Measure = (text: string, fontPx: number) => number;

/**
 * A uniform grid over the occupied rectangles.
 *
 * Labels are few but obstacles are not: a hundred-component model has a couple of
 * hundred wires, each several segments long, and testing four candidate boxes against
 * all of them on every frame is the kind of quadratic work that shows up as a stutter
 * while dragging. Cells keep the test local: a candidate only meets the rectangles whose
 * cell it touches.
 */
class RectGrid {
  private readonly cells = new Map<string, Rect[]>();
  constructor(
    private readonly cell: number,
    private readonly originX: number,
    private readonly originY: number
  ) {}

  private key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  insert(r: Rect): void {
    const [x0, y0, x1, y1] = this.range(r);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = this.key(cx, cy);
        const bucket = this.cells.get(k);
        if (bucket) bucket.push(r);
        else this.cells.set(k, [r]);
      }
    }
  }

  /** Everything in the cells this rectangle touches. May repeat; may include misses. */
  hits(r: Rect): Rect[] {
    const [x0, y0, x1, y1] = this.range(r);
    if (x1 - x0 > 512 || y1 - y0 > 512) {
      // A candidate spanning a huge number of cells is cheaper to test against
      // everything than to enumerate; models this size are rare, and the answer is
      // the same either way.
      const all: Rect[] = [];
      for (const bucket of this.cells.values()) for (const b of bucket) all.push(b);
      return all;
    }
    const out: Rect[] = [];
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (bucket) for (const b of bucket) out.push(b);
      }
    }
    return out;
  }

  private range(r: Rect): [number, number, number, number] {
    return [
      Math.floor((Math.min(r.x1, r.x2) - this.originX) / this.cell),
      Math.floor((Math.min(r.y1, r.y2) - this.originY) / this.cell),
      Math.floor((Math.max(r.x1, r.x2) - this.originX) / this.cell),
      Math.floor((Math.max(r.y1, r.y2) - this.originY) / this.cell),
    ];
  }
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The box a label occupies when anchored at `x, y` and drawn top-aligned. */
export function labelBoxAt(x: number, y: number, width: number, fontPx: number): Rect {
  return { x1: x - width / 2, y1: y, x2: x + width / 2, y2: y + fontPx * LABEL_LINE };
}

/** The candidate anchor for one side of a symbol's box. */
export function labelAnchorFor(
  side: LabelSide,
  box: Rect,
  width: number,
  fontPx: number
): { x: number; y: number } {
  const cx = (box.x1 + box.x2) / 2;
  const cy = (box.y1 + box.y2) / 2;
  const h = fontPx * LABEL_LINE;
  switch (side) {
    case "below":
      return { x: cx, y: box.y2 + LABEL_GAP };
    case "above":
      return { x: cx, y: box.y1 - LABEL_GAP - h };
    case "right":
      return { x: box.x2 + LABEL_GAP + width / 2, y: cy - h / 2 };
    case "left":
      return { x: box.x1 - LABEL_GAP - width / 2, y: cy - h / 2 };
  }
}

export interface PlaceLabelsResult {
  spots: Map<string, LabelSpot>;
  /** How many labels had to leave the default position below their symbol. */
  moved: number;
  /** How many could not be placed anywhere free. */
  crowded: number;
}

/**
 * Place every name, avoiding the obstacles and each other.
 *
 * Deterministic: the requests are placed in reading order of their symbols (top to
 * bottom, then left to right, with the caller's own order as the tie-break), so the
 * same diagram always produces the same picture, and two labels competing for one gap
 * resolve the same way every frame rather than flickering as the model is edited.
 */
export function placeLabels(
  requests: LabelRequest[],
  occupied: Rect[],
  measure: Measure,
  textOf: (id: string) => string = (id) => id
): PlaceLabelsResult {
  const spots = new Map<string, LabelSpot>();
  let moved = 0;
  let crowded = 0;
  if (requests.length === 0) return { spots, moved, crowded };

  let minX = Infinity;
  let minY = Infinity;
  for (const r of occupied) {
    minX = Math.min(minX, r.x1);
    minY = Math.min(minY, r.y1);
  }
  const originX = Number.isFinite(minX) ? minX : 0;
  const originY = Number.isFinite(minY) ? minY : 0;
  const grid = new RectGrid(96, originX, originY);
  for (const r of occupied) grid.insert(r);

  const order = requests
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.box.y1 - b.r.box.y1 || a.r.box.x1 - b.r.box.x1 || a.i - b.i);

  for (const { r } of order) {
    const text = textOf(r.id);
    if (!text) continue;
    const width = measure(text, r.fontPx);
    let best: { spot: LabelSpot; area: number } | undefined;
    for (const side of LABEL_SIDES) {
      const at = labelAnchorFor(side, r.box, width, r.fontPx);
      const box = labelBoxAt(at.x, at.y, width, r.fontPx);
      let area = 0;
      for (const other of grid.hits(box)) area += overlapArea(box, other);
      const spot: LabelSpot = { x: at.x, y: at.y, box, side };
      if (!best || area < best.area) best = { spot, area };
      if (best.area === 0) break; // a clean side, and the earlier ones were worse
    }
    const chosen = best?.spot;
    if (!chosen) continue;
    if (chosen.side !== "below") moved++;
    if ((best?.area ?? 0) > 0) crowded++;
    spots.set(r.id, chosen);
    grid.insert(chosen.box);
  }
  return { spots, moved, crowded };
}
