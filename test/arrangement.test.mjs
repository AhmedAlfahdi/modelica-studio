/**
 * Porting an arrangement from a vault into the shipped example.
 *
 * The dangerous half of this job is the half that guesses. An arrangement is only an
 * arrangement while the model is the same: the moment a component is added, renamed or
 * given a different parameter, "apply the placements" would ship a model neither the
 * user nor this repository wrote. These tests are about the refusal, not the copy.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { planArrangement, sourceFrom } from "../scripts/apply-arrangement.mjs";

const SHIPPED = `model Demo "A demo"
  Modelica.Blocks.Sources.Step step(height=1, startTime=0.1)
    annotation(Placement(transformation(extent={{-80,30},{-60,50}})));
  Modelica.Mechanics.Translational.Sources.Force force
    annotation(Placement(transformation(extent={{-80,-10},{-60,10}})));
  Modelica.Mechanics.Translational.Components.Mass mass(m=1)
    annotation(Placement(transformation(extent={{20,-10},{40,10}})));
equation
  connect(step.y, force.f);
  connect(force.flange, mass.flange_a);
end Demo;`;

/** The same model, with the Step moved down beside the Force. */
const MOVED = SHIPPED.replace("{{-80,30},{-60,50}}", "{{-80,10},{-60,30}}");

test("a moved component is reported, with both placements", async () => {
  const { changes, refusals } = await planArrangement(SHIPPED, MOVED, "Demo");
  assert.deepEqual(refusals, [], "moving a component is not a refusal");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].component, "step");
  assert.match(changes[0].from, /-80,30/);
  assert.match(changes[0].to, /-80,10/);
});

test("an unchanged model has nothing to port", async () => {
  const { changes, refusals } = await planArrangement(SHIPPED, SHIPPED, "Demo");
  assert.deepEqual(changes, []);
  assert.deepEqual(refusals, []);
});

test("a changed parameter is refused, not applied", async () => {
  // The dangerous case: it looks like an arrangement, and it is a different model. Its
  // numbers in the note's table would be wrong from that moment on.
  const { changes, refusals } = await planArrangement(SHIPPED, SHIPPED.replace("mass(m=1)", "mass(m=2)"), "Demo");
  assert.deepEqual(changes, []);
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /not only moved/);
  assert.match(refusals[0], /m=2/);
});

test("a new or missing component is refused", async () => {
  const added = SHIPPED.replace(
    "equation",
    "  Modelica.Mechanics.Translational.Components.Damper d(d=1)\n    annotation(Placement(transformation(extent={{0,-10},{20,10}})));\nequation"
  );
  const a = await planArrangement(SHIPPED, added, "Demo");
  assert.deepEqual(a.changes, []);
  assert.match(a.refusals.join("\n"), /is in your version but not in the shipped example/);

  const removed = SHIPPED.replace(/  Modelica\.Blocks\.Sources\.Step[\s\S]*?\)\)\);\n/, "");
  const b = await planArrangement(SHIPPED, removed, "Demo");
  assert.match(b.refusals.join("\n"), /missing from your version/);
});

test("a renamed component is refused rather than treated as new and gone", async () => {
  const renamed = SHIPPED.replace(/\bmass\b/g, "inertia");
  const { refusals } = await planArrangement(SHIPPED, renamed, "Demo");
  assert.ok(refusals.length >= 2, `both the old and the new name are reported: ${refusals.length}`);
});

test("the parser reads components, their placements and their parameters", async () => {
  // Reported through the planner: a component the plugin can see is a component this can
  // move, and the parameters it reads are what the refusal rules compare.
  const { refusals } = await planArrangement(SHIPPED, MOVED, "Demo");
  assert.deepEqual(refusals, [], "three components, one of them moved, none refused");
  const added = SHIPPED.replace(
    "equation",
    "  Modelica.Mechanics.Translational.Components.Damper d(useHeatPort=false)\n    annotation(Placement(transformation(extent={{0,-10},{20,10}})));\nequation"
  );
  const withExtra = await planArrangement(SHIPPED, added, "Demo");
  assert.match(withExtra.refusals.join("\n"), /Demo\.d: is in your version/);
});

test("a note's block is read without its directive", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arrangement-"));
  const note = path.join(dir, "demo.md");
  fs.writeFileSync(note, "---\n\n```modelica\n//@ time=5\n" + SHIPPED + "\n```\n");
  const source = sourceFrom(note);
  assert.doesNotMatch(source, /\/\/@/, "the directive is not Modelica and is dropped");
  assert.match(source, /^model Demo /m);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a component named in the class comment is not the component that moves", async () => {
  // The bug that put three placements on the wrong components in a real example:
  // `model HeatExchanger "A heated mass losing heat to ambient"` — the word "mass" appears
  // in the comment, the search for the component by name found that first, and the next
  // annotation after it belonged to `heater`. Mass's placement was written onto heater,
  // which is exactly what a reader saw when they opened the example.
  const { applyOne } = await import("../scripts/apply-arrangement.mjs");
  const source = `model Demo "A heated mass losing heat to ambient"
  Modelica.Thermal.HeatTransfer.Sources.PrescribedHeatFlow heater
    annotation(Placement(transformation(extent={{50,-30},{70,-10}})));
  Modelica.Thermal.HeatTransfer.Components.HeatCapacitor mass(C=2000, T(start=293.15))
    annotation(Placement(transformation(extent={{-10,10},{10,30}})));
end Demo;`;

  const moved = applyOne(source, "mass", "extent={{-30,10},{-10,30}}");
  assert.match(moved, /heater\n\s+annotation\(Placement\(transformation\(extent=\{\{50,-30\},\{70,-10\}\}\)\)\)/, "heater is unmoved");
  assert.match(moved, /mass\(C=2000[\s\S]*?extent=\{\{-30,10\},\{-10,30\}\}/, "mass moved, through its own nested parameter list");

  // And the same call must not throw for a component whose type has no parameter list.
  const simple = applyOne(source, "heater", "extent={{0,0},{20,20}}");
  assert.match(simple, /heater\n\s+annotation\(Placement\(transformation\(extent=\{\{0,0\},\{20,20\}\}/, "heater can be moved too");
});
