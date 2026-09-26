/**
 * The solver block, rendered.
 *
 * The panel is the whole user interface of the feature, so it is built and read
 * back in a real DOM rather than grepped for: what matters is the text a user
 * ends up looking at, and the three states they can be in — an answer, a block
 * that cannot be read, and a compiler that refused.
 *
 * The backend is a double. These tests are about what the panel does with a
 * result, not about producing one; that is `solve.test.mjs`, against the real
 * compiler.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runInDom, DOM_PREAMBLE } from "./helpers/dom-runner.mjs";

const ROOT = "/mnt/data/projects/Modelica-Plugin";

const HEAD = [
  DOM_PREAMBLE,
  `import { SolveBlock } from "${ROOT}/src/view/solve-block.ts";`,
  `import { SimulationError } from "${ROOT}/src/omc/backend.ts";`,
  "",
  "/** One macrotask, so the solve's continuation has run. */",
  "const tick = () => new Promise((r) => setTimeout(r, 0));",
  "",
  "/**",
  " * Wait for a selector, rather than assuming one macrotask is enough.",
  " *",
  " * It is enough on an idle machine and was not enough under a full parallel",
  " * run: three cases here read the panel after a fixed tick and failed only when",
  " * the suite ran every file at once. Polling for the thing being asserted costs",
  " * a few milliseconds and cannot depend on how busy the machine is.",
  " */",
  "async function waitFor(selector, host, tries = 300) {",
  "  for (let i = 0; i < tries; i++) {",
  "    const el = host.querySelector(selector);",
  "    if (el) return el;",
  "    await new Promise((r) => setTimeout(r, 10));",
  "  }",
  "  return { textContent: 'NOTHING APPEARED' };",
  "}",
  "",
  "/** The value once the solve has landed, which is not the pending placeholder. */",
  "const answer = (host) => waitFor('.modelica-studio-solve-value:not(.modelica-studio-solve-pending)', host);",
  "",
  "/** A backend that answers with a fixed result, or fails. */",
  "function fakeBackend(reply) {",
  "  return {",
  "    calls: [],",
  "    async simulate(opts) {",
  "      this.calls.push(opts);",
  "      if (reply && reply.throws) throw reply.throws;",
  "      return reply;",
  "    },",
  "  };",
  "}",
  "",
  "/** Mount a block into a fresh element and hand back the panel. */",
  "function mount(body, deps) {",
  "  const host = document.createElement('div');",
  "  document.body.appendChild(host);",
  "  const block = new SolveBlock(deps, host, body);",
  "  block.mount();",
  "  return { host, block };",
  "}",
  "",
].join("\n");

const page = (lines) => runInDom([HEAD, ...lines].join("\n"));

test("a solved block shows the value, the unit and the starting point", async () => {
  const out = page([
    "const backend = fakeBackend({ series: [{ name: 'x', values: [10.94040092099989] }] });",
    "const { host } = mount('sqrt(x) + x^2 - 56 = 67', { backend, report() {}, setupHelp() {} });",
    "window.test('the value is shown', async () => {",
    "  return (await answer(host)).textContent; });",
    "window.test('the symbol is named', async () => { await answer(host);",
    "  return host.querySelector('.modelica-studio-solve-name').textContent; });",
    "window.test('both decisions the plugin made are stated', async () => { await answer(host);",
    "  return host.querySelector('.modelica-studio-solve-note').textContent; });",
    "window.test('no unit is invented when the compiler reported none', async () => { await answer(host);",
    "  return String(host.querySelector('.modelica-studio-solve-unit')); });",
    "window.test('the solve is asked for zero simulated time', async () => { await tick();",
    "  return JSON.stringify(backend.calls.map((c) => c.stopTime)); });",
    "window.test('the generated model is what the compiler is given', async () => { await tick();",
    "  return backend.calls[0].source; });",
    "window.test('the block shows the equation it solved, not only the number', () =>",
    "  host.querySelector('.modelica-studio-solve-line').textContent);",
    "window.finish();",
  ]);
  if (out.skip) return;
  const d = passed(out);

  assert.equal(d["the value is shown"], "10.940400921", "twelve significant digits, no padding");
  assert.equal(d["the symbol is named"], "x");
  assert.equal(
    d["both decisions the plugin made are stated"],
    "solved for x, the only undefined symbol · nearest solution to x = 1",
    "which symbol was chosen, and where the search started"
  );
  assert.equal(d["no unit is invented when the compiler reported none"], "null");
  assert.equal(d["the solve is asked for zero simulated time"], "[0]", "stopTime 0 is the mechanism");
  assert.match(d["the generated model is what the compiler is given"], /sqrt\(x\) \+ x\^2 - 56 = 67;/);
  assert.equal(
    d["the block shows the equation it solved, not only the number"],
    "\\sqrt{x} + {x}^{2} - 56 = 67",
    "the question is part of the panel, and it is typeset"
  );
});

test("a unit reported by the compiler is displayed beside the value", async () => {
  const out = page([
    "const backend = fakeBackend({ series: [{ name: 'R', values: [200], unit: 'Ohm' }] });",
    "const { host } = mount('//@ solve R\\nv = 10;\\ni = 0.05;\\nR = v/i', { backend, report() {}, setupHelp() {} });",
    "window.test('the unit is shown', async () => {",
    "  return (await waitFor('.modelica-studio-solve-unit', host)).textContent; });",
    "window.test('and the value is not converted to it', async () => {",
    "  return (await answer(host)).textContent; });",
    "window.finish();",
  ]);
  if (out.skip) return;
  const d = passed(out);
  assert.equal(d["the unit is shown"], "Ohm");
  assert.equal(d["and the value is not converted to it"], "200");
});

test("a declared start value is not announced as the plugin's choice", async () => {
  const out = page([
    "const backend = fakeBackend({ series: [{ name: 'x', values: [-1.4142135623730951] }] });",
    "const { host } = mount('//@ solve x\\nReal x(start = -1);\\nx^2 = 2', { backend, report() {}, setupHelp() {} });",
    "window.test('no note is added', async () => { await answer(host);",
    "  return String(host.querySelector('.modelica-studio-solve-note')); });",
    "window.test('the negative root is what is shown', async () => {",
    "  return (await answer(host)).textContent; });",
    "window.finish();",
  ]);
  if (out.skip) return;
  const d = passed(out);
  assert.equal(d["no note is added"], "null", "the block said where to start, so nothing is claimed");
  assert.equal(d["the negative root is what is shown"], "-1.41421356237");
});

test("a system shows every equation and every answer", async () => {
  // The block solved all of it, so it reports all of it: answering a two-equation
  // system with one of its two unknowns leaves the reader to finish the job, which
  // is the work the block was supposed to take.
  const out = page([
    "const backend = fakeBackend({ series: [",
    "  { name: 'x', values: [3] },",
    "  { name: 'y', values: [1] },",
    "] });",
    "const { host } = mount('//@ solve x\\n2*x + y = 7;\\nx - y = 2', { backend, report() {}, setupHelp() {} });",
    "window.test('both equations are shown', () =>",
    "  Array.from(host.querySelectorAll('.modelica-studio-solve-line')).map((l) => l.textContent).join(' ; '));",
    "window.test('both answers are shown', async () => { await answer(host);",
    "  return Array.from(host.querySelectorAll('.modelica-studio-solve-row'))",
    "    .map((r) => r.querySelector('.modelica-studio-solve-name').textContent + ' = '",
    "      + r.querySelector('.modelica-studio-solve-value').textContent).join(' ; '); });",
    "window.test('the symbol the directive named comes first', async () => { await answer(host);",
    "  return host.querySelector('.modelica-studio-solve-name').textContent; });",
    "window.test('the equation is drawn above the answer it produced', async () => { await answer(host);",
    "  const panel = host.querySelector('.modelica-studio-solve');",
    "  return Array.from(panel.children).map((c) => c.className.replace('modelica-studio-solve-', '')).join(' then '); });",
    "window.finish();",
  ]);
  if (out.skip) return;
  const d = passed(out);
  assert.equal(d["both equations are shown"], "2 \\cdot x + y = 7 ; x - y = 2");
  assert.equal(d["both answers are shown"], "x = 3 ; y = 1");
  assert.equal(d["the symbol the directive named comes first"], "x");
  assert.equal(
    d["the equation is drawn above the answer it produced"],
    "question then outcome",
    "the panel is a column: the relationship, then what it came to"
  );
});

test("a parameter is shown above the equation it feeds", async () => {
  // Without the declaration the equation reads `... = target` and there is no way
  // to know what target is. The givens are part of the question.
  const out = page([
    "const backend = fakeBackend({ series: [{ name: 'x', values: [11.07573820708798] }] });",
    "const { host } = mount('//@ solve x\\nparameter Real target = 70;\\nsqrt(x) + x^2 - 56 = target', { backend, report() {}, setupHelp() {} });",
    "window.test('the given and the equation are both shown', () =>",
    "  Array.from(host.querySelectorAll('.modelica-studio-solve-line')).map((l) => l.textContent).join(' ; '));",
    "window.test('the given is marked as context rather than as the relationship', () =>",
    "  String(!!host.querySelector('.modelica-studio-solve-given')));",
    "window.finish();",
  ]);
  if (out.skip) return;
  const d = passed(out);
  assert.equal(
    d["the given and the equation are both shown"],
    "parameter Real target = 70 ; \\sqrt{x} + {x}^{2} - 56 = \\mathrm{target}",
    "the declaration stays source; the equation above the answer is typeset"
  );
  assert.equal(d["the given is marked as context rather than as the relationship"], "true");
});

test("the equation is typeset, and the LaTeX is the equation that was written", async () => {
  // The panel's copy of the equation is presentation only — the code block above it
  // is still the source — so a conversion here cannot lose anything. What matters is
  // that the right LaTeX is asked for.
  const out = page([
    "const backend = fakeBackend({ series: [{ name: 'x', values: [10.94040092099989] }] });",
    "const { host } = mount('sqrt(x) + x^2 - 56 = 67', { backend, report() {}, setupHelp() {} });",
    "window.test('maths was requested', () =>",
    "  String(!!host.querySelector('.modelica-studio-solve-typeset .math')));",
    "window.test('with the equation as LaTeX', () =>",
    "  host.querySelector('.math').getAttribute('data-latex'));",
    "window.test('and the source is not also shown', () => {",
    "  const line = host.querySelector('.modelica-studio-solve-typeset');",
    "  return String(line.textContent === line.querySelector('.math').textContent); });",
    "window.finish();",
  ]);
  if (out.skip) return;
  const d = passed(out);
  assert.equal(d["maths was requested"], "true");
  assert.equal(d["with the equation as LaTeX"], "\\sqrt{x} + {x}^{2} - 56 = 67");
  assert.equal(d["and the source is not also shown"], "true", "no duplicated equation");
});

test("an equation that cannot be typeset keeps its source", async () => {
  // A comprehension is refused by the converter, so it is shown as written —
  // `sum(sin((i - 0.5) * dx) * dx for i in 1:n)` rather than a mangled imitation.
  const out = page([
    "const backend = fakeBackend({ series: [{ name: 'y', values: [2.0000002] }] });",
    "const { host } = mount('//@ solve y\\nparameter Integer n = 2000;\\ny = sum(sin((i - 0.5) * dx) * dx for i in 1:n)',",
    "  { backend, report() {}, setupHelp() {} });",
    "window.test('no maths was requested for it', () =>",
    "  String(!!host.querySelector('.modelica-studio-solve-typeset')));",
    "window.test('the source is shown instead', () => {",
    "  const line = host.querySelector('.modelica-studio-solve-line:not(.modelica-studio-solve-given)');",
    "  return line.textContent; });",
    "window.test('the declaration above it is left as text too', () =>",
    "  host.querySelector('.modelica-studio-solve-given').textContent);",
    "window.finish();",
  ]);
  if (out.skip) return;
  const d = passed(out);
  assert.equal(d["no maths was requested for it"], "false");
  assert.equal(d["the source is shown instead"], "y = sum(sin((i - 0.5) * dx) * dx for i in 1:n)");
  assert.equal(d["the declaration above it is left as text too"], "parameter Integer n = 2000");
});

test("an ambiguous block explains the fix instead of guessing", async () => {
  const out = page([
    "const backend = fakeBackend({ series: [] });",
    "const { host } = mount('x + y = 5', { backend, report() {}, setupHelp() {} });",
    "window.test('the problem is shown', () =>",
    "  host.querySelector('.modelica-studio-solve-problem').textContent);",
    "window.test('nothing was solved', () => JSON.stringify(backend.calls.length));",
    "window.finish();",
  ]);
  if (out.skip) return;
  const d = passed(out);
  assert.match(d["the problem is shown"], /More than one symbol is undefined/);
  assert.match(d["the problem is shown"], /\/\/@ solve x/, "the message says how to fix it");
  assert.equal(d["nothing was solved"], "0", "a block it cannot read costs no compiler run");
});

test("a parameter named as the unknown is refused by name", async () => {
  const out = page([
    "const backend = fakeBackend({ series: [] });",
    "const { host } = mount('//@ solve k\\nparameter Real k = 5;\\nk = 10', { backend, report() {}, setupHelp() {} });",
    "window.test('the parameter is named in the message', () =>",
    "  host.querySelector('.modelica-studio-solve-problem').textContent);",
    "window.finish();",
  ]);
  if (out.skip) return;
  const d = passed(out);
  assert.match(d["the parameter is named in the message"], /`k` is a parameter/);
  assert.match(d["the parameter is named in the message"], /cannot be solved for/);
});

test("without a compiler the block offers the install help", async () => {
  const out = page([
    "let helped = 0;",
    "const { host } = mount('x^2 = 2', { backend: null, report() {}, setupHelp() { helped++; } });",
    "window.test('the reason is stated', () =>",
    "  host.querySelector('.modelica-studio-solve-problem').textContent);",
    "window.test('the button opens the help', () => {",
    "  host.querySelector('button').click();",
    "  return String(helped);",
    "});",
    "window.finish();",
  ]);
  if (out.skip) return;
  const d = passed(out);
  assert.match(d["the reason is stated"], /OpenModelica was not found/);
  assert.equal(d["the button opens the help"], "1", "the button is wired to the plugin's own help");
});

test("a refused solve shows the compiler's own words", async () => {
  const out = page([
    "const backend = fakeBackend({ throws: new SimulationError('translation failed', [",
    "  { severity: 'error', message: 'Too many equations, over-determined system' },",
    "  { severity: 'warning', message: 'something harmless' },",
    "]) });",
    "const { host } = mount('//@ solve x\\nx = 1;\\nx = 2', { backend, report() {}, setupHelp() {} });",
    "window.test('the error is shown', async () => {",
    "  return (await waitFor('.modelica-studio-solve-error-text', host)).textContent; });",
    "window.test('the error is marked as one, for colour and for screen readers', async () => {",
    "  await waitFor('.modelica-studio-solve-error', host);",
    "  return String(!!host.querySelector('.modelica-studio-solve-error')); });",
    "window.finish();",
  ]);
  if (out.skip) return;
  const d = passed(out);
  assert.equal(d["the error is shown"], "Too many equations, over-determined system");
  assert.equal(
    d["the error is marked as one, for colour and for screen readers"],
    "true",
    "warnings are not errors and are not shown as one"
  );
});

test("a destroyed block paints nothing from a solve that outlives it", async () => {
  // A solve outlives the element it belongs to whenever the note re-renders
  // mid-solve, which is normal while typing. The answer must land nowhere.
  const out = page([
    "const backend = fakeBackend({ series: [{ name: 'x', values: [2] }] });",
    "const { host, block } = mount('x^2 = 4', { backend, report() {}, setupHelp() {} });",
    "block.destroy();",
    "window.test('the panel is left as it was', async () => {",
    "  await new Promise((r) => setTimeout(r, 200));",
    "  return host.querySelector('.modelica-studio-solve-value').textContent; });",
    "window.finish();",
  ]);
  if (out.skip) return;
  const d = passed(out);
  assert.equal(d["the panel is left as it was"], "solving…", "the stale result is dropped, not painted");
});

function passed(out) {
  assert.ok(!out.fatal, out.fatal);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  return Object.fromEntries(out.results.map((r) => [r.name, r.detail]));
}
