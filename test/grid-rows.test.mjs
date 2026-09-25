/**
 * The three grids that replaced `display: contents`.
 *
 * The scale controls, the help window's shortcut table and its colour legend each laid
 * their rows out by wrapping every row in an element with `display: contents`, which the
 * plugin directory rejects as a not-reliably-supported feature -- the browser data
 * behind that flags the accessibility bugs around it. The wrappers are gone and their
 * cells are children of the grid itself.
 *
 * That is the same layout only because it is the SAME grid: `display: contents` made the
 * wrapper's children participate in the parent grid, so the columns are shared by every
 * row. A grid per row would still look plausible in the source and would size each row on
 * its own, which is invisible until two rows differ -- `Z` and `Shift+Ctrl+Z` in different
 * columns, or a scale label that is longer than the one above it. So this asks the
 * browser for the geometry: every cell of a column starts at the same place, and every
 * cell's parent is the grid rather than a row element.
 *
 * The scale panel is built by the VIEW's own method, and the help window by its own
 * modal, so neither can drift from what ships without failing here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runInDom, DOM_PREAMBLE } from "./helpers/dom-runner.mjs";
import { repoRoot } from "./helpers/build.mjs";

const ROOT = repoRoot;
const CSS = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");

/**
 * The measure.
 *
 * Rounded, because two cells in one column can differ by a subpixel of fractional
 * layout and the question is alignment, not rounding. Reported PER GRID, because that
 * is the unit of the claim: a grid shares its columns between its own rows, and the
 * help window has two shortcut tables and two legends, each sized on its own.
 *
 * `dir` counts the cells whose parent is the grid -- all of them, when there is no row
 * element between, which is what `display: contents` used to arrange.
 */
const MEASURE = [
  "function column(grids, selector) {",
  "  const list = Array.isArray(grids) ? grids : [grids];",
  "  const cells = list.flatMap((g) => Array.from(g.querySelectorAll(selector)));",
  "  const perGrid = list.map((g) =>",
  "    Array.from(new Set(Array.from(g.querySelectorAll(selector)).map((c) => Math.round(c.getBoundingClientRect().left)))).join('/')",
  "  );",
  "  const own = cells.filter((c) => list.includes(c.parentElement)).length;",
  "  return cells.length + ' cells at ' + perGrid.join(' | ') + ' dir=' + own;",
  "}",
  "const style = document.createElement('style');",
  `style.textContent = ${JSON.stringify(CSS)};`,
  "document.head.appendChild(style);",
].join("\n");

/**
 * Read one measurement: how many cells, one left edge per grid, and how many cells are
 * the grid's own children.
 */
function measure(detail, grids) {
  const m = /^(\d+) cells at (.+) dir=(\d+)$/.exec(String(detail));
  assert.ok(m, `a count, left edges and a child count: ${detail}`);
  const columns = m[2].split(" | ");
  assert.equal(columns.length, grids, `one measurement per grid: ${detail}`);
  for (const c of columns) {
    assert.match(c, /^-?\d+$/, `every cell of a column starts at the same place: ${detail}`);
  }
  assert.equal(Number(m[3]), Number(m[1]), `every cell is a child of its grid, not of a row: ${detail}`);
  return { cells: Number(m[1]), columns };
}

test("the four scale rows share the grid's three columns", async () => {
  const out = await runInDom(
    [
      DOM_PREAMBLE,
      MEASURE,
      `import { ModelicaStudioView } from "${ROOT}/src/view/studio-view";`,
      "",
      "// A view with just what the panel reads, then the REAL builder: a replica of",
      "// the markup here would pass while the builder grew a wrapper back.",
      "const view = Object.create(ModelicaStudioView.prototype);",
      "view.result = { time: [0, 5, 10], series: [{ name: 'x', values: [0, 1, 2], unit: 'm' }], warnings: [] };",
      "view.seriesStyles = {};",
      "view.zoom = null;",
      "view.yLimits = null;",
      "view.scaleInputs = [];",
      "const panel = document.body.createDiv({ cls: 'modelica-studio-scale' });",
      "view.buildScalePanel(panel, () => {});",
      "",
      "window.test('one label column', () => column(panel, '.modelica-studio-scale-label'));",
      "window.test('one slider column', () => column(panel, 'input[type=range]'));",
      "window.test('one number column', () => column(panel, '.modelica-studio-scale-num'));",
      "window.test('four rows and nothing else', () => panel.children.length + ' cells, grid=' + getComputedStyle(panel).display);",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));

  // Four rows: X from, X to, Y from, Y to. `dir=4` is the part that says the cells are
  // the grid's own children -- one left edge per column, and no row element between.
  for (const [name, what] of [
    ["one label column", "the labels"],
    ["one slider column", "the sliders"],
    ["one number column", "the number boxes"],
  ]) {
    assert.match(d[name], /^4 cells at \d+ dir=4$/, `${what} line up in one column: ${d[name]}`);
  }
  assert.equal(d["four rows and nothing else"], "12 cells, grid=grid", "twelve cells, one grid");
});

test("the help window's shortcut table and legend share their columns", async () => {
  const out = await runInDom(
    [
      DOM_PREAMBLE,
      MEASURE,
      `import { HelpModal } from "${ROOT}/src/view/help-modal";`,
      `import { StubVault } from "${ROOT}/test/helpers/obsidian-stub";`,
      "",
      "const vault = new StubVault();",
      "vault.add('Modelica/Tank.mo', 'model Tank');",
      "const plugin = {",
      "  app: { vault, workspace: { getLeavesOfType: () => [] } },",
      "  manifest: { id: 'modelica-studio', version: '0.3.23', author: 'A' },",
      "  settings: { modelFolder: 'Modelica', modelFiles: {} },",
      "  library: { size: 6577, allNames: () => [], packages: () => ['Modelica.Blocks'] },",
      "  libraryRootNames: () => ['Modelica 4.1.0'],",
      "  saveSettings: async () => {},",
      "  getView: () => null,",
      "};",
      "const modal = new HelpModal(plugin.app, plugin);",
      "modal.open();",
      "const root = modal.contentEl;",
      "// Every panel shown. The window opens on one section at a time and the rest are",
      "// `display: none`, and a hidden element measures as zeros -- which would make",
      "// every column 'aligned' at 0. The gap assertion below is what catches this if it",
      "// ever comes back.",
      "for (const panel of Array.from(root.querySelectorAll('.modelica-studio-help-panel'))) {",
      "  panel.classList.remove('is-hidden');",
      "  panel.style.display = 'block';",
      "}",
      "// Both key grids: the diagram shortcuts and the code shortcuts, each with its",
      "// own first column.",
      "const keys = Array.from(root.querySelectorAll('.modelica-studio-keys'));",
      "// Both legends too: the library's own codes and the groupings this plugin adds.",
      "const legends = Array.from(root.querySelectorAll('.modelica-studio-help-domains'));",
      "",
      "window.test('the keys are one column of combos', () => column(keys, '.modelica-studio-key-combo'));",
      "window.test('beside one column of meanings', () => column(keys, '.modelica-studio-key-what'));",
      "window.test('the meanings are right of the longest combo', () => {",
      "  // Per grid: each table has its own first column, so the gap is measured inside",
      "  // one table at a time.",
      "  const gaps = keys.map((g) => {",
      "    const combos = Array.from(g.querySelectorAll('.modelica-studio-key-combo'));",
      "    const whats = Array.from(g.querySelectorAll('.modelica-studio-key-what'));",
      "    const widest = Math.max(...combos.map((c) => c.getBoundingClientRect().right));",
      "    const first = Math.min(...whats.map((w) => w.getBoundingClientRect().left));",
      "    return Math.round(first - widest);",
      "  });",
      "  return 'gaps=' + gaps.join(',');",
      "});",
      "window.test('the legend has a colour column', () => column(legends, '.modelica-studio-domain'));",
      "window.test('a code column', () => column(legends, '.modelica-studio-help-domain-code'));",
      "window.test('and a column saying where it comes from', () =>",
      "  column(legends, '.modelica-studio-help-domain-from'));",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));

  // The two key tables hold every shortcut between them, each shortcut as two cells of
  // its table's grid. A single left edge per column per table is the whole point: it is
  // what one grid shared by every row gives and a grid per row does not.
  const combos = measure(d["the keys are one column of combos"], 2);
  const whats = measure(d["beside one column of meanings"], 2);
  assert.ok(combos.cells >= 15, `enough shortcuts to be worth laying out: ${combos.cells}`);
  assert.equal(combos.cells, whats.cells, "one meaning per key");

  const gaps = (/^gaps=(.+)$/.exec(d["the meanings are right of the longest combo"])?.[1] ?? "")
    .split(",")
    .map(Number);
  assert.equal(gaps.length, 2, `both key tables are measured: ${d["the meanings are right of the longest combo"]}`);
  assert.ok(
    gaps.every((g) => g > 0),
    `the meanings sit in a second column in every table: ${d["the meanings are right of the longest combo"]}`
  );

  // The legend rows are three cells: the colour, the library's code for it, and where
  // the plugin uses it. The third is absent where there is nowhere to point, so the
  // columns are asserted to be columns rather than to hold the same number of cells.
  const colours = measure(d["the legend has a colour column"], 2);
  const codes = measure(d["a code column"], 2);
  const froms = measure(d["and a column saying where it comes from"], 2);
  assert.equal(colours.cells, codes.cells, "every swatch is named");
  assert.ok(codes.cells >= 8, `every domain is in the legend: ${codes.cells}`);
  assert.ok(froms.cells <= codes.cells, `some rows have nowhere to point: ${froms.cells} of ${codes.cells}`);
});
