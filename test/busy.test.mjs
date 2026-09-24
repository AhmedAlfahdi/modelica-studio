/**
 * Busy indications.
 *
 * The promise made when these were added was not "there is a spinner" but "it
 * cannot break the UI". So the tests here are mostly geometry: every box in the
 * pane is measured before, during and after, and has to be identical to the pixel.
 *
 * The bar itself is the app's `.is-loading` — an absolutely positioned 3px accent
 * strip — so most of that promise is the app's to keep; what is the plugin's to
 * get right is WHEN it is shown, that it is stopped again on every path including
 * failure, and that `aria-busy` says the same thing to a screen reader.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runInDom, DOM_PREAMBLE } from "./helpers/dom-runner.mjs";
import { repoRoot } from "./helpers/build.mjs";
import { PLUGIN_CSS, THEME_CSS } from "./helpers/theme-css.mjs";

const ROOT = repoRoot;

const HEAD = [
  DOM_PREAMBLE,
  `import { setBusy, setButtonBusy } from "${ROOT}/src/view/busy";`,
  `import { ModelicaStudioView } from "${ROOT}/src/view/studio-view";`,
  "",
  "const style = document.createElement('style');",
  `style.textContent = ${JSON.stringify(THEME_CSS + PLUGIN_CSS)};`,
  "document.head.appendChild(style);",
  "document.body.classList.add('theme-dark');",
  "",
  "/**",
  " * Every box in a subtree as position and size, so two measurements can be",
  " * compared. Deliberately NOT the class names: those are what is being changed,",
  " * and including them would make the comparison fail for the wrong reason.",
  " */",
  "function boxes(root) {",
  "  const out = [root, ...root.querySelectorAll('*')].map((el, i) => {",
  "    const r = el.getBoundingClientRect();",
  "    return i + ':' + el.tagName + ':' + Math.round(r.x) + ',' + Math.round(r.y) + ',' + Math.round(r.width) + ',' + Math.round(r.height);",
  "  });",
  "  return out.join(' | ');",
  "}",
  "",
  "/** A view with just what `runSimulation` and `runSweep` reach for. */",
  "function makeView(over) {",
  "  const pane = document.createElement('div');",
  "  pane.className = 'modelica-studio-results';",
  "  pane.style.width = '600px';",
  "  pane.style.height = '240px';",
  "  const bar = pane.createDiv({ cls: 'modelica-studio-plotbar' });",
  "  const group = bar.createDiv({ cls: 'modelica-studio-group' });",
  "  group.createEl('button', { cls: 'modelica-studio-btn', text: 'Scale' });",
  "  group.createEl('button', { cls: 'modelica-studio-btn', text: 'Full screen' });",
  "  pane.createDiv({ cls: 'modelica-studio-plot' });",
  "  document.body.appendChild(pane);",
  "",
  "  // Built as the toolbar builds one: icon first, then the label.",
  "  const runBtn = document.createElement('button');",
  "  runBtn.className = 'modelica-studio-btn mod-cta';",
  "  setButtonBusy(runBtn, false, 'play');",
  "  runBtn.createSpan({ text: 'Simulate' });",
  "  document.body.appendChild(runBtn);",
  "",
  "  const simulated = [];",
  "  const progress = [];",
  "  const view = Object.create(ModelicaStudioView.prototype);",
  "  view.plugin = {",
  "    model: { name: 'Bounce', components: [], connections: [], equations: ['der(h) = -1'], graphics: [] },",
  "    settings: { startTime: 0, numberOfIntervals: 500, tolerance: 1e-6, solver: '', charts: {} },",
  "    stopTime: () => 1,",
  "    sourceForSave: () => 'model Bounce\\n  der(h) = -1;\\nend Bounce;\\n',",
  "    diag: () => {},",
  "    saveState: () => ({ state: 'saved', label: 'saved' }),",
  "    runLog: { add: () => {}, toText: () => '', clear: () => {}, lastFailure: () => null },",
  "    hasLibrary: true,",
  "    library: { size: 1, component: () => undefined },",
  "    backend: {",
  "      simulate: (req) => {",
  "        simulated.push(req.parameters.e);",
  "        progress.push(pane.style.getPropertyValue('--ms-progress'));",
  "        return new Promise((resolve) => { view.__resolve = () => resolve({",
  "          time: [0, 1], series: [{ name: 'h', values: [1, 0], unit: 'm' }],",
  "          warnings: [], compileMs: 0, simulateMs: 0, reusedBinary: true }); });",
  "      },",
  "    },",
  "  };",
  "  view.resultsEl = pane;",
  "  view.runBtns = [runBtn];",
  "  view.checkBtns = [];",
  "  view.busy = false;",
  "  view.family = [];",
  "  view.seriesStyles = {};",
  "  view.flushEditorIntoModel = () => {};",
  "  view.seedVisible = () => {};",
  "  view.drawResults = () => {};",
  "  view.drawFullScreen = () => {};",
  "  view.renderPlotPane = () => {};",
  "  view.publishChart = () => {};",
  "  view.showRunLog = () => {};",
  "  view.offerToSave = async () => {};",
  "  Object.assign(view, over || {});",
  "  return { view, pane, runBtn, simulated, progress };",
  "}",
  "",
  "/** Let queued promises run. */",
  "async function settle(n) {",
  "  for (let i = 0; i < (n || 20); i++) await Promise.resolve();",
  "}",
  "",
].join("\n");

test("the bar appears while a simulation runs, and moves nothing", async () => {
  const out = await runInDom(
    [
      HEAD,
      "const { view, pane, runBtn } = makeView();",
      "const before = boxes(document.body);",
      "const running = view.runSimulation();",
      "await settle();",
      "const during = boxes(document.body);",
      "const state = {",
      "  busy: pane.classList.contains('is-loading'),",
      "  aria: pane.getAttribute('aria-busy'),",
      "  progress: pane.classList.contains('is-progress'),",
      "  icon: runBtn.getAttribute('data-icon'),",
      "  spinning: runBtn.classList.contains('modelica-studio-spin'),",
      "  bar: getComputedStyle(pane, '::before').position + '/' + getComputedStyle(pane, '::before').top",
      "    + '/' + getComputedStyle(pane, '::before').height,",
      "};",
      "view.__resolve();",
      "await running;",
      "await settle();",
      "const svgs = Array.from(runBtn.children).filter((el) => el.tagName.toLowerCase() === 'svg');",
      "const after = {",
      "  busy: pane.classList.contains('is-loading'),",
      "  aria: pane.getAttribute('aria-busy'),",
      "  icon: runBtn.getAttribute('data-icon'),",
      "  spinning: runBtn.classList.contains('modelica-studio-spin'),",
      "  // The label survives, and there is exactly ONE icon. `setIcon` removes the",
      "  // first child, so a second swap used to eat the word and leave both icons.",
      "  label: runBtn.textContent,",
      "  icons: svgs.length,",
      "  order: Array.from(runBtn.children).map((el) => el.tagName.toLowerCase()).join(','),",
      "};",
      "",
      "window.test('the pane is marked while it works', () => JSON.stringify(state));",
      "window.test('and unmarked afterwards', () => JSON.stringify(after));",
      "window.test('nothing moved', () => (before === during ? 'identical' : 'MOVED: ' + during));",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));

  assert.equal(
    d["the pane is marked while it works"],
    JSON.stringify({
      busy: true,
      aria: "true",
      progress: false,
      icon: "loader-2",
      spinning: true,
      // The app's own bar: absolutely positioned at the top edge, 3px tall.
      bar: "absolute/0px/3px",
    }),
    "the bar, the semantic and the button icon all say the same thing"
  );
  assert.equal(
    d["and unmarked afterwards"],
    JSON.stringify({
      busy: false,
      aria: null,
      icon: "play",
      spinning: false,
      label: "Simulate",
      icons: 1,
      order: "svg,span",
    }),
    "the bar stops, the icon is back, and the button still says what it does"
  );
  assert.equal(d["nothing moved"], "identical", "the animation cannot reflow the view");
});

test("a sweep shows how far along it is, and stops when it fails", async () => {
  // A sweep is the one run whose length is known, so the bar fills instead of
  // sweeping — and it is also the one that can take a minute.
  const out = await runInDom(
    [
      HEAD,
      "const { view, pane, progress, simulated } = makeView();",
      "const sweep = view.runSweep('e', '0.4, 0.8, 1.2');",
      "await settle();",
      "const first = { progress: pane.style.getPropertyValue('--ms-progress'), determinate: pane.classList.contains('is-progress'),",
      "  painted: getComputedStyle(pane, '::before').width + '@' + getComputedStyle(pane, '::before').height };",
      "view.__resolve();",
      "await settle();",
      "const second = pane.style.getPropertyValue('--ms-progress');",
      "view.__resolve();",
      "await settle();",
      "const third = pane.style.getPropertyValue('--ms-progress');",
      "view.__resolve();",
      "await sweep;",
      "await settle();",
      "const done = { busy: pane.classList.contains('is-loading'), left: pane.style.getPropertyValue('--ms-progress'), values: simulated.join(',') };",
      "",
      "window.test('the bar is determinate and starts at zero', () => JSON.stringify(first));",
      "window.test('and reports each step', () => [second, third].join(' -> '));",
      "window.test('and is cleared at the end', () => JSON.stringify(done));",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));

  assert.equal(
    d["the bar is determinate and starts at zero"],
    JSON.stringify({ progress: "0%", determinate: true, painted: "0px@3px" }),
    "the bar is the app's, 3px tall, and starts empty"
  );
  assert.equal(d["and reports each step"], "33.33333333333333% -> 66.66666666666666%", "the width IS the progress");
  assert.equal(
    d["and is cleared at the end"],
    JSON.stringify({ busy: false, left: "", values: "0.4,0.8,1.2" }),
    "three runs, no bar left behind"
  );
});

test("a failed sweep stops the bar as surely as a good one", async () => {
  const out = await runInDom(
    [
      HEAD,
      "const { view, pane, runBtn } = makeView();",
      "view.plugin.backend.simulate = () => Promise.reject(new Error('compile failed'));",
      "await view.runSweep('e', '0.4, 0.8');",
      "await settle();",
      "window.test('nothing is left running', () => JSON.stringify({",
      "  busy: pane.classList.contains('is-loading'),",
      "  aria: pane.getAttribute('aria-busy'),",
      "  icon: runBtn.getAttribute('data-icon'),",
      "}));",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  assert.equal(
    out.results[0].detail,
    JSON.stringify({ busy: false, aria: null, icon: "play" }),
    "the failure path clears it too"
  );
});

test("an empty palette says the index is being built, and stops when it is ready", async () => {
  // First launch: the library is parsed in the background for a second or two and
  // the palette is simply empty, with nothing saying why.
  const out = await runInDom(
    [
      HEAD,
      "const { view, pane } = makeView();",
      "view.plugin.hasLibrary = false;",
      "const palette = document.createElement('div');",
      "palette.className = 'modelica-studio-palette-list';",
      "document.body.appendChild(palette);",
      "view.paletteEl = palette;",
      "view.renderPalette = () => {};",
      "// As `buildLayout` does at open.",
      "setBusy(palette, !view.plugin.hasLibrary);",
      "const before = palette.classList.contains('is-loading') + '/' + palette.getAttribute('aria-busy');",
      "// The real paths the plugin takes when the index lands: whichever arrives",
      "// first has to stop the bar.",
      "view.plugin.hasLibrary = true;",
      "view.onLibraryReady();",
      "const afterReady = palette.classList.contains('is-loading') + '/' + palette.getAttribute('aria-busy');",
      "setBusy(palette, true);",
      "await view.refreshLibrary();",
      "const afterRefresh = palette.classList.contains('is-loading') + '/' + palette.getAttribute('aria-busy');",
      "window.test('waiting, then ready', () => before + ' -> ' + afterReady + ' -> ' + afterRefresh);",
      "window.file = pane;",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  assert.equal(
    out.results[0].detail,
    "true/true -> false/null -> false/null",
    "the bar ends when the index arrives, by either path"
  );
  // And that the palette is marked when the view is built without an index.
  const view = fs.readFileSync(path.join(ROOT, "src/view/studio-view.ts"), "utf8");
  assert.match(
    view,
    /if \(!this\.plugin\.hasLibrary\) setBusy\(this\.paletteEl, true\);/,
    "an empty palette says it is waiting for the index"
  );
});

test("the two surfaces that cannot be mounted here are wired, and say so", async () => {
  // The AI request needs a live endpoint and an embedded block needs a note and a
  // host, so these are wiring checks: what they call is tested above.
  const view = fs.readFileSync(path.join(ROOT, "src/view/studio-view.ts"), "utf8");
  const embed = fs.readFileSync(path.join(ROOT, "src/view/embed.ts"), "utf8");

  // The AI wait, which is the one that can last minutes.
  assert.match(view, /const pressed = repair \? this\.aiFixBtn : this\.aiGoBtn;/, "the pressed button is known");
  assert.match(view, /setBusy\(this\.aiRow, true\);/, "the request row carries the bar");
  assert.match(
    view,
    /this\.aiCancel = false;\s*this\.aiAbort = null;\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*setBusy\(this\.aiRow, false\);/,
    "and clears it in the finally, so a stopped or failed request leaves nothing running"
  );

  // The embedded block: the bar goes on the TOOLBAR, never the block, because
  // `.is-loading` sets `position: relative` and the canvas inside a block is
  // absolutely positioned — the block as containing block would move the plot.
  assert.match(embed, /import \{ setBusy \} from "\.\/busy";/, "the block uses the same helper");
  assert.match(embed, /private markBusy\(busy: boolean\): void \{\s*setBusy\(this\.toolbarEl, busy\);/, "on the toolbar");
  assert.match(embed, /this\.markBusy\(true\);/, "shown when it starts simulating");
  assert.match(embed, /this\.busy = false;\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*this\.markBusy\(false\);/, "cleared in the finally");
  assert.ok(
    !/setBusy\(this\.container/.test(embed),
    "and never on the block itself, whose absolute canvas would move"
  );
});

test("the stylesheet keeps the reduced-motion promise", () => {
  // A bar that slides is motion. Under `prefers-reduced-motion` what is left is a
  // bar that is simply there, and the determinate one keeps its width because that
  // is information rather than movement.
  const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
  const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css);
  assert.ok(block, "there is a reduced-motion block");
  assert.match(block[1], /\.is-loading::before\s*\{[^}]*animation: none/, "the sweep stops");
  assert.match(block[1], /\.is-loading\.is-progress::before\s*\{[^}]*width: var\(--ms-progress/, "progress keeps its width");
  assert.match(block[1], /\.modelica-studio-spin \.svg-icon\s*\{[^}]*animation: none/, "and so does the icon");
  // Swapping a button's icon cannot resize it: both icons are 14px boxes.
  assert.match(css, /\.modelica-studio-btn \.svg-icon \{[^}]*width: 14px[^}]*height: 14px/, "the icon box is fixed");
  // The bar itself is the app's, so the plugin must not be redefining it.
  assert.ok(
    !/^\.is-loading\s*\{/m.test(css),
    "the plugin uses the app's .is-loading rather than restating it"
  );
});
