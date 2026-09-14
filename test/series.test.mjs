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

const LIB = buildLibs("series-lib", ["src/view/series.ts"]);
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
