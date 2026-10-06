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
import os from "node:os";
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
const MSL_ROOTS = [
  "/home/para/.openmodelica/libraries/Modelica 4.1.0+maint.om",
  "/home/para/.openmodelica/libraries/Complex 4.1.0+maint.om",
];

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

test("a real component's parameter types resolve, import alias and all", { skip: !MSL }, async () => {
  // The case that was reported, and the reason this test exists in this form. MSL writes a
  // parameter's type with an IMPORT ALIAS — `parameter SI.Inertia J` — and the short name behind
  // it is also the name of the component class that declares it. A lookup that fell back to a
  // unique short name found two candidates, gave up, and the rotational inertia showed no unit
  // at all; the first version of this test used a fully qualified name from a fixture, which no
  // MSL class writes, so it passed while the app did not.
  const { loadLibraryIndex } = await import(
    path.join(buildLibs("type-units-index", ["src/modelica/library.ts"]), "library.js")
  );
  const loaded = loadLibraryIndex({
    roots: MSL_ROOTS.filter((r) => fs.existsSync(r)),
    cacheFile: path.join(os.tmpdir(), `type-units-index-${process.pid}.json`),
  });
  assert.ok(loaded.index.size > 1000, `the library is loaded, ${loaded.index.size} classes`);

  const unitsOf = (className) => {
    const cls = loaded.index.component(className);
    assert.ok(cls, `${className} is in the library`);
    return Object.fromEntries(
      cls.parameters.map((p) => [p.name, unitsOfType(p.type, (n, from) => loaded.index.resolveTypeName(n, from)).unit])
    );
  };

  // The reported one, with its type asserted verbatim: if MSL ever spells it differently, this
  // test says so instead of quietly resolving nothing.
  const inertia = loaded.index.component("Modelica.Mechanics.Rotational.Components.Inertia");
  assert.equal(
    inertia.parameters.find((p) => p.name === "J").type,
    "SI.Inertia",
    "the type as the source writes it: an alias, not a qualified name"
  );
  assert.equal(unitsOf("Modelica.Mechanics.Rotational.Components.Inertia").J, "kg.m2");

  const resistor = unitsOf("Modelica.Electrical.Analog.Basic.Resistor");
  assert.equal(resistor.R, "Ohm");
  assert.equal(resistor.T, "K");
  assert.equal(resistor["T_ref"], "K");
  assert.equal(resistor.alpha, "1/K");
  assert.equal(unitsOf("Modelica.Electrical.Analog.Basic.Capacitor").C, "F");
  assert.equal(unitsOf("Modelica.Mechanics.Translational.Components.Mass").m, "kg");
  assert.equal(unitsOf("Modelica.Mechanics.Translational.Components.Mass")["v.start"], "m/s");
  const damper = unitsOf("Modelica.Mechanics.Rotational.Components.SpringDamper");
  assert.equal(damper["phi_rel.start"], "rad");
  assert.equal(damper["w_rel.start"], "rad/s");
});

test("the units survive the index cache — the round trip the app actually does", { skip: !MSL }, async () => {
  // The bug this exists for, and it was invisible to every test above: the app does not parse
  // the library on every launch, it reads a cached index. The cache serialises the whole parsed
  // class, so a field added to `ParsedClass` reaches a cache written by the OLD parser only if
  // `INDEX_CACHE_VERSION` is bumped — and the alias fields a unit lives in were added without
  // it. Every field then showed no unit at all, while a freshly parsed index (which is what
  // these tests built) resolved everything: measured on the user's own cache, even
  // `Modelica.Units.SI.Time` came back with no unit.
  const { LibraryIndex, loadLibraryIndex } = await import(
    path.join(buildLibs("type-units-cache", ["src/modelica/library.ts"]), "library.js")
  );
  const roots = MSL_ROOTS.filter((r) => fs.existsSync(r));
  const loaded = loadLibraryIndex({ roots, cacheFile: path.join(os.tmpdir(), `type-units-rt-${process.pid}.json`) });
  const resolve = (n, from) => loaded.index.resolveTypeName(n, from);
  assert.equal(unitsOfType("SI.Inertia", resolve).unit, "kg.m2", "a fresh index resolves");

  // Through the cache and back, which is what a second launch sees.
  const restored = LibraryIndex.fromJSON(loaded.index.toJSON());
  assert.ok(restored, "the cache is accepted at this version");
  const fromCache = (n, from) => restored.resolveTypeName(n, from);
  assert.equal(unitsOfType("SI.Inertia", fromCache).unit, "kg.m2", "and so does the cached one");
  assert.equal(unitsOfType("SI.Angle", fromCache).unit, "rad");
  assert.equal(unitsOfType("Modelica.Units.SI.Time", fromCache).unit, "s");

  // And a cache from the version that lacked the fields is REJECTED, so the app rebuilds it
  // rather than resolving nothing for as long as the file survives. This is the mechanism the
  // bump relies on; if it ever stops working, the units silently disappear on every machine
  // that has an older cache.
  const stale = { ...loaded.index.toJSON(), version: 7 };
  assert.equal(LibraryIndex.fromJSON(stale), null, "an older cache is refused, not trusted");
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
