/**
 * Parser / serializer tests against REAL Modelica Standard Library source.
 *
 * These are the tests that matter: if the parser cannot read MSL's own icons
 * and the serializer cannot reproduce them, the editor is built on sand.
 *
 * Run with:  node --test test/
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { buildLibs, repoRoot } from "./helpers/build.mjs";
import path from "node:path";

const MSL_CANDIDATES = [
  "/home/para/.openmodelica/libraries/Modelica 4.1.0+maint.om",
  "/home/para/.openmodelica/libraries/Modelica 3.2.3+maint.om",
];

function findMsl() {
  for (const c of MSL_CANDIDATES) if (fs.existsSync(c)) return c;
  return null;
}

const MSL = findMsl();


const LIB = buildLibs("test-lib", ["src/modelica/parser.ts", "src/modelica/serializer.ts", "src/modelica/library.ts", "src/modelica/types.ts"]);
const parserMod = await import(path.join(LIB, "parser.js"));
const serializerMod = await import(path.join(LIB, "serializer.js"));
const libraryMod = await import(path.join(LIB, "library.js"));
const { collectParameters } = await import(
  path.join(buildLibs("params-lib", ["src/view/parameters.ts"]), "parameters.js")
);
const { parseModelica, findClass, toDiagramModel } = parserMod;
const { serializeGraphic, serializeDiagram, fmt } = serializerMod;

/* ------------------------------------------------------------------ */

test("lexer handles comments, strings and nesting", () => {
  const src = `
    // line comment
    /* block /* nested */ still comment */
    model A "doc"
      Real x(start=1.5);
    end A;
  `;
  const classes = parseModelica(src);
  assert.equal(classes.length, 1);
  assert.equal(classes[0].name, "A");
  assert.equal(classes[0].comment, "doc");
});

test("within clause qualifies class names", () => {
  const src = `within Modelica.Electrical.Analog.Basic;
model Foo
end Foo;`;
  const classes = parseModelica(src);
  assert.equal(classes[0].qualifiedName, "Modelica.Electrical.Analog.Basic.Foo");
});

test("fmt produces clean Modelica numbers", () => {
  assert.equal(fmt(100), "100");
  assert.equal(fmt(1.5), "1.5");
  assert.equal(fmt(0.30000000000000004), "0.3");
  assert.equal(fmt(-10), "-10");
});

test("round-trips a hand-written model with placement and connect", () => {
  const src = `model RC
  Modelica.Electrical.Analog.Basic.Resistor r(R=10) annotation(Placement(transformation(extent={{-10,10},{10,30}})));
  Modelica.Electrical.Analog.Basic.Ground g annotation(Placement(transformation(extent={{-10,-30},{10,-10}})));
equation
  connect(r.n, g.p) annotation(Line(points={{10,20},{20,20},{20,-20}}, color={0,0,255}));
end RC;`;
  const cls = findClass(parseModelica(src), "RC");
  assert.ok(cls, "RC class parsed");
  assert.equal(cls.components.length, 2);

  const r = cls.components.find((c) => c.name === "r");
  assert.ok(r, "resistor parsed");
  assert.deepEqual(r.placement.extent, [-10, 10, 10, 30]);
  assert.equal(r.modifiers.R, "10");

  assert.equal(cls.connections.length, 1);
  const cn = cls.connections[0];
  assert.equal(cn.from.component, "r");
  assert.equal(cn.from.port, "n");
  assert.equal(cn.to.component, "g");
  assert.equal(cn.to.port, "p");
  assert.deepEqual(cn.points, [10, 20, 20, 20, 20, -20]);
  assert.deepEqual(cn.color, [0, 0, 255]);
});

/* ---------------- Real MSL ---------------- */

test("parses the real MSL Resistor icon", { skip: !MSL }, () => {
  const file = path.join(MSL, "Electrical/Analog/Basic/Resistor.mo");
  const src = fs.readFileSync(file, "utf8");
  const classes = parseModelica(src);
  const cls = findClass(classes, "Resistor");
  assert.ok(cls, "Resistor class found");

  // The icon must contain real primitives.
  assert.ok(cls.icon.length >= 3, `expected >=3 icon graphics, got ${cls.icon.length}`);
  const kinds = new Set(cls.icon.map((g) => g.kind));
  assert.ok(kinds.has("Rectangle"), "icon has a Rectangle body");
  assert.ok(kinds.has("Line"), "icon has Line leads");
  assert.ok(kinds.has("Text"), "icon has the R=... label");

  // Parameters declared directly on the class.
  assert.ok(cls.parameters.some((p) => p.name === "R"), "R parameter found");
});

test("resolves INHERITED ports and parameters through extends", { skip: !MSL }, () => {
  // Resistor declares neither its pins nor its heat port itself — they come
  // from `extends OnePort` and `extends ConditionalHeatPort`. Getting this
  // wrong yields a palette entry with no connectable pins.
  const { LibraryIndex } = libraryMod;
  const ix = new LibraryIndex();
  ix.addDirectory(MSL);

  const r = ix.describe("Modelica.Electrical.Analog.Basic.Resistor");
  assert.ok(r, "Resistor described");
  const portNames = r.ports.map((p) => p.name).sort();
  assert.ok(portNames.includes("p"), `expected pin p, got ${portNames.join(",")}`);
  assert.ok(portNames.includes("n"), `expected pin n, got ${portNames.join(",")}`);
  // Both pins are flow connectors in the electrical domain.
  assert.ok(r.ports.find((p) => p.name === "p").isFlow, "pin p is a flow connector");
  assert.ok(r.parameters.some((p) => p.name === "R"), "inherited/own R parameter");

  // Rotational domain exposes flange_a / flange_b.
  const inr = ix.describe("Modelica.Mechanics.Rotational.Components.Inertia");
  assert.ok(inr, "Inertia described");
  const fl = inr.ports.map((p) => p.name).sort();
  assert.deepEqual(fl, ["flange_a", "flange_b"]);

  // A single-pin component.
  const gnd = ix.describe("Modelica.Electrical.Analog.Basic.Ground");
  assert.deepEqual(gnd.ports.map((p) => p.name), ["p"]);
});

test("library index resolves relative connector type names", { skip: !MSL }, () => {
  const { LibraryIndex } = libraryMod;
  const ix = new LibraryIndex();
  ix.addDirectory(MSL);
  // Pin/PositivePin/NegativePin are declared in Interfaces and referenced by
  // relative name from TwoPin; a naive lookup confuses the two short names.
  assert.ok(ix.isConnector("Modelica.Electrical.Analog.Interfaces.Pin"));
  const pin = ix.connectorInfo("Modelica.Electrical.Analog.Interfaces.Pin");
  assert.equal(pin.isFlow, true);
  assert.equal(pin.hasPotential, true);
});

test("parses every MSL class without crashing", { skip: !MSL }, () => {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".mo")) files.push(p);
    }
  };
  walk(MSL);
  assert.ok(files.length > 100, `expected many MSL files, got ${files.length}`);

  let parsed = 0;
  let iconBearing = 0;
  const failures = [];
  for (const f of files) {
    try {
      const classes = parseModelica(fs.readFileSync(f, "utf8"));
      parsed += classes.length;
      for (const c of classes) if (c.icon.length) iconBearing++;
    } catch (err) {
      failures.push(`${path.relative(MSL, f)}: ${err.message}`);
    }
  }
  assert.equal(failures.length, 0, `parse failures:\n${failures.slice(0, 10).join("\n")}`);
  assert.ok(parsed > 500, `expected many classes, got ${parsed}`);
  assert.ok(iconBearing > 200, `expected many iconic classes, got ${iconBearing}`);
});

test("MSL icons survive a serialize round-trip", { skip: !MSL }, () => {
  const file = path.join(MSL, "Electrical/Analog/Basic/Resistor.mo");
  const cls = findClass(parseModelica(fs.readFileSync(file, "utf8")), "Resistor");
  for (const g of cls.icon) {
    const text = serializeGraphic(g);
    assert.match(text, /^(Line|Polygon|Rectangle|Ellipse|Text|Bitmap)\(/);
    assert.ok(text.includes("extent=") || text.includes("points="), `geometry emitted for ${g.kind}`);
  }
});

test("serialized diagram is re-parseable (true round-trip)", () => {
  const model = {
    name: "RoundTrip",
    components: [
      {
        id: "r1",
        className: "Modelica.Electrical.Analog.Basic.Resistor",
        placement: { extent: [-10, 10, 10, 30], rotation: 0, visible: true },
        params: { R: "42" },
      },
      {
        id: "g1",
        className: "Modelica.Electrical.Analog.Basic.Ground",
        placement: { extent: [-10, -30, 10, -10], rotation: 0, visible: true },
        params: {},
      },
    ],
    connections: [
      {
        id: "a",
        from: { component: "r1", port: "n" },
        to: { component: "g1", port: "p" },
        points: [10, 20, 20, 20, 20, -20],
        color: [0, 0, 255],
      },
    ],
    graphics: [],
  };

  const text = serializeDiagram(model);
  const cls = findClass(parseModelica(text), "RoundTrip");
  assert.ok(cls, "re-parsed serialized model");
  assert.equal(cls.components.length, 2);
  assert.deepEqual(
    cls.components.find((c) => c.name === "r1").placement.extent,
    [-10, 10, 10, 30]
  );
  assert.equal(cls.components.find((c) => c.name === "r1").modifiers.R, "42");
  assert.equal(cls.connections.length, 1);
  assert.deepEqual(cls.connections[0].points, [10, 20, 20, 20, 20, -20]);
});

test("describe() yields a palette-ready entry with icon, ports and params", { skip: !MSL }, () => {
  const { LibraryIndex } = libraryMod;
  const ix = new LibraryIndex();
  ix.addDirectory(MSL);
  const cc = ix.describe("Modelica.Electrical.Analog.Basic.Resistor");
  assert.ok(cc, "described");
  assert.equal(cc.shortName, "Resistor");
  assert.ok(cc.hasIcon, "flagged as having an icon");
  assert.ok(cc.icon.length >= 3, "carries icon graphics");
  const names = cc.ports.map((p) => p.name).sort();
  assert.ok(names.includes("p") && names.includes("n"), "exposes p and n");
  assert.ok(cc.parameters.some((p) => p.name === "R"), "exposes R parameter");
});

test("indexes NESTED classes, not just top-level ones", { skip: !MSL }, () => {
  // The MSL declares roughly half its classes inside package files
  // (`block Step` lives within Blocks/Sources.mo). Missing this silently
  // removed whole sublibraries such as Modelica.Blocks.* from the palette.
  const { LibraryIndex } = libraryMod;
  const ix = new LibraryIndex();
  ix.addDirectory(MSL);

  assert.ok(
    ix.size > 3500,
    `expected the full MSL class tree (>3500 classes), got ${ix.size}`
  );

  for (const [name, kind] of [
    ["Modelica.Blocks.Sources.Step", "block"],
    ["Modelica.Blocks.Sources.Ramp", "block"],
    ["Modelica.Blocks.Sources.Constant", "block"],
    ["Modelica.Blocks.Math.Gain", "block"],
    ["Modelica.Blocks.Continuous.Integrator", "block"],
    ["Modelica.Blocks.Interfaces.RealInput", "connector"],
  ]) {
    const cls = ix.get(name);
    assert.ok(cls, `nested class ${name} must be indexed`);
    assert.equal(cls.kind, kind, `${name} is a ${kind}`);
  }

  // And they must be usable as palette entries.
  const blocks = ix.listPlaceable("Modelica.Blocks");
  assert.ok(blocks.length > 50, `expected many Blocks components, got ${blocks.length}`);
});

test("parses declarations with a binding expression", () => {
  // `RealOutput y = 0.0 "output"` desynchronised the token stream before.
  const src = `model M
  Modelica.Blocks.Interfaces.RealOutput y = 0.0 "Value of output"
    annotation (Placement(transformation(extent={{100,-10},{120,10}})));
  Modelica.Blocks.Interfaces.RealInput u = 1.0 annotation (Placement(transformation(extent={{-140,-20},{-100,20}})));
  parameter Real k = 2 "gain";
equation
  y = k*u;
end M;`;
  const cls = findClass(parseModelica(src), "M");
  assert.ok(cls, "model parsed");
  assert.equal(cls.components.length, 3, "all three declarations parsed");
  const y = cls.components.find((c) => c.name === "y");
  assert.equal(y.modifiers.y, "0.0", "binding captured");
  assert.ok(y.placement, "placement after a binding is still read");
  const k = cls.components.find((c) => c.name === "k");
  assert.equal(k.modifiers.k, "2");
});

test("skips statements containing an if-EXPRESSION inside brackets", () => {
  // `smooth(0, if a then b else c)` made skipStatement stop at the `end if`
  // of the enclosing statement, truncating every later class in the file.
  const src = `model E
  Real y;
equation
  y = offset + smooth(0, (if time < startTime then 0 else time - startTime));
  y2 = if x > 0 then 1 else -1;
  when y > 1 then
    y = 0;
  end when;
end E;
model After
  Real z;
end After;`;
  const classes = parseModelica(src);
  const names = classes.map((c) => c.name);
  assert.ok(names.includes("E"), "first class parsed");
  assert.ok(names.includes("After"), "class AFTER the if-expression survived");
  const after = findClass(classes, "After");
  assert.ok(after.components.some((c) => c.name === "z"), "trailing class is complete");
});

test("listPlaceable finds real MSL components", { skip: !MSL }, () => {
  const { LibraryIndex } = libraryMod;
  const ix = new LibraryIndex();
  ix.addDirectory(MSL);
  const all = ix.listPlaceable("Electrical.Analog.Basic");
  assert.ok(all.length >= 5, `expected several Analog.Basic components, got ${all.length}`);
  const names = all.map((c) => c.shortName);
  for (const want of ["Resistor", "Capacitor", "Inductor", "Ground"]) {
    assert.ok(names.includes(want), `palette should include ${want}`);
  }
});

test("every built-in example parses and can be re-serialized", async () => {
  // Examples are the plugin's first-run experience, so a typo in one is
  // immediately visible to a user. They must survive the same
  // parse -> diagram -> serialize path a hand-built model does.
  const examplesMod = await import(path.join(buildLibs("ex-lib", ["src/modelica/examples.ts"]), "examples.js"));
  const { EXAMPLES } = examplesMod;
  // Several per physical domain: electrical, mechanical, fluid and thermal. The
  // breadth is deliberate — a gap in any one domain's library support then shows
  // up on first use rather than in the field.
  assert.ok(EXAMPLES.length >= 8, `expected a broad set, got ${EXAMPLES.length}`);

  // Each domain must be represented by more than a token example, and the
  // descriptions are what tell a user which is which, so they must name it.
  const domains = ["Electrical", "Mechanical", "Fluid", "Thermal"];
  for (const d of domains) {
    const ofDomain = EXAMPLES.filter((e) => e.description.startsWith(d + ":"));
    assert.ok(
      ofDomain.length >= 2,
      `expected at least two ${d} examples, got ${ofDomain.length}`
    );
  }

  for (const ex of EXAMPLES) {
    const classes = parseModelica(ex.source);
    const cls = findClass(classes, ex.name);
    assert.ok(cls, `${ex.name}: class parses`);

    // Most examples are wired from MSL components, and for those the wiring must
    // round-trip. `BouncingBall` is deliberately different: a self-contained
    // hybrid model whose only declarations are primitive `Real` states, so there
    // is nothing to place or connect. `BouncingBall` is the reason this
    // distinction exists — requiring a connection of every example would forbid
    // a whole legitimate kind.
    const PRIMITIVE = new Set(["Real", "Integer", "Boolean", "String", "Time"]);
    const composed = cls.components.filter((c) => !PRIMITIVE.has(c.type));
    if (composed.length === 0) {
      assert.equal(cls.connections.length, 0, `${ex.name}: nothing to connect`);
      const text = serializeDiagram(toDiagramModel(cls, () => undefined));
      assert.ok(findClass(parseModelica(text), ex.name), `${ex.name}: re-serialized text re-parses`);
      continue;
    }
    assert.ok(cls.connections.length > 0, `${ex.name}: composed examples are wired`);

    // Every component must carry a placement, or it would render at the origin.
    for (const c of cls.components) {
      assert.ok(c.placement, `${ex.name}.${c.name}: has a Placement`);
    }

    // Every connection endpoint must reference a declared instance.
    const ids = new Set(cls.components.map((c) => c.name));
    for (const cn of cls.connections) {
      assert.ok(ids.has(cn.from.component), `${ex.name}: ${cn.from.component} declared`);
      assert.ok(ids.has(cn.to.component), `${ex.name}: ${cn.to.component} declared`);
    }

    // Re-serializing must produce valid, re-parseable Modelica.
    const model = toDiagramModel(cls, () => undefined);
    const text = serializeDiagram(model);
    const again = findClass(parseModelica(text), ex.name);
    assert.ok(again, `${ex.name}: re-serialized text re-parses`);
    assert.equal(again.components.length, cls.components.length, `${ex.name}: components preserved`);
    assert.equal(again.connections.length, cls.connections.length, `${ex.name}: connections preserved`);
  }
});

/** Builtin scalar types: leaves of the language, never library classes. */
const PRIMITIVE_TYPES = new Set(["Real", "Integer", "Boolean", "String", "Time"]);

test("example component classes exist in the MSL", { skip: !MSL }, async () => {
  const { EXAMPLES } = await import(path.join(buildLibs("ex-lib", ["src/modelica/examples.ts"]), "examples.js"));
  const { LibraryIndex } = libraryMod;
  const ix = new LibraryIndex();
  ix.addDirectory(MSL);
  const missing = [];
  for (const ex of EXAMPLES) {
    const cls = findClass(parseModelica(ex.source), ex.name);
    if (!cls) continue;
    for (const c of cls.components) {
      // A primitive is a leaf type of the language, not a library class, so it
      // is not expected to be in the index. `BouncingBall` declares only `Real`
      // states and no library components at all.
      if (PRIMITIVE_TYPES.has(c.type)) continue;
      const def = ix.component(c.type);
      if (!def) {
        missing.push(`${ex.name}: ${c.type}`);
        continue;
      }
      // Ports referenced by the example must exist on the class, unless the
      // class declares them as an ARRAY (`FluidPorts_b ports[nPorts]`). Array
      // declarations are not captured yet, and a fluid source is exactly that
      // shape, so those are reported rather than failed.
      const ARRAY_PORT_TYPES = new Set([
        "Modelica.Fluid.Sources.Boundary_pT",
        "Modelica.Fluid.Sources.MassFlowSource_T",
        "Modelica.Fluid.Sources.MassFlowSource_h",
        "Modelica.Fluid.Vessels.OpenTank",
        "Modelica.Fluid.Vessels.ClosedVolume",
      ]);
      if (ARRAY_PORT_TYPES.has(c.type)) continue;
      for (const cn of cls.connections) {
        for (const ref of [cn.from, cn.to]) {
          if (ref.component !== c.name) continue;
          // A connection may name one element of an array port (`outPort[1]`)
          // while the declaration names the array, so the subscript is ignored.
          const bare = ref.port.replace(/\[[^\]]*\]$/, "");
          assert.ok(
            def.ports.some((p) => p.name === bare || p.name === ref.port),
            `${ex.name}: ${c.type} has no port "${ref.port}"`
          );
        }
      }
    }
  }
  assert.deepEqual(missing, [], `example classes missing from the MSL: ${missing.join(", ")}`);
});

test("conditional visible expressions survive parsing as expressions", { skip: !MSL }, () => {
  // The Resistor's heat-port lead is `Line(visible=useHeatPort, ...)`. The
  // parser must keep that as an expression rather than coercing it to a
  // boolean, or every resistor renders with a heat port it does not have.
  const file = path.join(MSL, "Electrical/Analog/Basic/Resistor.mo");
  const cls = findClass(parseModelica(fs.readFileSync(file, "utf8")), "Resistor");
  const conditional = cls.icon.filter(
    (g) => typeof g.visible === "string"
  );
  assert.ok(
    conditional.length >= 1,
    `expected at least one conditional graphic on Resistor, got ${conditional.length}`
  );
  assert.ok(
    conditional.every((g) => /useHeatPort/.test(String(g.visible))),
    "the conditional graphic is guarded by useHeatPort"
  );
});

test("literal visible flags are kept as booleans", () => {
  // Tested on a snippet rather than the MSL, which happens to use only
  // expressions: the point is that a real boolean is not turned into a string.
  const src = `model V
  annotation(Icon(graphics={
    Rectangle(extent={{-10,-10},{10,10}}, visible=true),
    Line(points={{0,0},{5,5}}, visible=false),
    Line(points={{1,1},{2,2}}, visible=useHeatPort)}));
end V;`;
  const cls = findClass(parseModelica(src), "V");
  assert.equal(cls.icon.length, 3, "all three graphics parsed");
  assert.equal(cls.icon[0].visible, true, "literal true stays a boolean");
  assert.equal(cls.icon[1].visible, false, "literal false stays a boolean");
  assert.equal(cls.icon[2].visible, "useHeatPort", "an expression stays a string");
});

test("a round trip preserves what makes a declaration compile", async () => {
  // Every one of these was dropped by an earlier version of the serializer, and
  // each loss produces a model that no longer compiles — which is how the fluid
  // example failed with "component pump contains the definition of a partial
  // class Medium".
  const src = `model M
  inner Modelica.Fluid.System system;
  Modelica.Fluid.Sources.MassFlowSource_T pump(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, T=293.15);
  Modelica.Fluid.Pipes.StaticPipe pipe(length=1, diameter=0.05);
equation
  connect(pump.ports[1], pipe.port_a);
end M;
`;
  const cls = findClass(parseModelica(src), "M");
  const model = toDiagramModel(cls, () => undefined);
  const text = serializeDiagram(model);
  const again = findClass(parseModelica(text), "M");

  // `redeclare package Medium = X` must survive as one declaration. Emitting
  // just `Medium=X` makes OpenModelica read it as redefining a partial class.
  assert.match(
    text,
    /redeclare package Medium\s*=/,
    `redeclare package must be re-emitted, got:\n${text}`
  );

  // A declared port index is part of the port name: `ports[1]` and `ports[2]`
  // are different ports, and dropping the subscript does not compile.
  assert.equal(again.connections[0].from.port, "ports[1]", "the port subscript survives");
  assert.equal(again.connections[0].to.port, "port_a");

  // `inner` is load-bearing: without it, components that reference an
  // `outer system` fail to bind.
  assert.match(text, /\binner\s+Modelica\.Fluid\.System\s+system\b/, "inner survives");

  // Placement must be wrapped in `transformation`, which is what Modelica
  // requires; `Placement(extent=...)` is the internal shape, not the language's.
  assert.match(
    text,
    /Placement\(transformation\(extent=/,
    `Placement needs a transformation wrapper, got:\n${text}`
  );
  assert.equal(again.components[0].placement.extent[0], -10, "extent survives the round trip");
});

test("a model saved by an older schema is recognised as stale", async () => {
  // A persisted model is a snapshot of the internal shape, not a document. When
  // that shape changes — as it did when `prefixes` was added — an old snapshot
  // silently lacks the new field, and the model then fails to compile for
  // reasons the user cannot see. The schema version lets the plugin notice and
  // rebuild from the source instead of trusting it.
  const src = await import("node:fs").then((fs) =>
    fs.promises.readFile(path.join(repoRoot, "src/main.ts"), "utf8")
  );
  assert.match(src, /const MODEL_SCHEMA = \d+/, "a schema version is declared");
  assert.match(src, /modelSchema: MODEL_SCHEMA/, "the version is written when saving");
  assert.match(
    src,
    /\(data\.modelSchema \?\? 0\) !== MODEL_SCHEMA/,
    "a stored model is compared against the current version"
  );
  assert.match(src, /modelSource: this\.modelSource/, "the source is stored alongside it");
});

test("conditional and arrayed declarations survive a round trip", async () => {
  // Three separate defects met in this one declaration, and together they made
  // every fluid source invisible:
  //
  //   Modelica.Blocks.Interfaces.RealInput X_in[Medium.nX](each unit="1")
  //     if use_X_in "doc" annotation (Placement(...));
  //
  // 1. `if <condition>` on a declaration was not recognised, so the trailing
  //    `if` reached the statement scanner, which read it as a block opener and
  //    consumed the rest of the class — its remaining components, its
  //    equations, and its `annotation(Icon(...))`.
  // 2. Dimensions AFTER the name were read as "modifiers first", so the `[` was
  //    unexpected and the declaration failed for the same reason.
  // 3. The serializer emitted neither, so saving produced Modelica that does
  //    not compile: a conditional connector without its condition.
  const src = `model M
  Boolean use_X_in;
  Modelica.Blocks.Interfaces.RealInput X_in[Medium.nX](each unit="1")
    if use_X_in "doc" annotation (Placement(transformation(extent={{-1,-1},{1,1}})));
  Real after;
  annotation (Icon(graphics={Ellipse(extent={{-10,-10},{10,10}})}));
equation
  after = 1;
end M;
`;
  const cls = findClass(parseModelica(src), "M");
  const comp = cls.components.find((c) => c.name === "X_in");
  assert.ok(comp, "a conditional arrayed connector parses");
  assert.equal(comp.condition, "use_X_in", "its condition is captured");
  assert.equal(comp.suffixDims, "[Medium.nX]", "its dimensions are captured");

  // The rest of the class must survive: the old failure stopped at the `if`.
  assert.ok(
    cls.components.some((c) => c.name === "after"),
    "declarations after the conditional one are kept"
  );
  assert.ok(cls.icon.length > 0, "the class-level Icon is reached and kept");

  // And it must re-emit.
  const text = serializeDiagram(toDiagramModel(cls, () => undefined));
  assert.match(text, /X_in\[Medium\.nX\]/, `dimensions must be re-emitted:\n${text}`);
  assert.match(text, /if use_X_in/, `the condition must be re-emitted:\n${text}`);

  const again = findClass(parseModelica(text), "M");
  const comp2 = again.components.find((c) => c.name === "X_in");
  assert.equal(comp2?.condition, "use_X_in");
  assert.equal(comp2?.suffixDims, "[Medium.nX]");
});

test("MSL fluid sources are reachable in the palette", { skip: !MSL }, () => {
  // The end-to-end consequence: with the defects above, Modelica.Fluid.Sources
  // exposed a single class instead of five, so the palette had no boundary or
  // flow source to offer.
  const { LibraryIndex } = libraryMod;
  const ix = new LibraryIndex();
  ix.addDirectory(MSL);
  const sources = ix.listPlaceable("Modelica.Fluid.Sources");
  for (const name of [
    "Modelica.Fluid.Sources.Boundary_pT",
    "Modelica.Fluid.Sources.MassFlowSource_T",
  ]) {
    const def = ix.component(name);
    assert.ok(def, `${name} must resolve`);
    assert.ok(def.ports.length > 0, `${name} must expose its connector`);
    assert.ok(def.icon.length > 0, `${name} must carry its icon, or it is not placeable`);
  }
  assert.ok(
    sources.length >= 4,
    `expected the fluid sources to be placeable, got ${sources.map((s) => s.shortName).join(", ")}`
  );
});

test("protected declarations are not offered as parameters", { skip: !MSL }, () => {
  // MSL puts internal values under `protected`, e.g. `evenOrder` in
  // Continuous.Filter. Listing one as a parameter offers the user a value they
  // may not set, and OpenModelica rejects the modifier outright:
  //   "Protected element 'evenOrder' may not be modified."
  const { LibraryIndex } = libraryMod;
  const ix = new LibraryIndex();
  ix.addDirectory(MSL);

  const filter = ix.component("Modelica.Blocks.Continuous.Filter");
  assert.ok(filter, "the class resolves");
  const names = filter.parameters.map((p) => p.name);
  assert.ok(names.includes("order"), "public parameters are still offered");
  for (const hidden of ["evenOrder", "m", "w", "ncr", "cr", "ku", "k1"]) {
    assert.ok(
      !names.includes(hidden),
      `protected '${hidden}' must not be offered as a parameter (got ${names.join(", ")})`
    );
  }
});

test("a placed component only binds defaults it is allowed to bind", { skip: !MSL }, async () => {
  // Three ways an inherited default can be un-bindable, all seen in MSL and all
  // producing a compile error on a component the user merely dragged in:
  //
  //   protected  `evenOrder`  -> "Protected element may not be modified"
  //   final      `nx`         -> "Trying to override final element"
  //   relative   `Init.NoInit`-> "Variable Init.NoInit not found in scope"
  //
  // The last is the subtle one: the value is syntactically a literal-looking
  // identifier, but `Init` is imported by the declaring class and means nothing
  // in the user's model.
  const { LibraryIndex } = libraryMod;
  const ix = new LibraryIndex();
  ix.addDirectory(MSL);

  const filter = ix.component("Modelica.Blocks.Continuous.Filter");
  const names = filter.parameters.map((p) => p.name);
  for (const banned of ["evenOrder", "nx", "m", "w"]) {
    assert.ok(!names.includes(banned), `'${banned}' must not be offered`);
  }

  // Every offered default must stand on its own in a foreign scope.
  for (const p of filter.parameters) {
    if (p.defaultValue === undefined) continue;
    assert.match(
      p.defaultValue,
      /^-?(\d+\.?\d*([eE][-+]?\d+)?|true|false|".*")$/,
      `default for '${p.name}' must be self-contained, got "${p.defaultValue}"`
    );
  }

  // A scoped enum default is left unset rather than re-emitted.
  const firstOrder = ix.component("Modelica.Blocks.Continuous.FirstOrder");
  const initType = firstOrder.parameters.find((p) => p.name === "initType");
  assert.ok(initType, "the parameter is still offered for editing");
  assert.equal(
    initType.defaultValue,
    undefined,
    "its package-relative default is not re-emitted"
  );
});

test("nested modifiers survive the round trip", () => {
  // `T(start=293.15)` arrives as `T: "@modifier:(start=293.15)"`. Dropping those
  // lost every initial condition and structural flag on load: a heat capacitor
  // came back with no starting temperature, and a joint with
  // `useAxisFlange=true` lost that too.
  const src = `model T
  Modelica.Thermal.HeatTransfer.Components.HeatCapacitor hot(C=2500, T(start=373.15, fixed=true));
  Modelica.Mechanics.MultiBody.Joints.Revolute r(useAxisFlange=true, phi(start=1.2), n={1,0,0});
end T;
`;
  const model = toDiagramModel(findClass(parseModelica(src), "T"), () => undefined);
  const hot = model.components.find((c) => c.id === "hot");
  assert.equal(hot.params["T.start"], "373.15", "a nested start is expanded");
  assert.equal(hot.params["T.fixed"], "true", "and so is its sibling");
  const joint = model.components.find((c) => c.id === "r");
  assert.equal(joint.params["useAxisFlange"], "true");
  assert.equal(joint.params["phi.start"], "1.2");
  assert.equal(joint.params["n"], "{1,0,0}", "a braced value keeps its braces");

  const out = serializeDiagram(model);
  assert.match(out, /T\(start=373\.15, fixed=true\)/, `re-emitted nested: ${out}`);
});

test("a parameter qualifier is kept, so a record stays a parameter", () => {
  // Dropping it turned the record into a continuous variable bound to a
  // higher-variability expression, which OpenModelica rejects.
  const src = `model T
  parameter Modelica.Electrical.Batteries.ParameterRecords.CellData cellData(Qnom=3600);
  Modelica.Electrical.Batteries.BatteryStacks.CellStack battery(Ns=3, cellData=cellData);
end T;
`;
  const model = toDiagramModel(findClass(parseModelica(src), "T"), () => undefined);
  const record = model.components.find((c) => c.id === "cellData");
  assert.ok(record.prefixes?.includes("parameter"), "the parameter prefix survives parsing");
  const out = serializeDiagram(model);
  assert.match(out, /parameter\s+Modelica\.Electrical\.Batteries\.ParameterRecords\.CellData cellData/);
});

test("a variable is not a diagram component", () => {
  // `Real h(start=1)` has no icon, no ports and no position, so it does not
  // belong on a schematic. Treating one as a component put every state variable
  // on the canvas at the same default spot: `BouncingBall`, which is three
  // variables and no components, rendered as three stacked 20x20 boxes in the
  // same place — indistinguishable from one block.
  const src = `model T
  parameter Real e=0.9 "Coefficient of restitution";
  Real h(start=1, fixed=true) "Height";
  Real v "Velocity";
  Modelica.Mechanics.Translational.Components.Mass mass(m=1);
equation
  der(h) = v;
end T;
`;
  const model = toDiagramModel(findClass(parseModelica(src), "T"), () => undefined);

  assert.equal(model.components.length, 1, "only the library component is drawn");
  assert.equal(model.components[0].id, "mass");
  assert.deepEqual(
    (model.variables ?? []).map((v) => v.id),
    ["e", "h", "v"],
    "the variables are kept as declarations"
  );

  // And they survive serialization exactly, including the parameter binding and
  // the modifier list.
  const out = serializeDiagram(model);
  assert.match(out, /^\s*parameter Real e=0\.9;/m, `parameter binding preserved:\n${out}`);
  assert.match(out, /^\s*Real h\(start=1, fixed=true\);/m, `modifiers preserved:\n${out}`);
  assert.doesNotMatch(out, /e\(e=/, "a parameter's own value is not written as a modifier");

  // Round-trip.
  const again = toDiagramModel(findClass(parseModelica(out), "T"), () => undefined);
  assert.equal(again.components.length, 1);
  assert.deepEqual((again.variables ?? []).map((v) => v.id), ["e", "h", "v"]);
  assert.deepEqual(again.variables.find((v) => v.id === "h").params, { start: "1", fixed: "true" });
});

test("a variable's parameter is still overridable at run time", () => {
  // Not drawn, but a `parameter Real` is exactly the kind of value worth
  // changing between runs, so it must reach the override list.
  const src = `model T
  parameter Real e=0.9;
  Real h(start=1, fixed=true);
equation
  der(h) = 0;
end T;
`;
  const model = toDiagramModel(findClass(parseModelica(src), "T"), () => undefined);
  const params = collectParameters(model);
  assert.equal(params["e"], "0.9", `the variable's parameter is collected, got ${JSON.stringify(params)}`);
});

test("an equation-based model survives a serialize round trip", () => {
  // The diagram models components and wires; it has no representation for
  // `der(h) = v`. Those equations were dropped entirely, so `BouncingBall` came
  // back as three declarations and an empty `equation` section, and OpenModelica
  // refused it with "Too few equations, under-determined system. The model has
  // 0 equation(s) and 2 variable(s)."
  const src = `model BouncingBall "A ball bouncing"
  parameter Real e=0.9 "restitution";
  Real h(start=1, fixed=true) "height";
  Real v "velocity";
equation
  der(h) = v;
  der(v) = -9.81;
  when h <= 0 then
    reinit(v, -e*pre(v));
  end when;
end BouncingBall;
`;
  const cls = findClass(parseModelica(src), "BouncingBall");
  assert.equal(cls.equations.length, 3, "every equation is captured");
  // Verbatim, not reconstructed: spacing and comments are the author's.
  assert.equal(cls.equations[0], "der(h) = v;");
  assert.equal(cls.equations[1], "der(v) = -9.81;");
  assert.match(cls.equations[2], /^when h <= 0 then/);
  assert.match(cls.equations[2], /end when;$/);

  const out = serializeDiagram(toDiagramModel(cls, () => undefined));
  assert.match(out, /der\(h\) = v;/, `the equations survive serialization:\n${out}`);
  assert.match(out, /der\(v\) = -9\.81;/, "including the second");
  assert.match(out, /reinit\(v, -e\*pre\(v\)\);/, "and the event handler");

  // And the result re-parses to the same equations, so saving repeatedly is
  // stable rather than eroding the model.
  const again = findClass(parseModelica(out), "BouncingBall");
  assert.ok(again, "the output re-parses");
  assert.equal(again.equations.length, cls.equations.length, "no equation lost on a second pass");
});

test("an equation is kept verbatim", () => {
  const src = `model M
  Real x;
equation
  der(x) = -x;
  x = 2*a + b;
end M;
`;
  const cls = findClass(parseModelica(src), "M");
  // Spacing is the author's, not a reconstruction. Re-joining tokens produced
  // `der(x)=- x` and similar.
  assert.deepEqual(cls.equations, ["der(x) = -x;", "x = 2*a + b;"]);
});

test("a comment inside an equation section is not swallowed into an equation", () => {
  // A comment on its own line sits before the statement begins, so it is not
  // part of any equation and is NOT preserved. Recorded here so the limitation
  // is deliberate rather than a surprise: the equations themselves survive, and
  // a comment between them is lost. Keeping it would mean attributing text that
  // belongs to no statement.
  const src = `model M
  Real x;
equation
  // the rate
  der(x) = -x;
end M;
`;
  const cls = findClass(parseModelica(src), "M");
  assert.equal(cls.equations.length, 1, "the equation is kept");
  assert.equal(cls.equations[0], "der(x) = -x;", "and is exactly the statement");
  assert.ok(!cls.equations[0].includes("the rate"), "the standalone comment is not attached to it");
});

test("an equation-only model is distinguishable from an empty one", () => {
  // The studio used to send a model with no components and no equations to the
  // compiler, which reported an under-determined system. Knowing the difference
  // is what lets it say something useful instead.
  const empty = toDiagramModel(findClass(parseModelica("model E\nend E;"), "E"), () => undefined);
  assert.equal(empty.components.length, 0);
  assert.equal((empty.equations ?? []).length, 0, "nothing to simulate");

  const sourced = toDiagramModel(
    findClass(parseModelica("model S\n  Real x;\nequation\n  der(x) = -x;\nend S;"), "S"),
    () => undefined
  );
  assert.equal(sourced.components.length, 0, "no schematic either");
  assert.equal((sourced.equations ?? []).length, 1, "but it does have physics");
});
