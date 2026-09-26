/**
 * Solver block tests.
 *
 * Two halves, and the split is the point. Reading a block is pure text handling
 * and is tested without a compiler, because that is where the interesting
 * mistakes are — an equation mistaken for a declaration produces a model that
 * compiles and solves the wrong thing. Solving is tested against the real
 * OpenModelica installation, because the claim the feature rests on is that a
 * relationship can be handed to it unmanipulated.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildLibs, simCacheDir } from "./helpers/build.mjs";

const SOLVE_LIB = buildLibs("solve", ["src/modelica/solve.ts"]);
const solve = await import(path.join(SOLVE_LIB, "solve.js"));
const { parseSolveBlock, buildSolveModel, solveModelName, splitStatements, declaredNames, freeSymbols } = solve;

const OMC_LIB = buildLibs("solve-omc", ["src/omc/backend.ts", "src/omc/locate.ts"]);
const backendMod = await import(path.join(OMC_LIB, "backend.js"));
const locateMod = await import(path.join(OMC_LIB, "locate.js"));
const OMC = locateMod.locateOmcSync();
const HAS_OMC = OMC.status === "found" && !!OMC.omcPath;

/* ------------------------------------------------------------------ */
/* Reading the block                                                   */
/* ------------------------------------------------------------------ */

test("an equation alone is understood, and the unknown is inferred", () => {
  const spec = parseSolveBlock("sqrt(x) + x^2 - 56 = 67");
  assert.equal(spec.problem, undefined);
  assert.equal(spec.unknown, "x");
  assert.equal(spec.inferred, true);
  assert.deepEqual(spec.equations, ["sqrt(x) + x^2 - 56 = 67"]);
  assert.deepEqual(spec.declarations, []);
});

test("the directive names the unknown, and is not left in the model", () => {
  const spec = parseSolveBlock("//@ solve y\n2*y = 10");
  assert.equal(spec.unknown, "y");
  assert.equal(spec.inferred, false);
  assert.deepEqual(spec.equations, ["2*y = 10"], "the directive line is removed from the body");
});

test("solve=x is accepted as well as solve x", () => {
  assert.equal(parseSolveBlock("//@ solve=y\ny = 1").unknown, "y");
});

test("a parameter declaration is carried through and is not the unknown", () => {
  const spec = parseSolveBlock("//@ solve x\nparameter Real target = 67;\nsqrt(x) + x^2 - 56 = target;");
  assert.deepEqual(spec.declarations, ["parameter Real target = 67"]);
  assert.deepEqual(spec.equations, ["sqrt(x) + x^2 - 56 = target"]);
  assert.equal(spec.unknown, "x");
});

test("declarations that bind a value are still declarations", () => {
  // `parameter Real k = 5` has a top-level `=`, so the depth-zero test alone
  // would call it an equation. The prefix is what saves it.
  const spec = parseSolveBlock("//@ solve x\nparameter Real k = 5;\nReal x(start = 2);\nk*x = 10;");
  assert.equal(spec.declarations.length, 2);
  assert.deepEqual(spec.equations, ["k*x = 10"]);
});

test("a qualified type without a binding is a declaration, not an equation", () => {
  // No top-level `=`, so it cannot be an equation — the rule that keeps a
  // `Modelica.Units.SI.Voltage` declaration out of the equation list.
  const spec = parseSolveBlock("//@ solve v\nModelica.Units.SI.Voltage v;\nv = 5;");
  assert.deepEqual(spec.declarations, ["Modelica.Units.SI.Voltage v"]);
  assert.deepEqual(spec.equations, ["v = 5"]);
});

test("an explicit equation section is honoured", () => {
  const spec = parseSolveBlock("//@ solve x\nReal x;\nequation\nx^2 = 9;");
  assert.deepEqual(spec.declarations, ["Real x"]);
  assert.deepEqual(spec.equations, ["x^2 = 9"]);
});

test("a modifier list is not mistaken for the end of a statement", () => {
  const statements = splitStatements("Real x(start = 1);\nx = 2");
  assert.deepEqual(statements, ["Real x(start = 1)", "x = 2"]);
});

test("a semicolon inside an array is not a statement boundary", () => {
  const statements = splitStatements("Real v[3] = {1; 2; 3};\nv[1] = 4");
  assert.deepEqual(statements, ["Real v[3] = {1; 2; 3}", "v[1] = 4"]);
});

test("a symbol declared as a parameter is refused by name", () => {
  const spec = parseSolveBlock("//@ solve k\nparameter Real k = 5;\nk = 10;");
  assert.match(spec.problem ?? "", /parameter/);
  assert.equal(spec.unknown, null);
});

test("an ambiguous block asks which symbol is wanted", () => {
  const spec = parseSolveBlock("x + y = 5");
  assert.match(spec.problem ?? "", /ambiguous/);
  assert.match(spec.problem ?? "", /\/\/@ solve x/, "the message shows how to fix it");
  assert.equal(spec.unknown, null);
});

test("a block with nothing undefined says so", () => {
  const spec = parseSolveBlock("1 + 1 = 2");
  assert.match(spec.problem ?? "", /nothing to solve for/);
});

test("an empty block asks for an equation", () => {
  assert.match(parseSolveBlock("").problem ?? "", /no equation/i);
  assert.match(parseSolveBlock("//@ solve x").problem ?? "", /no equation/i);
});

test("a qualified library name is one symbol, not three", () => {
  const free = freeSymbols("Modelica.Math.sin(1.0) + z = 0", new Set());
  assert.deepEqual(free, ["z"], "`Modelica`, `Math` and `sin` are not unknowns");
});

test("a called name is a function, not an unknown", () => {
  assert.deepEqual(freeSymbols("myFunc(a) = 3", new Set()), ["a"]);
});

test("an indexed name is still the unknown", () => {
  assert.deepEqual(freeSymbols("v[1] + v[2] = 4", new Set()), ["v"]);
});

test("a comprehension iterator is bound, not missing", () => {
  // `i` is used BEFORE the `for` that binds it, so a single pass records it as an
  // unknown and the model is then one equation short of its variables — a failure
  // that says "under-determined system" and never mentions the loop.
  const free = freeSymbols("y = sum(sin((i - 0.5) * dx) * dx for i in 1:n)", new Set(["n", "dx"]));
  assert.deepEqual(free, ["y"], "the iterator is not an unknown");
});

test("several iterators in one comprehension are all bound", () => {
  const free = freeSymbols("sum(a[i, j] for i in 1:n, j in 1:m)", new Set(["n", "m"]));
  assert.deepEqual(free, ["a"], "both `i` and `j` are iterators; `a` is not declared");
});

test("a class definition in the block is refused by name", () => {
  // The block's text is a model BODY. `function f ... end f;` is the natural way to
  // write a custom integrand, and the compiler's answer to it is a parse error about
  // algorithms that names neither the block nor the rule.
  const spec = parseSolveBlock("//@ solve y\nfunction f\n  input Real x;\n  output Real y;\nalgorithm\n  y := x^2;\nend f;\ny = f(1)");
  assert.match(spec.problem ?? "", /`function` cannot be defined inside this block/);
  assert.match(spec.problem ?? "", /Modelica\.Math/, "it names what can be used instead");
});

test("declared names are read out of their declarations", () => {
  const names = declaredNames(["parameter Real target = 67", "Real x(start = 2)", "Modelica.Units.SI.Voltage v"]);
  assert.deepEqual([...names].sort(), ["target", "v", "x"]);
});

/* ------------------------------------------------------------------ */
/* Generating the model                                                */
/* ------------------------------------------------------------------ */

test("the generated model declares the unknown and keeps the equation verbatim", () => {
  const spec = parseSolveBlock("sqrt(x) + x^2 - 56 = 67");
  const source = buildSolveModel(spec, "ms_solve_test");
  assert.match(source, /^model ms_solve_test$/m);
  assert.match(source, /Real x\(start = 1\);/);
  assert.match(source, /^equation$/m);
  assert.match(source, /sqrt\(x\) \+ x\^2 - 56 = 67;/, "the equation is not rewritten");
  assert.match(source, /^end ms_solve_test;$/m);
});

test("an unknown the block declared is not declared twice", () => {
  const spec = parseSolveBlock("//@ solve x\nReal x(start = 10);\nx^2 = 2");
  const source = buildSolveModel(spec, "m");
  assert.equal(source.match(/Real x/g)?.length, 1);
  assert.match(source, /Real x\(start = 10\)/, "the user's start value is the one kept");
});

test("the model name is stable for a shape and differs between shapes", () => {
  const a = solveModelName(parseSolveBlock("sqrt(x) + x^2 = 67"));
  const b = solveModelName(parseSolveBlock("sqrt(x) + x^2 = 70"));
  const c = solveModelName(parseSolveBlock("2*y = 10"));

  // Stable across an edit that only changes a number: the backend keys its build
  // directory by this name, so a name per keystroke would leave a directory of
  // generated C behind for each one.
  assert.equal(a, b, "a changed constant does not change the name");
  assert.notEqual(a, c, "a different unknown does");
  assert.match(a, /^ms_solve_[0-9a-f]{8}$/, "and it is a legal Modelica identifier");
});

/* ------------------------------------------------------------------ */
/* Solving, against the real compiler                                  */
/* ------------------------------------------------------------------ */

const CACHE = simCacheDir("solve");

/** Solve a block body end to end, exactly as the note panel does. */
async function solveBody(body) {
  const spec = parseSolveBlock(body);
  assert.equal(spec.problem, undefined, `block should be readable: ${spec.problem}`);
  const modelName = solveModelName(spec);
  const backend = new backendMod.OmcBackend({ omcPath: OMC.omcPath, cacheDir: CACHE });
  try {
    const result = await backend.simulate({ modelName, source: buildSolveModel(spec, modelName), stopTime: 0 });
    const series = result.series.find((s) => s.name === spec.unknown);
    return { spec, series, result };
  } finally {
    backend.dispose();
  }
}

test("the equation is solved without being rearranged", { skip: !HAS_OMC && "OpenModelica is not installed" }, async () => {
  // The claim the whole feature rests on: the relationship is handed over as
  // written, and the tool works out the rest. `x` appears twice on the left and
  // is not isolated, which is the case a calculator cannot do at all.
  const { series } = await solveBody("sqrt(x) + x^2 - 56 = 67");
  assert.ok(series, "the unknown is in the result");
  const x = series.values[0];
  assert.ok(Math.abs(Math.sqrt(x) + x * x - 56 - 67) < 1e-9, `residual too large at x=${x}`);
  assert.ok(Math.abs(x - 10.94040092099989) < 1e-9, `unexpected root ${x}`);
});

test("a parameter can be changed without changing the equation", { skip: !HAS_OMC && "OpenModelica is not installed" }, async () => {
  const { series } = await solveBody("//@ solve x\nparameter Real target = 100;\nsqrt(x) + x^2 - 56 = target;");
  const x = series.values[0];
  assert.ok(Math.abs(Math.sqrt(x) + x * x - 56 - 100) < 1e-9, `residual too large at x=${x}`);
});

test("a declared start value steers which root comes back", { skip: !HAS_OMC && "OpenModelica is not installed" }, async () => {
  // `x^2 = 2` has two right answers. The point of the test is not which one is
  // correct but that the block's own declaration decides, which is what the
  // panel tells the user it does.
  const { series } = await solveBody("//@ solve x\nReal x(start = -1);\nx^2 = 2");
  assert.ok(series.values[0] < 0, `expected the negative root, got ${series.values[0]}`);
});

test("a definite integral is computed by adaptive quadrature", { skip: !HAS_OMC && "OpenModelica is not installed" }, async () => {
  // Modelica has no integral operator, but the library has quadrature, and an
  // existing scalar function can be handed to it directly. e^x integrates to e - 1.
  const { series } = await solveBody(
    "//@ solve y\ny = Modelica.Math.Nonlinear.quadratureLobatto(Modelica.Math.exp, 0, 1, 1e-8)"
  );
  const y = series.values[0];
  assert.ok(Math.abs(y - (Math.E - 1)) < 1e-12, `expected e-1 = ${Math.E - 1}, got ${y}`);
});

test("a definite integral of a custom integrand is computed as a sum", { skip: !HAS_OMC && "OpenModelica is not installed" }, async () => {
  // The workaround for an integrand that is not already a function: a midpoint
  // Riemann sum, which is also the check that a comprehension survives the trip.
  const { series } = await solveBody(
    "//@ solve y\nparameter Integer n = 2000;\nReal dx = Modelica.Constants.pi / n;\n" +
      "y = sum(sin((i - 0.5) * dx) * dx for i in 1:n)"
  );
  const y = series.values[0];
  // Midpoint rule error is O((b-a)^3 / n^2), so 2e-6 at n = 2000 is expected.
  assert.ok(Math.abs(y - 2) < 1e-5, `expected 2 to within 1e-5, got ${y}`);
});

test("a system of equations is solved together", { skip: !HAS_OMC && "OpenModelica is not installed" }, async () => {
  const { series } = await solveBody("//@ solve x\n2*x + y = 7;\nx - y = 2");
  assert.ok(series, "x is in the result");
  assert.ok(Math.abs(series.values[0] - 3) < 1e-9, `expected x = 3, got ${series.values[0]}`);
});

test("a contradictory system fails rather than returning a number", { skip: !HAS_OMC && "OpenModelica is not installed" }, async () => {
  const spec = parseSolveBlock("//@ solve x\nx = 1;\nx = 2");
  const modelName = solveModelName(spec);
  const backend = new backendMod.OmcBackend({ omcPath: OMC.omcPath, cacheDir: CACHE });
  try {
    await assert.rejects(
      () => backend.simulate({ modelName, source: buildSolveModel(spec, modelName), stopTime: 0 }),
      (err) => {
        assert.ok(err instanceof backendMod.SimulationError, `expected a SimulationError, got ${err}`);
        return true;
      }
    );
  } finally {
    backend.dispose();
  }
});

test("units come back with the answer", { skip: !HAS_OMC && "OpenModelica is not installed" }, async () => {
  // The unit is inherited from the declared type, so it appears nowhere in the
  // block's own text — it can only come from the compiler's model description.
  const { series } = await solveBody(
    "//@ solve R\nModelica.Units.SI.Resistance R;\nModelica.Units.SI.Voltage v;\nModelica.Units.SI.Current i;\nv = 10;\ni = 0.05;\nR = v/i;"
  );
  assert.equal(series.unit, "Ohm");
});

test("the run reuses one compiled model across repeated solves", { skip: !HAS_OMC && "OpenModelica is not installed" }, async () => {
  // `stopTime: 0` is the whole mechanism, and this is the check that it does what
  // it is supposed to: the second call must not recompile.
  const spec = parseSolveBlock("sqrt(x) + x^2 - 56 = 67");
  const modelName = solveModelName(spec);
  const source = buildSolveModel(spec, modelName);
  const backend = new backendMod.OmcBackend({ omcPath: OMC.omcPath, cacheDir: CACHE });
  try {
    await backend.simulate({ modelName, source, stopTime: 0 });
    const second = await backend.simulate({ modelName, source, stopTime: 0 });
    assert.equal(second.compileMs, 0, "the second solve reused the compiled model");
    assert.equal(second.reusedBinary, true);
  } finally {
    backend.dispose();
  }
});

/* ------------------------------------------------------------------ */
/* Units                                                               */
/* ------------------------------------------------------------------ */

test("variable units are read from the model description", () => {
  const json = JSON.stringify({
    format: "Modelica",
    variables: {
      x: { name: "x", unit: "V", displayUnit: "mV" },
      bare: { name: "bare", unit: "" },
      other: { name: "other" },
    },
  });
  assert.deepEqual(backendMod.parseVariableUnits(json), { x: "V" });
});

test("a missing or malformed description costs the units and nothing else", () => {
  assert.deepEqual(backendMod.parseVariableUnits("not json"), {});
  assert.deepEqual(backendMod.parseVariableUnits("{}"), {});
  assert.deepEqual(backendMod.parseVariableUnits('{"variables": null}'), {});
});
