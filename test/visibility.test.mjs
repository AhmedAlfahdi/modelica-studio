/**
 * "Hidden" has to mean hidden.
 *
 * The plugin hides things with one class, and several of the elements it hides also have
 * a layout rule of their own — `.modelica-studio-body`, `-code`, `-ai`, `-log` and
 * `-scale` all set `display` on the same element. A lone class loses to a later lone
 * class, so on those elements the hidden class did nothing at all.
 *
 * The reported symptom was the code pane's buttons and the AI prompt row drawn in the
 * diagram view at startup, which a mode switch then removed — because the switch set the
 * style inline, and the class had never been doing anything.
 *
 * The check is automatic rather than a list: every single-class rule in the shipped
 * stylesheet that sets `display` is found, an element is built with that class and the
 * hidden class, and the browser is asked what it computes. A layout rule added later is
 * covered the day it is written.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runInDom, DOM_PREAMBLE } from "./helpers/dom-runner.mjs";
import { repoRoot } from "./helpers/build.mjs";

const CSS = fs.readFileSync(path.join(repoRoot, "styles.css"), "utf8");

test("the hidden class beats every layout rule in the stylesheet", async () => {
  const out = await runInDom(
    [
      DOM_PREAMBLE,
      `const CSS_TEXT = ${JSON.stringify(CSS)};`,
      "const style = document.createElement('style');",
      "style.textContent = CSS_TEXT;",
      "document.head.appendChild(style);",
      "",
      "/** Every class the stylesheet gives a `display` to, as a one-class selector. */",
      "function layoutClasses() {",
      "  const names = new Set();",
      "  for (const block of CSS_TEXT.matchAll(/([^{}]+)\\{([^}]*)\\}/g)) {",
      "    if (!/display\\s*:/.test(block[2])) continue;",
      "    for (const part of block[1].split(',')) {",
      "      const m = /^\\.([a-z0-9-]+)$/.exec(part.trim());",
      "      if (m) names.add(m[1]);",
      "    }",
      "  }",
      "  return names;",
      "}",
      "",
      "window.test('the stylesheet was read', () => layoutClasses().size + ' classes set a display');",
      "window.test('every one of them can still be hidden', () => {",
      "  const stuck = [];",
      "  for (const name of layoutClasses()) {",
      "    const el = document.createElement('div');",
      "    el.className = name + ' modelica-studio-hidden';",
      "    document.body.appendChild(el);",
      "    const shown = getComputedStyle(el).display;",
      "    if (shown !== 'none') stuck.push(name + '=' + shown);",
      "    el.remove();",
      "  }",
      "  return stuck.length ? 'STILL VISIBLE: ' + stuck.join(', ') : layoutClasses().size + ' classes hidden';",
      "});",
      "window.test('and each of them is visible without the hidden class', () => {",
      "  // Otherwise the check above would pass on a stylesheet that simply hides",
      "  // everything, and the elements it is about would be invisible for some other",
      "  // reason -- which is a different bug, found by a different test.",
      "  const invisible = [];",
      "  for (const name of layoutClasses()) {",
      "    if (name === 'modelica-studio-hidden') continue;",
      "    const el = document.createElement('div');",
      "    el.className = name;",
      "    document.body.appendChild(el);",
      "    if (getComputedStyle(el).display === 'none') invisible.push(name);",
      "    el.remove();",
      "  }",
      "  return invisible.length ? 'HIDDEN BY THEIR OWN RULE: ' + invisible.join(', ') : 'each has a display of its own';",
      "});",
      "window.finish();",
    ].join("\n")
  );

  if (out.skip) return;
  assert.ok(!out.fatal, `${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));

  const found = Number(/^(\d+) classes/.exec(d["the stylesheet was read"])?.[1]);
  assert.ok(found >= 20, `the stylesheet's layout rules were found (${found})`);
  assert.match(
    d["every one of them can still be hidden"],
    /^\d+ classes hidden$/,
    `no rule in the stylesheet outranks the hidden class: ${d["every one of them can still be hidden"]}`
  );
  assert.equal(
    d["and each of them is visible without the hidden class"],
    "each has a display of its own",
    "the check is not passing because everything is hidden"
  );
});
