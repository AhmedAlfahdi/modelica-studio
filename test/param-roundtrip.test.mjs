/**
 * A declaration must survive a parse and a re-serialise unchanged in SHAPE.
 *
 * The bug this catches produced a reported data loss: `parameter Real x = 1` was
 * stored as a modifier named after its own declaration, and the serializer wrote
 * it back as `x(x = 1)` -- which says "set the member x of the type Real", and
 * Real has no member x. OpenModelica answers "Modified element x not found in
 * class Real" and the model will not build.
 *
 * The damage was hard to see because it was SYMMETRIC: the text on disk was fine,
 * but the parsed diagram held the broken parameter, so serialising it produced the
 * fault again. An AI repair of the TEXT did not touch the diagram, so the next
 * save and the next restore put the fault straight back.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";

const { parseModelica, toDiagramModel } = await import(
  path.join(buildLibs("prt-parser", ["src/modelica/parser.ts"]), "parser.js")
);
const { serializeDiagram } = await import(
  path.join(buildLibs("prt-ser", ["src/modelica/serializer.ts"]), "serializer.js")
);

/** Serialise one declaration and return the line it produced. */
function roundTrip(decl, modelDecl = "equation\n  der(y) = -y;") {
  const src = ["model M", `  ${decl};`, modelDecl, "end M;"].join("\n");
  const out = serializeDiagram(toDiagramModel(parseModelica(src)[0], () => undefined));
  return out
    .split("\n")
    .map((l) => l.trim().replace(/ annotation\(.*$/, ""))
    .filter((l) => l && l !== "// Components" && !l.startsWith("model ") && !l.startsWith("equation") && l !== "end M;");
}

test("a bare binding is not turned into a modifier of the same name", () => {
  // The reported fault, exactly.
  const lines = roundTrip("parameter Modelica.Units.SI.Density air_density = 1.225");
  const line = lines.find((l) => l.includes("air_density")) ?? "(none)";
  assert.match(line, /air_density\s*=\s*1\.225/, "it stays a binding");
  assert.ok(
    !/air_density\s*\(\s*air_density/.test(line),
    `the broken modifier form must not appear: ${line}`
  );
});

test("modifiers and a binding coexist, in that order", () => {
  // Modelica wants `Real x(unit = "V") = 5`: modifiers first, then the binding.
  // Emitting only the binding silently DROPPED the unit -- a quiet loss, since the
  // model still compiled with the wrong declaration.
  assert.match(roundTrip('parameter Real x(unit = "V") = 5')[0], /parameter Real x\(unit="V"\)=5/);
  assert.match(roundTrip("parameter Real k(min = 0) = 3")[0], /parameter Real k\(min=0\)=3/);
});

test("attributes with no binding are unchanged", () => {
  assert.match(roundTrip("Real T(start = 300, fixed = true)")[0], /Real T\(start=300, fixed=true\)/);
});

test("a plain declaration stays plain", () => {
  assert.match(roundTrip("Real y")[0], /^Real y;$/);
});

test("a component keeps its parameters as modifiers", () => {
  // A component's values ARE modifiers -- `Resistor r(R = 100)` -- so the rule
  // above must not be applied to them.
  const lines = roundTrip("Modelica.Electrical.Analog.Basic.Resistor r(R = 100)");
  assert.match(lines[0], /Resistor r\(R=100\)/);
});

test("a diagram holding the old broken form is written back correctly", () => {
  // The stored snapshot from before the fix: `air_density` in the params map. That
  // is ALSO what a correct parse produces -- the parser records a binding under the
  // declared name -- so the same data now serialises to a proper binding instead of
  // `air_density(air_density = 1.225)`. That is why the fault healed rather than
  // needing a migration.
  const stored = {
    name: "AirplaneDrag",
    components: [
      {
        id: "air_density",
        className: "Modelica.Units.SI.Density",
        params: { air_density: "1.225" },
        prefixes: ["parameter"],
        placement: { extent: [-10, -10, 10, 10], rotation: 0, visible: true },
      },
    ],
    connections: [],
    equations: [],
    graphics: [],
    variables: [],
    parameters: [],
  };
  const out = serializeDiagram(stored);
  const line = out.split("\n").find((l) => l.includes("air_density")) ?? "";
  assert.match(line, /air_density = 1\.225/, "written as a binding");
  assert.ok(!/air_density\s*\(\s*air_density/.test(out), "not as a modifier of itself");
});
