/**
 * The variable list as a tree: the rules, without a DOM.
 *
 * The list the reader searches is a flat set of result names — `chopper.diode.i`,
 * `der(capacitor.v)` — and everything about how it is organised (what nests under
 * what, what opens on sight, what a filter keeps) is decided here. Testing it
 * through the DOM would test the renderer and the rules at once and blame the
 * wrong one; the rules are a pure function of the names, so they are tested as
 * one, the way `series.ts` is.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";

const LIB = buildLibs("series-tree-lib", ["src/view/series-tree.ts"]);
const {
  buildTraceTree,
  traceSegments,
  traceRows,
  traceCounts,
  initialOpenPaths,
  allGroupPaths,
} = await import(path.join(LIB, "series-tree.js"));

/** Every group open, for testing the shape of the tree itself. */
const allOpen = (tree) => ({ expanded: allGroupPaths(tree) });

/** The rows as indented labels, with a slash marking an open group. */
function shape(rows) {
  return rows.map((r) => `${"  ".repeat(r.depth)}${r.node.label}${r.open ? "/" : ""}`.trimEnd());
}

/** The result names of the variable rows, in order. */
function names(rows) {
  return rows.map((r) => r.node.name).filter((n) => n !== undefined);
}

test("a dotted name becomes a path, and the prefix becomes its heading", () => {
  const tree = buildTraceTree(["chopper.diode.i", "chopper.diode.v", "capacitor.v"]);
  assert.deepEqual(shape(traceRows(tree, allOpen(tree)).rows), [
    "chopper/",
    "  diode/",
    "    i",
    "    v",
    "capacitor/",
    "  v",
  ]);
});

test("the order is the result's, and a group appears where its first variable does", () => {
  // Not alphabetical: the list has never reordered itself under the reader, and
  // folding it into a tree is not a licence to start.
  const tree = buildTraceTree(["z.y", "a.b", "z.x"]);
  assert.deepEqual(shape(traceRows(tree, allOpen(tree)).rows), ["z/", "  y", "  x", "a/", "  b"]);
});

test("a connector is a variable and a group at once", () => {
  // `pin` is in the result, and `pin.v` is too. Both facts live on one node.
  const tree = buildTraceTree(["pin", "pin.v", "pin.i"]);
  const rows = traceRows(tree, allOpen(tree)).rows;
  assert.deepEqual(shape(rows), ["pin/", "  v", "  i"]);
  assert.equal(rows[0].node.name, "pin", "the row is still the variable itself");
  assert.equal(traceCounts(rows[0].node).total, 3);
});

test("a derivative sits with the state it belongs to, labelled as a derivative", () => {
  const tree = buildTraceTree(["inductor.i", "der(inductor.i)", "der(capacitor.v)", "der(x)"]);
  const rows = traceRows(tree, allOpen(tree)).rows;
  assert.deepEqual(shape(rows), [
    "inductor/",
    "  i",
    "  der(i)",
    "capacitor/",
    "  der(v)",
    "der(x)",
  ]);
  // The label is short; the name the result uses is what gets plotted.
  assert.deepEqual(names(rows), [
    "inductor.i",
    "der(inductor.i)",
    "der(capacitor.v)",
    "der(x)",
  ]);
});

test("nested wrappers and previous() stay on one row", () => {
  assert.deepEqual(traceSegments("der(der(mass.flange_a.s))"), ["mass", "flange_a", "der(der(s))"]);
  assert.deepEqual(traceSegments("previous(x)"), ["previous(x)"]);
  assert.deepEqual(traceSegments("der(a.b)"), ["a", "der(b)"]);
});

test("an array is a group, and its elements are children", () => {
  const tree = buildTraceTree(["x[1]", "x[2]", "x[10]", "battery.cell[2].v"]);
  const rows = traceRows(tree, allOpen(tree)).rows;
  assert.deepEqual(shape(rows), ["x/", "  [1]", "  [2]", "  [10]", "battery/", "  cell[2]/", "    v"]);
  assert.deepEqual(names(rows), ["x[1]", "x[2]", "x[10]", "battery.cell[2].v"]);
});

test("a derivative of an array element attaches to the array", () => {
  assert.deepEqual(traceSegments("der(x[1])"), ["der(x)", "[1]"]);
  assert.deepEqual(traceSegments("state.x[2,3]"), ["state", "x", "[2,3]"]);
});

test("a quoted identifier is one component, dots and all", () => {
  assert.deepEqual(traceSegments("'a.b'.c"), ["'a.b'", "c"]);
});

test("a collapsed group keeps its variables out, and that is not a truncation", () => {
  const tree = buildTraceTree(["a.b", "a.c", "d.e"]);
  const open = traceRows(tree, allOpen(tree));
  const closed = traceRows(tree, { expanded: new Set() });
  assert.equal(open.rows.length, 5, "two headings and the three variables under them");
  assert.deepEqual(names(closed.rows), [], "nothing is shown under a closed group");
  assert.equal(closed.matched, 3, "the variables are still counted as being there");
  assert.equal(closed.truncated, false, "folded away is not cut short");
});

test("a filter keeps the way down to a match and opens it, whatever was collapsed", () => {
  const tree = buildTraceTree(["motor.friction.phi", "motor.la.v", "motor.R_s", "load.T"]);
  const rows = traceRows(tree, { expanded: new Set(), match: (name) => name.includes("phi") });
  assert.deepEqual(shape(rows.rows), ["motor/", "  friction/", "    phi"]);
  assert.equal(rows.matched, 1);
  assert.equal(rows.truncated, false);
});

test("a group survives a filter that only matches its name", () => {
  // Typing "friction" is how a reader asks for everything in that component.
  const tree = buildTraceTree(["motor.friction.phi", "motor.friction.w", "motor.la.v"]);
  const rows = traceRows(tree, { expanded: new Set(), match: (n) => n.includes("friction") });
  assert.deepEqual(shape(rows.rows), ["motor/", "  friction/", "    phi", "    w"]);
  assert.deepEqual(names(rows.rows), ["motor.friction.phi", "motor.friction.w"]);
});

test("the budget counts variables, and says when it cut the list", () => {
  const many = Array.from({ length: 50 }, (_, i) => `motor.big.x${i}`);
  const tree = buildTraceTree(many);
  const rows = traceRows(tree, { expanded: allGroupPaths(tree), budget: 40 });
  assert.equal(rows.shown, 40, "forty variables, not forty rows: the headings are free");
  assert.equal(rows.matched, 50);
  assert.equal(rows.truncated, true);
  assert.equal(names(rows.rows).length, 40);

  const fits = traceRows(tree, { expanded: allGroupPaths(tree), budget: 50 });
  assert.equal(fits.truncated, false, "an exact fit is not a truncation");
});

test("a closed group is still a row: it is the only sign its variables are there", () => {
  const tree = buildTraceTree(["a.b", "a.c", "d.e"]);
  const rows = traceRows(tree, { expanded: new Set(["d"]) }).rows;
  assert.deepEqual(shape(rows), ["a", "d/", "  e"]);
  assert.equal(rows[0].open, false);
});

test("a heading with no room for its contents is not drawn", () => {  // Otherwise the list ends with a group the reader can open onto nothing: the
  // budget is spent, so its children can never appear.
  const tree = buildTraceTree(["a.b", "a.c", "z.d"]);
  const rows = traceRows(tree, { expanded: allGroupPaths(tree), budget: 2 }).rows;
  assert.deepEqual(shape(rows), ["a/", "  b", "  c"]);
  assert.equal(rows[rows.length - 1].node.name, "a.c");
});

test("the top level and the small groups open on sight; the crowded ones do not", () => {
  const names = ["motor.friction.w", "motor.friction.phi", "motor.la.v", "load.T"];
  names.push(...Array.from({ length: 40 }, (_, i) => `motor.big.x${i}`));
  const tree = buildTraceTree(names);
  const open = initialOpenPaths(tree);
  assert.ok(open.has("motor"), "the top level is the map of the model");
  assert.ok(open.has("motor.la"), "a group of one costs a row and saves a click");
  assert.ok(open.has("motor.friction"), "a group of two is small");
  assert.ok(!open.has("motor.big"), "forty variables stay behind their heading");
});

test("the groups holding a drawn trace open, so the reader can see what they picked", () => {
  const names = Array.from({ length: 40 }, (_, i) => `motor.big.x${i}`);
  const tree = buildTraceTree(names);
  const open = initialOpenPaths(tree, { drawn: ["motor.big.x7"] });
  assert.ok(open.has("motor") && open.has("motor.big"), "the drawn trace is on screen");
});

test("every group can be listed, so the list can be expanded in one action", () => {
  const tree = buildTraceTree(["a.b", "a.c.d", "e"]);
  assert.deepEqual([...allGroupPaths(tree)].sort(), ["a", "a.c"]);
});

test("counts say how much is in a group and how much of it is drawn", () => {
  const tree = buildTraceTree(["a.b", "a.c", "a.d"]);
  const node = tree[0];
  assert.deepEqual(traceCounts(node), { total: 3, drawn: 0 });
  assert.deepEqual(traceCounts(node, new Set(["a.c"])), { total: 3, drawn: 1 });
});
