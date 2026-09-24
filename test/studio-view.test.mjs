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
});
