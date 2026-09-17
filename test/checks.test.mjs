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
import { buildLibs } from "./helpers/build.mjs";

const { checkModel } = await import(
  path.join(buildLibs("checks-lib", ["src/modelica/checks.ts"]), "checks.js")
);

const declared = (...names) => new Set(names);

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
