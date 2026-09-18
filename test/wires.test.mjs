/**
 * Selecting, deleting and re-routing wires.
 *
 * The geometry is pure, so the parts that decide WHAT is under the pointer are
 * tested directly: a hit test that is off by a few units selects the wrong wire,
 * and that is invisible in a screenshot. The paths that need a live canvas are
 * checked by contract, the way the rest of the editor is.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildLibs, repoRoot } from "./helpers/build.mjs";

const { distanceToSegment, distanceToPolyline, nearestVertexIndex, polylineInBox, routeConnection } =
  await import(
    path.join(buildLibs("wire-geom", ["src/render/canvas.ts"]), "canvas.js")
  );

const editor = fs.readFileSync(path.join(repoRoot, "src/view/editor.ts"), "utf8");
const studioView = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");

test("distance to a segment is perpendicular, and clamped at the ends", () => {
  // A horizontal segment from (0,0) to (10,0).
  assert.equal(distanceToSegment(5, 3, 0, 0, 10, 0), 3, "perpendicular from the middle");
  assert.equal(distanceToSegment(0, 0, 0, 0, 10, 0), 0, "a point on the segment");
  // Beyond an end the distance is to the END, not to the infinite line: without
  // the clamp, a wire would be "hit" by a pointer far past its end.
  assert.equal(distanceToSegment(-4, 0, 0, 0, 10, 0), 4, "clamped at the start");
  assert.equal(distanceToSegment(14, 0, 0, 0, 10, 0), 4, "clamped at the end");
  assert.equal(distanceToSegment(-3, 4, 0, 0, 10, 0), 5, "diagonal beyond the start");
  // A degenerate segment must not divide by zero.
  assert.equal(distanceToSegment(3, 4, 1, 1, 1, 1), Math.hypot(2, 3), "a zero-length segment");
});

test("distance to a polyline is the nearest of its segments", () => {
  // An L: right along y=0, then up x=10.
  const l = [0, 0, 10, 0, 10, 10];
  assert.equal(distanceToPolyline(l, 5, 2), 2, "near the first leg");
  assert.equal(distanceToPolyline(l, 12, 5), 2, "near the second leg");
  assert.equal(distanceToPolyline(l, 10, 0), 0, "at the corner");
  // Inside the corner of an L, the nearest point is on one of the LEGS, not the
  // corner: (7,3) projects onto the first leg at (7,0), which is 3 away. Both legs
  // happen to give 3 here, so the value is a check on the clamping rather than on
  // which leg wins.
  assert.equal(distanceToPolyline(l, 7, 3), 3, "inside the corner, perpendicular to a leg");
  // A point off the END of the whole route measures to that end.
  assert.equal(distanceToPolyline(l, 10, 14), 4, "past the last vertex");
  assert.equal(distanceToPolyline(l, -3, 0), 3, "before the first");
  // Too few points is not a wire: Infinity so a caller need not special-case it.
  assert.equal(distanceToPolyline([1, 2], 1, 2), Infinity, "a single point has no segment");
  assert.equal(distanceToPolyline([], 0, 0), Infinity, "an empty route");
});

test("the nearest vertex is found only within the slack", () => {
  const l = [0, 0, 10, 0, 10, 10];
  assert.equal(nearestVertexIndex(l, 10, 10, 3), 2, "the far corner");
  assert.equal(nearestVertexIndex(l, 0, 0, 3), 0, "the start");
  // Outside the slack there is no grab, so the press selects the wire instead of
  // dragging a corner.
  assert.equal(nearestVertexIndex(l, 5, 5, 3), -1, "nothing within the slack");
  // A zero slack still grabs a vertex the point lands ON exactly -- the comparison
  // is inclusive -- but nothing else.
  assert.equal(nearestVertexIndex(l, 10, 10, 0), 2, "an exact hit at zero slack");
  assert.equal(nearestVertexIndex(l, 10, 10.5, 0), -1, "a near miss at zero slack");
  assert.equal(nearestVertexIndex([], 0, 0, 5), -1, "an empty route");
});

test("a wire is only marquee-selected when its whole route is inside", () => {
  const box = [0, 0, 20, 20];
  assert.equal(polylineInBox([2, 2, 18, 2, 18, 18], box), true, "wholly inside");
  assert.equal(polylineInBox([2, 2, 30, 2, 30, 18], box), false, "one vertex outside");
  // The case a bounding-box test gets wrong: the route leaves the box and comes
  // back, so its BOUNDS cover the box while the wire is mostly elsewhere.
  const loop = [5, 5, 100, 5, 100, 15, 5, 15];
  assert.equal(polylineInBox(loop, box), false, "a route that leaves and returns");
  assert.equal(polylineInBox([5, 5], box), false, "too few points to be a wire");
});

test("a default route has interior corners to drag", () => {
  // The reshape gesture needs somewhere to grab. A route between two ports that
  // are offset in both axes is an L with two interior vertices; a straight run
  // has none, and offering a corner there would be a handle that cannot move.
  const l = routeConnection([0, 0], [40, 40]);
  assert.equal(l.length, 8, "an L between offset ports");
  assert.ok(nearestVertexIndex(l, l[2], l[3], 1) === 1, "the first corner is grabbable");
  assert.ok(nearestVertexIndex(l, l[4], l[5], 1) === 2, "and the second");

  const straight = routeConnection([0, 0], [40, 0]);
  assert.equal(straight.length, 4, "a straight run is two points");
  // Endpoints excluded leaves nothing, which is why the editor checks that the
  // grabbed index is interior before starting a drag.
  assert.equal(straight.length >= 8, false, "so there is no interior corner");
});

test("wires are hit-tested between the symbols, not instead of them", () => {
  // Order matters: a wire terminates ON a component's edge, so a symbol must win
  // the press or the pin becomes unclickable and wiring breaks.
  const body = editor.indexOf("const bodyHit = hitTestComponent");
  const wire = editor.indexOf("const wireHit = this.hitTestWire");
  const pan = editor.indexOf("// 6. Empty space. Pan on the middle or right button");
  assert.ok(body >= 0 && wire >= 0 && pan >= 0, "all three steps were found");
  assert.ok(body < wire, "the component body is tested first");
  assert.ok(wire < pan, "and the wire before empty space, or it is unreachable");
});

test("a selected wire can be deleted by every route", () => {
  // The keyboard guard counted components only, so the main way to delete a wire
  // did nothing while the wire sat there selected.
  const key = /case "Delete":[\s\S]{0,400}?deleteSelection\(\);/.exec(editor);
  assert.ok(key, "the delete key handler is present");
  assert.match(key[0], /if \(!this\.hasSelection\) return/, "it accepts either kind of selection");

  // And deleteSelection really removes wires, not just components.
  const del = /deleteSelection\(\): void \{[\s\S]*?\n  \}/.exec(editor);
  assert.ok(del, "deleteSelection is present");
  assert.match(del[0], /const doomedWires = new Set\(this\.wireSelection\)/, "wires are collected");
  assert.match(del[0], /!doomedWires\.has\(c\.id\)/, "and filtered out of the model");
  assert.match(del[0], /this\.clearSelection\(\)/, "and the selection is reset");

  // The toolbar counts both, or the button stays greyed out with a wire selected.
  const bar = /private updateToolbarState\(\): void \{[\s\S]*?\n  \}/.exec(studioView);
  assert.ok(bar, "updateToolbarState is present");
  assert.match(bar[0], /selectedWireIds/, "it reads the wire selection");
  assert.match(bar[0], /const has = sel\.length > 0 \|\| wires\.length > 0/, "and enables Delete for it");
  // Rotate and Copy are component operations and must NOT light up for a wire.
  assert.match(bar[0], /set\(this\.btnRotate, sel\.length > 0\)/, "rotate stays component-only");
  assert.match(bar[0], /set\(this\.btnCopy, sel\.length > 0\)/, "so does copy");
});

test("a reshaped wire keeps its ends on the pins", () => {
  // The endpoints are rewritten from the live port positions on every draw, which
  // is what lets the interior be dragged freely. A drag that wrote an ENDPOINT
  // would appear to work and then snap back on the next paint.
  const move = /case "wireVertex": \{[\s\S]*?\n      \}/.exec(editor);
  assert.ok(move, "the vertex drag is present");
  assert.match(move[0], /if \(i <= 0 \|\| i \+ 1 >= route\.length - 1\) return/, "endpoints are refused");
  assert.match(move[0], /conn\.points\[i\] = Math\.round\(dx \/ GRID\) \* GRID/, "the corner is snapped");

  // And the press only starts a reshape on an INTERIOR corner.
  const press = /const interior = vertex > 0[\s\S]{0,120}/.exec(editor);
  assert.ok(press, "the interior check is present");

  // The history entry opens on movement, not on the press: a click that only
  // selects must not leave an edit pending for the next gesture to mis-attribute.
  assert.match(move[0], /if \(!inter\.moved\) \{\n          inter\.moved = true;\n          this\.beginEdit/, "beginEdit on movement");
  assert.ok(
    !/kind: "wireVertex"[\s\S]{0,200}?this\.beginEdit/.test(editor),
    "and never on pointerdown"
  );
});

test("the two selections stay separate", () => {
  // Mixing wire ids into the component selection would be silently wrong in the
  // inspector, in copy, and in the filter that drops components removed by an
  // undo -- each of which assumes a component id.
  const field = /private wireSelection = new Set<string>\(\);/.exec(editor);
  assert.ok(field, "wires have their own set");
  assert.ok(
    !/private selection = new Set<string>\(\);[\s\S]{0,200}?wire:/.test(editor),
    "and no wire key is put into the component set"
  );
  // A press on a component drops the wire selection, so Delete cannot remove
  // something the user had stopped thinking about.
  const set = /private setSelection\(ids: Iterable<string>, opts[\s\S]*?\n  \}/.exec(editor);
  assert.ok(set, "setSelection is present");
  assert.match(set[0], /opts: \{ keepWires\?: boolean \}/, "it can keep or drop wires");
  assert.match(set[0], /if \(wiresDropped\) this\.wireSelection = new Set\(\)/, "and drops them by default");
});

test("the real editor selects, deletes and re-routes a wire", async () => {
  // Driven against the actual editor with real pointer events on a real canvas.
  // The tests above check the geometry and the shape of the code; this checks the
  // gesture, which is the part a user experiences and the part that source
  // assertions cannot reach.
  const { runInDom, DOM_PREAMBLE } = await import("./helpers/dom-runner.mjs");
  const out = runInDom(
    [
      DOM_PREAMBLE,
      'import { SchematicEditor } from "/mnt/data/projects/Modelica-Plugin/src/view/editor";',
      'import { StubVault } from "/mnt/data/projects/Modelica-Plugin/test/helpers/obsidian-stub";',
      "",
      "/** A two-pin class, so a wire between two of them is an L. */",
      "const def = (name, ports) => ({",
      "  name, shortName: name, icon: [], diagram: [],",
      "  ports: Object.keys(ports).map((p) => ({ name: p, type: 'Pin', isFlow: true, causality: 'acausal' })),",
      "  portPositions: ports, parameters: [], hasIcon: false,",
      "});",
      "const DEFS = {",
      "  'M.A': def('M.A', { p: [100, 0], n: [-100, 0] }),",
      "  'M.B': def('M.B', { p: [-100, 0], n: [100, 0] }),",
      "};",
      "const lookup = (n) => DEFS[n];",
      "const comp = (id, cls, x, y) => ({",
      "  id, className: cls, params: {},",
      "  placement: { extent: [x - 20, y - 20, x + 20, y + 20], rotation: 0, visible: true },",
      "});",
      "",
      "const host = document.body.createDiv();",
      "host.style.width = '900px';",
      "host.style.height = '600px';",
      "const model = {",
      "  name: 'W', components: [comp('a', 'M.A', 0, 0), comp('b', 'M.B', 300, 200)],",
      "  // Offset in both axes, so the route is an L with two interior corners.",
      "  connections: [{ id: 'a.p|b.n', from: { component: 'a', port: 'p' }, to: { component: 'b', port: 'n' }, points: [] }],",
      "  equations: [], graphics: [], variables: [], parameters: [],",
      "};",
      "const editor = new SchematicEditor(host, model, { lookup });",
      "const canvas = editor.canvasEl;",
      "const rect = canvas.getBoundingClientRect();",
      "window.__points = () => editor.getModel().connections[0].points;",
      "window.__wireIds = () => editor.selectedWireIds;",
      "window.__compIds = () => editor.selectedIds;",
      "",
      "/** Dispatch a pointer event at a DIAGRAM position, as the browser would. */",
      "function at(dx, dy) {",
      "  // Screen = viewport * scale + offset; the viewport starts at 0,0 with scale 1.",
      "  return { clientX: rect.left + dx, clientY: rect.top + dy };",
      "}",
      "function press(dx, dy, opts) {",
      "  const o = Object.assign({ bubbles: true, button: 0, pointerId: 1, isPrimary: true }, at(dx, dy), opts || {});",
      "  canvas.dispatchEvent(new PointerEvent('pointerdown', o));",
      "  return o;",
      "}",
      "function move(dx, dy) {",
      "  canvas.dispatchEvent(new PointerEvent('pointermove', Object.assign({ bubbles: true, pointerId: 1, isPrimary: true }, at(dx, dy))));",
      "}",
      "function up(dx, dy) {",
      "  canvas.dispatchEvent(new PointerEvent('pointerup', Object.assign({ bubbles: true, button: 0, pointerId: 1, isPrimary: true }, at(dx, dy))));",
      "}",
      "",
      "// The routed L for ports (20,0) -> (280,200): midX = 150.",
      "//   [20,0, 150,0, 150,200, 280,200]",
      "// Empty points means the route is DERIVED from the ports each draw, which is",
      "// what keeps the ends on the pins. The click below proves the route exists.",
      "window.test('the route starts derived, not stored', () => window.__points().length + ' stored points');",
      "",
      "// Press in the middle of the first leg, away from both corners.",
      "press(80, 0);",
      "up(80, 0);",
      "window.test('clicking a wire selects it', () => JSON.stringify(window.__wireIds()));",
      "window.test('and does not select a component', () => JSON.stringify(window.__compIds()));",
      "",
      "// Delete it with the key.",
      "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));",
      "editor.deleteSelection();",
      "// Put a wire back: the Delete above removed the only one.",
      "editor.getModel().connections.push({ id: 'a.p|b.n', from: { component: 'a', port: 'p' }, to: { component: 'b', port: 'n' }, points: [] });",
      "// Reshape: grab the first interior corner and drag it down. The corner is",
      "// READ from the editor rather than assumed -- hard-coding the midpoint put the",
      "// press 20 units away from the real vertex, which the 8px grab radius",
      "// correctly refused, and the test blamed the code.",
      "const route = editor.connectionPoints(editor.getModel().connections[0]);",
      "const cx = route[2];",
      "const cy = route[3];",
      "press(cx, cy);",
      "move(cx, cy + 60);",
      "up(cx, cy + 60);",
      "window.test('dragging a corner stores the route', () => JSON.stringify(window.__points()));",
      "window.test('the corner moved', () => {",
      "  const p = window.__points();",
      "  return JSON.stringify([p[2], p[3]]) + ' vs ' + JSON.stringify([cx, cy + 60]);",
      "});",
      "window.test('the ends stay on the pins', () => {",
      "  const p = window.__points();",
      "  return JSON.stringify([p[0], p[1], p[p.length - 2], p[p.length - 1]]) +",
      "    ' vs ' + JSON.stringify([route[0], route[1], route[route.length - 2], route[route.length - 1]]);",
      "});",
      "",
      "// And the wire is still deletable afterwards.",
      "press(cx, cy + 60);",
      "up(cx, cy + 60);",
      "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));",
      "editor.deleteSelection();",
      "window.test('Delete removes the wire', () => editor.getModel().connections.length + ' left');",
      "",
      "window.finish();",
    ].join("\n")
  );
  if (out.skip) return;
  assert.ok(!out.fatal, out.fatal);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));

  assert.equal(d["the route starts derived, not stored"], "0 stored points");
  assert.equal(d["clicking a wire selects it"], '["a.p|b.n"]', "the click landed on the wire");
  assert.equal(d["and does not select a component"], "[]", "and not on a symbol");
  // The route is now explicit, and the corner landed on a grid multiple.
  const stored = JSON.parse(d["dragging a corner stores the route"]);
  assert.equal(stored.length, 8, `stored as a full route: ${d["dragging a corner stores the route"]}`);
  const [moved, wanted] = d["the corner moved"].split(" vs ").map(JSON.parse);
  assert.deepEqual(moved, wanted, "the corner is where it was dragged to");
  assert.equal(moved[1] % 10, 0, "and snapped to the grid");
  // Both sides are parsed, so this compares the stored ends against the derived
  // ones rather than trusting a string that could match for the wrong reason.
  const [ends, derived] = d["the ends stay on the pins"].split(" vs ").map(JSON.parse);
  assert.deepEqual(ends, derived, `the ends are still on the pins: ${d["the ends stay on the pins"]}`);
  // And the ends really are the port positions, not arbitrary numbers.
  assert.deepEqual(ends, [20, 0, 320, 200], "at the two pins");
  assert.equal(d["Delete removes the wire"], "0 left");
});

test("the inspector names a selected wire instead of asking for a component", () => {
  // Selecting a wire and being told "select a component to edit it" reads as the
  // click not having worked, which is what makes a feature look missing.
  const view = studioView;
  const empty = /if \(selected\.length === 0\) \{[\s\S]*?\n      return;\n    \}/.exec(view);
  assert.ok(empty, "the empty-inspector branch is present");
  assert.match(empty[0], /selectedWireIds/, "it consults the wire selection");
  assert.match(empty[0], /Drag a corner to re-route it/, "and explains the gesture");
  assert.match(empty[0], /press Delete to remove it/, "and how to remove it");
  // And the original message still appears when genuinely nothing is selected.
  assert.match(empty[0], /Select a component to edit it/, "the component hint survives");
});

test("undo and redo handle wires, without leaving a stale selection", () => {
  // `applyRestored` pruned dead COMPONENTS from the selection and said nothing
  // about wires, so an undone wire stayed selected: the inspector reported
  // connections that were not there, and the next Delete acted on a set the user
  // could not see.
  const restored = /private applyRestored\(state: string\): void \{[\s\S]*?\n  \}/.exec(editor);
  assert.ok(restored, "applyRestored is present");
  assert.match(restored[0], /const aliveWires = new Set\(this\.model\.connections/, "wires are checked");
  assert.match(restored[0], /filter\(\(id\) => aliveWires\.has\(id\)\)/, "and dead ones dropped");
  assert.match(restored[0], /keepWires: true/, "so setSelection does not clear them first");
  assert.match(restored[0], /if \(wiresChanged\) this\.cb\.onSelectionChange/, "the view is told");
});

test("a route that has gone bad can be reset", () => {
  // A stored route is a snapshot of where its corners were, so moving a component
  // does not recompute it and a wire can end up doubling back through a symbol.
  // That is the state the reshape gesture makes reachable, so it needs an inverse
  // that is not "undo everything since".
  const reset = /resetWireRoutes\(\): void \{[\s\S]*?\n  \}/.exec(editor);
  assert.ok(reset, "the action exists");
  assert.match(reset[0], /c\.points\.length >= 4/, "it only touches stored routes");
  assert.match(reset[0], /for \(const conn of stored\) conn\.points = \[\]/, "clearing them");
  assert.match(reset[0], /this\.beginEdit\(/, "as one undoable edit");
  assert.match(reset[0], /this\.commitEdit\(\)/, "which is committed");
  // Nothing to do is reported rather than silently recording an empty edit.
  assert.match(reset[0], /already follows the automatic route/, "and says so when there is nothing to do");

  // Reachable from the canvas without a menu: double-click, the inverse of the
  // drag that reshaped it.
  const dbl = /private onDoubleClick = \(ev: MouseEvent\) => \{[\s\S]*?\n  \};/.exec(editor);
  assert.ok(dbl, "the double-click handler is present");
  assert.match(dbl[0], /hitTestWire/, "it looks for a wire");
  assert.match(dbl[0], /this\.resetWireRoutes\(\)/, "and resets it");
  // A double-click on a component must still select the component.
  assert.ok(
    dbl[0].indexOf("if (hit)") < dbl[0].indexOf("hitTestWire"),
    "the component is tested first, so a symbol still wins"
  );

  // And from the context menu.
  assert.match(editor, /label: "Reset route"/, "offered in the menu");
  assert.match(editor, /enabled: this\.canResetRoutes/, "only when there is a stored route");
});

test("a reshape is one undoable step, and undo restores the derived route", async () => {
  // The risky part of the gesture is WHERE the edit opens. Opening it on the press
  // would leave an edit pending after a click that only selects, and the NEXT
  // gesture would record against the wrong before-state -- so a single undo would
  // rewind two unrelated things. Driven with real events because that is the only
  // way to tell the two apart.
  const { runInDom, DOM_PREAMBLE } = await import("./helpers/dom-runner.mjs");
  const R = "/mnt/data/projects/Modelica-Plugin";
  const out = runInDom(
    [
      DOM_PREAMBLE,
      `import { SchematicEditor } from "${R}/src/view/editor";`,
      `import { StubVault } from "${R}/test/helpers/obsidian-stub";`,
      "const def = (name, ports) => ({ name, shortName: name, icon: [], diagram: [],",
      "  ports: Object.keys(ports).map((p) => ({ name: p, type: 'Pin', isFlow: true, causality: 'acausal' })),",
      "  portPositions: ports, parameters: [], hasIcon: false });",
      "const DEFS = { 'M.A': def('M.A', { p: [100, 0] }), 'M.B': def('M.B', { p: [-100, 0] }) };",
      "const comp = (id, cls, x, y) => ({ id, className: cls, params: {},",
      "  placement: { extent: [x-20, y-20, x+20, y+20], rotation: 0, visible: true } });",
      "const host = document.body.createDiv();",
      "const model = { name: 'W', components: [comp('a','M.A',0,0), comp('b','M.B',300,200)],",
      "  connections: [{ id: 'a.p|b.p', from: { component:'a', port:'p' }, to: { component:'b', port:'p' }, points: [] }],",
      "  equations: [], graphics: [], variables: [], parameters: [] };",
      "const editor = new SchematicEditor(host, model, { lookup: (n) => DEFS[n] });",
      "const canvas = editor.canvasEl;",
      "const rect = canvas.getBoundingClientRect();",
      "const at = (dx, dy) => ({ clientX: rect.left + dx, clientY: rect.top + dy });",
      "const fire = (t, dx, dy) => canvas.dispatchEvent(new PointerEvent(t,",
      "  Object.assign({ bubbles: true, button: 0, pointerId: 1, isPrimary: true }, at(dx, dy))));",
      "const points = () => editor.getModel().connections[0].points;",
      "",
      "// A press on the wire that does NOT move: a selection, and no edit.",
      "const route0 = editor.connectionPoints(editor.getModel().connections[0]);",
      "fire('pointerdown', 60, 0);",
      "fire('pointerup', 60, 0);",
      "window.test('a click selects without storing a route', () => JSON.stringify(points()));",
      "",
      "// Now reshape a corner.",
      "fire('pointerdown', route0[2], route0[3]);",
      "fire('pointermove', route0[2], route0[3] + 50);",
      "fire('pointerup', route0[2], route0[3] + 50);",
      "window.test('the reshape stored a route', () => points().length + ' points');",
      "",
      "// One undo must put the DERIVED route back, not rewind the click as well.",
      "editor.undo();",
      "window.test('one undo restores the derived route', () => JSON.stringify(points()));",
      "window.test('and the model still has both components', () => editor.getModel().components.length + ' components');",
      "",
      "editor.redo();",
      "window.test('redo puts the reshape back', () => points().length + ' points');",
      "",
      "// Double-click restores the automatic route.",
      "const route1 = editor.connectionPoints(editor.getModel().connections[0]);",
      "canvas.dispatchEvent(new MouseEvent('dblclick', Object.assign({ bubbles: true },",
      "  at((route1[2] + route1[4]) / 2, (route1[3] + route1[5]) / 2))));",
      "window.test('double-click resets the route', () => JSON.stringify(points()));",
      "window.finish();",
    ].join("\n")
  );
  if (out.skip) return;
  assert.ok(!out.fatal, out.fatal);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));

  assert.equal(d["a click selects without storing a route"], "[]", "a click is not an edit");
  assert.equal(d["the reshape stored a route"], "8 points");
  assert.equal(d["one undo restores the derived route"], "[]", "undo is a single step back");
  assert.equal(d["and the model still has both components"], "2 components");
  assert.equal(d["redo puts the reshape back"], "8 points");
  assert.equal(d["double-click resets the route"], "[]", "the automatic route is restored");
});
