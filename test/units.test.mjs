/**
 * Units, as a reader writes them.
 *
 * The strings are the real ones: every distinct unit the compiler emitted across
 * the 32 results in a working vault (56 of them), so the table is the vocabulary
 * this has to handle rather than an idea of it. The point of the test is the two
 * halves of the same rule — the symbols come out readable, and anything that is
 * not unit grammar the compiler wrote comes back untouched.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";

const LIB = buildLibs("units-lib", ["src/view/units.ts"]);
const { formatUnit, unitRuns } = await import(path.join(LIB, "units.js"));

test("the symbols a reader writes replace the ones the compiler spells out", () => {
  assert.equal(formatUnit("Ohm"), "Ω", "a resistance");
  assert.equal(formatUnit("degC"), "°C", "a temperature");
  assert.equal(formatUnit("deg"), "°", "an angle");
  assert.equal(formatUnit("kOhm"), "kΩ", "and a prefixed one keeps its prefix");
  assert.equal(formatUnit("deg/s"), "°/s", "in a quotient");
});

test("a dot between units becomes a multiplication dot", () => {
  assert.equal(formatUnit("N.m"), "N·m");
  assert.equal(formatUnit("kg.m2"), "kg·m²", "and its exponent is raised");
  assert.equal(formatUnit("s-1.K"), "s⁻¹·K");
  assert.equal(formatUnit("km2.s-4.A-1.g"), "km²·s⁻⁴·A⁻¹·g", "the one that reads worst");
  assert.equal(formatUnit("J/(kg.K)"), "J/(kg·K)", "inside a denominator group too");
  assert.equal(formatUnit("W/(m2.K)"), "W/(m²·K)");
});

test("a leading u is the micro prefix", () => {
  assert.equal(formatUnit("uF"), "µF");
  assert.equal(formatUnit("us"), "µs");
  assert.equal(formatUnit("um/s"), "µm/s", "in a compound, not only at the start");
  assert.equal(formatUnit("u"), "u", "but u on its own is a unit, not a prefix");
  assert.equal(formatUnit("kg"), "kg", "and a unit that merely starts with u is left alone");
});

test("every unit this vault has produced comes out as expected", () => {
  // Real strings, from the model descriptions of 32 simulated models.
  const expected = {
    m: "m", V: "V", K: "K", W: "W", A: "A", N: "N", Pa: "Pa", s: "s", rad: "rad",
    kg: "kg", S: "S", "1": "1", H: "H", Hz: "Hz", F: "F", Wb: "Wb", J: "J",
    bar: "bar", mm: "mm", "g/cm3": "g/cm³", "rev/min": "rev/min",
    "rad/s": "rad/s", "kg/s": "kg/s", "m/s": "m/s", "m/s2": "m/s²", "J/kg": "J/kg",
    "kg/m3": "kg/m³", "1/K": "1/K", "kg/kg": "kg/kg", "N/m": "N/m", "N.s/m": "N·s/m",
    "kg/mol": "kg/mol", "Pa.s": "Pa·s", "kg.m/s": "kg·m/s", "m3/s": "m³/s",
    "K/s": "K/s", "J/K": "J/K", "W/K": "W/K", "m3": "m³", "m2": "m²", "s-2": "s⁻²",
    "m.s-1": "m·s⁻¹", "m.s-2": "m·s⁻²", "s-1.A": "s⁻¹·A", "s-1.K": "s⁻¹·K",
    "rad/s2": "rad/s²", "kg.m2": "kg·m²",
    "J/(kg.K)": "J/(kg·K)", "W/(m2.K)": "W/(m²·K)",
    Ohm: "Ω", degC: "°C", deg: "°",
    "km2.s-4.A-1.g": "km²·s⁻⁴·A⁻¹·g",
  };
  for (const [input, output] of Object.entries(expected)) {
    assert.equal(formatUnit(input), output, `${input} -> ${output}`);
  }
});

test("a unit is drawn as runs, so its exponent can be a real size", () => {
  // The exponent as a Unicode glyph measured 5px of ink at 11px, and no stylesheet could
  // grow it without growing the unit's letters. A run is a digit the renderer sizes.
  const shape = (unit) => unitRuns(unit).map((r) => `${r.kind}:${r.text}`).join(" · ");
  const flat = (unit) => unitRuns(unit).map((r) => r.text).join("");

  assert.equal(shape("m.s-1"), "base:m·s · sup:-1", "the dot is a middot, the exponent is its own run");
  assert.equal(shape("kg/m3"), "base:kg/m · sup:3");
  assert.equal(shape("J/(kg.K)"), "base:J/(kg·K)", "no exponent, no superscript run");
  assert.equal(shape("Ohm"), "base:Ω", "the symbols are replaced here too");
  assert.equal(shape("uF"), "base:µF");
  assert.equal(shape("degC"), "base:°C");
  assert.equal(shape("1/K"), "base:1/K", "the dimensionless numerator keeps its own shape");
  assert.equal(shape("km2.s-4.A-1.g"), "base:km · sup:2 · base:·s · sup:-4 · base:·A · sup:-1 · base:·g");
  assert.equal(shape("H2O"), "base:H2O", "digits inside a name are not an exponent");
  assert.equal(shape("kg^2"), "base:kg^2", "and what is not unit grammar is one plain run");
  assert.deepEqual(unitRuns(""), [], "nothing to draw for no unit");

  // The runs join back into the flat spelling: that is what makes them copyable, and what
  // the DOM's textContent amounts to.
  assert.equal(flat("m.s-1"), "m·s-1");
  assert.equal(flat("km2.s-4.A-1.g"), "km2·s-4·A-1·g");
  assert.equal(flat("m.s-1").replace(/-1$/, ""), "m·s", "and the exponent is separable from the unit");
});

test("a bare number is the dimensionless unit, not an exponent", () => {
  assert.equal(formatUnit("1"), "1", "it keeps its own shape");
  assert.equal(formatUnit("1/K"), "1/K", "and so does the numerator");
  assert.equal(formatUnit("10"), "10", "and any other bare number");
});

test("something that is not unit grammar is left exactly as it was", () => {
  // A nearly-right unit is worse than an ugly one: it reads as authoritative.
  for (const odd of ["kg^2", "some unit", "m..s", "1.5", "m/(s", "m/s)", "(kg.m)/s", "m*kg", ""]) {
    assert.equal(formatUnit(odd), odd === "" ? "" : odd, `left alone: ${odd}`);
  }
});

test("formatting a formatted unit changes nothing", () => {
  // The transform runs wherever a unit is shown, so it can meet its own output.
  const real = ["m.s-1", "J/(kg.K)", "Ohm", "degC", "uF", "km2.s-4.A-1.g", "V", "1/K", "ohm"];
  for (const unit of real) {
    const once = formatUnit(unit);
    assert.equal(formatUnit(once), once, `stable: ${unit} -> ${once}`);
  }
});
