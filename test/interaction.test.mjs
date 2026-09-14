/**
 * Interaction tests: hit testing, placement transforms and drag arithmetic.
 *
 * These run headlessly by exercising the pure geometry functions that the
 * editor's pointer handlers are built on. They are what should catch
 * "I can't select or move a component" class bugs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildLibs } from "./helpers/build.mjs";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");


const C = await import(path.join(buildLibs("canvas-lib", ["src/render/canvas.ts"]), "canvas.js"));
// The theme module, for the palette tests.
const T = await import(path.join(buildLibs("theme-lib", ["src/render/theme.ts"]), "theme.js"));

/** A minimal class definition good enough for geometry. */
function classDef(name, ports = {}) {
  return {
    name,
    shortName: name.split(".").pop(),
    icon: [],
    diagram: [],
    ports: Object.keys(ports).map((p) => ({
      name: p,
      type: "Pin",
      isFlow: true,
      causality: "acausal",
    })),
    portPositions: ports,
    parameters: [],
    hasIcon: false,
  };
}

const DEFS = {
  "M.R": classDef("M.R", { p: [-100, 0], n: [100, 0] }),
  "M.C": classDef("M.C", { p: [-100, 0], n: [100, 0] }),
};
const lookup = (n) => DEFS[n];

/** Reproduce the editor's drop placement: a square centred on the drop point. */
function dropped(id, cls, x, y, half = 20) {
  return {
    id,
    className: cls,
    placement: {
      extent: [x - half, y - half, x + half, y + half],
      rotation: 0,
      visible: true,
    },
    params: {},
  };
}

function emptyModel(components = []) {
  return { name: "M", components, connections: [], graphics: [] };
}

/* ------------------------------------------------------------------ */

test("drop placement puts the component centre on the drop point", () => {
  const inst = dropped("r1", "M.R", 120, -60);
  const t = C.placementTransform(inst);
  // The extent centre must map to the drop point.
  const [cx, cy] = C.apply(t, 0, 0);
  assert.equal(cx, 120);
  assert.equal(cy, -60);
});

test("placementTransform maps canonical -100..100 onto the extent", () => {
  const inst = dropped("r1", "M.R", 0, 0, 20); // extent is -20..20
  const t = C.placementTransform(inst);
  const [px] = C.apply(t, -100, 0); // canonical pin p
  const [nx] = C.apply(t, 100, 0); // canonical pin n
  assert.equal(px, -20, "pin p sits on the left edge");
  assert.equal(nx, 20, "pin n sits on the right edge");
});

test("hitTestComponent finds a component at its centre and inside its box", () => {
  const model = emptyModel([dropped("r1", "M.R", 120, -60)]);
  for (const [x, y] of [
    [120, -60], // centre
    [101, -79], // just inside the top-left corner
    [139, -41], // just inside the bottom-right corner
  ]) {
    const hit = C.hitTestComponent(model, lookup, x, y, 0);
    assert.ok(hit, `expected a hit at (${x}, ${y})`);
    assert.equal(hit.id, "r1");
  }
});

test("hitTestComponent misses outside the box", () => {
  const model = emptyModel([dropped("r1", "M.R", 120, -60)]);
  assert.equal(C.hitTestComponent(model, lookup, 160, -60, 0), undefined);
  assert.equal(C.hitTestComponent(model, lookup, 120, -100, 0), undefined);
});

test("hitTestComponent honours rotation", () => {
  // A 60x20 rectangle rotated 90 degrees becomes 20x60 on screen.
  const inst = dropped("r1", "M.R", 0, 0);
  inst.placement.extent = [-30, -10, 30, 10];
  inst.placement.rotation = 90;
  const model = emptyModel([inst]);

  // Now tall: a point 25 above centre is inside...
  assert.ok(C.hitTestComponent(model, lookup, 0, 25, 0), "inside after rotation");
  // ...and a point 25 to the right is outside (it was inside before rotating).
  assert.equal(C.hitTestComponent(model, lookup, 25, 0, 0), undefined, "outside after rotation");
});

test("hitTestComponent selects the topmost of overlapping components", () => {
  const model = emptyModel([
    dropped("under", "M.R", 0, 0),
    dropped("over", "M.C", 5, 5),
  ]);
  const hit = C.hitTestComponent(model, lookup, 3, 3, 0);
  assert.equal(hit.id, "over", "later components win");
});

test("port positions land on the component's own extents", () => {
  const inst = dropped("r1", "M.R", 0, 0, 20);
  const p = C.portPosition(inst, DEFS["M.R"], "p");
  const n = C.portPosition(inst, DEFS["M.R"], "n");
  assert.deepEqual(p, [-20, 0]);
  assert.deepEqual(n, [20, 0]);
});

test("findPortAt returns a port within radius and not beyond it", () => {
  const model = emptyModel([dropped("r1", "M.R", 0, 0, 20)]);
  const near = C.findPortAt(model, lookup, -19, 1, 5);
  assert.ok(near, "port p found near its position");
  assert.equal(near.port, "p");
  assert.equal(C.findPortAt(model, lookup, 0, 0, 5), undefined, "centre is not a port");
});

test("drag moves the component so it follows the pointer", () => {
  // Mirrors the editor: grab offset captured on pointerdown, reapplied on move.
  const inst = dropped("r1", "M.R", 100, 100);
  const grabDX = 0;
  const grabDY = 0;
  const GRID = 10;

  const gx = 0;
  const gy = 0;
  const dx = 153;
  const dy = 87;
  const cx = dx - grabDX + gx;
  const cy = dy - grabDY + gy;
  const sx = Math.round(cx / GRID) * GRID;
  const sy = Math.round(cy / GRID) * GRID;
  const w = inst.placement.extent[2] - inst.placement.extent[0];
  const h = inst.placement.extent[3] - inst.placement.extent[1];
  inst.placement.extent = [sx - w / 2, sy - h / 2, sx + w / 2, sy + h / 2];

  const t = C.placementTransform(inst);
  const [mx, my] = C.apply(t, 0, 0);
  assert.equal(mx, 150, "snapped to the 10-unit grid");
  assert.equal(my, 90);
});

test("a component stays hit-testable after being dragged", () => {
  const inst = dropped("r1", "M.R", 0, 0);
  inst.placement.extent = [130, 70, 170, 110]; // as if dragged and snapped
  const model = emptyModel([inst]);
  assert.ok(C.hitTestComponent(model, lookup, 150, 90, 0), "hit at the new location");
  assert.equal(C.hitTestComponent(model, lookup, 0, 0, 0), undefined, "not at the old one");
});

test("viewport transform does not affect diagram-space hit testing", () => {
  // Hit testing works in diagram coordinates, so panning and zooming must not
  // change the result — the screen->diagram conversion happens before the call.
  const model = emptyModel([dropped("r1", "M.R", 50, 50)]);
  for (const vp of [
    { x: 0, y: 0, scale: 1 },
    { x: 400, y: -250, scale: 2.5 },
    { x: -80, y: 33, scale: 0.3 },
  ]) {
    // Convert a diagram point to screen and back, as the editor does.
    const sx = 50 * vp.scale + vp.x;
    const sy = 50 * vp.scale + vp.y;
    const dx = (sx - vp.x) / vp.scale;
    const dy = (sy - vp.y) / vp.scale;
    const hit = C.hitTestComponent(model, lookup, dx, dy, 0);
    assert.ok(hit, `hit at viewport ${JSON.stringify(vp)}`);
  }
});

test("resizing scales the extent about the dragged corner", () => {
  // The resize maths the editor will use: keep the opposite corner fixed.
  const start = [-20, -20, 20, 20];
  const minSize = 8;
  const resize = (ext, handle, x, y, min = minSize) => {
    const [x1, y1, x2, y2] = ext;
    let nx1 = x1, ny1 = y1, nx2 = x2, ny2 = y2;
    if (handle.includes("w")) nx1 = Math.min(x, nx2 - min);
    if (handle.includes("e")) nx2 = Math.max(x, nx1 + min);
    if (handle.includes("n")) ny1 = Math.min(y, ny2 - min);
    if (handle.includes("s")) ny2 = Math.max(y, ny1 + min);
    return [nx1, ny1, nx2, ny2];
  };

  assert.deepEqual(resize(start, "se", 60, 60), [-20, -20, 60, 60], "SE drag grows");
  assert.deepEqual(resize(start, "nw", -60, -60), [-60, -60, 20, 20], "NW drag grows other way");
  // The opposite corner is preserved.
  const r = resize(start, "se", 60, 10);
  assert.deepEqual([r[0], r[1]], [-20, -20], "NW corner fixed when dragging SE");
  // Minimum size is enforced.
  const tiny = resize(start, "se", -100, -100);
  assert.ok(tiny[2] - tiny[0] >= minSize, "width clamped");
  assert.ok(tiny[3] - tiny[1] >= minSize, "height clamped");
});

test("clicking a component body selects it rather than grabbing a port", () => {
  // Regression: MSL pins sit exactly on the extent edge. With a large port-grab
  // radius, a click anywhere on a 40x40 symbol landed within 12 units of a pin,
  // so the editor started a wire instead of selecting the component.
  const PORT_GRAB_PX = 7;

  for (const scale of [0.25, 0.5, 1, 2, 4]) {
    const portR = PORT_GRAB_PX / scale;
    const model = emptyModel([dropped("r1", "M.R", 0, 0, 20)]); // extent -20..20

    // Body clicks the user would naturally make: centre and just inside edges.
    for (const [x, y] of [
      [0, 0],
      [-10, 0],
      [10, 0],
      [0, -10],
      [0, 10],
    ]) {
      const body = C.hitTestComponent(model, lookup, x, y, 3 / scale);
      assert.ok(body, `scale ${scale}: body hit at (${x}, ${y})`);

      // With the fixed priority, the body wins regardless of the grab radius.
      const port = C.findPortAt(model, lookup, x, y, portR);
      if (port) {
        // Even where a port is technically in range, selection must win.
        assert.ok(body, `scale ${scale}: component must still be selectable at (${x}, ${y})`);
      }
    }
  }
});

test("a port remains grabbable exactly on its pin", () => {
  // MSL pins sit ON the extent edge, so there is no gap between body and pin.
  // The editor resolves this by preferring the body for selection and letting
  // the port be grabbed only within a small radius of the pin itself, or with
  // a modifier. Both must work at the pin's own coordinates.
  const model = emptyModel([dropped("r1", "M.R", 0, 0, 20)]); // pins at x = -20 and +20

  for (const [px, name] of [[-20, "p"], [20, "n"]]) {
    const port = C.findPortAt(model, lookup, px, 0, 7);
    assert.ok(port, `pin ${name} grabbable at its own position`);
    assert.equal(port.port, name);
  }

  // Far from any pin, no port is reported.
  assert.equal(C.findPortAt(model, lookup, 0, 0, 7), undefined, "centre is not a port");
  assert.equal(C.findPortAt(model, lookup, 60, 0, 7), undefined, "well outside is not a port");
});

test("scaled port grab radius stays usable at typical zoom levels", () => {
  const PORT_GRAB_PX = 7;
  const model = emptyModel([dropped("r1", "M.R", 0, 0, 20)]);
  // At 1:1 the grab zone must not reach the body centre.
  const r = PORT_GRAB_PX / 1;
  assert.equal(col(C.findPortAt(model, lookup, 0, 0, r)), undefined, "centre is not a port at 1:1");
  // ...and the pin itself must still be grabbable.
  assert.ok(C.findPortAt(model, lookup, -20, 0, r), "pin grabbable at 1:1");

  function col(p) {
    return p ? `${p.component}.${p.port}` : undefined;
  }
});

test("wire weight stays legible and proportionate across zoom levels", () => {
  // Regression: the wire stroke was multiplied by the zoom twice (written as a
  // diagram-space width, then scaled again by the canvas transform), so it grew
  // quadratically — thinner than the symbol when zoomed out, many times thicker
  // when zoomed in. It now tracks the zoom linearly with a legibility floor.
  const wirePx = (ts) => Math.max(C.MIN_WIRE_WIDTH_PX, C.WIRE_WIDTH_PX * Math.max(1, ts));

  assert.ok(C.WIRE_WIDTH_PX > 0 && C.WIRE_WIDTH_PX <= 4, `sane base weight, got ${C.WIRE_WIDTH_PX}`);
  assert.ok(C.MIN_WIRE_WIDTH_PX >= 1, `legible floor, got ${C.MIN_WIRE_WIDTH_PX}`);

  let prev = 0;
  for (const ts of [0.25, 0.5, 1, 2, 4, 8]) {
    const px = wirePx(ts);
    assert.ok(px >= C.MIN_WIRE_WIDTH_PX, `zoom ${ts}: never below the floor, got ${px}`);
    assert.ok(px <= 40, `zoom ${ts}: never absurd, got ${px}`);
    // Within the tracking region the weight must grow with zoom, not shrink.
    if (ts >= 1) {
      assert.ok(px >= prev - 1e-9, `zoom ${ts}: weight must not shrink as we zoom in`);
    }
    prev = px;
  }
});

test("wire and symbol strokes stay in a schematic-like ratio across zoom", () => {
  // The wire should read slightly heavier than a symbol's outline, and both
  // must stay visible. Previously the symbol stroke computed to 0.1px at every
  // zoom (invisible) while the wire grew quadratically, so they never matched.
  const SIZE = C.MSL_COMPONENT_SIZE;
  const wirePx = (ts) => Math.max(C.MIN_WIRE_WIDTH_PX, C.WIRE_WIDTH_PX * Math.max(1, ts));
  const strokePx = (ts) => Math.max(1, Math.min(6, 1.6 * ((SIZE * ts) / 40)));

  for (const ts of [0.5, 1, 1.5, 2, 4]) {
    const wire = wirePx(ts);
    const stroke = strokePx(ts);
    assert.ok(stroke >= 1, `symbol outline legible at scale ${ts} (${stroke}px)`);
    assert.ok(wire >= C.MIN_WIRE_WIDTH_PX, `wire legible at scale ${ts} (${wire}px)`);
    const ratio = wire / stroke;
    assert.ok(
      ratio > 0.7 && ratio < 3,
      `wire/symbol ratio should look like a schematic at scale ${ts}, got ${ratio.toFixed(2)}`
    );
  }
});

test("dropped components use the MSL standard size", () => {
  // 40 units is the box a standard MSL symbol occupies, and matches the
  // example diagrams; a different size makes dropped parts match neither the
  // examples nor the wire weight.
  assert.equal(C.MSL_COMPONENT_SIZE, 40, "standard MSL symbol box");
  assert.equal(C.defaultComponentSize(undefined), C.MSL_COMPONENT_SIZE);
  assert.equal(C.defaultComponentSize(classDef("M.R", { p: [-100, 0] })), C.MSL_COMPONENT_SIZE);
});

test("a dropped component's pins land on its own body for wiring", () => {
  const size = C.defaultComponentSize(classDef("M.R", { p: [-100, 0] }));
  const half = size / 2;
  const inst = {
    id: "r1", className: "M.R",
    placement: { extent: [-half, -half, half, half], rotation: 0, visible: true },
    params: {},
  };
  const p = C.portPosition(inst, DEFS["M.R"], "p");
  const n = C.portPosition(inst, DEFS["M.R"], "n");
  assert.deepEqual(p, [-half, 0], "pin p on the left edge");
  assert.deepEqual(n, [half, 0], "pin n on the right edge");
  // And the whole symbol is selectable, including across the pins.
  const model = emptyModel([inst]);
  for (const x of [-half, -half / 2, 0, half / 2, half]) {
    assert.ok(C.hitTestComponent(model, lookup, x, 0, 0), `selectable at x=${x}`);
  }
});

test("the click target tracks the drawn artwork, not the canonical box", () => {
  // MSL offsets its drawing inside the canonical box — a Resistor occupies only
  // the middle band, a Ground only the upper half. The target follows the
  // drawing, so a click lands where the user aimed rather than on invisible
  // empty space.
  const def = classDef("M.G", { p: [0, 0] });
  def.icon = [
    { kind: "Line", points: [-60, 50, 60, 50], color: [0, 0, 0] },
    { kind: "Line", points: [-40, 30, 40, 30], color: [0, 0, 0] },
    { kind: "Line", points: [-20, 10, 20, 10], color: [0, 0, 0] },
    { kind: "Line", points: [0, 50, 0, 90], color: [0, 0, 0] },
  ];
  const half = 20;
  const inst = {
    id: "g1", className: "M.G",
    placement: { extent: [-half, -half, half, half], rotation: 0, visible: true },
    params: {},
  };
  const model = emptyModel([inst]);
  const lookup2 = () => def;

  const hb = C.instanceHitBounds(inst, def);
  const outline = C.instanceOutlineBounds(inst, def);

  // The artwork sits in the upper half, so the target does too.
  assert.ok(hb[1] > -half, `target sits with the artwork, got y1=${hb[1]}`);
  // It is that artwork plus only a small margin.
  assert.ok(
    hb[0] >= outline[0] - 5 && hb[2] <= outline[2] + 5,
    "the target is the artwork with a small margin, not the whole extent"
  );

  // Clicking the drawn bars selects; clicking the empty lower half does not.
  assert.ok(C.hitTestComponent(model, lookup2, 0, 12, 0), "on the symbol selects");
  assert.equal(
    C.hitTestComponent(model, lookup2, 0, -18, 0),
    undefined,
    "empty space below the symbol does not select"
  );
});

test("every point of the target selects the component", () => {
  const def = classDef("M.R", { p: [-100, 0], n: [100, 0] });
  def.icon = [
    { kind: "Rectangle", extent: [-70, -30, 70, 30], lineColor: [0, 0, 0] },
    { kind: "Line", points: [-90, 0, -70, 0], color: [0, 0, 0] },
    { kind: "Line", points: [70, 0, 90, 0], color: [0, 0, 0] },
  ];
  const half = 20;
  const inst = {
    id: "r1", className: "M.R",
    placement: { extent: [-half, -half, half, half], rotation: 0, visible: true },
    params: {},
  };
  const model = emptyModel([inst]);
  const lookup2 = () => def;
  const hb = C.instanceHitBounds(inst, def);

  let hits = 0;
  let tries = 0;
  for (let x = hb[0]; x <= hb[2]; x += 0.5) {
    for (let y = hb[1]; y <= hb[3]; y += 0.5) {
      tries++;
      if (C.hitTestComponent(model, lookup2, x, y, 0)) hits++;
    }
  }
  assert.equal(hits, tries, `every point of the target selects (${hits}/${tries})`);
});

test("selection survives a component whose artwork is off-centre", () => {
  // The resistor case that motivated the fix: artwork biased downward.
  const def = classDef("M.R", { p: [-100, 0], n: [100, 0] });
  def.icon = [
    { kind: "Rectangle", extent: [-70, -100, 70, 0], lineColor: [0, 0, 0] },
    { kind: "Line", points: [-90, 0, -70, 0], color: [0, 0, 0] },
  ];
  const half = 20;
  const inst = {
    id: "r1", className: "M.R",
    placement: { extent: [-half, -half, half, half], rotation: 0, visible: true },
    params: {},
  };
  const model = emptyModel([inst]);
  const lookup2 = () => def;

  // The drawn body maps to the lower half; clicking its centre must select.
  for (const y of [-half / 2, -half / 4, 0]) {
    assert.ok(
      C.hitTestComponent(model, lookup2, 0, y, 0),
      `clicking the drawn body at y=${y} selects`
    );
  }
});

test("graphics with a conditional visible expression are not drawn", () => {
  // MSL writes `visible=useHeatPort` on a Resistor's heat-port lead, hidden by
  // default. Coercing the expression with Boolean() drew it always, which put a
  // red stub on every resistor.
  assert.equal(C.isGraphicVisible({ kind: "Line", points: [0, 0, 1, 1] }), true, "default is visible");
  assert.equal(C.isGraphicVisible({ kind: "Line", points: [0, 0, 1, 1], visible: true }), true);
  assert.equal(C.isGraphicVisible({ kind: "Line", points: [0, 0, 1, 1], visible: false }), false);
  // Any non-literal expression must NOT be drawn.
  for (const expr of ["useHeatPort", "useHeatPort or useThermalPort", "not useHeatPort"]) {
    assert.equal(
      C.isGraphicVisible({ kind: "Line", points: [0, 0, 1, 1], visible: expr }),
      false,
      `expression "${expr}" must not be drawn unconditionally`
    );
  }
});

test("wire weight tracks the component size at every zoom", () => {
  // The wire used to hold a 40px-based floor when zoomed out, so at 0.25x a
  // 10px component carried a 2.2px wire and the diagram looked like a blob of
  // blue. Weight now derives from the component's on-screen size.
  const strokePx = (z) => Math.max(1, Math.min(6, 1.5 * ((C.componentPx(z)) / 40)));

  for (const z of [0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8]) {
    const comp = C.componentPx(z);
    const wire = C.wireWidthPx(z);
    assert.ok(wire > 0, `zoom ${z}: wire has weight`);
    // The wire must never be a slab relative to the symbol it connects.
    assert.ok(
      wire <= comp * 0.2,
      `zoom ${z}: wire ${wire.toFixed(2)}px must not swamp a ${comp.toFixed(0)}px component`
    );
    const ratio = wire / strokePx(z);
    assert.ok(
      ratio >= 0.9 && ratio <= 2.0,
      `zoom ${z}: wire/symbol ratio should be nearly constant, got ${ratio.toFixed(2)}`
    );
  }
});

test("wire endpoints are anchored to live port positions", () => {
  // Stored waypoints can be stale after a component moves. The drawn wire must
  // start and end exactly on the pins, or a gap appears at the joint.
  const half = 20;
  const a = {
    id: "R1", className: "M.R",
    placement: { extent: [-100, -half, -60, half], rotation: 0, visible: true }, params: {},
  };
  const b = {
    id: "C1", className: "M.R",
    placement: { extent: [60, -half, 100, half], rotation: 0, visible: true }, params: {},
  };
  const from = C.portPosition(a, DEFS["M.R"], "n");
  const to = C.portPosition(b, DEFS["M.R"], "p");
  assert.deepEqual(from, [-60, 0]);
  assert.deepEqual(to, [60, 0]);

  // Mirroring the editor's connectionPoints: ends are replaced by the pins,
  // interior waypoints are kept.
  const stale = [999, 999, 555, 0, -999, -999];
  const pts = stale.slice();
  pts[0] = from[0];
  pts[1] = from[1];
  pts[pts.length - 2] = to[0];
  pts[pts.length - 1] = to[1];
  assert.deepEqual([pts[0], pts[1]], from, "wire starts on the source pin");
  assert.deepEqual([pts[pts.length - 2], pts[pts.length - 1]], to, "wire ends on the target pin");
});

test("ports are always drawn, and hidden only when too small to matter", () => {
  // Wiring used to be undiscoverable: pins were drawn only on hover, so you had
  // to already know where a connector was. Ports are now always drawn, with an
  // emphasised state for the selection and the wiring source.
  const calls = [];
  const ctx = new Proxy(
    {
      canvas: { width: 100, height: 100 },
      measureText: () => ({ width: 10 }),
    },
    {
      get(t, k) {
        if (k in t) return t[k];
        return (...args) => calls.push([k, ...args]);
      },
      set() {
        return true;
      },
    }
  );
  const arcRadii = () =>
    calls.filter((c) => c[0] === "arc").map((c) => c[3]);

  const def = classDef("M.R", { p: [-100, 0], n: [100, 0] });
  const half = 20;
  const inst = {
    id: "r1", className: "M.R",
    placement: { extent: [-half, -half, half, half], rotation: 0, visible: true },
    params: {},
  };
  const vp = { x: 0, y: 0, scale: 1 };

  // At a readable size, both pins are drawn.
  calls.length = 0;
  C.drawPorts(ctx, inst, def, vp, 1, undefined, { componentPx: 40 });
  assert.equal(arcRadii().length, 2, "both connectors drawn at rest");

  // The emphasisted state uses a larger ring.
  calls.length = 0;
  C.drawPorts(ctx, inst, def, vp, 1, undefined, { componentPx: 40, emphasised: true });
  const emphasised = arcRadii();
  calls.length = 0;
  C.drawPorts(ctx, inst, def, vp, 1, undefined, { componentPx: 40 });
  const rest = arcRadii();
  assert.ok(
    Math.max(...emphasised) > Math.max(...rest),
    "an emphasised component shows larger rings"
  );

  // Too small on screen: nothing is drawn, which would otherwise be noise.
  calls.length = 0;
  C.drawPorts(ctx, inst, def, vp, 1, undefined, { componentPx: 10 });
  assert.equal(arcRadii().length, 0, "no rings when the symbol is tiny");
});

test("a continuous stroke runs from every pin to the symbol body", () => {
  // MSL icons routinely stop short of their own connector: a Capacitor's lead
  // starts at canonical -90 while its pin is at -100. The wire correctly ends on
  // the pin, so the two did not meet and every run looked broken by a small gap.
  // This measures the drawn geometry rather than trusting the code path.
  const size = 40;
  const half = size / 2;

  function recordStrokes(def) {
    const lines = [];
    const ctx = new Proxy(
      { canvas: { width: 800, height: 600 }, measureText: () => ({ width: 10 }) },
      {
        get(t, k) {
          if (k in t) return t[k];
          return (...a) => {
            if (k === "moveTo") lines.push(["M", a[0], a[1]]);
            else if (k === "lineTo") lines.push(["L", a[0], a[1]]);
          };
        },
        set() {
          return true;
        },
      }
    );
    const inst = {
      id: "X", className: def.name,
      placement: { extent: [-half, -half, half, half], rotation: 0, visible: true },
      params: {},
    };
    C.drawComponent(ctx, inst, def, { x: 0, y: 0, scale: 1 }, 1, { lookup: () => def });

    const segs = [];
    let cur = null;
    for (const l of lines) {
      if (l[0] === "M") cur = [l[1], l[2]];
      else if (cur) {
        segs.push([cur[0], cur[1], l[1], l[2]]);
        cur = [l[1], l[2]];
      }
    }
    return { segs, inst };
  }

  // A symbol whose lead deliberately stops short of its pin, like the MSL.
  const def = classDef("M.C", { p: [-100, 0], n: [100, 0] });
  def.icon = [
    { kind: "Line", points: [-90, 0, -20, 0], color: [0, 0, 0] },
    { kind: "Line", points: [-20, -30, -20, 30], color: [0, 0, 0] },
    { kind: "Line", points: [20, -30, 20, 30], color: [0, 0, 0] },
    { kind: "Line", points: [20, 0, 90, 0], color: [0, 0, 0] },
  ];

  const { segs, inst } = recordStrokes(def);
  for (const port of ["p", "n"]) {
    const pin = C.portPosition(inst, def, port);
    const onPinLine = segs.filter(
      ([x1, y1, x2, y2]) => Math.abs(y1 - y2) < 1e-6 && Math.abs(y1 - pin[1]) < 1e-6
    );
    const xs = onPinLine.flatMap(([x1, , x2]) => [x1, x2]);
    assert.ok(
      xs.some((x) => Math.abs(x - pin[0]) < 1e-6),
      `a stroke must reach pin ${port} at x=${pin[0]} (got ${xs.join(",")})`
    );
  }

  // And the stroke must actually span the gap, not just touch the pin.
  const pin = C.portPosition(inst, def, "p");
  const spans = segs.filter(
    ([x1, y1, x2, y2]) =>
      Math.abs(y1 - pin[1]) < 1e-6 &&
      Math.abs(y2 - pin[1]) < 1e-6 &&
      Math.min(x1, x2) <= pin[0] + 1e-6
  );
  assert.ok(spans.length > 0, "the stub spans from the pin towards the body");
});

test("the visible selection box hugs the symbol, and its handles sit on it", () => {
  // The outline followed the drawn artwork while the resize handles used the
  // component's extent — two different boxes for one selection. On a Ground
  // (24-unit symbol inside a 40-unit box) the handles floated well outside the
  // symbol. Both must now come from the same bounds.
  const def = classDef("M.G", { p: [0, 0] });
  // Artwork deliberately smaller than the canonical box, like a Ground.
  def.icon = [
    { kind: "Line", points: [-60, 50, 60, 50], color: [0, 0, 0] },
    { kind: "Line", points: [-40, 30, 40, 30], color: [0, 0, 0] },
    { kind: "Line", points: [-20, 10, 20, 10], color: [0, 0, 0] },
    { kind: "Line", points: [0, 50, 0, 90], color: [0, 0, 0] },
  ];
  const half = 20;
  const inst = {
    id: "g1", className: "M.G",
    placement: { extent: [-half, -half, half, half], rotation: 0, visible: true },
    params: {},
  };

  const outline = C.instanceOutlineBounds(inst, def);
  // Canonical x -60..60 maps to -12..12 in a 40-unit box, and y 50..90 to 10..18
  // — but the artwork also includes the y=30 bar, so the box is y 2..18.
  assert.deepEqual(
    outline.map((v) => +v.toFixed(1)),
    [-12, 2, 12, 18],
    "the visible box is the artwork's own box"
  );
  assert.ok(
    outline[2] - outline[0] < 2 * half,
    "the visible box is smaller than the canonical extent"
  );

  // Handles are positioned from the same bounds.
  const pts = C.handlePoints(outline);
  assert.deepEqual(pts.nw.map((v) => +v.toFixed(1)), [-12, 2], "NW handle on the symbol");
  assert.deepEqual(pts.se.map((v) => +v.toFixed(1)), [12, 18], "SE handle on the symbol");

  // And the click target tracks that artwork, with only a small margin — not
  // the whole canonical box, which is invisible empty space.
  const hit = C.instanceHitBounds(inst, def);
  assert.ok(
    Math.abs(hit[1] - outline[1]) <= 5 && Math.abs(hit[3] - outline[3]) <= 5,
    `the click target sits on the symbol, got ${JSON.stringify(hit)}`
  );
  assert.ok(hit[3] - hit[1] < 2 * half, "the target is not the full canonical box");
});

test("resizing keeps the symbol's pins aligned with wires", () => {
  // Scaling a component must move its pins with it, or wires detach.
  const def = classDef("M.R", { p: [-100, 0], n: [100, 0] });
  const before = {
    id: "r1", className: "M.R",
    placement: { extent: [-20, -20, 20, 20], rotation: 0, visible: true }, params: {},
  };
  const after = {
    ...before,
    placement: { ...before.placement, extent: [-40, -40, 40, 40] },
  };
  const p1 = C.portPosition(before, def, "p");
  const p2 = C.portPosition(after, def, "p");
  assert.deepEqual(p1, [-20, 0], "pin on the small box");
  assert.deepEqual(p2, [-40, 0], "pin follows the resize, still on the edge");
});

test("symbols are sized so they fill their box, and the box matches the drawing", () => {
  // The root cause of imprecise selection: symbols were placed in a fixed box
  // regardless of how much of it they drew. A Resistor fills 30% of its
  // canonical +-100 box, so a fixed size rendered it small and left a large
  // invisible area — and the clickable region is the drawing.
  const cases = [
    // name, artwork w x h in canonical units
    ["R", 180, 60],
    ["C", 180, 56],
    ["G", 120, 80],
    ["B", 200, 200],
  ];
  for (const [name, w, h] of cases) {
    const def = classDef("M." + name, { p: [0, 0] });
    def.icon = [{ kind: "Rectangle", extent: [-w / 2, -h / 2, w / 2, h / 2], lineColor: [0, 0, 0] }];

    const size = C.defaultComponentSize(def);
    const ext = C.defaultExtent(def, 0, 0);
    const inst = {
      id: "x", className: def.name,
      placement: { extent: ext, rotation: 0, visible: true }, params: {},
    };
    const outline = C.instanceOutlineBounds(inst, def);
    const hit = C.instanceHitBounds(inst, def);

    // The largest dimension of the drawn symbol is the target size...
    const drawn = Math.max(outline[2] - outline[0], outline[3] - outline[1]);
    assert.ok(
      Math.abs(drawn - 28) < 1.5,
      `${name}: symbol should render near 28 units, got ${drawn.toFixed(1)}`
    );
    // ...the box keeps the artwork's aspect ratio, so nothing is stretched...
    const artAspect = w / h;
    const extAspect = (ext[2] - ext[0]) / (ext[3] - ext[1]);
    assert.ok(
      Math.abs(artAspect - extAspect) < 0.05,
      `${name}: box aspect ${extAspect.toFixed(2)} should match artwork ${artAspect.toFixed(2)}`
    );
    // ...and the clickable region is the drawing plus only a small margin.
    for (const [i, axis] of [[0, "x"], [1, "y"]]) {
      const over = Math.abs(hit[i] - outline[i]);
      const under = Math.abs(hit[i + 2] - outline[i + 2]);
      assert.ok(
        over <= 6 && under <= 6,
        `${name}: ${axis} margin should be small, got ${over.toFixed(1)} / ${under.toFixed(1)}`
      );
    }
  }
});

test("the click margin is a constant, not a fraction of the symbol", () => {
  // A proportional margin grew with the symbol and with zoom, which made the
  // offset more noticeable the further a component sat from the viewport origin.
  const def = classDef("M.R", { p: [0, 0] });
  def.icon = [{ kind: "Rectangle", extent: [-90, -30, 90, 30], lineColor: [0, 0, 0] }];
  const inst = {
    id: "r", className: "M.R",
    placement: { extent: [-11, -4, 11, 4], rotation: 0, visible: true }, params: {},
  };
  const outline = C.instanceOutlineBounds(inst, def);
  const hit = C.instanceHitBounds(inst, def);
  const padLeft = outline[0] - hit[0];
  const padTop = outline[1] - hit[1];
  assert.ok(padLeft <= 6, `left margin is bounded, got ${padLeft}`);
  assert.ok(padTop <= 6, `top margin is bounded, got ${padTop}`);
  // The margin must not scale with the symbol's size.
  const big = { ...inst, placement: { ...inst.placement, extent: [-22, -8, 22, 8] } };
  const bigOutline = C.instanceOutlineBounds(big, def);
  const bigHit = C.instanceHitBounds(big, def);
  assert.ok(
    Math.abs((bigOutline[0] - bigHit[0]) - padLeft) < 3,
    "the margin stays roughly constant as the symbol grows"
  );
});

test("screen-space overlays are drawn in device pixels, not scaled twice", () => {
  // The defect: bounds from `transformedBounds(viewportTransform(vp, dpr), ...)`
  // are already in DEVICE pixels, but they were drawn after `setTransform(dpr)`,
  // scaling them a second time. Everything drawn this way landed (dpr - 1) x its
  // position closer to the origin — an offset that grew with distance and with
  // zoom. The instance label and the diagnostic overlays were all affected.
  const def = classDef("M.R", { p: [-100, 0] });
  def.icon = [{ kind: "Rectangle", extent: [-90, -30, 90, 30], lineColor: [0, 0, 0] }];

  function render(scale, dpr) {
    const ext = C.defaultExtent(def, 0, 0);
    const inst = {
      id: "R1", className: "M.R",
      placement: { extent: ext, rotation: 0, visible: true }, params: {},
    };
    const vp = { x: 400, y: 300, scale };
    let m = [1, 0, 0, 1, 0, 0];
    const st = [];
    const mul = (a, b) => [
      a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
    ];
    const ap = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    let drawnLabelY = null;
    const ctx = {
      get canvas() { return { width: 9999, height: 9999 }; },
      setTransform(a, b, c, dd, e, f) { m = [a, b, c, dd, e, f]; },
      save() { st.push([...m]); },
      restore() { if (st.length) m = st.pop(); },
      translate(x, y) { m = mul(m, [1, 0, 0, 1, x, y]); },
      scale(x, y) { m = mul(m, [x, 0, 0, y, 0, 0]); },
      beginPath() {}, closePath() {}, stroke() {}, fill() {}, clip() {}, setLineDash() {},
      arc() {}, rect() {}, moveTo() {}, lineTo() {}, ellipse() {},
      fillRect() {}, strokeRect() {},
      fillText(t, x, y) { drawnLabelY = ap(x, y)[1]; },
      measureText() { return { width: 20 }; },
      quadraticCurveTo() {}, bezierCurveTo() {}, drawImage() {},
    };
    m = [dpr, 0, 0, dpr, 0, 0];
    C.drawComponent(ctx, inst, def, vp, dpr, { lookup: () => def });

    // Where the box bottom actually is, in the same device space.
    const boxBottom = C.transformedBounds(
      C.viewportTransform(vp, dpr),
      ...C.instanceOutlineBounds(inst, def)
    )[3];
    return { drawnLabelY, boxBottom };
  }

  for (const dpr of [1, 1.25, 1.5, 2]) {
    const offsets = [];
    for (const scale of [0.5, 1, 2, 4, 8]) {
      const { drawnLabelY, boxBottom } = render(scale, dpr);
      offsets.push(drawnLabelY - boxBottom);
    }
    for (const o of offsets) {
      assert.ok(
        Math.abs(o - 3) < 0.5,
        `dpr ${dpr}: the label must sit a constant 3 device px below the box, got ${offsets.map((v) => v.toFixed(1)).join(", ")}`
      );
    }
    // And crucially the offset must not drift with zoom — that drift was the bug.
    const spread = Math.max(...offsets) - Math.min(...offsets);
    assert.ok(spread < 0.5, `dpr ${dpr}: offset must be zoom-independent, spread ${spread.toFixed(2)}`);
  }
});

test("the drawn symbol and its clickable box occupy the same device pixels", () => {
  // The defect: `drawComponent` transforms every point to DEVICE pixels via `t`
  // (which includes the device pixel ratio), but drew them through a context
  // that also carried `dpr`. The graphics were therefore scaled by `dpr` a
  // second time relative to the boxes the interaction code computes, so the
  // selectable region was offset and mis-sized — worse the further a component
  // sat from the origin, and worse at higher zoom.
  const def = classDef("M.R", { p: [-100, 0], n: [100, 0] });
  def.icon = [
    { kind: "Rectangle", extent: [-70, 30, 70, -30], lineColor: [0, 0, 0] },
    { kind: "Line", points: [-90, 0, -70, 0], color: [0, 0, 0] },
    { kind: "Line", points: [70, 0, 90, 0], color: [0, 0, 0] },
  ];

  for (const dpr of [1, 1.25, 1.5, 2]) {
    for (const scale of [1, 3.432, 8]) {
      const scaleVp = { x: 564.6, y: 460.9, scale };
      // A component far from the origin, where a scale error is largest.
      const inst = {
        id: "R1", className: "M.R",
        placement: { extent: [-60, -20, -20, 20], rotation: 0, visible: true }, params: {},
      };

      // Record where the symbol is actually plotted, in device pixels, using a
      // context that honours save/restore like a real canvas.
      let m = [1, 0, 0, 1, 0, 0];
      const st = [];
      const pts = [];
      const mul = (a, b) => [
        a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
      ];
      const ap = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
      const ctx = {
        get canvas() { return { width: 9999, height: 9999 }; },
        setTransform(a, b, c, dd, e, f) { m = [a, b, c, dd, e, f]; },
        save() { st.push([...m]); },
        restore() { if (st.length) m = st.pop(); },
        translate(x, y) { m = mul(m, [1, 0, 0, 1, x, y]); },
        scale(x, y) { m = mul(m, [x, 0, 0, y, 0, 0]); },
        beginPath() {}, closePath() {}, stroke() {}, fill() {}, clip() {}, setLineDash() {},
        arc(x, y) { pts.push(ap(x, y)); },
        rect(x, y, w, h) { pts.push(ap(x, y), ap(x + w, y + h)); },
        moveTo(x, y) { pts.push(ap(x, y)); },
        lineTo(x, y) { pts.push(ap(x, y)); },
        ellipse(x, y, rx, ry) { pts.push(ap(x - rx, y - ry), ap(x + rx, y + ry)); },
        fillRect() {}, strokeRect() {}, fillText() {},
        measureText() { return { width: 20 }; },
        quadraticCurveTo() {}, bezierCurveTo() {}, drawImage() {},
      };

      // The context is left as `draw()` leaves it before drawing components.
      m = [dpr, 0, 0, dpr, 0, 0];
      C.drawComponent(ctx, inst, def, scaleVp, dpr, { lookup: () => def });

      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const inkCx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const inkCy = (Math.min(...ys) + Math.max(...ys)) / 2;

      const hb = C.transformedBounds(
        C.viewportTransform(scaleVp, dpr),
        ...C.instanceHitBounds(inst, def)
      );
      const boxCx = (hb[0] + hb[2]) / 2;
      const boxCy = (hb[1] + hb[3]) / 2;

      assert.ok(
        Math.abs(inkCx - boxCx) < 1 && Math.abs(inkCy - boxCy) < 1,
        `dpr ${dpr}, zoom ${scale}: symbol centre (${inkCx.toFixed(1)}, ${inkCy.toFixed(1)}) ` +
          `must match the clickable centre (${boxCx.toFixed(1)}, ${boxCy.toFixed(1)})`
      );
    }
  }
});

test("wire endpoints land on the pins the symbols draw", () => {
  // The defect: `drawConnection` transforms its points to DEVICE pixels via
  // `viewportTransform(vp, dpr)`, but stroked them while the context still
  // carried `dpr` from `draw()`. The wires were therefore scaled a second time
  // and no longer met the symbols — the circuit looked exploded, with wires
  // floating away from the components they connect.
  const def = classDef("M.R", { p: [-100, 0], n: [100, 0] });
  def.icon = [
    { kind: "Rectangle", extent: [-70, 30, 70, -30], lineColor: [0, 0, 0] },
    { kind: "Line", points: [-90, 0, -70, 0], color: [0, 0, 0] },
    { kind: "Line", points: [70, 0, 90, 0], color: [0, 0, 0] },
  ];
  const lookup2 = () => def;

  for (const dpr of [1, 1.25, 2]) {
    for (const scale of [1, 3.432]) {
      const vp = { x: 564.6, y: 460.9, scale };
      // Two components far from the origin, wired together.
      const a = { id: "A", className: "M.R",
        placement: { extent: [-141, -20, -101, 20], rotation: 0, visible: true }, params: {} };
      const b = { id: "B", className: "M.R",
        placement: { extent: [-81, -20, -41, 20], rotation: 0, visible: true }, params: {} };
      const model = emptyModel([a, b]);
      const pa = C.portPosition(a, def, "n");
      const pb = C.portPosition(b, def, "p");
      const pts = C.routeConnection(pa, pb);
      const conn = { from: { component: "A", port: "n" }, to: { component: "B", port: "p" } };

      // Record the segments the wire actually strokes, in device pixels.
      let m = [1, 0, 0, 1, 0, 0];
      const st = [];
      const segs = [];
      let cur = null;
      const mul = (x, y) => [
        x[0] * y[0] + x[2] * y[1], x[1] * y[0] + x[3] * y[1],
        x[0] * y[2] + x[2] * y[3], x[1] * y[2] + x[3] * y[3],
        x[0] * y[4] + x[2] * y[5] + x[4], x[1] * y[4] + x[3] * y[5] + x[5],
      ];
      const ap = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
      const ctx = {
        get canvas() { return { width: 9999, height: 9999 }; },
        setTransform(x1, x2, x3, x4, x5, x6) { m = [x1, x2, x3, x4, x5, x6]; },
        save() { st.push([...m]); },
        restore() { if (st.length) m = st.pop(); },
        translate(x, y) { m = mul(m, [1, 0, 0, 1, x, y]); },
        scale(x, y) { m = mul(m, [x, 0, 0, y, 0, 0]); },
        beginPath() { cur = null; },
        closePath() {}, stroke() {}, fill() {}, clip() {}, setLineDash() {},
        arc() {}, rect() {}, ellipse() {}, fillRect() {}, strokeRect() {}, fillText() {},
        moveTo(x, y) { cur = ap(x, y); },
        lineTo(x, y) { const p = ap(x, y); if (cur) segs.push([...cur, ...p]); cur = p; },
        measureText() { return { width: 20 }; },
        quadraticCurveTo() {}, bezierCurveTo() {}, drawImage() {},
      };
      // As `draw()` leaves it before drawing connections.
      m = [dpr, 0, 0, dpr, 0, 0];
      C.drawConnection(ctx, conn, pts, vp, dpr);

      // The pin positions in the same device space.
      const vt = C.viewportTransform(vp, dpr);
      const devA = C.apply(vt, pa[0], pa[1]);
      const devB = C.apply(vt, pb[0], pb[1]);
      const ends = segs.map((s) => ({ from: [s[0], s[1]], to: [s[2], s[3]] }));
      const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
      const best = (target) =>
        Math.min(...ends.flatMap((e) => [near(e.from, target), near(e.to, target)]));

      assert.ok(
        best(devA) < 1,
        `dpr ${dpr}, zoom ${scale}: the wire must start on pin A (${devA.map((v) => v.toFixed(0))}), nearest end was ${best(devA).toFixed(1)}px away`
      );
      assert.ok(
        best(devB) < 1,
        `dpr ${dpr}, zoom ${scale}: the wire must end on pin B (${devB.map((v) => v.toFixed(0))}), nearest end was ${best(devB).toFixed(1)}px away`
      );
    }
  }
});

test("selection handles and port rings are painted on the device-pixel box", () => {
  // Both functions transform their geometry to DEVICE pixels via
  // `viewportTransform(vp, dpr)` and then draw with the context left as `draw()`
  // sets it — carrying `dpr`. The results were scaled a second time, so the
  // resize handles floated off the selection outline and the port rings missed
  // their pins.
  const def = classDef("M.R", { p: [-100, 0], n: [100, 0] });
  def.icon = [{ kind: "Rectangle", extent: [-70, 30, 70, -30], lineColor: [0, 0, 0] }];
  const lookup2 = () => def;

  for (const dpr of [1, 1.25, 2]) {
    const vp = { x: 400, y: 300, scale: 2 };
    const inst = {
      id: "R1", className: "M.R",
      placement: { extent: [-81, -20, -41, 20], rotation: 0, visible: true }, params: {},
    };

    const painted = { rects: [], arcs: [], moves: [] };
    let m = [1, 0, 0, 1, 0, 0];
    const st = [];
    const mul = (a, b) => [
      a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
    ];
    const ap = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const ctx = {
      get canvas() { return { width: 9999, height: 9999 }; },
      setTransform(x1, x2, x3, x4, x5, x6) { m = [x1, x2, x3, x4, x5, x6]; },
      save() { st.push([...m]); },
      restore() { if (st.length) m = st.pop(); },
      translate(x, y) { m = mul(m, [1, 0, 0, 1, x, y]); },
      scale(x, y) { m = mul(m, [x, 0, 0, y, 0, 0]); },
      beginPath() {}, closePath() {}, stroke() {}, fill() {}, clip() {}, setLineDash() {},
      // Handles are drawn centred on the corner, so record the centre.
      rect(x, y, w, h) { const c = ap(x + w / 2, y + h / 2); painted.rects.push(c); },
      arc(x, y, r) { painted.arcs.push(ap(x, y)); },
      ellipse() {}, fillRect() {}, strokeRect() {}, fillText() {},
      moveTo(x, y) { painted.moves.push(ap(x, y)); },
      lineTo() {},
      measureText() { return { width: 20 }; },
      quadraticCurveTo() {}, bezierCurveTo() {}, drawImage() {},
    };

    // As `draw()` leaves the context before these are called.
    m = [dpr, 0, 0, dpr, 0, 0];
    C.drawHandles(ctx, inst, def, vp, dpr);
    C.drawPorts(ctx, inst, def, vp, dpr);

    // The box, in device pixels, that both must sit on.
    const vt = C.viewportTransform(vp, dpr);
    const box = C.transformedBounds(vt, ...C.instanceOutlineBounds(inst, def));
    const corner = C.handlePoints(box);

    // Eight handles, one per corner and edge midpoint.
    assert.equal(painted.rects.length, 8, `expected 8 handles, got ${painted.rects.length}`);
    const wanted = Object.values(corner).map((p) => [p[0], p[1]]);
    for (const got of painted.rects) {
      const nearest = Math.min(...wanted.map((w) => Math.hypot(got[0] - w[0], got[1] - w[1])));
      assert.ok(
        nearest < 0.01,
        `dpr ${dpr}: a handle is painted at (${got.map((v) => v.toFixed(1))}) which is ${nearest.toFixed(1)}px from any outline corner`
      );
    }

    // Two ports, each on its pin.
    assert.equal(painted.arcs.length, 2, `expected 2 port rings, got ${painted.arcs.length}`);
    for (const name of ["p", "n"]) {
      const pos = C.portPosition(inst, def, name);
      const dev = C.apply(vt, pos[0], pos[1]);
      const nearest = Math.min(
        ...painted.arcs.map((a) => Math.hypot(a[0] - dev[0], a[1] - dev[1]))
      );
      assert.ok(
        nearest < 0.01,
        `dpr ${dpr}: the ring for ${name} is ${nearest.toFixed(1)}px from its pin at (${dev.map((v) => v.toFixed(1))})`
      );
    }
  }
});

test("diagram colours follow the light and dark themes", () => {
  // The diagram is drawn with the 2D canvas API, which cannot read CSS
  // variables, so its palette has to be supplied explicitly. Every colour was
  // a literal chosen for a light background: in the dark theme the symbols were
  // near-black on near-black and the wires were a dark navy that disappeared —
  // while the plot beside them switched correctly. That inconsistency is what
  // this pins.
  const original = globalThis.document;
  const setTheme = (dark) => {
    globalThis.document = {
      body: { classList: { contains: (c) => dark && c === "theme-dark" } },
    };
  };

  try {
    const seen = {};
    for (const dark of [false, true]) {
      setTheme(dark);
      const theme = T.currentTheme();
      assert.equal(theme.dark, dark, `theme detection for dark=${dark}`);

      // Modelica's implicit black means "ink" and white means "no fill". Both
      // must resolve against the theme: dark ink on a dark background is the
      // bug, and so is a white fill that is not the surface colour.
      const ink = T.themedColor([0, 0, 0], theme, "stroke");
      const fill = T.themedColor([255, 255, 255], theme, "fill");
      const isDarkInk = ink[0] < 128;
      assert.equal(
        isDarkInk,
        !dark,
        `dark=${dark}: implicit black must resolve to ${dark ? "light" : "dark"} ink, got ${JSON.stringify(ink)}`
      );
      const surface = theme.background.match(/(\d+)\D+(\d+)\D+(\d+)/).slice(1).map(Number);
      assert.deepEqual(
        fill,
        surface,
        `dark=${dark}: an implicit white fill must become the theme surface`
      );

      // On the light theme nothing is altered: the diagram is exactly what the
      // library asked for.
      if (!dark) {
        assert.deepEqual(T.themedColor([255, 0, 0], theme, "stroke"), [255, 0, 0]);
        assert.deepEqual(T.themedColor([0, 0, 255], theme, "stroke"), [0, 0, 255]);
        assert.deepEqual(T.themedColor([75, 138, 73], theme, "stroke"), [75, 138, 73]);
      }

      // Ink and the background must be clearly distinguishable.
      const lum = (c) => {
        const f = (v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
      };
      const parse = (s) => s.match(/(\d+)\D+(\d+)\D+(\d+)/).slice(1).map(Number);
      const ratio = (a, b) => {
        const l1 = Math.max(lum(a), lum(b));
        const l2 = Math.min(lum(a), lum(b));
        return (l1 + 0.05) / (l2 + 0.05);
      };
      const bg = parse(theme.background);
      assert.ok(ratio(ink, bg) > 7, `dark=${dark}: ink contrast was ${ratio(ink, bg).toFixed(1)}:1`);
      assert.ok(
        ratio(theme.wire, bg) > 4.5,
        `dark=${dark}: wire contrast was ${ratio(theme.wire, bg).toFixed(1)}:1`
      );
      seen[dark] = theme;
    }

    // The two themes must actually differ, or one of them is unused.
    assert.notEqual(seen[false].background, seen[true].background);
    assert.notDeepEqual(seen[false].series, seen[true].series);
  } finally {
    globalThis.document = original;
  }
});


test("stated colours stay legible on the dark theme without losing their hue", () => {
  // MSL states its colours explicitly and they are semantic, not decorative:
  // blue outlines electrical and block diagrams, green mechanical, red thermal.
  // Drawing them literally left dark navy outlines invisible on the dark canvas,
  // but replacing them with one flat ink colour would destroy the colour coding.
  // They are therefore lightened along their own hue, and only when illegible.
  const original = globalThis.document;
  globalThis.document = { body: { classList: { contains: () => true } } }; // dark
  try {
    const theme = T.currentTheme();
    assert.equal(theme.dark, true);

    const lum = (c) => {
      const f = (v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const bg = theme.background.match(/(\d+)\D+(\d+)\D+(\d+)/).slice(1).map(Number);
    const ratio = (a, b) => {
      const l1 = Math.max(lum(a), lum(b));
      const l2 = Math.min(lum(a), lum(b));
      return (l1 + 0.05) / (l2 + 0.05);
    };

    // MSL's actual palette, by frequency of use across the shipped libraries.
    const stated = [
      [0, 0, 255],   // electrical / block outlines
      [0, 0, 127],   // block diagram navy
      [75, 138, 73], // mechanical green
      [191, 0, 0],   // thermal red
      [0, 127, 0],
      [255, 0, 255],
    ];
    for (const c of stated) {
      const out = T.themedColor(c, theme, "stroke");
      assert.ok(
        ratio(out, bg) >= 3,
        `${JSON.stringify(c)} became ${JSON.stringify(out)} at only ${ratio(out, bg).toFixed(2)}:1`
      );
      // The dominant channel must survive: a blue stays blue.
      const dominant = (v) => v.indexOf(Math.max(...v));
      assert.equal(
        dominant(out),
        dominant(c),
        `${JSON.stringify(c)} lost its hue, became ${JSON.stringify(out)}`
      );
    }

    // Already-legible colours are left exactly as written.
    assert.deepEqual(T.themedColor([255, 0, 255], theme, "stroke"), [255, 0, 255]);
  } finally {
    globalThis.document = original;
  }
});
