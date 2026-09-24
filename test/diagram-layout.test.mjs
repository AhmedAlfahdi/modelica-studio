/**
 * Are the example diagrams laid out well?
 *
 * "Looks tidy" is a judgement, but the things that make a schematic look untidy are not:
 * symbols that overlap, a chain that zig-zags instead of running along one axis, a part
 * stranded far from what it connects to, a drawing that has drifted outside the ±100
 * box a Modelica diagram is conventionally drawn in.
 *
 * These are the rules a reader's eye applies without knowing it, written down so they
 * can be checked — and so a model added later is held to them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { buildLibs } from "./helpers/build.mjs";

const MSL = [
  "/home/para/.openmodelica/libraries/Modelica 4.1.0+maint.om",
  "/home/para/.openmodelica/libraries/Modelica 3.2.3+maint.om",
].find((c) => fs.existsSync(c));

const LIB = buildLibs("diagram-layout-lib", [
  "src/modelica/parser.ts",
  "src/modelica/examples.ts",
  "src/modelica/library.ts",
  "src/modelica/types.ts",
]);
// The renderer's own geometry, for the label test: its own bundle, because one bundle
// with entries under both `src/modelica` and `src/render` is emitted under a shared
// `src/` root and the paths above would all move.
const RLIB = buildLibs("diagram-layout-render", ["src/render/canvas.ts", "src/render/labels.ts"]);
const { parseModelica } = await import(path.join(LIB, "parser.js"));
const { EXAMPLES } = await import(path.join(LIB, "examples.js"));

/** The box each placed component occupies, in diagram coordinates (+y up). */
function boxes(source) {
  const parsed = parseModelica(source)[0];
  const placed = (parsed.components ?? [])
    .filter((c) => c.placement?.extent?.length === 4)
    .map((c) => {
      const [x1, y1, x2, y2] = c.placement.extent;
      return {
        name: c.name,
        className: c.className,
        left: Math.min(x1, x2),
        right: Math.max(x1, x2),
        bottom: Math.min(y1, y2),
        top: Math.max(y1, y2),
        cx: (x1 + x2) / 2,
        cy: (y1 + y2) / 2,
      };
    });
  return { parsed, placed };
}

const overlaps = (a, b) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
  Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom) > 0.5;

/** The gap between two boxes: zero when they touch, negative when they overlap. */
function gapBetween(a, b) {
  const dx = Math.max(a.left - b.right, b.left - a.right);
  const dy = Math.max(a.bottom - b.top, b.bottom - a.top);
  if (dx <= 0 && dy <= 0) return Math.max(dx, dy);
  return Math.max(dx, dy);
}

/** The connections whose two ends are both placed components of this model. */
function wires(example, placed) {
  const byName = new Map(placed.map((p) => [p.name, p]));
  const out = [];
  for (const c of parseModelica(example.source)[0].connections ?? []) {
    const a = byName.get(String(c.from ?? "").split(".")[0]);
    const b = byName.get(String(c.to ?? "").split(".")[0]);
    if (a && b && a !== b) out.push({ from: c.from, to: c.to, a, b });
  }
  return out;
}

test("no example draws two symbols on top of each other", () => {
  const bad = [];
  for (const example of EXAMPLES) {
    const { placed } = boxes(example.source);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        if (overlaps(placed[i], placed[j])) {
          bad.push(`${example.name}: ${placed[i].name} overlaps ${placed[j].name}`);
        }
      }
    }
  }
  assert.deepEqual(bad, [], `${bad.length} overlapping symbols`);
});

test("a connection runs along one axis, not diagonally", () => {
  // Every connect between two placed components should look like a wire: the parts
  // either share a height (a horizontal run) or share a column (a vertical one). A
  // diagonal reads as a mistake even when it is electrically correct, and an orthogonal
  // drawing is what makes a schematic scannable.
  const TOL = 12; // diagram units: a port is 10 wide, so this is "the same line"
  const bad = [];
  for (const example of EXAMPLES) {
    const { placed } = boxes(example.source);
    for (const { from, to, a, b } of wires(example, placed)) {
      const sameRow = Math.abs(a.cy - b.cy) <= TOL;
      const sameColumn = Math.abs(a.cx - b.cx) <= TOL;
      const sideBySide = a.right <= b.left + TOL || b.right <= a.left + TOL;
      const stacked = a.top <= b.bottom + TOL || b.top <= a.bottom + TOL;
      if (!(sameRow && sideBySide) && !(sameColumn && stacked)) {
        bad.push(
          `${example.name}: ${from} -> ${to} is diagonal (centres ${a.cx},${a.cy} and ${b.cx},${b.cy})`
        );
      }
    }
  }
  assert.deepEqual(bad, [], `${bad.length} diagonal connections`);
});

test("no part is stranded from what it connects to", () => {
  // A long wire means the eye travels to find the other end. The library's own drawings
  // keep connected parts adjacent.
  const MAX_GAP = 60;
  const bad = [];
  for (const example of EXAMPLES) {
    const { placed } = boxes(example.source);
    for (const { from, to, a, b } of wires(example, placed)) {
      const gap = gapBetween(a, b);
      if (gap > MAX_GAP) {
        bad.push(`${example.name}: ${from} -> ${to} leaves a ${Math.round(gap)} unit gap`);
      }
    }
  }
  assert.deepEqual(bad, [], `${bad.length} connections stretch across the diagram`);
});

/**
 * Symbols allowed outside the ±100 box, and why.
 *
 * A named exception rather than a wider box: widening the rule to fit one part would stop
 * it catching the next one, and this way the reader of a failure is told which allowance
 * exists and who asked for it.
 *
 * `ResistorSelfHeating: ambient` is the electrical-to-thermal chain running left to
 * right: the supply and the resistor stand vertically at x -70..-10, the heated body is
 * at 20..40, the conductor at 50..70, and the still-air source lands at 100..120. Pulling
 * that last one back inside the box would drop it on top of the conductor it is wired to,
 * which is the untidiness the box rule exists to catch.
 *
 * The map was empty before this entry, and not always: `HeatExchanger: ramp` had a minX
 * allowance of -120 while the author had the ramp at x -110..-90, reaching the heater
 * without crossing the thermal path. Their later arrangement put it at -100..-80, so the
 * allowance went and the rule was the rule again.
 */
const OUTSIDE_THE_BOX = new Map([["ResistorSelfHeating: ambient", { maxX: 120 }]]);

test("the drawing stays in the box a Modelica diagram is drawn in", () => {
  // ±100 is the extent of a default icon and the frame OMEdit shows. Content outside it
  // is legal and looks like a mistake.
  const bad = [];
  for (const example of EXAMPLES) {
    const { placed } = boxes(example.source);
    // A model with no components at all is equations-only -- DampedBounce, AirfoilLift
    // and Phugoid are written that way on purpose, and there is no diagram to lay out.
    if (placed.length === 0) continue;
    for (const p of placed) {
      const allowed = OUTSIDE_THE_BOX.get(`${example.name}: ${p.name}`);
      const minX = allowed?.minX ?? -100;
      const maxX = allowed?.maxX ?? 100;
      if (p.left < minX || p.right > maxX || p.bottom < -100 || p.top > 100) {
        bad.push(`${example.name}: ${p.name} spans x ${p.left}..${p.right}, y ${p.bottom}..${p.top}`);
      }
    }
  }
  assert.deepEqual(bad, [], `${bad.length} symbols outside the ±100 box`);
});

test("connected ports line up on a common axis", { skip: !MSL && "no MSL installed" }, async () => {
  // The precise version of "not diagonal": a wire between two pins should be a straight
  // run, which means the two PORTS share an x (a vertical run) or a y (a horizontal one).
  // A component can be perfectly placed by centre and still have its pins 10 units apart
  // from the pin it connects to, and that jog is what an eye reads as untidy.
  const { LibraryIndex } = await import(path.join(LIB, "library.js"));
  const index = new LibraryIndex();
  index.addDirectory(MSL);
  const TOL = 8; // diagram units
  const bad = [];

  /** Where a port sits in diagram coordinates, for rotation 0. */
  const portAt = (placed, def, port) => {
    const rel = def?.portPositions?.[port];
    if (!rel) return null;
    const [rx, ry] = rel;
    return [
      placed.left + ((rx + 100) / 200) * (placed.right - placed.left),
      placed.bottom + ((ry + 100) / 200) * (placed.top - placed.bottom),
    ];
  };

  for (const example of EXAMPLES) {
    const { parsed, placed } = boxes(example.source);
    const byName = new Map(placed.map((p) => [p.name, p]));
    const defOf = new Map();
    for (const c of parsed.components ?? []) {
      if (c.placement?.rotation) continue; // rotated parts are a separate question
      // A component whose type the parser could not name has no ports to line up.
      if (!c.className) continue;
      defOf.set(c.name, index.describe(c.className));
    }
    for (const wire of wires(example, placed)) {
      const fromPort = String(wire.from).split(".")[1];
      const toPort = String(wire.to).split(".")[1];
      const a = portAt(wire.a, defOf.get(wire.a.name), fromPort);
      const b = portAt(wire.b, defOf.get(wire.b.name), toPort);
      if (!a || !b) continue; // a class with no declared port placement
      const dx = Math.abs(a[0] - b[0]);
      const dy = Math.abs(a[1] - b[1]);
      if (dx > TOL && dy > TOL) {
        bad.push(
          `${example.name}: ${wire.from} (${Math.round(a[0])},${Math.round(a[1])}) to ${wire.to} ` +
            `(${Math.round(b[0])},${Math.round(b[1])}) needs a jog of ${Math.round(dx)}x${Math.round(dy)}`
        );
      }
    }
  }
  assert.deepEqual(bad, [], `${bad.length} wires need a jog between the pins`);
});

test("no component's name lands on a symbol or a wire", { skip: !MSL && "no MSL installed" }, async () => {
  // Reported twice from a rendered page: a name sitting on the symbol beside it, then a
  // name sitting on a WIRE. Both are one failure -- the name is placed against boxes
  // that are not the ink:
  //
  //   - the artwork box misses the pins, and the renderer draws a stub and a marker at
  //     every declared port. SineVoltage's `signalSource` sits at {80.5,79} against
  //     artwork that stops at y = 69.8, so a name placed to the right of the artwork
  //     landed on that pin's arrow.
  //   - the wires were simply not obstacles in the first version.
  //
  // This checks the rule for EVERY component of EVERY example, in the geometry the
  // editor actually uses: the ink box (`instanceInkBounds`, artwork plus pins, plus the
  // marker clearance) and the same wire routes the renderer draws, from the same two
  // functions (`portPosition` and `routeConnection`). A name must clear every box that
  // is not its own, and every wire.
  const { LibraryIndex } = await import(path.join(LIB, "library.js"));
  const C = await import(path.join(RLIB, "canvas.js"));
  const L = await import(path.join(RLIB, "labels.js"));
  const { toDiagramModel } = await import(path.join(LIB, "parser.js"));
  const index = new LibraryIndex();
  index.addDirectory(MSL);

  // One viewport for every example: the pass works in device pixels, and the numbers
  // that matter are ratios there, so a single scale is enough. 6 px per unit is a
  // comfortable zoom, and the text is measured at the widest size the setting allows.
  const vp = { scale: 6, x: 400, y: 300 };
  const vt = C.viewportTransform(vp, 1);
  const inflate = (b) => ({
    x1: b[0] - L.LABEL_CLEARANCE,
    y1: b[1] - L.LABEL_CLEARANCE,
    x2: b[2] + L.LABEL_CLEARANCE,
    y2: b[3] + L.LABEL_CLEARANCE,
  });
  const overlap = (a, b) => ({
    w: Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1),
    h: Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1),
  });
  const hits = (a, b) => {
    const o = overlap(a, b);
    return o.w > 0 && o.h > 0;
  };
  // A stand-in for the text: 7 px a character at the 13 px cap, which is what a
  // sans-serif face measures at. Wider than the real thing, so the check is strict.
  const measure = (text) => text.length * 7;

  const bad = [];
  let labels = 0;
  for (const example of EXAMPLES) {
    const model = toDiagramModel(parseModelica(example.source)[0], (n) => index.describe(n));
    if (model.components.length === 0) continue;
    const ink = new Map();
    const requests = [];
    for (const inst of model.components) {
      const box = inflate(C.transformedBounds(vt, ...C.instanceInkBounds(inst, index.describe(inst.className))));
      ink.set(inst.id, box);
      requests.push({ id: inst.id, box, fontPx: 13 });
    }
    const occupied = [...ink.values()];
    const wireOf = [];
    for (const conn of model.connections) {
      const a = model.components.find((c) => c.id === conn.from.component);
      const b = model.components.find((c) => c.id === conn.to.component);
      if (!a || !b) continue;
      const pa = C.portPosition(a, index.describe(a.className), conn.from.port);
      const pb = C.portPosition(b, index.describe(b.className), conn.to.port);
      if (!pa || !pb) continue;
      const pts = C.routeConnection(pa, pb, conn.points ?? []);
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const p = C.apply(vt, pts[i], pts[i + 1]);
        const q = C.apply(vt, pts[i + 2], pts[i + 3]);
        occupied.push({
          x1: Math.min(p[0], q[0]) - L.WIRE_CLEARANCE,
          y1: Math.min(p[1], q[1]) - L.WIRE_CLEARANCE,
          x2: Math.max(p[0], q[0]) + L.WIRE_CLEARANCE,
          y2: Math.max(p[1], q[1]) + L.WIRE_CLEARANCE,
        });
        wireOf.push(`${example.name}: ${conn.from.component}.${conn.from.port} -> ${conn.to.component}.${conn.to.port}`);
      }
    }

    const { spots } = L.placeLabels(requests, occupied, measure);
    labels += spots.size;
    for (const [id, spot] of spots) {
      const mine = ink.get(id);
      for (const [otherId, box] of ink) {
        if (otherId === id) continue;
        if (hits(spot.box, box)) bad.push(`${example.name}: "${id}" lands on ${otherId}`);
      }
      // Its own box: the candidate sides are outside it by construction, so this is a
      // check on the arithmetic rather than on the choice.
      if (hits(spot.box, mine)) bad.push(`${example.name}: "${id}" lands on its own symbol`);
      const flat = { x1: spot.box.x1, y1: spot.box.y1, x2: spot.box.x2, y2: spot.box.y2 };
      for (const w of occupied.slice(ink.size)) {
        if (hits(flat, w)) {
          bad.push(`${example.name}: "${id}" lands on a wire`);
          break;
        }
      }
      for (const [otherId, other] of spots) {
        if (otherId === id) continue;
        if (hits(spot.box, other.box)) bad.push(`${example.name}: "${id}" lands on "${otherId}"'s name`);
      }
    }
    const missing = model.components.filter((c) => c.id && !spots.has(c.id));
    if (missing.length) bad.push(`${example.name}: no place for ${missing.map((c) => c.id).join(", ")}`);
  }

  assert.ok(labels > 100, `every example was laid out (${labels} names placed)`);
  assert.deepEqual(bad.slice(0, 12), [], `${bad.length} names overlap something`);
});
