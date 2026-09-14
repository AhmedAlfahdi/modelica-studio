/**
 * Splitting the plotted variables across y-axes.
 *
 * A Modelica result mixes quantities of wildly different size: a fluid tank's
 * `level` moves between 2.000 and 1.978 m while its internal energy is around
 * 1.6e8 J. Sharing one axis, the level is a dead flat line and the energy is the
 * only thing visible — the plot looks broken although both are correct.
 *
 * Variables are therefore grouped by magnitude and each group gets its own axis,
 * which is what makes "does it change over time?" answerable at a glance.
 */

/** One plotted series, reduced to what axis planning needs. */
export interface AxisInput {
  name: string;
  min: number;
  max: number;
}

/** A group of series sharing one axis. */
export interface AxisPlan {
  min: number;
  max: number;
  /** Names of the series drawn against this axis. */
  names: string[];
}

/**
 * How much larger one swing must be before it is given its own axis.
 *
 * Below this the traces are comparable and belong together; above it, sharing an
 * axis would flatten the smaller one.
 */
const SEPARATION_RATIO = 12;

/** More axes than this is harder to read than one shared axis. */
const MAX_AXES = 2;

function swing(s: AxisInput): number {
  return Math.abs(s.max - s.min);
}

function magnitude(s: AxisInput): number {
  return Math.max(Math.abs(s.max), Math.abs(s.min), Number.MIN_VALUE);
}

/**
 * Group series into at most `MAX_AXES` axes by order of magnitude.
 *
 * Grouping is by the SIZE of a series, not by the size of its swing: two
 * quantities of similar magnitude but different variation still belong on one
 * axis, because their relationship is then readable.
 */
export function planAxes(series: AxisInput[]): AxisPlan[] {
  const usable = series.filter((s) => Number.isFinite(s.min) && Number.isFinite(s.max));
  if (usable.length === 0) return [];

  const sorted = [...usable].sort((a, b) => magnitude(b) - magnitude(a));
  const groups: AxisInput[][] = [];
  for (const s of sorted) {
    // Join the first group whose scale this series is comparable to, so related
    // quantities stay together rather than each getting an axis of its own.
    const target = groups.find((g) => {
      const reference = magnitude(g[0]);
      const ratio = Math.max(reference, magnitude(s)) / Math.min(reference, magnitude(s));
      return ratio < SEPARATION_RATIO;
    });
    if (target) target.push(s);
    else groups.push([s]);
  }

  // Only the largest groups are worth separate axes; the rest of the plot is
  // easier to read with everything else on one axis than with four of them.
  groups.sort((a, b) => b.length - a.length);
  const kept = groups.slice(0, MAX_AXES);
  const rest = groups.slice(MAX_AXES).flat();
  if (rest.length > 0) kept.push(rest);

  return kept.map((g) => ({
    min: Math.min(...g.map((s) => s.min)),
    max: Math.max(...g.map((s) => s.max)),
    names: g.map((s) => s.name),
  }));
}

/**
 * Series worth plotting: those whose change is visible against their own size.
 *
 * A variable that moves by one part in a million cannot be read off a plot, and
 * including it only compresses the ones that can. The threshold is relative, so
 * it behaves the same for pascals, kilograms and kelvin.
 */
export function readableSeries(series: AxisInput[], minRelativeChange = 1e-3): AxisInput[] {
  const readable = series.filter((s) => {
    const size = magnitude(s);
    return swing(s) / size >= minRelativeChange;
  });
  // If nothing clears the bar, show what there is rather than an empty plot: the
  // absence of change is itself the result.
  return readable.length > 0 ? readable : series;
}

/** Index of the axis a series belongs to, or -1. */
export function axisIndexOf(plans: AxisPlan[], name: string): number {
  return plans.findIndex((p) => p.names.includes(name));
}
