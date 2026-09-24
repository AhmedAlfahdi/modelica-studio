/**
 * Lightweight canvas plot for simulation results.
 *
 * Written rather than pulled from a charting library on purpose: the plugin
 * bundles to a single `main.js`, so every dependency is paid for on each
 * update, and the requirement here is narrow (multiple time series, zoom, a
 * cursor readout). A few hundred lines of Canvas2D is far cheaper than 100 KB+
 * of general-purpose charting code.
 */

import type { SimResult, SimSeries } from "../omc/backend";
import { planAxes, type AxisPlan } from "./axes";

export interface SeriesStyle {
  color: string;
  visible: boolean;
  /** Drawn dashed: a run kept for comparison rather than the one on screen. */
  dashed?: boolean;
}

export interface PlotTheme {
  background: string;
  foreground: string;
  grid: string;
  axis: string;
  cursor: string;
}

/**
 * How near, in pixels, the cursor has to come to a crossing before it snaps.
 *
 * Pixels rather than seconds because that is the distance the person aiming is
 * judging: a hundredth of the time axis is seven pixels at one zoom level and
 * seventy at another, so a tolerance in seconds means a different magnet every
 * time the view changes. The settings slider is what a user sets; this is the
 * fallback when nothing is passed, and a test holds the two together.
 */
export const SNAP_TOLERANCE_PX = 7;

/** Bounds for the snap distance, so a stray stored value cannot wreck the cursor. */
export const MIN_SNAP_TOLERANCE_PX = 1;
export const MAX_SNAP_TOLERANCE_PX = 40;

/**
 * The snap distance to actually use, from whatever was configured.
 *
 * A window wider than the plot would make the cursor jump to a crossing the
 * pointer is nowhere near, and a value that is not a number at all (an older
 * data.json, a hand-edited one) must not disable the snap by accident.
 */
export function snapTolerancePx(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return SNAP_TOLERANCE_PX;
  return Math.min(MAX_SNAP_TOLERANCE_PX, Math.max(MIN_SNAP_TOLERANCE_PX, value));
}

export const DEFAULT_THEME: PlotTheme = {
  background: "rgb(252,252,254)",
  foreground: "rgb(40,44,52)",
  grid: "rgba(120,130,150,0.18)",
  axis: "rgba(90,100,120,0.7)",
  cursor: "rgba(200,80,80,0.85)",
};

/**
 * Plot palette for the dark theme.
 *
 * The plot is drawn with the 2D canvas API, which cannot read CSS variables, so
 * the colours have to be supplied. Without this the plot stayed light while the
 * rest of Obsidian was dark.
 */
export const DARK_THEME: PlotTheme = {
  background: "rgb(30,33,39)",
  foreground: "rgb(214,219,228)",
  grid: "rgba(150,165,190,0.14)",
  axis: "rgba(170,180,200,0.65)",
  cursor: "rgba(240,130,130,0.85)",
};

/** The plot palette for the theme in effect. */
export function plotThemeFrom(theme: { dark: boolean }): PlotTheme {
  return theme.dark ? DARK_THEME : DEFAULT_THEME;
}

/**
 * A stable colour per series index.
 * Uses a golden-angle hue rotation so any number of series stays distinguishable.
 */
export function seriesColor(i: number, dark = false): string {
  const hue = (i * 137.508) % 360;
  const sat = 62;
  const light = dark ? 62 : 44;
  return `hsl(${hue.toFixed(0)},${sat}%,${light}%)`;
}

/** Nice-looking axis ticks covering [min, max]. */
export function niceTicks(min: number, max: number, target = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const span = max - min;
  const rawStep = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) {
    // Round to avoid 0.30000000000000004-style labels.
    out.push(Number(v.toFixed(12)));
  }
  return out;
}

/** Format a number compactly for axis labels. */
export function formatTick(v: number): string {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(1);
  const s = Number(v.toPrecision(4));
  return String(s);
}

export interface PlotView {
  /** Visible x range. */
  xMin: number;
  xMax: number;
  /** When set, the y range is fixed; otherwise it auto-fits visible data. */
  yMin?: number;
  yMax?: number;
}

export interface PlotLayout {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Space allocation for the plot.
 *
 * The plot lives in a side panel, so width is scarce. The legend is only shown
 * when there is genuinely room for it — otherwise the named, colour-coded
 * series toggles above the plot already serve that purpose, and stealing 120px
 * from a 380px panel would leave an unreadable sliver.
 */
export function plotLayout(
  w: number,
  h: number,
  showLegend: boolean,
  axisLabelW = 0
): PlotLayout {
  const left = w < 340 ? 46 : 56;
  const top = 12;
  const bottom = 30;

  // Reserve legend space only when the plot keeps a usable width either way.
  const legendW = 118;
  const minPlotW = 220;
  const withLegend = showLegend && w - left - legendW - 14 >= minPlotW;
  // The second axis labels its ticks in this margin, so its column is reserved
  // whether or not there is a legend: without the reservation a narrow pane cut
  // the values off at the edge of the canvas.
  const right = 14 + axisLabelW + (withLegend ? legendW : 0);

  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(10, w - left - right),
    height: Math.max(10, h - top - bottom),
  };
}

/**
 * The width the extra value axes need for their tick labels.
 *
 * Estimated from the tick strings rather than measured, because the LAYOUT has to
 * reserve it and the layout is a pure function — the drawing then uses the same
 * number, so the pixels and the pointer-to-time mapping cannot disagree. Two
 * characters of slack, because zooming into a narrow range can produce a longer
 * label than the full range does (`1.1e+5` against `1.15e+5`), and a value cut off
 * at the edge of a plot is worse than an unused pixel.
 */
export function axisLabelColumnW(plans: { min: number; max: number }[]): number {
  if (plans.length < 2) return 0;
  let chars = 0;
  for (const plan of plans.slice(1)) {
    const span = plan.max - plan.min;
    for (const v of niceTicks(plan.min, plan.max, span === 0 ? 2 : 5)) {
      chars = Math.max(chars, formatTick(v).length);
    }
  }
  return chars === 0 ? 0 : Math.ceil((chars + 2) * CHAR_W) + 12;
}

/** Width of a character at the axis font size, for the estimate above. */
const CHAR_W = 6.2;

/**
 * The traces a plot will actually draw, given the per-trace styles.
 *
 * Exported because the layout depends on whether the legend is drawn, and the
 * pointer-to-time mapping has to use the SAME layout the pixels were drawn with.
 */
export function visibleSeries(
  series: SimSeries[],
  styles: Record<string, SeriesStyle> = {}
): SimSeries[] {
  return series.filter((s) => styles[s.name]?.visible !== false);
}

/**
 * The layout `drawPlot` will use for a result.
 *
 * One rule in one place. The Studio used to map the pointer to a time with its
 * own margins -- left 62 rather than 56, top 14 rather than 12, a different
 * legend allowance -- so the time under the crosshair disagreed with the axis it
 * was pointing at, and by more the narrower the pane.
 */
/**
 * The time range to draw, never degenerate.
 *
 * A zero-width window is possible and is not an error the compiler reports: with
 * start >= stop OpenModelica returns a valid two-sample result whose time is
 * [5, 5]. Dividing by that range made every coordinate non-finite, and the canvas
 * silently drops non-finite paths and labels -- so the plot was blank, with no x
 * ticks and no readout, while the status line reported "2 samples" as a success.
 * Widening it by a hair keeps the one real point on screen and the axis honest
 * about there being nothing either side of it.
 */
export function plotTimeRange(
  result: SimResult,
  view?: { xMin: number; xMax: number }
): { xMin: number; xMax: number } {
  const xMin = view?.xMin ?? result.time[0] ?? 0;
  const rawMax = view?.xMax ?? result.time[result.time.length - 1] ?? 1;
  return { xMin, xMax: rawMax > xMin ? rawMax : xMin + Math.max(1e-9, Math.abs(xMin) * 1e-6) };
}

export function layoutForResult(
  w: number,
  h: number,
  result: SimResult,
  styles: Record<string, SeriesStyle> = {},
  /** The x-range drawn, when the plot is zoomed; the full range otherwise. */
  view?: { xMin: number; xMax: number }
): PlotLayout {
  const visible = visibleSeries(result.series, styles);
  const { xMin, xMax } = plotTimeRange(result, view);
  const plans = planAxes(
    visible.map((s) => {
      const [a, b] = seriesExtent(result.time, s, xMin, xMax);
      return { name: s.name, min: a, max: b };
    })
  );
  return plotLayout(w, h, visible.length > 0, axisLabelColumnW(plans));
}

/**
 * The time under a pointer at canvas x, or undefined when it is off the axes.
 *
 * The inverse of the mapping `drawPlot` used to place the pixels, and it lives
 * here so it cannot drift from it. Both surfaces had their own copy of the
 * margins; the Studio's had already drifted (left 62 against the renderer's 56),
 * so the time under its crosshair was not the time at that pixel.
 *
 * `view` is the range actually drawn, which is not always the run's own range:
 * a zoomed plot reads off its visible window.
 */
export function timeAtPlotX(
  x: number,
  width: number,
  height: number,
  result: SimResult,
  styles: Record<string, SeriesStyle> = {},
  view: { xMin: number; xMax: number }
): number | undefined {
  // `view` is passed through: the right margin is reserved from the zoomed window's
  // own tick labels, so a layout computed for the FULL run is a few pixels wider
  // than the one on screen -- and the time shown was not the time under the
  // crosshair. Measured at ~13 px of drift on a two-axis result.
  const lay = layoutForResult(width, height, result, styles, view);
  if (x < lay.left || x > lay.left + lay.width) return undefined;
  return view.xMin + ((x - lay.left) / lay.width) * (view.xMax - view.xMin);
}

/**
 * How many legend rows fit, and whether the legend is drawn at all.
 *
 * `axisLabelW` is the width a second value axis needs for its tick labels, which
 * live in the same margin: the legend is only drawn when there is room for BOTH,
 * because the alternative is what a screenshot showed — the axis values painted
 * over by the legend's surface.
 */
export function legendPlan(
  lay: PlotLayout,
  w: number,
  axisLabelW = 0
): { show: boolean; rows: number } {
  // Beside a second axis the strip is whatever the labels leave, and a legend
  // with its names shortened is worth more than no legend: the alternative is
  // reaching for the series toggles above the plot, which cover the whole pane.
  // Alone it keeps the comfortable threshold, because there the labels are full
  // names and a sliver of them says nothing.
  const minW = axisLabelW > 0 ? MIN_LEGEND_BESIDE_AXIS_W : 100;
  const show = w - lay.left - lay.width - 14 - axisLabelW >= minW;
  const rows = show ? Math.max(0, Math.floor((lay.height - 10) / 15)) : 0;
  return { show, rows };
}

/** Enough for a swatch and a few distinguishing characters of a name. */
const MIN_LEGEND_BESIDE_AXIS_W = 56;

/**
 * A series name shortened to fit the space the legend has.
 *
 * The TAIL is kept — `pipe.port_a.m_flow` against `pipe.port_a.p` differ at the
 * end — and the width is measured rather than counted in characters, because the
 * strip left over beside a second axis is narrow and a character count that fits
 * one font overflows another.
 */
function fitLabel(ctx: CanvasRenderingContext2D, name: string, maxW: number): string {
  if (maxW <= 0) return "";
  if (ctx.measureText(name).width <= maxW) return name;
  let tail = name;
  while (tail.length > 2 && ctx.measureText("…" + tail).width > maxW) {
    tail = tail.slice(1);
  }
  return "…" + tail;
}

/** Min/max of a series over an inclusive x-range. */
export function seriesExtent(
  time: number[],
  s: SimSeries,
  xMin: number,
  xMax: number
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  const n = Math.min(time.length, s.values.length);
  for (let i = 0; i < n; i++) {
    const t = time[i];
    if (t < xMin || t > xMax) continue;
    const v = s.values[i];
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return [0, 1];
  if (lo === hi) {
    // Flat series: give the line some vertical room so it is visible.
    const pad = Math.abs(lo) > 1e-12 ? Math.abs(lo) * 0.1 : 1;
    return [lo - pad, hi + pad];
  }
  const pad = (hi - lo) * 0.06;
  return [lo - pad, hi + pad];
}

export interface DrawPlotOptions {
  styles: Record<string, SeriesStyle>;
  view: PlotView;
  theme?: PlotTheme;
  /** Draw the crosshair readout at this data x position. */
  cursorX?: number;
  /** Traces listed in the cursor readout. The full-screen plot allows more. */
  cursorRows?: number;
  /** Show how far each curve of a family is from the run on screen. */
  showDeltas?: boolean;
  /**
   * Snap the cursor to the instant two curves cross, when one is near.
   *
   * The crossings are what a plot like an RLC response is read FOR — where the
   * capacitor's voltage meets the inductor's current — and picking that instant by
   * eye off a crosshair gives a time that is nearly right. On by default; the snap
   * only applies within `snapTolerancePx` of the crossing, so the cursor is
   * unchanged everywhere else.
   */
  snapIntersections?: boolean;
  /**
   * How near, in pixels, a crossing has to be for the snap to take it.
   *
   * In pixels rather than in seconds on purpose: the plot is zoomed and panned,
   * and what a person is judging is the gap between the crosshair and the
   * crossing on screen. Converted to a window on the time axis here, against the
   * width the lines were actually drawn at.
   */
  snapTolerancePx?: number;
  /**
   * Font scale of the cursor readout.
   *
   * Its own setting, separate from the diagram's parameter popup: a plot is read
   * on its own, often in a pane, and the two have nothing to do with each other.
   * The box, its leading and its padding all follow, or a large font overflows.
   */
  readoutScale?: number;
  /**
   * The label of the run on screen, when a family is drawn.
   *
   * The delta is measured against THAT curve. Naming the current run (so the
   * legend can say `source.V=15`) is what made the deltas vanish: every row
   * carried a label, and the reference had been "the row without one".
   */
  currentLabel?: string;
  /** Device pixel ratio. */
  dpr: number;
  /** Map a series name to an axis unit label. */
  unitOf?: (name: string) => string | undefined;
  /** Surface behind the legend, matched to the plot background. */
  legendBackground?: string;
}

/**
 * Render the plot.
 *
 * Series are drawn as polylines; sample counts here are in the hundreds to low
 * thousands, so a straight path stroke is both simple and fast. Decimation
 * would pay off only past ~100k points, which OpenModelica output does not
 * reach at default settings.
 */
export function drawPlot(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  result: SimResult,
  opts: DrawPlotOptions
): void {
  const theme = opts.theme ?? DEFAULT_THEME;
  const dpr = opts.dpr;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const visible = visibleSeries(result.series, opts.styles);

  if (result.time.length === 0) {
    ctx.fillStyle = theme.foreground;
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No results yet — run a simulation.", cssWidth / 2, cssHeight / 2);
    ctx.restore();
    return;
  }

  const xMin = opts.view.xMin;
  const xMax = opts.view.xMax;

  // Extents of every visible series over the viewport.
  const extents = new Map<string, [number, number]>();
  for (const s of visible) extents.set(s.name, seriesExtent(result.time, s, xMin, xMax));

  /**
   * One axis for everything, or one per magnitude group.
   *
   * Sharing a single axis is correct when the quantities are comparable, and
   * unreadable when they are not: a tank's level moving 2.000 -> 1.978 against
   * an internal energy near 1.6e8 flattens to a straight line. Pinned limits
   * (`view.yMin/yMax`) always win, since the caller has asked for a fixed axis.
   */
  const pinned = opts.view.yMin !== undefined && opts.view.yMax !== undefined;
  const plans: AxisPlan[] = pinned
    ? [
        {
          min: opts.view.yMin as number,
          max: opts.view.yMax as number,
          names: visible.map((s) => s.name),
        },
      ]
    : planAxes(
        visible.map((s) => {
          const [a, b] = extents.get(s.name) ?? [0, 1];
          return { name: s.name, min: a, max: b };
        })
      );

  // A series with no extent (all values equal) would collapse its axis.
  for (const plan of plans) {
    if (plan.min === plan.max) {
      plan.min -= Math.abs(plan.min) * 0.05 + 1;
      plan.max += Math.abs(plan.max) * 0.05 + 1;
    }
  }
  const primary = plans[0] ?? { min: 0, max: 1, names: [] };
  const axisOf = new Map<string, number>();
  // AFTER the plans, because the extra axes label their ticks in the right
  // margin and the layout has to reserve that column. The order matters: laying
  // out first is what cut the values off beside a narrow pane.
  const lay = plotLayout(cssWidth, cssHeight, visible.length > 0, axisLabelColumnW(plans));
  plans.forEach((plan, i) => plan.names.forEach((n: string) => axisOf.set(n, i)));

  (globalThis as { __PLOT_AXES__?: (m: string) => void }).__PLOT_AXES__?.(
    plans.map((p, i) => `axis${i + 1}=${p.min.toPrecision(4)}..${p.max.toPrecision(4)}(${p.names.length})`).join(" ")
  );

  const sx = (t: number) => lay.left + ((t - xMin) / (xMax - xMin)) * lay.width;
  const scaleFor = (name: string) => {
    const plan = plans[axisOf.get(name) ?? 0] ?? primary;
    return (v: number) =>
      lay.top + lay.height - ((v - plan.min) / (plan.max - plan.min)) * lay.height;
  };

  // Grid + axis labels
  ctx.font = "11px sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";

  const yTicks = niceTicks(primary.min, primary.max, 6);
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  const primaryY = (v: number) =>
    lay.top + lay.height - ((v - primary.min) / (primary.max - primary.min)) * lay.height;
  for (const v of yTicks) {
    const y = Math.round(primaryY(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(lay.left, y);
    ctx.lineTo(lay.left + lay.width, y);
    ctx.stroke();
    ctx.fillStyle = theme.foreground;
    ctx.fillText(formatTick(v), lay.left - 8, y);
  }

  const xTicks = niceTicks(xMin, xMax, 6);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const t of xTicks) {
    const x = Math.round(sx(t)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, lay.top);
    ctx.lineTo(x, lay.top + lay.height);
    ctx.stroke();
    ctx.fillStyle = theme.foreground;
    ctx.fillText(formatTick(t), x, lay.top + lay.height + 8);
  }

  // Axis lines
  ctx.strokeStyle = theme.axis;
  ctx.strokeRect(lay.left + 0.5, lay.top + 0.5, lay.width, lay.height);

  // A second axis, labelled down the right edge and tinted to match the traces
  // it scales. Without it the grouped traces have no readable scale: the grid
  // belongs to the first group, and the second would be an unexplained shape.
  if (plans.length > 1) {
    ctx.font = "11px sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (let i = 1; i < plans.length; i++) {
      const plan = plans[i];
      // The colour of the first series on this axis identifies it.
      const sample = visible.find((v) => axisOf.get(v.name) === i);
      const colour = sample ? (opts.styles[sample.name]?.color ?? theme.foreground) : theme.foreground;
      const x0 = lay.left + lay.width;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0 + 0.5, lay.top);
      ctx.lineTo(x0 + 0.5, lay.top + lay.height);
      ctx.stroke();
      ctx.fillStyle = colour;
      const span = plan.max - plan.min;
      for (const v of niceTicks(plan.min, plan.max, span === 0 ? 2 : 5)) {
        const y = Math.round(
          lay.top + lay.height - ((v - plan.min) / (span || 1)) * lay.height
        ) + 0.5;
        if (y < lay.top || y > lay.top + lay.height) continue;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x0 + 4, y);
        ctx.stroke();
        ctx.fillText(formatTick(v), x0 + 7, y);
      }
    }
  }

  // Series
  ctx.save();
  ctx.beginPath();
  ctx.rect(lay.left, lay.top, lay.width, lay.height);
  ctx.clip();
  const unitLabel = opts.unitOf?.(visible[0]?.name ?? "");
  void unitLabel;

  visible.forEach((s, i) => {
    const style = opts.styles[s.name];
    ctx.strokeStyle = style?.color ?? seriesColor(result.series.indexOf(s));
    ctx.lineWidth = 1.6;
    // A family member is drawn dashed: same axes, and unmistakably not the run
    // being looked at.
    ctx.setLineDash(style?.dashed ? [5, 4] : []);
    ctx.lineJoin = "round";
    ctx.beginPath();
    let started = false;
    const n = Math.min(result.time.length, s.values.length);
    for (let k = 0; k < n; k++) {
      const t = result.time[k];
      const v = s.values[k];
      if (!Number.isFinite(v)) {
        started = false;
        continue;
      }
      if (t < xMin || t > xMax) {
        // Keep the path continuous across the viewport edge by not breaking,
        // but skip points that are far outside to save work.
        if (t < xMin - (xMax - xMin) || t > xMax + (xMax - xMin)) {
          started = false;
          continue;
        }
      }
      const x = sx(t);
      const y = scaleFor(s.name)(v);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    void i;
  });
  ctx.restore();

  // Back to solid, so the legend's swatches and the cursor are not dashed by
  // whatever series was drawn last.
  ctx.setLineDash([]);

  // Legend, only when the panel is wide enough to spare the room.
  //
  // A second axis labels its ticks in the same margin the legend wants — the
  // labels are drawn from the frame outwards — so the column is measured first
  // and the legend starts after it. Reported from a screenshot: the y values were
  // painted over by the legend's surface, which is drawn after them.
  const axisLabelW = axisLabelColumnW(plans);
  const plan = legendPlan(lay, cssWidth, axisLabelW);
  if (visible.length > 0 && plan.show && plan.rows > 0) {
    const lx = lay.left + lay.width + 10 + axisLabelW;
    const stripW = Math.max(0, cssWidth - lx - 4);
    let ly = lay.top + 8;
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const shown = visible.slice(0, plan.rows);
    const overflow = visible.length - shown.length;
    const boxH = (shown.length + (overflow > 0 ? 1 : 0)) * 15 + 8;
    ctx.fillStyle = theme.background;
    ctx.globalAlpha = 0.92;
    // From the legend's own left edge to the edge of the canvas: it used to be
    // `lay.width + lay.right - 8`, which happened to reach the edge only because
    // the legend sat hard against it, and painted over the axis labels when it
    // did not.
    ctx.fillRect(lx - 4, lay.top + 4, stripW + 4, boxH + 4);
    ctx.globalAlpha = 1;

    for (const s of shown) {
      const style = opts.styles[s.name];
      const color = style?.color ?? seriesColor(result.series.indexOf(s));
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.4;
      // The swatch carries the series' OWN line style, or the legend says nothing
      // about which curve is the family and which is the run on screen — which is
      // the entire reason the family is dashed.
      ctx.setLineDash(style?.dashed ? [5, 4] : []);
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + 14, ly);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = theme.foreground;
      ctx.fillText(fitLabel(ctx, s.name, stripW - 19 - 4), lx + 19, ly);
      ly += 15;
    }
    if (overflow > 0) {
      ctx.fillStyle = theme.foreground;
      ctx.fillText(`+${overflow} more`, lx + 19, ly);
    }
  }

  // Cursor readout
  if (opts.cursorX !== undefined && opts.cursorX >= xMin && opts.cursorX <= xMax) {
    let cursorAt = opts.cursorX;
    let snappedToCrossing = false;
    if (opts.snapIntersections !== false && visible.length > 1 && lay.width > 1) {
      // In the space the lines are DRAWN in — pixels — and not in their values.
      // `capacitor.v` and `inductor.i` are two magnitudes and get two y-axes, so
      // their values are never equal while the lines cross plainly on screen: the
      // snap searched for an equality that could not happen and never fired.
      const drawn = visible.map((s) =>
        s.values.map((v) => (Number.isFinite(v) ? scaleFor(s.name)(v) : Number.NaN))
      );
      // The tolerance is a distance on screen, so it is turned into a window on
      // the time axis with the width the axes were drawn at. Seven pixels by
      // default — a magnet, not a move.
      const window =
        (snapTolerancePx(opts.snapTolerancePx) / lay.width) * (xMax - xMin);
      const crossing = nearestCrossing(result.time, drawn, cursorAt, window);
      if (crossing !== undefined) {
        cursorAt = crossing;
        snappedToCrossing = true;
      }
    }
    const x = Math.round(sx(cursorAt)) + 0.5;
    ctx.strokeStyle = theme.cursor;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, lay.top);
    ctx.lineTo(x, lay.top + lay.height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Nearest sample values, shown in a compact box.
    const lines: string[] = [
      `t = ${formatTick(cursorAt)}${snappedToCrossing ? "  (crossing)" : ""}`,
    ];
    const readoff: Array<{ base: string; label: string; value: number }> = [];
    for (const s of visible.slice(0, opts.cursorRows ?? 6)) {
      const v = sampleAt(result.time, s.values, cursorAt);
      if (v === undefined) continue;
      lines.push(`${s.name} = ${formatTick(v)}`);
      const split = splitFamilyName(s.name);
      readoff.push({ base: split.base, label: split.label ?? "", value: v });
    }
    // The deltas: what the family is worth at this instant, relative to the run
    // on screen. This is the question a sweep is asked -- "how much does it
    // differ?" -- and reading it off two rows and subtracting in your head is
    // exactly what a plot should do for you.
    if (opts.showDeltas) lines.push(...deltaLines(readoff, opts.currentLabel ?? ""));
    if (lines.length > 1) {
      // The readout's own scale, from the settings. The box is measured from the
      // text, so every part of it uses the same scale: font, leading and padding.
      // The offset from the cursor line stays put — that is spacing on the plot
      // rather than room for the text.
      const scale = Math.max(0.5, Math.min(3, opts.readoutScale ?? 1));
      const lineH = 14 * scale;
      const padX = 6 * scale;
      const padY = 5 * scale;
      ctx.font = `${11 * scale}px sans-serif`;
      const wBox = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 2 * padX;
      const hBox = lines.length * lineH + 2 * padY;
      let bx = x + 10;
      if (bx + wBox > lay.left + lay.width) bx = x - wBox - 10;
      const by = lay.top + 8;
      ctx.fillStyle = opts.legendBackground ?? "rgba(255,255,255,0.94)";
      ctx.strokeStyle = theme.axis;
      ctx.lineWidth = 1;
      ctx.fillRect(bx, by, wBox, hBox);
      ctx.strokeRect(bx + 0.5, by + 0.5, wBox, hBox);
      ctx.fillStyle = theme.foreground;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      lines.forEach((l, i) => ctx.fillText(l, bx + padX, by + padY + i * lineH));
    }
  }

  ctx.restore();
}

/**
 * A series name split into the variable and the run it came from.
 *
 * `capacitor.v · source.V=10` is the ten-volt run of `capacitor.v`; a name with
 * no separator is the run on screen, which is what the family is measured
 * against.
 */
export function splitFamilyName(name: string): { base: string; label: string } {
  const at = name.indexOf(" · ");
  // "" means the run on screen, which is what the family is measured against.
  return at < 0 ? { base: name, label: "" } : { base: name.slice(0, at), label: name.slice(at + 3) };
}

/**
 * One line per family member, saying how far it is from the run on screen.
 *
 * Signed, because the direction is the answer as often as the size: a curve that
 * is above the other and one that is below are different findings. Grouped by
 * variable, so a sweep of a resistor reports a delta for each quantity rather
 * than each curve.
 */
export function deltaLines(
  values: Array<{ base: string; label: string; value: number }>,
  currentLabel = ""
): string[] {
  const groups = new Map<string, Array<{ label: string; value: number }>>();
  for (const v of values) {
    const list = groups.get(v.base) ?? [];
    list.push({ label: v.label, value: v.value });
    groups.set(v.base, list);
  }
  const out: string[] = [];
  for (const [base, list] of groups) {
    const current = list.find((v) => v.label === currentLabel);
    // No run on screen to measure against: nothing to say. This is the state a
    // single run is in, and the state a family is NOT in — it always contains the
    // run on screen, under its own label.
    if (!current) continue;
    for (const other of list) {
      if (other.label === currentLabel) continue;
      const delta = current.value - other.value;
      const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
      out.push(`Δ ${base} vs ${other.label} = ${sign}${formatTick(Math.abs(delta))}`);
    }
  }
  return out;
}

/**
 * The nearest instant at which any two of `lines` cross, within `window` of `t`.
 *
 * A crossing is a sign change between consecutive samples, and the instant is
 * interpolated between them — the samples are a fixed grid, so the crossing is
 * almost never on one. Pairs that touch without crossing count too, since a
 * tangent is a crossing an eye cannot place either.
 */
export function nearestCrossing(
  time: number[],
  lines: number[][],
  t: number,
  window: number
): number | undefined {
  let best: number | undefined;
  for (let i = 0; i + 1 < time.length; i++) {
    for (let a = 0; a < lines.length; a++) {
      for (let b = a + 1; b < lines.length; b++) {
        const d0 = lines[a][i] - lines[b][i];
        const d1 = lines[a][i + 1] - lines[b][i + 1];
        if (!Number.isFinite(d0) || !Number.isFinite(d1)) continue;
        if (d0 !== 0 && d1 !== 0 && d0 * d1 > 0) continue;
        const span = time[i + 1] - time[i];
        const frac = d0 === d1 ? 0 : Math.min(1, Math.max(0, d0 / (d0 - d1)));
        const cross = time[i] + span * frac;
        if (Math.abs(cross - t) > window) continue;
        if (best === undefined || Math.abs(cross - t) < Math.abs(best - t)) best = cross;
      }
    }
  }
  return best;
}

/** Linearly interpolate a series value at time `t`. */
export function sampleAt(time: number[], values: number[], t: number): number | undefined {
  const n = Math.min(time.length, values.length);
  if (n === 0) return undefined;
  if (t <= time[0]) return values[0];
  if (t >= time[n - 1]) return values[n - 1];
  // Binary search for the bracketing samples.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (time[mid] <= t) lo = mid;
    else hi = mid;
  }
  const t0 = time[lo];
  const t1 = time[hi];
  const v0 = values[lo];
  const v1 = values[hi];
  if (!Number.isFinite(v0)) return v1;
  if (!Number.isFinite(v1)) return v0;
  if (t1 === t0) return v0;
  return v0 + ((t - t0) / (t1 - t0)) * (v1 - v0);
}

/** Extract a compact numeric summary of a result for display. */
export function summarize(result: SimResult): string {
  const n = result.time.length;
  if (n === 0) return "no samples";
  const t0 = result.time[0];
  const t1 = result.time[n - 1];
  return `${n} samples · t ∈ [${formatTick(t0)}, ${formatTick(t1)}] · ${result.series.length} variables`;
}
