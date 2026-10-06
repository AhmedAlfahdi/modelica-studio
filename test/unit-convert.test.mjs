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
const convert = await import(path.join(LIB, "unit-convert.js"));
const { asDisplayed, choicesFor, formatValue, fromBase, parseValue, toBase } = convert;

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

test("a result is shown in the unit the model asks for, values and labels together", () => {
  // The point of the conversion: a series labelled `mbar` whose numbers are still in pascals
  // reads as authoritative and is wrong. Values and unit move together, and only from the
  // DECLARED unit, which the series carries — so converting twice cannot happen.
  const result = {
    time: [0, 1],
    series: [
      { name: "system.p_ambient", values: [101325, 90000], unit: "Pa" },
      { name: "heater.T", values: [293.15, 373.15], unit: "K" },
      { name: "motor.w", values: [1, 2], unit: "rad/s" },
      { name: "odd.thing", values: [1, 2], unit: "furlong" },
    ],
    compileMs: 0,
    simulateMs: 0,
    reusedBinary: true,
    warnings: [],
  };
  const shown = asDisplayed(result, {
    "system.p_ambient": "mbar",
    "heater.T": "°C",
    "motor.w": "deg/s",
    "odd.thing": "furlong",
  });

  assert.deepEqual(shown.series[0].values, [1013.25, 900], "pascals to millibar");
  assert.equal(shown.series[0].unit, "mbar");
  assert.deepEqual(shown.series[1].values, [20, 100], "kelvin to celsius, offset and all");
  assert.equal(shown.series[1].unit, "°C");
  assert.deepEqual(shown.series[2].values, result.series[2].values, "a unit not in the table is left alone");
  assert.equal(shown.series[2].unit, "rad/s", "with its own label, not the one asked for");
  assert.deepEqual(shown.series[3].values, [1, 2], "and so is a unit the table has never heard of");

  // The model's result is untouched, so removing a `displayUnit` brings the numbers back.
  assert.deepEqual(result.series[0].values, [101325, 90000], "the stored result stays as it was");
  assert.equal(result.series[0].unit, "Pa");
  assert.equal(asDisplayed(result, undefined), result, "and no units at all is the same object");
  assert.equal(
    asDisplayed(result, { "system.p_ambient": "Pa" }),
    result,
    "a display unit equal to the declared one changes nothing"
  );
});

test("a bare number is read in the unit the field is showing", () => {
  // The bug this exists for: a field displaying `1.01325 bar` (101325 Pa) accepts an edit of
  // `2` — meaning two bar — and a parser that assumed the model's own unit wrote 2 Pa. Both
  // are plausible numbers, so nothing downstream could tell it had gone wrong.
  const choices = choicesFor("Pa", "Pa");
  const bar = choices.find((c) => c.symbol === "bar");
  assert.equal(parseValue("2", choices).value, 2, "with nothing shown, the model's unit");
  assert.equal(parseValue("2", choices, bar).choice.symbol, "bar", "with bar shown, bar");
  assert.equal(toBase(2, parseValue("2", choices, bar).choice), 200000, "two bar is 200000 Pa");
  assert.equal(
    parseValue("2 Pa", choices, bar).choice.symbol,
    "Pa",
    "and a unit written out is still obeyed, whatever the field is showing"
  );
  // By the name the model uses as well as the symbol: `20 degC` is what a reader writes who has
  // read the declaration, and verbatim would put `T = 20 degC` in the model, which omc rejects.
  const kelvin = choicesFor("K", "K");
  assert.equal(parseValue("20 degC", kelvin).choice.symbol, "°C", "found by the Modelica name");
  assert.equal(parseValue("20 °C", kelvin).choice.symbol, "°C", "and by the symbol");
  assert.equal(
    toBase(parseValue("20 degC", kelvin).value, parseValue("20 degC", kelvin).choice),
    293.15,
    "20 °C is 293.15 K"
  );
  assert.equal(
    toBase(parseValue("2 Pa", choices, bar).value, parseValue("2 Pa", choices, bar).choice),
    2,
    "so an explicit unit is not converted twice"
  );
});

test("a display unit is found by its Modelica name as well as its symbol", () => {
  // The bug the real-OMC probe caught: a model says `displayUnit="degC"` — the NAME, because
  // `°C` is not a unit the compiler resolves — and a lookup that answered only to the symbol
  // left the temperature in kelvin with the model asking for Celsius.
  const { choiceFor } = convert;
  const choices = choicesFor("K", "K");
  assert.equal(choiceFor(choices, "degC").symbol, "°C", "found by the name the model writes");
  assert.equal(choiceFor(choices, "°C").symbol, "°C", "and by the symbol the field shows");
  assert.equal(choiceFor(choices, "degF").symbol, "°F");
  assert.equal(
    choiceFor(choicesFor("Pa", "Pa"), "bar").symbol,
    "bar",
    "a unit whose two spellings agree needs no second name"
  );
  assert.equal(choiceFor(choices, "furlong"), undefined, "and nothing for a unit it does not have");

  const shown = asDisplayed(
    { series: [{ name: "heater.T", values: [293.15], unit: "K" }] },
    { "heater.T": "degC" }
  );
  assert.deepEqual(shown.series[0].values, [20], "293.15 K is 20 °C");
  assert.equal(shown.series[0].unit, "°C", "labelled with the symbol a reader reads");

  // The panel writes the NAME back, or the declaration is not a unit the compiler resolves.
  assert.equal(choicesFor("K", "K").find((c) => c.symbol === "°C").id, "degC");
  assert.equal(choicesFor("F", "F").find((c) => c.symbol === "µF").id, "uF");
  assert.equal(choicesFor("Ohm", "Ω")[0].symbol, "Ω", "the model's own unit keeps its symbol");
  assert.equal(choicesFor("Ohm", "Ω")[0].id, undefined, "and needs no separate name");
});
