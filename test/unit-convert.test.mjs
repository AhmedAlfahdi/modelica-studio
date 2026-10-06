/**
 * Showing and typing a value in another unit.
 *
 * The property that matters is that the number the MODEL holds never moves: a field showing
 * `1.01325 bar` is still 101325 Pa, because that is what `p_ambient = 101325` means. So the
 * tests below are mostly round trips, plus the two places a naive implementation goes wrong —
 * affine units (0 °C is not 0 K) and expressions (a field accepts `system.allowFlowReversal`,
 * and a parser that rejected what it did not recognise would take that away).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";

const LIB = buildLibs("unit-convert-lib", ["src/modelica/unit-convert.ts"]);
const { choicesFor, formatValue, fromBase, parseValue, toBase } = await import(
  path.join(LIB, "unit-convert.js")
);

/** The choice a field would offer for `symbol`, or a failure that names it. */
const pick = (base, symbol, own = base) => {
  const choice = choicesFor(base, own).find((c) => c.symbol === symbol);
  assert.ok(choice, `${base} offers ${symbol}`);
  return choice;
};

test("a unit with no alternatives offers no picker", () => {
  // A picker with one entry is worse than no picker: it looks like a choice.
  assert.deepEqual(choicesFor("kg.m2", "kg·m²"), [], "an unknown compound");
  assert.deepEqual(choicesFor("", ""), []);
  assert.deepEqual(choicesFor("1", "1"), [], "the dimensionless unit has nothing to switch to");
});

test("the model's own unit is always the first choice", () => {
  const choices = choicesFor("Pa", "Pa");
  assert.equal(choices[0].symbol, "Pa", "so a field starts where the model is");
  assert.equal(choices[0].factor, 1);
  assert.equal(choices[0].offset, undefined);
  assert.equal(choices[0].alternative, undefined, "and is not marked as an alternative");
  assert.ok(choices.length > 1, "with the alternatives after it");
  assert.ok(
    choices.slice(1).every((c) => c.alternative === true),
    "each of which is marked"
  );
});

test("pressure and length convert exactly, both ways", () => {
  const bar = pick("Pa", "bar");
  assert.equal(toBase(1.01325, bar), 101325, "a standard atmosphere, exactly");
  assert.equal(fromBase(101325, bar), 1.01325);
  assert.equal(fromBase(toBase(0.5, bar), bar), 0.5, "and a round trip is lossless");

  const mm = pick("m", "mm");
  assert.equal(toBase(2.5, mm), 0.0025);
  assert.equal(fromBase(0.0025, mm), 2.5);
  const kmh = pick("m/s", "km/h");
  assert.equal(toBase(36, kmh), 10, "36 km/h is 10 m/s");
  assert.equal(fromBase(10, kmh), 36);
});

test("an affine unit is a shift, not only a scale", () => {
  // The one a scaling-only implementation gets wrong: 0 °C is 273.15 K, and 0 K is -273.15 °C.
  const c = pick("K", "°C");
  assert.equal(toBase(0, c), 273.15);
  assert.equal(toBase(100, c), 373.15);
  assert.equal(fromBase(0, c), -273.15);
  assert.equal(fromBase(273.15, c), 0);
  const f = pick("K", "°F");
  assert.ok(Math.abs(toBase(32, f) - 273.15) < 1e-9, "32 °F is 0 °C");
  assert.ok(Math.abs(toBase(212, f) - 373.15) < 1e-9, "and 212 °F is 100 °C");
  // And the same for a flow: the field's own unit is offered under the compiler's spelling.
  assert.equal(choicesFor("m3/s", "m³/s")[0].symbol, "m³/s", "the symbol shown is the pretty one");
});

test("what a reader types is a number and, optionally, a unit", () => {
  const choices = choicesFor("Pa", "Pa");
  assert.deepEqual(parseValue("101325", choices), { value: 101325, choice: choices[0] });
  assert.deepEqual(parseValue("  101325  ", choices), { value: 101325, choice: choices[0] });
  assert.deepEqual(parseValue("1.01325 bar", choices)?.choice.symbol, "bar");
  assert.deepEqual(parseValue("-40 °C", choicesFor("K", "K"))?.value, -40);
  assert.deepEqual(parseValue("1e5 Pa", choices)?.value, 1e5, "and exponent form, as Modelica writes it");
});

test("anything that is not a number in a known unit is left alone", () => {
  // The fallback that keeps the fields usable: they accept expressions, and a parser that
  // rejected what it did not recognise would silently drop `system.allowFlowReversal`.
  const choices = choicesFor("Pa", "Pa");
  assert.equal(parseValue("system.allowFlowReversal", choices), null);
  assert.equal(parseValue("2 bananas", choices), null, "a unit the field does not offer");
  assert.equal(parseValue("1.01325 atm", choices), null, "even a real one, if it is not on the list");
  assert.equal(parseValue("", choices), null);
  assert.equal(parseValue("NaN", choices), null);
  assert.equal(parseValue("1 + 2", choices), null, "an arithmetic expression is not a value");
});

test("a value is shown with the digits it has, and no more", () => {
  assert.equal(formatValue(1.01325), "1.01325", "the atmosphere again");
  assert.equal(formatValue(101325), "101325", "no exponent for a number this size");
  assert.equal(formatValue(0), "0");
  assert.equal(formatValue(1 / 3), "0.3333333333", "ten significant digits, so a double survives a round trip");
  assert.equal(formatValue(1e-7), "1e-7", "and a small number stays readable in exponent form");
  assert.equal(formatValue(Number.NaN), "", "nothing to show for a value that is not a number");
});
