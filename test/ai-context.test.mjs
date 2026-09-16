/**
 * The brief the AI is given, and the run log it is built from.
 *
 * Both exist because the model was writing for a machine it could not see, and
 * being asked to fix a failure from the first line of a compiler message.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";

const ctx = await import(path.join(buildLibs("ai-ctx", ["src/ai/context.ts"]), "context.js"));
const { describeEnvironment, describeAvailableClasses, describeLog } = ctx;
const logMod = await import(path.join(buildLibs("ai-log", ["src/ai/run-log.ts"]), "run-log.js"));
const { RunLog } = logMod;

const ENV = {
  omcPath: "/usr/bin/omc",
  omcVersion: "1.27.0",
  libraryNames: ["Modelica 4.1.0+maint.om"],
  classCount: 4782,
  startTime: 0,
  stopTime: 20,
  numberOfIntervals: 500,
  tolerance: 1e-6,
  solver: "dassl",
  jobs: 8,
  excluded: ["Modelica.Media"],
};

test("the environment brief states what a model would otherwise get wrong", () => {
  const text = describeEnvironment(ENV);
  // Which compiler and which library: otherwise class names get invented.
  assert.match(text, /OpenModelica 1\.27\.0/);
  assert.match(text, /Modelica 4\.1\.0/);
  assert.match(text, /4782/);
  // The run settings, so parameters are chosen for the run that will happen.
  assert.match(text, /stopTime=20/);
  assert.match(text, /tolerance=0\.000001/);
  assert.match(text, /solver=dassl/);
  // No experiment annotation: the plugin sets the run and an annotation conflicts.
  assert.match(text, /do NOT add an `experiment` annotation/);
  // Exclusions, or the model uses libraries the user removed on purpose.
  assert.match(text, /Modelica\.Media/);
});

test("a missing OpenModelica is stated rather than omitted", () => {
  const text = describeEnvironment({ ...ENV, omcVersion: undefined, omcPath: undefined });
  assert.match(text, /not detected/);
});

test("an unset solver is described as the default, not as empty", () => {
  const text = describeEnvironment({ ...ENV, solver: "" });
  assert.match(text, /OpenModelica's default/);
});

test("no exclusions means the line is absent, not empty", () => {
  const text = describeEnvironment({ ...ENV, excluded: [] });
  assert.ok(!/excluded by the user/.test(text), "nothing is claimed about exclusions");
});

test("available classes are grouped by package and exclude what the user removed", () => {
  const fake = {
    size: 3,
    isExcluded: (n) => n.startsWith("Modelica.Fluid"),
    listPlaceable: (filter) =>
      [
        { name: "Modelica.Electrical.Analog.Basic.Resistor" },
        { name: "Modelica.Electrical.Analog.Basic.Capacitor" },
        { name: "Modelica.Fluid.Vessels.OpenTank" },
      ].filter((d) => !filter || d.name.toLowerCase().includes(String(filter).toLowerCase())),
  };
  const text = describeAvailableClasses(fake, "resistor capacitor");
  assert.match(text, /Modelica\.Electrical\.Analog\.Basic: Resistor, Capacitor/);
  assert.ok(!/OpenTank/.test(text), "an excluded class is not offered to the model");
});

test("a library that is still building says so rather than claiming to be empty", () => {
  const text = describeAvailableClasses(undefined, "anything");
  assert.match(text, /still being built/);
  const empty = describeAvailableClasses({ size: 0, isExcluded: () => false, listPlaceable: () => [] }, "x");
  assert.match(empty, /still being built/);
});

test("the log keeps runs, caps them, and finds the last failure", () => {
  const log = new RunLog();
  assert.equal(log.lastFailure(), undefined, "nothing has failed yet");
  log.add({ at: "t1", model: "A", ok: true, source: "", parameters: {}, settings: { startTime: 0, stopTime: 1, tolerance: 1e-6, numberOfIntervals: 100, solver: "" }, detail: "fine" });
  log.add({ at: "t2", model: "B", ok: false, source: "", parameters: {}, settings: { startTime: 0, stopTime: 1, tolerance: 1e-6, numberOfIntervals: 100, solver: "" }, detail: "Variable m not found" });
  assert.equal(log.lastFailure().model, "B");
  assert.equal(log.last().model, "B", "the last run is the failed one");
  assert.equal(log.recentFailures().length, 1);

  // A long session must not grow without bound.
  for (let i = 0; i < 80; i++) {
    log.add({ at: `t${i}`, model: "X", ok: true, source: "", parameters: {}, settings: { startTime: 0, stopTime: 1, tolerance: 1e-6, numberOfIntervals: 100, solver: "" }, detail: "" });
  }
  assert.ok(log.size <= 50, `capped, got ${log.size}`);
});

test("the log text is what is sent, full output included", () => {
  const log = new RunLog();
  const detail = [
    "[/tmp/m.mo:5:3] Error: Variable m not found in scope M.",
    "[/tmp/m.mo:5:3] Error: Variable g not found in scope M.",
  ].join("\n");
  log.add({
    at: "2026-01-01T00:00:00Z",
    model: "M",
    ok: false,
    source: "model M\nend M;",
    parameters: { "mass.m": "2" },
    settings: { startTime: 0, stopTime: 5, tolerance: 1e-6, numberOfIntervals: 500, solver: "dassl" },
    detail,
  });
  const text = log.toText();
  // Every line of the compiler output, not just the first: the first is often a
  // path, and the line naming the fault comes later.
  assert.match(text, /Variable m not found/);
  assert.match(text, /Variable g not found/);
  assert.match(text, /t=0\.\.5/, "the span that was actually run is recorded");
  assert.match(text, /mass\.m=2/, "the parameters that were used are recorded");
});

test("an empty log says so rather than rendering nothing", () => {
  assert.match(new RunLog().toText(), /No simulations have been run yet/);
});

test("the prompt renders recent failures with their full output", () => {
  const entries = [
    { at: "t1", model: "A", ok: false, detail: "first failure" },
    { at: "t2", model: "B", ok: true, detail: "ok" },
    { at: "t3", model: "C", ok: false, detail: "line one\nline two" },
  ];
  const text = describeLog(entries);
  assert.match(text, /Recent failed runs/);
  assert.match(text, /line one\nline two/, "multi-line output survives");
  assert.ok(!/model: B/.test(text), "successful runs are not part of a repair prompt");
  // A prompt should not carry the whole session.
  assert.ok(describeLog(entries, 1).split("###").length <= 3, "the limit is honoured");
});

test("no failures means no section at all", () => {
  assert.equal(describeLog([]), "", "nothing is added to a prompt that has no failures");
  assert.equal(describeLog([{ at: "t", model: "A", ok: true, detail: "" }]), "");
});
