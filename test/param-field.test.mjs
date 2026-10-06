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
  "const Q = JSON.stringify;",
  "const TYPES = {",
  "  'Modelica.Units.SI.Voltage': { qualifiedName: 'Modelica.Units.SI.Voltage', aliasOf: 'ElectricPotential' },",
  "  'Modelica.Units.SI.ElectricPotential': { qualifiedName: 'Modelica.Units.SI.ElectricPotential',",
  "    aliasOf: 'Real', aliasModifiers: { unit: Q('V') } },",
  "  'Modelica.Units.SI.Temperature': { qualifiedName: 'Modelica.Units.SI.Temperature',",
  "    aliasOf: 'Real', aliasModifiers: { unit: Q('K'), displayUnit: Q('degC') } },",
  "  'Modelica.Units.SI.LinearTemperatureCoefficient': {",
  "    qualifiedName: 'Modelica.Units.SI.LinearTemperatureCoefficient',",
  "    aliasOf: 'Real', aliasModifiers: { unit: Q('1/K') } },",
  "};",
  "",
  "/** A component with a unit-bearing parameter, mounted at the rail's own width. */",
  "function mount(declaredUnits, width) {",
  "  const def = {",
  "    name: 'M.StepVoltage', shortName: 'StepVoltage', comment: '', ports: [],",
  "    parameters: [",
  "      { name: 'offset', type: 'Modelica.Units.SI.Voltage', defaultValue: '0' },",
  "      { name: 'V', type: 'Modelica.Units.SI.Voltage', defaultValue: '1' },",
  "      { name: 'useSupport', type: 'Boolean', defaultValue: 'false' },",
  "      { name: 'alpha', type: 'Modelica.Units.SI.LinearTemperatureCoefficient', defaultValue: '0' },",
  "    ],",
  "  };",
  "  const inst = { id: 'source', className: def.name,",
  "    placement: { extent: [-10, -10, 10, 10], rotation: 0, visible: true }, params: {} };",
  "  const plugin = {",
  "    settings: {},",
  "    saveSettings: async () => {},",
  "    library: { component: () => def, lookup: (name, from) => {",
  "      // The library's own type chain, as MSL declares it: the unit is three classes down and",
  "      // nothing in the parameter's declaration mentions it.",
  "      if (TYPES[name]) return TYPES[name];",
  "      if (from) { const parts = from.split('.');",
  "        for (let i = parts.length; i > 0; i--) {",
  "          const c = parts.slice(0, i).join('.') + '.' + name;",
  "          if (TYPES[c]) return TYPES[c]; } }",
  "      return undefined;",
  "    } },",
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
  "window.test('a unit with no alternatives is the same box, without a dropdown', () => {",
  "  // Reported from a screenshot of a HeatCapacitor: `C J/K` printed the unit in the label while",
  "  // every field whose unit had alternatives put it in a box on the right, so one panel looked",
  "  // like two. The unit is a control either way; this one just has nothing to open.",
  "  const width = 380;",
  "  const own = mount(UNITS, width).host;",
  "  const field = Array.from(own.querySelectorAll('.modelica-studio-field'))",
  "    .find((f) => f.querySelector('label').textContent.startsWith('alpha'));",
  "  const chip = field.querySelector('.modelica-studio-param-unit.is-fixed');",
  "  const pickerField = Array.from(own.querySelectorAll('.modelica-studio-field'))",
  "    .find((f) => f.querySelector('label').textContent.startsWith('V'));",
  "  const picker = pickerField.querySelector('select.modelica-studio-param-unit');",
  "  const input = field.querySelector('input');",
  "  return 'inLabel=' + (field.querySelector('label .modelica-studio-field-unit') !== null)",
  "    + ' chip=' + (chip ? chip.textContent : 'NONE')",
  "    + ' tag=' + (chip ? chip.tagName : '-')",
  "    + ' chipH=' + (chip ? Math.round(chip.getBoundingClientRect().height) : 0)",
  "    + ' pickerH=' + Math.round(picker.getBoundingClientRect().height)",
  "    + ' inputH=' + Math.round(input.getBoundingClientRect().height);",
  "});",
  "window.test('with no run yet, the unit still comes from the type chain', () => {",
  "  // The reported complaint: open a component and there is no unit picker, because the unit",
  "  // came from the compiler's model description, which only a BUILD writes, and no run had",
  "  // happened. The library states it too, three short class definitions down.",
  "  const fresh = mount(undefined, 380);",
  "  return Array.from(fresh.host.querySelectorAll('.modelica-studio-field')).map((f) => {",
  "    const picker = f.querySelector('select.modelica-studio-param-unit');",
  "    const span = f.querySelector('.modelica-studio-field-unit');",
  "    return f.querySelector('label').textContent + '='",
  "      + (picker ? picker.options[0].value + '/' + picker.value",
  "                 : (span ? 'chip:' + span.textContent : 'nothing'));",
  "  }).join(' ');",
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
    d["a unit with no alternatives is the same box, without a dropdown"],
    "inLabel=false chip=1/K tag=SPAN chipH=30 pickerH=30 inputH=30",
    "the unit is a box beside the value, the same height as the picker and the input"
  );
  assert.equal(
    d["with no run yet, the unit still comes from the type chain"],
    "Instance name=nothing offset=V/V V=V/V useSupport=nothing alpha=chip:1/K",
    "no model description, and the picker is still there from the library's type chain"
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
