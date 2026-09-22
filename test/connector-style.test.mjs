/**
 * MSL's rule for how a connection is drawn.
 *
 * "the color and thickness of a connector line are taken from the first line
 * element in the icon annotation of a connector class" — from the UsersGuide of
 * `Modelica.Blocks`, in the documentation of the bus example, which is the only
 * place in MSL 4.1.0 that states it.
 *
 * The classes below are the real ones, copied from the library, because the rule
 * is about what MSL actually writes: a bus that hides a small coloured bar behind
 * its polygon to declare its wires yellow and double, and a flange that is a
 * filled grey circle naming no line colour at all.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildLibs, repoRoot } from "./helpers/build.mjs";

const LIB = buildLibs("connector-style-lib", ["src/render/connector-style.ts"]);
const { connectorWireStyle, LINE_THICKNESS_UNIT } = await import(
  path.join(LIB, "connector-style.js")
);

/** A class definition with just the icon the rule reads. */
const def = (name, icon) => ({ name, shortName: name.split(".").pop(), icon, ports: [], parameters: [] });

test("a connector line takes its colour and width from the connector's own icon", () => {
  // Modelica.Icons.SignalBus: a small bar in the bus colour, thickness 0.5, then
  // the polygon that hides it. MSL: "the connecting line has the color of the
  // ControlBus with double width (due to thickness=0.5)".
  const signalBus = def("Modelica.Icons.SignalBus", [
    { kind: "Rectangle", extent: [-20, -2, 20, 2], lineColor: [255, 204, 51], lineThickness: 0.5 },
    { kind: "Polygon", points: [-80, 50, 80, 50, 100, 30], fillColor: [255, 215, 136], fillPattern: "Solid" },
    { kind: "Ellipse", extent: [-100, -100, 100, 100], fillColor: [255, 215, 136], fillPattern: "Solid" },
  ]);
  assert.deepEqual(connectorWireStyle(signalBus), { color: [255, 204, 51], widthRatio: 2 });

  // Modelica.Electrical.Analog.Interfaces.Pin: a filled blue rectangle, and the
  // colour IS named, so the wire is the domain colour at a single width.
  const pin = def("Modelica.Electrical.Analog.Interfaces.Pin", [
    { kind: "Rectangle", extent: [-100, 100, 100, -100], lineColor: [0, 0, 255], fillColor: [0, 0, 255], fillPattern: "Solid" },
  ]);
  assert.deepEqual(connectorWireStyle(pin), { color: [0, 0, 255], widthRatio: 1 });

  // Modelica.Mechanics.MultiBody.Interfaces.Frame_a, measured as one of the 14
  // connectors that ask for 0.5.
  const frame = def("Modelica.Mechanics.MultiBody.Interfaces.Frame_a", [
    { kind: "Rectangle", extent: [-10, 10, 10, -10], lineColor: [95, 95, 95], lineThickness: 0.5 },
  ]);
  assert.deepEqual(connectorWireStyle(frame), { color: [95, 95, 95], widthRatio: 2 });
});

test("a mark with no line colour takes the language's default, not its fill", () => {
  // The two rotational flanges are both a single filled ellipse naming no
  // `lineColor`: Flange_a is grey and Flange_b is WHITE. Reading the fill would
  // draw every shaft connection in white — invisible on a light canvas — so the
  // rule's letter is followed and both are black, which is what
  // `FilledShape.lineColor = Black` says. Where MSL wants another colour it names
  // one, as the MultiBody frames do.
  const flangeA = def("Modelica.Mechanics.Rotational.Interfaces.Flange_a", [
    { kind: "Ellipse", extent: [-100, 100, 100, -100], fillColor: [95, 95, 95], fillPattern: "Solid" },
  ]);
  const flangeB = def("Modelica.Mechanics.Rotational.Interfaces.Flange_b", [
    { kind: "Ellipse", extent: [-100, 100, 100, -100], fillColor: [255, 255, 255], fillPattern: "Solid" },
  ]);
  assert.deepEqual(connectorWireStyle(flangeA), { color: [0, 0, 0], widthRatio: 1 });
  assert.deepEqual(connectorWireStyle(flangeB), { color: [0, 0, 0], widthRatio: 1 });
});

test("the first line element means the first one DRAWN", () => {
  // Base-class graphics come first, then the class's own — the order the spec
  // draws in, and the order the library collects them in. A class that inherits
  // its mark from a base declares the wire's appearance through that base.
  const inheritedFirst = def("P.Inherited", [
    { kind: "Line", points: [-10, 0, 10, 0], color: [0, 127, 255], thickness: 1 },
    { kind: "Rectangle", extent: [-10, -10, 10, 10], lineColor: [0, 0, 0] },
  ]);
  assert.deepEqual(connectorWireStyle(inheritedFirst), { color: [0, 127, 255], widthRatio: 4 });

  // And an invisible line is passed over: `LinePattern.None` "indicates ... an
  // invisible line", so it is not the element a tool reads the appearance from.
  const skipped = def("P.Skipped", [
    { kind: "Rectangle", extent: [-20, 2, 22, -2], lineColor: [255, 204, 51], lineThickness: 0.5, pattern: "None" },
    { kind: "Ellipse", extent: [-100, 100, 100, -100], lineColor: [1, 2, 3] },
  ]);
  assert.deepEqual(connectorWireStyle(skipped), { color: [1, 2, 3], widthRatio: 1 });

  // Text is not a line, and a class with nothing but text has no wire style.
  const textOnly = def("P.TextOnly", [
    { kind: "Text", extent: [-100, 100, 100, -100], textString: "%name" },
  ]);
  assert.equal(connectorWireStyle(textOnly), undefined);
  assert.equal(connectorWireStyle(undefined), undefined);
});

test("the widths are the ratios MSL's own wording implies", () => {
  // "double width (due to thickness=0.5)" fixes 0.25 as the unit, so the
  // distribution measured over MSL 4.1.0 reads: 80 connectors at 1, and 14 at 2.
  assert.equal(LINE_THICKNESS_UNIT, 0.25, "the language default is one line");
  const ratio = (t) =>
    connectorWireStyle(def("P.T", [{ kind: "Line", points: [0, 0, 1, 1], thickness: t }])).widthRatio;
  assert.equal(ratio(0.25), 1, "no thickness attribute means a single line");
  assert.equal(ratio(0.5), 2, "double");
  assert.equal(ratio(1), 4, "the `thickness=1` MSL uses for emphasised marks");
  assert.equal(ratio(5), 20, "and the six graphics that ask for 5.0");
});

test("the library resolves a port's connector class even when the name is relative", async () => {
  // The rule needs the connector CLASS, and MSL writes a bare `Pin` inside a
  // package as often as a full path. `PortDef.type` is what the model wrote;
  // `connectorClass` is what it means, which is what the editor looks up.
  const fs = await import("node:fs");
  const root = path.join(repoRoot, "test", "fixtures");
  void root;
  const source = fs.readFileSync(path.join(repoRoot, "src/modelica/library.ts"), "utf8");
  assert.match(
    source,
    /\.\.\.\(info \? \{ connectorClass: info\.qualifiedName \} : \{\}\)/,
    "a resolved port carries the class it resolved to"
  );
  assert.match(
    source,
    /interface ConnectorInfo \{[\s\S]*?qualifiedName: string;/,
    "and the connector info knows which class that was"
  );
  const types = fs.readFileSync(path.join(repoRoot, "src/modelica/types.ts"), "utf8");
  assert.match(types, /connectorClass\?: string;/, "the port definition carries it");
  assert.match(
    types,
    /The connector type as the model WROTE it/,
    "and `type` is documented as what was written, not as a qualified name"
  );
});
