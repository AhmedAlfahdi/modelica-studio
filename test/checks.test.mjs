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
