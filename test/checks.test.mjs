/**
 * Local equation checks.
 *
 * These exist because a model can name something that does not exist and nothing
 * says so until OpenModelica compiles it. An AI-written model using an
 * undeclared `m` and `g` got as far as the compiler and came back with
 * "Variable m not found in scope".
 *
 * The tests that matter most are the ones asserting it stays QUIET: a check that
 * fires on correct code is worse than no check, because it teaches people to
 * ignore it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { buildLibs, repoRoot } from "./helpers/build.mjs";

const { checkModel } = await import(
  path.join(buildLibs("checks-lib", ["src/modelica/checks.ts"]), "checks.js")
);

/** The declared-name set, which every check takes. */
const declared = (...names) => new Set(names);

// The settings shape, the defaults and the merge rules are one pure module, so
// they are tested together and without Obsidian.
const { DEFAULT_SETTINGS, mergeSettings, migrateSettings } = await import(
  path.join(buildLibs("settings-merge", ["src/settings-merge.ts"]), "settings-merge.js")
);

test("a name used in an equation but never declared is reported", () => {
  // The exact failure: mass and gravity used in eight places, neither declared.
  const problems = checkModel({
    declared: declared("s", "v", "a", "N", "Fg", "alpha", "mu_s", "mu_d"),
    equations: ["N = m*g*cos(alpha);", "Fg = m*g*sin(alpha);", "v = der(s);", "a = der(v);"],
    hasComponents: false,
    firstEquationLine: 1,
  });
  const names = problems.filter((p) => p.severity === "error").map((p) => /"(\w+)"/.exec(p.message)[1]);
  assert.deepEqual(names.sort(), ["g", "m"], "both undeclared names are named");
  assert.match(problems[0].message, /never declared/);
});

test("declaring them silences the check", () => {
  const problems = checkModel({
    declared: declared("s", "v", "a", "N", "Fg", "alpha", "mu_s", "mu_d", "m", "g"),
    equations: ["N = m*g*cos(alpha);", "Fg = m*g*sin(alpha);", "v = der(s);", "a = der(v);"],
    hasComponents: false,
    firstEquationLine: 1,
  });
  assert.deepEqual(problems, [], `expected no problems, got ${JSON.stringify(problems)}`);
});

test("builtins, time and the derivative operator are not undeclared names", () => {
  // The whole risk of a check like this is false alarms on ordinary code.
  const problems = checkModel({
    declared: declared("y", "x"),
    equations: [
      "der(y) = -y + sin(time) + abs(x);",
      "when y <= 0 then",
      "  reinit(y, 1);",
      "end when;",
      "assert(y >= -1, \"below range\");",
    ],
    hasComponents: false,
    firstEquationLine: 1,
  });
  assert.deepEqual(problems.filter((p) => p.severity === "error"), []);
});

test("a component's field is not an undeclared variable", () => {
  // `tank.level` is resolved through the component, so only the root is checked
  // — and the root is declared.
  const problems = checkModel({
    declared: declared("tank", "orifice"),
    equations: ["tank.level = 1;", "orifice.m_flow = 0.01;"],
    hasComponents: true,
    firstEquationLine: 1,
  });
  assert.deepEqual(problems, []);
});

test("a qualified library path is not an undeclared variable", () => {
  const problems = checkModel({
    declared: declared("x"),
    equations: ["x = Modelica.Constants.pi;"],
    hasComponents: false,
    firstEquationLine: 1,
  });
  // A library path is a class reference, not a variable. The model IS static, so
  // the time warning is correct and expected here; what matters is that no
  // undeclared-name error is raised for `Modelica`.
  assert.deepEqual(problems.filter((p) => p.severity === "error"), []);
  assert.equal(problems.length, 1, "only the static-model warning");
});

test("comments and strings are not scanned for names", () => {
  const problems = checkModel({
    declared: declared("y"),
    equations: ['y = 1; // see undeclaredName for details', 'y = 2 "anotherUndeclared";'],
    hasComponents: false,
    firstEquationLine: 1,
  });
  // Names inside a comment and a doc string must not be reported. (These two
  // equations are also static, so the time warning legitimately appears.)
  const errors = problems.filter((p) => p.severity === "error");
  assert.deepEqual(errors, [], `no undeclared names from comments or strings, got ${JSON.stringify(errors)}`);
});

test("a model that cannot vary in time is flagged", () => {
  // This is the other error the user hit: "Found equation without
  // time-dependent variables", from a model of a source and a resistor.
  const problems = checkModel({
    declared: declared("y", "k", "u"),
    equations: ["y = k*u;"],
    hasComponents: false,
    firstEquationLine: 1,
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /changes with time/);
  assert.equal(problems[0].severity, "warning");
});

test("a static model with library components is fine", () => {
  // Components carry their own equations, and a DC circuit is legitimately
  // static between its initial and final values. Nothing to warn about.
  const problems = checkModel({
    declared: declared("source", "resistor"),
    equations: ["connect(source.p, resistor.p);"],
    hasComponents: true,
    firstEquationLine: 1,
  });
  assert.deepEqual(problems, []);
});

test("an event-driven model needs no derivative", () => {
  const problems = checkModel({
    declared: declared("state", "tick"),
    equations: ["when tick then", "  state = not pre(state);", "end when;"],
    hasComponents: false,
    firstEquationLine: 1,
  });
  assert.deepEqual(problems, []);
});

test("fixed on a parameter is reported, because its error names nothing useful", () => {
  // OpenModelica answers `parameter Real m(... fixed = true)` with
  //
  //     Modified element m not found in class Real.
  //
  // which names neither the declaration nor the attribute. `fixed` describes
  // whether a VARIABLE holds its start value; on a parameter it does nothing,
  // because a parameter is already fixed for the run.
  const problems = checkModel({
    declared: declared("mu_s", "x"),
    declarations: [
      { name: "mu_s", text: 'parameter Real mu_s(start = 0.5, fixed = true) "friction";', line: 2 },
    ],
    equations: ["der(x) = 1;"],
    hasComponents: false,
    firstEquationLine: 5,
  });
  assert.equal(problems.filter((p) => p.severity === "error").length, 1);
  assert.match(problems[0].message, /fixed/);
  assert.match(problems[0].message, /parameter/, "it says why");
  assert.equal(problems[0].line, 2, "and which declaration");
});

test("fixed on a variable is NOT reported", () => {
  // The counterpart that matters: `fixed` is correct and necessary on a state,
  // and a check that flagged it would be worse than none.
  const problems = checkModel({
    declared: declared("s", "v"),
    declarations: [
      { name: "s", text: "Real s(start = 0, fixed = true);", line: 3 },
      { name: "v", text: "Real v(start = 0, fixed = true);", line: 4 },
    ],
    equations: ["der(s) = v;", "der(v) = -1;"],
    hasComponents: false,
    firstEquationLine: 6,
  });
  assert.deepEqual(problems, [], `expected silence, got ${JSON.stringify(problems)}`);
});

test("constant is treated like parameter, and multi-line declarations are seen", () => {
  const problems = checkModel({
    declared: declared("k", "x"),
    declarations: [
      { name: "k", text: "constant Real k(quantity = \"Mass\", unit = \"kg\", fixed = true) = 1;", line: 4 },
    ],
    equations: ["der(x) = k;"],
    hasComponents: false,
    firstEquationLine: 7,
  });
  assert.equal(problems.filter((p) => p.message.includes("fixed")).length, 1);
});

test("components stacked at the same place are reported", () => {
  // Two parts at one position are drawn as one block and cannot be wired by
  // hand, which is what "eight blocks stacked on the diagram" looked like.
  const problems = checkModel({
    declared: declared("a", "b"),
    equations: [],
    hasComponents: true,
    firstEquationLine: 8,
    components: [
      { id: "a", extent: [0, 0, 20, 20], connectedPins: ["p"], fromLibrary: true },
      { id: "b", extent: [0, 0, 20, 20], connectedPins: ["p"], fromLibrary: true },
    ],
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /same position/);
  assert.match(problems[0].message, /a, b/);
});

test("components with no Placement are reported together, not one by one", () => {
  // A model where nothing was placed produces one message naming them all,
  // rather than a wall of identical ones.
  const problems = checkModel({
    declared: declared("a", "b", "c"),
    equations: [],
    hasComponents: true,
    firstEquationLine: 8,
    components: [
      { id: "a", connectedPins: ["p"], fromLibrary: true },
      { id: "b", connectedPins: ["p"], fromLibrary: true },
      { id: "c", connectedPins: ["p"], fromLibrary: true },
    ],
  });
  assert.equal(problems.length, 1, "one message");
  assert.match(problems[0].message, /no Placement/);
  assert.match(problems[0].message, /a, b, c/);
});

test("a component in no connect is reported as unwired", () => {
  const problems = checkModel({
    declared: declared("a", "b", "stray"),
    equations: [],
    hasComponents: true,
    firstEquationLine: 8,
    components: [
      { id: "a", extent: [0, 0, 20, 20], connectedPins: ["p"], fromLibrary: true },
      { id: "b", extent: [40, 0, 60, 20], connectedPins: ["n"], fromLibrary: true },
      { id: "stray", extent: [80, 0, 100, 20], connectedPins: [], fromLibrary: true },
    ],
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /appear in no connect: stray/);
});

test("a properly laid out and wired diagram is silent", () => {
  // The check has to be quiet on exactly what the prompt asks for, or it would
  // nag about every correct answer.
  const problems = checkModel({
    declared: declared("source", "r1", "r2", "ground"),
    equations: [],
    hasComponents: true,
    firstEquationLine: 10,
    components: [
      { id: "source", extent: [-60, -10, -40, 10], connectedPins: ["p", "n"], fromLibrary: true },
      { id: "r1", extent: [-20, 30, 0, 50], connectedPins: ["p", "n"], fromLibrary: true },
      { id: "r2", extent: [20, -10, 40, 10], connectedPins: ["p", "n"], fromLibrary: true },
      { id: "ground", extent: [-60, -50, -40, -30], connectedPins: ["p"], fromLibrary: true },
    ],
  });
  assert.deepEqual(problems, [], `expected silence, got ${JSON.stringify(problems)}`);
});

test("an equation model is not judged as a diagram", () => {
  // With no library components there is nothing to lay out, so the diagram
  // checks must not fire.
  const problems = checkModel({
    declared: declared("h", "v"),
    equations: ["der(h) = v;", "der(v) = -9.81;"],
    hasComponents: false,
    firstEquationLine: 5,
  });
  assert.deepEqual(problems, []);
});

/* ---- stored settings must not erase new defaults ---- */

test("a stored settings group keeps fields it predates", () => {
  // This is not cosmetic. The stored `ai` object used to REPLACE the default one
  // wholesale, so every field added to AiConfig after a user's settings were
  // first written was silently lost. `thinking: "disabled"` never survived a
  // reload, so every request ran in DeepSeek's high-effort thinking mode --
  // minutes of reasoning before an answer -- and timed out. The setting was
  // correct and had no effect.
  const defaults = { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, thinking: "disabled", timeoutSeconds: 120 } };
  // A config written before those fields existed.
  const stored = { ai: { model: "deepseek-flash", temperature: 0.2, baseUrl: "https://api.deepseek.com/v1" } };

  const merged = mergeSettings(defaults, stored);
  assert.equal(merged.ai.thinking, "disabled", "the new field survives");
  assert.equal(merged.ai.timeoutSeconds, 120, "and so does this one");
  assert.equal(merged.ai.model, "deepseek-flash", "the stored value still wins");
  assert.equal(merged.ai.temperature, 0.2, "and every other stored value");
});

test("user data maps replace rather than merge", () => {
  // modelFiles is a map of the user's own data, not a group of settings: merging
  // it would make a deleted entry impossible to remove.
  const defaults = { ...DEFAULT_SETTINGS, modelFiles: {} };
  const merged = mergeSettings(defaults, { modelFiles: { Tank: "Modelica/Tank.mo" } });
  assert.deepEqual(merged.modelFiles, { Tank: "Modelica/Tank.mo" });
  const emptied = mergeSettings(defaults, { modelFiles: {} });
  assert.deepEqual(emptied.modelFiles, {}, "an emptied map stays empty");
});

test("nothing stored leaves the defaults untouched", () => {
  assert.deepEqual(mergeSettings(DEFAULT_SETTINGS, null), DEFAULT_SETTINGS);
  assert.deepEqual(mergeSettings(DEFAULT_SETTINGS, undefined), DEFAULT_SETTINGS);
  // And a key explicitly absent is not set to undefined, which would defeat
  // every `?? default` at the point of use.
  const merged = mergeSettings(DEFAULT_SETTINGS, { omcPath: undefined });
  assert.equal(merged.omcPath, DEFAULT_SETTINGS.omcPath);
});

test("an old setting value is brought forward, not left inert", () => {
  // `thinking` was a switch whose "on" value was the string "disabled". It is now
  // a level. An unrecognised value reaches the provider as a parameter it accepts
  // and ignores -- which would put the setting back to having no effect, the exact
  // failure this area already had once.
  const base = { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai } };
  assert.equal(migrateSettings({ ...base, ai: { ...base.ai, thinking: "disabled" } }).ai.thinking, "off");
  assert.equal(migrateSettings({ ...base, ai: { ...base.ai, thinking: "default" } }).ai.thinking, "high");
  // Valid levels are left alone.
  for (const level of ["off", "low", "high", "max"]) {
    assert.equal(migrateSettings({ ...base, ai: { ...base.ai, thinking: level } }).ai.thinking, level);
  }
  // And a config predating the style choice asks for a diagram.
  assert.equal(migrateSettings({ ...base, ai: { ...base.ai, style: undefined } }).ai.style, "visual");
  assert.equal(migrateSettings({ ...base, ai: { ...base.ai, style: "equations" } }).ai.style, "equations");
});

/* ---- solver names, and the silent failure they cause ---- */

const { describeUnusableResult } = await import(
  path.join(buildLibs("omc-unusable", ["src/omc/backend.ts"]), "backend.js")
);

test("a NaN result is a failure, not a successful run", () => {
  // An unrecognised solver name is not an error to OpenModelica: it warns, exits
  // 0, and writes a result file full of NaN. `rungekutta4` does exactly that --
  // the real name is `rungekutta` -- and this plugin's own settings recommended
  // it until it was measured.
  const nan = {
    time: [0, 1],
    series: [{ name: "y", values: [NaN, NaN] }],
    compileMs: 0,
    simulateMs: 0,
    reusedBinary: true,
    warnings: [],
  };
  const problem = describeUnusableResult(nan, "rungekutta4");
  assert.ok(problem, "it is rejected");
  assert.match(problem, /does not recognise the solver/, "as a typo");
  assert.match(problem, /rungekutta", not "rungekutta4"/, "naming the fix");
});

test("a known solver returning nothing is a different message", () => {
  // Same symptom, different cause: the spelling is fine, so the advice must not
  // be "check the spelling".
  const nan = {
    time: [0, 1],
    series: [{ name: "y", values: [NaN] }],
    compileMs: 0,
    simulateMs: 0,
    reusedBinary: true,
    warnings: [],
  };
  const problem = describeUnusableResult(nan, "dassl");
  assert.ok(problem);
  assert.ok(!/does not recognise/.test(problem), "not called a typo");
  assert.match(problem, /could not be integrated/, "and points at the model instead");
});

test("a good result passes and an empty one does not", () => {
  const good = {
    time: [0, 1],
    series: [{ name: "y", values: [1, 0.54] }],
    compileMs: 0,
    simulateMs: 0,
    reusedBinary: true,
    warnings: [],
  };
  assert.equal(describeUnusableResult(good, "dassl"), null);
  // No series at all: `every` on an empty list is true, so a mis-written check
  // would call this a success.
  const empty = { ...good, series: [] };
  assert.ok(describeUnusableResult(empty, "dassl"), "an empty result is not a success");
  // A single finite value among NaNs is still a usable run.
  const partial = { ...good, series: [{ name: "y", values: [NaN, 1] }] };
  assert.equal(describeUnusableResult(partial, "dassl"), null);
});

test("the solver setting offers only names the runtime has", () => {
  // The list is the runtime's own, read by asking it for a name it does not know.
  // Two things had gone wrong: `rungekutta4` was recommended and does not exist,
  // and the free-text field gave no way to tell a real name from an invented one.
  const src = fs.readFileSync(path.join(repoRoot, "src/ai/prompts.ts"), "utf8");
  const block = /export const SOLVERS: SolverInfo\[\] = \[([\s\S]*?)\n\];/.exec(src);
  assert.ok(block, "the solver list is a typed array");
  const entries = [...block[1].matchAll(/\{\s*id: "([^"]*)"[\s\S]*?label: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(entries.includes(""), "the default is offered");
  assert.ok(entries.includes("cvode"), "and the measured-best one");
  assert.ok(!entries.includes("rungekutta4"), "the non-existent name is gone");
  assert.ok(entries.includes("rungekutta"), "the real one is there");

  // Every solver must carry all four parts, since the description renders them
  // together: a missing `points` would draw an empty list.
  const typed = /export interface SolverInfo \{[\s\S]*?\n\}/.exec(src)[0];
  for (const field of ["id", "label", "summary", "points", "use"]) {
    assert.match(typed, new RegExp(`\\b${field}\\b`), `SolverInfo declares ${field}`);
  }
  const bodies = [...block[1].matchAll(/\{\s*id: "[^"]*"[\s\S]*?\n  \},/g)];
  assert.equal(bodies.length, entries.length, "every entry is parsed as a block");
  for (const body of bodies) {
    assert.match(body[0], /summary: "/, "with a summary");
    assert.match(body[0], /points: \[/, "a list of points");
    assert.match(body[0], /use: "/, "and when to use it");
  }
  // The trap is called out where the user sees it: on the solver's own entry.
  const rungekutta = /id: "rungekutta",[\s\S]*?use: "([^"]+)"/.exec(src);
  assert.ok(rungekutta, "the rungekutta entry is present");
  assert.match(rungekutta[1], /NOT rungekutta4/, "and its note names the trap");
});


test("a save folder that was never set gets the default; a cleared one stays cleared", () => {
  // The two are indistinguishable after merging -- both are the empty string --
  // so the stored data decides. Applying a default over a deliberate choice would
  // be overriding the user, and the setting explicitly documents that blank means
  // "beside your notes".
  const neverSet = migrateSettings({ ...DEFAULT_SETTINGS, modelFolder: "" }, { jobs: 4 });
  assert.equal(neverSet.modelFolder, "Modelica", "a config predating the default gets one");

  const cleared = migrateSettings({ ...DEFAULT_SETTINGS, modelFolder: "" }, { modelFolder: "" });
  assert.equal(cleared.modelFolder, "", "an empty value that was recorded is a choice");

  const chosen = migrateSettings({ ...DEFAULT_SETTINGS, modelFolder: "models" }, { modelFolder: "models" });
  assert.equal(chosen.modelFolder, "models", "and a chosen folder is untouched");

  // No stored data at all: the merged object already carries the default.
  assert.equal(migrateSettings(DEFAULT_SETTINGS, null).modelFolder, "Modelica");
});
