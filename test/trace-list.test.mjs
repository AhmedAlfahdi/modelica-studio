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
  "function makeResult(n) {",
  "  const names = ['motor.friction.heatPort.T', 'motor.friction.phi', 'motor.friction.tau',",
  "    'motor.friction.w', 'motor.ie.v', 'motor.inertiaStator.a', 'motor.inertiaStator.w',",
  "    'motor.internalThermalPort.heatPortPermanentMagnet.Q_flow', 'motor.la.v', 'motor.phiMechanical'];",
  "  const series = [];",
  "  for (let i = 0; i < n; i++) {",
  "    series.push({ name: names[i % names.length] + (i >= names.length ? '_' + i : ''), values: [0, 1, 2, 3, 4], unit: '' });",
  "  }",
  "  return { time: [0, 5, 10, 15, 20], series, warnings: [], compileMs: 0, simulateMs: 81, reusedBinary: true };",
  "}",
  "",
  "/** The Traces tab as the view builds it: tabs, body, and the real renderer. */",
  "function mount(n) {",
  "  const pane = document.createElement('div');",
  "  pane.className = 'modelica-studio-col modelica-studio-inspector';",
  "  pane.style.width = '380px';",
  "  pane.style.height = '520px';",
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
  "  view.publishChart = () => {};",
  "  view.adoptResult(makeResult(n));",
  "  view.renderInspector();",
  "  return { view, pane, body };",
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
      "const gap = Math.round(smallList.getBoundingClientRect().top - smallFilter.getBoundingClientRect().bottom);",
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
  // 8px from the list plus the filter's own 4: an input is inline-block, so its
  // margin does not collapse with the block below it. It was 4px in total.
  assert.match(d["there is a real gap between the filter and the list"], /gap=12/, "a real gap, not 4px");
  assert.match(d["the list still scrolls rather than growing without limit"], /maxHeight=190px/);
  assert.match(d["the list still scrolls rather than growing without limit"], /scrollable=true/);
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
    "text=Showing the first 40 of 173 — type to narrow the list. insideList=false aboveList=true rows=40"
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
