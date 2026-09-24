/**
 * How the studio binds Ctrl/Cmd+S — the wiring itself, which is what was wrong.
 *
 * The first version added a DOM listener. Obsidian's own `editor:save-file` command
 * claims Mod+S at the application level and consumes the keystroke before any handler in
 * the page sees it, so pressing Ctrl+S in the studio did nothing at all, and no test
 * could tell: nothing in the suite could observe a keymap binding.
 *
 * The wiring is now a free function taking a scope and an element, so it can be tested
 * without an application — and the stub provides a faithful `Scope`, so the binding can
 * be triggered the way the application triggers it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runInDom, DOM_PREAMBLE } from "./helpers/dom-runner.mjs";
import { repoRoot } from "./helpers/build.mjs";

const ROOT = repoRoot;

const SETUP = [
  `import { wireSaveShortcut } from "${ROOT}/src/view/studio-view";`,
  `import { Scope } from "${ROOT}/test/helpers/obsidian-stub";`,
  "",
  "const calls = [];",
  "const save = () => calls.push('save');",
  "function mount() {",
  "  const root = document.body.createDiv();",
  "  const host = { scope: undefined, app: { scope: new Scope() } };",
  "  wireSaveShortcut(host, root, save);",
  "  return { root, host };",
  "}",
  "",
].join("\n");

test("the shortcut is registered in the view's scope, which is what the app honours", async () => {
  const out = await runInDom(
    [
      DOM_PREAMBLE,
      SETUP,
      "window.test('scope binding', () => {",
      "  const { host } = mount();",
      "  if (!host.scope) return 'NO SCOPE: a DOM listener alone is consumed by Obsidian';",
      "  const bindings = host.scope.bindings();",
      "  const declined = host.scope.trigger(['Ctrl'], 's') === false;",
      "  return 'bindings=' + bindings.join(',') + ' saves=' + calls.length + ' declined=' + declined;",
      "});",
      "window.finish();",
    ].join("\n")
  );
  assert.ok(!out.skip, `skipped: ${out.skip}`);
  assert.ok(!out.fatal, out.fatal);
  assert.deepEqual(out.errors, [], "no page errors");
  const [result] = out.results;
  assert.ok(result.ok, result.error);
  assert.equal(
    result.detail,
    "bindings=Mod+s saves=1 declined=true",
    "the scope owns Mod+S, firing it saves the model, and it declines the event so the core command does not also run"
  );
});

test("the DOM listener still works where the page does see the key", async () => {
  // The fallback matters for any host that does not claim the key; and it must not react
  // to anything else.
  const out = await runInDom(
    [
      DOM_PREAMBLE,
      SETUP,
      "window.test('ctrl-s', () => {",
      "  const { root } = mount();",
      "  root.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));",
      "  return 'saves=' + calls.length;",
      "});",
      "window.test('bare-s', () => {",
      "  const { root } = mount();",
      "  const before = calls.length;",
      "  root.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));",
      "  return 'saves=' + (calls.length - before);",
      "});",
      "window.test('ctrl-z', () => {",
      "  const { root } = mount();",
      "  const before = calls.length;",
      "  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));",
      "  return 'saves=' + (calls.length - before);",
      "});",
      "window.finish();",
    ].join("\n")
  );
  assert.ok(!out.skip, `skipped: ${out.skip}`);
  assert.ok(!out.fatal, out.fatal);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, r.error);
  const by = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));
  assert.equal(by["ctrl-s"], "saves=1");
  assert.equal(by["bare-s"], "saves=0");
  assert.equal(by["ctrl-z"], "saves=0");
});
