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
const { typesetName } = await import(path.join(LIB, "typeset.js"));

/** The runs as `kind:text`, with a dot marked. */
const shape = (name) => typesetName(name).map((r) => `${r.kind}:${r.text}${r.dot ? "•".repeat(r.dot) : ""}`);

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
  assert.deepEqual(shape("der(x)"), ["base:x•"]);
  assert.deepEqual(shape("der(s_rel)"), ["base:s•", "sub:rel"], "ṡ_rel");
  assert.deepEqual(shape("der(damper.s_rel)"), ["base:damper", "sep:.", "base:s•", "sub:rel"]);
  assert.deepEqual(shape("der(der(x))"), ["base:x••"], "the second derivative has two");
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
