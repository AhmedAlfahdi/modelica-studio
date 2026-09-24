/**
 * How the studio binds Ctrl/Cmd+S — the wiring itself, which is what was wrong.
 *
 * The first version added a DOM listener. Obsidian's own `editor:save-file` command
 * claims Mod+S at the application level and consumes the keystroke before any handler in
 * the page sees it, so pressing Ctrl+S in the studio did nothing at all, and no test
 * could tell: nothing in the suite could observe a keymap binding.
 *
 * The wiring is now a free function taking a scope and an element, so it can be tested
 * without an application — and the stub provides a faithful `Scope`, so the binding can
 * be triggered the way the application triggers it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runInDom, DOM_PREAMBLE } from "./helpers/dom-runner.mjs";
import { repoRoot } from "./helpers/build.mjs";

const ROOT = repoRoot;

const SETUP = [
  `import { wireSaveShortcut } from "${ROOT}/src/view/studio-view";`,
  `import { Scope } from "${ROOT}/test/helpers/obsidian-stub";`,
  "",
  "const calls = [];",
  "const save = () => calls.push('save');",
  "function mount() {",
  "  const root = document.body.createDiv();",
  "  const host = { scope: undefined, app: { scope: new Scope() } };",
  "  wireSaveShortcut(host, root, save);",
  "  return { root, host };",
  "}",
  "",
].join("\n");

test("the shortcut is registered in the view's scope, which is what the app honours", async () => {
  const out = await runInDom(
    [
      DOM_PREAMBLE,
      SETUP,
      "window.test('scope binding', () => {",
      "  const { host } = mount();",
      "  if (!host.scope) return 'NO SCOPE: a DOM listener alone is consumed by Obsidian';",
      "  const bindings = host.scope.bindings();",
      "  const declined = host.scope.trigger(['Ctrl'], 's') === false;",
      "  return 'bindings=' + bindings.join(',') + ' saves=' + calls.length + ' declined=' + declined;",
      "});",
      "window.finish();",
    ].join("\n")
  );
  assert.ok(!out.skip, `skipped: ${out.skip}`);
  assert.ok(!out.fatal, out.fatal);
  assert.deepEqual(out.errors, [], "no page errors");
  const [result] = out.results;
  assert.ok(result.ok, result.error);
  assert.equal(
    result.detail,
    "bindings=Mod+s saves=1 declined=true",
    "the scope owns Mod+S, firing it saves the model, and it declines the event so the core command does not also run"
  );
});

test("the DOM listener still works where the page does see the key", async () => {
  // The fallback matters for any host that does not claim the key; and it must not react
  // to anything else.
  const out = await runInDom(
    [
      DOM_PREAMBLE,
      SETUP,
      "window.test('ctrl-s', () => {",
      "  const { root } = mount();",
      "  root.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));",
      "  return 'saves=' + calls.length;",
      "});",
      "window.test('bare-s', () => {",
      "  const { root } = mount();",
      "  const before = calls.length;",
      "  root.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));",
      "  return 'saves=' + (calls.length - before);",
      "});",
      "window.test('ctrl-z', () => {",
      "  const { root } = mount();",
      "  const before = calls.length;",
      "  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));",
      "  return 'saves=' + (calls.length - before);",
      "});",
      "window.finish();",
    ].join("\n")
  );
  assert.ok(!out.skip, `skipped: ${out.skip}`);
  assert.ok(!out.fatal, out.fatal);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, r.error);
  const by = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));
  assert.equal(by["ctrl-s"], "saves=1");
  assert.equal(by["bare-s"], "saves=0");
  assert.equal(by["ctrl-z"], "saves=0");
});

/**
 * A plugin double with everything the view calls, so the view can be MOUNTED.
 *
 * Built by listing what `studio-view.ts` reaches for on the plugin (`grep -o
 * "this\.plugin\.[a-zA-Z]*"`), rather than by adding fields one exception at a time --
 * which is how the first attempt went, three errors deep.
 */
const MOUNT_SETUP = [
  `import { ModelicaStudioView } from "${ROOT}/src/view/studio-view";`,
  `import { StubVault, Scope } from "${ROOT}/test/helpers/obsidian-stub";`,
  "",
  "const vault = new StubVault();",
  "vault.add('Modelica/MassSpringDamper.mo', 'model MassSpringDamper\\nend MassSpringDamper;');",
  "vault.add('Modelica/TankOrifice.mo', 'model TankOrifice\\nend TankOrifice;');",
  "const app = { vault, scope: new Scope(),",
  "  workspace: { getLeavesOfType: () => [], on: () => ({}), getActiveViewOfType: () => null, onLayoutReady: (f) => f() } };",
  "const plugin = {",
  "  app, manifest: { id: 'modelica-studio', version: '0.3.16', author: 'A' },",
  "  settings: { modelFolder: 'Modelica', modelFiles: { MassSpringDamper: 'Modelica/MassSpringDamper.mo' },",
  "    wireScale: 0.9, symbolStrokeScale: 1.9, syncStrokeScale: false, showInstanceLabels: true, labelScale: 1,",
  "    hoverParameters: false, diagramReadoutScale: 1, plotReadoutScale: 1, paletteRoots: [], modelStopTimes: {}, charts: {} },",
  "  model: { name: 'MassSpringDamper', components: [], connections: [], equations: [] },",
  "  library: { size: 3, packages: () => [], component: () => undefined, allNames: () => [],",
  "    hasPlaceableClass: () => false, isExcluded: () => false },",
  "  libraryRootNames: () => [], backend: null,",
  "  sourceForSave: () => 'model MassSpringDamper\\nend MassSpringDamper;',",
  "  saveState: () => ({ state: 'modified', label: 'modified', worthAsking: true }),",
  "  saveModelToNote: async () => ({ path: 'Modelica/MassSpringDamper.mo', created: false }),",
  "  takeModelOutdated: () => false, markModelOutdated: () => {}, noteModelEdited: () => {},",
  "  invalidateBuild: () => {}, getView: () => null, refreshEmbeds: () => {}, setStopTime: () => {},",
  "  stopTime: () => 5, ensureFolder: async () => {}, saveSettings: async () => {},",
  "  diag: () => {}, hasLibrary: () => true, isComponentClass: () => false, traceStep: () => {},",
  "  runLog: { add: () => {}, clear: () => {}, entries: () => [], subscribe: () => () => {} },",
  "  aiContext: () => ({}), aiKey: () => null, appendAiExchange: () => {}, readAiExchanges: () => [],",
  "  publishChart: () => {}, modelSourceText: () => '', parseSource: () => [],",
  "  loadModelFromPath: async () => {}, markSourceStale: () => {}, adoptEditorModel: () => {},",
  "  adoptModel: () => {}, setModelFromSource: () => {}, persist: () => {}, promptNewModel: () => {},",
  "  showSetupHelp: () => {},",
  "};",
  "const view = new ModelicaStudioView({}, plugin);",
  "view.app = app;",
  "view.containerEl = document.body.createDiv();",
  "view.contentEl = view.containerEl.createDiv();",
  "const header = () => {",
  "  const q = (c) => { const el = view.contentEl.querySelector(c); return el ? el.textContent : 'MISSING'; };",
  "  return q('.modelica-studio-title-name') + ' | ' + q('.modelica-studio-title-file') + ' | ' + q('.modelica-studio-title-state');",
  "};",
  "",
].join("\n");

test("the header follows the model that is open, and the tab names it", async () => {
  // Reported: "the file's name didn't update". The header was drawn once at open and
  // never again, because it was refreshed by a method nothing called -- so this test
  // mounts the view, changes the model, and reads the header back.
  const out = await runInDom(
    [
      DOM_PREAMBLE,
      MOUNT_SETUP,
      // The setup is awaited at the page's top level, so every case below is a synchronous
      // read of a settled view. A case that awaited would be scored before it ran unless the
      // harness awaits its page tests, and that change is a migration of ten pages, not a
      // detail of this one.
      "let mountError = '';",
      "try { await view.onOpen(); } catch (e) { mountError = 'onOpen threw: ' + e.message; }",
      "const firstHeader = header();",
      "plugin.model = { name: 'TankOrifice', components: [], connections: [], equations: [] };",
      "plugin.settings.modelFiles.TankOrifice = 'Modelica/TankOrifice.mo';",
      "let loadError = '';",
      "try { view.loadModelIntoEditor(); } catch (e) { loadError = 'load threw: ' + e.message; }",
      "const secondHeader = header();",
      "",
      "window.test('mount', () => mountError || firstHeader);",
      "window.test('after loading another model', () => loadError || secondHeader);",
      "window.test('and the tab label names the model', () => view.getDisplayText());",
      "window.test('a status line refreshes it too', () => {",
      // Loading an example writes a status line and nothing else. The header used to keep
      // the previous model through that, which is how a reader ended up looking at RLC on a
      // canvas under a tab that said DCMotor.
      "  plugin.model = { name: 'RLC', components: [], connections: [], equations: [] };",
      "  plugin.settings.modelFiles.RLC = 'Modelica/RLC.mo';",
      "  view.setStatus('Loaded example: RLC');",
      "  return header();",
      "});",
      "window.finish();",
    ].join("\n")
  );
  assert.ok(!out.skip, `skipped: ${out.skip}`);
  assert.ok(!out.fatal, out.fatal);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, r.error);
  const by = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));

  assert.equal(
    by.mount,
    "MassSpringDamper | Modelica/MassSpringDamper.mo | modified",
    "the header names the model, its file and the state"
  );
  assert.equal(
    by["after loading another model"],
    "TankOrifice | Modelica/TankOrifice.mo | modified",
    "and it follows the model when another one is loaded -- the bug was that it did not"
  );
  assert.equal(by["and the tab label names the model"], "Modelica Studio — TankOrifice");
  assert.equal(
    by["a status line refreshes it too"],
    "RLC | Modelica/RLC.mo | modified",
    "a status line is enough to bring the header up to date -- no separate call to remember"
  );
});

test("the toolbar's icon-only buttons keep their names where they matter", async () => {
  // The Edit and View rows are icons alone -- six of the eight are on every editor's
  // toolbar, and the words cost more width than they earn. What must not go with the
  // words is the button's NAME: the tooltip and the accessible label both come from
  // `aria-label`, so a button that loses its span and nothing else becomes an
  // unlabelled square that a screen reader reads as "button".
  //
  // The Model row keeps its words on purpose: "Save as .mo" and "Model list…" are not
  // guessable from a glyph, and this pins that the change stayed where it was meant to.
  const out = await runInDom(
    [
      DOM_PREAMBLE,
      MOUNT_SETUP,
      "await view.onOpen();",
      "const read = (group) => {",
      "  const els = [...view.contentEl.querySelectorAll('.modelica-studio-btn-group')];",
      "  const g = els.find((el) => el.getAttribute('role') === 'group' && el.querySelector('.modelica-studio-btn') && el.textContent !== null && el.dataset.scope === group);",
      "  return g;",
      "};",
      "const buttonsIn = (sel) => [...view.contentEl.querySelectorAll(sel + ' .modelica-studio-btn')]",
      "  .map((b) => ({ label: b.getAttribute('aria-label'), text: (b.textContent || '').trim(), icon: !!b.querySelector('.svg-icon') }));",
      "window.test('edit row', () => JSON.stringify(buttonsIn('.modelica-studio-btn-group[data-scope=\"diagram\"]')));",
      "window.test('all', () => JSON.stringify(buttonsIn('.modelica-studio-toolbar')));",
      "window.finish();",
    ].join("\n")
  );
  assert.ok(!out.skip, `skipped: ${out.skip}`);
  assert.ok(!out.fatal, out.fatal);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, r.error);
  const by = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));
  const all = JSON.parse(by.all);
  assert.ok(all.length >= 12, `the toolbar was built (${all.length} buttons)`);

  const iconOnly = all.filter((b) => b.text === "");
  assert.ok(iconOnly.length >= 8, `the edit and view rows are icon-only (${iconOnly.length})`);
  for (const b of iconOnly) {
    assert.ok(b.icon, `an icon-only button has an icon: ${JSON.stringify(b)}`);
    assert.ok(b.label && b.label.trim().length > 3, `and a name for the tooltip: ${JSON.stringify(b)}`);
    // The name starts with the action, so a screen reader announces what it does
    // rather than what happens next or which key it is.
    assert.match(
      b.label,
      /^(Undo|Redo|Copy|Paste|Delete|Rotate|Zoom in|Zoom out|Fit to view)\b/,
      `"${b.label}" begins with the action`
    );
  }
  // The words that are not guessable from a glyph are still there.
  const named = all.filter((b) => b.text !== "").map((b) => b.text);
  for (const word of ["Save as .mo", "Model list…", "Examples…", "Simulate"]) {
    assert.ok(named.includes(word), `"${word}" keeps its label: ${JSON.stringify(named)}`);
  }
});
