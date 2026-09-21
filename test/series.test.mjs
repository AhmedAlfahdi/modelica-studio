/**
 * Default series selection.
 *
 * A Modelica result holds every variable in the model, in declaration order.
 * Plotting the first few therefore showed whatever the library declared first —
 * for a fluid model, the constants `p` and `T` — leaving the plot flat while the
 * quantities that actually change stayed hidden. That reads as a broken
 * simulation, and it was reported as one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildLibs, repoRoot } from "./helpers/build.mjs";

const LIB = buildLibs("series-lib", ["src/view/series.ts", "src/view/plot.ts", "src/view/axes.ts", "src/view/family.ts"]);
const plotMod = await import(path.join(LIB, "plot.js"));
const axes = await import(path.join(LIB, "axes.js"));
const family = await import(path.join(LIB, "family.js"));
const { defaultSeriesNames, summarizeSeries } = await import(path.join(LIB, "series.js"));

/** Build a SimResult-shaped object from name -> values. */
function resultOf(entries, times = [0, 1, 2]) {
  return {
    time: times,
    series: entries.map(([name, values]) => ({ name, values })),
    warnings: [],
    compileMs: 0,
    simulateMs: 0,
    reusedBinary: false,
  };
}

test("the series that vary are chosen over the ones declared first", () => {
  // The exact shape of a fluid result: constants first, behaviour later.
  const result = resultOf([
    ["tank.medium.p", [101325, 101325, 101325]],
    ["tank.medium.T", [293.15, 293.15, 293.15]],
    ["tank.level", [2.0, 1.99, 1.978]],
    ["tank.m", [1991, 1980, 1969]],
  ]);
  // Constants may fill leftover space — a flat line still shows that the
  // quantity was simulated — but they must never displace a varying one.
  const chosen = defaultSeriesNames(result, 2);
  assert.ok(
    chosen.includes("tank.level") && chosen.includes("tank.m"),
    `the varying quantities are chosen first, got ${chosen.join(", ")}`
  );
  assert.ok(
    !chosen.some((n) => n.includes("medium.p") || n.includes("medium.T")),
    "no constant displaces a varying quantity"
  );

  // With room for all four, the varying ones still come first.
  const all = defaultSeriesNames(result, 4);
  assert.deepEqual(
    all.slice(0, 2).sort(),
    ["tank.level", "tank.m"].sort(),
    "constants are appended, never inserted"
  );
});

test("implementation internals are demoted below the physical quantity", () => {
  // A pipe exposes many `flowModel.*` internals that vary as much as anything,
  // so ranking on magnitude alone surfaces them instead of the useful variable.
  const result = resultOf([
    ["pipe.flowModel.states[1].p", [100000, 120000, 140000]],
    ["tank.level", [2.0, 1.99, 1.978]],
  ]);
  assert.deepEqual(defaultSeriesNames(result, 1), ["tank.level"]);
});

test("a derivative does not outrank the variable it derives from", () => {
  const result = resultOf([
    ["der(tank.level)", [0, -0.01, -0.012]],
    ["tank.level", [2.0, 1.99, 1.978]],
  ]);
  assert.deepEqual(defaultSeriesNames(result, 1), ["tank.level"]);

  const aux = resultOf([
    ["body.der_T", [0, -1, -2]],
    ["body.T", [350, 349, 348]],
  ]);
  assert.deepEqual(defaultSeriesNames(aux, 1), ["body.T"], "an auxiliary derivative is demoted");
});

test("a model where nothing changes still shows something", () => {
  // Better to show flat lines than an empty plot: the absence of change is
  // itself the result, and a blank axes pair looks like a failure.
  const result = resultOf([
    ["a", [1, 1, 1]],
    ["b", [2, 2, 2]],
    ["c", [3, 3, 3]],
  ]);
  assert.deepEqual(defaultSeriesNames(result, 2), ["a", "b"]);
});

test("numerical noise does not count as variation", () => {
  // A 1e-12 wobble on a value of order 1 is rounding, not behaviour.
  const result = resultOf([
    ["noise", [1, 1 + 1e-12, 1]],
    ["real", [0, 1, 2]],
  ]);
  const summaries = summarizeSeries(result);
  assert.equal(summaries.find((s) => s.name === "noise").varies, false);
  assert.deepEqual(defaultSeriesNames(result, 1), ["real"]);
});

test("awkward series values do not break the ranking", () => {
  const result = resultOf([
    ["empty", []],
    ["nan", [NaN, NaN]],
    ["one", [5]],
    ["good", [0, 1, 2]],
  ]);
  assert.deepEqual(defaultSeriesNames(result, 1), ["good"]);
});

test("an example's declared series are honoured", () => {
  // A Modelica result holds every variable and gives no clue which matter, so a
  // guess based on magnitude puts `tank.U` beside `tank.level` and flattens one
  // of them. A built-in example knows what it demonstrates and says so.
  const src = fs.readFileSync(path.join(repoRoot, "src/modelica/examples.ts"), "utf8");
  const declared = [...src.matchAll(/series: \[([^\]]*)\]/g)].map((m) =>
    m[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean)
  );
  assert.ok(declared.length >= 10, `every example should declare its traces, found ${declared.length}`);
  for (const list of declared) {
    assert.ok(list.length >= 2, `an example declared only ${list.length} trace(s)`);
  }
});

test("a plausible quantity is not penalised out of the plot", () => {
  // The alias penalty is meant to drop a duplicate, and an unanchored pattern
  // matched `tank.m` — the tank's mass — because `m` is a prefix of `m_flow`.
  // Removing a real quantity is worse than the duplicate it suppressed.
  const result = resultOf([
    ["tank.medium.p", [101325, 101325, 101325]],
    ["tank.level", [2.0, 1.99, 1.978]],
    ["tank.m", [1991, 1980, 1969]],
  ]);
  const chosen = defaultSeriesNames(result, 2);
  assert.ok(chosen.includes("tank.level"), "the level is shown");
  assert.ok(chosen.includes("tank.m"), `the mass is shown, got ${chosen.join(", ")}`);
});

test("two traces of the same quantity are not both shown", () => {
  // A port and the conductor attached to it carry the same value; four slots
  // cannot afford two of them saying one thing.
  const result = resultOf([
    ["wall.Q_flow", [7.33, 200, 400]],
    ["wall.port_a.Q_flow", [7.33, 200, 400]],
    ["hot.T", [373.1, 353, 333.9]],
  ]);
  const chosen = defaultSeriesNames(result, 4);
  const duplicates = chosen.filter((n) => n === "wall.Q_flow" || n === "wall.port_a.Q_flow");
  assert.equal(duplicates.length, 1, `only one of the equal traces is shown, got ${chosen.join(", ")}`);
});

test("seeding decides what is drawn, not merely what is marked", () => {
  // `drawPlot` draws every series whose style is not explicitly hidden. Seeding
  // a few traces therefore drew ALL of them: sixteen lines where two were
  // intended, and the plot read as flat straight lines because the largest of
  // them — a heat flow of 400 W beside a temperature of 350 K — set the scale.
  const source = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  const embed = fs.readFileSync(path.join(repoRoot, "src/view/embed.ts"), "utf8");

  for (const [label, text] of [["studio-view", source], ["embed", embed]]) {
    assert.match(
      text,
      /visible: (wanted|seed)\.has\(/,
      `${label}: the rest of the series must be hidden explicitly`
    );
    assert.doesNotMatch(
      text,
      /this\.(seriesStyles|styles)\[name\] \?\?= \{\s*color[^}]*visible: true/,
      `${label}: must not seed only the chosen traces and leave the rest drawn`
    );
  }
});

test("exactly one place decides which traces are shown", () => {
  // Two seeding rules existed: `seedVisible` (which reads the example's
  // declared traces) and a leftover `visible: i < 4` in the inspector. The
  // second ran afterwards and silently overrode the first. For a thermal model
  // the first four variables are the two temperatures and their two
  // derivatives, so the plot came out as flat lines at zero beside an axis
  // derived from the derivatives — with the temperatures hidden.
  const source = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  assert.doesNotMatch(
    source,
    /visible:\s*i\s*<\s*\d/,
    "a positional seeding rule must not exist: it overrides the declared traces"
  );

  // Any style created outside the seeder starts hidden.
  const creations = [...source.matchAll(/this\.seriesStyles\[[^\]]+\] \?\?= \{[\s\S]{0,120}?\}/g)];
  assert.ok(creations.length > 0, "styles are created somewhere");
  for (const c of creations) {
    assert.match(
      c[0],
      /visible:\s*(wanted\.has\(|false)/,
      `every style is seeded from the chosen set or hidden, got: ${c[0].replace(/\s+/g, " ")}`
    );
  }
});

/* ------------------------------------------------------------------ */

/** A result over `0..10` with one trace. */
function rampResult() {
  const time = Array.from({ length: 101 }, (_, i) => i / 10);
  return {
    time,
    series: [{ name: "x", values: time.map((t) => t), unit: "" }],
    compileMs: 1,
    simulateMs: 1,
    reusedBinary: true,
    warnings: [],
  };
}

test("the time under the pointer is read off the layout the plot is drawn with", () => {
  // The crosshair is only honest if the pointer-to-time mapping inverts the
  // mapping `drawPlot` placed the pixels with. The Studio kept a second copy of
  // the margins for this, and they had drifted -- left 62 against the renderer's
  // 56 -- so the time under the crosshair was not the time at that pixel.
  const result = rampResult();
  const styles = { x: { color: "#888", visible: true } };
  const W = 800;
  const H = 300;
  const lay = plotMod.layoutForResult(W, H, result, styles);
  const view = { xMin: 0, xMax: 10 };

  // The same layout the renderer paints with, asserted rather than assumed.
  assert.deepEqual(
    plotMod.plotLayout(W, H, true),
    lay,
    "the layout the readout uses is the one the renderer draws with"
  );

  // The ends of the axes are the ends of the range, and the mapping is linear
  // across the plot area -- not across the canvas, which is what a mapping that
  // ignored the margins would give.
  assert.equal(plotMod.timeAtPlotX(lay.left, W, H, result, styles, view), 0, "the left axis is xMin");
  assert.equal(
    plotMod.timeAtPlotX(lay.left + lay.width, W, H, result, styles, view),
    10,
    "the right axis is xMax"
  );
  assert.equal(
    plotMod.timeAtPlotX(lay.left + lay.width / 2, W, H, result, styles, view),
    5,
    "and the middle is the middle"
  );
  // Across the whole canvas rather than the plot area would put these wrong by
  // the margins: 25% of 800 is not 25% of the 730 pixels between the axes.
  assert.ok(
    Math.abs(plotMod.timeAtPlotX(lay.left + lay.width * 0.25, W, H, result, styles, view) - 2.5) < 1e-9,
    "a quarter of the way across the axes is a quarter of the range"
  );

  // The margins belong to the axis labels and the legend, not to the data.
  assert.equal(plotMod.timeAtPlotX(2, W, H, result, styles, view), undefined, "left of the axes: no reading");
  assert.equal(
    plotMod.timeAtPlotX(W - 2, W, H, result, styles, view),
    undefined,
    "right of the axes: none either"
  );

  // A zoomed view reads off the VISIBLE window: using the run's own range would
  // put the readout behind the crosshair.
  const zoomed = { xMin: 4, xMax: 6 };
  assert.equal(plotMod.timeAtPlotX(lay.left, W, H, result, styles, zoomed), 4, "the left axis follows the zoom");
  assert.equal(
    plotMod.timeAtPlotX(lay.left + lay.width / 2, W, H, result, styles, zoomed),
    5,
    "and so does the middle"
  );

  // Hiding every trace drops the legend, which widens the plot area. The readout
  // has to follow, or it would be reading the layout of a plot nobody is looking at.
  const allHidden = { x: { color: "#888", visible: false } };
  const noLegend = plotMod.layoutForResult(W, H, result, allHidden);
  assert.notEqual(noLegend.width, lay.width, "the legend changes the plot width");
  assert.equal(
    plotMod.timeAtPlotX(noLegend.left + noLegend.width, W, H, result, allHidden, view),
    10,
    "and the readout uses the width that is actually drawn"
  );
});

/* ------------------------------------------------------------------ */
/* Which variables share an axis                                       */
/* ------------------------------------------------------------------ */

test("quantities of different size get their own axis, comparable ones share", () => {
  // The rule the plot's readability rests on: a tank's level moves between 2.000
  // and 1.978 while its internal energy sits near 1.6e8. Sharing one axis makes
  // the level a dead flat line and the plot look broken although both are right.
  const small = { name: "level", min: 1.978, max: 2.0 };
  const big = { name: "energy", min: 1.6e8, max: 1.6001e8 };
  const plans = axes.planAxes([small, big]);
  assert.equal(plans.length, 2, "a hundred-million-fold difference is two axes");
  assert.deepEqual(axes.axisIndexOf(plans, "level"), 1, "the small one is its own axis");
  assert.deepEqual(axes.axisIndexOf(plans, "energy"), 0, "and the large one leads");
  assert.deepEqual(plans[0].names, ["energy"], "named, not positional");

  // Comparable, whatever their units: the ratio is what decides.
  const volts = { name: "v", min: -1, max: 1 };
  const amps = { name: "i", min: -0.5, max: 0.5 };
  const shared = axes.planAxes([volts, amps]);
  assert.equal(shared.length, 1, "two quantities of similar size share an axis");
  assert.deepEqual(shared[0].names, ["v", "i"]);

  // The GROUP axis spans its members, so neither is clipped.
  assert.equal(shared[0].min, -1, "the axis covers the smallest");
  assert.equal(shared[0].max, 1, "and the largest");
});

test("the separation threshold is a ratio, not a difference", () => {
  // 12x is the threshold in the module. Just under it the two belong together;
  // just over it they do not -- and because it is a RATIO, the same pair behaves
  // the same at any scale, which is what makes it usable for pascals, kilograms
  // and kelvin alike.
  const at = (ratio) => [
    { name: "a", min: 0, max: 1 },
    { name: "b", min: 0, max: ratio },
  ];
  assert.equal(axes.planAxes(at(10)).length, 1, "ten times is comparable");
  assert.equal(axes.planAxes(at(40)).length, 2, "forty times is not");
  assert.equal(axes.planAxes(at(0.1)).length, 1, "and the ratio does not care which is larger");
  assert.equal(axes.planAxes(at(0.025)).length, 2, "either way round");
});

test("more than two magnitudes fall back to two axes", () => {
  // Four axes are harder to read than one, so the largest groups keep their own
  // and everything else shares a third.
  const plans = axes.planAxes([
    { name: "tiny", min: 0, max: 1e-6 },
    { name: "small", min: 0, max: 1 },
    { name: "big", min: 0, max: 1e6 },
    { name: "huge", min: 0, max: 1e12 },
  ]);
  assert.equal(plans.length, 3, "two axes kept, and one holding the rest");
  const all = plans.flatMap((p) => p.names).sort();
  assert.deepEqual(all, ["big", "huge", "small", "tiny"], "every series is on exactly one axis");
  const rest = plans[2];
  assert.ok(rest.names.length >= 2, "the leftovers are grouped rather than dropped");
});

test("a series that cannot be plotted does not make an axis", () => {
  // A NaN extent comes from a result with no samples; planning an axis around it
  // would give the plot a NaN range and nothing would be drawn at all.
  const plans = axes.planAxes([
    { name: "empty", min: Number.NaN, max: Number.NaN },
    { name: "real", min: 0, max: 1 },
  ]);
  assert.deepEqual(plans.map((p) => p.names), [["real"]], "the unusable one is left out");
  assert.deepEqual(axes.planAxes([]), [], "and no series is no axes");
});

test("only series whose change is visible against their own size are plotted", () => {
  // A variable that moves by one part in a million cannot be read off a plot and
  // only compresses the ones that can. The threshold is relative for the same
  // reason the axis split is.
  const still = { name: "constant", min: 1000000, max: 1000000.0001 };
  const moving = { name: "moving", min: 0, max: 10 };
  assert.deepEqual(
    axes.readableSeries([still, moving]).map((s) => s.name),
    ["moving"],
    "a millionth of a percent is not a change to look at"
  );
  assert.deepEqual(
    axes.readableSeries([moving, still], 1e-12).map((s) => s.name),
    ["moving", "constant"],
    "a looser threshold keeps it: its change is one part in ten thousand million"
  );
  // If NOTHING clears the bar, the flat result is the answer and is shown: an
  // empty plot would read as a failure.
  assert.deepEqual(
    axes.readableSeries([still]).map((s) => s.name),
    ["constant"],
    "the only series is plotted even when it is flat"
  );
});

test("a series on no axis is reported as belonging to none", () => {
  const plans = axes.planAxes([{ name: "a", min: 0, max: 1 }]);
  assert.equal(axes.axisIndexOf(plans, "a"), 0);
  assert.equal(axes.axisIndexOf(plans, "missing"), -1, "no axis claims a series that is not there");
  assert.equal(axes.axisIndexOf([], "a"), -1, "nor when there are no axes at all");
});

/* ------------------------------------------------------------------ */
/* Families of curves                                                  */
/* ------------------------------------------------------------------ */

test("a sweep field takes a list or a range", () => {
  // Both are natural to type: points of interest, and a range. The count is
  // capped because a sweep is one simulation per value.
  assert.deepEqual(family.parseSweepValues("100, 200, 400"), [100, 200, 400], "a list");
  assert.deepEqual(family.parseSweepValues("1 2 3"), [1, 2, 3], "spaces work too");
  assert.deepEqual(family.parseSweepValues("0:0.1:0.3"), [0, 0.1, 0.2, 0.3], "a range includes its end");
  assert.deepEqual(family.parseSweepValues("1:1:3"), [1, 2, 3], "and a whole-number range");
  assert.deepEqual(family.parseSweepValues("10:-5:0"), [10, 5, 0], "a descending step");
  assert.deepEqual(family.parseSweepValues("0.1:0.1:0.3"), [0.1, 0.2, 0.3], "with no floating-point tail");
  assert.equal(family.parseSweepValues("").length, 0, "nothing typed is no sweep");
  assert.equal(family.parseSweepValues("1:0:3").length, 0, "a step of zero is refused");
  assert.equal(family.parseSweepValues("abc").length, 0, "and so is nonsense");
  assert.equal(family.parseSweepValues("1:1:100").length, 12, "the count is capped");
});

test("a family is one result, with each member named after its run", () => {
  // The plot takes one result -- axes, legend, cursor and extents all come from
  // `result.series` -- so the family is folded into it rather than taught to the
  // renderer as a second thing.
  const time = [0, 1, 2];
  const current = { time, series: [{ name: "v", values: [0, 1, 2], unit: "V" }], compileMs: 1, simulateMs: 1, reusedBinary: true, warnings: [] };
  const other = { time, series: [{ name: "v", values: [0, 2, 4], unit: "V" }], compileMs: 1, simulateMs: 1, reusedBinary: true, warnings: [] };

  const none = family.overlayResults(current, []);
  assert.equal(none.result, current, "no family is the result itself");
  assert.equal(none.familyNames.size, 0);

  const over = family.overlayResults(current, [{ label: "R=100", result: other }]);
  assert.deepEqual(
    over.result.series.map((s) => s.name),
    ["v", "v · R=100"],
    "the family trace is named after the run it came from"
  );
  assert.deepEqual(over.result.series[1].values, [0, 2, 4], "with that run's values");
  assert.deepEqual(over.result.series[0].values, [0, 1, 2], "and the current run is untouched");
  assert.deepEqual([...over.familyNames], ["v · R=100"], "the added names are reported, to be styled");
  assert.equal(over.result.time, time, "on the current run's time axis");

  // A run on a different grid is resampled onto the one axis the plot has.
  const coarse = { ...other, time: [0, 2], series: [{ name: "v", values: [0, 4], unit: "V" }] };
  const resampled = family.overlayResults(current, [{ label: "before", result: coarse }]);
  assert.deepEqual(resampled.result.series[1].values, [0, 2, 4], "interpolated onto the current grid");

  // Two members of the same sweep do not collide.
  const two = family.overlayResults(current, [
    { label: "R=100", result: other },
    { label: "R=200", result: other },
  ]);
  assert.deepEqual(two.result.series.map((s) => s.name), ["v", "v · R=100", "v · R=200"]);
});

test("a dashed series is dashed in the legend too", () => {
  // The dash is what tells a kept run from the run on screen, and the legend is
  // where that is read. Resetting the dash before the legend drew every swatch
  // solid, so the legend named six traces and distinguished none of them.
  const dashes = [];
  let dash = "";
  const ctx = new Proxy(
    { canvas: { width: 900, height: 400 }, font: "", fillStyle: "", strokeStyle: "", globalAlpha: 1 },
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === "setLineDash") return (d) => { dash = d && d.length ? d.join(",") : ""; };
        if (k === "measureText") return (s2) => ({ width: String(s2).length * 6 });
        // Record the dash in force at each stroked line, and its length: the
        // legend swatch is the short one.
        if (k === "moveTo") return (x, y) => { t.__from = [x, y]; };
        if (k === "lineTo") return (x, y) => {
          const from = t.__from ?? [x, y];
          if (Math.abs(y - from[1]) < 0.001 && x - from[0] < 20) dashes.push(dash || "solid");
        };
        return () => {};
      },
      set(t, k, v) { t[k] = v; return true; },
    }
  );
  const time = [0, 1, 2];
  const result = {
    time,
    series: [{ name: "h", values: [0, 1, 2], unit: "" }, { name: "h · e=0.7", values: [0, 2, 4], unit: "" }],
    compileMs: 1, simulateMs: 1, reusedBinary: true, warnings: [],
  };
  plotMod.drawPlot(ctx, 900, 400, result, {
    styles: { h: { color: "#c00", visible: true }, "h · e=0.7": { color: "#c00", visible: true, dashed: true } },
    view: { xMin: 0, xMax: 2 },
    dpr: 1,
    theme: plotMod.plotThemeFrom(false),
  });
  assert.ok(dashes.includes("solid"), "the current run's swatch is solid");
  assert.ok(dashes.includes("5,4"), `a dashed series gets a dashed swatch, got ${JSON.stringify(dashes)}`);
});
