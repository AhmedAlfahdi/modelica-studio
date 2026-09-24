/**
 * Three defects that all come from one element being taken for another.
 *
 * The Examples menu installed document-level listeners and only ONE of the four
 * ways it could close removed them; the mode buttons were drawn as neither
 * selected because the function that marks them ran only on a mode CHANGE; and the
 * palette's arrow keys moved by an index into the expansion order while focusing a
 * row in the drawn order.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runInDom, DOM_PREAMBLE } from "./helpers/dom-runner.mjs";
import { repoRoot } from "./helpers/build.mjs";

const ROOT = repoRoot;

/** A mounted studio with a two-package library, and the plugin calls recorded. */
const SETUP = `
import { ModelicaStudioView } from "${ROOT}/src/view/studio-view";
import { StubVault, Scope } from "${ROOT}/test/helpers/obsidian-stub";
if (!Element.prototype.hasClass) Element.prototype.hasClass = function (c) { return this.classList.contains(c); };

const vault = new StubVault();
const app = { vault, scope: new Scope(),
  workspace: { getLeavesOfType: () => [], on: () => ({}), getActiveViewOfType: () => null, onLayoutReady: (f) => f() } };

// Two root packages, so the palette has a defined DOM order (A before B).
const comp = (full, short) => ({ name: full, shortName: short, comment: "", icon: [],
  parameters: [], ports: [], hasIcon: false, kind: "model" });
const node = (full, short, children) => ({ name: short, full, children, placeable: false });
const treeA = node("A", "A", [node("A.A1", "A1", []), node("A.A2", "A2", [])]);
treeA.children.forEach((c) => { c.placeable = true; });
const treeB = node("B", "B", [node("B.B1", "B1", []), node("B.B2", "B2", [])]);
treeB.children.forEach((c) => { c.placeable = true; });
const defs = { "A.A1": comp("A.A1", "A1"), "A.A2": comp("A.A2", "A2"),
  "B.B1": comp("B.B1", "B1"), "B.B2": comp("B.B2", "B2") };

const loaded = [];
const nameOf = (s) => (/model\\s+([A-Za-z_]\\w*)/.exec(s) || [])[1];
const plugin = {
  app, manifest: { id: "modelica-studio", version: "0", author: "A" },
  settings: { modelFolder: "Modelica", modelFiles: {}, wireScale: 0.9, symbolStrokeScale: 1.9,
    syncStrokeScale: false, showInstanceLabels: true, labelScale: 1, hoverParameters: false,
    diagramReadoutScale: 1, plotReadoutScale: 1, paletteRoots: [], modelStopTimes: {}, charts: {} },
  model: { name: "Tank", components: [], connections: [], equations: [] },
  library: { size: 4, packages: () => ["A", "B"], packageTree: (r) => (r === "A" ? treeA : treeB),
    component: (n) => defs[n], allNames: () => Object.keys(defs), hasPlaceableClass: () => true,
    isExcluded: () => false },
  libraryRootNames: () => [], backend: null,
  sourceForSave: () => "model Tank\\nend Tank;",
  saveState: () => ({ state: "modified", label: "modified", worthAsking: true }),
  saveModelToNote: async () => ({ path: "Modelica/Tank.mo", created: false }),
  takeModelOutdated: () => false, invalidateBuild: () => {}, getView: () => null,
  refreshEmbeds: () => {}, setStopTime: () => {}, stopTime: () => 5, ensureFolder: async () => {},
  saveSettings: async () => {}, diag: () => {}, hasLibrary: () => true, isComponentClass: () => false,
  traceStep: () => {}, runLog: { add: () => {}, clear: () => {}, entries: () => [], subscribe: () => () => {} },
  aiContext: () => ({}), aiKey: () => null, appendAiExchange: () => {}, readAiExchanges: () => [],
  publishChart: () => {}, modelSourceText: () => "model Tank\\nend Tank;", parseSource: () => undefined,
  loadModelFromPath: async () => {}, markSourceStale: () => {}, adoptEditorModel: () => {},
  adoptModel: () => {}, setModelFromSource: async (s) => { loaded.push(nameOf(s)); return undefined; },
  persist: async () => {}, promptNewModel: async () => {}, showSetupHelp: () => {},
};
const view = new ModelicaStudioView({}, plugin);
view.app = app;
view.containerEl = document.body.createDiv();
view.contentEl = view.containerEl.createDiv();
const tick = () => new Promise((r) => setTimeout(r, 5));
`;

test("the Examples menu leaves no keyboard handlers behind", async () => {
  // Choosing an example with the mouse removed the menu without running its
  // cleanup, so its capture-phase keydown handler stayed on `document`: arrow keys
  // were swallowed app-wide and Enter re-clicked items[0] -- still the highlighted
  // row, because the mouse had never moved the highlight -- loading a DIFFERENT
  // example over the model on the canvas.
  //
  // One sequential callback, not three: the harness starts each registered test
  // without awaiting it, and the three parts below share one page and one `loaded`
  // array, so overlapping them would make them measure each other.
  const out = await runInDom(
    [
      DOM_PREAMBLE,
      SETUP,
      "await view.onOpen();",
      // An empty canvas is seeded with an example on open, so start counting here.
      "loaded.length = 0;",
      "window.test('the menu closes through one path', async () => {",
      "  const click = {};",
      "  {",
      "    const anchor = view.contentEl.createEl('button');",
      "    view.showExamplePicker(anchor);",
      "    await tick();",
      "    const items = [...view.contentEl.querySelectorAll('.modelica-studio-examples-item')];",
      "    click.items = items.length;",
      "    click.chosen = items[2].querySelector('.modelica-studio-examples-name').textContent;",
      "    items[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));",
      "    await tick();",
      "    click.afterClick = loaded.slice();",
      "    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });",
      "    document.dispatchEvent(enter);",
      "    await tick();",
      "    click.afterEnter = loaded.slice();",
      "    click.menu = !!view.contentEl.querySelector('.modelica-studio-examples-menu');",
      "  }",
      "  const toggled = {};",
      "  {",
      "    loaded.length = 0;",
      "    const anchor = view.contentEl.createEl('button');",
      "    view.showExamplePicker(anchor);",
      "    await tick();",
      // The toolbar button's click handler calls this again -- the toggle path.
      "    view.showExamplePicker(anchor);",
      "    await tick();",
      "    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });",
      "    document.dispatchEvent(ev);",
      "    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));",
      "    await tick();",
      "    toggled.swallowed = ev.defaultPrevented;",
      "    toggled.loaded = loaded.slice();",
      "    toggled.menu = !!view.contentEl.querySelector('.modelica-studio-examples-menu');",
      "  }",
      "  const closed = {};",
      "  {",
      "    loaded.length = 0;",
      "    view.showExamplePicker(view.contentEl.createEl('button'));",
      "    await tick();",
      "    await view.onClose();",
      "    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });",
      "    document.dispatchEvent(ev);",
      "    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));",
      "    await tick();",
      "    closed.swallowed = ev.defaultPrevented;",
      "    closed.loaded = loaded.slice();",
      "  }",
      "  return JSON.stringify({ click, toggled, closed });",
      "});",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  const reported = (out.results ?? []).find((r) => r.name === "the menu closes through one path");
  assert.ok(reported, `the page reported its result: ${JSON.stringify(out).slice(0, 500)}`);
  assert.ok(reported.ok, `the page test passed: ${reported.error ?? ""}`);
  const { click, toggled, closed } = JSON.parse(reported.detail);

  assert.ok(click.items > 3, "the picker was populated");
  assert.equal(click.afterClick.length, 1, `a click loads exactly one example: ${JSON.stringify(click)}`);
  assert.equal(click.afterClick[0], click.chosen, "the one that was clicked");
  assert.deepEqual(click.afterEnter, click.afterClick, "and a later Enter loads nothing more");
  assert.equal(click.menu, false, "the menu is gone");

  assert.equal(toggled.swallowed, false, "ArrowDown is not intercepted once the menu is closed");
  assert.deepEqual(toggled.loaded, [], "and Enter loads nothing");
  assert.equal(toggled.menu, false, "with no menu left on screen");

  assert.equal(closed.swallowed, false, "closing the view removes the handlers too");
  assert.deepEqual(closed.loaded, [], "and nothing is loaded afterwards");
});

test("the studio opens with the mode it is in marked as active", async () => {
  // The active mode is shown ONLY by `aria-pressed="true"` and `.is-active`, and
  // `syncToolbarToMode` wrote both -- but it ran on a mode CHANGE, so every open in
  // the default diagram mode drew two unselected buttons until Code and Diagram
  // were pressed once.
  const out = await runInDom(
    [
      DOM_PREAMBLE,
      SETUP,
      "await view.onOpen();",
      "window.test('exactly one mode is marked, and it is the diagram', () => {",
      "  const btns = [...view.contentEl.querySelectorAll('.modelica-studio-mode')];",
      "  return JSON.stringify({",
      "    buttons: btns.length,",
      "    active: btns.filter((b) => b.classList.contains('is-active')).length,",
      "    pressed: btns.filter((b) => b.getAttribute('aria-pressed') === 'true').length,",
      "    mode: view.mode,",
      "    which: (btns.find((b) => b.getAttribute('aria-pressed') === 'true') || {}).textContent || '',",
      "  });",
      "});",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const state = JSON.parse(out.results[0].detail);

  assert.equal(state.mode, "diagram", "the studio opened in diagram mode");
  assert.equal(state.buttons, 2, "two mode buttons");
  assert.equal(state.active, 1, "exactly one is marked active");
  assert.equal(state.pressed, 1, "and exactly one says so to a screen reader");
  assert.match(state.which, /Diagram/i, "and it is the one for the mode it is in");
});

test("the palette's arrow keys walk the rows in the order they are drawn", async () => {
  // The index space was `paletteItems`, which grows in the order packages were
  // EXPANDED, while focus moved by index into the drawn list. Expanding the second
  // package before the first made ArrowDown jump into the other package.
  const out = await runInDom(
    [
      DOM_PREAMBLE,
      SETUP,
      "await view.onOpen();",
      "window.test('down from B1 stays in B', () => {",
      "  view.renderPalette();",
      "  const heads = [...view.contentEl.querySelectorAll('.modelica-studio-palette-group-head')];",
      "  heads[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));", // expand B first
      "  heads[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));", // then A
      "  const rows = [...view.contentEl.querySelectorAll('.modelica-studio-palette-item')];",
      "  const domOrder = rows.map((r) => r.textContent.trim()).join(',');",
      "  const expansionOrder = view.paletteItems.map((n) => n.split('.').pop()).join(',');",
      "  const b1 = rows.find((r) => r.textContent.trim() === 'B1');",
      "  b1.focus();",
      "  b1.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));",
      "  const afterDown = document.activeElement.textContent.trim();",
      "  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));",
      "  const afterTwo = document.activeElement.textContent.trim();",
      "  return JSON.stringify({ domOrder, expansionOrder, afterDown, afterTwo });",
      "});",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const state = JSON.parse(out.results[0].detail);

  // The fixture must actually put the two orders in conflict, or it proves nothing.
  assert.equal(state.domOrder, "A1,A2,B1,B2", "the rows are drawn in package order");
  assert.equal(state.expansionOrder, "B1,B2,A1,A2", "while expansion order is the reverse");
  assert.equal(state.afterDown, "B2", "ArrowDown stays in the package being walked");
  assert.equal(state.afterTwo, "A1", "and then moves to the next row on screen, not into the middle of the list");
});

test("a mode switch keeps the diagram's undo, and Ctrl+Enter runs it", async () => {
  // Two reports about the mode switch:
  //   - entering code mode ran the debounced validation, which ADOPTED a freshly
  //     parsed model and cleared the diagram's undo history. Add a component, press
  //     Code and Diagram with no keystrokes, and Undo was dead;
  //   - Ctrl+Enter is documented as Simulate in Help and the toolbar, and the code
  //     pane had it while the diagram had no Enter case at all.
  const out = await runInDom(
    [
      DOM_PREAMBLE,
      SETUP,
      "await view.onOpen();",
      "window.test('the undo history survives the round trip', () => {",
      "  const added = view.editor.addComponent('A.A1', 0, 0);",
      "  const depth = view.editor.history.depth;",
      "  view.setMode('code');",
      "  view.setMode('diagram');",
      "  const after = view.editor.history.depth;",
      "  // And it still WORKS: undoing takes the component away.",
      "  view.editor.undo();",
      "  return JSON.stringify({ added: !!added, depth, after,",
      "    componentsAfterUndo: view.editor.getModel().components.length });",
      "});",
      "window.test('visiting code mode does not adopt a source that is behind the diagram', () => {",
      "  // The stub plugin hands out a FIXED source, which is exactly the situation a",
      "  // refused patch creates: the text does not describe the diagram. Opening code",
      "  // mode used to validate that text and adopt it, discarding the diagram edit.",
      "  const before = view.editor.getModel().components.length;",
      "  const added = view.editor.addComponent('A.A1', 40, 40);",
      "  const withEdit = view.editor.getModel().components.length;",
      "  view.setMode('code');",
      "  view.setMode('diagram');",
      "  const after = view.editor.getModel().components.length;",
      "  return JSON.stringify({ before, withEdit, after, added: !!added,",
      "    paneText: view.codeEditor.getValue().slice(0, 12) });",
      "});",
      "window.test('Ctrl+Enter in diagram mode runs the model', async () => {",
      "  let runs = 0;",
      "  view.plugin.backend = {",
      "    simulate: async () => {",
      "      runs++;",
      "      return { time: [0, 1], series: [{ name: 'x', values: [0, 1] }],",
      "        warnings: [], compileMs: 0, simulateMs: 0, reusedBinary: true };",
      "    },",
      "  };",
      "  const canvas = view.editor.canvasEl;",
      // Both flags the shortcut needs are set by a press: `pointerInside` on enter,
      // `hasFocus` on pointerdown. A press on empty canvas is a marquee that a zero
      // drag leaves as a plain click.
      "  canvas.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));",
      "  const at = { clientX: 5, clientY: 5, button: 0, bubbles: true, cancelable: true };",
      "  canvas.dispatchEvent(new PointerEvent('pointerdown', at));",
      "  canvas.dispatchEvent(new PointerEvent('pointerup', at));",
      "  const seen = [];",
      "  canvas.addEventListener('keydown', (e) => seen.push(e.defaultPrevented), { once: true });",
      "  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));",
      "  await tick();",
      "  await tick();",
      "  return JSON.stringify({ runs, prevented: seen });",
      "});",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = Object.fromEntries(out.results.map((r) => [r.name, JSON.parse(r.detail)]));

  const undo = d["the undo history survives the round trip"];
  assert.equal(undo.added, true, "a component was added");
  assert.equal(undo.depth, 1, "which is one undo step");
  assert.equal(undo.after, 1, `the history survived Code and back: ${JSON.stringify(undo)}`);
  assert.equal(undo.componentsAfterUndo, 0, "and Undo still takes the component away");

  const stale = d["visiting code mode does not adopt a source that is behind the diagram"];
  assert.equal(stale.withEdit, stale.before + 1, "the diagram edit was made");
  assert.equal(
    stale.after,
    stale.withEdit,
    `and visiting code mode did not discard it: ${JSON.stringify(stale)}`
  );

  const run = d["Ctrl+Enter in diagram mode runs the model"];
  assert.equal(run.runs, 1, `the model ran: ${JSON.stringify(run)}`);
  assert.deepEqual(run.prevented, [true], "and the key was handled, not left to the browser");
});
