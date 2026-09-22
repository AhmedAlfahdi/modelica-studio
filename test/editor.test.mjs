/**
 * Editor interaction tests.
 *
 * These drive the REAL SchematicEditor against a small DOM stub, so the event
 * wiring is exercised rather than just the geometry. That distinction matters:
 * the defects this file was written to catch — selection never reaching the UI,
 * keyboard shortcuts dying when focus moved, gestures not surviving a cancel —
 * were all invisible to geometry-only tests.
 *
 * The stub implements exactly the DOM surface the editor uses. It is not a
 * browser, so anything depending on real layout or canvas rasterisation is out
 * of scope; what is covered here is behaviour: who receives an event, what
 * state changes, and what gets recorded in history.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildLibs } from "./helpers/build.mjs";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");


/* ------------------------------------------------------------------ */
/* Minimal DOM                                                        */
/* ------------------------------------------------------------------ */

class StubTarget {
  listeners = new Map();
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type, event = {}) {
    const ev = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...event,
    };
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
    return ev;
  }
}

class StubElement extends StubTarget {
  constructor(tag = "div") {
    super();
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.classes = new Set();
    this.textContent = "";
    this.parent = null;
    this.isConnected = true;
    this.clientWidth = 800;
    this.clientHeight = 600;
    this.offsetTop = 0;
    this.tabIndex = 0;
    this.disabled = false;
    this.title = "";
    this.classList = {
      add: (c) => this.classes.add(c),
      remove: (c) => this.classes.delete(c),
      toggle: (c, on) => (on ? this.classes.add(c) : this.classes.delete(c)),
      contains: (c) => this.classes.has(c),
    };
  }
  createDiv(opts = {}) {
    const el = new StubElement("div");
    if (opts.cls) el.className = opts.cls;
    el.parent = this;
    this.children.push(el);
    return el;
  }
  createEl(tag, opts = {}) {
    const el = new StubElement(tag);
    if (opts.cls) el.className = opts.cls;
    if (opts.text) el.textContent = opts.text;
    el.parent = this;
    this.children.push(el);
    return el;
  }
  setText(t) {
    this.textContent = t;
  }
  setAttr() {}
  addClass(c) {
    this.classes.add(c);
  }
  removeClass(c) {
    this.classes.delete(c);
  }
  toggleClass(c, on) {
    on ? this.classes.add(c) : this.classes.delete(c);
  }
  hasClass(c) {
    return this.classes.has(c);
  }
  remove() {
    this.isConnected = false;
    if (this.parent) {
      this.parent.children = this.parent.children.filter((c) => c !== this);
    }
  }
  contains(n) {
    if (n === this) return true;
    return this.children.some((c) => c.contains?.(n));
  }
  appendChild(c) {
    c.parent = this;
    c.isConnected = true;
    this.children.push(c);
    return c;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  focus() {
    this.hasFocus = true;
    this.dispatch("focus");
  }
  get ownerDocument() {
    return doc;
  }
}

/**
 * A canvas stub whose 2D context records nothing; drawing is not under test.
 *
 * The canvas is positioned to fill its host, so these stubs keep the two in
 * step: writing `ownWidth` also resizes the host. They used to be independent,
 * which let a test describe a layout the browser cannot produce — a canvas
 * whose box differs from the box it fills.
 */
class StubCanvas extends StubElement {
  constructor() {
    super("canvas");
    this.width = 800;
    this.height = 600;
    this.ownWidth = 800;
    this.ownHeight = 600;
  }
  getContext() {
    return stubCtx();
  }
  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      width: this.ownWidth,
      height: this.ownHeight,
      right: this.ownWidth,
      bottom: this.ownHeight,
    };
  }
}

/** Resize a canvas and its host together, as a real layout does. */
function layoutTo(canvas, w, h) {
  canvas.ownWidth = w;
  canvas.ownHeight = h;
  const host = canvas.parent;
  if (host) {
    host.getBoundingClientRect = () => ({
      left: 0, top: 0, width: w, height: h, right: w, bottom: h,
    });
  }
}

function stubCtx() {
  const noop = () => {};
  return new Proxy(
    {
      canvas: { width: 800, height: 600 },
      measureText: () => ({ width: 10 }),
      setTransform: noop,
      save: noop,
      restore: noop,
    },
    {
      get(t, k) {
        if (k in t) return t[k];
        return noop;
      },
      set() {
        return true;
      },
    }
  );
}

const observers = [];

const doc = new StubTarget();
doc.createElement = (tag) => (tag === "canvas" ? new StubCanvas() : new StubElement(tag));
doc.documentElement = new StubElement("html");
doc.body = new StubElement("body");

function installDom() {
  // The editor watches its host element, which resizes independently of the
  // window (sidebar toggles, splitter drags, tab re-layout).
  globalThis.ResizeObserver = class {
    constructor(fn) {
      this.fn = fn;
      observers.push(this);
    }
    observe() {
      this.fn([]);
    }
    disconnect() {}
  };
  globalThis.document = doc;
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
    // The editor's click marker uses timers.
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: (id) => clearTimeout(id),
  };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  // `navigator` is a getter-only global in Node 22, so it must be redefined.
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { readText: async () => "", writeText: async () => {} } },
    configurable: true,
    writable: true,
  });
}

installDom();
const { SchematicEditor, GRID } = await import(path.join(buildLibs("editor-lib", ["src/view/editor.ts", "src/view/history.ts"]), "editor.js"));

// Canvas geometry, for assertions about what is clickable.
const C0 = await import(path.join(buildLibs("canvas-lib", ["src/render/canvas.ts"]), "canvas.js"));
// One scale for wires and symbols, so the floor and the cap are shared too.
const { MIN_STROKE_PX, MAX_STROKE_PX, WIRE_WIDTH_PX } = C0;

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

function classDef(name) {
  return {
    name,
    shortName: name.split(".").pop(),
    icon: [{ kind: "Rectangle", extent: [-70, -30, 70, 30], lineColor: [0, 0, 0] }],
    diagram: [],
    ports: [
      { name: "p", type: "Pin", isFlow: true, causality: "acausal" },
      { name: "n", type: "Pin", isFlow: true, causality: "acausal" },
    ],
    portPositions: { p: [-100, 0], n: [100, 0] },
    parameters: [{ name: "R", type: "Real", defaultValue: "100" }],
    hasIcon: true,
  };
}
const DEFS = { "M.R": classDef("M.R") };
// The same class, but with artwork that fills the instance's extent. `M.R` draws
// a wide flat rectangle inside its box, which leaves slack under it — fine for
// hit-testing, misleading for anything about where a LABEL lands.
DEFS["M.Fill"] = {
  ...classDef("M.Fill"),
  icon: [{ kind: "Rectangle", extent: [-10, -10, 10, 10], lineColor: [0, 0, 0] }],
  // Ports on the box's edge. `classDef` puts them at ±100, which stretches the
  // class's own box to 200 wide and makes the aspect-preserving fit draw the
  // artwork as a thin strip inside the extent — fine for hit tests, useless for
  // asking where the LABEL under the symbol lands.
  portPositions: { p: [-10, 0], n: [10, 0] },
};
const lookup = (n) => DEFS[n];

function inst(id, cx, cy, half = 20) {
  return {
    id,
    className: "M.R",
    placement: { extent: [cx - half, cy - half, cx + half, cy + half], rotation: 0, visible: true },
    params: { R: "100" },
  };
}

/** Build an editor plus a log of the callbacks it fired. */
function makeEditor(components = [inst("r1", 0, 0), inst("r2", 200, 0)]) {
  const host = new StubElement("div");
  const events = { changes: 0, selections: [], statuses: [] };
  const editor = new SchematicEditor(
    host,
    { name: "M", components, connections: [], graphics: [] },
    {
      lookup,
      onChange: () => events.changes++,
      onSelectionChange: (ids) => events.selections.push(ids),
      onStatus: (t) => events.statuses.push(t),
    }
  );
  // The default viewport maps a diagram point (x, y) to the canvas point
  // (x, -y): the two axes agree in x and are MIRRORED in y, because a diagram's
  // +y points up and a canvas's points down. `press`/`move`/`release` below take
  // canvas points, so a test that means a particular diagram point has to go
  // through `viewportTransform` to say so.
  return { editor, host, events };
}

/** Pointer event at a diagram coordinate. */
function pointer(x, y, extra = {}) {
  return { clientX: x, clientY: y, button: 0, pointerId: 1, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...extra };
}

function key(k, extra = {}) {
  return { key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, target: null, ...extra };
}

/* ------------------------------------------------------------------ */
/* Selection                                                          */
/* ------------------------------------------------------------------ */

test("clicking a component selects it and notifies the view", () => {
  const { editor, events } = makeEditor();
  click(editor, 0, 0);
  assert.deepEqual(editor.selectedIds, ["r1"]);
  assert.ok(
    events.selections.some((ids) => ids.length === 1 && ids[0] === "r1"),
    "onSelectionChange reported the selection"
  );
});

test("selection is reported only when it actually changes", () => {
  const { editor, events } = makeEditor();
  click(editor, 0, 0);
  const after = events.selections.length;
  click(editor, 0, 0); // same component again
  assert.equal(events.selections.length, after, "no spurious selection events");
});

test("clicking empty space clears the selection", () => {
  const { editor } = makeEditor();
  click(editor, 0, 0);
  assert.equal(editor.selectedIds.length, 1);
  click(editor, -400, -300);
  assert.deepEqual(editor.selectedIds, []);
});

test("ctrl+click adds to and removes from the selection", () => {
  const { editor } = makeEditor();
  click(editor, 0, 0);
  click(editor, 200, 0, { ctrlKey: true });
  assert.deepEqual(editor.selectedIds.sort(), ["r1", "r2"]);
  click(editor, 200, 0, { ctrlKey: true });
  assert.deepEqual(editor.selectedIds, ["r1"]);
});

test("Tab cycles the selection without a mouse", () => {
  const { editor } = makeEditor();
  // A keyboard-only user focuses the canvas first; ownership needs both the
  // pointer inside the view and the canvas focused.
  canvasOf(editor).dispatch("pointerenter", pointer(0, 0));
  canvasOf(editor).focus();
  keydown(editor, key("Tab"));
  assert.deepEqual(editor.selectedIds, ["r1"]);
  keydown(editor, key("Tab"));
  assert.deepEqual(editor.selectedIds, ["r2"]);
  keydown(editor, key("Tab")); // wraps
  assert.deepEqual(editor.selectedIds, ["r1"]);
  keydown(editor, key("Tab", { shiftKey: true }));
  assert.deepEqual(editor.selectedIds, ["r2"], "shift+Tab goes backwards");
});

/* ------------------------------------------------------------------ */
/* Moving                                                             */
/* ------------------------------------------------------------------ */

test("dragging a component moves it and records one undo step", () => {
  const { editor, events } = makeEditor();
  press(editor, 0, 0);
  move(editor, 2, 0); // below the 4px drag threshold
  assert.deepEqual(
    editor.getModel().components[0].placement.extent,
    [-20, -20, 20, 20],
    "a sub-threshold move must not shift the component"
  );
  move(editor, 60, 40); // now a real drag
  release(editor, 60, 40);

  const c = editor.getModel().components[0];
  // Dragged 60 across and 40 DOWN the screen. Modelica's diagram coordinates have
  // +y UP, so moving down the canvas LOWERS y: the extent goes to -60..-20, not
  // 20..60. That is the convention the file is written in, and the numbers a
  // reader of the source expects to see. Snapped to the 20-unit grid.
  assert.deepEqual(c.placement.extent, [40, -60, 80, -20], "snapped to the grid");
  assert.equal(editor.history.depth, 1, "one undo step for the whole drag");
  assert.ok(events.changes > 0, "the view was told about the change");
});

test("a click that jitters does not create an undo step", () => {
  const { editor } = makeEditor();
  press(editor, 0, 0);
  move(editor, 1, 1);
  release(editor, 1, 1);
  assert.equal(editor.history.depth, 0, "a click is not an edit");
});

test("dragging moves a multi-selection rigidly", () => {
  const { editor } = makeEditor();
  editor.selectAll();
  press(editor, 0, 0);
  move(editor, 100, 0);
  release(editor, 100, 0);
  const [a, b] = editor.getModel().components;
  // Both moved by the same delta, so the gap is unchanged.
  assert.equal(a.placement.extent[0], 80);
  assert.equal(b.placement.extent[0], 280);
  assert.equal(
    b.placement.extent[0] - a.placement.extent[0],
    200,
    "relative spacing preserved"
  );
});

test("arrow keys nudge and coalesce into one undo step", () => {
  const { editor } = makeEditor();
  click(editor, 0, 0);
  for (let i = 0; i < 4; i++) keydown(editor, key("ArrowRight"));
  assert.deepEqual(
    editor.getModel().components[0].placement.extent,
    [20, -20, 60, 20],
    "moved 4 grid steps"
  );
  assert.equal(editor.history.depth, 1, "a burst of nudges collapses to one step");
});

test("shift+arrow nudges further", () => {
  const { editor } = makeEditor();
  click(editor, 0, 0);
  keydown(editor, key("ArrowDown", { shiftKey: true }));
  assert.equal(editor.getModel().components[0].placement.extent[1], -20 + GRID * 5);
});

/* ------------------------------------------------------------------ */
/* Keyboard ownership (the defect that made Delete unreliable)        */
/* ------------------------------------------------------------------ */

test("Delete works when the pointer is over the canvas", () => {
  const { editor } = makeEditor();
  click(editor, 0, 0);
  keydown(editor, key("Delete"));
  assert.equal(editor.getModel().components.length, 1, "r1 deleted");
  assert.equal(editor.getModel().components[0].id, "r2");
});

test("Delete still works when focus moved to another panel", () => {
  // The canvas holds no focus, but the pointer is over it — this is the exact
  // situation that used to make Delete silently do nothing.
  const { editor } = makeEditor();
  click(editor, 0, 0);
  canvasOf(editor).hasFocus = false;
  keydown(editor, key("Delete", { target: new StubElement("div") }));
  assert.equal(editor.getModel().components.length, 1, "Delete applied without canvas focus");
});

test("shortcuts do not fire when the pointer is elsewhere", () => {
  const { editor } = makeEditor();
  click(editor, 0, 0);
  canvasOf(editor).hasFocus = false;
  leave(editor);
  const before = editor.getModel().components.length;
  keydown(editor, key("Delete"));
  assert.equal(editor.getModel().components.length, before, "a distant editor ignores the key");
});

test("shortcuts are ignored while typing in a text field", () => {
  const { editor } = makeEditor();
  click(editor, 0, 0);
  const input = new StubElement("input");
  keydown(editor, key("Delete", { target: input }));
  assert.equal(editor.getModel().components.length, 2, "typing must not delete components");
});

/* ------------------------------------------------------------------ */
/* Delete, undo, redo                                                 */
/* ------------------------------------------------------------------ */

test("undo restores a deleted component, redo removes it again", () => {
  const { editor } = makeEditor();
  click(editor, 0, 0);
  keydown(editor, key("Delete"));
  assert.equal(editor.getModel().components.length, 1);

  keydown(editor, key("z", { ctrlKey: true }));
  assert.equal(editor.getModel().components.length, 2, "undo brought it back");
  assert.ok(editor.getModel().components.some((c) => c.id === "r1"));

  keydown(editor, key("z", { ctrlKey: true, shiftKey: true }));
  assert.equal(editor.getModel().components.length, 1, "redo removed it again");
});

test("undo restores a move", () => {
  const { editor } = makeEditor();
  press(editor, 0, 0);
  move(editor, 100, 0);
  release(editor, 100, 0);
  assert.equal(editor.getModel().components[0].placement.extent[0], 80);
  editor.undo();
  assert.deepEqual(editor.getModel().components[0].placement.extent, [-20, -20, 20, 20]);
});

test("a new edit clears the redo branch", () => {
  const { editor } = makeEditor();
  click(editor, 0, 0);
  keydown(editor, key("Delete"));
  keydown(editor, key("z", { ctrlKey: true }));
  assert.ok(editor.history.canRedo, "redo available after an undo");
  editor.select("r2");
  keydown(editor, key("ArrowRight"));
  assert.equal(editor.history.canRedo, false, "a fresh edit drops the redo branch");
});

test("undoing past the start is a no-op that says so", () => {
  const { editor, events } = makeEditor();
  editor.undo();
  assert.ok(events.statuses.includes("nothing to undo"));
});

/* ------------------------------------------------------------------ */
/* Clipboard                                                          */
/* ------------------------------------------------------------------ */

test("copy then paste duplicates components with new ids", async () => {
  const { editor } = makeEditor();
  click(editor, 0, 0);
  keydown(editor, key("c", { ctrlKey: true }));
  keydown(editor, key("v", { ctrlKey: true }));
  // paste() may consult the system clipboard, so it is asynchronous.
  await new Promise((r) => setTimeout(r, 0));
  const ids = editor.getModel().components.map((c) => c.id);
  assert.equal(ids.length, 3, `expected a third component, got ${ids.join(",")}`);
  assert.ok(ids.includes("r1") && ids.includes("r2"), "originals are untouched");
  // The copy takes its name from the class ("R" -> "r"), not from the original
  // instance id, which is what Modelica users expect when duplicating.
  assert.ok(ids.includes("r"), `the copy has a fresh id, got ${ids.join(",")}`);
});

test("pasting twice offsets the copies so they do not stack", () => {
  const { editor } = makeEditor();
  click(editor, 0, 0);
  editor.copy();
  editor.duplicate();
  const first = editor.getModel().components[2].placement.extent[0];
  editor.duplicate();
  const second = editor.getModel().components[3].placement.extent[0];
  assert.notEqual(first, second, "successive copies cascade");
});

test("copying a connected pair brings the connection with it", () => {
  const { editor } = makeEditor();
  editor.addConnection({ component: "r1", port: "n" }, { component: "r2", port: "p" });
  assert.equal(editor.getModel().connections.length, 1);
  editor.selectAll();
  editor.copy();
  editor.duplicate();
  assert.equal(editor.getModel().connections.length, 2, "the copied pair is wired too");
});

test("paste is a single undo step", () => {
  const { editor } = makeEditor();
  click(editor, 0, 0);
  editor.copy();
  const before = editor.history.depth;
  editor.duplicate();
  assert.equal(editor.history.depth, before + 1);
  editor.undo();
  assert.equal(editor.getModel().components.length, 2, "one undo removes the whole paste");
});

/* ------------------------------------------------------------------ */
/* Gesture cancellation                                               */
/* ------------------------------------------------------------------ */

test("Escape during a drag restores the original position", () => {
  const { editor } = makeEditor();
  press(editor, 0, 0);
  move(editor, 90, 0); // dragging
  assert.notDeepEqual(editor.getModel().components[0].placement.extent, [-20, -20, 20, 20]);
  keydown(editor, key("Escape"));
  assert.deepEqual(
    editor.getModel().components[0].placement.extent,
    [-20, -20, 20, 20],
    "position restored"
  );
  assert.equal(editor.history.depth, 0, "a cancelled gesture is not an edit");
});

test("pointercancel during a drag restores the original position", () => {
  const { editor } = makeEditor();
  press(editor, 0, 0);
  move(editor, 90, 0);
  canvasOf(editor).dispatch("pointercancel", pointer(90, 0));
  assert.deepEqual(editor.getModel().components[0].placement.extent, [-20, -20, 20, 20]);
  assert.equal(editor.history.depth, 0);
});

/* ------------------------------------------------------------------ */
/* Rubber band                                                        */
/* ------------------------------------------------------------------ */

test("dragging on empty space rubber-band selects the enclosed components", () => {
  const { editor } = makeEditor();
  press(editor, -300, -300);
  move(editor, 300, 300);
  assert.deepEqual(editor.selectedIds.sort(), ["r1", "r2"]);
  release(editor, 300, 300);
});

test("the rubber band is painted over the drag, not mirrored below it", () => {
  // The band's TOP edge is the LARGER diagram y once the viewport negates y, and
  // a canvas rect grows downward from the corner it is given. Anchoring at the
  // smaller y -- the reading you get if you forget the flip -- draws the band as
  // far below the gesture as it belongs above it, so it no longer covers the
  // pointer that made it.
  const { editor } = makeEditor();
  const canvas = canvasOf(editor);
  layoutTo(canvas, 1200, 800);
  editor.resize();

  const band = [];
  let dash = "";
  editor.ctx = new Proxy(
    {
      canvas: { width: 2400, height: 1600 },
      measureText: (s) => ({ width: String(s).length * 6 }),
    },
    {
      get(t, k) {
        if (k in t) return t[k];
        // The dashes are what mark the band out from the other stroked rects.
        if (k === "setLineDash") {
          return (d) => {
            dash = d && d.length ? d.join(",") : "";
          };
        }
        if (k === "strokeRect") {
          return (x, y, w, h) => {
            if (dash) band.push([x, y, w, h]);
          };
        }
        return () => {};
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    }
  );

  // A drag from the upper left toward the lower right, in CANVAS pixels.
  press(editor, 100, 120);
  move(editor, 300, 280);
  SchematicEditor.prototype.draw.call(editor);

  assert.equal(band.length, 1, `exactly one band is stroked: ${JSON.stringify(band)}`);
  // The half pixel is the crisp-line offset the stroke itself applies.
  assert.deepEqual(
    band[0],
    [100.5, 120.5, 200, 160],
    "the band spans the drag, from the press down to the pointer"
  );
});

test("a rubber band only picks up what it covers", () => {
  const { editor } = makeEditor();
  press(editor, -400, -400);
  move(editor, -100, -100); // far from both components
  assert.deepEqual(editor.selectedIds, []);
  release(editor, -100, -100);
});

/* ------------------------------------------------------------------ */
/* Wiring                                                             */
/* ------------------------------------------------------------------ */

test("dragging from a pin to another pin creates a connection", () => {
  const { editor } = makeEditor();
  // r1's n pin is at (20,0); r2's p pin is at (180,0).
  press(editor, 20, 0);
  move(editor, 180, 0);
  release(editor, 180, 0);
  const conns = editor.getModel().connections;
  assert.equal(conns.length, 1, "connection created");
  assert.equal(conns[0].from.component, "r1");
  assert.equal(conns[0].to.component, "r2");
});

test("a connection is undoable", () => {
  const { editor } = makeEditor();
  press(editor, 20, 0);
  move(editor, 180, 0);
  release(editor, 180, 0);
  assert.equal(editor.getModel().connections.length, 1);
  editor.undo();
  assert.equal(editor.getModel().connections.length, 0);
});

test("deleting a component also removes its connections", () => {
  const { editor } = makeEditor();
  press(editor, 20, 0);
  move(editor, 180, 0);
  release(editor, 180, 0);
  editor.select("r1");
  editor.deleteSelection();
  assert.equal(editor.getModel().connections.length, 0, "no dangling connection");
});

/* ------------------------------------------------------------------ */
/* Model mutations                                                    */
/* ------------------------------------------------------------------ */

test("addComponent places, selects and records the addition", () => {
  const { editor, events } = makeEditor();
  const added = editor.addComponent("M.R", 500, 500);
  assert.ok(added);
  assert.deepEqual(editor.selectedIds, [added.id]);
  assert.equal(editor.history.depth, 1);
  assert.ok(events.selections.some((ids) => ids[0] === added.id));
});

test("renaming rewrites connection references", () => {
  const { editor } = makeEditor();
  editor.addConnection({ component: "r1", port: "n" }, { component: "r2", port: "p" });
  const res = editor.renameInstance("r1", "resistor1");
  assert.equal(res.ok, true);
  assert.equal(editor.getModel().connections[0].from.component, "resistor1");
});

test("renaming rejects invalid and duplicate names", () => {
  const { editor } = makeEditor();
  assert.equal(editor.renameInstance("r1", "1bad").ok, false);
  assert.equal(editor.renameInstance("r1", "r2").ok, false);
  assert.equal(editor.renameInstance("r1", "ok_name").ok, true);
});

test("setParam records a change and can clear a value", () => {
  const { editor } = makeEditor();
  editor.setParam("r1", "R", "470");
  assert.equal(editor.getModel().components[0].params.R, "470");
  assert.equal(editor.history.depth, 1);
  editor.undo();
  assert.equal(editor.getModel().components[0].params.R, "100");
});

/* ------------------------------------------------------------------ */
/* Event plumbing helpers                                             */
/* ------------------------------------------------------------------ */

function canvasOf(editor) {
  return editor.canvasEl;
}

/** Pointer enters the canvas and goes down. Leaves a gesture in flight. */
function press(editor, x, y, extra) {
  const c = canvasOf(editor);
  c.dispatch("pointerenter", pointer(x, y, extra));
  c.dispatch("pointerdown", pointer(x, y, extra));
}

/**
 * A complete click: press and release at the same point.
 *
 * The release is what finalises selection and history, so tests that only care
 * about the click should use this rather than `press`.
 */
function click(editor, x, y, extra) {
  press(editor, x, y, extra);
  release(editor, x, y, extra);
}

function move(editor, x, y, extra) {
  canvasOf(editor).dispatch("pointermove", pointer(x, y, extra));
}

function release(editor, x, y, extra) {
  canvasOf(editor).dispatch("pointerup", pointer(x, y, extra));
}

function leave(editor) {
  canvasOf(editor).dispatch("pointerleave", pointer(0, 0));
}

function keydown(editor, ev) {
  doc.dispatch("keydown", ev);
}

export {};

/* ------------------------------------------------------------------ */
/* Selection must survive an existing selection                       */
/* ------------------------------------------------------------------ */

test("a click on a selected component still selects it", () => {
  // The defect: resize handles sat on the component's canonical box while the
  // visible symbol is INSIDE that box, so once anything was selected, clicks
  // near the symbol started a resize instead of a selection.
  const { editor } = makeEditor();
  click(editor, 0, 0); // select r1; its handles are now live
  assert.deepEqual(editor.selectedIds, ["r1"], "first click selects");

  // Points on the DRAWN symbol (body -14..14 by -6..6, leads along y=0).
  for (const [x, y] of [
    [0, 0],    // centre
    [0, 5],    // inside the body
    [5, -5],   // inside the body, off-centre
    [12, 0],   // on the right lead
    [-12, 0],  // on the left lead
  ]) {
    // Re-select from a clean slate so the probe measures this click alone.
    editor.select(undefined);
    click(editor, x, y);
    assert.deepEqual(
      editor.selectedIds,
      ["r1"],
      `clicking (${x}, ${y}) on the symbol must select it, not start a resize`
    );
  }
});

test("clicking outside the drawn symbol does not select it", () => {
  // The target is the symbol you can see, not the invisible canonical box. A
  // Resistor fills only the middle band of its box, so the empty corners of that
  // box must not respond — that mismatch is what made selection feel arbitrary.
  const { editor } = makeEditor();
  for (const [x, y] of [
    [0, -18],   // above the body, inside the canonical box, no ink
    [-18, -18],
    [18, -18],
  ]) {
    editor.select(undefined);
    click(editor, x, y);
    assert.deepEqual(editor.selectedIds, [], `(${x}, ${y}) is empty and must not select`);
  }
});

test("handles are grabbable on the symbol's own corners", () => {
  const { editor } = makeEditor();
  click(editor, 0, 0);
  const before = [...editor.getModel().components[0].placement.extent];

  // The SE handle sits on the visible box's corner.
  const inst0 = editor.getModel().components[0];
  const outline = C0.instanceOutlineBounds(inst0, DEFS["M.R"]);
  // `handlePoints` answers in DIAGRAM units; a press is in canvas pixels, and
  // the two differ by the viewport -- including its sign, since diagram +y is up
  // and canvas y is down. Mapped through the editor's own transform so the press
  // lands on the handle the test means, rather than on its mirror image.
  const at = (x, y) => C0.apply(C0.viewportTransform(editor.viewport, 1), x, y);
  const se = at(...Object.values(C0.handlePoints(outline).se));

  press(editor, se[0], se[1]);
  move(editor, se[0] + 30, se[1] + 30);
  release(editor, se[0] + 30, se[1] + 30);

  const after = editor.getModel().components[0].placement.extent;
  assert.notDeepEqual(after, before, "dragging the corner handle resizes");

  // Orientation pin. The SE handle is the corner DRAWN at the bottom right, and
  // bottom right in diagram coordinates is (larger x, smaller y) because diagram
  // +y points up. So dragging it further right and further down must push the
  // east edge out and the south edge out, and must leave the west and north
  // edges exactly where they were. Asserting `after[3] > before[3]` here -- the
  // reading you get if you assume canvas y-down -- passed only while the
  // viewport was silently mirroring every drawing.
  assert.equal(after[0], before[0], "the west edge stays put");
  assert.equal(after[3], before[3], "the north edge stays put");
  assert.ok(after[2] > before[2], "the east edge moved out");
  assert.ok(after[1] < before[1], "the south edge moved out, i.e. to a smaller y");
});

test("pressing a pin and releasing without moving selects the component", () => {
  // A pin sits on the symbol's edge and its lead is part of the drawing, so a
  // press there is ambiguous. It must only become a wire if the pointer moves.
  const { editor } = makeEditor();
  click(editor, 20, 0); // exactly on r1's n pin
  assert.deepEqual(editor.selectedIds, ["r1"], "a pin click selects");
  assert.equal(editor.getModel().connections.length, 0, "and does not create a wire");
});

test("pressing a pin and dragging still creates a wire", () => {
  const { editor } = makeEditor();
  press(editor, 20, 0); // r1.n
  move(editor, 180, 0); // r2.p
  release(editor, 180, 0);
  assert.equal(editor.getModel().connections.length, 1, "dragging from a pin wires it");
});

test("shift-clicking a component adds to the selection instead of panning", () => {
  // Shift was both a pan modifier and an add-to-selection modifier, and the pan
  // check ran first — so shift-clicking a component (the natural way to extend a
  // selection) panned the view instead. Verified against the running plugin,
  // where a press inside a component reported outcome "pan".
  const { editor } = makeEditor();
  click(editor, 0, 0);
  assert.deepEqual(editor.selectedIds, ["r1"]);

  press(editor, 200, 0, { shiftKey: true });
  release(editor, 200, 0, { shiftKey: true });
  assert.deepEqual(
    editor.selectedIds.sort(),
    ["r1", "r2"],
    "shift-click extends the selection"
  );

  // Shift on empty space still pans.
  const before = { ...editor.viewport };
  press(editor, -400, -300, { shiftKey: true });
  move(editor, -350, -260, { shiftKey: true });
  release(editor, -350, -260, { shiftKey: true });
  assert.notDeepEqual(editor.viewport, before, "shift-drag on empty space pans");
});

test("a press on a component always wins, whatever modifiers are held", () => {
  const { editor } = makeEditor();
  for (const mods of [{}, { shiftKey: true }, { ctrlKey: true }, { altKey: true }]) {
    editor.select(undefined);
    click(editor, 0, 0, mods);
    assert.equal(editor.selectedIds.length, 1, `press with ${JSON.stringify(mods)} selects`);
  }
});

test("the canvas backing store follows its host element, not just the window", () => {
  // The defect: only `window.resize` was observed. When the canvas host changed
  // size on its own — toggling a sidebar, dragging the splitter, re-laying-out a
  // tab — the backing store went stale and the browser stretched the old bitmap
  // to fit the new box. Everything drawn then appeared displaced by roughly half
  // the size change, which grew the further the layout moved.
  const { editor, host } = makeEditor();
  const canvas = canvasOf(editor);

  // A wide canvas, measured. The host is what the editor reads, so the test
  // resizes both — as a real layout does.
  const layout = (w, h) => {
    host.getBoundingClientRect = () => ({
      left: 0, top: 0, width: w, height: h, right: w, bottom: h,
    });
    layoutTo(canvas, w, h);
  };
  layout(1200, 700);
  editor.resize();
  assert.equal(canvas.width, 1200 * (globalThis.window.devicePixelRatio || 1));
  assert.equal(canvas.style.width, "1200px");

  // Now the host shrinks WITHOUT a window resize.
  layout(800, 500);
  // The observer is what notices. Trigger it the way the browser would.
  for (const o of observers) o.fn([]);

  assert.equal(canvas.style.width, "800px", "the canvas style follows the host");
  assert.equal(canvas.style.height, "500px");
  assert.equal(
    canvas.width,
    800 * (globalThis.window.devicePixelRatio || 1),
    "the backing store follows the host"
  );
});

test("resizing is skipped when nothing changed", () => {
  // ResizeObserver fires on observe() and on every layout tick, so reallocating
  // the canvas each time would be wasteful. An unchanged size must be a no-op.
  const { editor } = makeEditor();
  const canvas = canvasOf(editor);
  layoutTo(canvas, 1000, 600);
  editor.resize();

  let writes = 0;
  let backing = canvas.width;
  Object.defineProperty(canvas, "width", {
    get() { return backing; },
    set(v) { writes++; backing = v; },
    configurable: true,
  });

  // The same geometry again: no reallocation.
  editor.resize();
  assert.equal(writes, 0, "an unchanged size must not reallocate the canvas");

  // A genuine change must reallocate, or the drawing would be stretched.
  layoutTo(canvas, 800, 500);
  editor.resize();
  assert.equal(writes, 1, "a real size change must reallocate");
  assert.equal(canvas.style.width, "800px");
});

test("a canvas whose bitmap does not match its layout box is always corrected", () => {
  // The defect this guards: the canvas element's CSS size grew after the bitmap
  // was allocated, so the browser stretched the old bitmap to fit. Every drawn
  // coordinate was then displaced and scaled, which presented as selection
  // drifting further out the further you got from the canvas origin.
  const { editor } = makeEditor();
  const canvas = canvasOf(editor);
  layoutTo(canvas, 1200, 700);
  editor.resize();
  const dpr = globalThis.window.devicePixelRatio || 1;
  assert.equal(canvas.width, Math.floor(1200 * dpr), "bitmap matches the layout box");

  // Simulate the browser growing the element without a resize event reaching us.
  layoutTo(canvas, 1500, 800);
  // Even with identical CSS bookkeeping, a bitmap that no longer matches must be
  // rebuilt rather than left stretched.
  editor.resize();
  assert.equal(canvas.width, Math.floor(1500 * dpr), "bitmap re-created for the new box");
  assert.equal(canvas.style.width, "1500px");
  assert.equal(canvas.style.height, "800px");
});

test("zoomToFit measures the canvas before fitting", () => {
  // It runs on open and when the model is swapped, often before the host has
  // been laid out. Fitting to a stale size produced a view scaled for a canvas
  // that no longer existed — the diagram ended up tiny in a corner.
  const { editor } = makeEditor();
  const canvas = canvasOf(editor);
  // Start with a tiny layout, as if measured before layout settled.
  layoutTo(canvas, 10, 10);
  editor.resize();
  const tiny = editor.viewport.scale;

  // Now the real layout arrives.
  layoutTo(canvas, 1200, 800);
  editor.zoomToFit();

  assert.ok(
    editor.viewport.scale > tiny,
    `fitting after layout must use the larger canvas (was ${tiny}, now ${editor.viewport.scale})`
  );
  // And the diagram should be centred in it. Diagram +y points up and canvas y
  // points down, so the y mapping is mirrored — the earlier version of this
  // added, which happened to pass only because the fixture is centred on y=0.
  const [x1, y1, x2, y2] = C0.diagramBounds(editor.getModel());
  const cx = ((x1 + x2) / 2) * editor.viewport.scale + editor.viewport.x;
  const cy = editor.viewport.y - ((y1 + y2) / 2) * editor.viewport.scale;
  assert.ok(Math.abs(cx - 600) < 2, `diagram centred horizontally, got ${cx.toFixed(0)}`);
  // Vertically it sits a little above centre: the fit reserves room under the
  // drawing for the component names, which are painted below their symbols.
  const lift = 400 - cy;
  assert.ok(lift >= 0 && lift <= 22, `centred vertically, nudged up for the labels (${lift.toFixed(0)}px)`);
});

test("a fit requested before layout does not frame a canvas that does not exist", () => {
  // The defect: zoomToFit ran on open against a stale or tiny size, so the scale
  // was computed for a canvas that was not the one being displayed. The diagram
  // ended up tiny in a corner, or scaled so large it fell outside the view.
  const { editor, host } = makeEditor();
  const canvas = canvasOf(editor);

  // Nothing laid out yet: nothing measurable, so the fit cannot be performed.
  layoutTo(canvas, 1, 1);
  host.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0,
  });
  editor.resize();
  editor.scheduleFit();

  const before = { ...editor.viewport };

  // Layout settles to a real size; the pending fit must complete by itself.
  host.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800,
  });
  layoutTo(canvas, 1200, 800);
  editor.resize();

  const [x1, y1, x2, y2] = C0.diagramBounds(editor.getModel());
  const s = editor.viewport.scale;
  // Assert the outcome, not that the number changed: `zoomToFit` clamps its
  // scale, so a performed fit can legitimately produce the same value again.
  // The whole diagram must be inside the view. Mirrored in y, as the canvas is.
  const left = x1 * s + editor.viewport.x;
  const right = x2 * s + editor.viewport.x;
  const top = editor.viewport.y - y2 * s;
  const bottom = editor.viewport.y - y1 * s;
  assert.ok(left >= -1 && right <= 1201, `diagram fits horizontally (${left.toFixed(0)}..${right.toFixed(0)})`);
  assert.ok(top >= -1 && bottom <= 801, `diagram fits vertically (${top.toFixed(0)}..${bottom.toFixed(0)})`);
});

test("resizing the canvas refits rather than leaving the diagram adrift", () => {
  // A viewport framed for one canvas size is meaningless for another; without a
  // refit the diagram can sit outside the visible area entirely.
  const { editor } = makeEditor();
  const canvas = canvasOf(editor);
  layoutTo(canvas, 1200, 800);
  editor.resize();
  editor.scheduleFit();
  const fitted = { ...editor.viewport };

  layoutTo(canvas, 600, 400);
  editor.resize();

  const [x1, y1, x2, y2] = C0.diagramBounds(editor.getModel());
  const s = editor.viewport.scale;
  const left = x1 * s + editor.viewport.x;
  const right = x2 * s + editor.viewport.x;
  const top = editor.viewport.y - y2 * s;
  const bottom = editor.viewport.y - y1 * s;
  assert.ok(
    left >= -1 && right <= 601 && top >= -1 && bottom <= 401,
    `after a resize the diagram is still framed (${left.toFixed(0)}..${right.toFixed(0)}, ${top.toFixed(0)}..${bottom.toFixed(0)})`
  );
  assert.ok(s < fitted.scale, "a smaller canvas needs a smaller scale");
});

test("a fit fills the canvas, rather than framing the diagram tiny in it", () => {
  // Reported from a screenshot of DCMotor: the circuit drawn small in the middle
  // of a large canvas, with most of the pane empty. Two causes, both in the fit:
  // `diagramBounds` padded by 40 DIAGRAM UNITS, which is 40px at scale 1 and 200px
  // at scale 5, and a hard cap of 2 on the fitted scale.
  //
  // The model is the real one's geometry: six components of 20x20 units spread
  // over 150x60, in a canvas the size of the studio's diagram pane.
  const filled = (id, cx, cy, half = 10) => ({
    id,
    className: "M.Fill",
    placement: { extent: [cx - half, cy - half, cx + half, cy + half], rotation: 0, visible: true },
    params: {},
  });
  const model = {
    name: "DCMotor",
    components: [
      filled("motor", -10, 10),
      filled("load", 30, 10),
      filled("drag", 70, 10),
      filled("housing", -20, -30),
      filled("supply", -60, 10),
      filled("ground", -60, -30),
    ],
    connections: [],
    graphics: [],
  };
  const { editor } = makeEditor(model.components);
  const canvas = canvasOf(editor);
  const W = 1300;
  const H = 330;
  // Labels at the largest size the setting allows (250%): at the default size the
  // plain margin happens to cover them, so the fit's own label room would look
  // unnecessary — and then clip the moment someone enlarges the labels.
  editor.cb.display = () => ({ labelScale: 2.5, hoverParameters: false });
  layoutTo(canvas, W, H);
  editor.zoomToFit();

  // The bounds of the DRAWING, computed here from the extents rather than asked
  // of the code under test.
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const c of model.components) {
    const [a, b, cc, d] = c.placement.extent;
    x1 = Math.min(x1, a, cc);
    x2 = Math.max(x2, a, cc);
    y1 = Math.min(y1, b, d);
    y2 = Math.max(y2, b, d);
  }
  const s = editor.viewport.scale;
  const drawnW = (x2 - x1) * s;
  const drawnH = (y2 - y1) * s;
  const left = x1 * s + editor.viewport.x;
  // Diagram +y points UP and canvas y points DOWN, so the mapping is mirrored:
  // the diagram's top edge (max y) is the smaller canvas coordinate.
  const top = editor.viewport.y - y2 * s;
  const bottom = editor.viewport.y - y1 * s;

  // Nothing may be clipped: the diagram is inside the canvas with a margin.
  assert.ok(left >= 8 && left + drawnW <= W - 8, `inside horizontally (${left.toFixed(0)}..${(left + drawnW).toFixed(0)})`);
  assert.ok(top >= 8 && bottom <= H - 8, `inside vertically (${top.toFixed(0)}..${bottom.toFixed(0)})`);
  // And it must actually use the canvas: the limiting dimension comes within a
  // margin of the edge. The old code drew this at 120px tall in a 330px pane.
  assert.ok(
    drawnH >= H - 80,
    `the drawing fills the height it is limited by: ${drawnH.toFixed(0)} of ${H}`
  );
  assert.ok(
    drawnW >= W * 0.45,
    `and a useful share of the width: ${drawnW.toFixed(0)} of ${W}`
  );
  // Centred, since a fit that fills one corner is the other half of the report —
  // horizontally exactly, and vertically nudged UP by the room the labels need
  // below the drawing.
  const cx = ((x1 + x2) / 2) * s + editor.viewport.x;
  assert.ok(Math.abs(cx - W / 2) < 2, `centred horizontally, got ${cx.toFixed(0)}`);
  const topGap = top;
  const bottomGap = H - bottom;
  assert.ok(topGap >= 8 && bottomGap >= 8, `a margin on both sides (${topGap.toFixed(0)}/${bottomGap.toFixed(0)})`);
  assert.ok(
    bottomGap - topGap > 10 && bottomGap - topGap < 30,
    `the drawing sits above centre, by about the room a label needs (${(bottomGap - topGap).toFixed(0)}px)`
  );
  // The room itself, measured: a name is drawn BELOW its symbol and belongs to no
  // extent, so this gap is what keeps the bottom row of names off the edge at a
  // large label size. Dropping the allowance leaves 35px, which is not enough for
  // the 35.5px a 250% label needs plus the 3px it sits below the symbol.
  assert.ok(
    bottomGap >= 40,
    `the fit reserves room under the drawing for the names (${bottomGap.toFixed(0)}px)`
  );

  // And the names under the symbols have to survive the fit. They are drawn BELOW
  // the artwork and belong to no extent, so a fit that fills the height exactly
  // clips the bottom row — which is what the extra room at the bottom is for.
  // Taken from the draw calls rather than from a picture, because the label's
  // place is a number: `fillText` is called with the TOP of the text.
  const labels = [];
  editor.ctx = new Proxy(
    { canvas: { width: W, height: H }, measureText: () => ({ width: 10 }) },
    {
      get(t, k) {
        if (k in t) return t[k];
        // Only the component names: the grid's axis labels and the level-of-detail
        // chip are other text, and neither belongs to a component.
        if (k === "fillText") {
          return (text, lx, ly) => {
            if (model.components.some((c) => c.id === text)) labels.push({ text, y: ly });
          };
        }
        return () => {};
      },
      set() {
        return true;
      },
    }
  );
  SchematicEditor.prototype.draw.call(editor);
  assert.equal(labels.length, model.components.length, "every component is named");
  // The largest the label can be is 13px times the label-size setting (2.5 here),
  // drawn 3px below the artwork.
  const worst = 13 * 2.5 + 3;
  for (const l of labels) {
    assert.ok(
      l.y + worst <= H,
      `"${l.text}" is inside the canvas (its text ends at ${(l.y + worst).toFixed(0)} of ${H})`
    );
  }
  editor.destroy();
});

test("the wire-thickness setting reaches the drawing, and the click area", () => {
  // Asked for as a setting. The weight is a fraction of a symbol's on-screen
  // size, so the setting has to move that whole curve — and the area a wire can
  // be grabbed in has to follow it, or a thick wire looks right and feels wrong.
  const components = [inst("r1", -60, 0), inst("r2", 60, 0)];
  const model = {
    name: "M",
    components,
    connections: [
      { id: "c1", from: { component: "r1", port: "p" }, to: { component: "r2", port: "n" }, points: [] },
    ],
    graphics: [],
  };
  const { editor } = makeEditor(components);
  editor.setModel(model);
  const canvas = canvasOf(editor);
  layoutTo(canvas, 1000, 600);
  editor.resize();

  // Record the weight in force at every `stroke`, then compare the two settings
  // run against run: the grid and the symbols are identical in both, so whatever
  // differs is what the setting moved.
  const strokes = [];
  const recording = (scale) => {
    editor.cb.display = () => ({ labelScale: 1, hoverParameters: false, wireScale: scale });
    editor.ctx = new Proxy(
      { canvas: { width: 1000, height: 600 }, measureText: () => ({ width: 10 }), lineWidth: 1 },
      {
        get(t, k) {
          if (k in t) return t[k];
          if (k === "stroke") return () => strokes.push(t.lineWidth);
          return () => {};
        },
        set(t, k, v) {
          t[k] = v;
          return true;
        },
      }
    );
    strokes.length = 0;
    SchematicEditor.prototype.draw.call(editor);
    return strokes.slice();
  };

  const standard = recording(1);
  const heavy = recording(2.5);
  // And the top of the setting's range: the weight is multiplied AFTER the
  // standard's own clamps, so ten times really is ten times rather than a
  // clamped 8px — which is what the range is for.
  const tenfold = recording(10);
  assert.equal(standard.length, heavy.length, "the same frame, drawn twice");
  assert.equal(standard.length, tenfold.length, "and again");
  const changed = standard
    .map((w, i) => (Math.abs(w - heavy[i]) > 1e-9 ? i : -1))
    .filter((i) => i >= 0);
  assert.ok(changed.length > 0, "something in the frame responds to the setting");
  const ratio = heavy[changed[0]] / standard[changed[0]];
  assert.ok(
    Math.abs(tenfold[changed[0]] / standard[changed[0]] - 10) < 0.01,
    `ten times as heavy at the top of the range (${standard[changed[0]]} -> ${tenfold[changed[0]]})`
  );
  assert.ok(
    Math.abs(ratio - 2.5) < 0.01,
    `the wire is drawn 2.5x as heavy (${standard[changed[0]]} -> ${heavy[changed[0]]})`
  );

  // And the grab radius: a wire 2.5x as thick has to be clickable across its face.
  const hitAt = (y, scale) => {
    editor.cb.display = () => ({ labelScale: 1, hoverParameters: false, wireScale: scale });
    editor.hoveredWire = null;
    // The wire is a segment through the diagram's origin, so the canvas point to
    // ask about is where the viewport puts that origin — not the canvas's middle.
    move(editor, editor.viewport.x, y);
    return editor.hoveredWire;
  };
  // The wire runs between the two components through the diagram's origin, which
  // the viewport maps to `(viewport.x, viewport.y)` in canvas pixels.
  const y = editor.viewport.y;
  assert.equal(hitAt(y, 1), "c1", "a pointer ON the wire hits it");
  assert.ok(!hitAt(y + 22, 1), "22px away is not a hit at the standard weight");
  assert.equal(hitAt(y + 22, 4), "c1", "and it is at four times the weight");
  editor.destroy();
});

test("a component dropped from the palette lands under the pointer", () => {
  // Reported: "when I drop a component from the palette, it doesn't drop where my
  // mouse is — there is a y offset". The studio had its own copy of the
  // client-to-diagram arithmetic and it omitted the y flip, so a drop landed at the
  // MIRRORED height: off by twice its distance from the viewport origin, and upside
  // down. The mapping belongs to the canvas, and this measures it as one.
  const { editor } = makeEditor();
  const canvas = canvasOf(editor);
  layoutTo(canvas, 900, 600);
  editor.resize();

  // A canvas whose CSS box is half its internal size, so the CSS-to-internal scale
  // is exercised too: `pointerLocal` divides by it, and the studio's copy ignored it.
  const rect = { left: 40, top: 90, width: 450, height: 300 };
  canvas.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height });
  editor.viewport.scale = 2;
  editor.viewport.x = 400;
  editor.viewport.y = 200;

  // Where a client point should land, worked out from the same three facts the
  // drawing uses: the canvas box, the CSS scale, and +y pointing UP.
  const expect = (clientX, clientY) => [
    ((clientX - rect.left) * (900 / rect.width) - 400) / 2,
    ((clientY - rect.top) * (600 / rect.height) - 200) / -2,
  ];

  const points = [
    [rect.left + 100, rect.top + 60],
    [rect.left + 225, rect.top + 150],
    [rect.left + 400, rect.top + 260],
  ];
  const wrong = [];
  for (const [cx, cy] of points) {
    const [dx, dy] = editor.toDiagram({ clientX: cx, clientY: cy });
    const [ex, ey] = expect(cx, cy);
    if (Math.abs(dx - ex) > 0.01 || Math.abs(dy - ey) > 0.01) {
      wrong.push(`(${cx},${cy}) -> (${dx.toFixed(1)},${dy.toFixed(1)}) instead of (${ex.toFixed(1)},${ey.toFixed(1)})`);
    }
  }
  assert.deepEqual(wrong, [], "the mapping is the drawing's, mirrored y included");

  // And the point ABOVE the viewport origin must come out POSITIVE, which is the
  // sign the studio's copy had backwards. Stated separately because it is the whole
  // bug: everything else can be right while this is inverted.
  // 40 CSS px below the box top is 80 internal px, against a viewport origin at 200:
  // i.e. 120 internal px ABOVE the origin, which is +60 diagram units.
  const above = editor.toDiagram({ clientX: rect.left + 225, clientY: rect.top + 40 });
  assert.ok(
    above[1] > 0,
    `a point above the viewport origin is a positive diagram y, got ${above[1].toFixed(1)}`
  );

  // A real drop, through the same call the studio makes: the component's centre
  // lands on the pointer, up to the grid it snaps to.
  const [dx, dy] = editor.toDiagram({ clientX: rect.left + 300, clientY: rect.top + 120 });
  // Whatever class the fixture's lookup can resolve.
  const className = editor.model.components[0].className;
  const inst = editor.addComponent(className, dx, dy);
  assert.ok(inst, "the component was added");
  const [x1, y1, x2, y2] = inst.placement.extent;
  const cxs = (x1 + x2) / 2;
  const cys = (y1 + y2) / 2;
  const GRID = 10;
  assert.ok(
    Math.abs(cxs - dx) <= GRID && Math.abs(cys - dy) <= GRID,
    `the symbol is at the pointer, within one grid step (dropped ${dx.toFixed(1)},${dy.toFixed(1)}; ` +
      `placed ${cxs},${cys})`
  );
  // Not merely close: on the same side of the origin, which a mirrored placement is not.
  assert.equal(Math.sign(cys), Math.sign(dy) || Math.sign(cys), `placed above/below as dropped (${cys} vs ${dy.toFixed(1)})`);

  // The view centre uses the same transform, and is what the palette's Enter and
  // double-click place at.
  const [vcx, vcy] = editor.viewCentre();
  assert.ok(
    Math.abs(vcx - (900 / 2 - 400) / 2) < 0.01 && Math.abs(vcy - (600 / 2 - 200) / -2) < 0.01,
    `the view centre is the middle of the canvas (${vcx.toFixed(1)},${vcy.toFixed(1)})`
  );
  editor.destroy();
});

test("every committed edit asks for a repaint", () => {
  // Reported: rotating with R "lags more than a second". The model changed at
  // once; the CANVAS did not, because rotation was the one edit that neither
  // moved the selection nor asked for a frame — and `setSelection` is what had
  // been requesting one for paste, delete and add. The picture therefore stayed
  // as it was until the pointer moved, so the rotation appeared when the next
  // hover repainted.
  //
  // The assertion is the general one, over every edit entry point, because the
  // bug was a missing frame rather than a broken rotation.
  const frames = [];
  const realRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => {
    frames.push(cb);
    return frames.length;
  };
  const painted = () => frames.length;
  // The editor coalesces: a request while one is pending is dropped, which is
  // what keeps a drag to one frame. So a test has to RUN the frames it records,
  // or every case after the first would be swallowed by the pending one.
  const drain = () => {
    for (const cb of frames.splice(0)) cb();
  };

  const { editor } = makeEditor();
  const canvas = canvasOf(editor);
  layoutTo(canvas, 900, 600);
  editor.resize();
  const id = editor.model.components[0]?.id;
  assert.ok(id, `the fixture has a component to edit (${editor.model.components.length})`);
  // Selected, because rotation and nudging act on the selection: with nothing
  // selected they are correctly no-ops, which would pass for the wrong reason.
  editor.setSelection([id, ...editor.model.components.slice(1).map((c) => c.id)]);

  const cases = [
    ["rotate", () => editor.rotateSelection(90)],
    ["nudge", () => editor.nudge(10, 0)],
    // A selection that actually CHANGES: selecting the same set again is
    // correctly a no-op, and would pass for the wrong reason.
    ["re-select", () => editor.setSelection([id])],
    ["set a parameter", () => editor.setParam(id, "R", "220")],
    ["rename", () => editor.renameInstance(id, "renamed")],
    // These replace or extend the model rather than editing in place, so they are
    // the other places a repaint could be forgotten.
    ["delete", () => editor.deleteSelection()],
    ["undo", () => editor.undo()],
    ["redo", () => editor.redo()],
  ];
  const missing = [];
  for (const [what, run] of cases) {
    drain();
    frames.length = 0;
    run();
    if (painted() === 0) missing.push(what);
  }

  // And a burst coalesces: five rotations in one frame ask for one repaint.
  drain();
  editor.setSelection(editor.model.components.map((c) => c.id));
  drain();
  frames.length = 0;
  for (let i = 0; i < 5; i++) editor.rotateSelection(90);
  const burst = painted();

  globalThis.requestAnimationFrame = realRaf;
  editor.destroy();

  assert.deepEqual(missing, [], "every edit asks for a frame");
  assert.equal(burst, 1, `a burst of five rotations is one frame (${burst})`);
  void id;
});

test("a rotation is visible in the next frame it asks for", () => {
  // The end of the same story: the frame that rotation asks for must actually
  // draw the rotated symbol, not the one before it.
  const frames = [];
  const realRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => {
    frames.push(cb);
    return frames.length;
  };

  const { editor } = makeEditor();
  const canvas = canvasOf(editor);
  layoutTo(canvas, 900, 600);
  editor.resize();
  editor.addComponent?.("Resistor", 0, 0);
  const id = editor.model.components[0]?.id;
  assert.ok(id, "the fixture has a component");

  /** The strokes a frame paints, so two frames can be told apart. */
  const paint = () => {
    const strokes = [];
    let m = 1;
    editor.ctx = new Proxy(
      { canvas: { width: 900, height: 600 }, measureText: () => ({ width: 10 }), lineWidth: 1 },
      {
        get(t, k) {
          if (k in t) return t[k];
          if (k === "setTransform") {
            return (...args) => {
              const mat = args.length === 1 ? args[0] : { a: args[0], b: args[1] };
              m = Math.hypot(mat.a ?? 1, mat.b ?? 0) || 1;
            };
          }
          if (k === "lineTo" || k === "moveTo") {
            return (x, y) => strokes.push([Math.round(x * m), Math.round(y * m)]);
          }
          return () => {};
        },
        set(t, k, v) {
          t[k] = v;
          return true;
        },
      }
    );
    SchematicEditor.prototype.draw.call(editor);
    return strokes.map((p) => p.join(",")).join(" ");
  };

  editor.setSelection([id]);
  for (const cb of frames.splice(0)) cb();
  const before = paint();
  frames.length = 0;
  editor.rotateSelection(90);
  assert.equal(frames.length, 1, "the rotation asked for a frame");
  // Run the frame it asked for, then paint by hand: what the frame WOULD draw.
  for (const cb of frames.splice(0)) cb();
  const after = paint();
  globalThis.requestAnimationFrame = realRaf;
  editor.destroy();

  assert.notEqual(after, before, "and the frame it asked for draws something different");
});

test("the component names can be hidden, and only the names", () => {
  // For a course note a diagram is a picture of a circuit, and twenty copies of
  // "resistor1" are noise. Off, the SYMBOL is untouched: the library's own in-box
  // text and the label inside a placeholder box are part of the drawing, not
  // labels beside it.
  const sym = {
    name: "P.Sym",
    shortName: "Sym",
    icon: [
      { kind: "Rectangle", extent: [-10, -10, 10, 10], lineColor: [120, 0, 0] },
      // The library's own readout, inside the symbol's box.
      { kind: "Text", extent: [-8, 4, 8, -4], textString: "R=100" },
    ],
    ports: [],
    parameters: [],
    hasIcon: true,
  };
  const DEFS5 = { "P.A": sym, "P.Bare": { name: "P.Bare", shortName: "Bare", icon: [], ports: [], parameters: [], hasIcon: false } };

  const textsDrawn = (instanceLabels) => {
    const h = new StubElement("div");
    const ed = new SchematicEditor(
      h,
      {
        name: "M",
        components: [
          { id: "motor", className: "P.A", placement: { extent: [-60, -20, -20, 20], rotation: 0, visible: true }, params: {} },
          { id: "helper", className: "P.Bare", placement: { extent: [20, -20, 60, 20], rotation: 0, visible: true }, params: {} },
        ],
        connections: [],
        graphics: [],
      },
      {
        lookup: (n) => DEFS5[n],
        onChange: () => {},
        onSelectionChange: () => {},
        onStatus: () => {},
        display: () => ({ labelScale: 1, hoverParameters: false, instanceLabels }),
      }
    );
    const c = canvasOf(ed);
    layoutTo(c, 1000, 600);
    ed.resize();
    const out = [];
    let font = "";
    ed.ctx = new Proxy(
      { canvas: { width: 1000, height: 600 }, measureText: () => ({ width: 10 }), lineWidth: 1 },
      {
        get(t, k) {
          if (k in t) return t[k];
          if (k === "fillText") return (text) => out.push({ text: String(text), font });
          return () => {};
        },
        set(t, k, v) {
          if (k === "font") font = String(v);
          t[k] = v;
          return true;
        },
      }
    );
    SchematicEditor.prototype.draw.call(ed);
    ed.destroy();
    return out;
  };

  const shown = textsDrawn(true).map((t) => t.text);
  const hidden = textsDrawn(false).map((t) => t.text);

  assert.ok(shown.includes("motor"), `the name is drawn by default (${shown.join(", ")})`);
  assert.ok(shown.includes("R=100"), "and the library's own in-box text with it");
  assert.ok(!hidden.includes("motor"), `the name is gone when hidden (${hidden.join(", ")})`);
  assert.ok(
    hidden.includes("R=100"),
    `but the symbol's own text stays — it is part of the drawing (${hidden.join(", ")})`
  );
  assert.ok(
    hidden.some((t) => t.includes("helper") || t.includes("Bare")),
    `and a component with no icon still says which it is (${hidden.join(", ")})`
  );
});

test("the editor applies the thickness link itself", () => {
  // The link is a rule about how the two settings COMBINE, so it is resolved
  // where the drawing happens. A surface that forgot to apply it would draw a
  // different diagram from the same settings, which is the class of bug this
  // session kept producing.
  const sym = {
    name: "P.Sym",
    shortName: "Sym",
    icon: [{ kind: "Rectangle", extent: [-10, -10, 10, 10], lineColor: [120, 0, 0] }],
    ports: [{ name: "sig", type: "Pin", connectorClass: "P.Wire", isFlow: false, causality: "acausal" }],
    portPositions: { sig: [100, 0] },
    parameters: [],
    hasIcon: true,
  };
  const DEFS4 = {
    "P.A": sym,
    "P.B": { ...sym, name: "P.B" },
    "P.Wire": {
      name: "P.Wire",
      shortName: "Wire",
      icon: [{ kind: "Rectangle", extent: [-20, -2, 20, 2], lineColor: [0, 0, 200] }],
      ports: [],
      parameters: [],
      hasIcon: true,
    },
  };
  const components = [
    { id: "a", className: "P.A", placement: { extent: [-160, -20, -120, 20], rotation: 0, visible: true }, params: {} },
    { id: "b", className: "P.B", placement: { extent: [120, -20, 160, 20], rotation: 0, visible: true }, params: {} },
  ];
  const connections = [
    { id: "c1", from: { component: "a", port: "sig" }, to: { component: "b", port: "sig" }, points: [] },
  ];

  /** Draw with these display settings and report the two stroke weights. */
  const widths = (display) => {
    const h = new StubElement("div");
    const ed = new SchematicEditor(
      h,
      { name: "M", components, connections, graphics: [] },
      {
        lookup: (n) => DEFS4[n],
        onChange: () => {},
        onSelectionChange: () => {},
        onStatus: () => {},
        display: () => ({ labelScale: 1, hoverParameters: false, ...display }),
      }
    );
    const c = canvasOf(ed);
    layoutTo(c, 1000, 600);
    ed.resize();
    const seen = [];
    let width = 1;
    let style = "";
    ed.ctx = new Proxy(
      { canvas: { width: 1000, height: 600 }, measureText: () => ({ width: 10 }), lineWidth: 1 },
      {
        get(t, k) {
          if (k in t) return t[k];
          if (k === "stroke") return () => seen.push({ w: width, style });
          return () => {};
        },
        set(t, k, v) {
          if (k === "lineWidth") width = v;
          if (k === "strokeStyle") style = String(v);
          t[k] = v;
          return true;
        },
      }
    );
    SchematicEditor.prototype.draw.call(ed);
    ed.destroy();
    const wire = seen.find((st) => st.style === "rgb(0,0,200)");
    const symbol = seen.find((st) => st.style === "rgb(120,0,0)");
    assert.ok(wire && symbol, "both were stroked");
    return { wire: wire.w, symbol: symbol.w };
  };

  // The two weights are not proportional to each other at every setting — each is
  // clamped for its own legibility, and the fixture's symbol sits on its floor —
  // so the claims are about which VALUE reaches the wire, not about a ratio.
  const base = widths({ wireScale: 1, symbolStrokeScale: 1, syncStrokeScale: false });
  const heavy = widths({ wireScale: 3, symbolStrokeScale: 1, syncStrokeScale: false });
  assert.ok(
    Math.abs(heavy.wire - 3 * base.wire) < 1e-9,
    `unlinked: the wire slider scales the wire (${base.wire} -> ${heavy.wire})`
  );
  assert.ok(
    Math.abs(heavy.symbol - base.symbol) < 1e-9,
    "and leaves the component lines alone"
  );

  const linked = widths({ wireScale: 3, symbolStrokeScale: 1, syncStrokeScale: true });
  assert.ok(
    Math.abs(linked.wire - base.wire) < 1e-9,
    `linked: the wire ignores its own value and takes the component's (${linked.wire}, was ${heavy.wire})`
  );
  assert.ok(
    Math.abs(linked.symbol - base.symbol) < 1e-9,
    "linking does not change the component lines themselves"
  );
});

test("a wire and a symbol declaring the same thickness are the same weight", () => {
  // The reason the two settings can be spoken of together at all. MSL's
  // `thickness` is ONE scale: a connector that asks for 0.5 draws a double line,
  // and a graphic that asks for 0.5 draws a line of the same weight. The two used
  // to have their own curves, and a wire came out 1.47x the weight of a symbol
  // line declaring exactly the same thing — so the library's ratios held inside a
  // symbol and not between a symbol and its wires.
  const symbol = (thickness) => ({
    name: "P.Sym" + thickness,
    shortName: "Sym",
    icon: [
      { kind: "Rectangle", extent: [-10, -10, 10, 10], lineColor: [120, 0, 0], lineThickness: thickness },
    ],
    ports: [
      { name: "sig", type: "Pin", connectorClass: "P.Wire", isFlow: false, causality: "acausal" },
    ],
    portPositions: { sig: [100, 0] },
    parameters: [],
    hasIcon: true,
  });
  // The connector declares the thickness the wire is drawn at.
  const DEFS3 = {
    "P.A": symbol(0.5),
    "P.B": symbol(0.5),
    "P.Wire": {
      name: "P.Wire",
      shortName: "Wire",
      icon: [{ kind: "Rectangle", extent: [-20, -2, 20, 2], lineColor: [0, 0, 200], lineThickness: 0.5 }],
      ports: [],
      parameters: [],
      hasIcon: true,
    },
  };
  const components = [
    // Extents equal to the class's canonical box, so the placement transform is
    // 1:1 and the symbol is drawn at the reference size the wire's weight is
    // defined against. A symbol scaled DOWN is drawn thinner on purpose — its
    // strokes follow its own on-screen size — so comparing at any other size
    // would be comparing two different things.
    { id: "a", className: "P.A", placement: { extent: [-260, -100, -60, 100], rotation: 0, visible: true }, params: {} },
    { id: "b", className: "P.B", placement: { extent: [60, -100, 260, 100], rotation: 0, visible: true }, params: {} },
  ];
  const connections = [
    { id: "c1", from: { component: "a", port: "sig" }, to: { component: "b", port: "sig" }, points: [] },
  ];

  /** The screen width of the symbol's own stroke, and of the wire, at this zoom. */
  const widthsAt = (zoom) => {
    const h = new StubElement("div");
    const ed = new SchematicEditor(
      h,
      { name: "M", components, connections, graphics: [] },
      {
        lookup: (n) => DEFS3[n],
        onChange: () => {},
        onSelectionChange: () => {},
        onStatus: () => {},
        display: () => ({ labelScale: 1, hoverParameters: false, wireScale: 1, symbolStrokeScale: 1 }),
      }
    );
    const c = canvasOf(ed);
    layoutTo(c, 1000, 600);
    ed.resize();
    ed.viewport.scale = zoom;
    ed.viewport.x = 500;
    ed.viewport.y = 300;
    // `setTransform(a, b, ...)` carries the scale each stroke is drawn under, so
    // the width in screen pixels is `lineWidth x that` — and the wire's own
    // transform is identity, so its width is already on screen.
    const seen = [];
    let width = 1;
    let scale = 1;
    let style = "";
    ed.ctx = new Proxy(
      { canvas: { width: 1000, height: 600 }, measureText: () => ({ width: 10 }), lineWidth: 1 },
      {
        get(t, k) {
          if (k in t) return t[k];
          if (k === "setTransform") {
            return (...args) => {
              // `setTransform(matrix)` is how a symbol's own transform arrives;
              // `setTransform(a, b, c, d, e, f)` is the canvas one.
              const m = args.length === 1 ? args[0] : { a: args[0], b: args[1] };
              scale = Math.hypot(m.a ?? 1, m.b ?? 0) || 1;
            };
          }
          if (k === "stroke") return () => seen.push({ w: width * scale, style });
          return () => {};
        },
        set(t, k, v) {
          if (k === "lineWidth") width = v;
          if (k === "strokeStyle") style = String(v);
          t[k] = v;
          return true;
        },
      }
    );
    SchematicEditor.prototype.draw.call(ed);
    ed.destroy();
    // By colour, so nothing depends on the order the frame draws in.
    const of = (rgb) => seen.find((st) => st.style === rgb);
    const wire = of("rgb(0,0,200)");
    const sym = of("rgb(120,0,0)");
    assert.ok(wire && sym, `both were stroked (${seen.map((st) => st.style).join(", ")})`);
    return { wire: wire.w, symbol: sym.w };
  };

  for (const zoom of [0.5, 1, 2]) {
    const { wire, symbol: sym } = widthsAt(zoom);
    assert.ok(
      Math.abs(wire - sym) < 1e-9,
      `at zoom ${zoom} a wire declaring 0.5 is ${wire.toFixed(2)}px and a symbol declaring 0.5 is ${sym.toFixed(2)}px`
    );
  }
});

test("the component-line setting scales the symbols' own weights", () => {
  // Asked for as "the ability to adjust the thickness of the lines of the
  // components themselves". Every symbol stroke resolves its weight in one place,
  // so the setting scales that whole curve — clamps included, which is the point:
  // without scaling the cap it would do nothing above 200% zoom, where every
  // graphic already sits at the ceiling.
  const { editor } = makeEditor();
  const canvas = canvasOf(editor);
  layoutTo(canvas, 1000, 600);
  editor.resize();

  // The fixture's class draws one Rectangle, and its icon is 140x60 inside a
  // 40x40 extent, so the drawn stroke is the graphic's own weight.
  const widthsAt = (scale) => {
    const strokes = [];
    editor.cb.display = () => ({
      labelScale: 1,
      hoverParameters: false,
      wireScale: 1,
      symbolStrokeScale: scale,
    });
    editor.ctx = new Proxy(
      { canvas: { width: 1000, height: 600 }, measureText: () => ({ width: 10 }), lineWidth: 1 },
      {
        get(t, k) {
          if (k in t) return t[k];
          // The SYMBOL's stroke is the one drawn inside the viewport transform, so
          // its `lineWidth` is in pre-transform units: multiply by the zoom to get
          // what lands on screen.
          if (k === "stroke") return () => strokes.push({ w: t.lineWidth, m: t.__m ?? 1 });
          // `setTransform(a, b, ...)` is how the symbol's own transform arrives.
          if (k === "setTransform") {
            return (a, b) => {
              const m = Math.hypot(a, b);
              if (m > 1.5) t.__m = m; // the symbol pass, not the identity one
            };
          }
          return () => {};
        },
        set(t, k, v) {
          t[k] = v;
          return true;
        },
      }
    );
    strokes.length = 0;
    SchematicEditor.prototype.draw.call(editor);
    // The heaviest screen weight in the frame: the symbol's outline.
    return Math.max(...strokes.map((st) => st.w * st.m));
  };

  const at100 = widthsAt(1);
  const at200 = widthsAt(2);
  const at400 = widthsAt(4);
  assert.ok(at100 > 0, `the symbol is stroked (${at100})`);
  assert.ok(
    Math.abs(at200 / at100 - 2) < 0.05,
    `twice the setting is twice the weight (${at100.toFixed(2)} -> ${at200.toFixed(2)})`
  );
  assert.ok(
    Math.abs(at400 / at100 - 4) < 0.05,
    `and four times is four times (${at100.toFixed(2)} -> ${at400.toFixed(2)})`
  );
  editor.destroy();
});

test("the setting reaches the symbols and their pins, not the wires", () => {
  // The pins are drawn outside the graphic path, with fixed screen weights, so
  // they have to be told; and the wires have their OWN setting, which this one
  // must leave alone.
  const { editor } = makeEditor();
  const canvas = canvasOf(editor);
  layoutTo(canvas, 1000, 600);
  editor.resize();
  editor.showPorts = true;

  const rings = [];
  const pending = [];
  const strokeWidths = (symbolStrokeScale) => {
    const widths = [];
    editor.cb.display = () => ({
      labelScale: 1,
      hoverParameters: false,
      wireScale: 1,
      symbolStrokeScale,
    });
    editor.ctx = new Proxy(
      { canvas: { width: 1000, height: 600 }, measureText: () => ({ width: 10 }), lineWidth: 1 },
      {
        get(t, k) {
          if (k in t) return t[k];
          // A pin ring is an arc, filled, then stroked: the stroke that follows an
          // arc is the ring's own width.
          if (k === "arc") {
            return () => {
              pending.push(true);
            };
          }
          if (k === "stroke") {
            return () => {
              const afterArc = pending.pop() === true;
              if (afterArc) rings.push(t.lineWidth);
              widths.push({ kind: afterArc ? "ring" : "stroke", w: t.lineWidth });
            };
          }
          return () => {};
        },
        set(t, k, v) {
          t[k] = v;
          return true;
        },
      }
    );
    widths.length = 0;
    rings.length = 0;
    pending.length = 0;
    SchematicEditor.prototype.draw.call(editor);
    return { all: widths, rings: rings.slice() };
  };

  const one = strokeWidths(1);
  const four = strokeWidths(4);
  // The ring weights (1.25 and 1.5 in the fixture) scale by four; the wire's 2
  // (its own setting is 1 in both) does not.
  assert.ok(
    one.rings.some((w) => Math.abs(w - 1.25) < 1e-9),
    `a pin ring is 1.25px at the standard setting (${one.rings.join(", ")})`
  );
  assert.ok(
    four.rings.some((w) => Math.abs(w - 5) < 1e-9),
    `and 5px at four times it (${four.rings.join(", ")})`
  );
  editor.destroy();
});

test("a connection is drawn as MSL says its connector declares", () => {
  // The rule reaches the drawing: a wire to a bus connector is the bus colour at
  // double width, a wire to a plain connector keeps the theme colour at one, and
  // an annotation written on the connect clause still wins over both.
  const classDef = (name, icon, ports) => ({
    name,
    shortName: name.split(".").pop(),
    icon,
    ports,
    parameters: [],
    hasIcon: true,
  });
  // The resistor-like class the fixture components use, with one port whose
  // connector class is the bus, and one whose connector is a plain pin.
  const busConnector = classDef("P.Bus", [
    { kind: "Rectangle", extent: [-20, -2, 20, 2], lineColor: [255, 204, 51], lineThickness: 0.5 },
  ], []);
  const pinConnector = classDef("P.Pin", [
    { kind: "Rectangle", extent: [-100, 100, 100, -100], lineColor: [0, 0, 255], fillPattern: "Solid" },
  ], []);
  const host = classDef("P.Host", [
    { kind: "Rectangle", extent: [-10, -10, 10, 10], lineColor: [0, 0, 0] },
  ], [
    { name: "bus", type: "Bus", connectorClass: "P.Bus", isFlow: false, causality: "acausal" },
    { name: "sig", type: "Pin", connectorClass: "P.Pin", isFlow: false, causality: "acausal" },
  ]);
  const DEFS2 = { "P.Host": host, "P.Bus": busConnector, "P.Pin": pinConnector };

  const components = [
    { id: "a", className: "P.Host", placement: { extent: [-60, -20, -20, 20], rotation: 0, visible: true }, params: {} },
    { id: "b", className: "P.Host", placement: { extent: [20, -20, 60, 20], rotation: 0, visible: true }, params: {} },
  ];

  /** Draw a model and report the wire strokes: colour and weight per connection. */
  const strokesFor = (connections) => {
    const h = new StubElement("div");
    const ed = new SchematicEditor(
      h,
      { name: "M", components, connections, graphics: [] },
      {
        lookup: (n) => DEFS2[n],
        onChange: () => {},
        onSelectionChange: () => {},
        onStatus: () => {},
        display: () => ({ labelScale: 1, hoverParameters: false, wireScale: 1, symbolStrokeScale: 1 }),
      }
    );
    const c = canvasOf(ed);
    layoutTo(c, 1000, 600);
    ed.resize();
    // The wire is the FIRST stroke after the grid, as the drawing order is
    // grid → connections → symbols.
    const seen = [];
    let style = "";
    let width = 1;
    ed.ctx = new Proxy(
      { canvas: { width: 1000, height: 600 }, measureText: () => ({ width: 10 }), lineWidth: 1 },
      {
        get(t, k) {
          if (k in t) return t[k];
          if (k === "stroke") return () => seen.push({ style, width });
          return () => {};
        },
        set(t, k, v) {
          if (k === "strokeStyle") style = String(v);
          if (k === "lineWidth") width = v;
          t[k] = v;
          return true;
        },
      }
    );
    SchematicEditor.prototype.draw.call(ed);
    ed.destroy();
    return seen;
  };

  // The frame strokes the grid first, so identify it once and ignore it: the
  // wire is the stroke that is not the grid.
  const grid = strokesFor([])[0];
  const wireIn = (seen) => seen.find((st) => st.style !== grid.style) ?? seen[0];

  const busWire = strokesFor([
    { id: "c1", from: { component: "a", port: "bus" }, to: { component: "b", port: "bus" }, points: [] },
  ]);
  const pinWire = strokesFor([
    { id: "c2", from: { component: "a", port: "sig" }, to: { component: "b", port: "sig" }, points: [] },
  ]);
  const annotated = strokesFor([
    {
      id: "c3",
      from: { component: "a", port: "bus" },
      to: { component: "b", port: "bus" },
      points: [],
      color: [1, 2, 3],
    },
  ]);

  const bus = wireIn(busWire);
  const pin = wireIn(pinWire);
  assert.ok(bus && pin, "wires were stroked");
  // The connector's colour and double width for the bus. Not the library's raw
  // {255,204,51}: as a LINE on a pale canvas that is 1.46:1, which is a wire you
  // cannot see, so the wire floor darkens it and leaves it a yellow. This page is
  // the light theme; on a dark canvas the library's own value is used unchanged.
  assert.equal(bus.style, "rgb(166,133,33)", "the bus colour, legible on this canvas");
  assert.ok(
    Math.abs(bus.width - 2 * pin.width) < 1e-9,
    `double width (${pin.width} -> ${bus.width})`
  );
  // … the domain colour at a single width for the pin …
  assert.equal(pin.style, "rgb(0,0,255)", "the pin colour");
  // … and the annotation on the connect clause wins over the connector.
  assert.equal(wireIn(annotated).style, "rgb(1,2,3)", "the written annotation wins");
});

test("a wire never grows fatter on screen as the diagram shrinks", () => {
  // Reported from two screenshots: zoomed in, the wires looked right; zoomed out,
  // they covered the symbols they connect. The cause was the stroke being divided
  // by the zoom AFTER the clamps were applied: `clamp(2.2 x zoom, 1.2, 8) / zoom`
  // is inversely proportional to the zoom, so the further out you go the FATTER
  // every wire gets on screen — 1.2px at 100% became 12px at 10%.
  //
  // The drawn width is what matters here, so the test reads the width the wire is
  // actually stroked with: `drawConnection` sets the transform to identity and
  // puts the points in device pixels, so `lineWidth` IS the on-screen width.
  // Two components, because a wire's route is resolved from its ports, plus the
  // one connection between them. The frame strokes in a fixed order — the grid,
  // then the connections, then the symbols — so the wire is the stroke after the
  // grid's, whatever else the frame contains.
  const components = [inst("r1", 0, 0), inst("r2", 200, 0)];
  const model = {
    name: "M",
    components,
    connections: [
      { id: "c1", from: { component: "r1", port: "p" }, to: { component: "r2", port: "n" }, points: [] },
    ],
    graphics: [],
  };
  const { editor } = makeEditor(components);
  editor.setModel(model);
  const canvas = canvasOf(editor);
  layoutTo(canvas, 1000, 600);
  editor.resize();
  editor.cb.display = () => ({ labelScale: 1, hoverParameters: false, wireScale: 1 });

  /** The weights stroked in one frame at `zoom`, with and without the wire. */
  const frame = (zoom, withWire) => {
    const strokes = [];
    editor.ctx = new Proxy(
      { canvas: { width: 1000, height: 600 }, measureText: () => ({ width: 10 }), lineWidth: 1 },
      {
        get(t, k) {
          if (k in t) return t[k];
          if (k === "stroke") return () => strokes.push(t.lineWidth);
          return () => {};
        },
        set(t, k, v) {
          t[k] = v;
          return true;
        },
      }
    );
    editor.setModel(withWire ? model : { ...model, connections: [] });
    editor.viewport.scale = zoom;
    editor.viewport.x = 500;
    editor.viewport.y = 300;
    strokes.length = 0;
    SchematicEditor.prototype.draw.call(editor);
    return strokes;
  };

  /**
   * The width the wire is stroked with at this zoom.
   *
   * Two frames, identical but for the connection: whatever differs is the wire,
   * whatever the grid did (it hides itself when zoomed far enough out) and
   * whatever the symbols stroke.
   */
  const wireWidthAt = (zoom) => {
    const withWire = frame(zoom, true);
    const without = frame(zoom, false);
    const i = withWire.findIndex(
      (w, k) => without[k] === undefined || Math.abs(w - without[k]) > 1e-9
    );
    assert.ok(i >= 0, `the wire is in the frame at zoom ${zoom} (${withWire.join(", ")})`);
    return withWire[i];
  };

  const zooms = [0.1, 0.4, 0.8, 1, 2, 4];
  const widths = zooms.map((z) => wireWidthAt(z));
  const table = zooms.map((z, i) => `${z}:${widths[i].toFixed(2)}`).join(" ");

  // The weight follows the symbols down to a floor and up to a cap, and never
  // moves the other way: it is non-decreasing in the zoom, always.
  for (let i = 1; i < widths.length; i++) {
    assert.ok(
      widths[i] >= widths[i - 1] - 1e-9,
      `the wire never thins as the diagram grows (${table})`
    );
  }
  assert.ok(
    Math.abs(widths[0] - MIN_STROKE_PX) < 1e-9,
    `zoomed far out it stops at the floor (${widths[0]} of ${MIN_STROKE_PX})`
  );
  assert.ok(
    Math.abs(widths[zooms.indexOf(1)] - WIRE_WIDTH_PX) < 1e-9,
    `at 100% it is the standard weight (${widths[zooms.indexOf(1)]} of ${WIRE_WIDTH_PX})`
  );
  assert.ok(
    Math.abs(widths[widths.length - 1] - MAX_STROKE_PX) < 1e-9,
    `and zoomed in it stops at the cap (${widths[widths.length - 1]} of ${MAX_STROKE_PX})`
  );
  // The regression in one number: a wire must not be fatter on screen when the
  // diagram is smaller. This was 12px at 0.1 against 2.2px at 1.
  assert.ok(widths[0] < widths[zooms.indexOf(1)], `ten times out is thinner (${table})`);
  editor.destroy();
});

test("the parameter popup has its own size, separate from the labels", () => {
  // Asked for separately: the name under a symbol is read at a glance while the
  // popup is read deliberately, so wanting one larger says nothing about the
  // other. The popup used to follow the label size.
  const { editor } = makeEditor();
  const canvas = canvasOf(editor);
  layoutTo(canvas, 1000, 600);
  editor.resize();
  editor.hovered = "r1";

  const fonts = [];
  const recording = (labelScale, readoutScale) => {
    editor.cb.display = () => ({
      labelScale,
      hoverParameters: true,
      readoutScale,
      wireScale: 1,
    });
    editor.ctx = new Proxy(
      { canvas: { width: 1000, height: 600 }, measureText: (s) => ({ width: String(s).length * 6 }) },
      {
        get(t, k) {
          if (k in t) return t[k];
          return () => {};
        },
        set(t, k, v) {
          if (k === "font" && /px /.test(String(v))) fonts.push(String(v));
          t[k] = v;
          return true;
        },
      }
    );
    fonts.length = 0;
    SchematicEditor.prototype.draw.call(editor);
    return fonts.slice();
  };

  // The popup's body font is the monospace one it prints the parameters with.
  const bodyOf = (list) => list.filter((f) => f.includes("monospace")).pop();
  const standard = bodyOf(recording(1, 1));
  const bigger = bodyOf(recording(1, 2));
  assert.ok(standard && bigger, `the popup was drawn at both sizes (${standard} / ${bigger})`);
  assert.match(standard, /^12px monospace$/, "12px at the standard size");
  assert.match(bigger, /^24px monospace$/, "and 24px at twice it");

  // And the label size no longer moves it: only the popup's own setting does.
  const labelsBig = bodyOf(recording(2.5, 1));
  assert.equal(labelsBig, "12px monospace", "a large label size leaves the popup alone");
  editor.destroy();
});

test("coordinate diagnostics are off by default", () => {
  // They are a debugging aid, not something a user should meet on first run.
  // A stray overlay is a visual bug in its own right: the earlier always-on
  // version drew boxes and callouts over every diagram.
  const { editor } = makeEditor();
  assert.equal(editor.showProbe, false, "diagnostics must default to off");
  editor.destroy();
});

test("the debug overlay can be switched on and off at runtime", () => {
  // It is driven by a setting, so it must be togglable on a live editor rather
  // than only at construction.
  const { editor } = makeEditor();
  editor.showProbe = true;
  assert.equal(editor.showProbe, true);
  // Drawing with the overlay on must not throw.
  editor.requestDraw();
  editor.showProbe = false;
  editor.requestDraw();
  assert.equal(editor.showProbe, false);
  editor.destroy();
});

test("the click marker is drawn where the click actually landed", () => {
  // The marker exists to show where the editor interpreted a press. It was drawn
  // under the identity transform while its coordinates are CSS pixels, so it
  // appeared at 1/dpr of its true position — a diagnostic that lied about the
  // very thing it was added to diagnose.
  const { editor } = makeEditor();
  const canvas = canvasOf(editor);

  for (const dpr of [1, 1.25, 2]) {
    globalThis.window.devicePixelRatio = dpr;
    layoutTo(canvas, 1200, 800);
    editor.resize();

    const client = { clientX: 700, clientY: 500, button: 1, shiftKey: false,
      ctrlKey: false, metaKey: false, altKey: false };
    editor.showProbe = true;
    canvas.dispatch("pointerdown", client);

    // The stored probe point is canvas-local CSS pixels.
    const probe = editor["probePoint"];
    assert.ok(probe, `dpr ${dpr}: a press must record a marker`);

    // Converted back to client coordinates it must match the click.
    const backX = probe.x + canvas.getBoundingClientRect().left;
    const backY = probe.y + canvas.getBoundingClientRect().top;
    assert.ok(
      Math.abs(backX - client.clientX) < 0.5 && Math.abs(backY - client.clientY) < 1.5,
      `dpr ${dpr}: marker at (${backX.toFixed(1)}, ${backY.toFixed(1)}) ` +
        `must match the click at (${client.clientX}, ${client.clientY})`
    );
  }
  globalThis.window.devicePixelRatio = 1;
  editor.showProbe = false;
  editor.destroy();
});

test("a fit requested before layout is retried, not dropped", async () => {
  // An inline diagram in a note asks for a fit from `requestAnimationFrame`,
  // which fires before the block has been measured. Dropping the request there
  // left the diagram neither framed nor drawn: a zero-sized canvas is not
  // painted, and nothing else asked for a frame.
  const { editor, host } = makeEditor();
  const canvas = canvasOf(editor);

  // Not laid out yet: nothing measurable, so the fit cannot be performed.
  layoutTo(canvas, 1, 1);
  host.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0,
  });
  editor.resize();
  editor.scheduleFit();

  const before = editor.viewport.scale;

  // Layout arrives, with no resize event and no further call from the caller.
  host.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 900, height: 500, right: 900, bottom: 500,
  });
  layoutTo(canvas, 900, 500);

  // The retry runs on a timer.
  await new Promise((r) => setTimeout(r, 120));
  editor.resize();
  await new Promise((r) => setTimeout(r, 120));

  const [x1, y1, x2, y2] = C0.diagramBounds(editor.getModel());
  const s = editor.viewport.scale;
  assert.ok(s > 0, "the view has a scale");
  void before;
  const left = x1 * s + editor.viewport.x;
  const right = x2 * s + editor.viewport.x;
  const top = y1 * s + editor.viewport.y;
  const bottom = y2 * s + editor.viewport.y;
  assert.ok(
    left >= -1 && right <= 901 && top >= -1 && bottom <= 501,
    `the diagram is framed once layout arrives (${left.toFixed(0)}..${right.toFixed(0)}, ${top.toFixed(0)}..${bottom.toFixed(0)})`
  );
  // The fit ran if the diagram is framed; the scale alone cannot say so, since
  // `zoomToFit` clamps and may land on the same value twice.
  assert.ok(
    s > 0 && Number.isFinite(editor.viewport.x),
    `the deferred fit placed the view (scale ${before}, x ${editor.viewport.x})`
  );
  assert.ok(
    left >= -1 && right <= 901,
    "and framed the diagram, which an unmoved default view would not"
  );
  editor.destroy();
});

test("a degenerate canvas rect does not lock the editor at one pixel", () => {
  // A canvas reports 1x1 before the browser has laid it out, and that value was
  // preferred over the host's. The "nothing changed" guard then matched on every
  // later call, so the editor stayed at a single pixel for good — which is what
  // kept inline diagrams in notes blank while their host measured 699x320.
  const { editor, host } = makeEditor();
  const canvas = canvasOf(editor);

  // Before layout: both the host and the canvas are unusable.
  layoutTo(canvas, 1, 1);
  host.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 1, height: 1, right: 1, bottom: 1,
  });
  editor.resize();

  // The host is laid out. The canvas's own rect still reports 1x1.
  host.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 699, height: 320, right: 699, bottom: 320,
  });
  editor.resize();

  const dpr = globalThis.window.devicePixelRatio || 1;
  assert.equal(
    canvas.width,
    Math.floor(699 * dpr),
    "the editor follows the host once it is measurable"
  );
  assert.equal(canvas.style.width, "699px");
  editor.destroy();
});


test("a measurement that is not yet usable is not written", () => {
  // Writing a 1x1 backing store ALSO writes `style.width = "1px"`, which shrinks
  // the element. Its own rect then reports 1x1 forever, so every later call
  // re-reads that value and the editor stays at one pixel — which the browser
  // stretches across the whole box, giving a black slab that shifts as the
  // layout changes. Refusing to write anything unmeasurable is what makes
  // recovery possible.
  const { editor, host } = makeEditor();
  const canvas = canvasOf(editor);
  layoutTo(canvas, 800, 600);
  editor.resize();
  const good = { width: canvas.width, style: canvas.style.width };

  // A degenerate measurement arrives — no host, no canvas box.
  host.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0,
  });
  layoutTo(canvas, 0, 0);
  editor.resize();

  assert.equal(canvas.width, good.width, "the canvas keeps its last good size");
  assert.equal(canvas.style.width, good.style, "and is not shrunk to a pixel");

  // Once measurable again, the editor follows the real size.
  host.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 900, height: 500, right: 900, bottom: 500,
  });
  layoutTo(canvas, 900, 500);
  editor.resize();
  assert.equal(canvas.style.width, "900px", "and recovers");
  editor.destroy();
});

test("the inspector offers one tab per concern, with no duplicated fields", () => {
  // "Properties" and "Parameters" both rendered the identity block and the whole
  // parameter list through `renderParameterFields`, so they differed only by the
  // connectors list — two names for one panel, as the user spotted.
  const src = fs.readFileSync("src/view/studio-view.ts", "utf8");

  const block = /const tabs = this\.inspectorTabsEl;[\s\S]*?for \(const \[id, label\] of \[([\s\S]*?)\] as const\)/.exec(src);
  assert.ok(block, "the inspector tab list is declared");
  const tabs = [...block[1].matchAll(/\["(\w+)",/g)].map((m) => m[1]);
  assert.deepEqual(
    tabs,
    ["component", "results"],
    `the inspector offers exactly these tabs, got ${tabs.join(", ")}`
  );

  // The field builder is reached from exactly one tab path.
  const callers = [...src.matchAll(/^\s+this\.renderParameterFields\(/gm)].length;
  assert.equal(callers, 1, `parameter fields are rendered from one place, found ${callers}`);

  // And the merged tab still shows the connectors, which only Properties had.
  assert.match(src, /"Connectors"/, "the connectors list survives the merge");
});

test("the simulation time is editable in the view, not only in settings", () => {
  // `stopTime` existed as a value with no control anywhere — not in the view,
  // not in the settings tab. A model left with another model's span gave a
  // useless plot with no obvious way to fix it from where the plot is.
  //
  // The row itself moved into `plot-actions.ts` (so it can be rendered in a DOM
  // test); what is asserted here is that the two halves are still joined: the
  // field asks the view, and the view records the span against THIS model.
  const src = fs.readFileSync("src/view/studio-view.ts", "utf8");
  const bar = fs.readFileSync("src/view/plot-actions.ts", "utf8");
  assert.ok(bar.includes("modelica-studio-time-input"), "the plot bar carries a time field");
  assert.ok(bar.includes("host.applyStopTime(v)"), "editing it is handed to the view");
  assert.ok(
    src.includes("this.plugin.setStopTime(seconds)"),
    "which records the span for THIS model, so it neither reverts nor leaks"
  );
  assert.ok(
    bar.includes("String(host.stopTime())") && src.includes("stopTime: () => this.plugin.stopTime()"),
    "and the field shows this model's span, not a shared one"
  );
  assert.ok(
    /applyStopTime: \(seconds\)[\s\S]{0,120}runSimulation/.test(src),
    "and re-runs the simulation"
  );
});

test("an empty canvas explains itself", () => {
  // A model can legitimately have no schematic: `DampedBounce` is an equation
  // model whose declarations are all variables, so there is no icon, port or
  // wire to draw. An empty grid with no explanation cannot be told apart from a
  // model that failed to load.
  const src = fs.readFileSync("src/view/editor.ts", "utf8");
  assert.ok(src.includes("drawEmptyState"), "the editor has an empty-state message");
  const block = /private drawEmptyState\([\s\S]*?\n  \}/.exec(src);
  assert.ok(block, "and it is defined");
  assert.match(block[0], /This model has no schematic/, "it says why the canvas is blank");
  assert.match(block[0], /variables/, "and names what the model does contain");
  assert.match(block[0], /Drag a component in from the palette/, "and what to do when it is truly empty");
});

test("the empty-state text is readable, not a hairline tone", () => {
  // The first version drew the secondary lines in `theme.grid` — a tone at 13%
  // opacity, meant for hairline grid lines. Alpha-corrected against the canvas it
  // is 1.19:1, which is why three of the four lines were invisible in the
  // screenshot. The theme's opaque annotation tone exists for this.
  const src = fs.readFileSync("src/view/editor.ts", "utf8");
  const block = /private drawEmptyState\([\s\S]*?\n  \}/.exec(src);
  assert.ok(block, "the empty state is defined");
  assert.ok(
    !/fillStyle = [^;]*theme\.grid/.test(block[0]),
    "it must not use the grid tone for text"
  );
  assert.match(block[0], /theme\.placeholderText/, "it uses the readable annotation tone");
});

test("a rebuilt model is handed to the caller, not kept private", () => {
  // The editor REPLACES its model object for an undo or a redo -- it restores a
  // parsed copy rather than mutating in place -- so the model it draws
  // afterwards is not the object the caller passed in. `onChange` is how the
  // caller learns that, and for a while the plugin's handler ignored the
  // argument it was given.
  //
  // The two then described different models. Clicking a component looked its id
  // up in the one the plugin still held, found nothing, and reported
  // "1 components selected." with no fields at all -- for every component in
  // the library, which reads as the plugin being broken rather than as one
  // stale reference. Edits made after that landed in the model the plugin had
  // forgotten, so they never reached the file.
  const host = new StubElement("div");
  const start = { name: "M", components: [inst("r1", 0, 0)], connections: [], graphics: [] };
  const seen = [];
  const editor = new SchematicEditor(host, start, {
    lookup,
    onChange: (m) => seen.push(m),
    onSelectionChange: () => {},
    onStatus: () => {},
  });

  editor.beginEdit("add");
  editor.model.components.push(inst("r2", 200, 0));
  editor.commitEdit();
  assert.equal(editor.model.components.length, 2, "the add landed");
  assert.equal(editor.model, start, "an ordinary edit mutates in place");

  editor.undo();
  assert.equal(editor.model.components.length, 1, "undo removed it again");
  assert.notEqual(editor.model, start, "but the restored model is a NEW object");

  // The contract: what `onChange` was handed last IS what the editor draws.
  const last = seen[seen.length - 1];
  assert.equal(last, editor.currentModel, "onChange reports the model the editor now holds");
  assert.equal(last, editor.model, "and it is the one being drawn");
});

test("adopting a re-parsed model keeps the viewport and drops dead selections", () => {
  // What the code validator does on every keystroke. It must not refit the
  // canvas -- the user is in code mode and the diagram should not jump -- but it
  // MUST leave the editor holding the same object the plugin holds, which is the
  // half that was missing.
  const { editor } = makeEditor();
  editor.setSelection(["r1"]);
  const before = editor.currentModel;

  const reparsed = { name: "M", components: [inst("r1", 0, 0)], connections: [], graphics: [] };
  editor.adoptModel(reparsed);

  assert.equal(editor.currentModel, reparsed, "the editor takes the new object");
  assert.notEqual(editor.currentModel, before, "and it really is a different object");
  assert.deepEqual(editor.selectedIds, ["r1"], "a selection the new text still declares survives");

  // A component the new text no longer declares must leave the selection, or the
  // inspector reports something that is not there.
  const fewer = { name: "M", components: [inst("r2", 200, 0)], connections: [], graphics: [] };
  editor.adoptModel(fewer);
  assert.deepEqual(editor.selectedIds, [], "a selection that no longer exists is dropped");

  // Adopting the same object again is a no-op rather than a state reset.
  const kept = editor.currentModel;
  editor.adoptModel(kept);
  assert.equal(editor.currentModel, kept);
});

test("hovering a component paints what its parameters are set to", () => {
  // The readout is drawn by the editor, in screen space, and only while the
  // pointer is on a component AND the setting is on. None of that is visible
  // from the helper it calls, so the paint itself is checked here.
  const host = new StubElement("div");
  const model = {
    name: "M",
    components: [inst("r1", 0, 0)],
    connections: [],
    graphics: [],
  };
  const def = {
    ...classDef("M.R"),
    parameters: [
      { name: "R", type: "Real", defaultValue: "1", unit: "Ohm" },
      { name: "T", type: "Real", defaultValue: "300" },
    ],
  };
  let hoverParameters = true;
  const editor = new SchematicEditor(host, model, {
    lookup: () => def,
    onChange: () => {},
    onSelectionChange: () => {},
    onStatus: () => {},
    display: () => ({ labelScale: 1, hoverParameters }),
  });

  const painted = [];
  editor.ctx = new Proxy(
    { canvas: { width: 800, height: 600 }, measureText: (s) => ({ width: String(s).length * 6 }) },
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === "fillText") return (s) => painted.push(String(s));
        return () => {};
      },
      set() {
        return true;
      },
    }
  );
  const canvas = canvasOf(editor);
  layoutTo(canvas, 1200, 800);
  editor.resize();

  const draw = () => {
    painted.length = 0;
    SchematicEditor.prototype.draw.call(editor);
    return painted.join(" | ");
  };

  assert.equal(draw().includes("R = 100"), false, "nothing is shown with no pointer on a component");

  editor.hovered = "r1";
  const shown = draw();
  assert.match(shown, /r1/, "the component is named");
  assert.match(shown, /R = 100/, `the value it overrides: ${shown}`);
  assert.match(shown, /T = 300/, "and one it inherits");

  // The setting turns it off, and it is read per frame rather than captured.
  hoverParameters = false;
  assert.ok(!draw().includes("R = 100"), "the setting hides it");

  hoverParameters = true;
  editor.hovered = null;
  assert.ok(!draw().includes("R = 100"), "and it goes when the pointer leaves");
  editor.destroy();
});

test("a long parameter list is laid out to fit, not cut off", () => {
  // The class with the most parameters in MSL has 49. A single column of them is
  // about 800px, taller than the canvas, so the panel would have run off the
  // bottom and the last parameters -- the ones most likely to be interesting --
  // would have been the ones lost. It fills columns instead.
  const host = new StubElement("div");
  const many = Array.from({ length: 49 }, (_, i) => ({
    name: `parameter${i}`,
    type: "Real",
    defaultValue: String(i),
  }));
  const def = { ...classDef("M.R"), parameters: many };
  const editor = new SchematicEditor(
    host,
    { name: "M", components: [inst("r1", 0, 0)], connections: [], graphics: [] },
    {
      lookup: () => def,
      onChange: () => {},
      onSelectionChange: () => {},
      onStatus: () => {},
      display: () => ({ labelScale: 1, hoverParameters: true }),
    }
  );

  const texts = [];
  const rects = [];
  const fills = [];
  editor.ctx = new Proxy(
    {
      canvas: { width: 2400, height: 1600 },
      measureText: (s) => ({ width: String(s).length * 6 }),
      fillStyle: "",
    },
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === "fillText") return (s) => texts.push(String(s));
        // The style at the moment of the fill: `fillStyle` is set, then used.
        if (k === "fillRect") return (x, y, w, h) => {
          rects.push([x, y, w, h]);
          fills.push(t.fillStyle);
        };
        return () => {};
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    }
  );
  const canvas = canvasOf(editor);
  layoutTo(canvas, 1200, 800);
  editor.resize();
  editor.hovered = "r1";
  SchematicEditor.prototype.draw.call(editor);

  const drawn = texts.filter((t) => /^parameter\d+ = /.test(t));
  assert.equal(drawn.length, 49, `every parameter is painted, got ${drawn.length}`);
  assert.ok(texts.includes("parameter48 = 48"), "including the last one");
  assert.ok(texts.includes("r1"), "and the component is named");

  // The first fillRect is the canvas background; the readout is drawn last, on
  // top of everything.
  assert.ok(rects.length >= 2, `the panel is painted: ${JSON.stringify(rects)}`);
  const [x, y, w, h] = rects[rects.length - 1];
  const W = editor.cssWidth * editor.dpr;
  const H = editor.cssHeight * editor.dpr;
  assert.ok(h < H && w < W, `and is a panel, not the background: ${w}x${h} in ${W}x${H}`);
  assert.ok(h <= H, `the panel fits the canvas height: ${h} <= ${H}`);
  assert.ok(y >= 0 && y + h <= H, `and sits inside it vertically: y=${y} h=${h}`);
  assert.ok(x >= 0 && x + w <= W, `and horizontally: x=${x} w=${w}`);

  // Opaque. The panel can end up over the diagram when there is nowhere clear to
  // put it, and a see-through one both shows the component through it and
  // invites clicking what shows through.
  const panelFill = fills[fills.length - 1];
  assert.ok(
    /^rgb\(/.test(panelFill) && !/^rgba\(/.test(panelFill),
    `the panel is opaque, not translucent: ${panelFill}`
  );
  editor.destroy();
});
