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
export function plotLayout(w: number, h: number, showLegend: boolean): PlotLayout {
  const left = w < 340 ? 46 : 56;
  const top = 12;
  const bottom = 30;

  // Reserve legend space only when the plot keeps a usable width either way.
  const legendW = 118;
  const minPlotW = 220;
  const withLegend = showLegend && w - left - legendW - 14 >= minPlotW;
  const right = withLegend ? legendW + 14 : 14;

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
export function layoutForResult(
  w: number,
  h: number,
  result: SimResult,
  styles: Record<string, SeriesStyle> = {}
): PlotLayout {
  return plotLayout(w, h, visibleSeries(result.series, styles).length > 0);
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
  const lay = layoutForResult(width, height, result, styles);
  if (x < lay.left || x > lay.left + lay.width) return undefined;
  return view.xMin + ((x - lay.left) / lay.width) * (view.xMax - view.xMin);
}

/** How many legend rows fit, and whether the legend is drawn at all. */
export function legendPlan(lay: PlotLayout, w: number): { show: boolean; rows: number } {
  const show = w - lay.left - lay.width - 14 >= 100;
  const rows = show ? Math.max(0, Math.floor((lay.height - 10) / 15)) : 0;
  return { show, rows };
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
  const lay = plotLayout(cssWidth, cssHeight, visible.length > 0);

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
  const plan = legendPlan(lay, cssWidth);
  if (visible.length > 0 && plan.show && plan.rows > 0) {
    const lx = lay.left + lay.width + 10;
    let ly = lay.top + 8;
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const shown = visible.slice(0, plan.rows);
    const overflow = visible.length - shown.length;
    const boxH = (shown.length + (overflow > 0 ? 1 : 0)) * 15 + 8;
    ctx.fillStyle = theme.background;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(lx - 4, lay.top + 4, lay.width + lay.right - 8, boxH + 4);
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
      const label = s.name.length > 18 ? "…" + s.name.slice(-17) : s.name;
      ctx.fillText(label, lx + 19, ly);
      ly += 15;
    }
    if (overflow > 0) {
      ctx.fillStyle = theme.foreground;
      ctx.fillText(`+${overflow} more`, lx + 19, ly);
    }
  }

  // Cursor readout
  if (opts.cursorX !== undefined && opts.cursorX >= xMin && opts.cursorX <= xMax) {
    const x = Math.round(sx(opts.cursorX)) + 0.5;
    ctx.strokeStyle = theme.cursor;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, lay.top);
    ctx.lineTo(x, lay.top + lay.height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Nearest sample values, shown in a compact box.
    const lines: string[] = [`t = ${formatTick(opts.cursorX)}`];
    for (const s of visible.slice(0, opts.cursorRows ?? 6)) {
      const v = sampleAt(result.time, s.values, opts.cursorX);
      if (v !== undefined) lines.push(`${s.name} = ${formatTick(v)}`);
    }
    if (lines.length > 1) {
      ctx.font = "11px sans-serif";
      const wBox = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12;
      const hBox = lines.length * 14 + 8;
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
      lines.forEach((l, i) => ctx.fillText(l, bx + 6, by + 5 + i * 14));
    }
  }

  ctx.restore();
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
