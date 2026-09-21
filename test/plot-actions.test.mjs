/**
 * The results bar, rendered.
 *
 * This is the surface that kept being reported wrong — the legend, the deltas,
 * the scale panel, the divider that borrowed the pane grip's class, the dropdown
 * that lost its arrow, two fields drawn by two stylesheets — and every one of
 * those was diagnosed from a screenshot, because the row was 140 lines of closures
 * inside a 4,400-line view and no test could build it.
 *
 * It is now a module, so this renders it in a real DOM with the REAL `styles.css`
 * inlined, and asserts what the browser computes. Two of the assertions below are
 * about the cascade rather than the markup: a rule that loses to the theme looks
 * perfect in the source and wrong on screen.
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
 * The theme rules this bar competes with, copied from the app's own `app.css`.
 *
 * Only the parts that decide this row: the `select`/`.dropdown` block (which is
 * where the chevron lives, and why a bare `select` has none), and the
 * `input[type='text']` block (which outranks a lone class and is why the two
 * fields were drawn differently). `--input-*` and `--dropdown-*` are given the
 * values the default dark theme gives them.
 */
const THEME = `
:root {
  --input-height: 30px;
  --input-padding: 4px 8px;
  --input-radius: 6px;
  --input-shadow: inset 0 0 0 1px rgba(255,255,255,0.05), 0 1px 2px rgba(0,0,0,0.2);
  --font-ui-small: 13px;
  --background-modifier-form-field: #1a1a1a;
  --interactive-normal: #2a2a2a;
  --interactive-hover: #333333;
  --interactive-accent: #7b6cd9;
  --background-primary: #1e1e1e;
  --background-secondary: #262626;
  --background-modifier-border: #333333;
  --background-modifier-border-hover: #444444;
  --background-modifier-hover: rgba(255,255,255,0.06);
  --text-normal: #dcddde;
  --text-muted: #aaaaaa;
  --text-faint: #666666;
  --text-on-accent: #ffffff;
  --radius-s: 4px;
}
/* app.css: every select loses its native arrow here. */
select, .dropdown {
  height: var(--input-height);
  font-size: var(--font-ui-small);
  color: var(--text-normal);
  box-sizing: border-box;
  border: 0;
  box-shadow: var(--input-shadow);
  border-radius: var(--input-radius);
  -webkit-appearance: none;
  appearance: none;
  background-color: var(--interactive-normal);
  padding: var(--input-padding);
}
/* app.css: and the chevron is drawn HERE, on .dropdown alone. */
.dropdown {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23FFF' stroke-width='2'%3E%3Cpath d='m7 15 5 5 5-5'/%3E%3Cpath d='m7 9 5-5 5 5'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 4px center;
  background-size: 15px auto;
}
/* app.css: input[type='text'] is (0,1,1) and beats a lone class. */
input[type='text'] {
  background: var(--background-modifier-form-field);
  border: 1px solid var(--background-modifier-border);
  color: var(--text-normal);
  padding: var(--input-padding);
  font-size: var(--font-ui-small);
  border-radius: var(--input-radius);
  height: var(--input-height);
}
`;

const HEAD = [
  DOM_PREAMBLE,
  `import { buildPlotActions } from "${ROOT}/src/view/plot-actions";`,
  `import { Menu } from "${ROOT}/test/helpers/obsidian-stub";`,
  "",
  "const style = document.createElement('style');",
  `style.textContent = ${JSON.stringify(THEME + CSS)};`,
  "document.head.appendChild(style);",
  "document.body.classList.add('theme-dark');",
  "",
  "/** A host that records what the row asks it to do. */",
  "function makeHost(over) {",
  "  const calls = [];",
  "  const host = {",
  "    calls,",
  "    stopTime: () => 20,",
  "    applyStopTime: (s) => calls.push('applyStopTime:' + s),",
  "    hasResult: () => true,",
  "    sweepParameters: () => ['drag.tau_nominal', 'e'],",
  "    // Stateful, because the row reads the field back before changing one half of it.",
  "    sweepField: () => host.field || { parameter: 'drag.tau_nominal', values: '' },",
  "    setSweepField: (f) => { host.field = f; calls.push('setSweepField:' + f.parameter + '=' + f.values); },",
  "    familyCount: () => 2,",
  "    deltasOn: () => true,",
  "    toggleScalePanel: () => calls.push('toggleScalePanel'),",
  "    openFullScreen: () => calls.push('openFullScreen'),",
  "    autoScale: () => calls.push('autoScale'),",
  "    toggleDeltas: () => calls.push('toggleDeltas'),",
  "    runSweep: (p, v) => calls.push('runSweep:' + p + '/' + v),",
  "    keepAsBefore: () => calls.push('keepAsBefore'),",
  "    copyFigure: () => calls.push('copyFigure'),",
  "    saveFigure: () => calls.push('saveFigure'),",
  "    clearFamily: () => calls.push('clearFamily'),",
  "  };",
  "  Object.assign(host, over || {});",
  "  return host;",
  "}",
  "",
  "/** Build the row and return it with the host that drove it. */",
  "function row(over) {",
  "  const host = makeHost(over);",
  "  const parent = document.createElement('div');",
  "  parent.className = 'modelica-studio-plotbar-actions';",
  "  document.body.appendChild(parent);",
  "  buildPlotActions(parent, host);",
  "  return { host, parent };",
  "}",
  "",
  "/** A click that a listener will believe came from a pointer. */",
  "function click(el) {",
  "  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));",
  "}",
  "",
  "function type(el, value) {",
  "  el.value = value;",
  "  el.dispatchEvent(new Event('input', { bubbles: true }));",
  "}",
  "",
].join("\n");

test("the results bar renders one action, one box per subject, and no stray rules", async () => {
  const out = await runInDom(
    [
      HEAD,
      "const r = row();",
      "const parent = r.parent;",
      "",
      "window.test('the accent action is the one that runs the sweep', () => {",
      "  const accented = Array.from(parent.querySelectorAll('.modelica-studio-btn.mod-cta')).map((b) => b.textContent);",
      "  return accented.join(',') || 'NONE ACCENTED';",
      "});",
      "window.test('the three view controls share one box', () => {",
      "  const groups = Array.from(parent.querySelectorAll('.modelica-studio-group'));",
      "  const seg = groups.find((g) => g.classList.contains('is-segmented'));",
      "  if (!seg) return 'NO SEGMENTED GROUP';",
      "  const btns = Array.from(seg.querySelectorAll('button')).map((b) => b.textContent);",
      "  const radii = Array.from(seg.querySelectorAll('button')).map((b) => getComputedStyle(b).borderTopLeftRadius);",
      "  return btns.join('|') + ' radii=' + radii.join(',');",
      "});",
      "window.test('the delta toggle is inside the group it belongs to', () => {",
      "  const toggle = Array.from(parent.querySelectorAll('button')).find((b) => b.textContent === 'Δ vs');",
      "  if (!toggle) return 'NO TOGGLE';",
      "  const group = toggle.closest('.modelica-studio-family');",
      "  return 'inFamily=' + !!group + ' pressed=' + toggle.getAttribute('aria-pressed') + ' label=' + (toggle.getAttribute('aria-label') || '').slice(0, 24);",
      "});",
      "window.test('a toggle is filled, not ringed', () => {",
      "  const toggle = Array.from(parent.querySelectorAll('button')).find((b) => b.textContent === 'Δ vs');",
      "  const s = getComputedStyle(toggle);",
      "  return 'border=' + s.borderTopColor + ' colour=' + s.color + ' bg=' + s.backgroundColor;",
      "});",
      "window.test('nothing is separated by a rule any more', () => {",
      "  return parent.querySelectorAll('.modelica-studio-group-sep').length + ' separators';",
      "});",
      "window.test('the figure actions are one quiet menu, not a box of buttons', () => {",
      "  const b = parent.querySelector('.modelica-studio-btn.is-quiet');",
      "  if (!b) return 'NO FIGURE BUTTON';",
      "  const s = getComputedStyle(b);",
      "  return 'icon=' + b.getAttribute('data-icon') + ' aria=' + b.getAttribute('aria-label')",
      "    + ' title=' + b.getAttribute('title') + ' border=' + s.borderTopColor + ' colour=' + s.color",
      "    + ' boxed=' + !!b.closest('.modelica-studio-group');",
      "});",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));

  assert.equal(d["the accent action is the one that runs the sweep"], "Sweep");
  assert.equal(
    d["the three view controls share one box"],
    "Scale|Full screen|Auto scale radii=4px,0px,0px",
    "one box, with the ends rounded and the shared edges square"
  );
  assert.match(d["the delta toggle is inside the group it belongs to"], /inFamily=true/);
  assert.match(d["the delta toggle is inside the group it belongs to"], /pressed=true/);
  assert.match(
    d["a toggle is filled, not ringed"],
    /colour=rgb\(123, 108, 217\)/,
    "the accent is in the glyph, not around the button"
  );
  assert.match(d["a toggle is filled, not ringed"], /border=rgba\(0, 0, 0, 0\)/, "and NOT a ring");
  assert.equal(d["nothing is separated by a rule any more"], "0 separators");
  const figures = d["the figure actions are one quiet menu, not a box of buttons"];
  assert.match(figures, /^icon=more-horizontal/);
  assert.match(figures, /aria=Copy or save the plot as a picture/);
  assert.match(figures, /title=null/, "the tooltip comes from aria-label alone, never a second mechanism");
  assert.match(figures, /border=rgba\(0, 0, 0, 0\)/, "and it is quiet");
  assert.match(
    figures,
    /boxed=false/,
    "a lone icon button needs no box, and the box was what wrapped it onto its own line"
  );
});

test("the two sweep fields are drawn by one rule, and the arrow is drawn", async () => {
  // Both of these were reported from screenshots, and both are cascade problems
  // that look correct in the source: `.modelica-studio-family-values` is a class
  // and loses to the theme's `input[type='text']`, and the chevron lives on a
  // class this row had dropped. Computed styles, not markup, are what catch them.
  const out = await runInDom(
    [
      HEAD,
      "const r = row();",
      "const param = r.parent.querySelector('select.modelica-studio-family-param');",
      "const values = r.parent.querySelector('input.modelica-studio-family-values');",
      "",
      "window.test('the theme cannot reach either field', () => {",
      "  const a = getComputedStyle(param);",
      "  const b = getComputedStyle(values);",
      "  return 'padL ' + a.paddingLeft + '/' + b.paddingLeft",
      "    + ' padR ' + a.paddingRight + '/' + b.paddingRight",
      "    + ' bg ' + a.backgroundColor + '/' + b.backgroundColor",
      "    + ' border ' + a.borderTopWidth + '/' + b.borderTopWidth",
      "    + ' height ' + a.height + '/' + b.height;",
      "});",
      "window.test('the select still says it opens', () => {",
      "  const s = getComputedStyle(param);",
      "  return 'arrow=' + /svg/.test(s.backgroundImage) + ' size=' + s.backgroundSize + ' shadow=' + s.boxShadow;",
      "});",
      "window.test('the hint is a hint, not content', () => {",
      "  const hint = getComputedStyle(values, '::placeholder').color;",
      "  const typed = getComputedStyle(values).color;",
      "  return 'hint=' + hint + ' typed=' + typed + ' text=' + values.getAttribute('placeholder');",
      "});",
      "window.test('the stop-time field is sized to its number', () => {",
      "  const t = r.parent.querySelector('.modelica-studio-time-input');",
      "  const s = getComputedStyle(t);",
      "  return 'width=' + s.width + ' align=' + s.textAlign + ' aria=' + t.getAttribute('aria-label');",
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
    d["the theme cannot reach either field"],
    "padL 7px/7px padR 22px/7px bg rgb(30, 30, 30)/rgb(30, 30, 30) border 1px/1px height 26px/26px",
    "the same rule draws both, and only the arrow's side differs"
  );
  assert.match(d["the select still says it opens"], /arrow=true/, "the chevron is painted");
  assert.match(d["the select still says it opens"], /shadow=none/, "with no theme inset fighting the height");
  assert.match(
    d["the hint is a hint, not content"],
    /hint=rgb\(102, 102, 102\).*typed=rgb\(220, 221, 222\)/,
    "the hint is fainter than anything typed into it"
  );
  assert.match(d["the hint is a hint, not content"], /text=100, 200, 400/);
  assert.equal(
    d["the stop-time field is sized to its number"],
    "width=54px align=center aria=Simulation stop time in seconds"
  );
});

test("what the row's controls actually do", async () => {
  const out = await runInDom(
    [
      HEAD,
      "const r = row();",
      "const parent = r.parent;",
      "const btn = (t) => Array.from(parent.querySelectorAll('button')).find((b) => b.textContent === t);",
      "",
      "window.test('sweeping sends the parameter and the values that are on screen', () => {",
      "  type(parent.querySelector('input.modelica-studio-family-values'), '100, 200, 400');",
      "  const select = parent.querySelector('select.modelica-studio-family-param');",
      "  select.value = 'e';",
      "  select.dispatchEvent(new Event('change', { bubbles: true }));",
      "  click(btn('Sweep'));",
      "  return r.host.calls.join(' | ');",
      "});",
      "window.test('the other buttons reach their commands', () => {",
      "  r.host.calls.length = 0;",
      "  click(btn('Scale')); click(btn('Full screen')); click(btn('Auto scale'));",
      "  click(btn('Keep as before')); click(btn('Δ vs')); click(btn('Clear family'));",
      "  return r.host.calls.join(' | ');",
      "});",
      "window.test('the menu holds the two figure actions, and they work', () => {",
      "  Menu.all.length = 0;",
      "  r.host.calls.length = 0;",
      "  click(parent.querySelector('[data-icon=more-horizontal]'));",
      "  const menu = Menu.all[0];",
      "  if (!menu) return 'NO MENU';",
      "  const titles = menu.items.map((i) => i.title).join(',');",
      "  const copied = menu.click('Copy image');",
      "  const saved = menu.click('Save image');",
      "  return titles + ' copied=' + copied + ' saved=' + saved + ' calls=' + r.host.calls.join('+');",
      "});",
      "window.test('the stop time is re-run only when it is a usable number', () => {",
      "  r.host.calls.length = 0;",
      "  const t = parent.querySelector('.modelica-studio-time-input');",
      "  t.value = '0';",
      "  t.dispatchEvent(new Event('change'));",
      "  const afterBad = r.host.calls.length + '/' + t.value;",
      "  t.value = '35';",
      "  t.dispatchEvent(new Event('change'));",
      "  return 'bad=' + afterBad + ' good=' + r.host.calls.join(',');",
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
    d["sweeping sends the parameter and the values that are on screen"],
    "setSweepField:drag.tau_nominal=100, 200, 400 | setSweepField:e=100, 200, 400 | runSweep:e/100, 200, 400",
    "the field remembers what was asked, and the sweep gets it"
  );
  assert.equal(
    d["the other buttons reach their commands"],
    "toggleScalePanel | openFullScreen | autoScale | keepAsBefore | toggleDeltas | clearFamily"
  );
  assert.equal(
    d["the menu holds the two figure actions, and they work"],
    "Copy image,Save image… copied=true saved=true calls=copyFigure+saveFigure"
  );
  assert.equal(
    d["the stop time is re-run only when it is a usable number"],
    "bad=0/20 good=applyStopTime:35",
    "a refused value is put back, and a good one re-runs"
  );
});

test("with no result the row is only the question", async () => {
  // The groups act on a result; before one exists they would be buttons that do
  // nothing. The stop time is still the thing to set.
  const out = await runInDom(
    [
      HEAD,
      "const r = row({ hasResult: () => false });",
      "window.test('only the stop time is there', () => {",
      "  const groups = r.parent.querySelectorAll('.modelica-studio-group').length;",
      "  const field = r.parent.querySelector('.modelica-studio-time-input');",
      "  return 'groups=' + groups + ' time=' + !!field + ' text=' + r.parent.textContent.replace(/\\s+/g, ' ').trim();",
      "});",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  assert.equal(out.results[0].detail, "groups=0 time=true text=t_ends", "nothing to act on, so nothing to press");
});

test("a model with nothing sweepable says so rather than offering a fake choice", async () => {
  const out = await runInDom(
    [
      HEAD,
      "const r = row({ sweepParameters: () => [], sweepField: () => ({ parameter: '', values: '' }) });",
      "window.test('the list is disabled and says why', () => {",
      "  const select = r.parent.querySelector('select.modelica-studio-family-param');",
      "  const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);",
      "  return 'disabled=' + select.disabled + ' options=' + options.join(',');",
      "});",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  assert.equal(out.results[0].detail, "disabled=true options=—");
});
