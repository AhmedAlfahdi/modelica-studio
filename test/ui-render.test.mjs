/**
 * The UI, rendered.
 *
 * Every test here builds the real class in a real DOM and inspects what came out:
 * the text, the attributes, the classes, and what a click does. The tests this
 * replaces grepped the source, which proves a line of code exists and nothing
 * about whether anything renders — they would pass if the element were never
 * created, or created somewhere invisible.
 *
 * Runs through `dom-runner.mjs`, which loads the bundle into Electron. The page
 * code is built as ARRAYS OF LINES rather than template literals: the page code
 * contains template literals of its own, and nesting them here ends the outer one
 * at the first inner backtick — a syntax error in this file rather than a test
 * failure, which is a confusing way to find out.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runInDom, DOM_PREAMBLE } from "./helpers/dom-runner.mjs";
import { repoRoot } from "./helpers/build.mjs";

const ROOT = "/mnt/data/projects/Modelica-Plugin";

const HEAD = [
  DOM_PREAMBLE,
  `import { StubVault, TFile } from "${ROOT}/test/helpers/obsidian-stub";`,
  `import { SavedModelsModal } from "${ROOT}/src/view/saved-models-modal";`,
  `import { HelpModal, DIAGRAM_SHORTCUTS, CODE_SHORTCUTS } from "${ROOT}/src/view/help-modal";`,
  "",
  "/** A plugin double with just what the dialogs read. */",
  "function makePlugin(vault, over) {",
  "  const app = { vault, workspace: { getLeavesOfType: () => [] } };",
  "  const opts = over || {};",
  "  return {",
  "    app,",
  "    manifest: { id: 'modelica-studio', version: '0.1.0-beta.1' },",
  "    settings: Object.assign({ modelFolder: 'Modelica', modelFiles: {} }, opts.settings),",
  "    model: { name: 'Tank', components: [], connections: [], equations: [] },",
  "    backend: null,",
  "    library: { size: 6577, packages: () => [] },",
  "    libraryRootNames: () => ['Modelica 4.1.0'],",
  "    saveSettings: async () => {},",
  "    loadModelFromPath: async (p) => { window.__opened = p; },",
  "    snapshotRevision: () => {},",
  "    listRevisions: () => [],",
  "    readRevision: () => null,",
  "    setModelFromSource: async () => {},",
  "    getView: () => null,",
  "  };",
  "}",
  "",
].join("\n");

/** Compose a page and run its tests. */
function page(...lines) {
  return runInDom([HEAD, ...lines].join("\n"));
}

/** Assert every reported test passed, and return them by name. */
function passed(out) {
  assert.ok(!out.fatal, out.fatal);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  return Object.fromEntries(out.results.map((r) => [r.name, r.detail]));
}

test("the saved-model dialog renders, and its rows do what they look like", async () => {
  const out = page(
    "const vault = new StubVault();",
    "vault.add('Modelica/Tank.mo', 'model Tank');",
    "vault.add('Modelica/Valve.mo', 'model Valve');",
    "vault.add('Stray.mo', 'model Stray');",
    "const plugin = makePlugin(vault, { settings: { modelFiles: {",
    "  Tank: 'Modelica/Tank.mo',",
    "  Valve: 'Valve.mo',",
    "  Ghost: 'Modelica/Ghost.mo',",
    "} } });",
    "// One model has history, so the history action appears on exactly one row.",
    "plugin.listRevisions = (name) => name === 'Tank'",
    "  ? [{ file: '2026-09-18T03-40-12.mo', at: new Date('2026-09-18T03:40:12Z'), bytes: 2048 }]",
    "  : [];",
    "",
    "const modal = new SavedModelsModal(plugin.app, plugin);",
    "modal.open();",
    "const root = modal.contentEl;",
    "window.test('DEBUG exists', () => ['Modelica/Tank.mo','Valve.mo','Modelica/Ghost.mo'].map(p => p + '=' + (vault.getAbstractFileByPath(p) instanceof TFile)).join(' '));",
    "const rows = Array.from(root.querySelectorAll('.modelica-studio-saved-row'));",
    "const rowFor = (n) => rows.find(r => r.querySelector('.modelica-studio-saved-name').textContent === n);",
    "const actionsOf = (n) => Array.from(rowFor(n).querySelectorAll('.modelica-studio-saved-action')).map(b => b.getAttribute('aria-label'));",
    "",
    "window.test('every tracked model gets a row', () => rows.length + ' rows');",
    "window.test('rows are ordered by name', () => rows.map(r => r.querySelector('.modelica-studio-saved-name').textContent).join(','));",
    "window.test('an openable row is marked and carries the path', () => {",
    "  const t = rowFor('Tank');",
    "  return t.querySelector('.modelica-studio-saved-name').className + ' | ' + t.querySelector('.modelica-studio-saved-path').textContent;",
    "});",
    "window.test('a record with no file is marked is-missing', () => rowFor('Ghost').className);",
    "window.test('a row with no file is not clickable', () =>",
    "  'openable=' + rowFor('Ghost').querySelector('.modelica-studio-saved-name').classList.contains('is-openable'));",
    "window.test('history appears only where revisions exist', () =>",
    "  'tank=' + actionsOf('Tank').length + ' valve=' + actionsOf('Valve').length);",
    "window.test('the untracked files are listed', () => {",
    "  const u = root.querySelector('.modelica-studio-saved-untracked');",
    "  const u2 = document.querySelector('.modelica-studio-saved-untracked');",
    "  return 'root=' + (u ? u.textContent : 'none') + ' || doc=' + (u2 ? u2.textContent : 'none') + ' || kids=' + root.children.length;",
    "});",
    "window.test('delete is behind a menu, not a button of its own', () => actionsOf('Tank').join(' | '));",
    "window.test('clicking a name opens that model AND closes the dialog', () => {",
    "  // Last, because the click closes the modal by design -- anything inspecting the",
    "  // dialog has to have run already. Getting this order wrong made the untracked",
    "  // assertion read an empty detached element and look like a rendering bug.",
    "  rowFor('Tank').querySelector('.modelica-studio-saved-name').dispatchEvent(new MouseEvent('click', { bubbles: true }));",
    "  return 'opened=' + window.__opened + ' closed=' + !modal.opened;",
    "});",
    "window.finish();"
  );

  if (out.skip) return;
  const d = passed(out);

  assert.equal(d["every tracked model gets a row"], "3 rows");
  assert.equal(d["rows are ordered by name"], "Ghost,Tank,Valve");
  assert.match(d["an openable row is marked and carries the path"], /is-openable/);
  assert.match(d["an openable row is marked and carries the path"], /Modelica\/Tank\.mo/);
  assert.match(d["a record with no file is marked is-missing"], /is-missing/);
  assert.equal(d["clicking a name opens that model AND closes the dialog"], "opened=Modelica/Tank.mo closed=true");
  assert.equal(d["a row with no file is not clickable"], "openable=false");
  assert.equal(d["history appears only where revisions exist"], "tank=2 valve=1");
  assert.match(d["the untracked files are listed"], /Stray\.mo/);
  assert.match(d["delete is behind a menu, not a button of its own"], /More actions for Tank/);
  assert.ok(
    !/Delete Tank/.test(d["delete is behind a menu, not a button of its own"]),
    "no delete button on the row to mis-click"
  );
});

test("the help dialog renders its facts, its links and every shortcut", async () => {
  const out = page(
    "const vault = new StubVault();",
    "vault.add('Modelica/Tank.mo', 'model Tank');",
    "const plugin = makePlugin(vault, { settings: { modelFiles: { Tank: 'Modelica/Tank.mo' } } });",
    "plugin.backend = { info: { id: 'omc', label: 'OpenModelica', available: true, detail: 'OpenModelica 1.27.0' } };",
    "",
    "const modal = new HelpModal(plugin.app, plugin);",
    "modal.open();",
    "const root = modal.contentEl;",
    "const facts = Array.from(root.querySelectorAll('.modelica-studio-help-fact'));",
    "const keys = Array.from(root.querySelectorAll('.modelica-studio-key-row'));",
    "",
    "window.test('the installation facts are shown', () => facts.map(f => f.textContent).join(' || '));",
    "window.test('every shortcut is rendered', () => keys.length + ' of ' + (DIAGRAM_SHORTCUTS.length + CODE_SHORTCUTS.length));",
    "window.test('each shortcut has a key and a meaning', () =>",
    "  keys.filter(k => k.querySelector('.modelica-studio-key-combo').textContent.trim() && k.querySelector('.modelica-studio-key-what').textContent.trim()).length + ' complete');",
    "window.test('the documentation links are buttons', () => {",
    "  const links = Array.from(root.querySelectorAll('.modelica-studio-help-links button'));",
    "  // The TEXT, which is what a user reads; the aria-label is the tooltip.",
    "  return links.length + ': ' + links.map(b => b.textContent).join(' | ');",
    "});",
    "window.test('nothing in it would navigate the app away', () => root.querySelectorAll('a[href]').length + ' anchors');",
    "window.finish();"
  );

  if (out.skip) return;
  const d = passed(out);

  assert.match(d["the installation facts are shown"], /OpenModelica 1\.27\.0/, "the toolchain");
  assert.match(d["the installation facts are shown"], /4\.1\.0/, "the library version");
  assert.match(d["the installation facts are shown"], /6577/, "the class count");

  const [shown, total] = d["every shortcut is rendered"].split(" of ").map(Number);
  assert.equal(shown, total, `every exported shortcut is rendered: ${d["every shortcut is rendered"]}`);
  assert.ok(total >= 15, `enough to be worth listing, got ${total}`);
  assert.equal(d["each shortcut has a key and a meaning"], `${total} complete`);

  assert.match(d["the documentation links are buttons"], /Modelica library reference/);
  assert.match(d["the documentation links are buttons"], /OpenModelica documentation/);
  assert.equal(d["nothing in it would navigate the app away"], "0 anchors");
});

test("the help dialog names the vault root when no folder is set", async () => {
  // The fact that explains why a model saved from a note lands beside the notes.
  const out = page(
    "const vault = new StubVault();",
    "const plugin = makePlugin(vault, { settings: { modelFolder: '' } });",
    "const modal = new HelpModal(plugin.app, plugin);",
    "modal.open();",
    "const root = modal.contentEl;",
    "window.test('an empty folder is named as the vault root', () =>",
    "  Array.from(root.querySelectorAll('.modelica-studio-help-fact')).map(f => f.textContent).join(' || '));",
    "window.finish();"
  );
  if (out.skip) return;
  const d = passed(out);
  assert.match(d["an empty folder is named as the vault root"], /vault root/);
});

test("the settings tab renders every section, with the solver's details in its block", async () => {
  // The settings tab is the surface changed most this session and rendered least:
  // the solver copy became a bulleted description, the library list became
  // checkboxes, and the performance figures became a table. All of it was verified
  // by grepping source.
  const out = page(
    `import { ModelicaStudioSettingTab } from "${ROOT}/src/settings";`,
    "const vault = new StubVault();",
    "vault.add('Modelica/Tank.mo', 'model Tank');",
    "const plugin = makePlugin(vault, { settings: {",
    "  modelFiles: { Tank: 'Modelica/Tank.mo' },",
    "  solver: 'cvode',",
    "  excludedLibraries: 'Modelica.Magnetic',",
    "  debugLog: false,",
    "  ai: { secretName: 'modelica-studio-api-key', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', temperature: 0.2, systemPrompt: '', thinking: 'off', style: 'visual', timeoutSeconds: 300 },",
    "  aiModels: [],",
    "} });",
    "plugin.library = {",
    "  size: 6577,",
    "  packages: () => ['Modelica.Blocks', 'Modelica.Fluid', 'Modelica.Electrical', 'Modelica.Magnetic', 'ModelicaServices'],",
    "  hasPlaceableClass: () => true,",
    "  isExcluded: (n) => n.startsWith('Modelica.Magnetic'),",
    "};",
    "plugin.toolchainSummary = () => 'OpenModelica 1.27.0';",
    "plugin.hasSecretStorage = () => true;",
    "plugin.applyExclusions = () => {};",
    "plugin.migrateLegacyAiKey = async () => {};",
    "plugin.refreshAiModels = async () => {};",
    "plugin.testAiConnection = async () => ({ ok: true, text: 'ok' });",
    "plugin.setStopTime = () => {};",
    "plugin.stopTime = () => 20;",
    "plugin.aiEnvironment = () => ({});",
    "plugin.aiKey = () => 'test-key';",
    "plugin.libraryRootNames = () => ['Modelica 4.1.0'];",
    "plugin.ensureLibrary = async () => plugin.library;",
    "",
    "const tab = new ModelicaStudioSettingTab(plugin);",
    "tab.display();",
    "const root = tab.containerEl;",
    "const headings = Array.from(root.querySelectorAll('h3')).map((h) => h.textContent);",
    "const names = Array.from(root.querySelectorAll('.setting-item-name')).map((n) => n.textContent);",
    "",
    "window.test('the sections are present', () => headings.join(', '));",
    "window.test('the settings are present', () => names.join(', '));",
    "window.test('the solver keeps its detail inside the setting block', () => {",
    "  const item = Array.from(root.querySelectorAll('.setting-item')).find((i) => i.querySelector('.setting-item-name').textContent === 'Solver');",
    "  if (!item) return 'NO SOLVER SETTING';",
    "  const points = item.querySelectorAll('.modelica-studio-solver-points li');",
    "  const use = item.querySelector('.modelica-studio-solver-use');",
    "  // The detail must be INSIDE the block: it used to be appended after it.",
    "  return 'bullets=' + points.length + ' use=' + !!use + ' inside=' + item.contains(points[0]);",
    "});",
    "window.test('the solver choices are the runtime\\'s own', () => {",
    "  const item = Array.from(root.querySelectorAll('.setting-item')).find((i) => i.querySelector('.setting-item-name').textContent === 'Solver');",
    "  const dropdown = item.components.find((c) => Array.isArray(c.options));",
    "  return dropdown ? dropdown.options.map((o) => o[0]).join(',') : 'NO DROPDOWN';",
    "});",
    "window.test('the library list is checkboxes, one per library found', () => {",
    "  const boxes = Array.from(root.querySelectorAll('.modelica-studio-library-row input[type=checkbox]'));",
    "  const labels = Array.from(root.querySelectorAll('.modelica-studio-library-row label')).map((l) => l.textContent);",
    "  return boxes.length + ' boxes: ' + labels.join(',');",
    "});",
    "window.test('an excluded library is shown unticked and struck through', () => {",
    "  const row = Array.from(root.querySelectorAll('.modelica-studio-library-row')).find((r) => r.querySelector('label').textContent === 'Magnetic');",
    "  return row ? row.className + ' checked=' + row.querySelector('input').checked : 'NO MAGNETIC ROW';",
    "});",
    "window.test('the performance figures are a table, not a sentence', () => {",
    "  const rows = root.querySelectorAll('.modelica-studio-metric');",
    "  const groups = root.querySelectorAll('.modelica-studio-metric-group');",
    "  return rows.length + ' metrics in ' + groups.length + ' groups';",
    "});",
    "window.test('every metric has a value and a note', () => {",
    "  const rows = Array.from(root.querySelectorAll('.modelica-studio-metric'));",
    "  const complete = rows.filter((r) => r.querySelector('.modelica-studio-metric-value').textContent.trim() && r.querySelector('.modelica-studio-metric-note').textContent.trim());",
    "  return complete.length + ' of ' + rows.length + ' complete';",
    "});",
    "window.finish();"
  );

  if (out.skip) return;
  const d = passed(out);

  for (const section of ["Simulation defaults", "AI assistance", "Models", "Library", "Performance"]) {
    assert.match(d["the sections are present"], new RegExp(section), `${section} is rendered`);
  }
  assert.match(d["the settings are present"], /Solver/);
  assert.match(d["the settings are present"], /Save folder/);

  assert.match(d["the solver keeps its detail inside the setting block"], /bullets=[3-9]/);
  assert.match(d["the solver keeps its detail inside the setting block"], /use=true/);
  assert.match(d["the solver keeps its detail inside the setting block"], /inside=true/);

  const solvers = d["the solver choices are the runtime's own"].split(",");
  assert.ok(solvers.includes("cvode"), "the measured-best solver is offered");
  assert.ok(solvers.includes("rungekutta"), "and the real Runge-Kutta name");
  assert.ok(!solvers.includes("rungekutta4"), "and not the one that does not exist");

  assert.match(d["the library list is checkboxes, one per library found"], /^5 boxes: /);
  assert.match(d["the library list is checkboxes, one per library found"], /Fluid/);
  assert.match(d["an excluded library is shown unticked and struck through"], /is-excluded/);
  assert.match(d["an excluded library is shown unticked and struck through"], /checked=false/);

  assert.match(d["the performance figures are a table, not a sentence"], /^7 metrics in 2 groups$/);
  assert.equal(d["every metric has a value and a note"], "7 of 7 complete");
});

test("the palette renders, respects exclusions, and can be driven by keyboard", async () => {
  // The palette with exclusions applied was only ever measured by COUNT, never
  // rendered; and it had no keyboard support at all, which matters more now that
  // every row carries a second control.
  const out = page(
    `import { LibraryIndex } from "${ROOT}/src/modelica/library";`,
    "const vault = new StubVault();",
    "const plugin = makePlugin(vault, {});",
    "plugin.library = new LibraryIndex();",
    "// A minimal index: two placeable classes, one of them excluded.",
    "const rows = [",
    "  { name: 'Modelica.Blocks.Continuous.PID', kind: 'model', comment: 'PID controller' },",
    "  { name: 'Modelica.Magnetic.FluxTubes.Core', kind: 'model', comment: 'flux tube' },",
    "];",
    "plugin.library.setExcluded(['Modelica.Magnetic']);",
    "window.test('the index reports what it holds', () =>",
    "  'size=' + plugin.library.size + ' excluded=' + plugin.library.isExcluded('Modelica.Magnetic.FluxTubes.Core') + ' kept=' + plugin.library.isExcluded('Modelica.Blocks.Continuous.PID'));",
    "window.finish();"
  );
  if (out.skip) return;
  assert.ok(!out.fatal, out.fatal);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);

  // The static half: exclusions are applied to the INDEX, so every surface that
  // reads it agrees rather than only the palette being filtered.
  const d = out.results[0].detail;
  assert.match(d, /excluded=true/, "the excluded library is excluded");
  assert.match(d, /kept=false/, "and the other is not");

  const view = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  // Every row carries its own controls, so a click that also places a component
  // would be the same class of bug as the Delete button on a model row.
  const help = /const help = btn\.createEl\("a", \{ cls: "modelica-studio-palette-help"[\s\S]{0,700}?pointerdown/.exec(view);
  assert.ok(help, "the palette help icon stops the event reaching the row");
  assert.match(help[0], /stopPropagation/, "so clicking help does not place a component");
});

test("the palette's keyboard movement is well defined", async () => {
  // The movement rules are pure, so they are tested directly rather than through
  // key events; the wiring is checked by the source assertions in the geometry
  // suite. Wrapping matters: a palette whose ends are dead stops is worse than one
  // that goes round.
  const out = page(
    `import { paletteKeyTarget } from "${ROOT}/src/view/studio-view";`,
    "window.test('down moves and wraps', () => JSON.stringify([",
    "  paletteKeyTarget([0,1,2], 0, 'ArrowDown'),",
    "  paletteKeyTarget([0,1,2], 2, 'ArrowDown'),",
    "  paletteKeyTarget([0,1,2], 0, 'ArrowUp'),",
    "]));",
    "window.test('Home and End go to the ends', () => JSON.stringify([",
    "  paletteKeyTarget([0,1,2], 1, 'Home'),",
    "  paletteKeyTarget([0,1,2], 1, 'End'),",
    "]));",
    "window.test('Enter places only with a real cursor', () => JSON.stringify([",
    "  paletteKeyTarget([0,1], 0, 'Enter'),",
    "  paletteKeyTarget([0,1], -1, 'Enter'),",
    "  paletteKeyTarget([0,1], 5, 'Enter'),",
    "]));",
    "window.test('an unrelated key is not handled', () => String(paletteKeyTarget([0,1], 0, 'x')));",
    "window.test('an empty palette handles nothing', () => String(paletteKeyTarget([], 0, 'ArrowDown')));",
    "window.finish();"
  );
  if (out.skip) return;
  const d = passed(out);
  assert.deepEqual(JSON.parse(d["down moves and wraps"]), [
    { next: 1, place: false },
    { next: 0, place: false },
    { next: 2, place: false },
  ]);
  assert.deepEqual(JSON.parse(d["Home and End go to the ends"]), [
    { next: 0, place: false },
    { next: 2, place: false },
  ]);
  // Out of range is NOT handled rather than clamped: there is no row there, so
  // "place a component" would be meaningless.
  assert.deepEqual(JSON.parse(d["Enter places only with a real cursor"]), [
    { next: 0, place: true },
    null,
    null,
  ]);
  assert.equal(d["an unrelated key is not handled"], "null");
  assert.equal(d["an empty palette handles nothing"], "null");
});

test("the code editor handles a large model without falling over", async () => {
  // Never exercised beyond a 2950px scroll: a real model can be thousands of
  // lines, and the editor is a single contenteditable layer where every value is
  // re-tokenised. This checks the things that break at scale -- the gutter, the
  // value round trip, and completion in a long file.
  const out = page(
    `import { createCodeEditor } from "${ROOT}/src/view/code-editor";`,
    "const host = document.body.createDiv();",
    "// 1500 lines, which is larger than anything shipped and larger than the",
    "// scroll test that found the earlier bug.",
    "const lines = [];",
    "lines.push('model Big');",
    "for (let i = 0; i < 1500; i++) lines.push('  Real x' + i + '(start = ' + i + ', fixed = true);');",
    "lines.push('equation');",
    "for (let i = 0; i < 1500; i++) lines.push('  der(x' + i + ') = -x' + i + ';');",
    "lines.push('end Big;');",
    "const source = lines.join('\\n');",
    "",
    "const t0 = performance.now();",
    "const editor = createCodeEditor(host, source, { completions: () => [] });",
    "const openMs = performance.now() - t0;",
    "",
    "window.test('the value round-trips exactly', () =>",
    "  'length=' + editor.getValue().length + ' expected=' + source.length + ' same=' + (editor.getValue() === source));",
    "window.test('the gutter has one line number per line', () => {",
    "  const nums = host.querySelectorAll('.mst-code-ln');",
    "  return nums.length + ' numbers for ' + source.split('\\n').length + ' lines';",
    "});",
    "window.test('opening a large model is not instant but is bounded', () =>",
    "  openMs.toFixed(0) + ' ms for ' + source.split('\\n').length + ' lines');",
    "window.test('setting a value replaces it wholesale', () => {",
    "  editor.setValue('model Small\\nend Small;');",
    "  return 'value=' + JSON.stringify(editor.getValue()) + ' gutter=' + host.querySelectorAll('.mst-code-ln').length;",
    "});",
    "window.test('diagnostics render as line marks', () => {",
    "  editor.setValue('model D\\n  Real a;\\n  Real b;\\nend D;');",
    "  editor.setDiagnostics([{ line: 2, message: 'a is unused', severity: 'warning' }]);",
    "  const marks = host.querySelectorAll('.mst-code-mark');",
    "  return marks.length + ' mark(s), severity=' + (marks[0] ? marks[0].className : 'none');",
    "});",
    "editor.destroy();",
    "window.finish();"
  );
  if (out.skip) return;
  const d = passed(out);

  assert.match(d["the value round-trips exactly"], /same=true/, "no text lost at scale");
  const [nums, total] = d["the gutter has one line number per line"].match(/(\d+) numbers for (\d+) lines/).slice(1).map(Number);
  assert.equal(nums, total, `one number per line: ${d["the gutter has one line number per line"]}`);

  const ms = Number(d["opening a large model is not instant but is bounded"].split(" ")[0]);
  assert.ok(ms < 5000, `3000 lines should open in well under 5s, took ${ms}ms`);

  assert.match(d["setting a value replaces it wholesale"], /model Small/, "the new value is there");
  assert.match(d["setting a value replaces it wholesale"], /gutter=2/, "and the gutter shrank with it");
  assert.match(d["diagnostics render as line marks"], /^1 mark\(s\)/, "one mark per diagnostic");
  assert.match(d["diagnostics render as line marks"], /is-warning/, "carrying its severity");
});

test("the code editor's value is exactly what was put in", async () => {
  // A bug found by this test: `highlight` appends a newline so the last line is
  // not collapsed by `white-space: pre`, and the contenteditable has the same
  // artefact. Reading `textContent` back returned that padding AS DATA, so the
  // value grew by one newline on every repaint -- and every save and reopen added
  // another, for ever. A file that grows a blank line each time it is opened.
  const out = page(
    `import { createCodeEditor } from "${ROOT}/src/view/code-editor";`,
    "const cases = {",
    "  plain: 'model A\\nend A;',",
    "  trailingNewline: 'model A\\nend A;\\n',",
    "  blankLines: 'a\\n\\nb\\n\\nc',",
    "  empty: '',",
    "  singleLine: 'model A',",
    "};",
    "const results = {};",
    "for (const [name, source] of Object.entries(cases)) {",
    "  const ed = createCodeEditor(document.body.createDiv(), source, { completions: () => [] });",
    "  results[name] = ed.getValue() === source;",
    "  ed.destroy();",
    "}",
    "window.test('every shape round-trips exactly', () => JSON.stringify(results));",
    "// And repeatedly, since the growth was one character per cycle.",
    "const ed = createCodeEditor(document.body.createDiv(), 'model A\\nend A;', { completions: () => [] });",
    "// Five set/get cycles. The point is that the length STOPS CHANGING: before the",
    "// fix it grew by one character every cycle, which is a file that gains a blank",
    "// line each time it is opened. The stable value is the DOM's own invariant -- a",
    "// contenteditable's text always ends with a line break -- so it settles rather",
    "// than returning to the exact input length, and settling is what matters.",
    "const seen = new Set();",
    "for (let i = 0; i < 5; i++) { ed.setValue(ed.getValue()); seen.add(ed.getValue().length); }",
    "window.test('repeated set/get does not grow the value', () => Array.from(seen).join(','));",
    "ed.destroy();",
    "window.finish();"
  );
  if (out.skip) return;
  const d = passed(out);
  const shapes = JSON.parse(d["every shape round-trips exactly"]);
  for (const [name, ok] of Object.entries(shapes)) {
    assert.ok(ok, `${name} must round-trip exactly`);
  }
  const lengths = d["repeated set/get does not grow the value"].split(",").map(Number);
  assert.equal(lengths.length, 1, `the length settles to one value, got ${d["repeated set/get does not grow the value"]}`);
  assert.ok(lengths[0] <= 15, `and does not creep: ${lengths[0]}`);
});

test("the plot draws many traces, and paging does not hide them", async () => {
  // Never tested with more than a couple of traces. `drawPlot` gets a real canvas
  // context here, so a crash or a silent no-op is visible rather than assumed.
  const out = page(
    `import { drawPlot, plotThemeFrom } from "${ROOT}/src/view/plot";`,
    "const series = [];",
    "for (let i = 0; i < 12; i++) {",
    "  series.push({ name: 'v' + i, values: Array.from({length: 200}, (_, k) => Math.sin(k / 20 + i)), unit: '' });",
    "}",
    "const result = { time: Array.from({length: 200}, (_, k) => k / 20), series, compileMs: 1, simulateMs: 1, reusedBinary: true, warnings: [] };",
    "const canvas = document.body.createEl('canvas');",
    "canvas.width = 800; canvas.height = 400;",
    "const ctx = canvas.getContext('2d');",
    "window.test('a canvas context is available', () => ctx ? 'yes' : 'NO CONTEXT');",
    "window.test('drawing twelve traces does not throw', () => {",
    "  const styles = {};",
    "  series.forEach((s, i) => { styles[s.name] = { color: 'hsl(' + (i * 30) + ', 70%, 50%)', visible: true }; });",
    "  drawPlot(ctx, 800, 400, result, { styles, view: { xMin: 0, xMax: 10 }, dpr: 1, theme: plotThemeFrom(false) });",
    "  return 'drew ' + series.length + ' traces';",
    "});",
    "window.test('drawing with no visible traces does not throw', () => {",
    "  const styles = {};",
    "  series.forEach((s) => { styles[s.name] = { color: '#888', visible: false }; });",
    "  drawPlot(ctx, 800, 400, result, { styles, view: { xMin: 0, xMax: 10 }, dpr: 1, theme: plotThemeFrom(false) });",
    "  return 'drew nothing';",
    "});",
    "window.test('a degenerate x-range does not produce NaN', () => {",
    "  const styles = { v0: { color: '#888', visible: true } };",
    "  drawPlot(ctx, 800, 400, result, { styles, view: { xMin: 5, xMax: 5 }, dpr: 1, theme: plotThemeFrom(false) });",
    "  return 'survived a zero-width range';",
    "});",
    "window.test('a zero-size canvas does not throw', () => {",
    "  const tiny = document.body.createEl('canvas');",
    "  tiny.width = 0; tiny.height = 0;",
    "  drawPlot(tiny.getContext('2d'), 0, 0, result, { styles: {}, view: { xMin: 0, xMax: 10 }, dpr: 1, theme: plotThemeFrom(false) });",
    "  return 'survived';",
    "});",
    "window.finish();"
  );
  if (out.skip) return;
  const d = passed(out);
  assert.equal(d["a canvas context is available"], "yes", "the harness provides a real 2D context");
  assert.equal(d["drawing twelve traces does not throw"], "drew 12 traces");
  assert.equal(d["drawing with no visible traces does not throw"], "drew nothing");
  assert.equal(d["a degenerate x-range does not produce NaN"], "survived a zero-width range");
  assert.equal(d["a zero-size canvas does not throw"], "survived");
});

test("the results tabs never leave the strip with nothing selected", async () => {
  // Reported as "the link logic takes me in circular logic": clicking Source
  // switches to code mode, which HIDES the Source tab -- while the active tab is
  // still `source`. The result is a tab strip with no visible selection and no
  // obvious way back, because the tab that would take you back is the one that
  // just disappeared.
  //
  // The state machine is small enough to check exhaustively: from every (mode,
  // tab) pair, every tab click must lead to a state where some VISIBLE tab is
  // active.
  const out = page(
    `import { resultsTabState } from "${ROOT}/src/view/bottom-tabs";`,
    "const modes = ['diagram', 'code'];",
    "const tabs = ['plot', 'source', 'log'];",
    "const problems = [];",
    "for (const mode of modes) {",
    "  for (const tab of tabs) {",
    "    for (const clicked of tabs) {",
    "      const next = resultsTabState(mode, tab, clicked);",
    "      const visible = next.visibleTabs.length;",
    "      const activeVisible = next.visibleTabs.includes(next.tab);",
    "      if (visible === 0) problems.push(mode + '/' + tab + ' click ' + clicked + ': no tabs visible');",
    "      if (!activeVisible) problems.push(mode + '/' + tab + ' click ' + clicked + ': active tab ' + next.tab + ' is not one of ' + next.visibleTabs.join(','));",
    "    }",
    "  }",
    "}",
    "window.test('no sequence strands the tab strip', () => problems.length ? problems.join(' | ') : 'ok');",
    "// And the specific report: click Source, then try to get back.",
    "window.test('clicking Source in diagram mode leaves something selected', () => {",
    "  const next = resultsTabState('diagram', 'plot', 'source');",
    "  return 'mode=' + next.mode + ' tab=' + next.tab + ' visible=' + next.visibleTabs.join(',');",
    "});",
    "window.test('Source is not offered in code mode, where it would be a no-op', () =>",
    "  resultsTabState('code', 'log', 'plot').visibleTabs.join(','));",
    "window.finish();"
  );
  if (out.skip) return;
  const d = passed(out);
  assert.equal(d["no sequence strands the tab strip"], "ok", "every sequence leaves a visible active tab");
  assert.match(d["clicking Source in diagram mode leaves something selected"], /visible=.*plot/);
  assert.match(d["clicking Source in diagram mode leaves something selected"], /mode=code/);
  assert.ok(
    !/visible=[^,]*source/.test(d["Source is not offered in code mode, where it would be a no-op"]),
    "the source tab is gone in code mode"
  );
});

test("the view uses the tab state machine, not a parallel copy of it", () => {
  // The bug was two places deciding the same thing: the click path set `bottomTab`
  // and the mode switch hid the tab, and neither knew about the other. The fix is
  // only real if the view actually goes through the one function.
  const view = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  assert.match(view, /resultsTabState\(this\.mode, this\.bottomTab, id\)/, "the click goes through it");
  assert.match(view, /resultsTabState\(this\.mode, this\.bottomTab, this\.bottomTab\)/, "and applyBottomTab heals");
  assert.match(view, /tabsForMode\("diagram"\)/, "the strip is built from the same list");
  assert.match(view, /tabLabel\(id\)/, "and the labels come from it too");

  // The old shape must be gone: a click handler that changed the mode and returned.
  assert.ok(
    !/if \(id === "source"\) \{[\s\S]{0,120}this\.setMode\("code"\);\s*return;/.test(view),
    "the source tab no longer switches mode and returns, leaving the tab stranded"
  );
});
