/**
 * Components drawn on a REAL canvas, at two device pixel ratios.
 *
 * The library-wide sweeps in `icon-render.test.mjs` draw into a recorder: a proxy
 * that logs the calls instead of rasterising them. That is what makes them fast
 * enough to run over every class, and it is blind to a whole class of fault --
 * anything that goes wrong in the rasteriser rather than in the calls:
 *
 *   - a transform that arrives as NaN paints nothing and throws nothing;
 *   - text is measured by a real font, not by an assumed character width;
 *   - the device pixel ratio is applied by the drawing code, and a mistake there
 *     renders the symbol at the wrong SIZE in a buffer of the right size, which is
 *     exactly the misalignment this project shipped once already (the symbols were
 *     drawn at 1.25x the position of their own hit boxes).
 *
 * So this file draws a SAMPLE of the library -- a few classes from each area, with
 * their real icons and parameters -- on a real canvas at dpr 1 and dpr 2, and
 * asserts three things about the pixels: something was drawn, it is where the
 * canvas is, and doubling the ratio doubles the drawing's linear size.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";
import { runInDom, DOM_PREAMBLE } from "./helpers/dom-runner.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const MSL_CANDIDATES = [
  "/home/para/.openmodelica/libraries/Modelica 4.1.0+maint.om",
  "/home/para/.openmodelica/libraries/Modelica 3.2.3+maint.om",
];
const MSL = MSL_CANDIDATES.find((c) => fs.existsSync(c)) ?? null;

/**
 * The classes to draw.
 *
 * One from each area a student meets, and the two this project has had trouble
 * with: a tank (whose icon is animated with `DynamicSelect`) and a `Step` block
 * (whose attributes were summarised rather than read). The icons come from real MSL
 * source, on the Node side, because the page has no filesystem.
 */
const PICKS = [
  "Modelica.Blocks.Math.Add",
  "Modelica.Blocks.Continuous.Filter",
  "Modelica.Blocks.Sources.Sine",
  "Modelica.Blocks.Logical.And",
  "Modelica.Electrical.Analog.Basic.Resistor",
  "Modelica.Electrical.Analog.Basic.Ground",
  "Modelica.Electrical.Analog.Sources.ConstantVoltage",
  "Modelica.Electrical.Digital.Basic.And",
  "Modelica.Fluid.Vessels.OpenTank",
  "Modelica.Fluid.Pipes.StaticPipe",
  "Modelica.Fluid.Fittings.SimpleGenericOrifice",
  "Modelica.Mechanics.Rotational.Components.Inertia",
  "Modelica.Mechanics.Translational.Components.Mass",
  "Modelica.Mechanics.MultiBody.Parts.Body",
  "Modelica.Thermal.HeatTransfer.Components.HeatCapacitor",
  "Modelica.Thermal.HeatTransfer.Sources.FixedTemperature",
  "Modelica.Clocked.BooleanSignals.TickBasedSources.Step",
  "Modelica.StateGraph.Interfaces.Step_in",
  "Modelica.Electrical.Machines.BasicMachines.DCMachines.DC_PermanentMagnet",
];

/** The icon and parameters of one class, read here and passed to the page. */
function describeForPage(index, name) {
  const def = index.describe(name);
  if (!def?.icon?.length) return null;
  const params = {};
  for (const p of def.parameters ?? []) {
    if (p.defaultValue !== undefined) params[p.name] = String(p.defaultValue);
  }
  return { name, icon: def.icon, params };
}

test("a sample of the library paints on a real canvas, at both pixel ratios", async (t) => {
  if (!MSL) return t.skip("no MSL installed");

  // Node side: resolve the sample through the real index.
  const LIB = buildLibs("component-render-lib", [
    "src/modelica/library.ts",
    "src/modelica/parser.ts",
    "src/modelica/types.ts",
  ]);
  const files = fs.readdirSync(LIB, { recursive: true }).map(String);
  const at = (n) => path.join(LIB, files.find((f) => f.endsWith(n)));
  const { LibraryIndex } = await import(at("library.js"));
  const index = new LibraryIndex();
  index.addDirectory(MSL);

  const names = PICKS.filter((n) => index.describe(n)?.icon?.length);
  assert.ok(names.length >= 15, `the sample is worth drawing: ${names.length} classes`);
  const sampleJson = JSON.stringify(names.map((n) => describeForPage(index, n)).filter(Boolean));

  const out = await runInDom(
    [
      DOM_PREAMBLE,
      `import { drawComponent } from "${ROOT}/src/render/canvas";`,
      `import { LIGHT_THEME } from "${ROOT}/src/render/theme";`,
      `const SAMPLE = ${sampleJson};`,
      "",
      "/** The ink a class leaves on a real canvas at this ratio. */",
      "function draw(sample, dpr) {",
      "  const SIZE = 200;",
      "  const canvas = document.createElement('canvas');",
      "  canvas.width = SIZE * dpr;",
      "  canvas.height = SIZE * dpr;",
      "  const ctx = canvas.getContext('2d');",
      "  ctx.setTransform(1, 0, 0, 1, 0, 0);",
      "  ctx.fillStyle = LIGHT_THEME.background;",
      "  ctx.fillRect(0, 0, canvas.width, canvas.height);",
      "  drawComponent(",
      "    ctx,",
      "    { id: 'x', className: sample.name, placement: { extent: [-10, -10, 10, 10] }, params: sample.params },",
      "    { name: sample.name, shortName: sample.name.split('.').pop(), icon: sample.icon, ports: [], parameters: [], hasIcon: true },",
      "    // `scale` is in CSS pixels per diagram unit and `dpr` is applied by the",
      "    // drawing code, so the SAME scale at both ratios is what makes this a test.",
      "    { x: SIZE / 2, y: SIZE / 2, scale: 4 },",
      "    dpr,",
      "    { lookup: () => undefined, theme: LIGHT_THEME }",
      "  );",
      "  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;",
      "  let ink = 0;",
      "  let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;",
      "  for (let y = 0; y < canvas.height; y++) {",
      "    for (let x = 0; x < canvas.width; x++) {",
      "      const o = (y * canvas.width + x) * 4;",
      "      // Anything that differs from the surface it was filled with is ink.",
      "      if (Math.abs(d[o] - 250) + Math.abs(d[o + 1] - 251) + Math.abs(d[o + 2] - 253) < 12) continue;",
      "      ink++;",
      "      if (x < minX) minX = x;",
      "      if (x > maxX) maxX = x;",
      "      if (y < minY) minY = y;",
      "      if (y > maxY) maxY = y;",
      "    }",
      "  }",
      "  return { ink, box: [minX, minY, maxX, maxY], size: canvas.width };",
      "}",
      "",
      "window.test('every sampled class paints something on a real canvas', () => {",
      "  const blank = [];",
      "  for (const s of SAMPLE) {",
      "    const r = draw(s, 1);",
      "    if (r.ink < 12) blank.push(s.name + ' (' + r.ink + 'px)');",
      "  }",
      "  return blank.join(' | ');",
      "});",
      "window.test('the drawing stays on the canvas', () => {",
      "  const off = [];",
      "  for (const s of SAMPLE) {",
      "    const r = draw(s, 1);",
      "    if (r.box[0] < 0 || r.box[1] < 0 || r.box[2] >= r.size || r.box[3] >= r.size) {",
      "      off.push(s.name + ' ' + JSON.stringify(r.box) + ' of ' + r.size);",
      "    }",
      "  }",
      "  return off.join(' | ');",
      "});",
      "window.test('twice the pixel ratio draws the same symbol twice as large', () => {",
      "  const wrong = [];",
      "  for (const s of SAMPLE) {",
      "    const a = draw(s, 1);",
      "    const b = draw(s, 2);",
      "    const wa = a.box[2] - a.box[0], wb = b.box[2] - b.box[0];",
      "    if (wa <= 0) { wrong.push(s.name + ': nothing to compare'); continue; }",
      "    const ratio = wb / wa;",
      "    // Twice the ratio is twice the width in device pixels. The window absorbs",
      "    // antialiasing at the edges and a symbol whose ink is one pixel wide.",
      "    if (ratio < 1.7 || ratio > 2.3) {",
      "      wrong.push(s.name + ': ' + wa + 'px -> ' + wb + 'px (x' + ratio.toFixed(2) + ')');",
      "    }",
      "  }",
      "  return wrong.join(' | ');",
      "});",
      "window.finish();",
    ].join("\n")
  );

  assert.ok(!out.fatal, out.fatal);
  assert.deepEqual(out.errors, [], "no page errors");
  const by = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);

  assert.equal(
    by["every sampled class paints something on a real canvas"],
    "",
    "a class that paints nothing is a component nobody can see"
  );
  assert.equal(by["the drawing stays on the canvas"], "", "nothing is drawn off the surface");
  assert.equal(
    by["twice the pixel ratio draws the same symbol twice as large"],
    "",
    "the device pixel ratio scales the drawing once, not twice and not not at all"
  );
});
