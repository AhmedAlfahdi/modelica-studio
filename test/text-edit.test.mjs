/**
 * A diagram edit must not destroy text the diagram cannot express.
 *
 * The reported loss, with the plugin's own history folder as the evidence: a
 * 4227-byte TwoOutletTank holding `package Medium = Modelica.Media.Water...` and
 * twelve comments was written back as 1888 bytes — byte for byte what
 * `serializeDiagram` produces from it — with NO declaration of Medium left. Every
 * later simulation of that file then failed with
 *
 *     Base class Medium not found in scope TwoOutletTank
 *
 * which is the error in the user's log. The serializer is a projection of the
 * model onto components, variables, wires and graphics; a nested class
 * declaration, an `extends`, an `import`, an `algorithm` section, a `protected`
 * marker, a model-level annotation, a description string and every comment are
 * outside that projection, so a rebuild drops them.
 *
 * `patchDiagramEdits` writes the diagram's changes into the text instead, and
 * verifies its own output before returning it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";

const { parseModelica, toDiagramModel, findClass } = await import(
  path.join(buildLibs("te-parser", ["src/modelica/parser.ts"]), "parser.js")
);
const { serializeDiagram } = await import(
  path.join(buildLibs("te-ser", ["src/modelica/serializer.ts"]), "serializer.js")
);
const { patchDiagramEdits, lastPatchRefusal } = await import(
  path.join(buildLibs("te-edit", ["src/modelica/text-edit.ts"]), "text-edit.js")
);

/** A hand-written fluid model: a nested package, comments, descriptions. */
const FLUID = `model Tank "Water tank with two outlets"
  // The medium is declared once here and propagated to every fluid component
  // with redeclare package Medium = Medium.
  package Medium = Modelica.Media.Water.StandardWater
    "Medium model: liquid water with standard properties";

  // The tank itself: 2 m tall, filled to 1.5 m at t = 0.
  Modelica.Fluid.Vessels.OpenTank tank(
    redeclare package Medium = Medium,
    height = 2.0,
    crossArea = 1.0,
    level_start = 1.5,
    nPorts = 1)
    annotation(Placement(transformation(extent = {{-30, -10}, {10, 30}})));

  Modelica.Fluid.Pipes.StaticPipe outlet(
    redeclare package Medium = Medium,
    length = 0.5,
    diameter = 0.05)
    annotation(Placement(transformation(extent = {{30, -10}, {50, 10}})));

  // Discharge to atmosphere.
  Modelica.Fluid.Sources.Boundary_pT atmosphere(
    redeclare package Medium = Medium,
    nPorts = 1)
    annotation(Placement(transformation(extent = {{70, -10}, {90, 10}})));

equation
  connect(tank.ports[1], outlet.port_a);
  connect(outlet.port_b, atmosphere.ports[1]);
end Tank;
`;

function modelOf(source, name = "Tank") {
  return toDiagramModel(findClass(parseModelica(source), name), () => undefined);
}

function patched(source, mutate, name = "Tank") {
  const model = modelOf(source, name);
  mutate(model);
  return patchDiagramEdits(source, model);
}

function moveComponent(model, id, dx = 7, dy = 3) {
  const c = model.components.find((x) => x.id === id);
  assert.ok(c, `no component ${id}`);
  c.placement.extent = [
    c.placement.extent[0] + dx,
    c.placement.extent[1] + dy,
    c.placement.extent[2] + dx,
    c.placement.extent[3] + dy,
  ];
}

/* ------------------------------------------------------------------ */
/* The reported loss                                                   */
/* ------------------------------------------------------------------ */

test("moving a component keeps a nested package declaration", () => {
  const res = patched(FLUID, (m) => moveComponent(m, "tank"));
  assert.ok(res, `refused: ${lastPatchRefusal()}`);
  assert.match(res.text, /^[ \t]*package Medium[ \t]*=/m, "the Medium declaration is still there");
  assert.match(res.text, /Modelica\.Media\.Water\.StandardWater/);
});

test("moving a component keeps every comment in the file", () => {
  const before = (FLUID.match(/^[ \t]*\/\//gm) || []).length;
  const res = patched(FLUID, (m) => moveComponent(m, "tank"));
  assert.ok(res, `refused: ${lastPatchRefusal()}`);
  assert.equal((res.text.match(/^[ \t]*\/\//gm) || []).length, before, "no comment was dropped");
  assert.match(res.text, /\/\/ Discharge to atmosphere\./);
});

test("moving a component changes only that declaration", () => {
  const res = patched(FLUID, (m) => moveComponent(m, "tank"));
  assert.ok(res, `refused: ${lastPatchRefusal()}`);
  const before = FLUID.split("\n");
  const after = res.text.split("\n");
  assert.equal(after.length, before.length, "no line was added or lost");
  const changed = before.filter((l, i) => l !== after[i]);
  assert.equal(changed.length, 1, `exactly one line changed, got: ${JSON.stringify(changed)}`);
  // The declaration's own line is untouched: only its Placement moved.
  assert.match(changed[0], /^[ \t]*annotation\(Placement\(transformation\(extent/);
  assert.match(after.join("\n"), /Modelica\.Fluid\.Vessels\.OpenTank tank\(/);
  assert.match(after.join("\n"), /level_start = 1\.5,/);
});

test("the serializer on the same model really does lose the declaration", () => {
  // The control: without the patch this is what the file becomes, and why the
  // model stopped compiling.
  const rebuilt = serializeDiagram(modelOf(FLUID));
  assert.doesNotMatch(rebuilt, /^[ \t]*package Medium[ \t]*=/m);
  assert.match(rebuilt, /redeclare package Medium=Medium/, "the reference is left dangling");
  assert.ok(rebuilt.length < FLUID.length, "and the file shrinks");
});

test("a model that did not change is returned byte for byte", () => {
  const res = patchDiagramEdits(FLUID, modelOf(FLUID));
  assert.ok(res, `refused: ${lastPatchRefusal()}`);
  assert.equal(res.text, FLUID);
  assert.deepEqual(res.changes, []);
});

/* ------------------------------------------------------------------ */
/* The other shapes of diagram edit                                    */
/* ------------------------------------------------------------------ */

test("a parameter edit keeps the declaration's own description string", () => {
  const src = [
    "model M",
    '  Modelica.Blocks.Sources.Constant c(k = 1) "the setpoint" annotation(Placement(transformation(extent = {{0, 0}, {10, 10}})));',
    "equation",
    "end M;",
    "",
  ].join("\n");
  const res = patched(
    src,
    (m) => {
      m.components[0].params.k = "2";
    },
    "M"
  );
  assert.ok(res, `refused: ${lastPatchRefusal()}`);
  assert.match(res.text, /k=2/, "the new value is written");
  assert.match(res.text, /"the setpoint"/, "and the sentence the user wrote about it survives");
});

test("a rotation is written into the same declaration", () => {
  const res = patched(FLUID, (m) => {
    m.components.find((c) => c.id === "outlet").placement.rotation = 90;
  });
  assert.ok(res, `refused: ${lastPatchRefusal()}`);
  assert.match(res.text, /rotation=90/);
  assert.match(res.text, /^[ \t]*package Medium[ \t]*=/m);
});

test("a component dropped from the diagram takes its declaration and wires with it", () => {
  const res = patched(FLUID, (m) => {
    m.components = m.components.filter((c) => c.id !== "outlet");
    m.connections = m.connections.filter((c) => c.from.component !== "outlet" && c.to.component !== "outlet");
  });
  assert.ok(res, `refused: ${lastPatchRefusal()}`);
  assert.doesNotMatch(res.text, /StaticPipe outlet/, "the declaration is gone");
  assert.doesNotMatch(res.text, /outlet\.port_a|outlet\.port_b/, "and so are its two wires");
  assert.equal((res.text.match(/connect\(/g) || []).length, 0, "both of its wires went with it");
  assert.match(res.text, /^equation$/m, "the equation section is still there");
  assert.match(res.text, /Modelica\.Fluid\.Vessels\.OpenTank tank\(/, "the other components are untouched");
  assert.match(res.text, /^[ \t]*package Medium[ \t]*=/m, "the package declaration is untouched");
  assert.match(res.text, /\/\/ Discharge to atmosphere\./, "and so is a comment that was nowhere near it");
});

test("a new component is inserted among the declarations", () => {
  const res = patched(FLUID, (m) => {
    m.components.push({
      id: "probe",
      className: "Modelica.Blocks.Sources.Constant",
      placement: { extent: [0, 40, 20, 60], rotation: 0, visible: true },
      params: { k: "3" },
    });
  });
  assert.ok(res, `refused: ${lastPatchRefusal()}`);
  assert.match(res.text, /Modelica\.Blocks\.Sources\.Constant probe\(k=3\)/);
  // Above the equation section, not after it.
  assert.ok(
    res.text.indexOf("probe(k=3)") < res.text.indexOf("\nequation"),
    "the new declaration sits with the other declarations"
  );
  assert.match(res.text, /^[ \t]*package Medium[ \t]*=/m);
});

test("a new wire is added to the equation section", () => {
  const res = patched(FLUID, (m) => {
    m.connections.pop();
  });
  assert.ok(res, `refused: ${lastPatchRefusal()}`);
  assert.equal((res.text.match(/connect\(/g) || []).length, 1, "the removed wire is gone");
  assert.match(res.text, /connect\(tank\.ports\[1\], outlet\.port_a\)/);
});

test("an equation that looks like a declaration is not treated as one", () => {
  // `coolingPower = maximumCooling * ...` in an equation section is not a
  // declaration of coolingPower. Reading it as one made the name look declared
  // twice and refused every patch of the model; worse, a model that no longer
  // declared the name would have had its EQUATION deleted as a stale declaration.
  const src = [
    "model M",
    "  Modelica.Blocks.Sources.Constant c(k = 1) annotation(Placement(transformation(extent = {{0, 0}, {10, 10}})));",
    "  Real coolingPower;",
    "equation",
    "  coolingPower = 2 * time;",
    "  c.y = coolingPower;",
    "end M;",
    "",
  ].join("\n");
  const res = patched(src, (m) => moveComponent(m, "c"), "M");
  assert.ok(res, `refused: ${lastPatchRefusal()}`);
  assert.match(res.text, /coolingPower = 2 \* time;/, "the equation is still there");
  assert.match(res.text, /c\.y = coolingPower;/, "both of them");
});

test("extends, imports and an algorithm section survive a move", () => {
  const src = [
    "model M",
    "  import Modelica.Constants.pi;",
    "  extends Modelica.Blocks.Icons.Block;",
    "  parameter Real k = 1;",
    "  Real y;",
    "  Modelica.Blocks.Sources.Constant c(k = 1) annotation(Placement(transformation(extent = {{0, 0}, {10, 10}})));",
    "algorithm",
    "  y := k * pi;",
    "end M;",
    "",
  ].join("\n");
  const res = patched(src, (m) => moveComponent(m, "c"), "M");
  assert.ok(res, `refused: ${lastPatchRefusal()}`);
  assert.match(res.text, /^\s*import Modelica\.Constants\.pi;/m);
  assert.match(res.text, /^\s*extends Modelica\.Blocks\.Icons\.Block;/m);
  assert.match(res.text, /^algorithm$/m);
  assert.match(res.text, /y := k \* pi;/);
});

test("a declaration with no annotation gets one, and keeps its neighbours", () => {
  const src = ["model M", "  Modelica.Blocks.Sources.Constant c;", "equation", "end M;", ""].join("\n");
  const res = patched(src, (m) => moveComponent(m, "c"), "M");
  assert.ok(res, `refused: ${lastPatchRefusal()}`);
  assert.match(res.text, /Constant c annotation\(Placement\(transformation\(extent=/);
  assert.match(res.text, /^equation$/m);
});

test("a text box added to the diagram layer is written as an annotation", () => {
  const res = patched(FLUID, (m) => {
    m.graphics.push({
      kind: "Text",
      extent: [0, 0, 60, 20],
      textString: "discharge",
    });
  });
  assert.ok(res, `refused: ${lastPatchRefusal()}`);
  assert.match(res.text, /annotation\(Diagram\(/);
  assert.match(res.text, /discharge/);
  assert.match(res.text, /^[ \t]*package Medium[ \t]*=/m);
});

/* ------------------------------------------------------------------ */
/* Refusing, rather than guessing                                      */
/* ------------------------------------------------------------------ */

test("a model whose name is not in the text is refused, not patched", () => {
  const model = modelOf(FLUID);
  model.name = "SomethingElse";
  assert.equal(patchDiagramEdits(FLUID, model), undefined);
  assert.match(lastPatchRefusal(), /not a class in this source/);
});

test("text that does not parse is refused", () => {
  assert.equal(patchDiagramEdits("model M\n  Real x(\n", modelOf(FLUID)), undefined);
  assert.ok(lastPatchRefusal());
});
