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
import { PLUGIN_CSS, THEME_CSS } from "./helpers/theme-css.mjs";

const ROOT = repoRoot;

const HEAD = [
  DOM_PREAMBLE,
  `import { ModelicaStudioView } from "${ROOT}/src/view/studio-view";`,
  "",
  "const style = document.createElement('style');",
  `style.textContent = ${JSON.stringify(THEME_CSS + PLUGIN_CSS)};`,
  "document.head.appendChild(style);",
  "document.body.classList.add('theme-dark');",
  "",
  "/** A result with `n` variables, named as a real motor model names them. */",
  "function makeResult(n, longName, extras) {",
  "  const names = ['motor.friction.heatPort.T', 'motor.friction.phi', 'motor.friction.tau',",
  "    'motor.friction.w', 'motor.ie.v', 'motor.inertiaStator.a', 'motor.inertiaStator.w',",
  "    'motor.internalThermalPort.heatPortPermanentMagnet.Q_flow', 'motor.la.v', 'motor.phiMechanical'];",
  "  const series = [];",
  "  for (let i = 0; i < n; i++) {",
  "    const name = i === 0 && longName ? longName : names[i % names.length] + (i >= names.length ? '_' + i : '');",
  "    series.push({ name, values: [0, 1, 2, 3, 4], unit: '' });",
  "  }",
  "  // A constant and a derivative, so the Varying and Derivatives presets have",
  "  // something to exclude and something to keep. Left out when a test needs a",
  "  // result with neither.",
  "  if (extras !== false) {",
  "    series.push({ name: 'motor.R_s', values: [287, 287, 287, 287, 287], unit: '' });",
  "    series.push({ name: 'der(motor.phiMechanical)', values: [0, 1, 2, 3, 4], unit: '' });",
  "  }",
  "  return { time: [0, 5, 10, 15, 20], series, warnings: [], compileMs: 0, simulateMs: 81, reusedBinary: true };",
  "}",
  "",
  "/** The Traces tab as the view builds it: tabs, body, and the real renderer. */",
  "function mount(n, height, longName, extras) {",
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
  "    settings: { labelScale: 1, hoverParameters: true, charts: {} },",
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
  "  view.publishChart = () => {};",
  "  view.adoptResult(makeResult(n, longName, extras));",
  "  view.renderInspector();",
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
      "const { pane, body } = mount(173);",
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
      "const { pane, body } = mount(173);",
      "const list = body.querySelector('.modelica-studio-series');",
      "const short = mount(173, 200);",
      "const shortList = short.body.querySelector('.modelica-studio-series');",
      "// One name long enough that it cannot fit, as a derivative of a deeply",
      "// nested variable is: it must be ellipsised, not left to stretch the row.",
      "const long = mount(20, 520, 'der(' + Array(12).fill('motor.internalThermalPort').join('.') + '.Q_flow)');",
      "const longList = long.body.querySelector('.modelica-studio-series');",
      "const longName = longList.querySelector('.modelica-studio-series-name');",
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
      "    'longListX=' + longList.scrollWidth + ':' + longList.clientWidth,",
      "    'longNameWidth=' + Math.round(longName.getBoundingClientRect().width) + ':' + longList.clientWidth,",
      "    'shortHeight=' + Math.round(sl.height),",
      "    'shortRows=' + shortList.querySelectorAll('.modelica-studio-series-row').length,",
      "  ].join(' ');",
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
  // and giving the list a sideways scrollbar.
  assert.match(g, /longNameEllipsised=true/, "an over-long name is ellipsised, not cut off");
  assert.match(g, /longListX=(\d+):\1/, "and it does not widen the list");
  const [nameW, listW] = g.match(/longNameWidth=(\d+):(\d+)/).slice(1).map(Number);
  assert.ok(nameW < listW, `the name fits the column: ${nameW} < ${listW}`);
  // A pane too short for the content keeps the box usable.
  assert.ok(num("shortHeight") >= 100, `a floor of about six rows, got ${num("shortHeight")}`);
  assert.ok(num("shortRows") > 0, "with rows in it");

  assert.equal(
    out.results[1].detail,
    "traces=flex/auto selection=block/visible",
    "the fill applies to the Traces tab only"
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
      "const { body } = mount(173);",
      "// Two traces drawn, the way a reader picks them.",
      "const rows = body.querySelectorAll('.modelica-studio-series-row');",
      "check(rows[1]);",
      "check(rows[2]);",
      "",
      "const pills = () => Array.from(body.querySelectorAll('.modelica-studio-preset'));",
      "const names = () => Array.from(body.querySelectorAll('.modelica-studio-series-name')).map((n) => n.textContent);",
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
      "const { body } = mount(173);",
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
      "const { body } = mount(173);",
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
      "  const names = Array.from(next.querySelectorAll('.modelica-studio-series-name')).map((n) => n.textContent);",
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
