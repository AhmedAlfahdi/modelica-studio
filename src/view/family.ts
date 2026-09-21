/**
 * Families of curves: a parameter swept, and a run kept for comparison.
 *
 * The point of most of the models in a course is what happens when a number
 * changes — the damping in `damped-oscillator`, the gain in `control-loop`, the
 * load in `half-wave-rectifier` — and one run at a time answers that with a
 * sequence of screenshots.
 *
 * Both features are the same picture: the run on screen with other runs drawn
 * behind it. So there is one mechanism. The plot takes ONE result — its axes, its
 * legend, its cursor and its extents are all computed from `result.series` — and
 * rather than teach it about a second result, the family is folded into the one
 * it already has, each trace named after the run it came from.
 */

import type { SimResult } from "../omc/backend";
import { sampleAt } from "./plot";

/** One other run, drawn behind the current one. */
export interface FamilyRun {
  /** What was different about it: `R=100`, or `before`. */
  label: string;
  result: SimResult;
  /** A run kept for comparison rather than part of a sweep. */
  before?: boolean;
}

/**
 * The values in a sweep field.
 *
 * Two forms, because both are natural to type: a list (`100, 200, 400`) for
 * points of interest, and `start:step:end` for a range. The count is capped — a
 * sweep is one simulation per value, and past a dozen the picture is a smudge.
 */
export function parseSweepValues(text: string, limit = 12): number[] {
  const t = text.trim();
  if (!t) return [];
  const range = /^(-?[\d.]+(?:e-?\d+)?)\s*:\s*(-?[\d.]+(?:e-?\d+)?)\s*:\s*(-?[\d.]+(?:e-?\d+)?)$/i.exec(t);
  if (range) {
    const from = Number(range[1]);
    const step = Number(range[2]);
    const to = Number(range[3]);
    if (![from, step, to].every(Number.isFinite) || step === 0) return [];
    const out: number[] = [];
    const forwards = step > 0;
    // A tolerance on the end so `0:0.1:0.3` includes 0.3 after floating-point
    // addition, which is the whole reason to type a step rather than a list.
    for (let v = from; forwards ? v <= to + Math.abs(step) * 1e-9 : v >= to - Math.abs(step) * 1e-9; v += step) {
      out.push(Number(v.toPrecision(12)));
      if (out.length >= limit) break;
    }
    return out;
  }
  return t
    .split(/[,\s]+/)
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .slice(0, limit);
}

/** True when two results share one time grid, which is the usual case. */
function sameGrid(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  // Ends and count are enough: both runs were asked for the same span and the
  // same number of intervals, and the solver places them the same way.
  return a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
}

/**
 * The current run with the family folded in.
 *
 * Returns the names it added, so the caller can style them as the past — muted
 * and dashed — rather than as another measurement of the same thing.
 */
export function overlayResults(
  current: SimResult,
  family: FamilyRun[]
): { result: SimResult; familyNames: Set<string> } {
  const familyNames = new Set<string>();
  if (family.length === 0) return { result: current, familyNames };

  const series = [...current.series];
  for (const run of family) {
    for (const s of run.result.series) {
      const name = `${s.name} · ${run.label}`;
      if (familyNames.has(name)) continue;
      familyNames.add(name);
      series.push({
        ...s,
        name,
        // Resampled onto the current run's grid when the two differ, because the
        // plot has one x axis. A gap becomes NaN, which the plot already breaks
        // the line at rather than drawing through.
        values: sameGrid(current.time, run.result.time)
          ? [...s.values]
          : current.time.map((t) => sampleAt(run.result.time, s.values, t) ?? Number.NaN),
      });
    }
  }
  return { result: { ...current, series }, familyNames };
}
