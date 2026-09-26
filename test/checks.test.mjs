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
import { buildLibs, documentationFiles, repoRoot } from "./helpers/build.mjs";

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

test("a modifier named after its own declaration is caught", () => {
  // OpenModelica answers this with "Modified element air_density not found in
  // class Real" -- naming the TYPE rather than the line, so the mistake is hard
  // to find from the error. It was written by the model and survived a repair,
  // and it is the same fault as `fixed = true` on a parameter: a modifier on a
  // type that has no such member.
  const problem = checkModel({
    declared: declared("air_density"),
    declarations: [
      {
        name: "air_density",
        text: "parameter Modelica.Units.SI.Density air_density(air_density=1.225);",
        line: 5,
      },
    ],
    equations: [],
    hasComponents: false,
    firstEquationLine: 9,
  });
  assert.equal(problem.length, 1, "exactly one problem");
  assert.match(problem[0].message, /modifier named after itself/, "named");
  assert.match(problem[0].message, /naming the type rather than this line/, "and why it is hard to find");
  assert.match(problem[0].message, /not found in class/, "quoting the message the user sees");
  // It must NOT guess which class OpenModelica will name: resolving `SI.Density`
  // to `Real` needs a second type system in the checker, and a wrong name in the
  // message is the exact problem being fixed.
  assert.ok(!/found in class Real/.test(problem[0].message), "no class name it has not looked up");
  // The fix has to be stated, since the error does not imply it.
  assert.match(problem[0].message, /parameter .* air_density = <value>;/, "with the correct form");
});

test("legitimate modifiers are not mistaken for the mistake", () => {
  // The first version of this check tested only for `name(`, which also matched
  // `parameter Real x(unit = "V")` -- ordinary and correct. The test caught it.
  const cases = [
    ["x", 'parameter Real x(unit = "V") = 5;'],
    ["y", "parameter Real y(start = 1) = 5;"],
    ["z", "parameter Real z = 5;"],
    ["v", "parameter Modelica.Units.SI.Velocity v(displayUnit = \"km/h\") = 1;"],
  ];
  for (const [name, text] of cases) {
    const problems = checkModel({
      declared: declared(name),
      declarations: [{ name, text, line: 3 }],
      equations: [],
      hasComponents: false,
      firstEquationLine: 9,
    });
    assert.deepEqual(problems, [], `${text} is correct and must not be flagged`);
  }
});

test("the same name with spaces still counts", () => {
  // Generated code is not always formatted tightly.
  const problems = checkModel({
    declared: declared("wing_area"),
    declarations: [
      { name: "wing_area", text: "parameter SI.Area wing_area ( wing_area = 16.0 );", line: 6 },
    ],
    equations: [],
    hasComponents: false,
    firstEquationLine: 9,
  });
  assert.equal(problems.length, 1);
});

test("the licence and citation metadata agree with each other", () => {
  // Licensing metadata is the easiest thing in a repository to leave stale, and the
  // one place where being wrong matters beyond the build: a citation that names the
  // wrong version, or a package.json that disagrees with the LICENSE, is a claim
  // someone may rely on when they reuse the work.
  const root = path.join(repoRoot);
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

  const pkg = JSON.parse(read("package.json"));
  const manifest = JSON.parse(read("manifest.json"));
  const cff = read("CITATION.cff");

  assert.equal(pkg.license, "GPL-3.0-or-later", "npm reads the licence from here");
  assert.equal(pkg.author, "Ahmed N. Alfahdi", "and the author");
  assert.equal(manifest.author, "Ahmed N. Alfahdi", "the store shows this as the author");

  // The LICENSE file is the verbatim GPL-3.0 text with the "or later" appendix --
  // checked for the two markers that distinguish that from GPL-2, from
  // GPL-3.0-only, and from an empty file.
  const licence = read("LICENSE");
  assert.match(licence, /GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/, "GPL-3 text");
  assert.match(
    licence,
    /either version 3 of the License, or \(at your option\) any later version/,
    "applied as 'or later', which is what the metadata claims"
  );
  assert.ok(licence.length > 30000, `the whole text, not a summary (${licence.length} bytes)`);

  // CITATION.cff: the version it names must be the version that exists.
  const cffVersion = /^version:\s*(.+)$/m.exec(cff)?.[1]?.trim();
  assert.equal(cffVersion, manifest.version, "the citation names the released version");
  assert.match(cff, /^license:\s*GPL-3\.0-or-later$/m, "and the same licence as package.json");
  assert.match(cff, /family-names:\s*Alfahdi/, "credited to the same person");

  // The README is where a reader looks first: it must state the licence, and must
  // present citation as a REQUEST. A requirement there would contradict the licence.
  const readme = read("README.md");
  assert.match(readme, /GNU General Public License, version 3 or later/, "the README says which licence");
  assert.match(readme, /CITATION\.cff/, "and points at the citation file");
  assert.match(
    readme,
    /not as a condition of the licence/,
    "citation is asked for as a favour, not imposed -- a citation requirement is not an open-source licence"
  );
  assert.doesNotMatch(
    readme,
    /must cite|required to cite|shall cite/i,
    "and nothing in the README imposes it"
  );

  // The whole point of the licence: a fork has to stay open and say so.
  assert.match(readme, /Nobody can take it\s+closed|stays free/i, "the README says what a fork must do");

  // The Help window's About panel states the licence to the reader in the
  // application, which is the one place they can see it without opening the
  // repository -- so it is held to the same strings as everything else.
  const help = read("src/view/help-modal.ts");
  assert.match(
    help,
    /export const PLUGIN_LICENSE = "GPL-3\.0-or-later";/,
    "the About panel names the same licence as package.json"
  );
  assert.match(
    help,
    /this\.plugin\.manifest\.author/,
    "and reads the author from the manifest rather than repeating it"
  );
  assert.match(help, /CITATION\.cff/, "with a link to the citation file");
});

test("every link and anchor in the documentation resolves, from the file that makes it", () => {
  // Written after two rounds of the same mistake. Splitting the README into `docs/`
  // left seven links pointing at `docs/...` from inside `docs/`, and then four images
  // doing the same — each one fine relative to the repository root and broken in the
  // file that showed it, which is what a reader's browser resolves against. Both were
  // found by eye, on GitHub, after the change had been pushed.
  //
  // So links are resolved the way a renderer resolves them, anchors are checked
  // against the headings of the page they land on, and fenced blocks are skipped
  // because a code sample is not a link.
  const slug = (heading) =>
    heading
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, "")
      .trim()
      .replace(/ +/g, "-");
  const headingsOf = (text) => new Set([...text.matchAll(/^#+ (.+)$/gm)].map((m) => slug(m[1])));

  const bad = [];
  for (const rel of documentationFiles()) {
    const here = path.join(repoRoot, rel);
    const prose = fs
      .readFileSync(here, "utf8")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`\n]*`/g, "");
    for (const m of prose.matchAll(/\]\(([^)]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:)/.test(target)) continue;

      if (target.startsWith("#")) {
        if (!headingsOf(prose).has(target.slice(1))) {
          bad.push(`${rel}: ${target} is not a heading on that page`);
        }
        continue;
      }

      const [file, anchor] = target.split("#");
      const resolved = path.resolve(path.dirname(here), file);
      if (!fs.existsSync(resolved)) {
        bad.push(`${rel}: ${target} resolves to ${path.relative(repoRoot, resolved)}, which does not exist`);
        continue;
      }
      if (anchor && resolved.endsWith(".md")) {
        const there = fs.readFileSync(resolved, "utf8");
        if (!headingsOf(there).has(anchor)) bad.push(`${rel}: ${target} has no such heading`);
      }
    }
  }
  assert.deepEqual(bad, [], `${bad.length} links do not resolve`);
});

test("every image the documentation shows exists, and every image is shown", () => {
  // A page whose screenshots are missing looks broken, and a screenshot nobody
  // references is either dead weight or a picture the text forgot to mention. Both
  // directions are checked, because both are silent: markdown renders a broken image
  // as nothing at all in some viewers.
  //
  // Every markdown file, not only the README, and every reference resolved FROM THE
  // FILE THAT MAKES IT. Resolving from the repository root is what let four broken
  // images through: the split moved the embed screenshots into `docs/notes.md`, which
  // kept the root-relative `docs/images/...` they had in the README, so every path
  // pointed at `docs/docs/images/...` and GitHub drew four alt texts where the
  // pictures should be. The path existed relative to the root; the FILE it was in
  // is what GitHub resolves against, and that is what this has to check.
  const referenced = [];
  for (const rel of documentationFiles()) {
    const text = fs.readFileSync(path.join(repoRoot, rel), "utf8");
    // Markdown images AND the HTML <img> tags the side-by-side theme pairs use: a
    // check that only knew about one spelling would wave a broken image through.
    for (const m of [
      ...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g),
      ...text.matchAll(/<img\s+src="([^"]+)"/g),
    ]) {
      referenced.push({ rel, link: m[1] });
    }
  }
  assert.ok(referenced.length >= 3, `the documentation shows pictures (${referenced.length})`);

  const resolved = [];
  for (const { rel, link } of referenced) {
    // The absolute, existing target — or the nearest thing to it, so the failure
    // message can say where the path actually went.
    const target = path.resolve(path.dirname(path.join(repoRoot, rel)), link);
    assert.ok(
      fs.existsSync(target),
      `${rel} shows ${link}, which resolves to ${path.relative(repoRoot, target)} and does not exist`
    );
    resolved.push(target);
  }

  const dir = path.join(repoRoot, "docs", "images");
  const available = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".png")) : [];
  const shown = new Set(resolved.map((r) => path.basename(r)));
  assert.deepEqual(
    available.filter((f) => !shown.has(f)),
    [],
    "every rendered image is used somewhere in the documentation"
  );

  // The images are produced by a script, so they can be regenerated rather than
  // re-photographed by hand when the UI changes.
  assert.ok(
    fs.existsSync(path.join(repoRoot, "scripts/readme-images.mjs")),
    "and the script that renders them is in the repository"
  );
  assert.ok(
    resolved.every((r) => path.dirname(r) === dir),
    "images live together under docs/images"
  );
  // Both themes for every scene, so a reader in either one sees the real thing.
  const names = resolved.map((r) => path.basename(r));
  for (const stem of ["studio", "diagram", "plot", "help", "embed", "embedPlot", "hover", "sweep"]) {
    assert.ok(names.includes(`${stem}-light.png`) && names.includes(`${stem}-dark.png`), `${stem} is shown in both themes`);
  }
});

test("a declaration whose name could not be read does not sink the whole check", () => {
  // The declaration scanner could not match `parameter Real g = 9.81;` (its
  // terminator set had no `=`), so the line was absorbed into the pending block the
  // class header opened and that block's name came out as "?". `checks.ts` then
  // built a RegExp from the name -- `/\b?\s*\(…/` -- which throws "Nothing to
  // repeat". The throw was reported as the model's diagnostic on line 1 and EVERY
  // real finding was suppressed: the plugin's curated checks silently did nothing
  // for a parameter-first model, which is the most common layout there is.
  // `checkModel` is imported at the top of this file.
  const base = {
    declared: new Set(["g", "x"]),
    equations: ["x = g;"],
    hasComponents: false,
    firstEquationLine: 4,
  };

  // The name the scanner used to produce must not throw, and must not hide the
  // findings that come after it.
  let problems;
  assert.doesNotThrow(() => {
    problems = checkModel({
      ...base,
      declarations: [{ name: "?", text: "model M   parameter Real g = 9.81;", line: 1 }],
      equations: ["x = g + missing_one;"],
    });
  }, "a placeholder name must not build an invalid regular expression");

  assert.ok(
    problems.some((p) => /missing_one/.test(p.message)),
    `and the real findings are still reported: ${JSON.stringify(problems.map((p) => p.message))}`
  );

  // The other half: a declaration with a binding is read as a declaration, so its
  // name is never a placeholder in the first place.
  const view = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  const scan = /const decl = (\/.*\/)\s*\.exec\(line\)/.exec(view);
  assert.ok(scan, "the declaration scan is present");
  assert.ok(
    scan[1].includes("|=|$)"),
    `and it accepts a binding (a declaration with a value is still a declaration): ${scan[1]}`
  );
});

test("every formula in the README is a display block on its own line", () => {
  // The rule, as asked for: LaTeX never shares a line with prose. Inline maths was
  // tried in the RLC and mechanical sections and read badly -- a fraction inside a
  // bullet stretches the line box and pushes the words apart, and a one-character
  // formula like F/c comes out as "F / c" with binary-operator spacing around the
  // slash. Every formula is now a `$$` block, and the quantity it defines is named
  // in words in the sentence beside it.
  //
  // Two more shapes are checked, both of which the rendered page has already been
  // wrong about: a `$$` that never closes (a whole paragraph turns literal), and a
  // macro whose backslash the renderer drops, which prints the punctuation --
  // "\exp\!\left(" reached github.com as "exp!(".
  // The rule is about the prose, and the prose now lives in more than one file: the
  // formulas it governs moved into docs/ with the worked examples, and a README-only
  // check would have stopped covering them without saying so.
  const bad = [];
  const blocks = [];
  for (const rel of documentationFiles()) {
    // Fenced blocks are code, not prose: a `$` in a shell transcript is a prompt.
    const text = fs.readFileSync(path.join(repoRoot, rel), "utf8");
    const prose = text.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " "));

    // Blocks first, so what is left over is everything that is NOT a formula. A block
    // opens and closes on lines of its own, which is what makes it a block: a `$$`
    // line inside a sentence would be the same mistake as inline maths.
    const found = [...prose.matchAll(/^\$\$([\s\S]*?)\$\$[ \t]*$/gm)];
    blocks.push(...found);

    const outside = prose.replace(/^\$\$[\s\S]*?\$\$[ \t]*$/gm, " (a formula) ");
    outside.split("\n").forEach((line, i) => {
      if (!line.includes("$")) return;
      bad.push(
        `${rel}:${i + 1}: a $ outside a $$ block -- put the formula on its own line: ` +
          line.trim().slice(0, 70)
      );
    });

    // An odd number of `$$` means at least one block never closed.
    const fences = (prose.match(/\$\$/g) ?? []).length;
    if (fences % 2 !== 0) bad.push(`${rel}: ${fences} ` + "$$" + ` markers -- one block is left open`);

    for (const m of found) {
      const at = `${rel}: line ${prose.slice(0, m.index).split("\n").length + 1}`;
      if (!m[1].trim()) bad.push(`${at}: an empty display block`);
      if (m[1].includes("\n\n")) bad.push(`${at}: two paragraphs inside one block`);
      for (const macro of ["\\!", "\\;", "\\:", "\\hspace", "\\hfill"]) {
        if (m[1].includes(macro)) {
          bad.push(`${at}: ${macro} does not survive the renderer -- it prints the punctuation`);
        }
      }
    }
  }
  assert.ok(blocks.length >= 5, `the documentation shows its formulas as blocks (${blocks.length})`);
  assert.deepEqual(bad, [], `${bad.length} formulas break the documentation's maths rules`);
});

test("every icon the plugin asks for is in the vendored picture set", () => {
  // The README's screenshots are drawn by `scripts/readme-images.mjs`, which hands the
  // page the Lucide shapes vendored in `scripts/readme-icons.json` because the Obsidian
  // stub has no icon table. A NEW toolbar icon missing from that file would render as an
  // empty square in every picture, and nothing else would say so -- which is exactly how
  // the icon-only toolbar first arrived: a row of blank buttons.
  const sources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".ts")) sources.push(fs.readFileSync(p, "utf8"));
    }
  };
  walk(path.join(repoRoot, "src"));

  const names = new Set();
  const collect = (text, re) => {
    for (const m of text.matchAll(re)) names.add(m[1]);
  };
  for (const text of sources) {
    collect(text, /setIcon\([^,]+,\s*"([a-z0-9-]+)"/g);
    collect(text, /addBtn\(\s*\w+,\s*"([a-z0-9-]+)"/g);
    collect(text, /addMode\("[a-z]+",\s*"([a-z0-9-]+)"/g);
    collect(text, /mk\("[^"]+",\s*"[^"]+",\s*"([a-z0-9-]+)"/g);
    collect(text, /\bicon:\s*"([a-z0-9-]+)"/g);
  }
  assert.ok(names.size >= 20, `the plugin names its icons (${names.size})`);

  const table = JSON.parse(fs.readFileSync(path.join(repoRoot, "scripts/readme-icons.json"), "utf8"));
  const missing = [...names].filter((n) => !table[n]);
  assert.deepEqual(missing, [], `${missing.length} icons have no shape for the screenshots`);
  // And every entry is real markup rather than an empty string.
  const empty = Object.entries(table).filter(([, shapes]) => !shapes || shapes.length < 10);
  assert.deepEqual(empty.map(([n]) => n), [], "no empty shapes in the table");
});

test("the release workflow builds the assets it attests", () => {
  // A release whose assets are attested proves they came from this repository — but only
  // if the workflow BUILT them. Attesting a file compiled elsewhere certifies that
  // someone uploaded it, which is worse than no attestation: it looks like provenance.
  // So the shape is checked: check out the tag, install from the lockfile, build, check
  // the bundle, upload, attest, verify.
  const file = path.join(repoRoot, ".github/workflows/release.yml");
  assert.ok(fs.existsSync(file), "the release workflow exists");
  const wf = fs.readFileSync(file, "utf8");

  assert.match(wf, /tags: \["\*"\]/, "it runs on a tag");
  for (const perm of ["contents: write", "id-token: write", "attestations: write"]) {
    assert.ok(wf.includes(perm), `it asks for ${perm} (attestations need the OIDC token)`);
  }
  assert.match(wf, /npm ci\b/, "the build uses the lockfile, not floating versions");
  assert.match(wf, /node esbuild\.config\.mjs production/, "it builds the bundle itself");
  assert.match(wf, /node scripts\/check-bundle\.mjs/, "and refuses a bundle that installs badly");
  assert.match(wf, /actions\/attest-build-provenance@v\d+/, "it attests what it built");
  for (const asset of ["main.js", "manifest.json", "styles.css"]) {
    assert.ok(wf.includes(asset), `${asset} is part of the release`);
  }
  // The attestation step has to name the assets, not just exist.
  const attest = /- name: Attest the assets[\s\S]*?subject-path: \|([\s\S]*?)\n\n/.exec(wf);
  assert.ok(attest, "the attest step lists its subjects");
  for (const asset of ["main.js", "manifest.json", "styles.css"]) {
    assert.ok(attest[1].includes(asset), `the attestation covers ${asset}`);
  }
  assert.match(wf, /gh attestation verify/, "and the job verifies one from the outside");
  // The tag is what Obsidian matches to the manifest, so a mismatch must stop the run.
  assert.match(wf, /does not match manifest version/, "a tag that disagrees with the manifest fails");

  // The README tells a reader how to check it, which is the point of attesting.
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
  assert.match(
    readme,
    /gh attestation verify/,
    "the README shows the command that verifies an installed file"
  );
});

test("the README discloses every capability the directory's analysis flags", () => {
  // The directory's behaviour scan lists five capabilities: runs a shell command, reads
  // files outside the vault, reads machine details, lists the vault's files, and uses the
  // clipboard. A plugin that runs a compiler should say so, and the listing is where a
  // reader looks before installing — so each one is named, and the machine-details row
  // says what is NOT read, which is the finding's actual worry (fingerprinting).
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
  const section = /### What it accesses, and what leaves your machine([\s\S]*?)\n---/.exec(readme);
  assert.ok(section, "the disclosure section is present");
  const text = section[1];
  for (const capability of [
    /Runs a shell command/,
    /Reads files outside the vault/,
    /Machine details/,
    /Lists your vault's files/,
    /The clipboard/,
  ]) {
    assert.match(text, capability, `${capability} is disclosed`);
  }
  assert.match(text, /No hostname, no username/, "and what is NOT read is stated");
  // The claims in that row are checked against the source, so the README cannot drift
  // into promising something the code contradicts.
  const sources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".ts")) sources.push(fs.readFileSync(p, "utf8"));
    }
  };
  walk(path.join(repoRoot, "src"));
  const all = sources.join("\n");
  for (const forbidden of ["os.hostname", "os.userInfo", "os.networkInterfaces", "os.arch", "os.release", "os.platform"]) {
    assert.ok(!all.includes(forbidden), `${forbidden} would contradict the README's machine-details row`);
  }
  // And the two capabilities the directory named are in the shipped code, so the row is
  // describing something real rather than a stale claim.
  assert.match(all, /from "node:child_process"/, "a shell command is really run");
  assert.match(all, /from "node:fs"/, "and files outside the vault are really read");
});

test("every URL in the source names its host in full", () => {
  // The plugin directory warns when a plugin "assembles domain names at runtime": a
  // host built by splitting segments into an array and joining them again is how
  // malware keeps its endpoint out of a security scanner's list, so a URL that cannot
  // be read statically is treated as one that is being hidden. This plugin has
  // nothing to hide -- five provider endpoints, one documentation site, the
  // repository and the licence -- so the shapes that look like hiding are asserted
  // away rather than argued about.
  const sources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".ts")) sources.push({ file: path.relative(repoRoot, p), text: fs.readFileSync(p, "utf8") });
    }
  };
  walk(path.join(repoRoot, "src"));
  assert.ok(sources.length > 40, `the source tree was walked (${sources.length} files)`);

  const urls = [];
  for (const { file, text } of sources) {
    for (const m of text.matchAll(/https?:\/\/[^"'`\s)]*/g)) urls.push({ file, url: m[0] });
  }
  assert.ok(urls.length >= 10, `the plugin names its endpoints (${urls.length})`);

  // No interpolation in a URL. `https://${host}/...` is the shape the warning is
  // about, and there is no reason for the host or the path of a written URL to be
  // computed -- every one of them is a constant or a user setting.
  const computed = urls.filter((u) => u.url.includes("${"));
  assert.deepEqual(computed.map((u) => `${u.file}: ${u.url}`), [], "no URL is built from a template");

  // And the host is complete, so a scanner reads a host rather than a fragment of one.
  // A port is allowed and dropped from the list below: the local presets carry one.
  const hosts = new Set();
  const partial = [];
  for (const { file, url } of urls) {
    const host = /^https?:\/\/([^/?#]+)/.exec(url)?.[1] ?? "";
    if (!/^(localhost|127\.0\.0\.1|[a-z0-9-]+(\.[a-z0-9-]+)+)(:\d+)?$/i.test(host)) partial.push(`${file}: ${url}`);
    else hosts.add(host.replace(/:\d+$/, ""));
  }
  assert.deepEqual(partial, [], "every URL names a whole host");

  // The complete list, so a new endpoint is a deliberate edit to this line rather than
  // something that arrives unnoticed: the documentation site, the five AI presets (two
  // of them local servers), the repository and the licence. Three of these appear only
  // in text the user reads -- the OpenModelica download page, the licence, the
  // repository -- so they are named, not contacted.
  assert.deepEqual(
    [...hosts].sort(),
    [
      "api.deepseek.com",
      "api.groq.com",
      "api.openai.com",
      "doc.modelica.org",
      "github.com",
      "localhost",
      "openmodelica.org",
      "openrouter.ai",
      "www.gnu.org",
    ],
    "the endpoints the source names"
  );

  // The URL builder is the one module that appends to a URL at runtime, so it is the
  // one that could assemble a host: it holds no split/join at all. The class names it
  // works with look exactly like host names -- `Modelica.Electrical.Analog` is four
  // dot-separated labels -- which is why this is asserted rather than trusted.
  const builder = sources.find((s) => s.file.endsWith("modelica/doclinks.ts"));
  assert.ok(builder, "the documentation URL builder is where it was");
  assert.ok(!/\bsplit\(/.test(builder.text), "it splits nothing");
  assert.ok(!/\bjoin\(/.test(builder.text), "and joins nothing: the pair is the flagged pattern");
  assert.ok(builder.text.includes('"https://doc.modelica.org/Modelica%204.1.0/'), "the tree it links into is a literal");
});

test("what the plugin writes outside the vault is bounded, and the docs say so", () => {
  // The directory's own analysis flags the file access as a warning -- it cannot tell a
  // compiler's scratch space from a keylogger -- so the answer is not to hide it but to
  // bound it: two places are written outside the vault, both stated in the README, and
  // neither is allowed to grow without end.
  const main = fs.readFileSync(path.join(repoRoot, "src/main.ts"), "utf8");
  const settings = fs.readFileSync(path.join(repoRoot, "src/settings.ts"), "utf8");
  const backend = fs.readFileSync(path.join(repoRoot, "src/omc/backend.ts"), "utf8");
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
  const logFile = fs.readFileSync(path.join(repoRoot, "src/log-file.ts"), "utf8");

  // The vault's log goes through the capped appender: append-only with no ceiling is how
  // it reached 9 MB in the vault this was developed in.
  assert.match(main, /appendCappedLine\(\s*`\$\{base\}\/\.modelica-studio\.log`/, "the log is written through the capped appender");
  assert.ok(
    !/appendFileSync\(\s*`\$\{base\}\/\.modelica-studio\.log`/.test(main),
    "and not by a bare append"
  );
  // The other log the plugin keeps -- the AI request log -- prunes itself as it writes,
  // for the same reason: a file that is only ever appended to has no ceiling.
  assert.match(main, /const pruned = pruneLines\(text\)/, "the AI exchange log prunes as it writes");

  // The ceiling the code enforces is the one the docs state, read off the constant so the
  // two cannot drift into disagreeing.
  const capKb = Number(/LOG_MAX_BYTES = (\d+) \* 1024/.exec(logFile)?.[1]);
  assert.ok(capKb >= 64, `room for a session's worth of events: ${capKb} KB`);
  for (const [what, text] of [
    ["the setting's description", settings],
    ["the README", readme],
  ]) {
    assert.ok(text.includes(".modelica-studio.log"), `${what} names the log file`);
    assert.ok(text.includes(`${capKb} KB`), `${what} states the ${capKb} KB ceiling`);
  }

  // The build cache under the system temporary folder is swept, and only the default
  // root is: a caller that named its own cache directory owns what is in it.
  assert.match(
    backend,
    /if \(!opts\.cacheDir\) sweepStaleWorkRoots\(workRootParent\(\)\)/,
    "the shared temporary root is swept, and a named cache directory is not"
  );
  assert.match(readme, /temporary folder/, "the README says where the compiler writes");
  assert.match(readme, /removed when\s+the plugin starts|removed when the plugin starts/, "and that those folders are cleaned up");
});
