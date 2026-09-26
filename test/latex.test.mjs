/**
 * Modelica expressions drawn as LaTeX.
 *
 * Two things are being tested and only one of them is the rendering. The other is
 * the REFUSALS: this converter is allowed to decline, and it is not allowed to be
 * approximately right. `(a + b) * c` drawn as `a + b \cdot c` is a different
 * equation from the one that was written, and a note has no way to show that it
 * happened — so a case the parser cannot fully account for has to come back as
 * null and be shown as source instead.
 *
 * That is why so many of these assert null. They are not gaps; they are the
 * feature.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";

const LIB = buildLibs("latex", ["src/modelica/latex.ts"]);
const { modelicaToLatex } = await import(path.join(LIB, "latex.js"));

/** Assert a conversion, and that it is a conversion rather than a refusal. */
const converts = (source, expected) => {
  const got = modelicaToLatex(source);
  assert.notEqual(got, null, `expected a conversion for: ${source}`);
  assert.equal(got, expected, source);
  return got;
};

/* ------------------------------------------------------------------ */
/* Arithmetic                                                          */
/* ------------------------------------------------------------------ */

test("an equation becomes an equation", () => {
  converts("sqrt(x) + x^2 - 56 = 67", "\\sqrt{x} + {x}^{2} - 56 = 67");
});

test("multiplication is a dot, so `2x` cannot read as twenty-something", () => {
  converts("2*x + y = 7", "2 \\cdot x + y = 7");
});

test("division is a fraction, and the operands lose brackets it does not need", () => {
  converts("R = v/i", "R = \\frac{v}{i}");
  converts("(a + b)/c = d", "\\frac{a + b}{c} = d");
  converts("a/(b*c) = d", "\\frac{a}{b \\cdot c} = d");
});

test("precedence survives the round trip", () => {
  // The parentheses are the user's, kept as nodes in the tree. Dropping them is
  // the failure that makes this a parser instead of a token substitution.
  converts("(a + b)*c = d", "\\left(a + b\\right) \\cdot c = d");
  converts("a + b*c = d", "a + b \\cdot c = d");
  converts("a/b/c = d", "\\frac{\\frac{a}{b}}{c} = d");
});

test("unary minus", () => {
  converts("y = -a", "y = -a");
  converts("y = -x^2", "y = -{x}^{2}");
});

test("a negative exponent needs its own brackets, because Modelica says so", () => {
  // Checked against the compiler: `2^-2` is a syntax error, `2^(-2)` compiles.
  converts("y = x^(-2)", "y = {x}^{-2}");
  assert.equal(modelicaToLatex("y = x^-2"), null, "Modelica refuses this, so we do not draw it");
});

test("a chain of powers is refused, because Modelica refuses one", () => {
  // `2^3^2` is a syntax error; `2^(3^2)` and `(2^3)^2` both compile to different
  // numbers. An exponent that is an atom is the rule the compiler enforces.
  assert.equal(modelicaToLatex("y = x^2^3"), null);
  converts("y = x^(2^3)", "y = {x}^{{2}^{3}}");
  converts("y = (x^2)^3", "y = {{x}^{2}}^{3}");
});

test("subscripts are subscripts", () => {
  converts("v[1] + v[2] = 4", "v_{1} + v_{2} = 4");
  converts("v[i + 1] = 4", "v_{i + 1} = 4");
});

test("an exponent written in e-notation becomes a power of ten", () => {
  converts("y = 1e-8", "y = 1 \\times 10^{-8}");
  converts("y = 2.5e3", "y = 2.5 \\times 10^{3}");
});

/* ------------------------------------------------------------------ */
/* Comparisons                                                         */
/* ------------------------------------------------------------------ */

test("comparisons render, including the ones the lexer splits in two", () => {
  // The lexer was written for diagram annotations, where `<`, `>` and `=` only
  // appear alone: `<=` arrives as two tokens and has to be rejoined.
  converts("x < 5", "x < 5");
  converts("x > 5", "x > 5");
  converts("x <= 5", "x \\leq 5");
  converts("x >= 5", "x \\geq 5");
  converts("x <> 5", "x \\neq 5");
});

test("and, or and not render", () => {
  converts("a and b", "a \\land b");
  converts("a or b", "a \\lor b");
  converts("not a", "\\neg a");
});

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

test("a single letter stays a maths italic, a word is set upright", () => {
  // In maths mode `mass` is *m·a·s·s* — four variables multiplied — which is a
  // different statement from the one the user wrote.
  converts("x = 1", "x = 1");
  converts("mass = 1", "\\mathrm{mass} = 1");
});

test("an underscore and a dotted tail go into ONE subscript", () => {
  // Emitted separately they produce `_{1}_{a}` — a double subscript, which LaTeX
  // refuses to render at all, so the equation would vanish rather than be wrong.
  converts("mass_1 = 1", "\\mathrm{mass}_{1} = 1");
  converts("r.R = 1", "r_{R} = 1");
  converts("mass_1.a = 1", "\\mathrm{mass}_{1,\\,a} = 1");
});

test("a library path is a symbol, not a path", () => {
  converts("T = Modelica.Constants.pi*2", "T = \\pi \\cdot 2");
  converts("y = Modelica.Constants.eps", "y = \\varepsilon");
});

/* ------------------------------------------------------------------ */
/* Functions                                                           */
/* ------------------------------------------------------------------ */

test("the functions with their own notation use it", () => {
  converts("y = sqrt(x)", "y = \\sqrt{x}");
  converts("y = abs(x)", "y = \\left|x\\right|");
  converts("y = exp(x)", "y = e^{x}");
  converts("y = sin(x) + cos(x)", "y = \\sin\\!\\left(x\\right) + \\cos\\!\\left(x\\right)");
  converts("y = log(x)", "y = \\ln\\!\\left(x\\right)");
});

test("der is a dot, though the lexer calls it a keyword", () => {
  // `der` never reaches the call rule as an identifier: the lexer types it as a
  // keyword, so it needs its own branch or every derivative is refused.
  converts("der(y) = -1", "\\dot{y} = -1");
  converts("v = der(x)", "v = \\dot{x}");
});

test("exp lifts a simple argument into the exponent", () => {
  converts("y = exp(x)", "y = e^{x}");
  converts("y = exp(-time)", "y = e^{-\\mathrm{time}}");
  converts("y = exp(-x^2)", "y = e^{-{x}^{2}}");
  converts("y = exp(a + b)", "y = e^{a + b}");
});

test("exp does NOT lift a fraction into the exponent", () => {
  // A stacked fraction in a superscript is set in script size inside brackets that
  // then stretch to twice the line height: KaTeX renders twenty script-sized spans
  // instead of six, and the brackets dominate the expression. A compound argument
  // is written `\exp(…)`, which is how it is read anyway.
  converts(
    "v = 10*(1 - exp(-time/(r.R*c.C)))",
    "v = 10 \\cdot \\left(1 - \\exp\\!\\left(\\frac{-\\mathrm{time}}{r_{R} \\cdot c_{C}}\\right)\\right)"
  );
  converts("y = exp(1/(a + b))", "y = \\exp\\!\\left(\\frac{1}{a + b}\\right)");
  // A fraction nested deeper counts too. The brackets are the user's own — they
  // wrote `-(a/b)` — and they are kept rather than tidied away, because tidying is
  // where a converter starts being nearly right instead of exactly right.
  converts("y = exp(-(a/b))", "y = \\exp\\!\\left(-\\left(\\frac{a}{b}\\right)\\right)");
});

test("a function handed over as a value is named, not called", () => {
  // An integrand is passed, not invoked: `e^{…}` has no argument to raise here.
  converts("y = quadratureLobatto(Modelica.Math.exp, 0, 1)", "y = \\mathrm{quadratureLobatto}\\left(\\exp,\\ 0,\\ 1\\right)");
});

test("an unknown function is still drawn as a call, without its namespace", () => {
  converts("y = myLib.scale(x, 2)", "y = \\mathrm{scale}\\left(x,\\ 2\\right)");
});

/* ------------------------------------------------------------------ */
/* Refusals — the point of the module                                  */
/* ------------------------------------------------------------------ */

test("a comprehension is refused rather than mangled", () => {
  // The prototype produced `\\cdot dxfor iin1 : n` for this: tokens run together,
  // an equation that is not the one written, and nothing on screen to say so.
  assert.equal(modelicaToLatex("y = sum(sin((i - 0.5) * dx) * dx for i in 1:n)"), null);
});

test("an if expression is refused", () => {
  assert.equal(modelicaToLatex("x = if a > 0 then 5 else -5"), null);
});

test("an array constructor is refused", () => {
  assert.equal(modelicaToLatex("y = {1, 2, 3}"), null);
});

test("an incomplete expression is refused, because a block is read while it is typed", () => {
  for (const partial of ["", "   ", "x = ", "x = (a + b", "x = a +", "= 5"]) {
    assert.equal(modelicaToLatex(partial), null, `expected null for ${JSON.stringify(partial)}`);
  }
});

test("a string is refused rather than drawn as maths", () => {
  assert.equal(modelicaToLatex('x = "hello"'), null);
});

test("an over-long expression whose end is not understood is refused, not truncated", () => {
  // The parser stops at the comma; a trailing token means the whole line was not
  // accounted for, and drawing the part that parsed would hide the rest.
  assert.equal(modelicaToLatex("y = a, b"), null);
  assert.equal(modelicaToLatex("y = a for i in 1:n"), null);
});

test("a trailing semicolon is tolerated, because a block is written with them", () => {
  converts("sqrt(x) + x^2 - 56 = 67;", "\\sqrt{x} + {x}^{2} - 56 = 67");
  converts("x = a ;", "x = a", "and with a space in front of it");
});
