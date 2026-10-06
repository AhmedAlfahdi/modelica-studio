/**
 * The shape of a parameter field with a unit picker.
 *
 * Its own file because it needs the plugin's own stylesheet: `ui-render` mounts panels without
 * one, which is right for reading values back and useless for measuring a layout. Reported from
 * a screenshot: the field is a COLUMN flex container, and the picker's first rule set
 * `flex: 1 1 120px` on the input — a 120px HEIGHT, with the picker wrapped underneath it. The
 * assertions below are the ones that would have failed instead of shipping that.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runInDom, DOM_PREAMBLE } from "./helpers/dom-runner.mjs";
import { repoRoot } from "./helpers/build.mjs";
import { THEME_CSS, THEME_VARS, PLUGIN_CSS } from "./helpers/theme-css.mjs";

const ROOT = repoRoot;

const HEAD = [
  DOM_PREAMBLE,
  `import { ModelicaStudioView } from "${ROOT}/src/view/studio-view";`,
  "",
  "const style = document.createElement('style');",
  `style.textContent = ${JSON.stringify(THEME_VARS + THEME_CSS + PLUGIN_CSS)};`,
  "document.head.appendChild(style);",
  "document.body.classList.add('theme-dark');",
  "",
  "/** A component with a unit-bearing parameter, mounted at the rail's own width. */",
  "function mount(declaredUnits, width) {",
  "  const def = {",
  "    name: 'M.StepVoltage', shortName: 'StepVoltage', comment: '', ports: [],",
  "    parameters: [",
  "      { name: 'offset', type: 'Modelica.Units.SI.Voltage', defaultValue: '0' },",
  "      { name: 'V', type: 'Modelica.Units.SI.Voltage', defaultValue: '1' },",
  "      { name: 'useSupport', type: 'Boolean', defaultValue: 'false' },",
  "    ],",
  "  };",
  "  const inst = { id: 'source', className: def.name,",
  "    placement: { extent: [-10, -10, 10, 10], rotation: 0, visible: true }, params: {} };",
  "  const plugin = {",
  "    settings: {},",
  "    saveSettings: async () => {},",
  "    library: { component: () => def },",
  "    libraryRootNames: () => ['Modelica 4.1.0'],",
  "    app: { workspace: { getLeavesOfType: () => [] } },",
  "    model: { name: 'M', components: [inst], connections: [], graphics: [] },",
  "  };",
  "  const view = Object.create(ModelicaStudioView.prototype);",
  "  view.plugin = plugin;",
  "  view.editor = { selectedIds: ['source'], setParam: () => {}, requestDraw: () => {} };",
  "  view.runSimulation = () => {};",
  "  view.result = declaredUnits",
  "    ? { time: [], series: [], compileMs: 0, simulateMs: 0, reusedBinary: true, warnings: [], declaredUnits }",
  "    : null;",
  "  const host = document.createElement('div');",
  "  host.style.width = (width || 380) + 'px';",
  "  document.body.appendChild(host);",
  "  view.renderComponentTab(host, inst, ['source']);",
  "  return { view, host };",
  "}",
  "",
  "const UNITS = { 'source.offset': 'V', 'source.V': 'V' };",
  "const { host } = mount(UNITS);",
  "const fieldFor = (name) => Array.from(host.querySelectorAll('.modelica-studio-field'))",
  "  .find((f) => f.querySelector('label').textContent.startsWith(name));",
  "const rect = (el) => el.getBoundingClientRect();",
  "",
  "window.test('a field with alternatives is a label, then a value and its unit', () => {",
  "  const field = fieldFor('offset');",
  "  const label = rect(field.querySelector('label'));",
  "  const input = rect(field.querySelector('input'));",
  "  const picker = rect(field.querySelector('select'));",
  "  return [",
  "    'labelAbove=' + (label.bottom <= input.top + 1),",
  "    'beside=' + (picker.left >= input.right - 1),",
  "    'sameTop=' + (Math.abs(input.top - picker.top) < 4),",
  "    'inputH=' + Math.round(input.height),",
  "    'pickerH=' + Math.round(picker.height),",
  "  ].join(' ');",
  "});",
  "window.test('a field with no alternatives is unchanged', () => {",
  "  const field = fieldFor('useSupport');",
  "  // The Boolean control is a select too, so this asks for the unit picker by name.",
  "  return 'picker=' + (field.querySelector('select.modelica-studio-param-unit') !== null)",
  "    + ' pickerClass=' + field.classList.contains('has-unit-picker');",
  "});",
  "window.test('and the layout does not depend on how wide the rail is dragged', () => {",
  "  // `flex: 1 1 100%` let the label SHRINK instead of wrapping, so in a wide pane it shared the",
  "  // line with the input and the field stopped looking like every other field.",
  "  const wide = mount(UNITS, 900).host;",
  "  const field = Array.from(wide.querySelectorAll('.modelica-studio-field'))[0];",
  "  const label = rect(field.querySelector('label'));",
  "  const input = rect(field.querySelector('input'));",
  "  return 'labelAbove=' + (label.bottom <= input.top + 1) + ' inputH=' + Math.round(input.height);",
  "});",
  "window.finish();",
].join("\n");

test("a parameter field with a unit picker keeps its shape", async () => {
  const out = await runInDom(HEAD);
  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  const d = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);

  assert.equal(
    d["a field with alternatives is a label, then a value and its unit"],
    "labelAbove=true beside=true sameTop=true inputH=30 pickerH=30",
    "a control height, not the 120px a flex basis becomes in a column, with the picker on the same row"
  );
  assert.equal(
    d["a field with no alternatives is unchanged"],
    "picker=false pickerClass=false",
    "no alternatives means no picker, and the field is the one it always was"
  );
  assert.equal(
    d["and the layout does not depend on how wide the rail is dragged"],
    "labelAbove=true inputH=30",
    "the label takes its own line at any width, rather than shrinking onto the input's"
  );
});
