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

const LIB = buildLibs("series-lib", ["src/view/series.ts", "src/view/plot.ts", "src/view/axes.ts", "src/view/family.ts", "src/view/typeset.ts", "src/view/units.ts"]);
const plotMod = await import(path.join(LIB, "plot.js"));
const axes = await import(path.join(LIB, "axes.js"));
const family = await import(path.join(LIB, "family.js"));
const { defaultSeriesNames, summarizeSeries } = await import(path.join(LIB, "series.js"));
const typesetMod = await import(path.join(LIB, "typeset.js"));

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

  // The run on screen is named after its own value too, or the legend says
  // `source.V=10` for the dashed curves and nothing for the solid one.
  const named = family.overlayResults(current, [{ label: "source.V=10", result: other }], "source.V=15");
  assert.deepEqual(
    named.result.series.map((s) => s.name),
    ["v · source.V=15", "v · source.V=10"],
    "both curves carry their own number"
  );
  assert.deepEqual(named.result.series[0].values, [0, 1, 2], "and the current run is still the current run");
  assert.deepEqual([...named.familyNames], ["v · source.V=10"], "only the family is styled as the past");

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

test("a trace wide enough to fill the plot is drawn under the quiet ones", () => {
  // Reported from a screenshot of the buck converter. `der(inductor.i)` swings
  // between -10828 and +12000 A/s (the model's real numbers) while `capacitor.v`
  // moves between 0 and 21.7 V, and sampled every 10 µs that 20 kHz derivative has
  // no curve left in it: it is a dense zigzag that fills the frame. Painted in
  // result order it came last, over the two traces it is derived from, so the
  // picture was one yellow block with `capacitor.v` visible only in the arcs that
  // poked out above it.
  const strokes = [];
  const legendNames = [];
  let segments = 0;
  let font = "11px sans-serif";
  const ctx = new Proxy(
    {
      canvas: { width: 900, height: 400 },
      font,
      fillStyle: "",
      strokeStyle: "",
      globalAlpha: 1,
      textAlign: "",
      textBaseline: "",
    },
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === "measureText") {
          const size = Number(/([0-9.]+)px/.exec(font)?.[1] ?? 11);
          return (s2) => ({ width: String(s2).length * size * 0.55 });
        }
        if (k === "beginPath") return () => { segments = 0; };
        if (k === "moveTo" || k === "lineTo") return () => { segments++; };
        if (k === "stroke") return () => { strokes.push({ color: t.strokeStyle, segments, width: t.lineWidth }); };
        // The legend writes the name beside its swatch, in the order it draws them.
        if (k === "fillText") return (label) => { legendNames.push(String(label)); };
        return () => {};
      },
      set(t, k, v) {
        if (k === "font") font = String(v);
        t[k] = v;
        return true;
      },
    }
  );

  const time = Array.from({ length: 10 }, (_, i) => i / 9);
  const result = {
    time,
    // The order a result writes them in: the derived, enormous one last — which is
    // the order that buried everything.
    series: [
      { name: "capacitor.v", values: time.map((t) => 21 * t), unit: "V" },
      { name: "inductor.i", values: time.map((t) => 3 * t), unit: "A" },
      { name: "der(inductor.i)", values: time.map((t, i) => (i % 2 ? 12000 : -10828)), unit: "A/s" },
    ],
    compileMs: 1,
    simulateMs: 1,
    reusedBinary: true,
    warnings: [],
  };
  const colours = { "capacitor.v": "#a00", "inductor.i": "#0a0", "der(inductor.i)": "#aa0" };
  plotMod.drawPlot(ctx, 900, 400, result, {
    styles: Object.fromEntries(Object.entries(colours).map(([n, color]) => [n, { color, visible: true }])),
    view: { xMin: 0, xMax: 1 },
    dpr: 1,
    theme: plotMod.plotThemeFrom(false),
  });

  // Only the traces: the frame, the grid and the legend swatches are stroked too,
  // and a swatch is a two-point line.
  const painted = strokes.filter((s) => s.segments >= 5).map((s) => s.color);
  assert.deepEqual(
    painted,
    ["#aa0", "#a00", "#0a0"],
    "the widest trace is painted first, the rest keep the result's order"
  );
  // The legend is where a reader looks up which colour is which, so it keeps the
  // result's order — the paint order is not a reading order. Read off the swatches:
  // a name is drawn in runs now (`capacitor` `.` `v`), so the row's identity in this
  // recording is the colour of the swatch that precedes it.
  const seriesColours = Object.values(colours);
  const swatches = strokes
    .filter((s) => s.width === 2.4 && seriesColours.includes(s.color))
    .map((s) => s.color);
  assert.deepEqual(swatches, ["#a00", "#0a0", "#aa0"], "and the legend keeps the result's order");
});

test("the legend typesets a name: subscripts low, the derivative dot above", () => {
  // The legend is where a curve is READ, so it says `damper.s_rel` as a subscript and
  // `der(damper.s_rel)` as a dotted `s`. The trace LIST keeps plain names — it is an
  // identifier surface — so this is the one place the two spellings differ, on purpose.
  const texts = [];
  const arcs = [];
  let font = "11px sans-serif";
  const ctx = new Proxy(
    {
      canvas: { width: 900, height: 400 },
      font,
      fillStyle: "",
      strokeStyle: "",
      globalAlpha: 1,
      textAlign: "",
      textBaseline: "",
    },
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === "measureText") {
          const size = Number(/([0-9.]+)px/.exec(font)?.[1] ?? 11);
          return (s2) => ({ width: String(s2).length * size * 0.55 });
        }
        if (k === "fillText") return (label, x, y) => texts.push({ label: String(label), x, y, font });
        if (k === "arc") return (x, y, r) => arcs.push({ x, y, r });
        return () => {};
      },
      set(t, k, v) {
        if (k === "font") font = String(v);
        t[k] = v;
        return true;
      },
    }
  );
  const time = [0, 1, 2, 3];
  const result = {
    time,
    series: [
      // Comparable magnitudes, so both curves share ONE axis and the legend keeps a
      // full strip: two axes take the width the names and units are drawn in.
      { name: "damper.s_rel", values: [0, 1, 2, 3], unit: "m" },
      { name: "der(damper.v_rel)", values: [0, 1, 2, 3], unit: "m.s-1" },
    ],
    compileMs: 1, simulateMs: 1, reusedBinary: true, warnings: [],
  };
  // Wide enough for the name AND its unit: in a narrow strip the unit is the part
  // that gives way, so that is a different case (tested by the axis-collision one).
  plotMod.drawPlot(ctx, 1200, 400, result, {
    styles: {
      "damper.s_rel": { color: "#a00", visible: true },
      "der(damper.v_rel)": { color: "#0a0", visible: true },
    },
    view: { xMin: 0, xMax: 3 },
    dpr: 1,
    theme: plotMod.plotThemeFrom(false),
  });

  const rows = texts.filter((t) => /^(damper|s|rel|\.)$/.test(t.label));
  const sub = rows.find((t) => t.label === "rel");
  const base = rows.find((t) => t.label === "s");
  assert.ok(base && sub, `the name is drawn in runs, got ${JSON.stringify(rows)}`);
  assert.ok(sub.y > base.y, `the subscript sits lower than its variable, ${sub?.y} > ${base?.y}`);
  assert.ok(Number(/([0-9.]+)px/.exec(sub.font)?.[1]) < 12, "and is drawn smaller");
  assert.ok(arcs.length >= 1, "the derivative's dot is a filled circle above the variable");
  assert.ok(
    arcs.every((a) => a.r < 3),
    "a dot, not a blob"
  );
  // The unit rides after the name, and its exponent is a RUN at a size this chooses.
  //
  // It was a Unicode glyph, and this test used to insist on that — one string for the list,
  // the tooltip and the canvas. The reason is gone: the glyph measured 5px of ink at 11px and
  // no stylesheet could grow it without growing the unit's letters, so the part of the unit
  // that carries its meaning was the smallest thing drawn. `m·s` + a raised `-1` at 85% of
  // the unit's size measures 6px and has strokes.
  const unitBase = texts.find((t) => t.label === "m·s");
  const exponent = texts.find((t) => t.label === "-1");
  assert.ok(
    unitBase && exponent,
    `the unit is drawn in runs: ${JSON.stringify(texts.map((t) => t.label))}`
  );
  assert.ok(unitBase.x > sub.x, "after the name it belongs to");
  assert.ok(exponent.x > unitBase.x, "with its exponent after its letters");
  assert.ok(exponent.y < unitBase.y, "raised above the baseline");
  const px = (t) => Number(/([0-9.]+)px/.exec(t.font)?.[1] ?? 0);
  assert.ok(
    px(exponent) < px(unitBase) && px(exponent) >= px(unitBase) * 0.8,
    `at 85% of the unit, not a hairline (${exponent.font} against ${unitBase.font})`
  );
  assert.ok(
    /^500 /.test(exponent.font) && /^500 /.test(String(sub.font)),
    `and at weight 500, because a small stroke at 400 washes out (${exponent.font})`
  );
  assert.equal(
    typesetMod.typesetName("der(damper.v_rel)").filter((r) => r.dot).length,
    1,
    "one dot for one derivative"
  );
});

test("the legend is placed clear of a second axis's values", () => {
  // Reported from a screenshot: the right-hand axis values (1.1e+5) were painted
  // over by the legend's surface, because both live in the margin to the right of
  // the frame and the legend did not know the labels were there.
  const text = [];
  const rects = [];
  let font = "11px sans-serif";
  const ctx = new Proxy(
    {
      canvas: { width: 700, height: 380 },
      font,
      fillStyle: "",
      strokeStyle: "",
      globalAlpha: 1,
      textAlign: "",
      textBaseline: "",
    },
    {
      get(t, k) {
        if (k in t) return t[k];
        // A width in proportion to the font size, so a measurement is a real one.
        if (k === "measureText") {
          const size = Number(/([0-9.]+)px/.exec(font)?.[1] ?? 11);
          return (s2) => ({ width: String(s2).length * size * 0.55 });
        }
        if (k === "fillText") {
          return (label, x, y) => text.push({ label: String(label), x, y });
        }
        // The legend paints a translucent surface over its strip; that surface is
        // what actually hid the axis values in the report, so it is recorded too.
        if (k === "fillRect") {
          return (x, y, w2, h2) => rects.push({ x, y, w: w2, h: h2, alpha: t.globalAlpha });
        }
        return () => {};
      },
      set(t, k, v) {
        if (k === "font") font = String(v);
        t[k] = v;
        return true;
      },
    }
  );

  // Pressure in the hundreds of thousands against a flow in hundredths: two
  // axes, and the second one's labels are six characters wide.
  const time = [0, 1, 2];
  const result = {
    time,
    series: [
      { name: "pump.medium.p_bar", values: [1.1e5, 1.2e5, 1.1e5], unit: "Pa" },
      { name: "pipe.port_a.m_flow", values: [0.011, 0.012, 0.011], unit: "kg/s" },
    ],
    compileMs: 1, simulateMs: 1, reusedBinary: true, warnings: [],
  };
  const W = 700;
  plotMod.drawPlot(ctx, W, 380, result, {
    styles: {},
    view: { xMin: 0, xMax: 2 },
    dpr: 1,
    theme: plotMod.plotThemeFrom(false),
  });

  // The same layout the drawing used, which now reserves the axis column.
  const layout = plotMod.layoutForResult(W, 380, result, {});
  const frameRight = layout.left + layout.width;
  // The axis values: numbers drawn to the right of the frame.
  const axis = text.filter((t) => t.x > frameRight && /[0-9]/.test(t.label) && t.label.length <= 8);
  // The legend's rows start past the axis's tick labels, which are drawn from the
  // frame outwards. Found by position rather than by a leading ellipsis: with the
  // room the legend now reserves, these names FIT, which is the better outcome and
  // not something to assert a truncation about.
  const legendNames = text.filter((t) => t.x > frameRight + 8);
  assert.ok(axis.length > 0, `the second axis is labelled (${text.map((t) => t.label).join(" | ")})`);

  const axisRight = Math.max(...axis.map((t) => t.x + t.label.length * 11 * 0.55));

  // The pane in the report: a second axis's tick labels and the legend share the
  // right margin, so the legend has to start past them — and be drawn at all.
  assert.ok(
    legendNames.length > 0,
    `the legend is still drawn beside the axis (${text.map((t) => t.label).join(" | ")})`
  );
  const legendLeft = Math.min(...legendNames.map((t) => t.x));
  assert.ok(
    legendLeft > axisRight + 2,
    `the legend starts past the axis values (axis ends at ${axisRight.toFixed(1)}, legend starts at ${legendLeft})`
  );
  // The legend's translucent surface must also start past the values: placement
  // alone is not enough, because the surface is painted AFTER them and would hide
  // them exactly as the screenshot showed.
  const surface = rects.filter((r) => r.alpha < 1);
  assert.ok(surface.length > 0, "the legend paints a surface");
  for (const r of surface) {
    assert.ok(
      r.x > axisRight,
      `the legend's surface starts past the axis values (surface at ${r.x}, values end at ${axisRight.toFixed(1)})`
    );
  }

  // And every name drawn fits inside the canvas: a shortened name that runs off
  // the edge is the same bug wearing a different hat.
  for (const t of legendNames) {
    assert.ok(
      t.x + t.label.length * 11 * 0.55 <= W,
      `"${t.label}" fits in the pane (ends at ${(t.x + t.label.length * 11 * 0.55).toFixed(0)} of ${W})`
    );
  }

  // In a pane too narrow for a legend the axis values must still fit inside the
  // canvas: the margin used to be 14px, so they were cut off at the edge.
  const narrowText = [];
  const narrowRects = [];
  const narrowCtx = new Proxy(
    { canvas: { width: 380, height: 300 }, font, fillStyle: "", strokeStyle: "", globalAlpha: 1, textAlign: "", textBaseline: "" },
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === "measureText") {
          const size = Number(/([0-9.]+)px/.exec(font)?.[1] ?? 11);
          return (s2) => ({ width: String(s2).length * size * 0.55 });
        }
        if (k === "fillText") return (label, x) => narrowText.push({ label: String(label), x });
        return () => {};
      },
      set(t, k, v) {
        if (k === "font") font = String(v);
        t[k] = v;
        return true;
      },
    }
  );
  plotMod.drawPlot(narrowCtx, 380, 300, result, {
    styles: {},
    view: { xMin: 0, xMax: 2 },
    dpr: 1,
    theme: plotMod.plotThemeFrom(false),
  });
  const narrowFrameRight = plotMod.plotLayout(380, 300, false, plotMod.axisLabelColumnW(
    plotMod.planAxes
      ? []
      : []
  )).left;
  void narrowFrameRight;
  // Every number drawn to the right of the frame has to end inside the canvas.
  const approx = (t2) => t2.x + t2.label.length * 11 * 0.55;
  for (const t2 of narrowText.filter((x) => /[0-9]/.test(x.label))) {
    assert.ok(
      approx(t2) <= 380,
      `"${t2.label}" is not cut off in a 380px pane (ends at ${approx(t2).toFixed(0)})`
    );
  }
  void narrowRects;

  // When even a shortened legend would not fit, it is left out rather than drawn
  // over the values.
  const tiny = [];
  const tinyCtx = new Proxy(
    { canvas: { width: 300, height: 380 }, font, fillStyle: "", strokeStyle: "", globalAlpha: 1, textAlign: "", textBaseline: "" },
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === "measureText") {
          const size = Number(/([0-9.]+)px/.exec(font)?.[1] ?? 11);
          return (s2) => ({ width: String(s2).length * size * 0.55 });
        }
        if (k === "fillText") return (label) => tiny.push(String(label));
        return () => {};
      },
      set(t, k, v) {
        if (k === "font") font = String(v);
        t[k] = v;
        return true;
      },
    }
  );
  plotMod.drawPlot(tinyCtx, 300, 380, result, {
    styles: {},
    view: { xMin: 0, xMax: 2 },
    dpr: 1,
    theme: plotMod.plotThemeFrom(false),
  });
  assert.ok(
    !tiny.some((l) => l.startsWith("…") || l.includes("pump") || l.includes("pipe")),
    `in a 300px pane the legend is left out rather than overlapping (${tiny.join(" | ")})`
  );
});

test("the legend and the axis values never collide, at any width", () => {
  // Two bugs in a row lived in this margin: the legend painted over the second
  // axis's values, and then -- with no legend -- the values were cut off at the
  // edge of the canvas. Both were single cases, so both were found by a person
  // looking at one pane. This sweeps the widths instead, and asserts the two
  // properties that must hold at every one of them:
  //
  //   no overlap   the legend's rows start after the axis values end
  //   nothing cut  no value's right edge passes the canvas
  //
  // A third is implicitly checked: the legend is either fully drawn or absent, and
  // when it is absent the PANE is too narrow for it (never a silent half-legend).
  const WIDTHS = [300, 340, 380, 420, 480, 520, 620, 700, 900, 1200];
  const CHAR = 0.55;
  const failures = [];

  for (const width of WIDTHS) {
    for (const secondAxis of [false, true]) {
      let font = "11px sans-serif";
      const text = [];
      const ctx = new Proxy(
        { canvas: { width, height: 380 }, font, fillStyle: "", strokeStyle: "", globalAlpha: 1, textAlign: "", textBaseline: "" },
        {
          get(t, k) {
            if (k in t) return t[k];
            if (k === "measureText") {
              const size = Number(/([\d.]+)px/.exec(font)?.[1] ?? 11);
              return (s2) => ({ width: String(s2).length * size * CHAR });
            }
            if (k === "fillText") return (label, x) => text.push({ label: String(label), x });
            return () => {};
          },
          set(t, k, v) {
            if (k === "font") font = String(v);
            t[k] = v;
            return true;
          },
        }
      );
      const time = [0, 1, 2, 3, 4, 5];
      const series = [
        { name: "pipe.port_a.p", values: [1.1e5, 1.12e5, 1.15e5, 1.13e5, 1.11e5, 1.1e5], unit: "Pa" },
        { name: "pipe.port_a.m_flow", values: [0.011, 0.0115, 0.012, 0.0118, 0.0112, 0.011], unit: "kg/s" },
      ];
      const result = secondAxis
        ? { time, series, compileMs: 1, simulateMs: 1, reusedBinary: true, warnings: [] }
        : { time, series: [series[0]], compileMs: 1, simulateMs: 1, reusedBinary: true, warnings: [] };

      plotMod.drawPlot(ctx, width, 380, result, {
        styles: {},
        view: { xMin: 0, xMax: 5 },
        dpr: 1,
        theme: plotMod.plotThemeFrom(false),
      });

      const lay = plotMod.layoutForResult(width, 380, result, {});
      const frameRight = lay.left + lay.width;
      const right = (t2) => t2.x + t2.label.length * 11 * CHAR;

      // By POSITION, which is what the two properties are about: the extra axis
      // labels its ticks 7px right of the frame, and the legend's rows start at
      // least 10px right of it (further when there is an axis column to clear).
      // Identifying legend rows by their truncation ellipsis was wrong -- a name
      // that fits has none, so a perfectly good legend read as absent.
      const values = text.filter((t2) => t2.x > frameRight && t2.x < frameRight + 9);
      const legend = text.filter((t2) => t2.x >= frameRight + 10);

      for (const v of values) {
        if (right(v) > width + 0.5) {
          failures.push(`${width}px, ${secondAxis ? "two" : "one"} axis: value "${v.label}" ends at ${right(v).toFixed(0)}`);
        }
      }
      if (legend.length === 0) {
        // Absent is only correct when there is no room for it.
        const strip = width - frameRight - 14;
        if (strip >= 100) {
          failures.push(`${width}px, ${secondAxis ? "two" : "one"} axis: no legend though ${strip.toFixed(0)}px was free`);
        }
        continue;
      }
      const legendLeft = Math.min(...legend.map((t2) => t2.x));
      const valuesRight = values.length ? Math.max(...values.map(right)) : frameRight;
      if (legendLeft <= valuesRight + 2) {
        failures.push(
          `${width}px, ${secondAxis ? "two" : "one"} axis: legend at ${legendLeft.toFixed(0)}, values end at ${valuesRight.toFixed(0)}`
        );
      }
      for (const t2 of legend) {
        if (right(t2) > width + 0.5) {
          failures.push(`${width}px, ${secondAxis ? "two" : "one"} axis: legend row "${t2.label}" ends at ${right(t2).toFixed(0)}`);
        }
      }
    }
  }

  assert.deepEqual(failures, [], `${failures.length} width/axis combinations misplace the legend or the values`);
});

test("a legend names the run on screen as well as the family", () => {
  // Reported from a screenshot: two curves, and no way to tell 10 V from 15 V.
  const rows = [];
  const recorded = [];
  const ctx = new Proxy(
    { canvas: { width: 900, height: 400 }, font: "", fillStyle: "", strokeStyle: "", globalAlpha: 1, textAlign: "", textBaseline: "" },
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === "measureText") return (s2) => ({ width: String(s2).length * 6 });
        // A name is drawn in RUNS now, so what a row SAYS is its runs joined; the
        // swatch stroke is what separates one row from the next.
        if (k === "fillText") return (text) => recorded.push({ text: String(text) });
        if (k === "stroke") return () => recorded.push({ text: null });
        return () => {};
      },
      set(t, k, v) { t[k] = v; return true; },
    }
  );
  const time = [0, 1, 2];
  const mk = (scale) => ({
    time,
    series: [{ name: "capacitor.v", values: [0, scale, 2 * scale], unit: "V" }],
    compileMs: 1, simulateMs: 1, reusedBinary: true, warnings: [],
  });
  const merged = family.overlayResults(mk(1.5), [{ label: "source.V=10", result: mk(1) }], "source.V=15");
  plotMod.drawPlot(ctx, 900, 400, merged.result, {
    styles: {
      "capacitor.v · source.V=15": { color: "#c00", visible: true },
      "capacitor.v · source.V=10": { color: "#c00", visible: true, dashed: true },
    },
    view: { xMin: 0, xMax: 2 },
    dpr: 1,
    theme: plotMod.plotThemeFrom(false),
  });
  let row = "";
  for (const part of recorded) {
    if (part.text === null) {
      if (row !== "") rows.push(row);
      row = "";
      continue;
    }
    row += part.text;
  }
  if (row !== "") rows.push(row);
  const legend = rows.filter((r) => r.includes("source.V="));
  assert.equal(legend.length, 2, `both curves are named in the legend, got ${JSON.stringify(rows)}`);
  assert.ok(legend.some((r) => r.includes("source.V=15")), "including the one on screen");
  assert.ok(legend.some((r) => r.includes("source.V=10")), "and the one behind it");
});

test("deltas are measured against the named run on screen", () => {
  // The regression that made them disappear: naming the current run, so the
  // legend can say `resistor.R=20`, left EVERY row labelled -- and the reference
  // had been "the row without a label", so there was nothing to measure against
  // and no delta was printed. A family always contains the run on screen, under
  // its own name.
  const rows = [
    { base: "capacitor.v", label: "resistor.R=20", value: 8.866 },
    { base: "capacitor.v", label: "resistor.R=12", value: 7.07 },
    { base: "capacitor.v", label: "resistor.R=15", value: 7.902 },
  ];
  // The same lines as runs, which is what the readout draws: a delta names two series, and
  // the plot spells a series the same way wherever it names one.
  const runs = plotMod.deltaRunLines(rows, "resistor.R=20");
  // Quoted, because the spaces ARE the runs: `Δ ` and ` vs ` carry their own separators, and
  // a joined string makes a doubled space invisible.
  const kinds = (list) => list.map((r) => `${r.kind}:${JSON.stringify(r.text)}`).join(" · ");
  const flow = plotMod.deltaRunLines(
    [
      { base: "orifice.m_flow", label: "R=12", value: 1 },
      { base: "orifice.m_flow", label: "R=20", value: 3 },
    ],
    "R=20"
  );
  assert.equal(flow.length, 1, "one delta for the other run");
  assert.equal(
    kinds(flow[0]),
    'base:"Δ " · base:"orifice" · sep:"." · base:"m" · sub:"flow" · base:" vs " · base:"R=12" · base:" = +2"',
    "with the variable typeset inside it, exactly as the legend spells it"
  );

  const lines = plotMod.deltaLines(rows, "resistor.R=20");
  assert.equal(lines.length, 2, `one line per other run, got ${JSON.stringify(lines)}`);
  assert.match(lines[0], /^Δ capacitor\.v vs resistor\.R=12 = \+1\.796$/, "signed, and against the run on screen");
  assert.match(lines[1], /resistor\.R=15 = \+0\.964$/, "and the same for the other");

  // A single run has nothing to compare against -- and neither has a family whose
  // reference label is not in the readout.
  assert.deepEqual(plotMod.deltaLines([{ base: "v", label: "", value: 1 }], ""), []);
  assert.deepEqual(plotMod.deltaLines(rows, "resistor.R=99"), [], "an unknown reference says nothing");

  // Below zero reads as a minus, not a negative sign in a plus field.
  const down = plotMod.deltaLines(
    [
      { base: "v", label: "before", value: 5 },
      { base: "v", label: "", value: 3 },
    ],
    ""
  );
  assert.match(down[0], /^Δ v vs before = −2$/, `got ${down[0]}`);
});

test("the cursor snaps to the instant two curves cross", () => {
  // The crossings are what an RLC response is read for -- where the capacitor's
  // voltage meets the inductor's current -- and eyeing one off a crosshair gives a
  // time that is nearly right. The snap only acts within its window.
  const time = [0, 1, 2, 3, 4];
  const rising = [0, 1, 2, 3, 4];
  const falling = [4, 3, 2, 1, 0];
  const cross = plotMod.nearestCrossing(time, [rising, falling], 2, 0.5);
  assert.equal(cross, 2, "the crossing is found where the lines meet");

  // Between the samples, the instant is interpolated: these cross at 1.5.
  const a = [0, 0, 1, 1, 1];
  const b = [1, 1, 0, 0, 0];
  const between = plotMod.nearestCrossing(time, [a, b], 1.6, 0.5);
  assert.ok(Math.abs(between - 1.5) < 1e-9, `interpolated, got ${between}`);

  assert.equal(plotMod.nearestCrossing(time, [rising, falling], 0, 0.5), undefined, "far away: no snap");
  assert.equal(plotMod.nearestCrossing(time, [rising], 2, 0.5), undefined, "one line has no crossing");
  assert.equal(
    plotMod.nearestCrossing(time, [[0, Number.NaN, 2, 3, 4], falling], 2, 0.5),
    2,
    "a gap does not stop the search"
  );
});

test("the snap works on the lines as drawn, not on their values", () => {
  // The report that it "does not work": capacitor.v on 0..15 and inductor.i on
  // -0.1..0.1 are two axes, so their values are never equal -- while the two lines
  // cross plainly on screen. Searching for an equality that cannot happen is why
  // nothing snapped.
  const time = [0, 1, 2, 3, 4];
  const volts = [0, 4, 8, 12, 15];      // big numbers
  const amps = [0.1, 0.06, 0.02, -0.02, -0.05]; // tiny, and never equal to volts
  assert.ok(
    volts.every((v, i) => v !== amps[i]),
    "the values never meet, which is the situation being fixed"
  );

  // Drawn: volts maps to 0..100 pixels, amps to 100..0 -- they cross at t = 1.5.
  const px = (v, lo, hi) => 100 - ((v - lo) / (hi - lo)) * 100;
  const voltsPx = volts.map((v) => px(v, 0, 15));
  const ampsPx = amps.map((v) => px(v, -0.05, 0.1));
  const crossing = plotMod.nearestCrossing(time, [voltsPx, ampsPx], 1.4, 0.5);
  assert.ok(crossing !== undefined, "the drawn lines cross and are found");
  // Between i=1 and i=2: 46.67 / (46.67 + 6.67) = 0.875 of the way, so t = 1.875.
  assert.ok(Math.abs(crossing - 1.875) < 1e-6, `interpolated between samples, got ${crossing}`);

  // And in value space there is nothing to find, which is the bug in one line.
  assert.equal(plotMod.nearestCrossing(time, [volts, amps], 1.4, 0.5), undefined);
});

test("the cursor readout is sized by its own setting, box and all", () => {
  // Asked for separately from the diagram's parameter popup. The box is measured
  // from the text, so the font, the leading and the padding have to move together
  // or a large font overflows the panel it is drawn in.
  const result = {
    time: [0, 1, 2],
    series: [{ name: "h", values: [0, 1, 2], unit: "m" }],
    compileMs: 1,
    simulateMs: 1,
    reusedBinary: true,
    warnings: [],
  };

  const drawAt = (readoutScale) => {
    const fonts = [];
    const boxes = [];
    const rects = [];
    let font = "";
    const ctx = new Proxy(
      {
        canvas: { width: 900, height: 400 },
        font: "",
        fillStyle: "",
        strokeStyle: "",
        globalAlpha: 1,
        textAlign: "",
        textBaseline: "",
      },
      {
        get(t, k) {
          if (k in t) return t[k];
          // Width depends on the FONT, as a real one does: a stub that returns a
          // constant per character cannot show a box growing with its text.
          if (k === "measureText") {
            return (s2) => ({ width: String(s2).length * (parseFloat(font) || 11) * 0.55 });
          }
          // The readout is the last box drawn in a frame that has a cursor.
          if (k === "fillRect") return (x, y, w, h) => boxes.push([x, y, w, h]);
          if (k === "fillText") return (text, x, y) => rects.push([String(text), x, y, font]);
          return () => {};
        },
        set(t, k, v) {
          if (k === "font") font = String(v);
          t[k] = v;
          return true;
        },
      }
    );
    plotMod.drawPlot(ctx, 900, 400, result, {
      styles: { h: { color: "#c00", visible: true } },
      view: { xMin: 0, xMax: 2 },
      dpr: 1,
      cursorX: 1,
      theme: plotMod.plotThemeFrom(false),
      readoutScale,
    });
    // The readout's own row: the one that names the trace. Found by its NAME run, because
    // the row is drawn in parts now — the name typeset, the unit, and the value in its own
    // column — so there is no single string left to look for.
    const row = rects.filter(([text]) => text === "h").pop();
    const box = boxes[boxes.length - 1];
    return { font: row ? row[3] : "NONE", row, box };
  };

  const standard = drawAt(1);
  const bigger = drawAt(2);
  assert.equal(standard.font, "11px sans-serif", "the standard size");
  assert.equal(bigger.font, "22px sans-serif", "and twice it");
  // The row's own offset inside the box grows with the text, and so does the box.
  assert.ok(
    Math.abs(bigger.box[3] / standard.box[3] - 2) < 0.05,
    `the box grows with the text (${standard.box[3]} -> ${bigger.box[3]})`
  );
  assert.ok(
    Math.abs(bigger.box[2] / standard.box[2] - 2) < 0.05,
    `and so does its width (${standard.box[2]} -> ${bigger.box[2]})`
  );
  // The box's own padding scales with the text, so the first row sits that much
  // further in: 6px at the standard size, 12px at twice it. The offset from the
  // cursor line is unchanged — that is spacing on the plot, not room for the text.
  assert.equal(standard.row[1] - standard.box[0], 6, "6px of padding at the standard size");
  assert.equal(bigger.row[1] - bigger.box[0], 12, "and 12px at twice it");
});

test("the readout says a variable the way the legend does, with its unit", () => {
  // Reported from a screenshot of the two side by side: the legend had learned to typeset
  // names and carry units, and the box over the plot had not. One said
  // `orifice.m_flow  kg/s` and the other said `orifice.m_flow = 0.9844`.
  const texts = [];
  const rects = [];
  const dots = [];
  let font = "";
  const ctx = new Proxy(
    {
      canvas: { width: 900, height: 400 },
      font,
      fillStyle: "",
      strokeStyle: "",
      globalAlpha: 1,
      textAlign: "",
      textBaseline: "",
    },
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === "measureText") {
          const size = Number(/([0-9.]+)px/.exec(font)?.[1] ?? 11);
          return (s2) => ({ width: String(s2).length * size * 0.5 });
        }
        if (k === "fillText") {
          return (label, x, y) => texts.push({ label: String(label), x, y, font, align: t.textAlign });
        }
        if (k === "arc") return (x, y, r) => dots.push({ x, y, r, font });
        if (k === "fillRect") return (x, y, w, h) => rects.push([x, y, w, h]);
        return () => {};
      },
      set(t, k, v) {
        if (k === "font") font = String(v);
        t[k] = v;
        return true;
      },
    }
  );
  const time = [0, 1, 2];
  const result = {
    time,
    series: [
      { name: "orifice.m_flow", values: [0, 1, 2], unit: "kg/s" },
      { name: "supply.flowModel.Is[1]", values: [0, 3, 6], unit: "kg/s" },
      { name: "der(orifice.m_flow)", values: [0, 1, 2], unit: "kg/s" },
      { name: "no.unit.here", values: [0, 1, 2], unit: "" },
    ],
    compileMs: 1, simulateMs: 1, reusedBinary: true, warnings: [],
  };
  plotMod.drawPlot(ctx, 900, 400, result, {
    styles: {
      "orifice.m_flow": { color: "#a00", visible: true },
      "supply.flowModel.Is[1]": { color: "#0a0", visible: true },
      "der(orifice.m_flow)": { color: "#a0a", visible: true },
      "no.unit.here": { color: "#00a", visible: true },
    },
    view: { xMin: 0, xMax: 2 },
    dpr: 1,
    cursorX: 1.5,
    theme: plotMod.plotThemeFrom(false),
  });

  const at = (label) => texts.filter((t) => t.label === label);
  const box = rects[rects.length - 1];
  // The readout's own texts, found by the box they are drawn in: the axis labels are
  // right-aligned too, and the legend names the same series with the same units a few
  // hundred pixels to the right.
  const inBox = texts.filter(
    (t) =>
      t.x >= box[0] && t.x <= box[0] + box[2] && t.y >= box[1] && t.y <= box[1] + box[3]
  );

  const base = at("m")[0];
  const suffix = at("flow")[0];
  assert.ok(base && suffix, `the name is drawn in runs, got ${JSON.stringify(inBox.map((t) => t.label))}`);
  assert.ok(
    suffix.y > base.y && suffix.x > base.x,
    "`m_flow` is an m with a subscript that sits lower and to its right"
  );
  assert.ok(
    Number(/([0-9.]+)px/.exec(suffix.font)?.[1]) < Number(/([0-9.]+)px/.exec(base.font)?.[1]),
    "and smaller"
  );
  const is = at("Is")[0];
  const index = at("1").find((t) => is && t.y > is.y);
  assert.ok(is && index, "`Is[1]` is Is with an index, not a bracket pair");

  assert.equal(
    inBox.filter((t) => t.label === "kg/s").length,
    3,
    "the unit is drawn once for each row that has one"
  );
  // The unit-less series still gets its row: its name is drawn in runs too, so the check is
  // for one of them rather than for the whole string, which is never drawn as one.
  assert.ok(
    inBox.some((t) => t.label === "here"),
    `a variable with no unit still gets its row (${JSON.stringify(inBox.map((t) => t.label))})`
  );

  // The table: every value right-aligned at ONE x, so two magnitudes can be compared down
  // the box. That is the part a reader gets wrong by eye when the numbers are ragged.
  const values = inBox.filter((t) => t.align === "right");
  assert.equal(values.length, 4, `one value per row, got ${JSON.stringify(values.map((t) => t.label))}`);
  assert.equal(
    new Set(values.map((t) => Math.round(t.x))).size,
    1,
    `the values share a right edge (${values.map((t) => t.x).join(", ")})`
  );
  assert.equal(
    inBox.filter((t) => t.label === "= ").length,
    4,
    "and the `=` sits in a column of its own, at one x for every row"
  );
  assert.equal(
    new Set(inBox.filter((t) => t.label === "= ").map((t) => Math.round(t.x))).size,
    1,
    "which is what stops `= 9863` and `= 0.9844` from staggering"
  );

  // The derivative dot: over the letter it differentiates, and placed the way the LEGEND
  // places it. The readout used to draw its text on a `top` baseline while the dot was
  // measured from the baseline a letter sits on, so it floated a third of an em too high —
  // reported from a screenshot of exactly that.
  // One derivative, so one dot in the readout — and the legend draws the same trace, so its
  // dot is there as well. They are told apart by the box the readout occupies.
  const mine = dots.filter((d) => d.x >= box[0] && d.x <= box[0] + box[2]);
  assert.equal(mine.length, 1, `the readout draws one dot (${mine.length} of ${dots.length} in its box)`);
  const dot = mine[0];
  // The letter the dot belongs to: in the box, and on the dot's own row. There are two `m`s in
  // there — `orifice.m_flow` and the derivative of it — and the dot is over the second.
  const letter = inBox
    .filter((t) => t.label === "m" && t.align === "left")
    .sort((a, b) => Math.abs(a.y - (dot.y + 5.5)) - Math.abs(b.y - (dot.y + 5.5)))[0];
  assert.ok(letter, "the letter the dot belongs to");
  const rise = letter.y - dot.y;
  assert.ok(
    rise > 0,
    `the dot is above the letter's own baseline (dot=${JSON.stringify(dot)}, letter=${JSON.stringify(letter)})`
  );
  assert.ok(
    Math.abs(rise / 11 - 0.5) < 0.1,
    `by half an em, as the legend does it (${rise.toFixed(1)}px at 11px)`
  );
  assert.ok(
    Math.abs(dot.r - 1.1) < 0.3,
    `and it scales with the text rather than being a fixed speck (r=${dot.r.toFixed(2)})`
  );
});

test("the crossing snap can be switched off, and its reach is a pixel distance", () => {
  // Both were hard-wired: the snap always fired, and it always reached 1% of the
  // time axis -- a different number of seconds at every zoom level, and the same
  // number of PIXELS only by accident. The settings now carry a switch and a
  // distance, and both have to reach the drawing.
  const time = [0, 1, 2, 3, 4];
  const result = {
    time,
    series: [
      { name: "a", values: [0, 1, 2, 3, 4], unit: "" },
      { name: "b", values: [4, 3, 2, 1, 0], unit: "" },
    ],
    compileMs: 1,
    simulateMs: 1,
    reusedBinary: true,
    warnings: [],
  };
  const styles = { a: { color: "#c00", visible: true }, b: { color: "#06c", visible: true } };

  /** The cursor readout text at `cursorX`, over the given view. */
  const readout = (view, cursorX, opts) => {
    const rows = [];
    const ctx = new Proxy(
      {
        canvas: { width: 900, height: 400 },
        font: "",
        fillStyle: "",
        strokeStyle: "",
        globalAlpha: 1,
        textAlign: "",
        textBaseline: "",
      },
      {
        get(t, k) {
          if (k in t) return t[k];
          if (k === "measureText") return (s) => ({ width: String(s).length * 6 });
          if (k === "fillText") return (text) => rows.push(String(text));
          return () => {};
        },
        set(t, k, v) {
          t[k] = v;
          return true;
        },
      }
    );
    plotMod.drawPlot(ctx, 900, 400, result, {
      styles,
      view,
      dpr: 1,
      cursorX,
      theme: plotMod.plotThemeFrom(false),
      ...opts,
    });
    return rows.join(" | ");
  };

  // 900px wide, and the legend takes its share, leaving 712px of axes: at
  // xMax = 4 that is 178px per second, so a cursor at 2.02s is 3.56px from the
  // crossing at 2s.
  const near = readout({ xMin: 0, xMax: 4 }, 2.02, { snapTolerancePx: 4 });
  assert.match(near, /\(crossing\)/, `4px reaches a 3.56px gap: ${near}`);
  const far = readout({ xMin: 0, xMax: 4 }, 2.02, { snapTolerancePx: 3 });
  assert.doesNotMatch(far, /\(crossing\)/, `3px must not reach 3.56px: ${far}`);

  // The same gap on a plot zoomed out to 8 seconds is 89px per second, so it
  // takes a cursor at 2.04s. The SAME two tolerances decide it the same way --
  // which is the point of measuring in pixels, and what a window in seconds
  // cannot do.
  const zoomedNear = readout({ xMin: 0, xMax: 8 }, 2.04, { snapTolerancePx: 4 });
  assert.match(zoomedNear, /\(crossing\)/, `4px reaches 3.56px when zoomed out: ${zoomedNear}`);
  const zoomedFar = readout({ xMin: 0, xMax: 8 }, 2.04, { snapTolerancePx: 3 });
  assert.doesNotMatch(zoomedFar, /\(crossing\)/, `3px must not, either: ${zoomedFar}`);

  // With nothing passed, the plot's own default applies -- the path an embed or
  // any other caller takes. 7px reaches a 3.56px gap.
  assert.match(
    readout({ xMin: 0, xMax: 4 }, 2.02, {}),
    /\(crossing\)/,
    "the default distance is used when the settings do not pass one"
  );
  assert.equal(plotMod.SNAP_TOLERANCE_PX, 7, "and it is the number the settings default to");

  // Switched off, the readout stays where the pointer is -- not merely silent
  // about the crossing.
  const off = readout({ xMin: 0, xMax: 4 }, 2.02, { snapIntersections: false, snapTolerancePx: 20 });
  assert.doesNotMatch(off, /\(crossing\)/, `switched off: ${off}`);
  assert.match(off, /t = 2\.02/, `the cursor is left where it was: ${off}`);

  // A value that is not a usable distance -- a hand-edited data.json -- falls
  // back rather than switching the snap off or making it unbounded.
  assert.equal(plotMod.snapTolerancePx(undefined), 7);
  assert.equal(plotMod.snapTolerancePx(Number.NaN), 7);
  assert.equal(plotMod.snapTolerancePx(0), plotMod.MIN_SNAP_TOLERANCE_PX, "never zero-width");
  assert.equal(plotMod.snapTolerancePx(1e6), plotMod.MAX_SNAP_TOLERANCE_PX, "nor the whole plot");
});
