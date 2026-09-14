/**
 * Choosing which variables to plot by default.
 *
 * A Modelica result contains every variable in the model, in declaration order.
 * Taking the first few therefore shows whatever the library happened to declare
 * first — for a fluid model that is `p`, `T`, `MM`, `R_s`, all of which are
 * constant. The plot then sits flat while the quantities that actually change
 * are hidden, which reads as a broken simulation.
 *
 * The variables worth showing first are the ones that *move*, so selection is
 * made on measured variation rather than on position.
 */

import type { SimResult } from "../omc/backend";

/** One series with its numeric range, when it has one. */
export interface SeriesSummary {
  name: string;
  /** Number of finite samples. */
  count: number;
  min: number;
  max: number;
  /** True when the series takes at least two distinct values. */
  varies: boolean;
  /**
   * A few sampled values, used to recognise two series that are the same
   * quantity. `mass1.s` and `force.s` are equal throughout, and showing both
   * spends two of four slots on one fact.
   */
  signature: number[];
}

/** Sample a series at a handful of points, for duplicate detection. */
function signatureOf(values: number[] | undefined): number[] {
  const v = values ?? [];
  if (v.length === 0) return [];
  const out: number[] = [];
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const idx = Math.min(v.length - 1, Math.round((i / (steps - 1)) * (v.length - 1)));
    out.push(v[idx]);
  }
  return out;
}

/** True when two sampled signatures describe the same values. */
function sameSignature(a: number[], b: number[]): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) return false;
    const scale = Math.max(1, Math.abs(a[i]), Math.abs(b[i]));
    if (Math.abs(a[i] - b[i]) > 1e-9 * scale) return false;
  }
  return true;
}

/** A relative change smaller than this is numerical noise, not behaviour. */
const RELATIVE_TOLERANCE = 1e-9;

/** Summarise each series once; the plots and the picker both need this. */
export function summarizeSeries(result: SimResult): SeriesSummary[] {
  return result.series.map((s) => {
    let min = Infinity;
    let max = -Infinity;
    let count = 0;
    for (const v of s.values ?? []) {
      if (!Number.isFinite(v)) continue;
      count++;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const varies =
      count > 1 && max - min > RELATIVE_TOLERANCE * Math.max(1, Math.abs(max), Math.abs(min));
    return { name: s.name, count, min, max, varies, signature: signatureOf(s.values) };
  });
}

/**
 * Fragments marking a variable as an implementation detail.
 *
 * A fluid pipe exposes dozens of `flowModel.*` internals, and a derivative
 * `der(x)` carries no information the reader does not get from `x`. Both vary,
 * so ranking on magnitude alone surfaced them ahead of the quantities a user
 * actually asked about.
 */
const INTERNAL_MARKERS = [/flowModel/i, /\.medium\.state/i, /\.state\./i, /internal/i];

/** A derivative: informative, but `x` says the same thing more directly. */
const DERIVATIVE = /^der\(/;

/**
 * An auxiliary derivative a library declares for convenience.
 *
 * MSL ships `der_T` alongside `T`; showing both is noise.
 */
const DERIVATIVE_AUX = /\.der_/;

/**
 * Fragments marking a variable that duplicates another.
 *
 * `tank.V` and `tank.fluidVolume` are the same quantity under two names, and a
 * plot showing both spends two of its four slots on one fact. Likewise a port's
 * `Q_flow` and the conductor's `Q_flow` are equal and opposite — the same
 * energy, counted from each end.
 */
const ALIAS_HINTS = [
  /^der\(/,
  /\.der_/,
  // Anchored: an unanchored alternative matched `tank.m`, the tank's mass,
  // because `m` is a prefix of `m_flow`. A penalty that removes a real quantity
  // is worse than the duplicate it was meant to suppress.
  /\.(U|V|fluidVolume)$/,
  /\.(ambient|hot|cold)\.port\./,
  /\.(ambient|hot|cold)\.port$/,
];

/**
 * Names that read as a quantity someone modelling the system would name.
 *
 * A tank's `level`, a body's `T`, a capacitor's `v`: these are what the plot is
 * for. Ranking them up keeps the display about the system rather than about the
 * library's internal decomposition of it.
 */
const SIGNAL_NAMES = /(^|\.)(level|T|v|i|w|a|s|p|m_flow|V_flow|dp|Q_flow|phi|tau|rpm)$/i;

/** Path depth, used as a mild tie-break towards top-level quantities. */
function depth(name: string): number {
  return name.split(".").length;
}

function isInternal(name: string): boolean {
  return INTERNAL_MARKERS.some((re) => re.test(name));
}

/**
 * The series to show when a result first appears.
 *
 * Ordered by usefulness rather than by declaration order: variables that change
 * come first, internals and derivatives are demoted, and shallower paths win
 * ties — `tank.level` is what someone modelling a tank wants to see, not
 * `tank.flowModel.states[1].p`. Constants fill any remaining space, so a model
 * where nothing changes still shows something.
 */
export function defaultSeriesNames(result: SimResult, limit = 4): string[] {
  const summaries = summarizeSeries(result);
  const score = (s: SeriesSummary): number => {
    if (!s.varies) return -1;
    // Log magnitude of the swing: a variable that changes by orders of magnitude
    // is more informative than one that twitches, and this keeps the ranking
    // stable across units.
    const swing = Math.abs(s.max - s.min);
    const scale = Math.max(Math.abs(s.max), Math.abs(s.min), 1e-30);
    let value = Math.log10(1 + swing / scale);
    if (isInternal(s.name)) value -= 2;
    // A duplicate of another trace costs a slot without adding information.
    if (ALIAS_HINTS.some((re) => re.test(s.name))) value -= 1.5;
    // Prefer a quantity the model is about over one derived from it.
    if (SIGNAL_NAMES.test(s.name)) value += 0.4;
    // A derivative says the same as its variable, less directly; an auxiliary
    // derivative a library declares alongside is pure noise.
    if (DERIVATIVE.test(s.name)) value -= 0.5;
    if (DERIVATIVE_AUX.test(s.name)) value -= 0.5;
    // An array element is a detail of a vector quantity shown in its own right.
    if (/\[/.test(s.name)) value -= 0.2;
    value -= 0.05 * depth(s.name);
    return value;
  };
  const ranked = [...summaries].sort((a, b) => score(b) - score(a));

  // Drop traces that repeat one already chosen. A result carries the same
  // quantity under several names — a port and the conductor attached to it, a
  // mass's position and the force acting on it — and a plot of four traces
  // cannot afford two of them saying the same thing.
  const chosen: SeriesSummary[] = [];
  for (const s of ranked) {
    if (chosen.length >= limit) break;
    if (s.varies && chosen.some((c) => sameSignature(c.signature, s.signature))) continue;
    chosen.push(s);
  }
  return chosen.map((s) => s.name);
}
