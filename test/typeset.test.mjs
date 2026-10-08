/**
 * Variable names as runs of type.
 *
 * The legend draws these, and the legend is drawn on a canvas — so the rules are a
 * pure function of the name, and are tested as one rather than through pixels. A
 * name that is not a shape this understands has to come back as ONE plain run:
 * that is what keeps `previous(x)` and a quoted identifier looking exactly as the
 * compiler wrote them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";

const LIB = buildLibs("typeset-lib", ["src/view/typeset.ts"]);
const { typesetName, setDerivativeNotation } = await import(path.join(LIB, "typeset.js"));

/** The runs as `kind:text`, with a dot marked. */
const shape = (name) => typesetName(name).map((r) => `${r.kind}:${r.text}${r.dot ? "•".repeat(r.dot) : ""}`);
/** The same, in the dot notation, which is no longer the default. */
const dotted = (name) =>
  typesetName(name, "dot").map((r) => `${r.kind}:${r.text}${r.dot ? "•".repeat(r.dot) : ""}`);

test("an underscore suffix is a subscript", () => {
  assert.deepEqual(shape("s_rel"), ["base:s", "sub:rel"]);
  assert.deepEqual(shape("damper.s_rel"), ["base:damper", "sep:.", "base:s", "sub:rel"]);
  assert.deepEqual(shape("x[1]"), ["base:x", "sub:1"], "and so is an index");
  assert.deepEqual(shape("x[1,2]"), ["base:x", "sub:1,2"], "with its own commas");
});

test("consecutive underscores become one subscript", () => {
  // `x_a_b` is x with `a,b`, which is how the specification writes a nested one.
  assert.deepEqual(shape("i_a_b"), ["base:i", "sub:a,b"]);
  assert.deepEqual(shape("v_abc_1"), ["base:v", "sub:abc,1"]);
});

test("a derivative is a dot over the variable, not over its subscript", () => {
  // In the DOT notation, which is a choice now rather than the default: the dot is positioned
  // by this plugin from the run's advance width, and a prime is positioned by the font.
  assert.deepEqual(dotted("der(x)"), ["base:x•"]);
  assert.deepEqual(dotted("der(s_rel)"), ["base:s•", "sub:rel"], "ṡ_rel");
  assert.deepEqual(dotted("der(damper.s_rel)"), ["base:damper", "sep:.", "base:s•", "sub:rel"]);
  assert.deepEqual(dotted("der(der(x))"), ["base:x••"], "the second derivative has two");
});

test("what it cannot typeset is left as one plain run", () => {
  for (const odd of ["previous(x)", "'a.b'.c", "x[", "a__b", ""]) {
    const runs = typesetName(odd);
    assert.equal(runs.length, 1, `${odd}: one run`);
    assert.equal(runs[0].kind, "base", `${odd}: plain`);
    assert.equal(runs[0].text, odd === "" ? "" : odd, `${odd}: unchanged`);
    assert.equal(runs[0].dot, undefined, `${odd}: no dot`);
  }
});

test("a plain name is a plain run", () => {
  assert.deepEqual(shape("mass"), ["base:mass"]);
  assert.deepEqual(shape("mass.a"), ["base:mass", "sep:.", "base:a"]);
});

test("a derivative can be written four ways, and the default needs no drawing", async () => {
  // Reported with a plot full of them: the Newton dot is DRAWN by this plugin from the run's
  // advance width alone, so it lands in the middle of `gamma`, too low over `T` and nowhere in
  // particular on a name with a subscript. A prime is a character beside the letter, so the font
  // places it and `measureText` counts it — which is why it is the default.
  const render = (name, mode) =>
    typesetName(name, mode)
      .map((r) => `${r.text}${r.kind === "base" ? "" : "_" + r.kind}${r.dot ? "{dot" + r.dot + "}" : ""}`)
      .join("|");

  assert.equal(render("der(V)", "prime"), "V'{dot0}".replace("{dot0}", ""), "a prime beside the letter");
  assert.equal(render("der(der(V))", "prime"), "V''", "and one per derivative");
  assert.equal(render("der(v_rel)", "prime"), "v'|rel_sub", "the prime goes on the variable, not the subscript");
  assert.equal(render("der(V)", "der"), "der(V)", "as the source writes it");
  assert.equal(render("der(capacitor.v)", "der"), "der(capacitor.v)", "including the component");
  assert.equal(render("der(V)", "leibniz"), "d_sep|V|/dt_sep", "Leibniz names what it differentiates against");
  assert.equal(render("der(der(V))", "leibniz"), "d_sep|2_sup|V|/dt_sep", "with the order on the d");
  assert.equal(render("der(V)", "dot"), "V{dot1}", "and the dot is still there for anyone who wants it");
  assert.equal(render("der(der(V))", "dot"), "V{dot2}", "two of them, as before");

  // The setting is the default for every caller that does not pass a mode.
  setDerivativeNotation("leibniz");
  assert.equal(render("der(V)"), "d_sep|V|/dt_sep", "the chosen notation is what a caller gets");
  setDerivativeNotation("prime");
  assert.equal(render("der(V)"), "V'", "and it can be put back");
});
