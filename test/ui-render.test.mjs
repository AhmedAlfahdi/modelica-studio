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
  "    manifest: { id: 'modelica-studio', version: '0.2.0-beta.1' },",
  "    settings: Object.assign({ modelFolder: 'Modelica', modelFiles: {} }, opts.settings),",
  "    model: { name: 'Tank', components: [], connections: [], equations: [] },",
  "    backend: null,",
  "    library: {",
  // 6 Modelica classes and 2 from a sibling library, so the two counts in the",
  // help window are distinguishable.",
  "      size: 8,",
  "      allNames: () => ['Modelica.Blocks.Math.Feedback', 'Modelica.Blocks.Sources.Constant',",
  "        'Modelica.Electrical.Analog.Basic.Resistor', 'Modelica.Fluid.Sources.Boundary_pT',",
  "        'Modelica.Mechanics.Translational.Sources.Force', 'Modelica.Thermal.HeatTransfer.Components.HeatCapacitor',",
  "        'ModelicaServices.Machine', 'ModelicaReference.Annotations'],",
  "      packages: () => [],",
  "    },",
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
    // A real installation indexes the sibling libraries too, which is what makes
    // the two counts different.
    "plugin.libraryRootNames = () => ['Modelica 4.1.0+maint.om', 'ModelicaServices 4.1.0+maint.om', 'ModelicaReference 4.1.0+maint.om'];",
    "",
    "const modal = new HelpModal(plugin.app, plugin);",
    "modal.open();",
    "const root = modal.contentEl;",
    "const facts = Array.from(root.querySelectorAll('.modelica-studio-help-fact'));",
    "const keys = Array.from(root.querySelectorAll('.modelica-studio-key-row'));",
    "",
    "window.test('the installation facts are shown', () => facts.map(f => f.textContent).join(' || '));",
    "window.test('the reading-the-diagram notes are shown', () => {",
    "  const at = Array.from(root.querySelectorAll('h4')).findIndex((h) => h.textContent === 'Reading the diagram');",
    "  if (at < 0) return 'NO SECTION';",
    "  const heads = Array.from(root.querySelectorAll('h4'));",
    "  const paras = Array.from(root.querySelectorAll('p'));",
    "  return paras.filter((p) => p.textContent.includes('Hovering a component') || p.textContent.includes('dimmed connector')).map((p) => p.textContent).join(' || ');",
    "});",
    "window.test('every shortcut is rendered', () => keys.length + ' of ' + (DIAGRAM_SHORTCUTS.length + CODE_SHORTCUTS.length));",
    "window.test('each shortcut has a key and a meaning', () =>",
    "  keys.filter(k => k.querySelector('.modelica-studio-key-combo').textContent.trim() && k.querySelector('.modelica-studio-key-what').textContent.trim()).length + ' complete');",
    "window.test('the documentation links are buttons', () => {",
    "  const links = Array.from(root.querySelectorAll('.modelica-studio-help-links button'));",
    "  // The TEXT, which is what a user reads; the aria-label is the tooltip.",
    "  return links.length + ': ' + links.map(b => b.textContent).join(' | ');",
    "});",
    "window.test('nothing in it would navigate the app away', () => root.querySelectorAll('a[href]').length + ' anchors');",
    "window.test('the domain colour legend is rendered', () => {",
    "  const rows = Array.from(root.querySelectorAll('.modelica-studio-help-domain-label, .modelica-studio-domain'));",
    "  const domains = Array.from(root.querySelectorAll('.modelica-studio-domain'));",
    "  return domains.length + ' domains: ' + domains.map((d) => d.getAttribute('data-domain')).join(',');",
    "});",
    "window.test('each legend row carries its own colour attribute', () => {",
    "  const cells = Array.from(root.querySelectorAll('.modelica-studio-help-domains .modelica-studio-domain'));",
    "  const wrong = cells.filter((c) => !c.matches('.modelica-studio-domain[data-domain=\"' + c.getAttribute('data-domain') + '\"]'));",
    "  return cells.length + ' coloured, ' + wrong.length + ' without a matching rule';",
    "});",
    "window.test('every legend row names the library code or says there is none', () => {",
    "  const codes = Array.from(root.querySelectorAll('.modelica-studio-help-domain-code')).map((c) => c.textContent);",
    "  return codes.length + ' codes, ' + codes.filter((c) => c === '\u2014').length + ' with none';",
    "});",
    "window.test('the legend splits the library codes from the plugin ones', () =>",
    "  Array.from(root.querySelectorAll('.modelica-studio-help-legend-head')).map((h) => h.textContent).join(' || '));",
    "window.test('the legend links to the library page', () => {",
    "  const b = Array.from(root.querySelectorAll('.modelica-studio-help-links button')).find((x) => /icon conventions/i.test(x.textContent));",
    "  return b ? b.getAttribute('aria-label') : 'MISSING';",
    "});",
    "window.test('the legend link opens a URL the site serves', () => {",
    "  const b = Array.from(root.querySelectorAll('.modelica-studio-help-links button')).find((x) => /icon conventions/i.test(x.textContent));",
    "  if (!b) return 'MISSING';",
    "  // openInBrowser builds an anchor and clicks it. Capture the href instead of",
    "  // letting the click leave the page, so this reads the URL a user would get.",
    "  const opened = [];",
    "  const orig = HTMLAnchorElement.prototype.click;",
    "  HTMLAnchorElement.prototype.click = function () { opened.push(this.href); };",
    "  try { b.click(); } finally { HTMLAnchorElement.prototype.click = orig; }",
    "  return opened.length ? opened.join(',') : 'NOTHING OPENED';",
    "});",
    "window.finish();"
  );

  if (out.skip) return;
  const d = passed(out);

  assert.match(d["the installation facts are shown"], /OpenModelica 1\.27\.0/, "the toolchain");
  assert.match(d["the installation facts are shown"], /4\.1\.0/, "the library version");
  // The count under the library's name is the LIBRARY's, not the whole index:
  // reporting the total there overstated the standard library by the classes
  // that come from the sibling libraries, and made a figure the reader can check
  // against their own installation impossible to check.
  assert.match(d["the installation facts are shown"], /6 classes indexed/, "the library's own count");
  assert.ok(
    !/8 classes indexed/.test(d["the installation facts are shown"]),
    `not the whole-index total: ${d["the installation facts are shown"]}`
  );
  assert.match(d["the installation facts are shown"], /Also indexed/, "the sibling libraries are named");
  assert.match(d["the installation facts are shown"], /2 classes/, "with their own count");

  // The behaviour with no visible affordance is written down.
  assert.match(d["the reading-the-diagram notes are shown"], /Hovering a component/);
  assert.match(d["the reading-the-diagram notes are shown"], /dimmed connector/);

  const [shown, total] = d["every shortcut is rendered"].split(" of ").map(Number);
  assert.equal(shown, total, `every exported shortcut is rendered: ${d["every shortcut is rendered"]}`);
  assert.ok(total >= 15, `enough to be worth listing, got ${total}`);
  assert.equal(d["each shortcut has a key and a meaning"], `${total} complete`);

  assert.match(d["the documentation links are buttons"], /Modelica library reference/);
  assert.match(d["the documentation links are buttons"], /OpenModelica documentation/);
  assert.equal(d["nothing in it would navigate the app away"], "0 anchors");

  // The colour legend, rendered rather than grepped: the attributes have to reach
  // the elements, which is exactly what a source-level check could not tell.
  const legend = /^(\d+) domains: (.+)$/.exec(d["the domain colour legend is rendered"]);
  assert.ok(legend, `the legend renders rows: ${d["the domain colour legend is rendered"]}`);
  const legendDomains = legend[2].split(",");
  assert.equal(Number(legend[1]), legendDomains.length, "every row names a domain");
  for (const needed of ["electrical", "thermal", "magnetic", "fluid", "mechanical"]) {
    assert.ok(legendDomains.includes(needed), `${needed} appears in the legend`);
  }
  assert.match(d["each legend row carries its own colour attribute"], /^(\d+) coloured, 0 without/, "each row matches its rule");
  assert.match(d["every legend row names the library code or says there is none"], /^\d+ codes, 3 with none$/, "three domains have no library code");
  // Which of the rows are the library's and which are this plugin's is the
  // distinction the section exists to make, and one list could not make it.
  const heads = d["the legend splits the library codes from the plugin ones"].split(" || ");
  assert.equal(heads.length, 2, `two tables: ${heads.join(" | ")}`);
  assert.match(heads[0], /Conventions\.Icons/, "the library's codes say where they come from");
  assert.match(heads[1], /this plugin adds/, "and the plugin's own matchings are marked as such");
  assert.match(d["the legend links to the library page"], /UsersGuide\.Conventions\.Icons/, "and cites the library page");

  // The URL the click actually opens, not the one in the source. The link was
  // hard-coded to the indexed library version, 4.1.0, which publishes no WSM tree
  // -- so it 404'd on click while every source-level check passed.
  const opened = d["the legend link opens a URL the site serves"];
  assert.ok(!/4\.1\.0/.test(opened), `the WSM tree for 4.1.0 does not exist: ${opened}`);
  assert.match(
    opened,
    /^https:\/\/doc\.modelica\.org\/Modelica%204\.0\.0\/Resources\/helpWSM\/Modelica\/Modelica\.UsersGuide\.Conventions\.Icons\.html$/,
    "the conventions page, on a tree that is published"
  );
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
    "  showInstanceLabels: true,",
    "  labelScale: 1.4,",
    "  hoverParameters: false,",
    "  wireScale: 1.6,",
    "  symbolStrokeScale: 2.2,",
    "  syncStrokeScale: false,",
    "  diagramReadoutScale: 1.3,",
    "  plotReadoutScale: 1.8,",
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
    "window.test('the diagram controls exist and show the stored values', () => {",
    "  const item = (n) => Array.from(root.querySelectorAll('.setting-item')).find((i) => i.querySelector('.setting-item-name').textContent === n);",
    "  const names = ['Show component names', 'Label size', 'Link wire and component thickness', 'Wire thickness', 'Component line thickness', 'Show parameters when hovering a component', 'Parameter popup size'];",
    "  const missing = names.filter((n) => !item(n));",
    "  if (missing.length) return 'MISSING: ' + missing.join();",
    "  // The component carries the value, so the tab is reading the setting rather",
    "  // than rendering a default. Each is given a distinct one in the fixture.",
    "  const sliderAt = (n) => {",
    "    const c = item(n).components.find((x) => typeof x.setDynamicTooltip === 'function');",
    "    return c ? c.value : '?';",
    "  };",
    "  // The stub records `setLimits` so a range can be asserted, not just a value.",
    "  const wire = item('Wire thickness').components.find((x) => typeof x.setDynamicTooltip === 'function');",
    "  const symbol = item('Component line thickness').components.find((x) => typeof x.setDynamicTooltip === 'function');",
    "  window.__limits = [wire, symbol].map((c) => (c && c.limits ? c.limits.join('-') : 'not recorded')).join(' ');",
    "  const toggle = item('Show parameters when hovering a component').components",
    "    .find((c) => typeof c.setValue === 'function' && typeof c.setDynamicTooltip !== 'function');",
    "  return 'label=' + sliderAt('Label size') + ' wire=' + sliderAt('Wire thickness')",
    "    + ' popup=' + sliderAt('Parameter popup size') + ' hover=' + (toggle ? toggle.value : '?')",
    "    + ' symbol=' + sliderAt('Component line thickness')",
    "    + ' link=' + ((item('Link wire and component thickness').components.find((c) => typeof c.setValue === 'function' && typeof c.setDynamicTooltip !== 'function') || {}).value)",
    "    + ' names=' + ((item('Show component names').components.find((c) => typeof c.setValue === 'function' && typeof c.setDynamicTooltip !== 'function') || {}).value)",
    "    + ' labelRowDisabled=' + item('Label size').classList.contains('is-disabled')",
    "    + ' limits=' + window.__limits;",
    "});",
    "window.test('the plot readout has its own size, in the plot section', () => {",
    "  const item = Array.from(root.querySelectorAll('.setting-item')).find((i) => i.querySelector('.setting-item-name').textContent === 'Readout size');",
    "  if (!item) return 'NO READOUT SIZE';",
    "  const c = item.components.find((x) => typeof x.setDynamicTooltip === 'function');",
    "  const at = headings.indexOf('Results plot');",
    "  const inSection = at >= 0 && Array.from(root.querySelectorAll('.setting-item')).indexOf(item) > Array.from(root.querySelectorAll('h3')).indexOf(root.querySelectorAll('h3')[at]);",
    "  return 'value=' + (c ? c.value : '?') + ' afterPlotHeading=' + inSection;",
    "});",
    "window.test('the diagram controls are in their own section', () => {",
    "  const at = headings.indexOf('Diagram');",
    "  return at < 0 ? 'NO SECTION' : headings.slice(at, at + 3).join(' > ');",
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

  // The two diagram-label settings, rendered with stored values that are not the
  // defaults, so a tab that ignored the setting would show 100/true and fail.
  assert.equal(
    d["the diagram controls exist and show the stored values"],
    // Both sliders offer the band the STANDARD defines, not a range invented for a
    // scale that turned out to be wrong.
    "label=140 wire=160 popup=130 hover=false symbol=220 link=false names=true labelRowDisabled=false limits=50-400-10 50-400-10",
    "every diagram control reflects its own stored setting, and the wire weight reaches 1000%"
  );
  assert.equal(
    d["the plot readout has its own size, in the plot section"],
    "value=180 afterPlotHeading=true",
    "and the plot's readout is sized separately, under the plot's heading"
  );
  // Diagram, then Results plot, in that order — and nothing else between them.
  assert.match(
    d["the diagram controls are in their own section"],
    /^Diagram > Results plot/,
    "the diagram's controls are under Diagram, and the plot's under Results plot"
  );
});

test("the crossing-snap settings render, read the stored values, and grey each other", async () => {
  // Two settings for one feature: a switch, and the distance the snap reaches.
  // The distance is meaningless while the switch is off, so it has to SAY so and
  // be greyed — a control that looks live but is not read is how a setting ends
  // up appearing to do nothing. Rendered rather than grepped, because that is the
  // class of bug this session kept producing.
  const out = page(
    `import { ModelicaStudioSettingTab } from "${ROOT}/src/settings";`,
    "const vault = new StubVault();",
    "const plugin = makePlugin(vault, { settings: {",
    "  solver: 'cvode',",
    "  excludedLibraries: '',",
    "  debugLog: false,",
    "  labelScale: 1,",
    "  hoverParameters: true,",
    "  plotSnapCrossings: true,",
    "  plotSnapTolerance: 14,",
    "  plotDeltas: false,",
    "  aiModels: [],",
    "  ai: { secretName: '', baseUrl: '', model: '', temperature: 0.2, systemPrompt: '', thinking: 'off', style: 'visual', timeoutSeconds: 300 },",
    "} });",
    "plugin.library = { size: 0, packages: () => [], hasPlaceableClass: () => false, isExcluded: () => false };",
    "plugin.toolchainSummary = () => 'omc';",
    "plugin.hasSecretStorage = () => false;",
    "plugin.applyExclusions = () => {};",
    "plugin.setStopTime = () => {};",
    "plugin.stopTime = () => 1;",
    "plugin.getView = () => null;",
    "plugin.refreshEmbeds = () => {};",
    "",
    "const tab = new ModelicaStudioSettingTab(plugin);",
    "tab.display();",
    "const root = tab.containerEl;",
    "const row = (n) => Array.from(root.querySelectorAll('.setting-item')).find((i) => i.querySelector('.setting-item-name').textContent === n);",
    "const headings = Array.from(root.querySelectorAll('h3')).map((h) => h.textContent);",
    "const live = () => {",
    "  const toggle = row('Snap the cursor to where curves cross');",
    "  const dist = row('Snap distance');",
    "  if (!toggle || !dist) return { missing: [!!toggle, !!dist] };",
    "  const t = toggle.components.find((c) => typeof c.setValue === 'function' && c.inputEl.getAttribute('data-control') === 'toggle');",
    "  const s = dist.components.find((c) => c.inputEl.getAttribute('data-control') === 'slider');",
    "  return { t, s, dist, toggle };",
    "};",
    "window.test('both controls are rendered, under their own heading', () => {",
    "  const v = live();",
    "  const at = headings.indexOf('Results plot');",
    "  return 'toggle=' + !!v.t + ' slider=' + !!v.s + ' value=' + (v.s ? v.s.value : '?') + ' on=' + (v.t ? v.t.value : '?')",
    "    + ' section=' + (at < 0 ? 'NONE' : headings.slice(at, at + 1).join('')) + ' greyed=' + v.dist.className;",
    "});",
    "window.test('the stored values are the ones shown', () => {",
    "  const v = live();",
    "  if (v.missing) return 'MISSING ' + v.missing.join();",
    "  return 'distance=' + v.s.value + ' on=' + v.t.value + ' item=' + v.dist.className;",
    "});",
    "// The switch is thrown, as a click would.",
    "const before = live();",
    "before.t.value = false;",
    "before.t.inputEl.dispatchEvent(new Event('change'));",
    "const after = live();",
    "window.test('turning the snap off greys the distance and says why', () =>",
    "  'item=' + after.dist.className + ' desc=' + after.dist.querySelector('.setting-item-description').textContent);",
    "window.test('and the choice is stored', () => 'stored=' + plugin.settings.plotSnapCrossings);",
    "window.test('the distance is still the one that was set', () => 'distance=' + after.s.value);",
    "window.finish();"
  );
  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = passed(out);

  assert.match(
    d["both controls are rendered, under their own heading"],
    /toggle=true slider=true value=14 on=true/,
    "both controls exist and show what is stored"
  );
  assert.match(
    d["both controls are rendered, under their own heading"],
    /section=Results plot/,
    "under their own heading, not filed under the diagram labels"
  );
  assert.match(
    d["the stored values are the ones shown"],
    /distance=14 on=true item=setting-item$/m,
    "a live snap means an enabled row, not a greyed one"
  );

  assert.match(d["turning the snap off greys the distance and says why"], /is-disabled/, "the row is greyed");
  assert.match(
    d["turning the snap off greys the distance and says why"],
    /Not used while the snap above is off/,
    "and it says the value is not being read"
  );
  assert.equal(d["and the choice is stored"], "stored=false", "the switch writes the setting");
  assert.equal(d["the distance is still the one that was set"], "distance=14", "and it is not reset");
});

test("Help explains how a connection is drawn, with the colours themselves", async () => {
  // The rule is MSL's, and the reader cannot guess it: nothing on a diagram says
  // why one wire is blue and another is yellow at double width.
  const out = page(
    "const plugin = makePlugin(new StubVault(), {});",
    "const modal = new HelpModal(plugin.app, plugin);",
    "modal.open();",
    "const el = modal.contentEl;",
    "const diagrams = Array.from(el.querySelectorAll('.modelica-studio-help-panel')).find((p) => p.textContent.includes('Domain colours'));",
    "",
    "window.test('the section is in the Diagrams tab', () => {",
    "  if (!diagrams) return 'NO DIAGRAMS PANEL';",
    "  const headings = Array.from(diagrams.querySelectorAll('h4')).map((h) => h.textContent);",
    "  return headings.join(' | ');",
    "});",
    "window.test('the rule is stated, with the numbers measured from the library', () => {",
    "  const text = diagrams.textContent.replace(/\\s+/g, ' ');",
    "  return ['first line element', '94 connectors', '80 ask for a single line', '14 for double', 'thickness=0.5']",
    "    .map((k) => k + '=' + text.includes(k)).join(' ');",
    "});",
    "window.test('every example carries a swatch, coloured as the canvas draws it', () => {",
    "  const rows = Array.from(diagrams.querySelectorAll('.modelica-studio-help-wire-row'));",
    "  return rows.map((r) => {",
    "    const sw = r.querySelector('.modelica-studio-help-wire');",
    "    return (r.textContent.split('—')[0].trim()) + ':' + (sw ? sw.style.background + (sw.classList.contains('is-double') ? ' x2' : ' x1') : 'NO SWATCH');",
    "  }).join(' | ');",
    "});",
    "window.test('the two that are double are the bus and the frame', () => {",
    "  const dou = Array.from(diagrams.querySelectorAll('.modelica-studio-help-wire.is-double'));",
    "  return dou.length + ' double: ' + dou.map((d) => d.parentElement.textContent.split('—')[0].trim()).join(',');",
    "});",
    "window.test('the settings it interacts with are named by their current names', () => {",
    "  const text = diagrams.textContent.replace(/\\s+/g, ' ');",
    "  return 'wireThickness=' + text.includes('Wire thickness') + ' componentLines=' + text.includes('Component line thickness') + ' link=' + text.includes('Link wire and component thickness') + ' staleName=' + text.includes('Diagram labels');",
    "});",
    "window.finish();"
  );
  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = passed(out);

  assert.match(
    d["the section is in the Diagrams tab"],
    /Domain colours.*How a connection is drawn/s,
    "it follows the domain colours, which is what it builds on"
  );
  assert.equal(
    d["the rule is stated, with the numbers measured from the library"],
    "first line element=true 94 connectors=true 80 ask for a single line=true " +
      "14 for double=true thickness=0.5=true",
    "the rule and the measurement are both there"
  );
  assert.equal(
    d["every example carries a swatch, coloured as the canvas draws it"],
    // One row per domain, and each swatch is the colour the canvas would use. The
    // flange names no colour, so it is the language's black — which the theme turns
    // into ink; this page is the light theme, where ink IS black. The bus is the
    // library's {255,204,51} darkened to clear 3:1 on a pale canvas, which is the
    // wire floor; on a dark canvas the library's own value is used unchanged.
    "An electrical pin:rgb(0, 0, 255) x1 | A fluid port, on a tank or a pipe:rgb(0, 127, 255) x1 | " +
      "A thermal port:rgb(191, 0, 0) x1 | A signal port:rgb(0, 0, 127) x1 | " +
      "A translational flange, on a mass or a spring:rgb(0, 127, 0) x1 | " +
      "A rotational flange, and a magnetic port, which name no colour of their own:rgb(0, 0, 0) x1 | " +
      "A signal or control bus:rgb(166, 133, 33) x2 | A multibody frame:rgb(95, 95, 95) x2",
    "eight domains, each in the colour the renderer would use — FLUID among them, which the first version of this list left out"
  );
  // The report that started this: a fluid connector's wire is the library's pale
  // blue, and the Help window has to say so.
  assert.match(
    d["every example carries a swatch, coloured as the canvas draws it"],
    /fluid port[^|]*rgb\(0, 127, 255\)/,
    "the fluid row is there, with the Fluid library's own colour"
  );
  assert.equal(
    d["the two that are double are the bus and the frame"],
    "2 double: A signal or control bus,A multibody frame",
    "only the two the library asks 0.5 for"
  );
  assert.equal(
    d["the settings it interacts with are named by their current names"],
    "wireThickness=true componentLines=true link=true staleName=false",
    "and the renamed settings section is not referred to by its old name"
  );
});

test("linking the thicknesses gives one slider, and drives both settings", async () => {
  // MSL's `thickness` is one scale, so the two sliders are two knobs on one
  // curve. Linked, there is one knob: the wires follow the component weight, and
  // the ratio the library draws with cannot be broken by accident.
  const out = page(
    `import { ModelicaStudioSettingTab } from "${ROOT}/src/settings";`,
    "const vault = new StubVault();",
    "const plugin = makePlugin(vault, { settings: {",
    "  solver: 'cvode',",
    "  excludedLibraries: '',",
    "  debugLog: false,",
    "  labelScale: 1,",
    "  hoverParameters: true,",
    "  wireScale: 3,",
    "  symbolStrokeScale: 2.2,",
    "  syncStrokeScale: false,",
    "  plotSnapCrossings: true,",
    "  plotSnapTolerance: 14,",
    "  plotDeltas: false,",
    "  aiModels: [],",
    "  ai: { secretName: '', baseUrl: '', model: '', temperature: 0.2, systemPrompt: '', thinking: 'off', style: 'visual', timeoutSeconds: 300 },",
    "} });",
    "plugin.library = { size: 0, packages: () => [], hasPlaceableClass: () => false, isExcluded: () => false };",
    "plugin.toolchainSummary = () => 'omc';",
    "plugin.hasSecretStorage = () => false;",
    "plugin.applyExclusions = () => {};",
    "plugin.setStopTime = () => {};",
    "plugin.stopTime = () => 1;",
    "plugin.getView = () => null;",
    "plugin.refreshEmbeds = () => {};",
    "const tab = new ModelicaStudioSettingTab(plugin);",
    "tab.display();",
    "const names = () => Array.from(tab.containerEl.querySelectorAll('.setting-item-name')).map((n) => n.textContent);",
    "const item = (n) => Array.from(tab.containerEl.querySelectorAll('.setting-item')).find((i) => i.querySelector('.setting-item-name').textContent === n);",
    "const toggle = () => item('Link wire and component thickness').components.find((c) => c.inputEl.getAttribute('data-control') === 'toggle');",
    "const slider = (n) => { const i = item(n); return i ? i.components.find((c) => c.inputEl.getAttribute('data-control') === 'slider') : null; };",
    "",
    "// Which rows are SHOWN: all of them exist, and the link decides visibility.",
    "const shown = () => Array.from(tab.containerEl.querySelectorAll('.setting-item'))",
    "  .filter((i) => /thickness/i.test(i.querySelector('.setting-item-name').textContent))",
    "  .filter((i) => !i.classList.contains('modelica-studio-hidden'))",
    "  .map((i) => i.querySelector('.setting-item-name').textContent).join(',');",
    "window.test('unlinked, the two sliders are shown on their own values', () =>",
    "  'wire=' + (slider('Wire thickness') ? slider('Wire thickness').value : 'none') +",
    "  ' symbol=' + (slider('Component line thickness') ? slider('Component line thickness').value : 'none') +",
    "  ' shown=' + shown());",
    "window.test('turning the link on sets the wires to the component weight, in place', () => {",
    "  // In place: the tab is NOT rebuilt, which is what used to throw the reader",
    "  // to the top of Settings.",
    "  let empties = 0;",
    "  const empty = tab.containerEl.empty.bind(tab.containerEl);",
    "  tab.containerEl.empty = () => { empties++; empty(); };",
    "  const t = toggle();",
    "  t.setValue(true);",
    "  t.inputEl.dispatchEvent(new Event('change'));",
    "  tab.containerEl.empty = empty;",
    "  return 'wireScale=' + plugin.settings.wireScale + ' symbol=' + plugin.settings.symbolStrokeScale +",
    "    ' sync=' + plugin.settings.syncStrokeScale + ' shown=' + shown() + ' rebuilds=' + empties;",
    "});",
    "window.test('and the single slider then moves both', () => {",
    "  const shared = slider('Line thickness');",
    "  if (!shared) return 'NO SHARED SLIDER';",
    "  shared.setValue(150);",
    "  shared.inputEl.dispatchEvent(new Event('change'));",
    "  return 'wireScale=' + plugin.settings.wireScale + ' symbol=' + plugin.settings.symbolStrokeScale +",
    "    ' limits=' + shared.limits.join('-');",
    "});",
    "window.finish();"
  );
  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  const d = passed(out);

  assert.equal(
    d["unlinked, the two sliders are shown on their own values"],
    "wire=300 symbol=220 shown=Link wire and component thickness,Wire thickness,Component line thickness",
    "off by default: the stored pair is used as stored, and the shared row is hidden"
  );
  assert.equal(
    d["turning the link on sets the wires to the component weight, in place"],
    "wireScale=2.2 symbol=2.2 sync=true shown=Link wire and component thickness,Line thickness rebuilds=0",
    "one slider replaces the two, nothing is left out of step, and the tab is not rebuilt"
  );
  assert.equal(
    d["and the single slider then moves both"],
    "wireScale=1.5 symbol=1.5 limits=50-400-10",
    "the shared range is the band both accept"
  );
});

test("the reset button asks first, then resets preferences and keeps the work", async () => {
  // "Reset" in a tab whose settings include the saved-model registry is a button
  // someone presses carefully, so it has to (a) ask, (b) put the preferences back,
  // and (c) not touch anything that records work.
  const out = page(
    `import { ModelicaStudioSettingTab, DEFAULT_SETTINGS } from "${ROOT}/src/settings";`,
    "const vault = new StubVault();",
    "const plugin = makePlugin(vault, { settings: {",
    "  solver: 'ida',",
    "  stopTime: 42,",
    "  excludedLibraries: 'Modelica.Fluid',",
    "  debugLog: false,",
    "  labelScale: 2.4,",
    "  hoverParameters: true,",
    "  wireScale: 3.5,",
    "  symbolStrokeScale: 1.2,",
    "  syncStrokeScale: false,",
    "  plotSnapCrossings: true,",
    "  plotSnapTolerance: 14,",
    "  plotDeltas: false,",
    "  modelFiles: { Tank: 'Modelica/Tank.mo' },",
    "  modelStopTimes: { Tank: 20 },",
    "  charts: { Tank: { hidden: ['tank.level'] } },",
    "  aiModels: ['gpt-5'],",
    "  ai: { secretName: 'MY_KEY', baseUrl: '', model: 'someone-elses', temperature: 0.2, systemPrompt: '', thinking: 'off', style: 'visual', timeoutSeconds: 300 },",
    "} });",
    "plugin.library = { size: 0, packages: () => [], hasPlaceableClass: () => false, isExcluded: () => false };",
    "plugin.toolchainSummary = () => 'omc';",
    "plugin.hasSecretStorage = () => false;",
    "plugin.applyExclusions = () => { window.__exclusionsApplied = (window.__exclusionsApplied || 0) + 1; };",
    "plugin.setStopTime = () => {};",
    "plugin.stopTime = () => 1;",
    "plugin.getView = () => null;",
    "plugin.refreshEmbeds = () => {};",
    "const tab = new ModelicaStudioSettingTab(plugin);",
    "tab.display();",
    "const row = () => Array.from(tab.containerEl.querySelectorAll('.setting-item')).find((i) => i.querySelector('.setting-item-name').textContent === 'Reset settings to defaults');",
    "const nameOf = (n) => row().querySelector('.setting-item-name').textContent;",
    "const button = () => row().components.find((c) => c.buttonEl);",
    "const modal = () => document.querySelector('.modal');",
    "",
    "window.test('the row is there, with a button that says what it does', () => {",
    "  if (!row()) return 'NO ROW';",
    "  const b = button();",
    "  return (b && b.buttonEl ? b.buttonEl.textContent : 'NO BUTTON') + ' | ' + nameOf();",
    "});",
    "window.test('clicking it asks first, and changes nothing yet', () => {",
    "  button().buttonEl.click();",
    "  // The handler awaits the dialog, and the dialog is built before that await,",
    "  // so this is observable synchronously.",
    "  return 'modal=' + !!modal() + ' solver=' + plugin.settings.solver + ' wire=' + plugin.settings.wireScale;",
    "});",
    "window.test('the dialog names what goes and what stays', () => {",
    "  const text = modal() ? modal().textContent.replace(/\\s+/g, ' ') : 'NO MODAL';",
    "  return ['Reset settings to defaults?', 'saved', 'models', 'kept'].map((k) => k + '=' + text.includes(k)).join(' ') +",
    "    ' buttons=' + Array.from(document.querySelectorAll('.modelica-studio-prompt-buttons button')).map((b) => b.textContent).join(',');",
    "});",
    "window.finish();"
  );
  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  const d = passed(out);

  assert.equal(
    d["the row is there, with a button that says what it does"],
    "Reset | Reset settings to defaults",
    "the control says what it is"
  );
  assert.equal(
    d["clicking it asks first, and changes nothing yet"],
    "modal=true solver=ida wire=3.5",
    "nothing moves until it is confirmed"
  );
  assert.equal(
    d["the dialog names what goes and what stays"],
    "Reset settings to defaults?=true saved=true models=true kept=true buttons=Reset,Cancel",
    "and the reader is told, before they agree"
  );
  assert.ok(out.results.every((r) => r.ok), "every step ran");
});

test("confirming the reset applies the defaults and keeps the work", async () => {
  const out = page(
    `import { ModelicaStudioSettingTab, DEFAULT_SETTINGS } from "${ROOT}/src/settings";`,
    "const vault = new StubVault();",
    "const plugin = makePlugin(vault, { settings: {",
    "  solver: 'ida',",
    "  stopTime: 42,",
    "  excludedLibraries: 'Modelica.Fluid',",
    "  debugLog: false,",
    "  labelScale: 2.4,",
    "  hoverParameters: true,",
    "  wireScale: 3.5,",
    "  symbolStrokeScale: 1.2,",
    "  syncStrokeScale: false,",
    "  plotSnapCrossings: true,",
    "  plotSnapTolerance: 14,",
    "  plotDeltas: false,",
    "  modelFiles: { Tank: 'Modelica/Tank.mo' },",
    "  modelStopTimes: { Tank: 20 },",
    "  charts: { Tank: { hidden: ['tank.level'] } },",
    "  aiModels: ['gpt-5'],",
    "  ai: { secretName: 'MY_KEY', baseUrl: '', model: 'someone-elses', temperature: 0.2, systemPrompt: '', thinking: 'off', style: 'visual', timeoutSeconds: 300 },",
    "} });",
    "plugin.library = { size: 0, packages: () => [], hasPlaceableClass: () => false, isExcluded: () => false };",
    "plugin.toolchainSummary = () => 'omc';",
    "plugin.hasSecretStorage = () => false;",
    "plugin.applyExclusions = () => { window.__exclusionsApplied = (window.__exclusionsApplied || 0) + 1; };",
    "plugin.setStopTime = () => {};",
    "plugin.stopTime = () => 1;",
    "plugin.getView = () => null;",
    "plugin.refreshEmbeds = () => { window.__embeds = (window.__embeds || 0) + 1; };",
    "const tab = new ModelicaStudioSettingTab(plugin);",
    "tab.display();",
    "const row = () => Array.from(tab.containerEl.querySelectorAll('.setting-item')).find((i) => i.querySelector('.setting-item-name').textContent === 'Reset settings to defaults');",
    "window.__click = () => row().components.find((c) => c.buttonEl).buttonEl.click();",
    "window.__slider = (n) => {",
    "  const i = Array.from(tab.containerEl.querySelectorAll('.setting-item')).find((x) => x.querySelector('.setting-item-name').textContent === n);",
    "  const c = i && i.components.find((y) => y.inputEl.getAttribute('data-control') === 'slider');",
    "  return c ? c.value : 'none';",
    "};",
    "// The reset runs after the dialog is answered, which is a microtask later, so",
    "// the page body awaits it and finishes only then.",
    "(async () => {",
    "  window.__click();",
    "  await Promise.resolve();",
    "  const yes = Array.from(document.querySelectorAll('.modelica-studio-prompt-buttons button')).find((b) => b.textContent === 'Reset');",
    "  window.__confirm = !!yes;",
    "  if (yes) yes.click();",
    "  await Promise.resolve();",
    "  await Promise.resolve();",
    "  window.test('the dialog offered a way to go ahead', () => window.__confirm);",
    "  const D = DEFAULT_SETTINGS;",
    "  window.test('after confirming, every preference is back to its default', () =>",
    "    'solver=' + (plugin.settings.solver === D.solver) + ' (was ida)' +",
    "    ' stopTime=' + (plugin.settings.stopTime === D.stopTime) +",
    "    ' intervals=' + (plugin.settings.numberOfIntervals === D.numberOfIntervals) +",
    "    ' exclusions=' + (plugin.settings.excludedLibraries === D.excludedLibraries) +",
    "    ' label=' + (plugin.settings.labelScale === D.labelScale) +",
    "    ' aiModel=' + (plugin.settings.ai.model === D.ai.model) +",
    "    ' wire=' + plugin.settings.wireScale + ' symbol=' + plugin.settings.symbolStrokeScale);",
    "  window.test('and nothing that records work was touched', () =>",
    "    'files=' + JSON.stringify(plugin.settings.modelFiles) +",
    "    ' stopTimes=' + JSON.stringify(plugin.settings.modelStopTimes) +",
    "    ' charts=' + JSON.stringify(plugin.settings.charts) +",
    "    ' aiModels=' + JSON.stringify(plugin.settings.aiModels) +",
    "    ' secret=' + plugin.settings.ai.secretName);",
    "  window.test('the library exclusions are reapplied and the diagrams redraw', () =>",
    "    'exclusions=' + (window.__exclusionsApplied ?? 0) + ' embeds=' + (window.__embeds ?? 0));",
    "  window.test('and the tab shows the default in its slider', () => window.__slider('Wire thickness'));",
    "  window.test('nothing was left in a half-applied state', () =>",
    "    'solver=' + plugin.settings.solver + ' wire=' + plugin.settings.wireScale);",
    "  window.finish();",
    "})();"
  );
  if (out.skip) return;
  const d = passed(out);
  assert.equal(d["the dialog offered a way to go ahead"], "true");

  // The values the page compared, against the module's OWN defaults: `solver: ""`
  // and `stopTime: 1` are the defaults, and a test that hard-codes its own idea of
  // them drifts. The two weights are named outright, because 0.9 and 1.9 are the
  // documented taste rather than the library's 1.
  assert.equal(
    d["after confirming, every preference is back to its default"],
    "solver=true (was ida) stopTime=true intervals=true exclusions=true label=true " +
      "aiModel=true wire=0.9 symbol=1.9",
    "every preference is back to its default, and the weights to the documented taste"
  );
  assert.equal(
    d["and nothing that records work was touched"],
    'files={"Tank":"Modelica/Tank.mo"} stopTimes={"Tank":20} charts={"Tank":{"hidden":["tank.level"]}} ' +
      'aiModels=["gpt-5"] secret=MY_KEY',
    "the model registry, the per-model stop time and chart, the AI model list and the secret's name all survive"
  );
  assert.equal(
    d["the library exclusions are reapplied and the diagrams redraw"],
    "exclusions=1 embeds=1",
    "the exclusions are reapplied and the diagrams redraw"
  );
  assert.equal(d["and the tab shows the default in its slider"], "90", "the tab re-renders with the default");
  assert.equal(
    d["nothing was left in a half-applied state"],
    "solver= wire=0.9",
    "and the settings object the plugin holds is the one that changed"
  );
});

test("turning the component names off greys the size that no longer reads", async () => {
  // A control that looks live but is not read is how a setting appears to do
  // nothing. With the names off, the size below has nothing to size.
  const out = page(
    `import { ModelicaStudioSettingTab } from "${ROOT}/src/settings";`,
    "const vault = new StubVault();",
    "const plugin = makePlugin(vault, { settings: {",
    "  solver: 'cvode',",
    "  excludedLibraries: '',",
    "  debugLog: false,",
    "  showInstanceLabels: false,",
    "  labelScale: 1.4,",
    "  hoverParameters: true,",
    "  plotSnapCrossings: true,",
    "  plotSnapTolerance: 14,",
    "  plotDeltas: false,",
    "  aiModels: [],",
    "  ai: { secretName: '', baseUrl: '', model: '', temperature: 0.2, systemPrompt: '', thinking: 'off', style: 'visual', timeoutSeconds: 300 },",
    "} });",
    "plugin.library = { size: 0, packages: () => [], hasPlaceableClass: () => false, isExcluded: () => false };",
    "plugin.toolchainSummary = () => 'omc';",
    "plugin.hasSecretStorage = () => false;",
    "plugin.applyExclusions = () => {};",
    "plugin.setStopTime = () => {};",
    "plugin.stopTime = () => 1;",
    "plugin.getView = () => null;",
    "plugin.refreshEmbeds = () => { window.__embeds = (window.__embeds || 0) + 1; };",
    "const tab = new ModelicaStudioSettingTab(plugin);",
    "tab.display();",
    "const item = (n) => Array.from(tab.containerEl.querySelectorAll('.setting-item')).find((i) => i.querySelector('.setting-item-name').textContent === n);",
    "const toggle = () => item('Show component names').components.find((c) => c.inputEl.getAttribute('data-control') === 'toggle');",
    "window.test('a stored off comes up off, with the size already greyed', () =>",
    "  'names=' + toggle().value + ' disabled=' + item('Label size').classList.contains('is-disabled') +",
    "    ' input=' + item('Label size').querySelector('input').disabled);",
    "window.test('turning it back on lets the size read again', () => {",
    "  const t = toggle();",
    "  t.setValue(true);",
    "  t.inputEl.dispatchEvent(new Event('change'));",
    "  return 'stored=' + plugin.settings.showInstanceLabels + ' disabled=' + item('Label size').classList.contains('is-disabled') +",
    "    ' input=' + item('Label size').querySelector('input').disabled + ' embeds=' + (window.__embeds || 0);",
    "});",
    "window.finish();"
  );
  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  const d = passed(out);
  assert.equal(
    d["a stored off comes up off, with the size already greyed"],
    "names=false disabled=true input=true",
    "the row is greyed on the FIRST render, not only after the switch moves"
  );
  assert.equal(
    d["turning it back on lets the size read again"],
    "stored=true disabled=false input=false embeds=1",
    "the setting is stored, the row comes back, and the diagrams redraw"
  );
});

test("rebuilding the tab does not throw the reader back to the top", async () => {
  // Reported: the link switch rebuilds the rows below it, and the page jumped to
  // the top — the settings pane is scrolled inside Obsidian's container, and
  // emptying it drops scrollTop to zero.
  const out = page(
    `import { ModelicaStudioSettingTab } from "${ROOT}/src/settings";`,
    "const vault = new StubVault();",
    "const plugin = makePlugin(vault, { settings: {",
    "  solver: 'cvode',",
    "  excludedLibraries: '',",
    "  debugLog: false,",
    "  showInstanceLabels: true,",
    "  labelScale: 1,",
    "  hoverParameters: true,",
    "  wireScale: 0.9,",
    "  symbolStrokeScale: 1.9,",
    "  syncStrokeScale: false,",
    "  plotSnapCrossings: true,",
    "  plotSnapTolerance: 14,",
    "  plotDeltas: false,",
    "  aiModels: [],",
    "  ai: { secretName: '', baseUrl: '', model: '', temperature: 0.2, systemPrompt: '', thinking: 'off', style: 'visual', timeoutSeconds: 300 },",
    "} });",
    "plugin.library = { size: 0, packages: () => [], hasPlaceableClass: () => false, isExcluded: () => false };",
    "plugin.toolchainSummary = () => 'omc';",
    "plugin.hasSecretStorage = () => false;",
    "plugin.applyExclusions = () => {};",
    "plugin.setStopTime = () => {};",
    "plugin.stopTime = () => 1;",
    "plugin.getView = () => null;",
    "plugin.refreshEmbeds = () => {};",
    "const tab = new ModelicaStudioSettingTab(plugin);",
    "tab.display();",
    "// The pane as Obsidian has it: the tab's container inside a scroller.",
    "const scroller = document.createElement('div');",
    "scroller.className = 'vertical-tab-content-container';",
    "scroller.style.overflowY = 'auto';",
    "scroller.style.height = '200px';",
    "document.body.appendChild(scroller);",
    "scroller.appendChild(tab.containerEl);",
    "const item = (n) => Array.from(tab.containerEl.querySelectorAll('.setting-item')).find((i) => i.querySelector('.setting-item-name').textContent === n);",
    "window.__scroller = scroller;",
    "window.__tab = tab;",
    "window.test('the pane scrolls at all, so the test means something', () =>",
    "  'scrollHeight=' + (scroller.scrollHeight > 200) + ' clientHeight=' + scroller.clientHeight);",
    "// `display()` empties the container and refills it synchronously. A browser",
    "// only clamps the scroll when it LAYS OUT the empty container, which any read",
    "// of a scroll property forces -- and Obsidian reads them. The wrapper makes",
    "// that layout happen, so the jump is reproduced rather than assumed: it is",
    "// what the fix has to survive.",
    "const empty = tab.containerEl.empty.bind(tab.containerEl);",
    "tab.containerEl.empty = () => {",
    "  empty();",
    "  void scroller.scrollHeight;",
    "  window.__clamped = scroller.scrollTop;",
    "  window.__empties = (window.__empties || 0) + 1;",
    "};",
    "const link = () => item('Link wire and component thickness').components.find((c) => c.inputEl.getAttribute('data-control') === 'toggle');",
    "window.test('emptying the container really does drop the offset', () => {",
    "  scroller.scrollTop = 160;",
    "  tab.containerEl.empty();",
    "  const clamped = window.__clamped;",
    "  // Put the rows back, since this case emptied them on purpose.",
    "  tab.display();",
    "  scroller.scrollTop = 160;",
    "  return 'clamped=' + clamped;",
    "});",
    "window.test('scrolling to the link switch and toggling it keeps the place', () => {",
    "  scroller.scrollTop = 160;",
    "  window.__empties = 0;",
    "  const t = link();",
    "  t.setValue(true);",
    "  t.inputEl.dispatchEvent(new Event('change'));",
    "  return 'after=' + scroller.scrollTop + ' rebuilds=' + window.__empties +",
    "    ' shared=' + !item('Line thickness').classList.contains('modelica-studio-hidden') +",
    "    ' wireHidden=' + item('Wire thickness').classList.contains('modelica-studio-hidden');",
    "});",
    "window.test('and toggling it back does too', () => {",
    "  scroller.scrollTop = 160;",
    "  const t = link();",
    "  t.setValue(false);",
    "  t.inputEl.dispatchEvent(new Event('change'));",
    "  return 'after=' + scroller.scrollTop + ' twoSliders=' + (!!item('Wire thickness') && !!item('Component line thickness'));",
    "});",
    "window.finish();"
  );
  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  const d = passed(out);

  assert.equal(
    d["the pane scrolls at all, so the test means something"],
    "scrollHeight=true clientHeight=200",
    "the container really scrolls, or the assertion below would pass for free"
  );
  assert.equal(
    d["emptying the container really does drop the offset"],
    "clamped=0",
    "the harness reproduces the jump, so the assertions below mean something"
  );
  assert.equal(
    d["scrolling to the link switch and toggling it keeps the place"],
    "after=160 rebuilds=0 shared=true wireHidden=true",
    "the offset does not move because nothing is emptied: the rows change visibility in place"
  );
  assert.equal(
    d["and toggling it back does too"],
    "after=160 twoSliders=true",
    "and the same the other way, when the tab grows a row"
  );
});

test("the About panel states the author, the licence and how to cite", async () => {
  // The About panel is where someone looks to find out what they are allowed to do
  // with this, and who to credit. Both are read from the metadata rather than typed
  // into the panel, and a test in checks.test.mjs holds package.json and the licence
  // file to the same strings — so the panel cannot describe terms the release does
  // not carry.
  const out = page(
    "const plugin = makePlugin(new StubVault(), {});",
    "plugin.manifest = { id: 'modelica-studio', version: '0.3.0', author: 'Ahmed N. Alfahdi' };",
    "const modal = new HelpModal(plugin.app, plugin);",
    "modal.open();",
    "const panel = Array.from(modal.contentEl.querySelectorAll('.modelica-studio-help-panel')).find((p) => p.textContent.includes('About'));",
    "window.test('the panel names the version and the author', () => {",
    "  if (!panel) return 'NO ABOUT PANEL';",
    "  const text = panel.textContent.replace(/\\s+/g, ' ');",
    "  return 'version=' + text.includes('0.3.0') + ' author=' + text.includes('Ahmed N. Alfahdi') +",
    "    ' preBeta=' + /pre-1\\.0/.test(text) + ' saysBeta=' + /\\bbeta\\b/i.test(text);",
    "});",
    "window.test('it states the licence, and the links carry their own text', () => {",
    "  const text = panel.textContent.replace(/\\s+/g, ' ');",
    "  const links = Array.from(panel.querySelectorAll('.modelica-studio-link'));",
    "  return 'licence=' + text.includes('GPL-3.0-or-later') +",
    "    ' links=' + links.map((l) => l.textContent.trim()).join('|') +",
    "    ' marks=' + links.filter((l) => l.querySelector('.svg-icon')).length;",
    "});",
    "window.test('and it asks for citation rather than requiring it', () => {",
    "  const text = panel.textContent.replace(/\\s+/g, ' ');",
    "  return 'cites=' + /Citing is a favour/.test(text) + ' demands=' + /(must|required to|shall) cite/i.test(text) +",
    "    ' whatForks=' + /stay free and keep the notices/.test(text);",
    "});",
    "window.finish();"
  );
  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  const d = passed(out);

  assert.equal(
    d["the panel names the version and the author"],
    "version=true author=true preBeta=true saysBeta=false",
    "the version and author come from the manifest, and the wording is pre-1.0 rather than beta — 0.3.0 is the first release not tagged beta"
  );
  assert.equal(
    d["it states the licence, and the links carry their own text"],
    "licence=true links=GPL-3.0-or-later|AhmedAlfahdi/modelica-studio|CITATION.cff marks=3",
    "each linked value is the value itself, with the external mark beside it (setIcon replaces an element's first child, so the mark needs its own span or the label disappears)"
  );
  // Their APPEARANCE is asserted in component-render.test.mjs, where the plugin's
  // stylesheet and the theme's variables are loaded. This page has neither, so a
  // computed style here measured the browser's default button and called it a pass.
  assert.equal(
    d["and it asks for citation rather than requiring it"],
    "cites=true demands=false whatForks=true",
    "citation is a favour, and the panel says what a fork must do"
  );
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

  // A ceiling, not a target. Measured at 3.0 s alone and 5.2 s with the suite
  // running, because `repaint` re-tokenises the whole document -- so this guards
  // against a pathological regression, and the honest statement is that 3000 lines
  // is slower than it should be. Incremental highlighting would fix it; the number
  // is recorded here so that work has a baseline to beat.
  const ms = Number(d["opening a large model is not instant but is bounded"].split(" ")[0]);
  assert.ok(ms < 15000, `3000 lines must not become pathological, took ${ms}ms`);
  if (ms > 3000) {
    console.log(`# note: 3000 lines took ${ms}ms to open (re-tokenises on repaint)`);
  }

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

test("the results strip has exactly the two tabs, and never strands itself", () => {
  // It had three. The third, `source`, was not a view of the results at all -- it
  // was a shortcut into code mode, and since the toolbar already has a Code tab it
  // read as a duplicate way to do the same thing. Reported as "remove the Source
  // tab, it only adds confusion, I think I have seen two of them".
  //
  // Its removal also removed the strip's dependence on the editor mode: the mode
  // was consulted only to hide that tab in code mode. So the check is now the whole
  // of the rule -- every tab is always visible, and a click always lands on one.
  const out = page(
    `import { RESULTS_TABS, resultsTabState, tabLabel } from "${ROOT}/src/view/bottom-tabs";`,
    "window.test('the tabs are the plot and the log', () => RESULTS_TABS.join(','));",
    "window.test('Source is not among them', () => String(RESULTS_TABS.includes('source')));",
    "window.test('every tab is labelled', () => RESULTS_TABS.map(tabLabel).join(' | '));",
    "window.test('clicking a tab selects it', () => RESULTS_TABS.map((t) => resultsTabState('plot', t)).join(','));",
    "window.test('an unknown id leaves the strip alone', () => resultsTabState('log', 'source'));",
    "window.test('clicking twice is idempotent', () => resultsTabState(resultsTabState('plot', 'log'), 'log'));",
    "window.finish();"
  );
  if (out.skip) return;
  const d = passed(out);
  assert.equal(d["the tabs are the plot and the log"], "plot,log");
  assert.equal(d["Source is not among them"], "false", "the Source tab is gone");
  assert.equal(d["every tab is labelled"], "Plot | Run log");
  assert.equal(d["clicking a tab selects it"], "plot,log");
  // Guarding an unknown id is what stops a stale value selecting a tab that is not
  // drawn -- the fault the state machine was originally written for.
  assert.equal(d["an unknown id leaves the strip alone"], "log");
  assert.equal(d["clicking twice is idempotent"], "log");
});

test("the view uses the tab helper, and no tab switches the mode", () => {
  // Two things to hold: the view goes through the one function, and clicking a tab
  // no longer changes the editor mode. That coupling is what made the strip's state
  // depend on a second piece of state, and it is what the Source tab existed for.
  const view = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  assert.match(view, /resultsTabState\(this\.bottomTab, id\)/, "the click goes through it");
  assert.match(view, /resultsTabState\(this\.bottomTab, this\.bottomTab\)/, "and applyBottomTab heals");
  assert.match(view, /for \(const id of RESULTS_TABS\)/, "the strip is built from the one list");
  assert.match(view, /tabLabel\(id\)/, "and the labels come from it too");
  // No mode handling left in the tab path.
  const click = /this\.bottomTab = resultsTabState[\s\S]{0,120}/.exec(view);
  assert.ok(click, "the click handler is present");
  assert.ok(!/setMode/.test(click[0]), "clicking a tab must not switch the mode");
  // The field is typed to the two-tab union, so a third cannot be assigned.
  assert.match(view, /private bottomTab: ResultsTab = "plot"/, "the active tab is typed to the union");
});

test("the inspector lists fields for a component the plugin's model no longer holds", async () => {
  // The symptom was total and silent: click any component and the panel said
  // "1 components selected." with nothing under it. Not because the component
  // had no parameters, but because the inspector looked the selected id up in
  // the model the PLUGIN held while the canvas drew a different object -- after
  // the code validator adopted a re-parsed model, or after an undo restored one.
  //
  // The two are kept identical now, and the inspector reads the model being
  // drawn, so this pins the behaviour that matters: the panel describes what is
  // on the canvas.
  const out = page(
    `import { ModelicaStudioView } from "${ROOT}/src/view/studio-view";`,
    "const vault = new StubVault();",
    "const plugin = makePlugin(vault);",
    // The plugin is holding a model that does NOT contain the selection.
    "plugin.model = { name: 'Other', components: [], connections: [], graphics: [] };",
    "plugin.library.component = () => ({",
    "  name: 'Modelica.Blocks.Logical.And',",
    "  shortName: 'And',",
    "  comment: 'Logical and',",
    "  ports: [],",
    "  parameters: [",
    "    { name: 'u1', type: 'Boolean', defaultValue: 'false', comment: 'Initial value of input 1' },",
    "    { name: 'u2', type: 'Boolean', defaultValue: 'false', comment: 'Initial value of input 2' },",
    "  ],",
    "});",
    // ... while the editor, which is what the user is looking at, does.
    "const drawn = { name: 'M', components: [",
    "  { id: 'and1', className: 'Modelica.Blocks.Logical.And',",
    "    placement: { extent: [-10,-10,10,10], rotation: 0, visible: true }, params: {} },",
    "], connections: [], graphics: [] };",
    "const view = Object.create(ModelicaStudioView.prototype);",
    "view.plugin = plugin;",
    "view.editor = { selectedIds: ['and1'], currentModel: drawn };",
    "const host = document.createElement('div');",
    "view.inspectorEl = host;",
    "view.inspectorTabsEl = document.createElement('div');",
    "view.inspectorTab = 'component';",
    "view.renderPlotPane = () => {};",
    // The real entry point, so the lookup that was wrong is the one under test.
    "view.renderInspector();",
    "window.test('the panel names the component', () => host.textContent.includes('and1') ? 'named' : 'MISSING');",
    "window.test('and lists its fields', () => {",
    "  const labels = Array.from(host.querySelectorAll('label')).map((l) => l.textContent);",
    "  return labels.join(' | ') || 'NO FIELDS';",
    "});",
    "window.finish();"
  );

  if (out.skip) return;
  const d = passed(out);
  assert.equal(d["the panel names the component"], "named", "the selected component is identified");
  assert.match(d["and lists its fields"], /u1/, "the first parameter is offered");
  assert.match(d["and lists its fields"], /u2/, "and the second");
});

test("the plugin takes the model object the editor hands it", async () => {
  // An undo restores a PARSED COPY, so the editor is then drawing an object the
  // plugin has never seen. `onChange` carries it, and the view has to take it --
  // the handler used to ignore the argument, which is how the canvas and the
  // inspector came to describe different models. Everything the user did
  // afterwards was written into the copy the plugin had forgotten.
  const out = page(
    `import { ModelicaStudioView } from "${ROOT}/src/view/studio-view";`,
    "const vault = new StubVault();",
    "const plugin = makePlugin(vault);",
    "const start = { name: 'M', components: [], connections: [], graphics: [] };",
    "plugin.model = start;",
    "plugin.markSourceStale = () => { plugin.stale = true; };",
    "plugin.persist = async () => {};",
    // A RECORDER rather than a reimplementation: what was broken is that the
    // view threw the model away instead of passing it on, and that is what this
    // asserts. `adoptEditorModel` itself is three lines and type-checked.
    "const adopted = [];",
    "plugin.adoptEditorModel = (m) => { adopted.push(m); };",
    "const view = Object.create(ModelicaStudioView.prototype);",
    "view.plugin = plugin;",
    "view.renderInspector = () => {};",
    "view.updateToolbarState = () => {};",
    // What an undo delivers: a different object with the same document.
    "const restored = { name: 'M', components: [], connections: [], graphics: [] };",
    "view.onModelChanged(restored);",
    "window.test('the plugin is handed the new object', () =>",
    "  adopted.length === 1 && adopted[0] === restored ? 'handed over' : `WRONG: ${adopted.length}`);",
    "window.test('and the source is marked stale', () => String(plugin.stale === true));",
    "window.finish();"
  );

  if (out.skip) return;
  const d = passed(out);
  assert.equal(
    d["the plugin is handed the new object"],
    "handed over",
    "the view passes the editor's model on, rather than dropping the argument"
  );
  assert.equal(d["and the source is marked stale"], "true", "so a save regenerates the text");
});

test("the connector list says which connectors do not exist yet", async () => {
  // `Support support(...) if useSupport` is listed like any other connector, so
  // the panel offered a port that is not there. It now says what to switch on,
  // and says something different when a wire is already attached -- that case is
  // a fault in the model rather than a connector waiting to be enabled.
  const out = page(
    `import { ModelicaStudioView } from "${ROOT}/src/view/studio-view";`,
    "const vault = new StubVault();",
    "const plugin = makePlugin(vault);",
    "const def = {",
    "  name: 'Modelica.Mechanics.Translational.Sources.Force',",
    "  shortName: 'Force',",
    "  comment: 'External force',",
    "  parameters: [],",
    "  ports: [",
    "    { name: 'flange', type: 'Flange_b', isFlow: true, causality: 'acausal' },",
    "    { name: 'support', type: 'Support', isFlow: true, causality: 'acausal', condition: 'useSupport' },",
    "    { name: 'f', type: 'RealInput', isFlow: false, causality: 'input' },",
    "  ],",
    "};",
    "plugin.library.component = () => def;",
    "const inst = (params) => ({ id: 'force', className: def.name,",
    "  placement: { extent: [-10,-10,10,10], rotation: 0, visible: true }, params });",
    "const rows = (params, connections) => {",
    "  const drawn = { name: 'M', components: [inst(params)], connections, graphics: [] };",
    "  plugin.model = drawn;",
    "  const view = Object.create(ModelicaStudioView.prototype);",
    "  view.plugin = plugin;",
    "  view.editor = { selectedIds: ['force'], currentModel: drawn };",
    "  const host = document.createElement('div');",
    "  view.renderComponentTab(host, drawn.components[0], ['force']);",
    "  return Array.from(host.querySelectorAll('.modelica-studio-portrow')).map((r) =>",
    "    r.className.replace('modelica-studio-portrow', '').trim() + ' :: ' + r.textContent);",
    "};",
    "window.test('support is off by default', () => rows({}, []).join(' || '));",
    "window.test('and on when the parameter is true', () => rows({ useSupport: 'true' }, []).join(' || '));",
    "window.test('a wire on a switched-off connector is called out', () =>",
    "  rows({}, [{ id: 'c1', from: { component: 'force', port: 'support' },",
    "              to: { component: 'gnd', port: 'flange' }, points: [] }]).join(' || '));",
    "window.finish();"
  );

  if (out.skip) return;
  const d = passed(out);

  // Asserted per ROW: the joined string would let `flange ... needs` match across
  // two different connectors.
  const rowFor = (joined, name) =>
    joined.split(" || ").find((r) => r.includes(`:: ${name}`)) ?? "";

  const off = d["support is off by default"];
  assert.match(rowFor(off, "support"), /needs useSupport = true/, `the reason is given: ${off}`);
  assert.match(rowFor(off, "support"), /is-conditional-off/, "and the row is marked unavailable");
  assert.match(rowFor(off, "flange"), /Flange_b · flow/, "an unconditional connector reads normally");
  assert.ok(!/needs/.test(rowFor(off, "flange")), `flange carries no condition: ${off}`);
  assert.ok(!/is-conditional/.test(rowFor(off, "f")), `nor does the signal input: ${off}`);

  const on = d["and on when the parameter is true"];
  assert.ok(!/is-conditional-off/.test(on), `nothing is marked off: ${on}`);
  assert.ok(!/needs useSupport/.test(on), `and nothing asks for a parameter: ${on}`);

  const broken = d["a wire on a switched-off connector is called out"];
  assert.match(rowFor(broken, "support"), /is-conditional-broken/, "a wired-but-absent connector is marked as a fault");
  assert.match(
    rowFor(broken, "support"),
    /wired, but it needs useSupport = true/,
    `and says so plainly: ${broken}`
  );
});

test("a Boolean parameter is a choice, and anything else is still typed", async () => {
  // A text field for a Boolean let a user write `useSupport = yes`, which
  // OpenModelica reports as "Variable yes not found in scope Force" -- naming
  // neither the parameter nor the type, and only after a Simulate. A select
  // cannot express the mistake.
  const out = page(
    `import { ModelicaStudioView } from "${ROOT}/src/view/studio-view";`,
    "const vault = new StubVault();",
    "const plugin = makePlugin(vault);",
    "const calls = [];",
    "const def = {",
    "  name: 'M.R', shortName: 'R', comment: '', ports: [],",
    "  parameters: [",
    "    { name: 'useSupport', type: 'Boolean', defaultValue: 'false', comment: 'support' },",
    "    { name: 'R', type: 'Real', defaultValue: '100', unit: 'Ohm' },",
    "  ],",
    "};",
    "plugin.library.component = () => def;",
    "const render = (params) => {",
    "  const inst = { id: 'r1', className: def.name,",
    "    placement: { extent: [-10,-10,10,10], rotation: 0, visible: true }, params };",
    "  const drawn = { name: 'M', components: [inst], connections: [], graphics: [] };",
    "  plugin.model = drawn;",
    "  const view = Object.create(ModelicaStudioView.prototype);",
    "  view.plugin = plugin;",
    "  view.runSimulation = () => {};",
    "  view.editor = {",
    "    selectedIds: ['r1'], currentModel: drawn,",
    "    setParam: (id, name, value) => calls.push(`${id}.${name}=${value}`),",
    "  };",
    "  const host = document.createElement('div');",
    "  view.renderComponentTab(host, inst, ['r1']);",
    "  return host;",
    "};",
    "const controlFor = (host, labelText) => {",
    "  const field = Array.from(host.querySelectorAll('.modelica-studio-field'))",
    "    .find((f) => f.querySelector('label').textContent.startsWith(labelText));",
    "  return field ? field.querySelector('select, input') : null;",
    "};",
    "const host = render({});",
    "window.test('the Boolean is a select', () => controlFor(host, 'useSupport')?.tagName ?? 'MISSING');",
    "window.test('its options are the two literals plus the default', () =>",
    "  Array.from(controlFor(host, 'useSupport').options).map((o) => o.value + ':' + o.textContent).join(' | '));",
    "window.test('and it shows that nothing is overridden yet', () =>",
    "  JSON.stringify(controlFor(host, 'useSupport').value));",
    "window.test('choosing a value is committed', () => {",
    "  const s = controlFor(host, 'useSupport');",
    "  s.value = 'true';",
    "  s.dispatchEvent(new Event('change'));",
    "  return calls.join(',') || 'NOTHING';",
    "});",
    "window.test('a number is still a text field', () => controlFor(host, 'R')?.tagName ?? 'MISSING');",
    "window.test('and keeps its unit in the label', () => {",
    "  const field = Array.from(host.querySelectorAll('.modelica-studio-field'))",
    "    .find((f) => f.querySelector('label').textContent.startsWith('R'));",
    "  return field.querySelector('label').textContent;",
    "});",
    // A model may legitimately bind a Boolean to an expression. A select would
    // show that as "default" and drop it on the next change, so it stays typed.
    "const expr = render({ useSupport: 'system.allowFlowReversal' });",
    "window.test('an expression binding is not put in a select', () =>",
    "  controlFor(expr, 'useSupport')?.tagName ?? 'MISSING');",
    "window.test('and its text is preserved', () => controlFor(expr, 'useSupport').value);",
    "window.finish();"
  );

  if (out.skip) return;
  const d = passed(out);

  assert.equal(d["the Boolean is a select"], "SELECT", "a Boolean parameter gets a select");
  assert.equal(
    d["its options are the two literals plus the default"],
    ":default (false) | true:true | false:false",
    "the two literals, plus the un-overridden state first"
  );
  assert.equal(d["and it shows that nothing is overridden yet"], '""', "default selected when unset");
  assert.equal(d["choosing a value is committed"], "r1.useSupport=true", "the choice reaches the editor");
  assert.equal(d["a number is still a text field"], "INPUT", "a Real stays a text field");
  assert.match(d["and keeps its unit in the label"], /R \(Ohm\)/, "units still shown");
  assert.equal(
    d["an expression binding is not put in a select"],
    "INPUT",
    "a non-literal Boolean binding keeps the field it was written in"
  );
  assert.equal(
    d["and its text is preserved"],
    "system.allowFlowReversal",
    "so the expression is neither hidden nor dropped"
  );
});

test("a block's diagram and its plot both answer the pointer", async () => {
  // Two readouts the Studio had and a note did not. The diagram one existed as a
  // setting the whole time and was read by nothing but the Studio, so a block
  // drew the editor's own default -- no readout at all -- however the setting was
  // set. The plot had no cursor wiring of any kind.
  const out = page(
    `import { EmbeddedDiagram } from "${ROOT}/src/view/embed";`,
    `import { layoutForResult, timeAtPlotX } from "${ROOT}/src/view/plot";`,
    `import { instanceOutlineBounds } from "${ROOT}/src/render/canvas";`,
    "",
    "// Record what each canvas paints, keyed by the canvas's own class, so a",
    "// readout can be read back as the text it is rather than inferred.",
    "const painted = [];",
    "const realGetContext = HTMLCanvasElement.prototype.getContext;",
    "HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {",
    "  const ctx = realGetContext.call(this, kind, ...rest);",
    "  if (!ctx || kind !== '2d' || ctx.__watched) return ctx;",
    "  ctx.__watched = true;",
    "  const real = ctx.fillText.bind(ctx);",
    "  ctx.fillText = (text, x, y) => {",
    "    painted.push({ cls: this.className, text: String(text) });",
    "    return real(text, x, y);",
    "  };",
    "  return ctx;",
    "};",
    "",
    "const DEF = (name) => ({",
    "  name, shortName: name.split('.').pop(),",
    "  icon: [{ kind: 'Rectangle', extent: [-40, -40, 40, 40], lineColor: [0, 0, 0],",
    "    fillColor: [255, 255, 255], linePattern: 'Solid', fillPattern: 'Solid', visible: true },",
    "    // The bare `%C` form MSL uses, e.g. a HeatCapacitor's `textString=\"%C\"`.",
    "    { kind: 'Text', extent: [-30, -12, 30, 12], textString: '%C', textColor: [0, 0, 0] }],",
    "  diagram: [],",
    "  ports: [{ name: 'p', type: 'Pin', isFlow: true, causality: 'acausal' }],",
    "  portPositions: { p: [0, 0] },",
    "  parameters: [{ name: 'R', type: 'Real', defaultValue: '100' },",
    "    { name: 'C', type: 'Real', defaultValue: '2500' }],",
    "  hasIcon: true,",
    "});",
    "const lookup = (n) => DEF(n);",
    "const SOURCE = [",
    "  'model Probe',",
    "  '  Modelica.Electrical.Analog.Basic.Resistor r1(R = 250) annotation(Placement(',",
    "    'transformation(extent = {{-80, -20}, {-40, 20}})));',",
    "  '  Modelica.Electrical.Analog.Basic.Resistor r2 annotation(Placement(',",
    "    'transformation(extent = {{40, -20}, {80, 20}})));',",
    "  'equation',",
    "  '  connect(r1.p, r2.p);',",
    "  'end Probe;',",
    "].join('\\n');",
    "",
    "const time = Array.from({ length: 101 }, (_, i) => i / 10);",
    "const result = { time, series: [{ name: 'r1.v', values: time.map((t) => t), unit: 'V' }],",
    "  compileMs: 1, simulateMs: 1, reusedBinary: true, warnings: [] };",
    "",
    "function mount(showPlot, over) {",
    "  const el = document.body.createDiv();",
    "  el.style.width = '900px';",
    "  const host = {",
    "    app: {},",
    "    library: { component: (n) => lookup(n) },",
    "    backend: { simulate: async () => result },",
    "    settings: Object.assign({ labelScale: 1, hoverParameters: true, startTime: 0,",
    "      stopTime: 10, numberOfIntervals: 100, tolerance: 1e-6, solver: '' }, over || {}),",
    "    stopTimeFor: () => 10,",
    "    showSetupHelp: () => {},",
    "  };",
    "  const embed = new EmbeddedDiagram(host, el, SOURCE,",
    "    { showPlot, height: 320, autoSimulate: false, stopTime: 0 }, () => {});",
    "  embed.mount();",
    "  return embed;",
    "}",
    "",
    "/** Point the mouse at a canvas-local position and let the block repaint. */",
    "function hoverAt(canvas, x, y) {",
    "  let at = null;",
    "  for (const el of document.querySelectorAll('canvas')) {",
    "    if (el === canvas) at = el;",
    "  }",
    "  const rect = canvas.getBoundingClientRect();",
    "  canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1,",
    "    isPrimary: true, clientX: rect.left + x, clientY: rect.top + y }));",
    "  return rect;",
    "}",
    "",
    "/** The centre of a component in CANVAS pixels, from the live viewport. */",
    "function centreOf(editor, id) {",
    "  const inst = editor.getModel().components.find((c) => c.id === id);",
    "  const b = instanceOutlineBounds(inst, lookup(inst.className));",
    "  const vp = editor.viewport;",
    "  return [((b[0] + b[2]) / 2) * vp.scale + vp.x, -((b[1] + b[3]) / 2) * vp.scale + vp.y];",
    "}",
    "",
    "const on = mount(false, { hoverParameters: true });",
    "const off = mount(false, { hoverParameters: false });",
    "const plot = mount(true, {});",
    "await plot.simulate();",
    "",
    "window.test('the block drew its diagram', () => {",
    "  const canvas = on.editor.canvasEl;",
    "  canvas.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, pointerId: 1 }));",
    "  hoverAt(canvas, ...centreOf(on.editor, 'r1'));",
    "  on.editor.draw();",
    "  return painted.filter((p) => p.cls.includes('modelica-studio-canvas'))",
    "    .map((p) => p.text).filter((t) => t.indexOf('R = ') === 0).join(',');",
    "});",
    "",
    "window.test('with the setting off, the same hover paints no readout', () => {",
    "  painted.length = 0;",
    "  const canvas = off.editor.canvasEl;",
    "  canvas.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, pointerId: 1 }));",
    "  hoverAt(canvas, ...centreOf(off.editor, 'r1'));",
    "  off.editor.draw();",
    "  return String(painted.some((p) => p.text.indexOf('R = ') === 0));",
    "});",
    "",
    "window.test('an icon macro is substituted, not painted', () => {",
    "  painted.length = 0;",
    "  on.editor.draw();",
    "  const texts = painted.filter((p) => p.cls.includes('modelica-studio-canvas')).map((p) => p.text);",
    "  return texts.join(',') + ' || hasValue=' + texts.includes('2500') + ' hasMacro=' + texts.includes('%C');",
    "});",
    "",
    "window.test('the value shown is the one the instance overrides', () => {",
    "  painted.length = 0;",
    "  const canvas = on.editor.canvasEl;",
    "  hoverAt(canvas, ...centreOf(on.editor, 'r2'));",
    "  on.editor.draw();",
    "  return painted.filter((p) => p.text.indexOf('R = ') === 0).map((p) => p.text).join(',');",
    "});",
    "",
    "window.test('hovering the plot reads the values off the crosshair', () => {",
    "  painted.length = 0;",
    "  const canvas = plot.plotCanvas;",
    "  const rect = canvas.getBoundingClientRect();",
    "  const lay = layoutForResult(rect.width, rect.height, result, plot.styles);",
    "  // A quarter of the way across the AXES, which is a quarter of the time range:",
    "  // the margins belong to the axes, not to the data.",
    "  hoverAt(canvas, lay.left + lay.width * 0.25, lay.top + 10);",
    "  return painted.filter((p) => p.cls.includes('embed-plot-canvas'))",
    "    .map((p) => p.text).join(' | ');",
    "});",
    "",
    "window.test('and what it reads is the time at that pixel', () => {",
    "  const canvas = plot.plotCanvas;",
    "  const rect = canvas.getBoundingClientRect();",
    "  const lay = layoutForResult(rect.width, rect.height, result, plot.styles);",
    "  const x = lay.left + lay.width * 0.25;",
    "  return String(timeAtPlotX(x, rect.width, rect.height, result, plot.styles,",
    "    { xMin: 0, xMax: 10 }));",
    "});",
    "",
    "window.test('a pointer in the margin reports nothing', () => {",
    "  painted.length = 0;",
    "  const canvas = plot.plotCanvas;",
    "  hoverAt(canvas, 2, 10);",
    "  return String(painted.some((p) => p.text.indexOf('t = ') === 0));",
    "});",
    "",
    "window.test('leaving the plot takes the readout with it', () => {",
    "  const canvas = plot.plotCanvas;",
    "  const rect = canvas.getBoundingClientRect();",
    "  const lay = layoutForResult(rect.width, rect.height, result, plot.styles);",
    "  hoverAt(canvas, lay.left + lay.width * 0.25, lay.top + 10);",
    "  painted.length = 0;",
    "  canvas.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, pointerId: 1 }));",
    "  return String(painted.some((p) => p.text.indexOf('t = ') === 0));",
    "});",
    "",
    "window.finish();"
  );
  if (out.skip) return;
  const d = passed(out);

  assert.equal(
    d["the block drew its diagram"],
    "R = 250",
    "a block's hover readout shows the instance's own value"
  );
  assert.equal(
    d["with the setting off, the same hover paints no readout"],
    "false",
    "and the setting turns it off in a note, not only in the Studio"
  );
  assert.equal(
    d["the value shown is the one the instance overrides"],
    "R = 100",
    "another component reports its own value"
  );
  // A macro with no resolver is painted exactly as written -- which is a `%C`
  // where the heat capacity should be, in every HeatCapacitor in the library.
  assert.match(
    d["an icon macro is substituted, not painted"],
    /hasValue=true hasMacro=false/,
    `the icon's %C resolves to the parameter: ${d["an icon macro is substituted, not painted"]}`
  );
  assert.equal(
    d["and what it reads is the time at that pixel"],
    "2.5",
    "a quarter across the axes is a quarter of the range"
  );
  const readout = d["hovering the plot reads the values off the crosshair"];
  assert.match(readout, /t = 2\.5/, `the crosshair reports its time: ${readout}`);
  assert.match(readout, /r1\.v = 2\.5/, "and the trace value at that time");
  assert.equal(
    d["a pointer in the margin reports nothing"],
    "false",
    "the axis margin is not the data"
  );
  assert.equal(
    d["leaving the plot takes the readout with it"],
    "false",
    "the readout does not linger"
  );
});

test("a block runs itself once, and its height and span are its own", async () => {
  // Three things a reader of a note can see, all of them wrong before.
  //
  // The block ran again every time the note re-rendered, and an edit made in its
  // own diagram writes the note back -- so one drag mounted it four times and ran
  // four simulations, which reads as the block flashing while you move something.
  //
  // `height=` was honoured by the diagram pane and ignored by the plot, which is
  // the pane on show by default -- so the directive appeared to do nothing.
  //
  // And the span was reachable only by editing the directive text.
  //
  // The page yields MICROTASKS only: Electron reports the page loaded once its
  // module has finished evaluating, and a timer here would mean the results were
  // read before the tests had run.
  const SETTLE = "for (let i = 0; i < 50; i++) { await Promise.resolve(); }";
  const out = page(
    `import { EmbeddedDiagram } from "${ROOT}/src/view/embed";`,
    "let runs = 0;",
    "let lastRequest = null;",
    "const time = Array.from({ length: 101 }, (_, i) => i / 10);",
    "const result = { time, series: [{ name: 'r1.v', values: time.map((t) => t), unit: 'V' }],",
    "  compileMs: 1, simulateMs: 1, reusedBinary: true, warnings: [] };",
    "const DEF = (name) => ({",
    "  name, shortName: name.split('.').pop(),",
    "  icon: [{ kind: 'Rectangle', extent: [-40, -40, 40, 40], lineColor: [0, 0, 0],",
    "    fillColor: [255, 255, 255], linePattern: 'Solid', fillPattern: 'Solid', visible: true }],",
    "  diagram: [], ports: [{ name: 'p', type: 'Pin', isFlow: true, causality: 'acausal' }],",
    "  portPositions: { p: [0, 0] }, parameters: [], hasIcon: true,",
    "});",
    "const SOURCE = ['model Two',",
    "  '  //@ time=3 height=420',",
    "  '  Modelica.Electrical.Analog.Basic.Resistor r1;',",
    "  '  Modelica.Electrical.Analog.Basic.Resistor r2;',",
    "  'equation', '  connect(r1.p, r2.p);', 'end Two;'].join('\\n');",
    "const EDITED = SOURCE.replace('r1;', 'r1(R = 5);');",
    "function mount(source) {",
    "  const el = document.body.createDiv();",
    "  el.style.width = '800px';",
    "  const host = {",
    "    app: {},",
    "    library: { component: (n) => DEF(n) },",
    "    backend: { simulate: async (req) => { runs++; lastRequest = req; return result; } },",
    "    settings: { labelScale: 1, hoverParameters: true, startTime: 0, stopTime: 1,",
    "      numberOfIntervals: 100, tolerance: 1e-6, solver: '' },",
    "    stopTimeFor: () => 1,",
    "    showSetupHelp: () => {},",
    "  };",
    "  const embed = new EmbeddedDiagram(host, el, source || SOURCE,",
    "    { showPlot: true, height: 320, autoSimulate: true, stopTime: 0 }, () => {});",
    "  embed.mount();",
    "  const at = (sel) => { const n = el.querySelector(sel); return n ? n.textContent : 'MISSING'; };",
    "  const input = () => el.querySelector('.modelica-studio-embed-time input');",
    "  const simulateButton = () => el.querySelector('.modelica-studio-embed-toolbar button.mod-cta');",
    "  return { embed, el, at, input, simulateButton, status: () => at('.modelica-studio-embed-status') };",
    "}",
    "",
    "// 1. Opening the note: one run, over the span the block declares.",
    "const first = mount();",
    "window.test('opening the note runs the block once', () => String(runs));",
    "window.test('over the span the block declares', () => String(lastRequest.stopTime));",
    SETTLE,
    "window.test('and the run lands', () => String(!!first.embed.result));",
    "",
    "// 2. The same block rebuilt by a re-render, as Obsidian does on every edit.",
    "first.embed.destroy();",
    "const second = mount();",
    "window.test('a re-render runs nothing', () => String(runs));",
    "window.test('the pane is not blanked', () => String(!!second.embed.result));",
    "window.test('and the kept run is reported as it was', () => second.status());",
    "",
    "// 3. The button, which is now the only way a run starts.",
    "window.test('the button runs it', () => { second.simulateButton().click(); return String(runs); });",
    SETTLE,
    "window.test('and the run lands again', () => String(!!second.embed.result));",
    "",
    "// 4. The model edited in the note: the kept curve is shown, and said to be old.",
    "second.embed.destroy();",
    "const edited = mount(EDITED);",
    "window.test('an edited model runs nothing by itself', () => String(runs));",
    "window.test('it still shows the run it had', () => String(!!edited.embed.result));",
    "window.test('and says that run is out of date', () => edited.status());",
    "window.test('the stale note is short and marked', () => {",
    "  const n = edited.el.querySelector('.modelica-studio-embed-status');",
    "  return n.textContent + ' || ' + n.className + ' || ' + (n.getAttribute('title') || '').slice(0, 24);",
    "});",
    "window.test('and it does not squeeze the t_end label', () => {",
    "  const r = edited.el.querySelector('.modelica-studio-embed-time span').getBoundingClientRect();",
    "  return Math.round(r.width) + 'x' + Math.round(r.height);",
    "});",
    "window.test('the button runs the edit', () => { edited.simulateButton().click(); return String(runs); });",
    SETTLE,
    "window.test('after which it is current again', () => edited.status());",
    "",
    "// 5. Height, which the plot pane ignored.",
    "window.test('the plot pane is as tall as the directive asked', () => {",
    "  const c = edited.embed.plotCanvas;",
    "  return c.style.height + ' / bitmap ' + c.height;",
    "});",
    "window.test('and so is the diagram pane',",
    "  () => edited.el.querySelector('.modelica-studio-embed-canvas').style.height);",
    "",
    "// 6. The span field.",
    "window.test('the toolbar carries a t_end field showing the block span',",
    "  () => edited.el.querySelector('.modelica-studio-embed-time').textContent.trim().replace(/\\s+/g, ' ') + ' = ' + edited.input().value);",
    "window.test('typing a span runs the block over it', () => {",
    "  runs = 0;",
    "  const i = edited.input();",
    "  i.value = '7.5';",
    "  i.dispatchEvent(new Event('change'));",
    "  return String(runs);",
    "});",
    SETTLE,
    "window.test('and writes it into the block directive',",
    "  () => edited.embed.source.split('\\n').slice(0, 2).map((l) => l.trim()).join(' | '));",
    "window.test('a span that is not a span is refused', () => {",
    "  const i = edited.input();",
    "  i.value = '-2';",
    "  i.dispatchEvent(new Event('change'));",
    "  return i.value + ' after ' + runs + ' runs';",
    "});",
    "window.finish();"
  );
  if (out.skip) return;
  const d = passed(out);

  assert.equal(d["opening the note runs the block once"], "1", "a block previews its result on open");
  assert.equal(d["over the span the block declares"], "3", "time=3 is honoured");
  assert.equal(d["and the run lands"], "true", "the run completes");

  assert.equal(
    d["a re-render runs nothing"],
    "1",
    "an edit that writes the note back must not start a second simulation"
  );
  assert.equal(d["the pane is not blanked"], "true", "the kept result is repainted instead");
  assert.match(
    d["and the kept run is reported as it was"],
    /^101 samples · 1 varying · 1 ms$/,
    `an unchanged model reports its run: ${d["and the kept run is reported as it was"]}`
  );

  assert.equal(d["the button runs it"], "2", "the button is how a run starts after the first");
  assert.equal(d["and the run lands again"], "true", "and it lands");

  assert.equal(d["an edited model runs nothing by itself"], "2", "editing the source runs nothing");
  assert.equal(d["it still shows the run it had"], "true", "the pane keeps its curve");
  assert.match(
    d["and says that run is out of date"],
    /previous run/,
    `a curve that no longer matches the source says so: ${d["and says that run is out of date"]}`
  );
  // Short, because it shares a row with the controls; the explanation is in the
  // tooltip and the colour carries the warning.
  assert.match(
    d["the stale note is short and marked"],
    /^502|^\d+ samples.*previous run \|\| .*is-stale \|\| .+/,
    `the stale status is short, marked and explained: ${d["the stale note is short and marked"]}`
  );
  assert.ok(
    d["the stale note is short and marked"].length < 120,
    `and short enough not to break the toolbar: ${d["the stale note is short and marked"].length} chars`
  );
  // One line tall and wide enough to read: "t_end" wrapped one letter per line
  // was the visible breakage.
  const label = d["and it does not squeeze the t_end label"].split("x").map(Number);
  assert.ok(label[1] < 20, `the t_end label is one line tall: ${label[1]}px`);
  assert.ok(label[0] > 25, `and as wide as its text: ${label[0]}px`);
  assert.equal(d["the button runs the edit"], "3", "the button runs the edited model");
  assert.match(
    d["after which it is current again"],
    /^101 samples · 1 varying · 1 ms$/,
    `and the warning goes: ${d["after which it is current again"]}`
  );

  // The plot is the pane that shows by default, and it ignored `height` entirely.
  assert.match(
    d["the plot pane is as tall as the directive asked"],
    /^420px \/ bitmap \d+$/,
    `height=420 reaches the plot: ${d["the plot pane is as tall as the directive asked"]}`
  );
  assert.doesNotMatch(
    d["the plot pane is as tall as the directive asked"],
    /bitmap 0$/,
    "and the bitmap is allocated for it"
  );
  assert.equal(d["and so is the diagram pane"], "420px", "the same height for both panes");

  assert.equal(
    d["the toolbar carries a t_end field showing the block span"],
    "t_ends = 3",
    "the field shows the span the block actually runs"
  );
  assert.equal(d["typing a span runs the block over it"], "1", "a typed span re-runs the block");
  assert.match(
    d["and writes it into the block directive"],
    /\/\/@ time=7\.5 height=420/,
    `the typed span reaches the note: ${d["and writes it into the block directive"]}`
  );
  assert.equal(
    d["a span that is not a span is refused"],
    "7.5 after 1 runs",
    "a nonsensical span changes nothing and runs nothing"
  );
});

test("the embed picker finds a model, follows its span, and places the block", async () => {
  // The command surface for putting a simulation into a note. Worth driving in a
  // real DOM because everything about it is interaction: what the search leaves
  // in the list, which row the keyboard is on, and what text the chosen row puts
  // at the cursor.
  //
  // Placing a block is asynchronous — a vault file has to be read — so the page
  // yields MICROTASKS between acting and asserting. Timers are not available: the
  // runner reads the results as soon as the page's module has finished
  // evaluating.
  const SETTLE = "for (let i = 0; i < 10; i++) { await Promise.resolve(); }";
  const out = page(
    `import { EmbedPickerModal, buildEmbedCandidates } from "${ROOT}/src/view/embed-insert";`,
    "const cand = (label, group, detail, stopTime, source) => ({",
    "  label, group, detail, stopTime, load: () => source || ('model ' + label + '\\nend ' + label + ';'),",
    "});",
    "const candidates = buildEmbedCandidates({",
    "  current: { name: 'Mine', detail: 'from Modelica Studio', stopTime: 4, load: () => 'model Mine\\nend Mine;' },",
    "  examples: [",
    "    cand('RLC', 'Examples', 'Electrical: series RLC step response', 0.05),",
    "    cand('Tank', 'Examples', 'Fluid: a tank draining', 20),",
    "  ],",
    "  saved: [cand('Drain', 'In this vault', 'Modelica/tank-drain.mo', 20)],",
    "});",
    "",
    "// The editor the block lands in: the three methods insertEmbedBlock uses.",
    "let placed = null;",
    "const editor = {",
    "  getCursor: () => ({ line: 2, ch: 0 }),",
    "  getLine: () => '',",
    "  replaceSelection: (t) => { placed = t; },",
    "};",
    "",
    "function mount(over) {",
    "  placed = null;",
    "  const modal = new EmbedPickerModal(Object.assign({ app: {}, candidates, editor }, over || {}));",
    "  modal.open();",
    "  const el = modal.contentEl;",
    "  const rows = () => Array.from(el.querySelectorAll('.modelica-studio-embed-item'));",
    "  const labels = () => rows().map((r) => r.querySelector('.modelica-studio-embed-item-label').textContent).join(',');",
    "  const groups = () => Array.from(el.querySelectorAll('.modelica-studio-embed-group')).map((g) => g.textContent).join(' | ');",
    "  const search = el.querySelector('.modelica-studio-embed-search');",
    "  const type = (q) => { search.value = q; search.dispatchEvent(new Event('input')); };",
    "  const key = (k) => search.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));",
    "  const stop = () => el.querySelectorAll('.modelica-studio-embed-number')[0].value;",
    "  const hover = (i) => rows()[i].dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));",
    "  const list = () => el.querySelector('.modelica-studio-embed-list');",
    "  return { modal, el, rows, labels, groups, type, key, stop, hover, list, search };",
    "}",
    "",
    "const lists = mount();",
    "window.test('the picker lists the sections and selects the first row',",
    "  () => lists.groups() + ' :: ' + lists.labels() + ' :: selected=' + lists.rows()[0].className.includes('is-selected'));",
    "",
    "const narrowed = mount();",
    "narrowed.type('rlc');",
    "window.test('typing narrows it to what matched', () => narrowed.labels() + ' | groups=' + narrowed.groups());",
    "const byPath = mount();",
    "byPath.type('modelica/');",
    "window.test('a path match is found too', () => byPath.labels());",
    "const nothing = mount();",
    "nothing.type('zzzz');",
    "window.test('a query that matches nothing says so',",
    "  () => nothing.rows().length + ' rows, ' + (nothing.el.querySelector('.modelica-studio-embed-empty') ? 'noted' : 'NOT NOTED'));",
    "",
    "const keyboard = mount();",
    "const firstSpan = keyboard.stop();",
    "keyboard.key('ArrowDown');",
    "const secondSpan = keyboard.stop();",
    "keyboard.key('ArrowUp');",
    "window.test('the span follows the row the keyboard moves to',",
    "  () => firstSpan + ' -> ' + secondSpan + ' -> ' + keyboard.stop());",
    "const searched = mount();",
    "searched.type('rlc');",
    "window.test('the span goes back to the row when it is searched for', () => searched.stop());",
    "",
    "const entered = mount();",
    "entered.type('tank');",
    "entered.key('Enter');",
    SETTLE,
    "window.test('Enter places the selected row at the cursor',",
    "  () => (placed === null ? 'NOTHING PLACED' : placed));",
    "",
    "const clicked = mount();",
    "clicked.rows()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));",
    SETTLE,
    "window.test('clicking a row places it too',",
    "  () => (placed === null ? 'NOTHING PLACED' : placed.split('\\n')[0] + ' / ' + placed.split('\\n')[1]));",
    "",
    "// Hovering. The list is given a height of its own so that scrolling is a real",
    "// possibility: without one the container never scrolls and the assertion below",
    "// would hold for any implementation at all.",
    "const many = buildEmbedCandidates({",
    "  examples: Array.from({ length: 30 }, (_, i) => cand('M' + i, 'Examples', 'machine ' + i, 1)),",
    "  saved: [],",
    "});",
    "const hovered = mount({ candidates: many });",
    "hovered.list().style.maxHeight = '60px';",
    "hovered.list().style.overflowY = 'auto';",
    "const hoverTarget = hovered.rows()[2];",
    "hovered.hover(2);",
    "window.test('hovering a row keeps that row highlighted', () => {",
    "  const now = hovered.rows();",
    "  const still = now[2];",
    "  return 'sameElement=' + (hoverTarget === still) +",
    "    ' selected=' + still.className.includes('is-selected') +",
    "    ' others=' + now.filter((r, i) => i !== 2 && r.className.includes('is-selected')).length;",
    "});",
    "const scrolledBefore = hovered.list().scrollTop;",
    "hovered.hover(29);",
    "window.test('and hovering does not scroll the list out from under the pointer',",
    "  () => scrolledBefore + ' -> ' + hovered.list().scrollTop);",
    "window.test('and the highlight moved to the row under the pointer', () => {",
    "  const now = hovered.rows();",
    "  return 'last=' + now[29].className.includes('is-selected') +",
    "    ' first=' + now[0].className.includes('is-selected');",
    "});",
    "const keyboardScroll = hovered.list().scrollTop;",
    "hovered.key('ArrowUp');",
    "window.test('the keyboard can still walk into view, scrolling the list only',",
    "  () => 'before=' + keyboardScroll + ' after=' + hovered.list().scrollTop + ' selected=' + hovered.rows()[28].className.includes('is-selected'));",
    "",
    "const nowhere = mount({ editor: undefined, noEditorHint: 'open a note first' });",
    "window.test('with nowhere to put it, Insert is offered but refuses', () => {",
    "  const insert = Array.from(nowhere.el.querySelectorAll('button')).find((b) => b.textContent === 'Insert');",
    "  return 'disabled=' + insert.disabled + ' label=' + insert.getAttribute('aria-label');",
    "});",
    "nowhere.key('Enter');",
    SETTLE,
    "window.test('and Enter there places nothing', () => String(placed));",
    "",
    "window.finish();"
  );
  if (out.skip) return;
  const d = passed(out);

  assert.equal(
    d["the picker lists the sections and selects the first row"],
    "The model you have open | Examples | In this vault :: Mine,RLC,Tank,Drain :: selected=true",
    "sections, rows and the first selection"
  );
  assert.equal(
    d["typing narrows it to what matched"],
    "RLC | groups=Examples",
    "the search filters and keeps the section heading"
  );
  assert.equal(d["a path match is found too"], "Drain", "a model is found by where its file lives");
  assert.equal(d["a query that matches nothing says so"], "0 rows, noted", "an empty result says so");
  assert.equal(
    d["the span follows the row the keyboard moves to"],
    "4 -> 0.05 -> 4",
    "the field tracks the selection, and a fiftieth of a second keeps its digits"
  );
  assert.equal(d["the span goes back to the row when it is searched for"], "0.05", "including after a search");

  const block = d["Enter places the selected row at the cursor"];
  assert.equal(
    block,
    "```modelica\n//@ time=20\nmodel Tank\nend Tank;\n```\n",
    `the block that landed: ${block}`
  );
  assert.equal(
    d["clicking a row places it too"],
    "```modelica / //@ time=4",
    "a click places the row it landed on, with that model's span"
  );
  // The reported fault: the highlight did not stay where the pointer was. Every
  // hover rebuilt the list, so the element under the cursor was replaced, and the
  // scroll that followed could reflow the modal and move a different row beneath
  // the pointer -- which then highlighted in turn.
  assert.equal(
    d["hovering a row keeps that row highlighted"],
    "sameElement=true selected=true others=0",
    "the row under the pointer keeps the highlight, and keeps its element"
  );
  assert.equal(
    d["and hovering does not scroll the list out from under the pointer"],
    "0 -> 0",
    "a hover never scrolls the list"
  );
  assert.equal(
    d["and the highlight moved to the row under the pointer"],
    "last=true first=false",
    "and the highlight follows the pointer rather than sticking to the first row"
  );
  assert.match(
    d["the keyboard can still walk into view, scrolling the list only"],
    /^before=0 after=\d+ selected=true$/,
    `the keyboard still reaches rows out of view: ${d["the keyboard can still walk into view, scrolling the list only"]}`
  );

  assert.equal(
    d["with nowhere to put it, Insert is offered but refuses"],
    "disabled=true label=open a note first",
    "the button says why it cannot be used"
  );
  assert.equal(d["and Enter there places nothing"], "null", "and nothing is silently dropped");
});

test("a read-only log can be copied, and says so either way", async () => {
  // The AI prompt log had no way to get its text out except selecting it by hand
  // from a scrolling block, which is the part people get wrong. The same dialog
  // shows a saved revision, so one button serves both.
  const out = page(
    `import { TextModal } from "${ROOT}/src/view/saved-models-modal";`,
    `import { copyText } from "${ROOT}/src/view/clipboard";`,
    `import { Notice } from "${ROOT}/test/helpers/obsidian-stub";`,
    "const copied = [];",
    "let refuse = null;",
    "Object.defineProperty(navigator, 'clipboard', {",
    "  configurable: true,",
    "  value: { writeText: async (t) => { if (refuse) throw new Error(refuse); copied.push(t); } },",
    "});",
    "const notices = () => Notice.messages.slice();",
    "",
    "function open(text) {",
    "  copied.length = 0;",
    "  const modal = new TextModal({}, 'AI prompt log', text);",
    "  modal.open();",
    "  const button = Array.from(modal.contentEl.querySelectorAll('button')).find((b) => b.textContent === 'Copy');",
    "  return { modal, button };",
    "}",
    "",
    "const full = open('13 exchanges recorded.\\ncompile-error: 1');",
    "window.test('the log dialog offers a copy button', () => String(!!full.button));",
    "window.test('and it is not offered as the primary action', () => full.button.className);",
    "",
    "Notice.messages.length = 0;",
    "full.button.click();",
    "for (let i = 0; i < 10; i++) { await Promise.resolve(); }",
    "window.test('clicking it copies the text the dialog is showing', () => JSON.stringify(copied));",
    "window.test('and says so', () => JSON.stringify(notices()));",
    "window.test('and the dialog stays open', () => String(full.modal.opened));",
    "",
    "// A write can be refused for reasons that have nothing to do with the plugin --",
    "// an unfocused window, a platform that wants a gesture. Claiming success there",
    "// is how a paste ends up somewhere else, or nowhere.",
    "const refused = open('some log');",
    "refuse = 'Document is not focused.';",
    "Notice.messages.length = 0;",
    "refused.button.click();",
    "for (let i = 0; i < 10; i++) { await Promise.resolve(); }",
    "window.test('a refused write copies nothing', () => JSON.stringify(copied));",
    "window.test('and the refusal is reported, not claimed as a copy', () => JSON.stringify(notices()));",
    "refuse = null;",
    "",
    "// An empty log should not be presented as something to copy.",
    "let emptyOk = null;",
    "Notice.messages.length = 0;",
    "copyText('', 'the run log').then((v) => { emptyOk = v; });",
    "for (let i = 0; i < 10; i++) { await Promise.resolve(); }",
    "window.test('an empty log is not copied as an empty string', () => String(emptyOk) + ' ' + JSON.stringify(notices()));",
    "window.finish();"
  );
  if (out.skip) return;
  const d = passed(out);

  assert.equal(d["the log dialog offers a copy button"], "true", "there is a Copy button");
  assert.doesNotMatch(
    d["and it is not offered as the primary action"],
    /mod-cta/,
    "copying is not the primary action of reading a log"
  );
  assert.equal(
    d["clicking it copies the text the dialog is showing"],
    JSON.stringify(["13 exchanges recorded.\ncompile-error: 1"]),
    "the exact text on screen reaches the clipboard"
  );
  assert.equal(d["and the dialog stays open"], "true", "copying does not close the log");
  assert.match(d["and says so"], /Run log copied|copied\./, `success is reported: ${d["and says so"]}`);
  assert.equal(d["a refused write copies nothing"], "[]", "a refused write is not reported as a copy");
  assert.match(
    d["and the refusal is reported, not claimed as a copy"],
    /could not be copied — Document is not focused\./,
    `the reason reaches the user: ${d["and the refusal is reported, not claimed as a copy"]}`
  );
  assert.match(
    d["an empty log is not copied as an empty string"],
    /^false \["Modelica: there is nothing in the run log to copy\."\]$/,
    `nothing to copy is said, not done: ${d["an empty log is not copied as an empty string"]}`
  );
});
test("a block tells the writer what the note holds, and advances it after writing", async () => {
  // The write-back compares the lines in the note against what the block believes
  // is there, so an edit made in the note is not overwritten. Three things have to
  // hold for that to be safe AND usable: there is nothing to write until an edit
  // has been made (the block's own body has had the directive parsed off it, so an
  // early flush would write the block without its span), the belief starts as the
  // source the block was RENDERED from, and it advances after the block's own
  // write — otherwise the second edit of a burst is refused as a conflict with the
  // first.
  const out = page(
    `import { EmbeddedDiagram } from "${ROOT}/src/view/embed";`,
    "const DEF = (name) => ({ name, shortName: name, icon: [], diagram: [],",
    "  ports: [{ name: 'p', type: 'Pin', isFlow: true, causality: 'acausal' }],",
    "  portPositions: { p: [0, 0] }, parameters: [], hasIcon: false });",
    "const SOURCE = ['//@ time=7',",
    "  'model W',",
    "  'Modelica.Electrical.Analog.Basic.Resistor r1;',",
    "  'Modelica.Electrical.Analog.Basic.Resistor r2;',",
    "  'equation', '  connect(r1.p, r2.p);', 'end W;'].join('\\n');",
    "const writes = [];",
    "function mount(text) {",
    "  const el = document.body.createDiv();",
    "  const host = {",
    "    app: {},",
    "    library: { component: (n) => DEF(n) },",
    "    backend: null,",
    "    settings: { labelScale: 1, hoverParameters: true, startTime: 0, stopTime: 1,",
    "      numberOfIntervals: 100, tolerance: 1e-6, solver: '' },",
    "    stopTimeFor: () => 1,",
    "    showSetupHelp: () => {},",
    "  };",
    "  const embed = new EmbeddedDiagram(host, el, text,",
    "    { showPlot: false, height: 320, autoSimulate: false, stopTime: 0 },",
    "    (source, expectBody) => writes.push({ source, expectBody }));",
    "  embed.mount();",
    "  return embed;",
    "}",
    "function edit(embed, half) {",
    "  const model = embed.editor.getModel();",
    "  model.components[0].placement.extent = [-half, -half, half, half];",
    "  embed.editor.cb.onChange(model);",
    "}",
    "",
    "const block = mount(SOURCE);",
    "block.flushWrite();",
    "window.test('an untouched block writes nothing', () => String(writes.length));",
    "",
    "edit(block, 10);",
    "block.flushWrite();",
    "window.test('an edit is written, directive and all', () => writes[0].source.split('\\n')[0]);",
    "window.test('and the writer is told what the note held',",
    "  () => (JSON.stringify(writes[0].expectBody) === JSON.stringify(SOURCE) ? 'as rendered' : 'NOT: ' + JSON.stringify(writes[0].expectBody)));",
    "",
    "edit(block, 5);",
    "block.flushWrite();",
    "window.test('after its own write, the belief moves to what it wrote',",
    "  () => (JSON.stringify(writes[1].expectBody) === JSON.stringify(writes[0].source) ? 'advanced' : 'STALE'));",
    "window.test('so a second edit is written rather than refused', () => String(writes.length));",
    "block.flushWrite();",
    "window.test('and an idle flush writes nothing more', () => String(writes.length));",
    "window.finish();"
  );
  if (out.skip) return;
  const d = passed(out);

  assert.equal(d["an untouched block writes nothing"], "0", "a block does not write on mount");
  assert.match(
    d["an edit is written, directive and all"],
    /^\/\/@ time=7 /,
    `the write keeps the block's span: ${d["an edit is written, directive and all"]}`
  );
  assert.equal(d["and the writer is told what the note held"], "as rendered", "the expectation is the note's text");
  assert.equal(d["after its own write, the belief moves to what it wrote"], "advanced");
  assert.equal(
    d["so a second edit is written rather than refused"],
    "2",
    "the second edit is not read as a conflict with the block's own first write"
  );
  assert.equal(d["and an idle flush writes nothing more"], "2", "nothing is written without another edit");
});

test("the help window is tabbed, and every subject is still reachable", async () => {
  // It was one column, which was right for three subjects and wrong for seven:
  // finding out how a sweep works meant scrolling past the domain colours and
  // the shortcuts. The panels are all in the DOM, so a tab only hides.
  const out = page(
    "const plugin = makePlugin(new StubVault(), {});",
    "const modal = new HelpModal(plugin.app, plugin);",
    "modal.open();",
    "const el = modal.contentEl;",
    "const tabs = () => Array.from(el.querySelectorAll('.modelica-studio-help-tab')).map((t) => t.textContent);",
    "const shown = () => Array.from(el.querySelectorAll('.modelica-studio-help-panel')).filter((p) => !p.className.includes('is-hidden')).map((p) => p.querySelector('h4').textContent);",
    "window.test('the tabs are the subjects', () => tabs().join(' | '));",
    "window.test('one is open at a time', () => shown().join(','));",
    "window.test('clicking a tab opens it and closes the last', () => {",
    "  const results = Array.from(el.querySelectorAll('.modelica-studio-help-tab')).find((t) => t.textContent === 'Results');",
    "  results.click();",
    "  return shown().join(',') + ' | active=' + results.className.includes('is-active');",
    "});",
    "window.test('and the sweep is described there, where it can be found', () => {",
    "  const panel = Array.from(el.querySelectorAll('.modelica-studio-help-panel')).find((p) => p.textContent.includes('Sweeps and families'));",
    "  return panel ? panel.textContent.replace(/\\s+/g, ' ').slice(0, 2200) : 'NOT FOUND';",
    "});",
    "window.test('a hidden panel keeps its text, so nothing is lost by tabbing', () => {",
    "  const all = Array.from(el.querySelectorAll('.modelica-studio-help-panel'));",
    "  return all.map((p) => p.textContent.replace(/\\s+/g, '').length).join(',');",
    "});",
    "window.finish();"
  );
  if (out.skip) return;
  const d = passed(out);

  assert.equal(d["the tabs are the subjects"], "Overview | Diagrams | Results | About");
  assert.equal(d["one is open at a time"], "This installation", "the first panel is the one shown");
  assert.equal(
    d["clicking a tab opens it and closes the last"],
    "Sweeps and families | active=true",
    "a click moves the open panel"
  );
  assert.match(
    d["and the sweep is described there, where it can be found"],
    /A sweep runs the model once for each value of one parameter/,
    "the sweep is explained in the Results tab"
  );
  assert.match(
    d["and the sweep is described there, where it can be found"],
    /Only PARAMETERS can be swept/,
    "including why a start value is not offered"
  );
  // Every panel is populated: an empty tab is worse than a long scroll.
  for (const [i, length] of d["a hidden panel keeps its text, so nothing is lost by tabbing"]
    .split(",")
    .map(Number)
    .entries()) {
    assert.ok(length > 60, `panel ${i + 1} has content (${length} characters)`);
  }
});
