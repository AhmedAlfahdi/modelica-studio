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
  // The legend: its swatch labels are drawn further right again, or, when there
  // is no room for both, not at all.
  // The legend's rows are the only text shortened this way; `fitLabel` marks them
  // with a leading ellipsis.
  const legendNames = text.filter((t) => t.label.startsWith("…"));
  assert.ok(axis.length > 0, `the second axis is labelled (${text.map((t) => t.label).join(" | ")})`);

  const axisRight = Math.max(...axis.map((t) => t.x + t.label.length * 11 * 0.55));

  // The pane in the report: narrow enough that the strip beside the axis is only
  // about 70px, which is a truncated legend — not none, and not a collision.
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

test("a legend names the run on screen as well as the family", () => {
  // Reported from a screenshot: two curves, and no way to tell 10 V from 15 V.
  const rows = [];
  const ctx = new Proxy(
    { canvas: { width: 900, height: 400 }, font: "", fillStyle: "", strokeStyle: "", globalAlpha: 1, textAlign: "", textBaseline: "" },
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === "measureText") return (s2) => ({ width: String(s2).length * 6 });
        if (k === "fillText") return (text) => rows.push(String(text));
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
  const legend = rows.filter((r) => r.includes("source.V="));
  assert.equal(legend.length, 2, `both curves are named in the legend, got ${JSON.stringify(rows)}`);
  assert.ok(legend.some((r) => r.endsWith("source.V=15")), "including the one on screen");
  assert.ok(legend.some((r) => r.endsWith("source.V=10")), "and the one behind it");
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
    // The readout's own row: the one that names the trace.
    const row = rects.filter(([text]) => text.startsWith("h = ")).pop();
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
