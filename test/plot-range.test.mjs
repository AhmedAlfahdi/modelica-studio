/**
 * The two ways a plot could be quietly wrong about its own axis.
 *
 * Neither was an exception: one drew nothing at all and reported success, the
 * other put the time readout a few pixels away from the crosshair. Both are
 * arithmetic in `plot.ts`, so both are tested as arithmetic.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";

const plot = await import(path.join(buildLibs("prange-plot", ["src/view/plot.ts"]), "plot.js"));

/** E is huge and constant, level sweeps 0..2: two axes with different labels. */
function twoAxis(n = 101) {
  const time = Array.from({ length: n }, (_, i) => i / (n - 1));
  return {
    time,
    series: [
      { name: "E", values: time.map(() => 1.6e8), unit: "J" },
      { name: "level", values: time.map((t) => 2 * t), unit: "m" },
    ],
    warnings: [],
  };
}

test("a zero-length run window still draws a finite axis", () => {
  // start >= stop is not an error OpenModelica reports: asked for start=5, stop=1
  // it returns a valid two-sample result whose time is [5, 5]. The plot then
  // divided by a zero-width range, every coordinate came out non-finite, and the
  // canvas drops non-finite paths and labels without a word -- a blank plot with
  // "2 samples" reported as a success.
  const degenerate = { ...twoAxis(2), time: [5, 5] };
  const range = plot.plotTimeRange(degenerate);

  assert.ok(Number.isFinite(range.xMin) && Number.isFinite(range.xMax), "both ends are finite");
  assert.ok(range.xMax > range.xMin, `the drawn range is not empty: ${JSON.stringify(range)}`);

  // And the ticks follow: `niceTicks(5, 5)` returned a single value, so even the
  // grid line was lost.
  assert.ok(plot.niceTicks(range.xMin, range.xMax).length >= 2, "there is at least one tick to label");

  // A normal run is left alone.
  const normal = plot.plotTimeRange(twoAxis());
  assert.deepEqual(normal, { xMin: 0, xMax: 1 }, "an ordinary range is not widened");
  // And a zoom window wins over the run's own extent.
  assert.deepEqual(plot.plotTimeRange(twoAxis(), { xMin: 0.4, xMax: 0.6 }), { xMin: 0.4, xMax: 0.6 });
});

test("the time readout inverts the layout the plot was DRAWN with", () => {
  // The right margin is reserved from the tick labels of the window being drawn,
  // and those change with the zoom. Inverting a layout computed for the whole run
  // therefore reported a time a few pixels away from the pixel under the cursor.
  const result = twoAxis();
  const view = { xMin: 0.9, xMax: 0.95 };
  const full = plot.layoutForResult(700, 400, result, {});
  const zoomed = plot.layoutForResult(700, 400, result, {}, view);

  // The fixture has to produce the difference, or the test proves nothing.
  assert.notEqual(
    zoomed.width,
    full.width,
    `the two layouts differ, as they do on screen (${zoomed.width} vs ${full.width})`
  );

  const rightEdge = zoomed.left + zoomed.width;
  assert.equal(
    plot.timeAtPlotX(rightEdge, 700, 400, result, {}, view),
    view.xMax,
    "the right edge of the drawn plot is the end of the window"
  );
  assert.equal(
    plot.timeAtPlotX(zoomed.left, 700, 400, result, {}, view),
    view.xMin,
    "and its left edge is the start"
  );

  // The control: what the old code answered, using the full-run layout for the
  // same pixel. It is off, which is why the fix is a pass-through and not a tweak.
  const wrong = view.xMin + ((rightEdge - full.left) / full.width) * (view.xMax - view.xMin);
  assert.notEqual(wrong, view.xMax, `the old answer was ${wrong}, not ${view.xMax}`);

  // Outside the plot area there is no time at all.
  assert.equal(plot.timeAtPlotX(zoomed.left - 5, 700, 400, result, {}, view), undefined);
});
