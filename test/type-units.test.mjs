/**
 * The unit a declared type carries, resolved from the library's own source.
 *
 * Run against the real Modelica Standard Library, because the shape being parsed is MSL's and a
 * synthetic fixture would only prove the fixture right: `SI.Voltage` is `ElectricPotential`,
 * which is `Real(unit = "V")`, and nothing in a parameter's declaration mentions volts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";

const TYPES = await import(
  path.join(buildLibs("type-units", ["src/modelica/type-units.ts"]), "type-units.js")
);
const PARSER = await import(
  path.join(buildLibs("type-units-parser", ["src/modelica/parser.ts"]), "parser.js")
);
const { unitsOfType } = TYPES;

const MSL_CANDIDATES = [
  "/home/para/.openmodelica/libraries/Modelica 4.1.0+maint.om/Units.mo",
  "/home/para/.openmodelica/libraries/Modelica 3.2.3+maint.om/Units.mo",
];
const MSL = MSL_CANDIDATES.find((p) => fs.existsSync(p));

/** Every class in MSL's Units.mo, keyed as the library index keys them. */
function mslLookup() {
  const classes = new Map();
  for (const cls of PARSER.parseModelica(fs.readFileSync(MSL, "utf8"))) {
    const add = (c, prefix) => {
      classes.set(`${prefix}${c.name}`, c);
      for (const nested of c.nested ?? []) add(nested, `${prefix}${c.name}.`);
    };
    // `Units.mo` declares the package `Units`, which lives in `Modelica`: the library index keys
    // it as `Modelica.Units.…`, and so must this.
    add(cls, "Modelica.");
  }
  return (name, from) => {
    if (classes.has(name)) return classes.get(name);
    if (from) {
      const parts = from.split(".");
      for (let i = parts.length; i > 0; i--) {
        const candidate = `${parts.slice(0, i).join(".")}.${name}`;
        if (classes.has(candidate)) return classes.get(candidate);
      }
    }
    return undefined;
  };
}

test("a type's unit is found through the chain of short class definitions", { skip: !MSL }, () => {
  const lookup = mslLookup();
  // Three classes deep, and the unit is in the last one.
  assert.deepEqual(unitsOfType("Modelica.Units.SI.Voltage", lookup), { unit: "V" });
  assert.deepEqual(unitsOfType("Modelica.Units.SI.Pressure", lookup), {
    unit: "Pa",
    displayUnit: "bar",
  });
  assert.deepEqual(unitsOfType("Modelica.Units.SI.Time", lookup), { unit: "s" });
  assert.deepEqual(unitsOfType("Modelica.Units.SI.MassFlowRate", lookup), { unit: "kg/s" });
  // The one the panel needs before a run: the type asks for Celsius as well as stating kelvin.
  assert.deepEqual(unitsOfType("Modelica.Units.SI.ThermodynamicTemperature", lookup), {
    unit: "K",
    displayUnit: "degC",
  });
});

test("and nothing is claimed for a type that states no unit", { skip: !MSL }, () => {
  const lookup = mslLookup();
  assert.deepEqual(unitsOfType("Real", lookup), {}, "a builtin states no unit");
  assert.deepEqual(unitsOfType("Modelica.Units.SI", lookup), {}, "a package is not a unit type");
  assert.deepEqual(unitsOfType("No.Such.Type", lookup), {}, "an unresolvable name costs nothing");
  assert.deepEqual(unitsOfType("", lookup), {});
  assert.deepEqual(unitsOfType(undefined, lookup), {});
});

test("a hand-written library cannot hang or throw it", () => {
  // A cycle, which a parser reading a broken file can produce.
  const cyclic = (name) =>
    name === "A" ? { aliasOf: "B", qualifiedName: "A" } : { aliasOf: "A", qualifiedName: "B" };
  assert.deepEqual(unitsOfType("A", cyclic), {}, "a cycle ends at the depth limit");

  // A lookup that throws — the library index is a Map behind a method that can be given junk.
  const throwing = () => {
    throw new Error("no");
  };
  assert.deepEqual(unitsOfType("Modelica.Units.SI.Voltage", throwing), {});

  // Quotes are the parser's own spelling of a modifier value; a unit written without them, as a
  // hand-written library may, is still read.
  const plain = () => ({ aliasOf: "Real", aliasModifiers: { unit: "V" } });
  assert.deepEqual(unitsOfType("My.Voltage", plain), { unit: "V" });
  const quoted = () => ({ aliasOf: "Real", aliasModifiers: { unit: '"V"', displayUnit: '"mV"' } });
  assert.deepEqual(unitsOfType("My.Voltage", quoted), { unit: "V", displayUnit: "mV" });
});

test("the parser keeps a short class definition's target and modifiers", () => {
  // The data the resolver reads. It was thrown away: the branch skipped to the `;`, keeping the
  // annotation of `connector RealInput = input Real "..." annotation(...)` and nothing else.
  const [pkg] = PARSER.parseModelica(`package P
  type Voltage = Real(unit="V");
  type Pressure = Real(unit="Pa", displayUnit="bar");
  type Alias = Voltage;
  connector RealInput = input Real;
end P;`);
  const byName = Object.fromEntries((pkg.nested ?? []).map((c) => [c.name, c]));
  assert.equal(byName.Voltage.aliasOf, "Real");
  assert.deepEqual(byName.Voltage.aliasModifiers, { unit: '"V"' });
  assert.deepEqual(byName.Pressure.aliasModifiers, { unit: '"Pa"', displayUnit: '"bar"' });
  assert.equal(byName.Alias.aliasOf, "Voltage", "an alias of an alias keeps its name");
  assert.deepEqual(byName.Alias.aliasModifiers, undefined);
  assert.equal(byName.RealInput.aliasOf, "Real", "and the connector short form still parses");
});
