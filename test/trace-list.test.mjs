/**
 * The list of traces, rendered.
 *
 * Reported as "why is there a box hiding the list of traces": a row was cut in
 * half at the top of the list, and with the filter box 4px above it and no
 * boundary on the list, the cut read as the box covering the traces. Measured
 * from the screenshot, the cut sits ~4px BELOW the box's border — the list's own
 * top edge — so nothing was covered: the list was scrolled a few pixels by the
 * reader, and nothing said so.
 *
 * Everything here is therefore about what the list looks like while it is
 * scrolled, and about the reader's place in it surviving a re-render. Both are
 * invisible in the source and only visible in a computed style or a scroll offset.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runInDom, DOM_PREAMBLE } from "./helpers/dom-runner.mjs";
import { repoRoot } from "./helpers/build.mjs";
import { THEME_VARS, PLUGIN_CSS, THEME_CSS } from "./helpers/theme-css.mjs";

const ROOT = repoRoot;

const HEAD = [
  DOM_PREAMBLE,
  `import { ModelicaStudioView } from "${ROOT}/src/view/studio-view";`,
  "",
  "const style = document.createElement('style');",
  // THEME_VARS first: a token the app defines is not in its rules, and a page without it
  // reads an inherited colour as though it were the rule's -- which is how the unit-match mark
  // measured black instead of the accent.
  `style.textContent = ${JSON.stringify(THEME_VARS + THEME_CSS + PLUGIN_CSS)};`,
  "document.head.appendChild(style);",
  "document.body.classList.add('theme-dark');",
  "",
  "/** A result with `n` variables, named as a real motor model names them. */",
  "const UNITS = {",
  "  'motor.friction.heatPort.T': 'K',",
  "  'motor.friction.phi': 'Wb',",
  "  'motor.friction.tau': 'N.m',",
  "  'motor.friction.w': 'rad/s',",
  "  'motor.ie.v': 'V',",
  "  'motor.inertiaStator.a': 'rad/s2',",
  "  'motor.inertiaStator.w': 'rad/s',",
  "  'motor.internalThermalPort.heatPortPermanentMagnet.Q_flow': 'W',",
  "  'motor.la.v': 'V',",
  "  'motor.phiMechanical': 'rad',",
  "  'motor.R_s': 'Ohm',",
  "  // What OpenModelica's unit inference produces for a derivative: shown as it",
  "  // is, because it is what the numbers are in.",
  "  'der(motor.phiMechanical)': 'km2.s-4.A-1.g',",
  "};",
  "const COMMENTS = { 'motor.friction.heatPort.T': 'Temperature of the winding' };",
  "function makeResult(n, longName, extras) {",
  "  const names = ['motor.friction.heatPort.T', 'motor.friction.phi', 'motor.friction.tau',",
  "    'motor.friction.w', 'motor.ie.v', 'motor.inertiaStator.a', 'motor.inertiaStator.w',",
  "    'motor.internalThermalPort.heatPortPermanentMagnet.Q_flow', 'motor.la.v', 'motor.phiMechanical'];",
  "  const series = [];",
  "  for (let i = 0; i < n; i++) {",
  "    const base = names[i % names.length];",
  "    // A test can name the first variable itself, for a name that cannot fit or",
  "    // one whose own shape matters. Such a name has no unit: the unit map is",
  "    // keyed by the fixture's names, and inventing one would be the fixture",
  "    // claiming something the compiler did not say.",
  "    const named = i === 0 && longName;",
  "    const name = named ? longName : base + (i >= names.length ? '_' + i : '');",
  "    series.push({ name, values: [0, 1, 2, 3, 4],",
  "      unit: named ? '' : UNITS[name] || UNITS[base] || '',",
  "      comment: named ? undefined : COMMENTS[name] || COMMENTS[base] });",
  "  }",
  "  // A constant and a derivative, so the Varying and Derivatives presets have",
  "  // something to exclude and something to keep. Left out when a test needs a",
  "  // result with neither.",
  "  if (extras !== false) {",
  "    series.push({ name: 'motor.R_s', values: [287, 287, 287, 287, 287], unit: UNITS['motor.R_s'] });",
  "    series.push({ name: 'der(motor.phiMechanical)', values: [0, 1, 2, 3, 4],",
  "      unit: UNITS['der(motor.phiMechanical)'] });",
  "  }",
  "  return { time: [0, 5, 10, 15, 20], series, warnings: [], compileMs: 0, simulateMs: 81, reusedBinary: true };",
  "}",
  "",
  "/** The full result names of the trace rows on screen, in the order drawn.",
  " *",
  " * The row shows the last segment of the name (`v`, under `capacitor`), so the",
  " * name it stands for is read from the row rather than from its text: that is",
  " * what the label is for, and what every assertion about a variable means. */",
  "function rowNames(body) {",
  "  return Array.from(body.querySelectorAll('.modelica-studio-series-row'))",
  "    .map((r) => r.dataset.name);",
  "}",
  "",
  "/** The Traces tab as the view builds it: tabs, body, and the real renderer. */",
  "function mount(n, height, longName, extras, expand) {",
  "  const pane = document.createElement('div');",
  "  pane.className = 'modelica-studio-col modelica-studio-inspector';",
  "  pane.style.width = '380px';",
  "  pane.style.height = (height || 520) + 'px';",
  "  document.body.appendChild(pane);",
  "  const tabs = pane.createDiv({ cls: 'modelica-studio-tabs' });",
  "  const body = pane.createDiv({ cls: 'modelica-studio-inspector-body' });",
  "",
  "  const view = Object.create(ModelicaStudioView.prototype);",
  "  view.plugin = {",
  "    model: { name: 'Motor', components: [], connections: [], graphics: [] },",
  "    // The maps the editor keeps per model name are read by the toolbar too, and a",
  "    // fixture that omits them throws where the app cannot.",
  "    settings: { labelScale: 1, hoverParameters: true, charts: {}, modelFiles: {}, modelStopTimes: {} },",
  "    library: { component: () => undefined },",
  "  };",
  "  view.editor = null;",
  "  view.inspectorTab = 'results';",
  "  view.inspectorEl = body;",
  "  view.inspectorTabsEl = tabs;",
  "  view.resultsEl = null;",
  "  view.seriesStyles = {};",
  "  view.seriesFilter = '';",
  "  // The pane, so `renderInspector` can mark which tab it is holding, exactly as",
  "  // it does in the view.",
  "  view.inspectorCol = pane;",
  "  // Fields are initialised in the class body, which `Object.create` skips.",
  "  view.seriesPreset = 'all';",
  "  view.varyingCache = { result: null, names: new Set() };",
  "  view.expandedGroups = new Set();",
  "  view.decidedGroups = new Set();",
  "  view.expansionSeeded = false;",
  "  view.fullTraceList = null;",
  "  view.fullSeriesScroll = 0;",
  "  view.publishChart = () => {};",
  "  view.adoptResult(makeResult(n, longName, extras));",
  "  view.renderInspector();",
  "  // The whole list in view, through the button that does it: a fresh result",
  "  // opens the top level and the small groups only, so a test about anything",
  "  // else has to ask for the rest the way the reader would.",
  "  if (expand) {",
  "    const button = Array.from(body.querySelectorAll('button'))",
  "      .find((b) => b.textContent === 'Expand all');",
  "    if (button) button.click();",
  "  }",
  "  return { view, pane, body };",
  "}",
  "",
  "/** Switch tabs the way `renderInspector` does.",
  " *",
  " * Two classes, because two elements need to know: the body holds the tab's",
  " * content, and the PANE carries the same fact because the rule that turns it",
  " * into a column matches the pane. It was a `:has()` on the body, which the",
  " * review rejects -- a selector that depends on a descendant invalidates",
  " * broadly -- so the pane is told directly, and a test that changes tabs by",
  " * hand has to tell it too. */",
  "function setTab(pane, body, tab) {",
  "  const results = tab === 'results';",
  "  body.classList.toggle('is-results', results);",
  "  pane.classList.toggle('is-results-tab', results);",
  "}",
  "",
  "/** Check a row, as a click on its box does. */",
  "function check(row) {",
  "  const cb = row.querySelector('input');",
  "  cb.checked = !cb.checked;",
  "  cb.dispatchEvent(new Event('change', { bubbles: true }));",
  "}",
  "",
  "function scrollList(list, top) {",
  "  list.scrollTop = top;",
  "  // Scroll events are asynchronous, so a real scroll has been recorded long",
  "  // before the next click; this stands in for that.",
  "  list.dispatchEvent(new Event('scroll'));",
  "}",
  "",
].join("\n");

test("the trace list is its own surface, separated from the filter above it", async () => {
  // The fix for the report: the boundary of the list has to be visible, or a
  // scrolled row reads as the filter box covering it.
  const out = await runInDom(
    [
      HEAD,
      "const { pane, body } = mount(173, 520, undefined, true, true);",
      "const filter = body.querySelector('.modelica-studio-search');",
      "const list = body.querySelector('.modelica-studio-series');",
      "const s = getComputedStyle(list);",
      "const paneStyle = getComputedStyle(pane);",
      "// Measured on a result that FITS, so the count line between the filter and",
      "// the list is not part of the gap being asserted.",
      "const small = mount(6);",
      "const smallList = small.body.querySelector('.modelica-studio-series');",
      "const smallFilter = small.body.querySelector('.modelica-studio-search');",
      "// Whatever sits directly above the list: the filter, the count line, or",
      "// the preset strip. The list must not touch it.",
      "const above = smallList.previousElementSibling;",
      "const gap = Math.round(smallList.getBoundingClientRect().top - above.getBoundingClientRect().bottom);",
      "",
      "window.test('the list is a bounded, inset surface', () =>",
      "  'border=' + s.borderTopWidth + ' radius=' + s.borderTopLeftRadius + ' bg=' + s.backgroundColor + ' pane=' + paneStyle.backgroundColor + ' overflowY=' + s.overflowY);",
      "window.test('there is a real gap between the filter and the list', () =>",
      "  'gap=' + gap + ' marginTop=' + getComputedStyle(smallList).marginTop);",
      "window.test('the list still scrolls rather than growing without limit', () =>",
      "  'maxHeight=' + s.maxHeight + ' scrollable=' + (list.scrollHeight > list.clientHeight));",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));

  assert.equal(
    d["the list is a bounded, inset surface"],
    "border=1px radius=4px bg=rgb(30, 30, 30) pane=rgb(38, 38, 38) overflowY=auto",
    "a bordered, darker box against the pane, so where it starts is obvious"
  );
  // The list's own 8px margin. This was 4px in total, with nothing between the
  // filter and the box, which is what made a scrolled row look like it was being
  // covered by the filter.
  // 6px from the preset strip's own margin plus the list's 8px: they are flex
  // items, so the margins do not collapse. This was 4px in total, with nothing
  // between the filter and the box, which is what made a scrolled row look like
  // it was being covered by the filter.
  assert.match(d["there is a real gap between the filter and the list"], /gap=14/, "a real gap, not 4px");
  assert.match(
    d["the list still scrolls rather than growing without limit"],
    /maxHeight=none/,
    "no fixed cap: the pane decides how tall the box is"
  );
  assert.match(d["the list still scrolls rather than growing without limit"], /scrollable=true/);
});

test("the list box takes the height that is left, not a fixed 190px", async () => {
  // "The list box is not all the way to the end": the box stopped at 190px in a
  // pane with several hundred pixels of room, so most of the panel was empty
  // below it and the box looked as if it had floated loose.
  //
  // Measured, because every part of this is geometry: what the box is worth
  // depends on the pane's height, which no source-level assertion can see.
  const out = await runInDom(
    [
      HEAD,
      "const { pane, body } = mount(173, 520, undefined, true, true);",
      "const list = body.querySelector('.modelica-studio-series');",
      "const short = mount(173, 200, undefined, true, true);",
      "const shortList = short.body.querySelector('.modelica-studio-series');",
      "// One name long enough that it cannot fit, as a deeply nested variable is: it",
      "// must be ellipsised, not left to stretch the row. Under the tree the row",
      "// shows its last segment, so the long name is carried by the row's title and",
      "// the ellipsis is exercised by a variable whose own name is long.",
      "const long = mount(20, 520, 'der(' + Array(12).fill('motor.internalThermalPort').join('.') + '.Q_flow)');",
      "const longList = long.body.querySelector('.modelica-studio-series');",
      "const longRow = longList.querySelector('.modelica-studio-series-row');",
      "const longName = longRow.querySelector('.modelica-studio-series-name');",
      // No underscores: a subscript run shrinks the name, so the ellipsis is tested with
      // a name typesetting cannot shorten (a camelCase identifier, as a library writes).
      "const longLabel = mount(6, 520, 'temperatureOfTheStatorWindingMeasuredAtTheSensorInTheHousing');",
      "const longLabelList = longLabel.body.querySelector('.modelica-studio-series');",
      "const longLabelName = longLabelList.querySelector('.modelica-studio-series-name');",
      "",
      "window.test('geometry', () => {",
      "  const l = list.getBoundingClientRect();",
      "  const p = pane.getBoundingClientRect();",
      "  const rows = Array.from(list.querySelectorAll('.modelica-studio-series-row'));",
      "  const name = list.querySelector('.modelica-studio-series-name');",
      "  const widest = rows.reduce((a, r) => Math.max(a, r.getBoundingClientRect().width), 0);",
      "  const sl = shortList.getBoundingClientRect();",
      "  return [",
      "    'paneHeight=' + Math.round(p.height),",
      "    'listHeight=' + Math.round(l.height),",
      "    'bottomGap=' + Math.round(p.bottom - l.bottom),",
      "    'listScrolls=' + (list.scrollHeight > list.clientHeight),",
      "    'paneScrollsX=' + (pane.scrollWidth > pane.clientWidth),",
      "    'paneScrollsY=' + (pane.scrollHeight > pane.clientHeight),",
      "    'bodyX=' + body.scrollWidth + ':' + body.clientWidth,",
      "    'listX=' + list.scrollWidth + ':' + list.clientWidth,",
      "    'widestRow=' + Math.round(widest) + ':' + Math.round(list.clientWidth),",
      "    'nameEllipsised=' + (name.scrollWidth > name.clientWidth),",
      "    'longNameEllipsised=' + (longName.scrollWidth > longName.clientWidth),",
      "    'longRowX=' + longList.scrollWidth + ':' + longList.clientWidth,",
      "    'longNameWidth=' + Math.round(longName.getBoundingClientRect().width) + ':' + longList.clientWidth,",
      "    'longTitle=' + (longRow.getAttribute('aria-label') || '').split('\\n')[0].slice(-24),",
      "    'labelEllipsised=' + (longLabelName.scrollWidth > longLabelName.clientWidth),",
      "    'labelListX=' + longLabelList.scrollWidth + ':' + longLabelList.clientWidth,",
      "    'shortHeight=' + Math.round(sl.height),",
      "    'shortRows=' + shortList.querySelectorAll('.modelica-studio-series-row').length,",
      "  ].join(' ');",
      "});",
      "window.test('one tooltip per row, and no native one beside it', () => {",
      "  // Reported from a phone photo of this list: two tooltips at once, in two styles — the",
      "  // qualified name in the browser's own tooltip and the short label in Obsidian's, because",
      "  // the name carried `aria-label` AND `title`. Obsidian draws a tooltip from `aria-label`",
      "  // and the browser draws one from `title`, so the rule here is `aria-label` only.",
      "  const row = list.querySelector('.modelica-studio-series-row');",
      "  const name = row.querySelector('.modelica-studio-series-name');",
      "  const unit = row.querySelector('.modelica-studio-series-unit');",
      "  // Properties, not a fixture's own names: what matters is that nothing carries a `title`",
      "  // and that each surface names itself through `aria-label` alone.",
      "  return 'titles=' + Array.from(list.querySelectorAll('[title]')).length",
      "    + ' rowNamesItself=' + (row.getAttribute('aria-label') || '').startsWith(row.dataset.name)",
      "    + ' nameIsQualified=' + (name.getAttribute('aria-label') === row.dataset.name)",
      "    + ' unitLabelled=' + (unit ? (unit.getAttribute('aria-label') || '').startsWith('Unit: ') : 'none');",
      "});",
      "window.test('the Selection tab is left alone', () => {",
      "  // The fill is scoped to the Traces tab: pinning the Selection tab's body to",
      "  // the pane would leave the lower half of a long form unreachable.",
      "  const withClass = getComputedStyle(pane).display;",
      "  const overflow = getComputedStyle(body).overflowY;",
      "  setTab(pane, body, 'component');",
      "  const without = getComputedStyle(pane).display;",
      "  const overflowWithout = getComputedStyle(body).overflowY;",
      "  setTab(pane, body, 'results');",
      "  return 'traces=' + withClass + '/' + overflow + ' selection=' + without + '/' + overflowWithout;",
      "});",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const g = out.results[0].detail;
  const num = (key) => Number(new RegExp(key + "=(-?\\d+)").exec(g)?.[1]);

  assert.equal(num("paneHeight"), 520, "the pane the test gives it");
  // By name: the cases in this page are read by position elsewhere (`g` is the first result), and
  // this one is inserted in the middle of them.
  const named = (n) => out.results.find((r) => r.name === n)?.detail ?? "";
  assert.equal(
    named("one tooltip per row, and no native one beside it"),
    "titles=0 rowNamesItself=true nameIsQualified=true unitLabelled=true",
    "one tooltip attribute per surface: `title` beside `aria-label` drew two at once"
  );

  // The box is the leftover height — most of the pane — not a 190px cap.
  assert.ok(num("listHeight") > 280, `the box fills the pane, got ${num("listHeight")}px`);
  // And it ends at the body's padding, not hundreds of pixels above it.
  assert.ok(num("bottomGap") <= 20, `the box reaches the bottom, gap ${num("bottomGap")}px :: ${g}`);
  assert.match(g, /listScrolls=true/, "the rows scroll inside the box");
  assert.match(g, /paneScrollsY=false/, "the pane itself does not scroll");
  assert.match(g, /paneScrollsX=false/, "and there is no stray horizontal scrollbar");
  assert.match(g, /bodyX=(\d+):\1/, "the body is not wider than it is");
  assert.match(g, /listX=(\d+):\1/, "nor is the list: a sideways scrollbar there costs a row");
  assert.ok(
    num("widestRow") <= num("listHeight") * 100 && num("widestRow") <= num("paneHeight") * 100,
    "sanity"
  );
  // A name too long for the column is ellipsised rather than stretching the row
  // and giving the list a sideways scrollbar. Under the tree the row carries its
  // last segment, so the two halves are checked where each one lives: the long
  // path is in the row's title, and a long name of its own is ellipsised.
  assert.match(g, /longNameEllipsised=false/, "the row shows the short last segment");
  assert.match(g, /longRowX=(\d+):\1/, "and it does not widen the list");
  const [nameW, listW] = g.match(/longNameWidth=(\d+):(\d+)/).slice(1).map(Number);
  assert.ok(nameW < listW, `the name fits the column: ${nameW} < ${listW}`);
  assert.match(
    g,
    /longTitle=[^ ]*Q_flow\)/,
    "the full name the row stands for is on the row, for a filter or a log"
  );
  assert.match(g, /labelEllipsised=true/, "a name too long for the column is ellipsised");
  assert.match(g, /labelListX=(\d+):\1/, "and it does not widen the list either");
  // A pane too short for the content keeps the box usable.
  assert.ok(num("shortHeight") >= 100, `a floor of about six rows, got ${num("shortHeight")}`);
  assert.ok(num("shortRows") > 0, "with rows in it");

  assert.equal(
    out.results.find((r) => r.name === "the Selection tab is left alone")?.detail,
    "traces=flex/auto selection=block/visible",
    "the fill applies to the Traces tab only"
  );
});

test("a group can still be collapsed while the list is narrowed", async () => {
  // Reported as "sometimes the collapsing of traces does not work". It does not, whenever a
  // preset or a filter is on: `traceRows` opened every group with children as soon as a match
  // predicate existed, so the reader's own arrangement was ignored — the twisty still drew a
  // chevron, still answered a click, and still said "Collapse pipe" to a screen reader, and
  // nothing moved. The control lied, and only while narrowing, which is exactly "sometimes".
  const out = await runInDom(
    [
      HEAD,
      "const { body } = mount(173, 520, undefined, true, true);",
      "const pills = () => Array.from(body.querySelectorAll('.modelica-studio-preset'));",
      "const pick = (label) => {",
      "  const b = pills().find((p) => p.textContent === label);",
      "  if (!b) throw new Error('no pill ' + label);",
      "  b.dispatchEvent(new MouseEvent('click', { bubbles: true }));",
      "};",
      "const groupNamed = (n) => Array.from(body.querySelectorAll('.modelica-studio-series-group'))",
      "  .find((g) => g.querySelector('.modelica-studio-series-group-name').textContent === n);",
      "const clickTwisty = (n) => {",
      "  const g = groupNamed(n);",
      "  if (!g) throw new Error('no group ' + n);",
      "  g.querySelector('.modelica-studio-series-twisty').dispatchEvent(new MouseEvent('click', { bubbles: true }));",
      "};",
      "const openOf = (n) => { const g = groupNamed(n); return g ? g.classList.contains('is-open') : 'GONE'; };",
      "const rows = () => rowNames(body).length;",
      "",
      "window.test('with nothing asked for, the twisty closes a group', () => {",
      "  const before = rows();",
      "  clickTwisty('motor');",
      "  return 'rows=' + before + '->' + rows() + ' open=' + openOf('motor');",
      "});",
      "window.test('and it closes it with a preset on too', () => {",
      "  pick('Varying');",
      "  // Explicit, not inherited from the case above: what is under test is a CLICK, so the",
      "  // group is put in a known state first.",
      "  const settle = (want) => { if (openOf('motor') !== want) clickTwisty('motor'); };",
      "  settle(true);",
      "  const before = rows();",
      "  clickTwisty('motor');",
      "  const closed = openOf('motor') === false;",
      "  const after = rows();",
      "  clickTwisty('motor');",
      "  return 'rows=' + before + '->' + after + ' closedByClick=' + closed",
      "    + ' reopened=' + openOf('motor') + ' rows=' + rows();",
      "});",
      "window.test('and with something typed', () => {",
      "  const filter = body.querySelector('.modelica-studio-search');",
      "  filter.value = 'phi';",
      "  filter.dispatchEvent(new Event('input', { bubbles: true }));",
      "  if (openOf('motor') !== true) clickTwisty('motor');",
      "  const before = rows();",
      "  clickTwisty('motor');",
      "  return 'rows=' + before + '->' + rows() + ' open=' + openOf('motor');",
      "});",
      "window.test('PROBE the last heading, past the budget', () => {",
      "  pick('All');",
      "  const filter = body.querySelector('.modelica-studio-search');",
      "  filter.value = '';",
      "  filter.dispatchEvent(new Event('input', { bubbles: true }));",
      "  const groups = () => Array.from(body.querySelectorAll('.modelica-studio-series-group'));",
      "  // The heading AT the budget cut is the interesting one: opening it can only add rows the",
      "  // budget has no room for, and the row is dropped when an opened heading has nothing under",
      "  // it — the control disappearing under the cursor that just clicked it.",
      "  const all = Array.from(body.querySelectorAll('.modelica-studio-series-row, .modelica-studio-series-group'));",
      "  const tail = all.slice(-3);",
      "  const heading = tail.filter((el) => el.classList.contains('modelica-studio-series-group'))",
      "    .filter((el) => !el.classList.contains('is-open'))",
      "    .pop();",
      "  const lastKind = tail.map((el) => (el.classList.contains('modelica-studio-series-group') ? 'group:' + el.querySelector('.modelica-studio-series-group-name').textContent + (el.classList.contains('is-open') ? '(open)' : '(closed)') : 'row')).join(' | ');",
      "  if (!heading) return 'no closed heading in the last three rows: ' + lastKind;",
      "  const name = heading.querySelector('.modelica-studio-series-group-name').textContent;",
      "  const before = rows();",
      "  heading.querySelector('.modelica-studio-series-twisty').dispatchEvent(new MouseEvent('click', { bubbles: true }));",
      "  const still = groups().some((g) => g.querySelector('.modelica-studio-series-group-name').textContent === name);",
      "  return 'tail=' + lastKind + ' opened=' + name + ' rows=' + before + '->' + rows()",
      "    + ' headingSurvived=' + still;",
      "});",
      "window.finish();",
    ].join("\n")
  );
  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));

  assert.match(
    d["with nothing asked for, the twisty closes a group"],
    /open=false$/,
    "the arrangement works when nothing is asked for"
  );
  assert.match(
    d["and it closes it with a preset on too"],
    /closedByClick=true/,
    "and it must work with a preset on, which is where it did not"
  );
  assert.match(
    d["and it closes it with a preset on too"],
    /reopened=true/,
    "and it opens again: the search does not hold it shut either"
  );
  assert.match(
    d["and with something typed"],
    /open=false$/,
    "and with a filter typed: the reader's decision wins over the search opening groups for them"
  );
});

test("the list can be narrowed by preset, not only by typing", async () => {
  // Asked for as "filter presets, like showing only the active traces": the list
  // is every variable the model has, and the question asked of it is nearly
  // always one of four. A preset is a named predicate, not a filter string --
  // "Active" is not a substring of anything.
  const out = await runInDom(
    [
      HEAD,
      "const { body } = mount(173, 520, undefined, true, true);",
      "// Two traces drawn, the way a reader picks them. By name rather than by",
      "// position: the tree groups the rows, so which row is third is a fact about",
      "// the fixture's layout, not about what the preset keeps.",
      "const rowFor = (name) => Array.from(body.querySelectorAll('.modelica-studio-series-row')).find((r) => r.dataset.name === name);",
      "check(rowFor('motor.friction.phi'));",
      "check(rowFor('motor.friction.tau'));",
      "",
      "const pills = () => Array.from(body.querySelectorAll('.modelica-studio-preset'));",
      "const names = () => rowNames(body);",
      "const pick = (label) => {",
      "  const b = pills().find((p) => p.textContent === label);",
      "  if (!b) throw new Error('no pill ' + label);",
      "  b.dispatchEvent(new MouseEvent('click', { bubbles: true }));",
      "};",
      "",
      "window.test('the pills are there, with one showing', () => {",
      "  return pills().map((p) => p.textContent + (p.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(' ')",
      "    + ' hints=' + pills().every((p) => !!p.getAttribute('aria-label'));",
      "});",
      "window.test('Active keeps only what is drawn', () => {",
      "  pick('Active');",
      "  const shown = names();",
      "  const pressed = pills().find((p) => p.textContent === 'Active').getAttribute('aria-pressed');",
      "  return shown.length + ' rows: ' + shown.join(', ') + ' pressed=' + pressed;",
      "});",
      "window.test('and combines with what is typed', () => {",
      "  const filter = body.querySelector('.modelica-studio-search');",
      "  filter.value = 'phi';",
      "  filter.dispatchEvent(new Event('input', { bubbles: true }));",
      "  return names().join(', ') || 'NONE';",
      "});",
      "window.test('Varying drops the constants', () => {",
      "  const filter = body.querySelector('.modelica-studio-search');",
      "  filter.value = '';",
      "  filter.dispatchEvent(new Event('input', { bubbles: true }));",
      "  pick('Varying');",
      "  const shown = names();",
      "  const note = body.querySelector('.modelica-studio-series-more');",
      "  return 'constant=' + shown.includes('motor.R_s') + ' first=' + shown[0]",
      "    + ' note=' + (note ? note.textContent : 'none');",
      "});",
      "window.test('Derivatives keeps only der(...)', () => {",
      "  pick('Derivatives');",
      "  const shown = names();",
      "  return 'rows=' + shown.length + ' allDer=' + shown.every((n) => n.includes('der('));",
      "});",
      "window.test('All puts everything back', () => {",
      "  pick('All');",
      "  return 'rows=' + names().length + ' pressed=' + pills().map((p) => p.getAttribute('aria-pressed')).join(',');",
      "});",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));

  assert.equal(
    d["the pills are there, with one showing"],
    "All* Active Varying Derivatives hints=true",
    "four presets, one of them showing, each with its own explanation"
  );
  assert.equal(
    d["Active keeps only what is drawn"],
    "2 rows: motor.friction.phi, motor.friction.tau pressed=true",
    "exactly the traces being plotted"
  );
  assert.equal(
    d["and combines with what is typed"],
    "motor.friction.phi",
    "the preset and the text narrow together"
  );
  assert.match(d["Varying drops the constants"], /constant=false/, "a flat variable is not varying");
  assert.match(
    d["Varying drops the constants"],
    /note=Showing the first 40 of 174/,
    "175 series in the fixture, one of them flat"
  );
  assert.equal(
    d["Derivatives keeps only der(...)"],
    "rows=1 allDer=true",
    "the fixture writes one derivative"
  );
  assert.equal(
    d["All puts everything back"],
    "rows=40 pressed=true,false,false,false",
    "the page caps the rows; that all 175 are back is what the count line says"
  );
});

test("a preset with nothing to show says which, and how to get back", async () => {
  // The trap: "Active" with nothing drawn is an empty list, and an empty list has
  // no checkboxes to click. The message names the way out, and the pills are
  // still above it.
  const out = await runInDom(
    [
      HEAD,
      "const { body } = mount(40, 520, undefined, false);",
      "const pill = (label) => Array.from(body.querySelectorAll('.modelica-studio-preset')).find((p) => p.textContent === label);",
      "pill('Active').dispatchEvent(new MouseEvent('click', { bubbles: true }));",
      "const active = body.querySelector('.modelica-studio-series').textContent;",
      "const stillThere = body.querySelectorAll('.modelica-studio-preset').length;",
      "pill('Derivatives').dispatchEvent(new MouseEvent('click', { bubbles: true }));",
      "const derived = body.querySelector('.modelica-studio-series').textContent;",
      "window.test('each empty preset explains itself', () =>",
      "  'active=[' + active + '] derivatives=[' + derived + '] pills=' + stillThere);",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  assert.equal(
    out.results[0].detail,
    "active=[No trace is being drawn yet — choose All to pick some.] " +
      "derivatives=[This result has no derivatives.] pills=4",
    "the way out is named, and the pills are still there to take it"
  );
});

test("how much of the list is off screen is stated where it can be read", async () => {
  // It was a line at the FOOT of the scroll area, which can only be found by
  // scrolling to the end of the set the reader is searching.
  const out = await runInDom(
    [
      HEAD,
      "const { body } = mount(173, 520, undefined, true, true);",
      "const list = body.querySelector('.modelica-studio-series');",
      "const note = body.querySelector('.modelica-studio-series-more');",
      "",
      "window.test('the count is stated, and above the list', () => {",
      "  if (!note) return 'NO NOTE';",
      "  const inside = list.contains(note);",
      "  const above = note.getBoundingClientRect().bottom <= list.getBoundingClientRect().top;",
      "  return 'text=' + note.textContent + ' insideList=' + inside + ' aboveList=' + above + ' rows=' + list.querySelectorAll('.modelica-studio-series-row').length;",
      "});",
      "window.test('a result that fits says nothing about narrowing', () => {",
      "  const small = document.createElement('div');",
      "  document.body.appendChild(small);",
      "  const other = mount(6);",
      "  return other.body.querySelector('.modelica-studio-series-more') ? 'STILL SHOWN' : 'no note for 6 variables';",
      "});",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));

  assert.equal(
    d["the count is stated, and above the list"],
    "text=Showing the first 40 of 175 — type to narrow the list. insideList=false aboveList=true rows=40"
  );
  assert.equal(d["a result that fits says nothing about narrowing"], "no note for 6 variables");
});

test("the reader's place in the list survives checking a trace", async () => {
  // The list is rebuilt on every check. Clicking the thirtieth trace threw it
  // back to the first, so every box after it had to be found again.
  const out = await runInDom(
    [
      HEAD,
      "const { body } = mount(173, 520, undefined, true, true);",
      "",
      "window.test('a check keeps the offset', () => {",
      "  const before = body.querySelector('.modelica-studio-series');",
      "  scrollList(before, 120);",
      "  const rows = before.querySelectorAll('.modelica-studio-series-row');",
      "  check(rows[20]);",
      "  const after = body.querySelector('.modelica-studio-series');",
      "  return 'replaced=' + (after !== before) + ' before=' + 120 + ' after=' + after.scrollTop;",
      "});",
      "window.test('and typing in the filter starts again at the top', () => {",
      "  const list = body.querySelector('.modelica-studio-series');",
      "  scrollList(list, 120);",
      "  const filter = body.querySelector('.modelica-studio-search');",
      "  filter.value = 'friction';",
      "  filter.dispatchEvent(new Event('input', { bubbles: true }));",
      "  const next = body.querySelector('.modelica-studio-series');",
      "  const names = rowNames(body);",
      "  return 'after=' + next.scrollTop + ' rows=' + names.length + ' first=' + names[0];",
      "});",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));

  assert.equal(
    d["a check keeps the offset"],
    "replaced=true before=120 after=120",
    "a new list element, at the reader's place"
  );
  assert.match(d["and typing in the filter starts again at the top"], /^after=0/, "a new filter, a new list");
  assert.match(d["and typing in the filter starts again at the top"], /first=motor\.friction\.heatPort\.T$/);
});

test("the variables are folded into the components their names describe", async () => {
  // The list is every variable the model has, and a flat list said `motor.` on
  // every row of it. Folding the names into a tree is what turns the prefix into
  // a heading — and a heading that can be closed, which is the only way a hundred
  // and seventy variables fit in a 380px column.
  const out = await runInDom(
    [
      HEAD,
      "const { view, body } = mount(40);",
      "const groups = () => Array.from(body.querySelectorAll('.modelica-studio-series-group'));",
      "const groupNamed = (name) => groups().find((g) => g.querySelector('.modelica-studio-series-group-name').textContent === name);",
      "const labels = () => Array.from(body.querySelectorAll('.modelica-studio-series-name')).map((n) => n.textContent);",
      "",
      "window.test('the first screen is the model, not forty rows of one prefix', () => {",
      "  const shown = labels();",
      "  return 'groups=' + groups().map((g) => g.querySelector('.modelica-studio-series-group-name').textContent).join(',')",
      "    + ' rows=' + rowNames(body).length",
      "    + ' dotted=' + shown.some((l) => l.includes('.'));",
      "});",
      "window.test('a name is drawn as runs: subscripts low, a derivative dotted', () => {",
      "  const rowFor = (n) => Array.from(body.querySelectorAll('.modelica-studio-series-row')).find((r) => r.dataset.name === n);",
      "  const q = rowFor('motor.internalThermalPort.heatPortPermanentMagnet.Q_flow');",
      "  const d = rowFor('der(motor.phiMechanical)');",
      "  const sub = q.querySelector('.modelica-studio-series-name .modelica-studio-run-sub');",
      "  const dot = d.querySelector('.modelica-studio-series-name .modelica-studio-run.is-deriv');",
      "  return 'sub=' + (sub ? sub.textContent : 'NONE')",
      "    + ' label=' + q.querySelector('.modelica-studio-series-name').getAttribute('aria-label')",
      "    + ' dots=' + (dot ? dot.getAttribute('data-dots') : 'NONE')",
      "    + ' text=' + d.querySelector('.modelica-studio-series-name').textContent;",
      "});",
      "window.test('clicking a component brings the Selection panel back', () => {",
      "  const tabFor = (name) => Array.from(view.inspectorTabsEl.querySelectorAll('.modelica-studio-tab')).find((b) => b.textContent === name);",
      "  const before = view.inspectorCol.classList.contains('is-results-tab');",
      "  view.onSelectionChanged(['motor.friction.phi']);",
      "  return 'before=' + before",
      "    + ' after=' + view.inspectorCol.classList.contains('is-results-tab')",
      "    + ' frame=' + body.classList.contains('is-results')",
      "    + ' active=' + (tabFor('Selection').classList.contains('is-active') ? 'Selection' : 'other');",
      "});",
      "window.test('and clicking a wire does too', () => {",
      "  view.inspectorTab = 'results';",
      "  view.renderInspector();",
      "  // An editor always has these; the toolbar reads them, and a fixture that omits",
      "  // them throws where the app cannot.",
      "  view.editor = { selectedIds: [], selectedWireIds: ['conn-1'], currentModel: view.plugin.model,",
      "    history: { canUndo: false, canRedo: false }, canPaste: false };",
      "  view.onSelectionChanged([]);",
      "  view.editor = null;",
      "  return 'wire=' + !view.inspectorCol.classList.contains('is-results-tab');",
      "});",
      "window.test('a click on empty canvas leaves the tab where it was', () => {",
      "  view.inspectorTab = 'results';",
      "  view.renderInspector();",
      "  view.onSelectionChanged([]);",
      "  return 'still=' + view.inspectorCol.classList.contains('is-results-tab');",
      "});",
      "window.test('a crowded component is closed and says how much is in it', () => {",
      "  const friction = groupNamed('friction');",
      "  const count = friction.querySelector('.modelica-studio-series-count');",
      "  return 'open=' + friction.classList.contains('is-open')",
      "    + ' count=' + count.textContent + ' shown=' + rowNames(body).some((n) => n.startsWith('motor.friction.phi'));",
      "});",
      "window.test('a small component is open, so nothing is hidden behind a click', () => {",
      "  const ie = groupNamed('ie');",
      "  return 'open=' + ie.classList.contains('is-open')",
      "    + ' shown=' + rowNames(body).includes('motor.ie.v');",
      "});",
      "window.test('the triangle opens a component and closes it again', () => {",
      "  const twisty = groupNamed('friction').querySelector('.modelica-studio-series-twisty');",
      "  const aria = twisty.getAttribute('aria-expanded');",
      "  twisty.click();",
      "  const opened = rowNames(body).filter((n) => n.startsWith('motor.friction')).length;",
      "  groupNamed('friction').querySelector('.modelica-studio-series-twisty').click();",
      "  const closed = rowNames(body).filter((n) => n.startsWith('motor.friction')).length;",
      "  return 'aria=' + aria + ' opened=' + opened + ' closed=' + closed;",
      "});",
      "window.test('the heading itself opens the group too', () => {",
      "  groupNamed('friction').querySelector('.modelica-studio-series-group-name').click();",
      "  const opened = rowNames(body).filter((n) => n.startsWith('motor.friction')).length;",
      "  return 'opened=' + opened;",
      "});",
      "window.test('one button opens the whole tree, and says so', () => {",
      "  const button = () => Array.from(body.querySelectorAll('.modelica-studio-series-head button')).map((b) => b.textContent).join('|');",
      "  const before = button();",
      "  const expand = Array.from(body.querySelectorAll('button')).find((b) => b.textContent === 'Expand all');",
      "  expand.click();",
      "  const openGroups = groups().filter((g) => g.classList.contains('is-open')).length;",
      "  const after = button();",
      "  // Every group open is more variables than the panel lists, so the count",
      "  // line is back — the list is a window, and a window says what it is showing.",
      "  const note = body.querySelector('.modelica-studio-series-more');",
      "  return 'before=' + before + ' after=' + after + ' openGroups=' + openGroups",
      "    + ' note=' + (note ? note.textContent : 'none') + ' rows=' + rowNames(body).length;",
      "});",
      "window.test('a filter shows the matches in place, opened, whatever was folded', () => {",
      "  const twisty = groupNamed('friction').querySelector('.modelica-studio-series-twisty');",
      "  if (twisty.getAttribute('aria-expanded') === 'true') twisty.click();",
      "  const filter = body.querySelector('.modelica-studio-search');",
      "  filter.value = 'phi';",
      "  filter.dispatchEvent(new Event('input', { bubbles: true }));",
      "  const names = rowNames(body);",
      "  return 'rows=' + names.length + ' all=' + names.every((n) => n.toLowerCase().includes('phi'))",
      "    + ' opened=' + groupNamed('friction').classList.contains('is-open');",
      "});",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));

  assert.equal(
    d["the first screen is the model, not forty rows of one prefix"],
    "groups=motor,friction,ie,inertiaStator,internalThermalPort," +
      "heatPortPermanentMagnet,la rows=18 dotted=false",
    "the components as headings, the crowded ones closed, and no full path left in a label"
  );
  assert.equal(
    d["a crowded component is closed and says how much is in it"],
    "open=false count=0/16 shown=false",
    "sixteen variables stay behind one row that says so"
  );
  assert.equal(
    d["clicking a component brings the Selection panel back"],
    "before=true after=false frame=false active=Selection",
    "the panel showing what is selected, on the click that selected it"
  );
  assert.equal(
    d["and clicking a wire does too"],
    "wire=true",
    "a wire is a selection, and its parameters live on the same tab"
  );
  assert.equal(
    d["a click on empty canvas leaves the tab where it was"],
    "still=true",
    "forcing it on a component, not on every click on the canvas"
  );
  // The accessible name — and, since Obsidian draws its tooltip from the same attribute, the
  // one tooltip — is the QUALIFIED name. It used to be the row's own label, which repeats what
  // is already drawn under the cursor.
  assert.equal(
    d["a name is drawn as runs: subscripts low, a derivative dotted"],
    // `dots=NONE` and a trailing prime: the derivative notation is a setting, and the default is
    // a prime because a dot is drawn by this plugin from the run's width alone while a prime is
    // placed by the font. The dot's own shapes are asserted in `typeset.test.mjs`.
    "sub=flow label=motor.internalThermalPort.heatPortPermanentMagnet.Q_flow dots=NONE text=phiMechanical'",
    "the same tokenizer the legend uses, so the two surfaces agree"
  );
  assert.equal(
    d["a small component is open, so nothing is hidden behind a click"],
    "open=true shown=true",
    "a group of four costs four rows and saves a click"
  );
  assert.equal(
    d["the triangle opens a component and closes it again"],
    "aria=false opened=16 closed=0",
    "the control opens what it points at, and only that"
  );
  assert.equal(d["the heading itself opens the group too"], "opened=16", "a wide target for a small triangle");
  assert.equal(
    d["one button opens the whole tree, and says so"],
    "before=Expand all|Clear traces after=Collapse all|Clear traces openGroups=8 " +
      "note=Showing the first 40 of 42 — type to narrow the list. rows=40",
    "every group open is more rows than the panel lists, and the button turns around"
  );
  assert.equal(
    d["a filter shows the matches in place, opened, whatever was folded"],
    "rows=9 all=true opened=true",
    "phi is in two components and in the derivative of one of them, and all nine are shown"
  );
});

test("a unit is shown with the variable it belongs to, not with the model", async () => {
  // The unit is the one fact about a variable that the model's own source does
  // not state — `Modelica.Units.SI.Voltage v` never writes "V" — and a plot of a
  // voltage against a current is unreadable without it. It is the compiler's
  // string, shown as it stands: OpenModelica writes `s-1.A` for a derivative, and
  // a prettier rendering would be a different claim about the numbers.
  const out = await runInDom(
    [
      HEAD,
      "const { body } = mount(20, 520, undefined, true, true);",
      "const rowFor = (name) => Array.from(body.querySelectorAll('.modelica-studio-series-row'))",
      "  .find((r) => r.dataset.name === name);",
      "const unitOf = (name) => {",
      "  const span = rowFor(name).querySelector('.modelica-studio-series-unit');",
      "  return span ? span.textContent + ' title=' + span.getAttribute('aria-label') : 'NONE';",
      "};",
      "// A result whose variables carry no unit at all: the description is optional",
      "// and the row must not grow an empty placeholder for it.",
      "const bare = mount(6, 520, 'temperatureOfTheStatorWinding');",
      "const bareRow = bare.body.querySelector('.modelica-studio-series-row');",
      "",
      "window.test('every row says what its numbers are in', () =>",
      "  'T=' + unitOf('motor.friction.heatPort.T') + ' phi=' + unitOf('motor.friction.phi')",
      "    + ' v=' + unitOf('motor.la.v'));",
      "window.test('a derivative is read as a reader writes it, and kept whole on the row', () =>",
      "  'shown=' + unitOf('der(motor.phiMechanical)')",
      "    + ' exact=' + (rowFor('der(motor.phiMechanical)').getAttribute('aria-label') || '').split('\\n').pop());",
      "window.test('the row also carries what the variable is', () =>",
      "  'title=' + JSON.stringify(rowFor('motor.friction.heatPort.T').getAttribute('aria-label')));",
      "window.test('a unit is legible even on a row that is not drawn', () => {",
      "  // Reported from a screenshot: the units were there and unreadable. Two things were",
      "  // multiplying -- the faint colour token, and a row opacity that dimmed the unit along",
      "  // with the name. The dimming is about DRAWNESS, so it belongs to the box, the swatch and",
      "  // the name; the unit is what a reader scans while deciding what to draw.",
      "  const style = (el) => getComputedStyle(el);",
      "  const unit = (row) => row.querySelector('.modelica-studio-series-unit');",
      "  const name = (row) => row.querySelector('.modelica-studio-series-name');",
      "  // Draw one, so both states are measured. The list is rebuilt on a tick, so BOTH rows are",
      "  // looked up afterwards: a held reference is detached, and a detached element has no",
      "  // computed style at all -- which reported as every value being empty.",
      "  check(rowFor('motor.la.v'));",
      "  const drawn = rowFor('motor.la.v');",
      "  const undrawn = rowFor('motor.friction.phi');",
      "  return 'drawn=' + drawn.classList.contains('is-shown')",
      "    + ' undrawnRow=' + style(undrawn).opacity",
      "    + ' undrawnName=' + style(name(undrawn)).opacity",
      "    + ' undrawnUnit=' + style(unit(undrawn)).opacity",
      "    + ' drawnName=' + style(name(drawn)).opacity",
      "    + ' drawnUnit=' + style(unit(drawn)).opacity",
      "    + ' sameUnitColour=' + (style(unit(undrawn)).color === style(unit(drawn)).color)",
      "    + ' unitColour=' + style(unit(undrawn)).color;",
      "});",
      "window.test('an exponent is a real superscript, sized by us', () => {",
      "  // It was a Unicode glyph: 5px of ink at 11px, and no stylesheet could grow it without",
      "  // growing the unit's letters. A `<sup>` at 0.85em, weight 500, is a digit with strokes.",
      // The absurd unit the fixture gives `der(motor.phiMechanical)` is the useful case: three
      // exponents, one of them negative.
      "  const span = rowFor('der(motor.phiMechanical)').querySelector('.modelica-studio-series-unit');",
      "  const sups = Array.from(span.querySelectorAll('sup.modelica-studio-run-sup'));",
      "  const style = sups.length ? getComputedStyle(sups[0]) : null;",
      "  return 'flat=' + span.getAttribute('data-unit')",
      "    + ' text=' + span.textContent",
      "    + ' sups=' + sups.map((x) => x.textContent).join('|')",
      "    + ' base=' + getComputedStyle(span).fontSize",
      "    + ' sup=' + (style ? style.fontSize : 'NONE')",
      "    + ' weight=' + (style ? style.fontWeight : '')",
      "    + ' raised=' + (style ? parseFloat(style.verticalAlign) > 0 : '');",
      "});",
      "window.test('rows sharing a unit are marked when one is pointed at', () => {",
      "  const list = body.querySelector('.modelica-studio-series');",
      "  const marked = () => Array.from(body.querySelectorAll('.modelica-studio-series-unit.is-same-unit'))",
      "    .map((s) => s.getAttribute('data-unit'));",
      "  const withUnit = (unit) => Array.from(body.querySelectorAll('.modelica-studio-series-unit'))",
      "    .filter((s) => s.getAttribute('data-unit') === unit).length;",
      "  const target = rowFor('motor.la.v').querySelector('.modelica-studio-series-unit');",
      "  const before = marked().length;",
      "  target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));",
      "  const after = marked().length;",
      "  const colour = getComputedStyle(target).color;",
      "  list.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));",
      "  return 'before=' + before + ' after=' + after + ' expected=' + withUnit('V')",
      "    + ' colour=' + colour + ' cleared=' + marked().length;",
      "});",
      "window.test('and the same happens from the keyboard', () => {",
      "  const list = body.querySelector('.modelica-studio-series');",
      "  const box = rowFor('motor.la.v').querySelector('input');",
      "  box.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));",
      "  const marked = body.querySelectorAll('.modelica-studio-series-unit.is-same-unit').length;",
      "  box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));",
      "  return 'marked=' + marked + ' cleared=' + body.querySelectorAll('.modelica-studio-series-unit.is-same-unit').length;",
      "});",
      "window.test('a variable with no unit gets no unit', () =>",
      "  'bare=' + (bareRow.querySelector('.modelica-studio-series-unit') ? 'SHOWN' : 'absent')",
      "    + ' name=' + bareRow.dataset.name);",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));

  assert.equal(
    d["every row says what its numbers are in"],
    "T=K title=Unit: K phi=Wb title=Unit: Wb v=V title=Unit: V",
    "the unit sits on the row, where the variable is, not in a legend"
  );
  assert.equal(
    d["a derivative is read as a reader writes it, and kept whole on the row"],
    // The unit's text is the FLAT spelling now — `km2·s-4·A-1·g` — because the exponents are
    // `<sup>` elements rather than glyphs. It is what the element's text amounts to, what a
    // copy takes away, and what `data-unit` matches on; the raised form is what is drawn.
    "shown=km2·s-4·A-1·g title=Unit: km2·s-4·A-1·g exact=[km2.s-4.A-1.g]",
    "the row is readable and the tooltip still carries the compiler's own string"
  );
  assert.equal(
    d["the row also carries what the variable is"],
    'title="motor.friction.heatPort.T\\nTemperature of the winding\\n[K]"',
    "the full name, the library's comment and the unit, for a reader who needs them"
  );
  assert.equal(
    d["a unit is legible even on a row that is not drawn"],
    "drawn=true undrawnRow=1 undrawnName=0.62 undrawnUnit=1 drawnName=1 drawnUnit=1 sameUnitColour=true unitColour=rgb(170, 170, 170)",
    "the row dims through its parts, the unit is exempt, and it uses the muted token the theme defines"
  );
  assert.equal(
    d["an exponent is a real superscript, sized by us"],
    "flat=km2·s-4·A-1·g text=km2·s-4·A-1·g sups=2|-4|-1 base=11px sup=9.35px weight=500 raised=true",
    "the unit joins back into the compiler's spelling, and the exponent is ours to size"
  );
  assert.equal(
    d["rows sharing a unit are marked when one is pointed at"],
    "before=0 after=4 expected=4 colour=rgb(139, 108, 239) cleared=0",
    "pointing at a row marks the rows in the same unit, and leaving clears it"
  );
  assert.equal(
    d["and the same happens from the keyboard"],
    "marked=4 cleared=0",
    "the same question is asked by tabbing to a trace"
  );
  assert.equal(
    d["a variable with no unit gets no unit"],
    "bare=absent name=temperatureOfTheStatorWinding",
    "no empty bracket"
  );
});

test("the overlay lists the same traces as the panel, without the panel's window", async () => {
  // Reported as the two lists drifting apart: the overlay had its own flat
  // renderer, so the tree stopped at the panel. They are one list at two sizes —
  // the overlay is the window, so it takes all the rows rather than forty.
  const out = await runInDom(
    [
      HEAD,
      "const { view, body } = mount(40, 520, undefined, false);",
      "const host = document.createElement('div');",
      "document.body.appendChild(host);",
      "view.fullTraceList = host;",
      "view.renderFullTraceList();",
      "const count = (el, sel) => el.querySelectorAll(sel).length;",
      "const allGroups = ['motor', 'motor.friction', 'motor.friction.heatPort',", 
      "  'motor.ie', 'motor.inertiaStator', 'motor.internalThermalPort',",
      "  'motor.internalThermalPort.heatPortPermanentMagnet', 'motor.la'];",
      "",
      "window.test('the overlay is the same tree', () => {",
      "  return 'groups=' + count(host, '.modelica-studio-series-group')",
      "    + ' rows=' + count(host, '.modelica-studio-series-row')",
      "    + ' panelRows=' + count(body, '.modelica-studio-series-row');",
      "});",
      "window.test('and it is not capped at the panel\\'s forty', () => {",
      "  view.expandedGroups = new Set(allGroups);",
      "  view.renderFullTraceList();",
      "  return 'rows=' + count(host, '.modelica-studio-series-row')",
      "    + ' note=' + (host.querySelector('.modelica-studio-series-more') ? 'SHOWN' : 'absent');",
      "});",
      "window.test('opening a group in the panel opens it in the overlay', () => {",
      "  view.expandedGroups = new Set(['motor']);",
      "  view.renderFullTraceList();",
      "  const before = count(host, '.modelica-studio-series-row');",
      "  view.toggleGroup('motor.friction', true);",
      "  const after = count(host, '.modelica-studio-series-row');",
      "  const panel = count(body, '.modelica-studio-series-row');",
      "  return 'before=' + before + ' after=' + after + ' panel=' + panel + ' same=' + (after === panel);",
      "});",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));

  assert.equal(
    d["the overlay is the same tree"],
    "groups=7 rows=16 panelRows=16",
    "the same rows in both, because it is the same renderer"
  );
  assert.equal(
    d["and it is not capped at the panel's forty"],
    "rows=40 note=absent",
    "forty rows with no line about a window: the overlay has the room"
  );
  assert.equal(
    d["opening a group in the panel opens it in the overlay"],
    "before=4 after=16 panel=16 same=true",
    "one state, so the two lists cannot disagree"
  );
});

test("clearing the traces reaches the note's copy of the chart", async () => {
  // The per-model chart state is what every embedded block of this model draws
  // from, and it was written from some of the paths that change it and not others.
  // "Clear traces" hid them on screen and left the block beside it drawing them.
  const out = await runInDom(
    [
      HEAD,
      "const { view, body } = mount(6);",
      // The REAL publishChart, with the plugin's own publish recorded: the point is
      // what reaches the shared state, not that a call happened.
      "const published = [];",
      "view.publishChart = ModelicaStudioView.prototype.publishChart.bind(view);",
      "view.plugin.publishChart = () => published.push('published');",
      // Two traces on, as they are after a run: `mount` seeds no visibility, and a
      // chart with nothing in it cannot show that clearing reached the blocks.
      "for (const s of view.result.series.slice(0, 2)) view.seriesStyles[s.name] = { visible: true, color: '#3b6ea5' };",
      "view.renderInspector();",
      "view.publishChart();",
      "const before = (view.plugin.settings.charts['Motor'] || {}).traces;",
      "published.length = 0;",
      "const button = Array.from(body.querySelectorAll('button')).find((b) => b.textContent === 'Clear traces');",
      "button.click();",
      "await new Promise((r) => setTimeout(r, 0));",
      "const chart = view.plugin.settings.charts['Motor'] || {};",
      "window.test('the shared chart is written', () =>",
      "  JSON.stringify({ before: before === undefined ? 'absent' : before.length,",
      "    after: (chart.traces || []).length, published: published.length,",
      "    drawn: view.result.series.filter((s) => view.seriesStyles[s.name] && view.seriesStyles[s.name].visible).length }));",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const state = JSON.parse(out.results[0].detail);

  assert.equal(state.drawn, 0, "nothing is drawn any more");
  assert.equal(state.after, 0, "and the shared chart says so");
  assert.equal(state.published, 1, "which was published to the blocks");
  assert.ok(state.before > 0, "with traces there to clear in the first place");
});
