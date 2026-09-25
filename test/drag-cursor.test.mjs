/**
 * What a divider drag looks like while it is happening.
 *
 * `installDivider` marks the body with `modelica-studio-resizing` for the length of a
 * drag, and the stylesheet holds the cursor shape for it and stops the drag from
 * selecting the text it passes over. Both of those used to be `!important`, which the
 * plugin directory rejects, so they are ordinary rules now: they have to WIN a cascade
 * against the app's own rules instead of overriding them. That is exactly the kind of
 * rule that reads correctly in the source and is wrong on screen, so it is asserted
 * against the computed style, with the app rules it competes with inlined.
 *
 * The one that matters is `body [contenteditable] { user-select: text }`: the editor is
 * contenteditable, and that rule has the same specificity as the plugin's generic
 * `body.modelica-studio-resizing *`. The plugin therefore names `.cm-content` and
 * `.cm-editor` as well, which outrank it, and this page is run with the two stylesheets
 * in BOTH orders: plugin styles load after the app's in practice, but a drag rule that
 * only works in that order is one load-order change away from selecting the whole
 * document on every drag.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runInDom, DOM_PREAMBLE } from "./helpers/dom-runner.mjs";
import { repoRoot } from "./helpers/build.mjs";

const CSS = fs.readFileSync(path.join(repoRoot, "styles.css"), "utf8");

/** The app rules a drag competes with, copied from the app's own `app.css`. */
const THEME = `
/* app.css: the editor is contenteditable, and the app turns text selection back on
   for it. Same specificity as the plugin's generic drag rule. */
body [contenteditable="true"],
body [contenteditable=""] {
  user-select: text;
}
/* app.css: the leaf already owns a cursor of its own. */
.workspace-leaf-content {
  cursor: var(--cursor, default);
}
/* app.css: so does a canvas pane, and this one carries two classes and an element --
   more than the plugin's generic rule does, so the canvas has to be named. */
.workspace-leaf-content .view-content canvas {
  cursor: crosshair;
}
`;

/**
 * The page, with the two stylesheets in the order the app loads them or in the
 * reverse.
 *
 * Both orders are run. The app loads its own `app.css` first and injects a plugin's
 * `styles.css` after it, but the plugin's named selectors are chosen to outrank the
 * app's rule rather than to arrive after it, and this is what holds them to that.
 */
function page(themeFirst) {
  const sheets = (themeFirst ? [THEME, CSS] : [CSS, THEME]).map((s) => JSON.stringify(s));
  return [
    DOM_PREAMBLE,
    // The Obsidian element helpers (`createDiv`, `addClass`), as in the app. Every
    // other DOM test gets them by importing the stub; this one builds its own page.
    `import { installDomHelpers } from "${path.join(repoRoot, "test/helpers/dom-shim")}";`,
    "installDomHelpers({ Element: globalThis.Element, HTMLElement: globalThis.HTMLElement });",
    `for (const css of [${sheets.join(", ")}]) {`,
    "  const style = document.createElement('style');",
    "  style.textContent = css;",
    "  document.head.appendChild(style);",
    "}",
    "",
    "/** The surroundings a plugin pane really sits in: a leaf, its view, an editor and",
    "    a canvas, with the theme's own cursor rules on them. */",
    "function build() {",
    "  const leaf = document.body.createDiv({ cls: 'workspace-leaf-content' });",
    "  const view = leaf.createDiv({ cls: 'view-content' });",
    "  const editor = view.createDiv({ cls: 'cm-editor' });",
    "  const content = editor.createDiv({ cls: 'cm-content' });",
    "  content.setAttribute('contenteditable', 'true');",
    "  const canvas = view.createEl('canvas');",
    "  const pane = view.createDiv({ cls: 'modelica-studio-inspector' });",
    "  const dropdown = pane.createEl('select', { cls: 'dropdown' });",
    "  const label = pane.createSpan({ text: 'Voltage' });",
    "  return { leaf, view, content, canvas, pane, dropdown, label };",
    "}",
    "const d = build();",
    "const cursor = (el) => getComputedStyle(el).cursor;",
    "// Reported under the standard name in Chromium; the prefixed one is the fallback.",
    "const select = (el) => getComputedStyle(el).userSelect || getComputedStyle(el).webkitUserSelect;",
    "",
    "// Read once with no drag, then once with it, so the class is the only difference.",
    "const idle = {",
    "  editor: cursor(d.content) + ' / ' + select(d.content),",
    "  canvas: cursor(d.canvas),",
    "};",
    "document.body.addClass('modelica-studio-resizing');",
    "const drag = {",
    "  body: cursor(document.body),",
    "  editor: cursor(d.content),",
    "  leaf: cursor(d.leaf),",
    "  canvas: cursor(d.canvas),",
    "  label: cursor(d.label),",
    "  dropdown: cursor(d.dropdown),",
    "  selected: select(d.content) + ' / ' + select(d.label),",
    "};",
    "document.body.removeClass('modelica-studio-resizing');",
    "const released = cursor(d.content) + ' / ' + cursor(d.canvas);",
    "",
    "window.test('with no drag, the editor keeps its own cursor and selection', () =>",
    "  idle.editor + ' | canvas ' + idle.canvas);",
    "window.test('during a drag, every surface shows the divider cursor', () =>",
    "  'body ' + drag.body + ', editor ' + drag.editor + ', leaf ' + drag.leaf",
    "    + ', canvas ' + drag.canvas + ', label ' + drag.label + ', select ' + drag.dropdown);",
    "window.test('and the drag cannot select the text it passes over', () => drag.selected);",
    "window.test('releasing the drag gives the surfaces back', () => released);",
    "",
    "window.finish();",
  ].join("\n");
}

test("a divider drag holds the cursor and selects nothing", async () => {
  for (const themeFirst of [true, false]) {
    const out = await runInDom(page(themeFirst));
    if (out.skip) return;
    const where = themeFirst
      ? "with the app's stylesheet loaded first, as the app does it"
      : "with the plugin's stylesheet loaded first";
    assert.ok(!out.fatal, `${where}: ${out.fatal} :: ${JSON.stringify(out.errors ?? [])}`);
    assert.deepEqual(out.errors, [], `${where}: no page errors`);
    for (const r of out.results) assert.ok(r.ok, `${where}: ${r.name}: ${r.error ?? ""}`);
    const d = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));

    // Without the class the editor is what it always is: no divider cursor, and the
    // app's `user-select: text` applies. Asserted first, because a fixture that does
    // not reproduce the competing rule would make the drag assertions meaningless.
    assert.match(
      d["with no drag, the editor keeps its own cursor and selection"],
      /^(default|auto|text) \/ text \| canvas crosshair$/,
      `${where}: the app's own rules apply when nothing is being dragged: ${d["with no drag, the editor keeps its own cursor and selection"]}`
    );

    // `cursor: default` is what the theme asks for on a leaf, `crosshair` on a canvas
    // pane: both are beaten by the drag rule rather than merely unset.
    assert.equal(
      d["during a drag, every surface shows the divider cursor"],
      "body col-resize, editor col-resize, leaf col-resize, canvas col-resize, label col-resize, select col-resize",
      where
    );
    assert.equal(d["and the drag cannot select the text it passes over"], "none / none", where);
    assert.equal(
      d["releasing the drag gives the surfaces back"],
      "default / crosshair",
      `${where}: the surfaces go back to their own cursors`
    );
  }
});
