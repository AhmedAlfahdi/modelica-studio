/**
 * Canvas2D renderer for Modelica graphics.
 *
 * Mirrors how OMEdit renders diagrams (QGraphicsScene + QPainter, one routine
 * per Modelica primitive) rather than using DOM/SVG nodes: a single canvas
 * keeps node count irrelevant and gives exact control over the six graphics
 * primitives and their transformation semantics.
 *
 * Two correctness details that are easy to get wrong and expensive to debug:
 *
 *  1. Coordinate systems differ. A class Icon is authored in a canonical
 *     -100..100 box; an instance is placed in diagram coordinates by
 *     `Placement(transformation(extent=...))`. Drawing an icon therefore means
 *     mapping canonical space through the instance's extent, not drawing the
 *     icon's numbers directly.
 *
 *  2. Transformation order is extent (scale/flip) -> rotation -> origin
 *     (translate), per MLS §18.6.2. Rotation is applied about {0,0} in the
 *     local system, NOT about the extent centre. Implementing the older
 *     pre-3.6 wording misplaces every rotated component.
 */

import { currentTheme, themedColor, type Theme } from "./theme";

import type {
  BitmapGraphic,
  Color,
  ComponentClass,
  ComponentInstance,
  Connection,
  DiagramModel,
  EllipseGraphic,
  FillPattern,
  Graphic,
  LineGraphic,
  LinePattern,
  PolygonGraphic,
  RectangleGraphic,
  TextGraphic,
  Viewport,
} from "../modelica/types";


/**
 * Distance from a point to the nearest drawn artwork, in canonical units.
 * Approximates a rectangle or polyline by its bounding box, which is adequate
 * for deciding whether a pin needs a connecting stub.
 */
function distanceToArtwork(art: [number, number, number, number], x: number, y: number): number {
  const [x1, y1, x2, y2] = art;
  const dx = Math.max(x1 - x, 0, x - x2);
  const dy = Math.max(y1 - y, 0, y - y2);
  return Math.hypot(dx, dy);
}

/** Nearest point on the artwork's bounding box to (x, y). */
function nearestArtworkPoint(
  art: [number, number, number, number],
  x: number,
  y: number
): [number, number] {
  const [x1, y1, x2, y2] = art;
  return [Math.min(Math.max(x, x1), x2), Math.min(Math.max(y, y1), y2)];
}

/**
 * Connect a pin to the symbol it belongs to.
 *
 * MSL icons frequently stop short of their own connector: a Capacitor's lead is
 * drawn from -90 while its pin is at -100, leaving a 10-unit gap. The wire
 * correctly ends on the pin, so the two do not meet and the run looks broken.
 *
 * Rather than patching individual classes, every pin whose distance to the
 * class's artwork exceeds a threshold gets a short connector drawn to the
 * nearest artwork point. That is what the symbol implies visually anyway.
 */
function drawPortStubs(
  ctx: CanvasRenderingContext2D,
  g: Graphic,
  t: Transform,
  totalScale: number,
  art: [number, number, number, number],
  ports: Record<string, [number, number]>,
  theme: Theme
): void {
  const style = strokeStyleFor(g, totalScale, theme);
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.lineCap = "butt";
  for (const [, [px, py]] of Object.entries(ports)) {
    if (distanceToArtwork(art, px, py) <= PIN_STUB_THRESHOLD) continue;
    const [nx, ny] = nearestArtworkPoint(art, px, py);
    const [ax, ay] = apply(t, px, py);
    const [bx, by] = apply(t, nx, ny);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Decide whether a graphic is drawn.
 *
 * `visible` is often a Modelica *expression* (`visible=useHeatPort`,
 * `visible=useHeatPort or useThermalPort`) rather than a literal. Evaluating
 * those needs parameter values this renderer does not have, and defaulting to
 * visible would draw optional parts that libraries hide by default — the
 * Resistor's heat port being the common case. Anything that is not a literal
 * `true` is therefore not drawn.
 */
export function isGraphicVisible(g: Graphic): boolean {
  const v = (g as { visible?: boolean | string }).visible;
  if (v === undefined) return true;
  if (v === true) return true;
  if (typeof v === "string") return v === "true";
  return false;
}

/**
 * A pin further than this from its class's artwork gets a connecting stub, in
 * canonical units. Small values tolerate rounding; 10 units is the gap a
 * Capacitor has, so the threshold sits well below that.
 */
/**
 * On-screen size a symbol's largest dimension should occupy, in diagram units.
 * Chosen so standard MSL parts look consistent with one another.
 */
const TARGET_ARTWORK_UNITS = 28;

/** Fixed margin added around a symbol's own box, in diagram units. */
const HIT_MARGIN_UNITS = 1.5;

/**
 * Smallest clickable size for a symbol, in diagram units.
 *
 * Applies only to symbols drawn very small inside their box (InternalSupport
 * fills 20% of its box), so they stay clickable without padding symbols that
 * already fill theirs.
 */
const MIN_TARGET_UNITS = 12;

const PIN_STUB_THRESHOLD = 1.5;

/**
 * Whether a Text graphic sits inside the icon's own box.
 *
 * MSL uses Text for two different jobs: the short label *inside* a symbol
 * ("R", "+", "~") and a parametric readout placed far outside it
 * (`Text(extent={{-150,90},{150,50}}, textString="R=%R")`). Two thirds of MSL
 * labels are the latter.
 *
 * The distinction matters for interaction, not just looks: the parametric
 * readout scales with zoom, so at high zoom it sits a long way from the symbol
 * and makes the thing on screen much taller than the thing that is clickable.
 * Aiming at the visible centre then misses. Only in-box labels are drawn.
 */
function isInBoxLabel(g: TextGraphic): boolean {
  const e = g.extent;
  if (!e) return false;
  return (
    e[0] >= -ICON_EXTENT && e[2] <= ICON_EXTENT &&
    e[1] >= -ICON_EXTENT && e[3] <= ICON_EXTENT
  );
}

/** Canonical Modelica icon coordinate system: -100..100 on both axes. */
export const ICON_EXTENT = 100;

/**
 * Default on-diagram size, in diagram units, for a newly placed component.
 *
 * Derived from the class's OWN icon geometry rather than a fixed box: MSL
 * symbols are authored with a body of roughly +-10 in canonical units inside
 * the +-100 box (a resistor's rectangle is `extent={{-70,30},{70,-30}}`), so a
 * fixed 40-unit box renders the symbol at about half the intended size and it
 * stops matching the geometry the class was drawn against. Falls back to a
 * sensible default when a class has no icon.
 */
/**
 * Size for a newly placed component, in diagram units.
 *
 * MSL draws its symbols inside a canonical +-100 box but rarely fills it: a
 * Resistor's body occupies 30% of the box, a Ground 60%. Placing every component
 * in a fixed 40-unit box therefore renders those symbols undersized, leaving a
 * large invisible region — which is what made selection feel imprecise, because
 * the clickable area and the drawing disagreed by so much.
 *
 * The extent is instead derived from the artwork so the symbol fills the box.
 * Aspect ratio is preserved, so a wide symbol stays wide rather than being
 * stretched into a square.
 */
/**
 * On-diagram size for a newly placed component.
 *
 * Derived from the class's own artwork so every symbol ends up a similar visual
 * size. This matters for more than looks: the clickable region is the drawn
 * symbol, so a symbol rendered undersized inside an oversized box leaves a large
 * invisible area, and selection stops matching what the user sees.
 *
 * The transform maps the canonical +-100 box onto the extent, so a piece of
 * artwork spanning `s` canonical units occupies `s/200` of the extent. The
 * extent is therefore the size that makes the artwork's largest span come out at
 * `targetArtworkUnits`.
 *
 * Returns the size of the TRUE proportioned box; the icon is centred within it.
 */
export function defaultComponentSize(classDef: ComponentClass | undefined): number {
  const art = iconArtworkBounds(classDef);
  if (!art) return MSL_COMPONENT_SIZE;
  const span = Math.max(art[2] - art[0], art[3] - art[1], 1);
  const extent = (TARGET_ARTWORK_UNITS * (2 * ICON_EXTENT)) / span;
  return Math.max(MSL_COMPONENT_SIZE * 0.6, Math.min(MSL_COMPONENT_SIZE * 3, extent));
}

/** Extent for a component, preserving its artwork's aspect ratio. */
export function defaultExtent(
  classDef: ComponentClass | undefined,
  cx: number,
  cy: number
): [number, number, number, number] {
  const size = defaultComponentSize(classDef);
  const art = iconArtworkBounds(classDef);
  let halfW = size / 2;
  let halfH = size / 2;
  if (art) {
    const w = Math.max(art[2] - art[0], 1);
    const h = Math.max(art[3] - art[1], 1);
    // The artwork's own aspect, so the box fits it rather than the reverse.
    const aspect = w / h;
    if (aspect > 1) halfH = halfW / aspect;
    else if (aspect < 1) halfW = halfH * aspect;
  }
  return [cx - halfW, cy - halfH, cx + halfW, cy + halfH];
}

/** A 2D affine transform, applied as [a c e; b d f]. */
export interface Transform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** Compose two transforms: apply `inner` first, then `outer`. */
export function mul(outer: Transform, inner: Transform): Transform {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

export function apply(t: Transform, x: number, y: number): [number, number] {
  return [t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f];
}

/**
 * Build the transform that maps a class's canonical icon space into diagram
 * coordinates for one instance.
 *
 * Order: scale/flip by the extent, then rotate about {0,0}, then translate so
 * the (possibly rotated) box lands on the extent.
 */
export function placementTransform(inst: ComponentInstance): Transform {
  const [x1, y1, x2, y2] = inst.placement.extent;
  const w = x2 - x1;
  const h = y2 - y1;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;

  // Map the canonical -100..100 box onto the extent.
  const sx = w / (2 * ICON_EXTENT);
  const sy = h / (2 * ICON_EXTENT);

  // MLS 3.6+: rotation is about {0,0} in the local system, applied after
  // scaling/flipping and before the origin translation.
  const rot = ((inst.placement.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  const scale: Transform = { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
  const rotate: Transform = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  const origin = inst.placement.origin ?? [0, 0];
  const translate: Transform = { a: 1, b: 0, c: 0, d: 1, e: cx - origin[0], f: cy - origin[1] };

  return mul(translate, mul(rotate, scale));
}

/** The viewport transform: diagram coordinates to canvas pixels. */
export function viewportTransform(vp: Viewport, dpr: number): Transform {
  return { a: vp.scale * dpr, b: 0, c: 0, d: vp.scale * dpr, e: vp.x * dpr, f: vp.y * dpr };
}

/** Bounding box in diagram coordinates, after a transform. */
export function transformedBounds(
  t: Transform,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): [number, number, number, number] {
  const pts = [
    apply(t, x1, y1),
    apply(t, x2, y1),
    apply(t, x2, y2),
    apply(t, x1, y2),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Axis-aligned bounds of a flat point list in diagram coordinates. */
export function pointsBounds(points: number[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxY = Math.max(maxY, points[i + 1]);
  }
  if (!Number.isFinite(minX)) return [0, 0, 0, 0];
  return [minX, minY, maxX, maxY];
}

/* ------------------------------------------------------------------ */
/* Colour helpers                                                      */
/* ------------------------------------------------------------------ */

export function rgb(c: Color | undefined, fallback: Color = [0, 0, 0]): string {
  const v = c ?? fallback;
  return `rgb(${v[0]},${v[1]},${v[2]})`;
}

/**
 * Modelica's convention: fillColor {255,255,255} with fillPattern=None renders
 * as unfilled; fillColor {0,0,0} with a pattern is treated as "no fill" too.
 */
function hasFill(g: Graphic): boolean {
  const fp = (g as { fillPattern?: FillPattern }).fillPattern;
  if (!fp || fp === "None") return false;
  const fc = (g as { fillColor?: Color }).fillColor;
  if (!fc) return false;
  return true;
}

/** Line dash patterns, scaled to the current zoom so they stay legible. */
function dashFor(pattern: LinePattern | undefined, scale: number): number[] {
  const s = Math.max(1, Math.min(4, 1 / Math.max(scale, 0.05)));
  switch (pattern) {
    case "Dash":
      return [6 * s, 4 * s];
    case "Dot":
      return [1.5 * s, 3 * s];
    case "DashDot":
      return [6 * s, 3 * s, 1.5 * s, 3 * s];
    case "DashDotDot":
      return [6 * s, 3 * s, 1.5 * s, 3 * s, 1.5 * s, 3 * s];
    case "None":
      return [];
    default:
      return [];
  }
}

/**
 * Hatch patterns. Modelica defines several fill patterns; approximating them
 * with canvas strokes is both faithful enough visually and cheap. `Sphere` and
 * the cylinder patterns degrade to a flat fill.
 */
function applyFillPattern(
  ctx: CanvasRenderingContext2D,
  g: Graphic,
  bounds: [number, number, number, number]
): void {
  const fp = (g as { fillPattern?: FillPattern }).fillPattern ?? "None";
  const fc = (g as { fillColor?: Color }).fillColor ?? [0, 0, 0];
  const [x1, y1, x2, y2] = bounds;
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return;

  ctx.save();
  ctx.clip();
  ctx.strokeStyle = rgb(fc);
  ctx.lineWidth = Math.max(0.5, Math.min(w, h) / 40);
  const step = Math.max(2, Math.min(w, h) / 8);

  switch (fp) {
    case "Horizontal":
      for (let y = y1; y <= y2; y += step) line(ctx, x1, y, x2, y);
      break;
    case "Vertical":
      for (let x = x1; x <= x2; x += step) line(ctx, x, y1, x, y2);
      break;
    case "Cross":
      for (let y = y1; y <= y2; y += step) line(ctx, x1, y, x2, y);
      for (let x = x1; x <= x2; x += step) line(ctx, x, y1, x, y2);
      break;
    case "Forward":
      for (let d = -h; d <= w; d += step) line(ctx, x1 + d, y2, x1 + d + h, y1);
      break;
    case "Backward":
      for (let d = -h; d <= w; d += step) line(ctx, x1 + d, y1, x1 + d + h, y2);
      break;
    case "CrossDiag":
      for (let d = -h; d <= w; d += step) line(ctx, x1 + d, y2, x1 + d + h, y1);
      for (let d = -h; d <= w; d += step) line(ctx, x1 + d, y1, x1 + d + h, y2);
      break;
    default:
      // Solid / Sphere / cylinder patterns: flat fill already applied.
      break;
  }
  ctx.restore();

  function line(
    c: CanvasRenderingContext2D,
    ax: number,
    ay: number,
    bx: number,
    by: number
  ): void {
    c.beginPath();
    c.moveTo(ax, ay);
    c.lineTo(bx, by);
    c.stroke();
  }
}

/* ------------------------------------------------------------------ */
/* Primitive drawing                                                   */
/* ------------------------------------------------------------------ */

/**
 * Stroke weight for a graphic, in SCREEN pixels.
 *
 * Modelica expresses `lineThickness`/`thickness` as a fraction of the canonical
 * +-100 icon box (MSL uses 0.25 for nearly everything). Converting that to
 * diagram units and letting the canvas transform scale it produces a stroke of
 * ~0.1 px — the symbol outline is then effectively invisible and only the wire
 * shows. Expressing the weight in screen pixels and dividing by the transform
 * scale keeps symbols legible at every zoom, and lets the outline and the wire
 * read as parts of the same drawing.
 */
const MSL_LINE_CANONICAL = 0.25;

/**
 * Reference on-screen size, in pixels, of a standard 20-unit component at 1:1
 * zoom. Used to convert Modelica's absolute pen widths into screen weights.
 */
const REFERENCE_ICON_PX = 40;
/** Pen weight of a 0.25 canonical stroke on that reference component. */
const REFERENCE_STROKE_PX = 1.5;

/** Keeps outlines visible when zoomed out; they are the only thing showing. */
const MIN_STROKE_PX = 1;
/** Keeps outlines from swallowing small symbols when zoomed in. */
const MAX_STROKE_PX = 6;

function screenStrokePx(g: Graphic, totalScale: number, strokePx?: number): number {
  // A caller that draws into a scaled context — the palette thumbnails, where
  // the canonical box is squeezed to a few dozen pixels — states the weight it
  // wants on screen. Without this the floor below was applied in CONTEXT units
  // and then multiplied by the tiny scale, leaving strokes a fifth of a pixel
  // wide: `Line`-only icons such as Modelica.StateGraph.Alternative rendered as
  // nothing at all.
  if (strokePx !== undefined) return strokePx;
  const thickness =
    (g as { thickness?: number }).thickness ??
    (g as { lineThickness?: number }).lineThickness ??
    MSL_LINE_CANONICAL;
  // Pen width scales with the icon's on-screen size, so zooming in thickens the
  // drawing the way a real schematic viewer does — but never below a legible
  // floor, which is what made everything vanish at low zoom.
  // Derive from the component's on-screen size so every weight shares one scale.
  const iconPx = MSL_COMPONENT_SIZE * Math.max(totalScale, 1e-6);
  const px = (thickness / MSL_LINE_CANONICAL) * REFERENCE_STROKE_PX * (iconPx / REFERENCE_ICON_PX);
  return Math.max(MIN_STROKE_PX, Math.min(MAX_STROKE_PX, px));
}

function strokeStyleFor(
  g: Graphic,
  totalScale: number,
  theme: Theme,
  strokePx?: number
): { color: string; width: number; dash: number[] } {
  const lc = (g as { lineColor?: Color }).lineColor ?? (g as { color?: Color }).color;
  const px = screenStrokePx(g, totalScale, strokePx);
  // lineWidth is interpreted in pre-transform units, so undo the scale.
  const scale = Math.max(totalScale, 1e-6);
  return {
    color: rgb(themedColor(lc, theme, "stroke")),
    width: px / scale,
    dash: dashFor(g.pattern, scale),
  };
}

/**
 * Draw one graphic primitive.
 *
 * `width` converts Modelica line thickness (a fraction of the icon box) into
 * pixels, so strokes keep their intended visual weight at any zoom.
 */
export function drawGraphic(
  ctx: CanvasRenderingContext2D,
  g: Graphic,
  t: Transform,
  totalScale: number,
  theme: Theme,
  /** Fixed on-screen stroke weight; omit to derive it from the scale. */
  strokePx?: number
): void {
  if (!isGraphicVisible(g)) return;

  switch (g.kind) {
    case "Line":
      drawLine(ctx, g, t, totalScale, theme, strokePx);
      break;
    case "Polygon":
      drawPolygon(ctx, g, t, totalScale, theme, strokePx);
      break;
    case "Rectangle":
      drawRectangle(ctx, g, t, totalScale, theme, strokePx);
      break;
    case "Ellipse":
      drawEllipse(ctx, g, t, totalScale, theme, strokePx);
      break;
    case "Text":
      drawText(ctx, g, t, totalScale, theme);
      break;
    case "Bitmap":
      drawBitmap(ctx, g, t);
      break;
  }
}

function pathFromPoints(
  ctx: CanvasRenderingContext2D,
  points: number[],
  t: Transform
): void {
  ctx.beginPath();
  for (let i = 0; i + 1 < points.length; i += 2) {
    const [x, y] = apply(t, points[i], points[i + 1]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  g: LineGraphic,
  t: Transform,
  totalScale: number,
  theme: Theme,
  strokePx?: number
): void {
  if (g.points.length < 4) return;
  const style = strokeStyleFor(g, totalScale, theme, strokePx);
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (style.dash.length) ctx.setLineDash(style.dash);

  if (g.smooth === "Bezier" && g.points.length >= 6) {
    // Catmull-Rom-ish smoothing through the supplied points.
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < g.points.length; i += 2) {
      pts.push(apply(t, g.points[i], g.points[i + 1]));
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i === 0 ? 0 : i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];
      ctx.bezierCurveTo(
        p1[0] + (p2[0] - p0[0]) / 6,
        p1[1] + (p2[1] - p0[1]) / 6,
        p2[0] - (p3[0] - p1[0]) / 6,
        p2[1] - (p3[1] - p1[1]) / 6,
        p2[0],
        p2[1]
      );
    }
    ctx.stroke();
  } else {
    pathFromPoints(ctx, g.points, t);
    ctx.stroke();
  }

  // Arrowheads at either end.
  const arrow = g.arrow ?? ["None", "None"];
  const size = (g.arrowSize ?? 3) * screenStrokePx(g, totalScale);
  if (arrow[1] && arrow[1] !== "None") {
    drawArrowHead(ctx, g, t, totalScale, "end", arrow[1], size, style.color);
  }
  if (arrow[0] && arrow[0] !== "None") {
    drawArrowHead(ctx, g, t, totalScale, "start", arrow[0], size, style.color);
  }
  ctx.restore();
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  g: LineGraphic,
  t: Transform,
  _totalScale: number,
  which: "start" | "end",
  kind: string,
  size: number,
  color: string
): void {
  const n = g.points.length;
  const tipIdx = which === "end" ? n - 2 : 0;
  const prevIdx = which === "end" ? n - 4 : 2;
  if (prevIdx < 0 || tipIdx < 0) return;

  const [tx, ty] = apply(t, g.points[tipIdx], g.points[tipIdx + 1]);
  const [px, py] = apply(t, g.points[prevIdx], g.points[prevIdx + 1]);
  const dx = tx - px;
  const dy = ty - py;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const ux = dx / len;
  const uy = dy / len;

  const half = size * 0.5;
  const bx = tx - ux * size;
  const by = ty - uy * size;
  const nx = -uy;
  const ny = ux;

  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(bx + nx * half, by + ny * half);
  ctx.lineTo(bx - nx * half, by - ny * half);
  ctx.closePath();
  if (kind === "Filled") {
    ctx.fillStyle = color;
    ctx.fill();
  } else if (kind === "Half") {
    // Half arrow: fill only one side of the head.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(bx + nx * half, by + ny * half);
    ctx.lineTo(bx, by);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, size / 6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  g: PolygonGraphic,
  t: Transform,
  totalScale: number,
  theme: Theme,
  strokePx?: number
): void {
  if (g.points.length < 4) return;
  ctx.save();
  pathFromPoints(ctx, g.points, t);
  ctx.closePath();

  const filled = hasFill(g);
  if (filled) {
    ctx.fillStyle = rgb(themedColor(g.fillColor, theme, "fill"), theme.paper);
    ctx.fill();
  }
  const style = strokeStyleFor(g, totalScale, theme, strokePx);
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.lineJoin = "round";
  if (style.dash.length) ctx.setLineDash(style.dash);
  ctx.stroke();

  if (filled && g.fillPattern && g.fillPattern !== "Solid") {
    const b = pointsBounds(flatTransformed(g.points, t));
    applyFillPattern(ctx, g, b);
  }
  ctx.restore();
}

function flatTransformed(points: number[], t: Transform): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const [x, y] = apply(t, points[i], points[i + 1]);
    out.push(x, y);
  }
  return out;
}

/**
 * Draw a rectangle.
 *
 * MLS: the given extent is the rectangle's *outer* boundary, and the border is
 * drawn half inside / half outside that line, so a stroke of width w is inset
 * by w/2 when filling.
 */
function drawRectangle(
  ctx: CanvasRenderingContext2D,
  g: RectangleGraphic,
  t: Transform,
  totalScale: number,
  theme: Theme,
  strokePx?: number
): void {
  const [x1, y1, x2, y2] = g.extent;
  const pts = flatTransformed([x1, y1, x2, y1, x2, y2, x1, y2], t);
  const b = pointsBounds(pts);
  const w = b[2] - b[0];
  const h = b[3] - b[1];
  if (w <= 0 || h <= 0) return;

  ctx.save();
  const style = strokeStyleFor(g, totalScale, theme, strokePx);
  const r = g.radius ? Math.min(g.radius, Math.min(w, h) / 2) : 0;

  ctx.beginPath();
  if (r > 0) roundedRectPath(ctx, b[0], b[1], w, h, r);
  else ctx.rect(b[0], b[1], w, h);

  if (hasFill(g)) {
    ctx.fillStyle = rgb(themedColor(g.fillColor, theme, "fill"), theme.paper);
    ctx.fill();
  }
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  if (style.dash.length) ctx.setLineDash(style.dash);
  ctx.stroke();

  if (hasFill(g) && g.fillPattern && g.fillPattern !== "Solid") {
    applyFillPattern(ctx, g, b);
  }

  // Raised/sunken/engraved borders are drawn as a lighter inner highlight.
  if (g.borderPattern && g.borderPattern !== "None") {
    const light = g.borderPattern === "Raised" || g.borderPattern === "Engraved";
    ctx.strokeStyle = light ? theme.pinFill : "rgba(0,0,0,0.55)";
    ctx.lineWidth = Math.max(1, style.width * 0.8);
    ctx.setLineDash([]);
    const off = ctx.lineWidth;
    ctx.beginPath();
    ctx.rect(b[0] + off, b[1] + off, w - 2 * off, h - 2 * off);
    ctx.stroke();
  }
  ctx.restore();
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawEllipse(
  ctx: CanvasRenderingContext2D,
  g: EllipseGraphic,
  t: Transform,
  totalScale: number,
  theme: Theme,
  strokePx?: number
): void {
  // An ellipse under an affine transform is still an ellipse, so we can use
  // the transformed bounding box and canvas' own ellipse primitive.
  const [x1, y1, x2, y2] = g.extent;
  const pts = flatTransformed([x1, y1, x2, y1, x2, y2, x1, y2], t);
  const b = pointsBounds(pts);
  const cx = (b[0] + b[2]) / 2;
  const cy = (b[1] + b[3]) / 2;
  const rx = (b[2] - b[0]) / 2;
  const ry = (b[3] - b[1]) / 2;
  if (rx <= 0 || ry <= 0) return;

  const start = ((g.startAngle ?? 0) * Math.PI) / 180;
  const end = ((g.endAngle ?? 360) * Math.PI) / 180;
  const closure = g.closure ?? "Arc";

  ctx.save();
  ctx.beginPath();
  if (closure === "Arc" && Math.abs(end - start) < Math.PI * 2 - 1e-6) {
    // An open arc: stroke only.
    ctx.ellipse(cx, cy, rx, ry, 0, start, end);
  } else if (closure === "Chord") {
    ctx.ellipse(cx, cy, rx, ry, 0, start, end);
    ctx.closePath();
  } else {
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  }

  if (hasFill(g) && closure !== "Arc") {
    ctx.fillStyle = rgb(themedColor(g.fillColor, theme, "fill"), theme.paper);
    ctx.fill();
  }
  const style = strokeStyleFor(g, totalScale, theme, strokePx);
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  if (style.dash.length) ctx.setLineDash(style.dash);
  ctx.stroke();

  if (hasFill(g) && closure !== "Arc" && g.fillPattern && g.fillPattern !== "Solid") {
    applyFillPattern(ctx, g, b);
  }
  ctx.restore();
}

/**
 * Draw text.
 *
 * Modelica's fontSize is in the canonical (-100..100) system, so it must be
 * scaled by the current transform or labels shrink to nothing when zoomed in.
 * `textStyle` is a set of flags: 1=bold, 2=italic, 4=underline.
 */
function drawText(
  ctx: CanvasRenderingContext2D,
  g: TextGraphic,
  t: Transform,
  _width: number,
  theme: Theme
): void {
  const raw = g.textString;
  if (raw === undefined || raw === "") return;
  const text = substituteMacros(raw, g);

  const [x1, y1, x2, y2] = g.extent;
  const pts = flatTransformed([x1, y1, x2, y1, x2, y2, x1, y2], t);
  const b = pointsBounds(pts);

  // Canonical font size -> pixels, via the transform's vertical scale.
  const scaleY = Math.hypot(t.b, t.d) || 1;
  const fontPx = Math.max(1, (g.fontSize ?? 0) * scaleY);

  ctx.save();
  const flags = g.textStyle ?? [];
  const bold = flags.includes(1) ? "bold " : "";
  const italic = flags.includes(2) ? "italic " : "";
  ctx.font = `${italic}${bold}${fontPx}px sans-serif`;
  ctx.fillStyle = rgb(themedColor(g.textColor, theme, "stroke"), theme.ink);
  ctx.textBaseline = "middle";
  ctx.textAlign =
    g.horizontalAlignment === -1 ? "left" : g.horizontalAlignment === 1 ? "right" : "center";

  const cx = (b[0] + b[2]) / 2;
  const cy = (b[1] + b[3]) / 2;
  const tx = g.horizontalAlignment === -1 ? b[0] : g.horizontalAlignment === 1 ? b[2] : cx;

  ctx.fillText(text, tx, cy);
  if (flags.includes(4)) {
    const m = ctx.measureText(text);
    const w = m.width;
    const ux = g.horizontalAlignment === -1 ? tx : g.horizontalAlignment === 1 ? tx - w : tx - w / 2;
    ctx.fillRect(ux, cy + fontPx * 0.4, w, Math.max(1, fontPx / 16));
  }
  ctx.restore();
}

/**
 * Substitute Modelica's `%` macros in a textString.
 *
 * MLS §18.6.5.5 defines: %%  -> %, %name -> parameter value, %{name} -> value,
 * %class -> class name, %par -> the parameter's dialog label. Values we cannot
 * resolve are left visible rather than silently dropped, so a missing binding
 * is obvious instead of looking like an empty label.
 */
export function substituteMacros(
  text: string,
  _g: TextGraphic,
  resolve?: (name: string) => string | undefined
): string {
  return text.replace(/%(%)|%\{([^}]*)\}|%([A-Za-z_][A-Za-z0-9_.]*)/g, (all, esc, braced, bare) => {
    if (esc) return "%";
    const name = braced ?? bare;
    const v = resolve?.(name);
    return v !== undefined ? v : all;
  });
}

/**
 * Draw a bitmap icon.
 *
 * MSL bitmap icons reference `modelica://Library/Resources/Images/x.png`. We
 * only draw when the caller has supplied a resolved, already-loaded image;
 * otherwise the shape is outlined so the layout is still readable.
 */
function drawBitmap(ctx: CanvasRenderingContext2D, g: BitmapGraphic, t: Transform): void {
  const [x1, y1, x2, y2] = g.extent;
  const pts = flatTransformed([x1, y1, x2, y1, x2, y2, x1, y2], t);
  const b = pointsBounds(pts);
  const img = g.fileName ? imageCache.get(g.fileName) : undefined;

  if (img && img.complete && img.naturalWidth > 0) {
    ctx.save();
    ctx.drawImage(img, b[0], b[1], b[2] - b[0], b[3] - b[1]);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.strokeStyle = "rgba(120,120,120,0.6)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
  ctx.restore();
}

/** Loaded bitmap icons, keyed by resolved path. */
export const imageCache = new Map<string, HTMLImageElement>();

/* ------------------------------------------------------------------ */
/* Component + diagram drawing                                         */
/* ------------------------------------------------------------------ */

export interface DrawOptions {
  /**
   * Diagnostic: receives the drawn symbol's device-pixel box and the instance's
   * hit box, so a mismatch between the picture and the clickable region can be
   * read directly instead of inferred from a screenshot.
   */
  onGeometry?: (
    id: string,
    drawn: [number, number, number, number],
    hit: [number, number, number, number]
  ) => void;
  /** Render below this on-screen size as a simplified box (level of detail). */
  lodThreshold?: number;
  /** Resolve a class name to its visual definition. */
  lookup: (className: string) => ComponentClass | undefined;
  /** Resolve a `%param` macro for a given instance. */
  resolveParam?: (inst: ComponentInstance, name: string) => string | undefined;
  /** Highlight state for interaction feedback. */
  selection?: Set<string>;
  hovered?: string | null;
  /** When set, draw ports enlarged for wiring. */
  showPorts?: boolean;
  /** Diagnostic: draw a dot at the centre using the symbol's own transform. */
  showCentre?: boolean;
  /** Palette to draw with. Resolved from the document when omitted. */
  theme?: Theme;
}

/**
 * Draw one instance of a component.
 *
 * Uses the class's Icon layer; when it has none (common for partial classes and
 * for `Flange`, which genuinely has no icon) a labelled placeholder box is
 * drawn so the diagram stays legible.
 */
export function drawComponent(
  ctx: CanvasRenderingContext2D,
  inst: ComponentInstance,
  classDef: ComponentClass | undefined,
  vp: Viewport,
  dpr: number,
  opts: DrawOptions
): void {
  const t = mul(viewportTransform(vp, dpr), placementTransform(inst));
  const vt = viewportTransform(vp, dpr);
  // Two different boxes, deliberately:
  //   `eb` — the extent, used for the level-of-detail chip.
  //   `vb` — the DRAWN artwork's box, used to place the instance label so it
  //          sits against the symbol rather than against the empty margin of
  //          the canonical box.
  const [ex1, ey1, ex2, ey2] = instanceBounds(inst);
  const eb = transformedBounds(vt, ex1, ey1, ex2, ey2);
  const vb = transformedBounds(vt, ...instanceOutlineBounds(inst, classDef));
  const onScreenSize = Math.max(eb[2] - eb[0], eb[3] - eb[1]);

  const theme = opts.theme ?? currentTheme();

  ctx.save();
  // Every coordinate this function produces — icon geometry, port stubs, the
  // label, the selection box — is already transformed to DEVICE pixels by `t`
  // (which includes the device pixel ratio via `viewportTransform`). The context
  // must therefore be IDENTITY, not `dpr`: leaving `dpr` in place scaled those
  // device coordinates a second time, so the symbols were rendered at 1.25x the
  // size and offset of the boxes computed for interaction. That is the
  // misalignment: graphics and hit testing disagreed by exactly the device ratio.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const threshold = opts.lodThreshold ?? 6;
  if (onScreenSize < threshold) {
    // Level of detail: too small to read, draw a flat chip.
    ctx.fillStyle = theme.chip;
    ctx.fillRect(vb[0], vb[1], Math.max(1, vb[2] - vb[0]), Math.max(1, vb[3] - vb[1]));
    ctx.restore();
    return;
  }

  // On-screen size of one canonical unit for this icon; stroke weights are
  // derived from it so they stay a constant pixel weight at any zoom.
  const totalScale = Math.hypot(t.a, t.b);

  // Below this on-screen size the symbol's own labels are dropped: MSL puts
  // them outside the body (often around -150..150 canonical), so a small icon's
  // text lands on top of its neighbours.
  const showLabels = onScreenSize >= 36;

  // Ink bounds, in device pixels, accumulated as the symbol is plotted.
  let inkMinX = Infinity, inkMinY = Infinity, inkMaxX = -Infinity, inkMaxY = -Infinity;
  const inkMin: [number, number] = [0, 0];
  const inkMax: [number, number] = [0, 0];

  const icon = classDef?.icon ?? [];
  if (icon.length > 0 && classDef?.portPositions) {
    const art = iconArtworkBounds(classDef);
    // Only stub ports that are actually declared; an undeclared position would
    // draw a line to nowhere.
    const declared: Record<string, [number, number]> = {};
    for (const p of classDef.ports) {
      const pos = classDef.portPositions[p.name];
      if (pos) declared[p.name] = pos;
    }
    if (art && Object.keys(declared).length > 0) {
      const lead =
        icon.find((g) => g.kind === "Line") ??
        icon.find((g) => isGraphicVisible(g)) ??
        icon[0];
      drawPortStubs(ctx, lead, t, totalScale, art, declared, theme);
    }
  }

  if (icon.length === 0) {
    drawPlaceholder(ctx, vb, classDef?.shortName ?? inst.className.split(".").pop() ?? inst.id, theme);
  } else {
    for (const g of icon) {
      // Skip the zoom-scaling parametric readouts so the drawn symbol and the
      // clickable symbol are the same shape.
      if (g.kind === "Text" && (!showLabels || !isInBoxLabel(g))) continue;
      const resolved =
        g.kind === "Text" && opts.resolveParam
          ? { ...g, textString: substituteMacros(g.textString ?? "", g, (n) => opts.resolveParam!(inst, n)) }
          : g;
      drawGraphic(ctx, resolved, t, totalScale, theme);
    }
  }

  // Selection / hover affordance.
  const selected = opts.selection?.has(inst.id);
  if (selected || opts.hovered === inst.id) {
    // Outline the clickable box so the highlight matches what actually responds.
    const hb = transformedBounds(
      viewportTransform(vp, dpr),
      ...instanceOutlineBounds(inst, classDef)
    );
    ctx.strokeStyle = selected ? theme.selection : theme.wireHover;
    ctx.lineWidth = selected ? 2 : 1.5;
    ctx.setLineDash(selected ? [] : [4, 3]);
    ctx.strokeRect(hb[0] - 2, hb[1] - 2, hb[2] - hb[0] + 4, hb[3] - hb[1] + 4);
    ctx.setLineDash([]);
  }

  if (opts.showCentre) {
    // Diagnostic: report where the renderer drew this symbol, in device pixels,
    // and where the hit box is. Printed next to the component so the two can be
    // compared without inferring anything from a screenshot.
    const [cxDev, cyDev] = apply(t, 0, 0);
    const hb = transformedBounds(vt, ...instanceHitBounds(inst, classDef));
    const ex = inst.placement.extent;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = theme.selection;
    ctx.beginPath();
    ctx.arc(cxDev, cyDev, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.diagText;
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(
      `${inst.id} ext[${ex.map((v) => Math.round(v)).join(",")}] ` +
        `draw(${cxDev.toFixed(0)},${cyDev.toFixed(0)}) ` +
        `hit(${((hb[0] + hb[2]) / 2).toFixed(0)},${((hb[1] + hb[3]) / 2).toFixed(0)})`,
      cxDev + 8,
      cyDev
    );
    ctx.restore();
  }

  // Instance name, below the symbol.
  //
  // `vb` is in SCREEN pixels, but the canvas transform (viewport + placement) is
  // still active here, so drawing at `vb[3] + 3` treated a screen coordinate as
  // a diagram coordinate: the offset was multiplied by the zoom, pushing the
  // label further below the symbol the further in you zoomed. The transform is
  // therefore reset for the label, which is screen-space furniture.
  if (onScreenSize > 14) {
    ctx.save();
    // `vb` comes from `transformedBounds(viewportTransform(vp, dpr), ...)`, so it
    // is already in DEVICE pixels. The transform must therefore be IDENTITY:
    // applying `dpr` here scaled those coordinates a second time, pushing the
    // label (dpr - 1) x its position away from the origin — an offset that grew
    // with zoom and with distance, exactly how the misaimed selection presented.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${Math.max(9, Math.min(13, onScreenSize / 6))}px sans-serif`;
    ctx.fillStyle = theme.label;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    // Just below the drawn symbol, not below the canonical box: a Resistor
    // draws only the middle band of its box, so anchoring to the box would
    // float the name far below the thing it names.
    ctx.fillText(inst.id, (vb[0] + vb[2]) / 2, vb[3] + 3);
    ctx.restore();
  }

  if (opts.onGeometry) {
    // Gather what was actually plotted for this component.
    const hb = transformedBounds(vt, ...instanceHitBounds(inst, classDef));
    opts.onGeometry(
      inst.id,
      [inkMin[0], inkMin[1], inkMax[0], inkMax[1]],
      [hb[0], hb[1], hb[2], hb[3]]
    );
  }

  ctx.restore();
}

function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  vb: [number, number, number, number],
  label: string,
  theme: Theme
): void {
  ctx.save();
  ctx.fillStyle = theme.placeholderFill;
  ctx.fillRect(vb[0], vb[1], vb[2] - vb[0], vb[3] - vb[1]);
  ctx.strokeStyle = theme.placeholderStroke;
  ctx.lineWidth = 1;
  ctx.strokeRect(vb[0], vb[1], vb[2] - vb[0], vb[3] - vb[1]);
  const h = vb[3] - vb[1];
  if (h > 12) {
    ctx.fillStyle = theme.placeholderText;
    ctx.font = `${Math.max(9, Math.min(12, h / 3))}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, (vb[0] + vb[2]) / 2, (vb[1] + vb[3]) / 2);
  }
  ctx.restore();
}


/**
 * Bounding box of an instance in DIAGRAM coordinates.
 *
 * A `Placement`'s extent already states where the component occupies space in
 * the diagram; the placement transform only maps the class's canonical
 * -100..100 icon space into that box. So the extent is the bounds directly —
 * running it back through `placementTransform` would apply the mapping twice
 * and collapse the box to a tiny region near the centre, which is what made
 * components impossible to select.
 *
 * Rotation does move the box's corners, so the corners are transformed when a
 * rotation is present.
 */
export function instanceBounds(inst: ComponentInstance): [number, number, number, number] {
  const [x1, y1, x2, y2] = inst.placement.extent;
  const rot = inst.placement.rotation ?? 0;
  if (!rot) return [x1, y1, x2, y2];

  // The extent already fixes the component's position; rotation turns the box
  // about its own centre. Only the rotation is applied here — sending the
  // corners through `placementTransform` would re-apply the extent scaling.
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rad = (rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotate = (px: number, py: number): [number, number] => {
    const dx = px - cx;
    const dy = py - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  };

  const pts = [rotate(x1, y1), rotate(x2, y1), rotate(x2, y2), rotate(x1, y2)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}


/**
 * Bounding box of a class's drawn artwork, in canonical icon coordinates.
 *
 * The `extent` box and the artwork inside it are NOT the same thing. MSL
 * routinely offsets the drawing within its canonical box — a Resistor's body
 * occupies only the bottom half (`y -100..0`), a Ground only the top
 * (`y 10..90`) — so using the extent as the clickable area puts the target
 * where the symbol is not, and the user has to aim at an edge to hit it.
 *
 * Text is excluded: MSL places parameter labels far outside the body (often
 * around -150..150), and including them would make the target enormous.
 */
export function iconArtworkBounds(classDef: ComponentClass | undefined): [number, number, number, number] | undefined {
  if (!classDef || classDef.icon.length === 0) return undefined;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const eat = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  for (const g of classDef.icon) {
    if (!isGraphicVisible(g)) continue;
    if (g.kind === "Text") continue;
    if ("extent" in g && g.extent) {
      eat(g.extent[0], g.extent[1]);
      eat(g.extent[2], g.extent[3]);
    }
    if ("points" in g && g.points) {
      for (let i = 0; i + 1 < g.points.length; i += 2) eat(g.points[i], g.points[i + 1]);
    }
  }
  if (!Number.isFinite(minX)) return undefined;
  return [minX, minY, maxX, maxY];
}

/**
 * Diagram-space clickable box for an instance.
 *
 * A component's extent IS its box on the diagram, so the whole of it responds to
 * a click. That is deliberate: a target smaller than the visible box — or one
 * shifted off it to follow the artwork — leaves dead zones and makes selection
 * feel unreliable. A class's artwork always fits inside its canonical box, so
 * using the extent can only ever make the target more forgiving, never miss the
 * symbol.
 *
 * `instanceOutlineBounds` is what follows the artwork, for the hover and
 * selection highlight.
 */
/**
 * Diagram-space clickable box for an instance.
 *
 * This is the VISIBLE box — the drawn artwork — plus a small fixed margin, so
 * clicking the symbol always works and clicking clearly outside it never does.
 * Anything larger stops matching what the user sees: a target that is invisible
 * and bigger than the drawing makes selection feel arbitrary.
 *
 * The margin is a fixed number of diagram units, not a fraction of the symbol.
 * A proportional margin grows with the symbol and with zoom, which is what made
 * the error more noticeable the further a component sat from the viewport origin.
 */
export function instanceHitBounds(
  inst: ComponentInstance,
  classDef: ComponentClass | undefined
): [number, number, number, number] {
  if (!classDef || classDef.icon.length === 0) return instanceBounds(inst);

  const [ox1, oy1, ox2, oy2] = instanceOutlineBounds(inst, classDef);
  const m = HIT_MARGIN_UNITS;
  // Grow only symbols that are too small to click comfortably; never pad a
  // symbol that already fills its box.
  const w = ox2 - ox1;
  const h = oy2 - oy1;
  const padX = Math.max(m, MIN_TARGET_UNITS * 0.5 - w / 2);
  const padY = Math.max(m, MIN_TARGET_UNITS * 0.5 - h / 2);
  return [ox1 - padX, oy1 - padY, ox2 + padX, oy2 + padY];
}

/**
 * The outline drawn around a hovered or selected component: the artwork's own
 * box, so the highlight hugs the symbol rather than its empty canonical box.
 */
export function instanceOutlineBounds(
  inst: ComponentInstance,
  classDef: ComponentClass | undefined
): [number, number, number, number] {
  const art = iconArtworkBounds(classDef);
  if (!art) return instanceBounds(inst);
  const [ex1, ey1, ex2, ey2] = inst.placement.extent;
  const sx = (ex2 - ex1) / (2 * ICON_EXTENT);
  const sy = (ey2 - ey1) / (2 * ICON_EXTENT);
  const cx = (ex1 + ex2) / 2;
  const cy = (ey1 + ey2) / 2;
  return [
    cx + sx * art[0],
    cy + sy * art[1],
    cx + sx * art[2],
    cy + sy * art[3],
  ];
}

/**
 * Compute where a port sits in diagram coordinates.
 *
 * A port's position is the centre of the connector instance inside the class's
 * canonical icon box, mapped through the same transform chain as the graphics.
 * This is what makes wires meet the pins exactly, including rotated and
 * mirrored components.
 */
export function portPosition(
  inst: ComponentInstance,
  classDef: ComponentClass | undefined,
  portName: string
): [number, number] | undefined {
  const port = classDef?.ports.find((p) => p.name === portName);
  if (!port) {
    // Fall back to a sensible default so wiring still works for classes whose
    // ports we could not introspect.
    return apply(placementTransform(inst), 0, 0);
  }
  const canonical = classDef?.portPositions?.[portName];
  const local: [number, number] = canonical ?? [0, 0];
  return apply(placementTransform(inst), local[0], local[1]);
}


/* ------------------------------------------------------------------ */
/* Resize handles                                                      */
/* ------------------------------------------------------------------ */

/** The eight resize handles, named by compass direction. */
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const RESIZE_HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Handle positions around a bounding box, in the given coordinate space. */
export function handlePoints(
  b: [number, number, number, number]
): Record<ResizeHandle, [number, number]> {
  const [x1, y1, x2, y2] = b;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return {
    nw: [x1, y1],
    n: [mx, y1],
    ne: [x2, y1],
    e: [x2, my],
    se: [x2, y2],
    s: [mx, y2],
    sw: [x1, y2],
    w: [x1, my],
  };
}

/** CSS cursor for a handle, so the affordance reads correctly. */
export function handleCursor(h: ResizeHandle, rotation = 0): string {
  const base: Record<ResizeHandle, number> = {
    n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315,
  };
  // Rotating the component rotates its handles, so the cursor follows.
  const angle = ((base[h] + rotation) % 360 + 360) % 360;
  const table = ["ns", "nesw", "ew", "nwse"];
  return `${table[Math.round(angle / 45) % 4]}-resize`;
}

/** Hit-test the resize handles of a selected instance, in diagram space. */
/**
 * Hit-test the resize handles of a selected instance.
 *
 * Handles sit on the component's bounding box, and the visible symbol is
 * *inside* that box — so a generous radius made every click near the symbol's
 * edge start a resize, which is why selecting an already-selected component felt
 * broken. Grabbing a handle now requires being in that handle's own zone:
 * within `radius` of its edge or corner, and not deep inside the box.
 *
 * A press anywhere else belongs to the component body, and selects it.
 */
export function hitTestHandle(
  inst: ComponentInstance,
  classDef: ComponentClass | undefined,
  x: number,
  y: number,
  radius: number
): ResizeHandle | undefined {
  const bounds = instanceHitBounds(inst, classDef);
  const pts = handlePoints(bounds);
  const [x1, y1, x2, y2] = bounds;

  // How far inside the box the point is; 0 on the boundary, negative outside.
  const innerX = Math.min(x - x1, x2 - x);
  const innerY = Math.min(y - y1, y2 - y);

  let best: ResizeHandle | undefined;
  let bestD = radius;
  for (const h of RESIZE_HANDLES) {
    const [hx, hy] = pts[h];
    const d = Math.hypot(hx - x, hy - y);
    if (d >= bestD) continue;

    // Corner handles: reachable from any direction, since a corner is a point.
    const isCorner = h.length === 2;
    if (!isCorner) {
      // Edge handles: only along their own edge, and only from outside or right
      // on the line. A press deeper in the box is a body press.
      const horizontal = h === "n" || h === "s";
      const alongEdge = horizontal
        ? Math.abs(x - (h === "n" || h === "s" ? (x1 + x2) / 2 : 0)) <= (x2 - x1) / 2 + radius &&
          Math.abs(y - hy) <= radius
        : Math.abs(y - (y1 + y2) / 2) <= (y2 - y1) / 2 + radius && Math.abs(x - hx) <= radius;
      const notInside =
        horizontal ? innerY <= radius : innerX <= radius;
      if (!alongEdge || !notInside) continue;
    } else {
      // Corners stay outside the body's interior.
      if (innerX > radius && innerY > radius) continue;
    }

    bestD = d;
    best = h;
  }
  return best;
}

/** Draw the resize handles for a selected instance. */
export function drawHandles(
  ctx: CanvasRenderingContext2D,
  inst: ComponentInstance,
  classDef: ComponentClass | undefined,
  vp: Viewport,
  dpr: number,
  active?: ResizeHandle,
  theme: Theme = currentTheme()
): void {
  const vt = viewportTransform(vp, dpr);
  // Handles must sit on the box the outline draws. Using a different box for
  // the two made the handles float well outside the symbol — the outline hugged
  // the artwork while the handles used the component's extent, which for a
  // Ground is 40 units around a 24-unit symbol.
  const b = transformedBounds(vt, ...instanceOutlineBounds(inst, classDef));
  const pts = handlePoints(b);
  // Handles are drawn in screen space so they stay a constant, clickable size.
  const size = 7;

  for (const h of RESIZE_HANDLES) {
    const [hx, hy] = pts[h];
    ctx.save();
    // `b` comes from `transformedBounds(vt, ...)`, so it is DEVICE pixels; the
    // context must be identity. Inheriting `dpr` from `draw()` scaled the
    // handles a second time and they no longer sat on the selection box.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = active === h ? theme.selection : theme.handleFill;
    ctx.strokeStyle = theme.handleStroke;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(hx - size / 2, hy - size / 2, size, size);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Apply a resize drag to an extent, keeping the opposite edge fixed.
 * `minSize` prevents collapsing a component to nothing.
 */
export function resizeExtent(
  extent: [number, number, number, number],
  handle: ResizeHandle,
  x: number,
  y: number,
  minSize = 6,
  snap = 0
): [number, number, number, number] {
  const s = (v: number) => (snap > 0 ? Math.round(v / snap) * snap : v);
  let [x1, y1, x2, y2] = extent;
  const px = s(x);
  const py = s(y);

  if (handle.includes("w")) x1 = Math.min(px, x2 - minSize);
  if (handle.includes("e")) x2 = Math.max(px, x1 + minSize);
  if (handle.includes("n")) y1 = Math.min(py, y2 - minSize);
  if (handle.includes("s")) y2 = Math.max(py, y1 + minSize);

  // Normalise in case a drag inverted the box.
  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 < y1) [y1, y2] = [y2, y1];
  return [x1, y1, x2, y2];
}

/**
 * Wire stroke width, in screen pixels.
 *
 * Wires are drawn inside the viewport transform, so a `lineWidth` expressed in
 * diagram units is scaled by the zoom a second time. That made a wire grow
 * quadratically with zoom — thinner than the symbol when zoomed out, and many
 * times thicker when zoomed in, so wires and components never looked like they
 * belonged to the same drawing. Dividing by the scale keeps the stroke a
 * constant on-screen weight, which is what a schematic needs.
 */
export const WIRE_WIDTH_PX = 2.2;
/**
 * Wire weight floor, in screen pixels. A wire that thins away when zoomed out
 * is worse than one that is slightly heavy, so it never drops below this.
 */
export const MIN_WIRE_WIDTH_PX = 1.2;
/** Wire weight cap, so a wire never becomes a slab when zoomed far in. */
export const MAX_WIRE_WIDTH_PX = 8;

/**
 * On-screen width of a standard component, in pixels, at a given zoom.
 * All stroke weights are derived from this so wires, outlines and labels keep
 * a fixed relationship to the symbol at every zoom level.
 */
export function componentPx(zoom: number): number {
  return MSL_COMPONENT_SIZE * Math.max(zoom, 1e-6);
}

/**
 * Wire stroke weight in screen pixels.
 *
 * Chosen as a fixed fraction of the component's on-screen size — about 5% —
 * so a wire always reads as slightly heavier than a symbol outline without
 * ever overwhelming it. Clamped at both ends for legibility.
 */
export function wireWidthPx(zoom: number): number {
  const c = componentPx(zoom);
  return Math.max(MIN_WIRE_WIDTH_PX, Math.min(MAX_WIRE_WIDTH_PX, c * 0.055));
}

/**
 * Nominal on-diagram size of a standard MSL component, in diagram units.
 *
 * MSL's own example diagrams lay components out on a 20-unit *grid*, but a
 * symbol occupies a 40-unit box. 40 units renders as 40 px at 1:1 zoom, which is
 * large enough to click comfortably and to read the symbol's own outline.
 */
export const MSL_COMPONENT_SIZE = 40;

/** Draw a connection as an orthogonal-ish polyline through its waypoints. */
export function drawConnection(
  ctx: CanvasRenderingContext2D,
  conn: Connection,
  points: number[],
  vp: Viewport,
  dpr: number,
  opts: { selected?: boolean; width?: number; theme?: Theme } = {}
): void {
  const theme = opts.theme ?? currentTheme();
  if (points.length < 4) return;
  const vt = viewportTransform(vp, dpr);
  // Scale factor the transform already applies; undo it for a fixed weight.
  const scale = Math.hypot(vt.a, vt.b) || 1;
  // Follow the zoom so the wire stays proportional to the symbols.
  const basePx = opts.width ?? wireWidthPx(scale);

  ctx.save();
  // The points below are already in DEVICE pixels (via `vt`, which includes the
  // device pixel ratio), so the context must be identity. Leaving the canvas
  // transform in place scaled them by `dpr` a second time, which put every wire
  // at a different place from the symbols it connects.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = conn.color ? rgb(themedColor(conn.color, theme, "stroke")) : rgb(theme.wire);
  ctx.lineWidth = (opts.selected ? basePx + 1.5 : basePx) / scale;
  // Round joins and caps: a butt cap leaves a visible nick where a wire meets
  // a pin, which is what made the runs look discontinuous.
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (opts.selected) ctx.strokeStyle = theme.wireSelected;

  ctx.beginPath();
  for (let i = 0; i + 1 < points.length; i += 2) {
    const [x, y] = apply(vt, points[i], points[i + 1]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Route a wire between two points.
 *
 * Modelica stores connection waypoints explicitly in the `Line` annotation, so
 * the editor produces a simple, predictable route that the user can refine;
 * we prefer an L-shaped path with a horizontal exit from each port, which is
 * what MSL diagrams conventionally show.
 */
export function routeConnection(
  a: [number, number],
  b: [number, number],
  existing: number[] = []
): number[] {
  if (existing.length >= 4) return existing;
  const [ax, ay] = a;
  const [bx, by] = b;
  const midX = (ax + bx) / 2;
  // Straight line when the ports already line up.
  if (Math.abs(ay - by) < 1e-6) return [ax, ay, bx, by];
  if (Math.abs(ax - bx) < 1e-6) return [ax, ay, bx, by];
  return [ax, ay, midX, ay, midX, by, bx, by];
}

/** Bounding box of a whole diagram, for "zoom to fit". */
export function diagramBounds(model: DiagramModel): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of model.components) {
    const [x1, y1, x2, y2] = c.placement.extent;
    minX = Math.min(minX, x1, x2);
    maxX = Math.max(maxX, x1, x2);
    minY = Math.min(minY, y1, y2);
    maxY = Math.max(maxY, y1, y2);
  }
  for (const cn of model.connections) {
    for (let i = 0; i + 1 < cn.points.length; i += 2) {
      minX = Math.min(minX, cn.points[i]);
      maxX = Math.max(maxX, cn.points[i]);
      minY = Math.min(minY, cn.points[i + 1]);
      maxY = Math.max(maxY, cn.points[i + 1]);
    }
  }
  if (!Number.isFinite(minX)) return [-100, -100, 100, 100];
  const pad = 40;
  return [minX - pad, minY - pad, maxX + pad, maxY + pad];
}

/**
 * Hit test a point against a diagram.
 * Returns the topmost component whose *transformed* bounding box contains the
 * point — testing the transformed box rather than the raw extent is what makes
 * rotated components selectable where they actually appear.
 */
export function hitTestComponent(
  model: DiagramModel,
  lookup: (className: string) => ComponentClass | undefined,
  x: number,
  y: number,
  slack = 0
): ComponentInstance | undefined {
  // Iterate backwards so the topmost (last drawn) component wins.
  for (let i = model.components.length - 1; i >= 0; i--) {
    const inst = model.components[i];
    const [bx1, by1, bx2, by2] = instanceHitBounds(inst, lookup(inst.className));
    if (x >= bx1 - slack && x <= bx2 + slack && y >= by1 - slack && y <= by2 + slack) {
      return inst;
    }
  }
  return undefined;
}

/** Find the port nearest to a diagram-space point, within `radius`. */
export interface PortHit {
  component: string;
  port: string;
  pos: [number, number];
  /**
   * Distance from the pointer to the pin, in diagram units.
   *
   * Callers use this to decide whether the press was aimed at the pin or at the
   * symbol: a pin sits on the component's edge, so a press on it is also a press
   * on the body, and only proximity distinguishes the two intents.
   */
  distance: number;
  /** True when the pin lies inside the component's box. */
  withinBody: boolean;
}

export function findPortAt(
  model: DiagramModel,
  lookup: (className: string) => ComponentClass | undefined,
  x: number,
  y: number,
  radius: number
): PortHit | undefined {
  let best: PortHit | undefined;
  let bestD = radius;

  for (const inst of model.components) {
    const def = lookup(inst.className);
    if (!def) continue;
    const e = instanceBounds(inst);
    for (const p of def.ports) {
      const pos = portPosition(inst, def, p.name);
      if (!pos) continue;
      const d = Math.hypot(pos[0] - x, pos[1] - y);
      if (d < bestD) {
        bestD = d;
        best = {
          component: inst.id,
          port: p.name,
          pos,
          distance: d,
          withinBody: pos[0] >= e[0] && pos[0] <= e[2] && pos[1] >= e[1] && pos[1] <= e[3],
        };
      }
    }
  }
  return best;
}

/** Draw all ports of a component, used while wiring. */
/**
 * Draw a component's connectors.
 *
 * Ports are always drawn, not only on hover. Hiding them until hover made
 * wiring undiscoverable — you had to already know a pin was there and sweep the
 * pointer over it. A faint ring at rest keeps the diagram readable while
 * showing where wires may attach; hover, selection and wiring then emphasise the
 * relevant pins.
 *
 * Rings are sized in screen pixels so they stay a constant, clickable-looking
 * size at any zoom, and are hidden when a component is too small on screen for
 * them to mean anything.
 */
export function drawPorts(
  ctx: CanvasRenderingContext2D,
  inst: ComponentInstance,
  classDef: ComponentClass | undefined,
  vp: Viewport,
  dpr: number,
  highlight?: string,
  opts: { emphasised?: boolean; componentPx?: number; theme?: Theme } = {}
): void {
  const theme = opts.theme ?? currentTheme();
  if (!classDef || classDef.ports.length === 0) return;

  // Below this the rings would overlap the symbol and each other.
  const size = opts.componentPx ?? Number.POSITIVE_INFINITY;
  if (size < 22) return;

  const vt = viewportTransform(vp, dpr);
  const emphasised = opts.emphasised === true;

  for (const p of classDef.ports) {
    const pos = portPosition(inst, classDef, p.name);
    if (!pos) continue;
    const [px, py] = apply(vt, pos[0], pos[1]);
    const isHot = highlight === p.name;

    ctx.save();
    // `apply(vt, ...)` yields DEVICE pixels (`vt` includes the device pixel
    // ratio), and the context must be identity for them to land correctly.
    // Leaving `dpr` in place scaled the rings a second time, which put them off
    // the pins they mark.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.arc(px, py, isHot ? 6 : emphasised ? 4.5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = isHot
      ? theme.pinHot
      : emphasised
        ? theme.pinFill
        : theme.pinFillMuted;
    ctx.fill();
    ctx.strokeStyle = isHot
      ? theme.pinHot
      : emphasised
        ? theme.pinStroke
        : theme.pinStrokeMuted;
    ctx.lineWidth = isHot ? 2 : emphasised ? 1.5 : 1.25;
    ctx.stroke();
    ctx.restore();
  }
}
