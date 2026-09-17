/**
 * The UI contract.
 *
 * A checklist for the controls rather than a rendering test: every item here is
 * something that was wrong at some point, or that nothing else would catch if it
 * were removed. Several are invisible in a screenshot of a single state — a
 * missing `aria-pressed`, a tooltip that promises a key that does not work, a
 * menu with no Escape — which is exactly why they are asserted in text.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./helpers/build.mjs";

const view = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
const main = fs.readFileSync(path.join(repoRoot, "src/main.ts"), "utf8");
const editor = fs.readFileSync(path.join(repoRoot, "src/view/editor.ts"), "utf8");
const codeEditor = fs.readFileSync(path.join(repoRoot, "src/view/code-editor.ts"), "utf8");
/** Everywhere a key might be handled: the canvas editor and the code editor. */
const keyHandlers = editor + "\n" + codeEditor;
const css = fs.readFileSync(path.join(repoRoot, "styles.css"), "utf8");

/** Every button label the toolbar and panes declare. */
function labels() {
  const out = [];
  for (const m of view.matchAll(/addBtn\(\s*\w+,\s*"[^"]+",\s*"([^"]+)"/g)) out.push(m[1]);
  for (const m of view.matchAll(/mk\("([^"]+)",\s*"([^"]+)"/g)) out.push(m[2]);
  for (const m of view.matchAll(/addMode\("(\w+)",\s*"[^"]+",\s*"([^"]+)"/g)) out.push(m[2]);
  return out;
}

test("every toolbar button says what it does", () => {
  const found = labels();
  assert.ok(found.length >= 15, `found ${found.length} labels`);

  for (const label of found) {
    // Sentence case, so the bar does not read as a mix of styles.
    assert.ok(
      label === label[0].toUpperCase() + label.slice(1),
      `"${label}" should start with a capital`
    );
    // All-caps is reserved for genuine acronyms. A word shouted for emphasis
    // reads as an error message rather than a control.
    const ACRONYMS = new Set(["AI", "PID"]);
    if (!ACRONYMS.has(label)) {
      assert.ok(!/^[A-Z]{2,}/.test(label), `"${label}" should not be shouted`);
    }
    assert.ok(label.trim() === label, `"${label}" has stray whitespace`);
  }
});

test("a button that opens a dialog or a menu carries an ellipsis", () => {
  // The convention that tells a reader the click will not act immediately.
  for (const label of ["Examples…", "New…"]) {
    assert.ok(labels().includes(label), `${label} is labelled with an ellipsis`);
  }
  // And the ones that act immediately do not have one.
  for (const label of ["Simulate", "Undo", "Redo", "Save as .mo"]) {
    assert.ok(!label.endsWith("…"), `${label} acts immediately`);
  }
});

test("a tooltip never promises a shortcut the code does not implement", () => {
  // A tooltip naming a key that does nothing is worse than no tooltip, because it
  // costs the reader a failed attempt.
  const promised = [...view.matchAll(/\$\{mod\}\+([A-Za-z0-9+]+)/g)].map((m) => m[1].toLowerCase());
  assert.ok(promised.length >= 3, `found ${promised.length} promised shortcuts`);
  for (const key of promised) {
    const bare = key.replace("shift+", "");
    // `enter` is handled as `ev.key === "Enter"`, and `z` may be lower-cased
    // first, so the check accepts either shape rather than pinning one spelling.
    const implemented = new RegExp(
      `ev\\.key(\\.toLowerCase\\(\\))? === "${bare}"|case "${bare}"`,
      "i"
    ).test(keyHandlers);
    assert.ok(implemented, `Ctrl+${key} is promised in a tooltip and implemented in the editor`);
  }
  // The bare-letter shortcuts are promised too, and implemented in the switch.
  assert.match(view, /\(R, or Shift\+R anticlockwise\)/);
  assert.match(editor, /case "r":/i);
});

test("toggle buttons carry aria-pressed and keep it in step", () => {
  // The mode switch is a pair of mutually exclusive toggles. Without aria-pressed
  // the active one is announced as an ordinary button and the state is invisible
  // to a screen reader, and a class name alone changes only the colour.
  assert.match(view, /setAttribute\("aria-pressed", "false"\)/, "set when created");
  assert.match(view, /setAttribute\("aria-pressed", id === this\.mode \? "true" : "false"\)/, "updated on switch");
});

test("tab strips are tablists and their tabs report selection", () => {
  const lists = [...view.matchAll(/setAttribute\("role", "tablist"\)/g)].length;
  assert.ok(lists >= 2, `both tab strips declare a tablist, found ${lists}`);
  assert.match(view, /setAttribute\("role", "tab"\)/, "tabs declare their role");
  assert.match(view, /setAttribute\("aria-selected", id === this\.bottomTab/, "results tabs update selection");
  assert.match(view, /setAttribute\("aria-selected", this\.inspectorTab === id/, "inspector tabs update selection");
});

test("anything that appears can be dismissed from the keyboard", () => {
  // The examples menu closed on an outside click only, so a keyboard user could
  // open it and not close it.
  assert.match(view, /ev\.key === "Escape"/, "the menu answers Escape");
  assert.match(view, /anchor\.focus\(\)/, "and returns focus to the button that opened it");
  assert.match(view, /ev\.key === "ArrowDown"/, "and is navigable with the arrow keys");
  // The code pane's completion popup already did this; assert it still does.
  const code = fs.readFileSync(path.join(repoRoot, "src/view/code-editor.ts"), "utf8");
  assert.match(code, /ev\.key === "Escape"/, "the completion popup answers Escape");
});

test("text inputs have an accessible name, not only a placeholder", () => {
  // A placeholder is not a label: it disappears as soon as anything is typed.
  assert.match(view, /"aria-label": "Search the component library"/);
  const palette = /createEl\("input", \{[\s\S]{0,400}?\}\)/.exec(view);
  assert.ok(palette, "the palette search input is found");
  assert.match(palette[0], /aria-label/, "and carries a label");
});

test("a destructive action states its consequence and offers to prevent it", () => {
  // Replacing the model in the studio used to happen without a word. Telling the
  // user to "save it first" and offering only Replace and Cancel was not enough:
  // it asks them to cancel, save by hand and start again. The dialog now does it.
  assert.match(main, /The studio holds/, "New states what it replaces");
  assert.match(main, /confirmLabel/, "the confirming button is not labelled Create");
  assert.match(main, /alternativeLabel/, "and a keeping option is offered");
  assert.match(main, /Save and replace/, "named for what it does");
  // Choosing it must actually save, before anything is replaced.
  const flow = /answer\.action === "alternative"[\s\S]*?await this\.newModel/.exec(main);
  assert.ok(flow, "the alternative path is present and precedes the replacement");
  assert.match(flow[0], /await this\.saveModelToNote\(\)/, "it saves");
  // And a failed save must NOT go on to replace, or the warning would be a lie.
  assert.match(flow[0], /Could not save[\s\S]*?return;/, "a failed save stops the replacement");
});

test("stating a consequence is not styled as an error", () => {
  // The block used the error background, which is a strong solid crimson, with
  // --text-normal on top: it looked like a failure and read badly.
  const warn = /(?:^|\n)\.modelica-studio-warn\s*\{[^}]*\}/.exec(css);
  assert.ok(warn, "the rule is present");
  assert.ok(!/background-modifier-error/.test(warn[0]), "no error background");
  assert.match(warn[0], /--text-warning/, "a warning accent instead");
  assert.match(warn[0], /--background-secondary/, "on a quiet surface");
  assert.match(warn[0], /--text-muted/, "with readable text");
});

test("status text does not point at controls that no longer exist", () => {
  // The Source tab became a mode switch; a message still telling the reader to
  // open it sends them looking for something that is not there.
  assert.ok(
    !/open the Source tab/i.test(view),
    "no message tells the reader to open a Source tab"
  );
  assert.match(view, /Use the Code tab to read or edit the source/, "it names the mode switch");
});

test("toolbar groups declare the mode they belong to", () => {
  const groups = [...view.matchAll(/addGroup\(bar, "([^"]+)", "(\w+)"\)/g)];
  assert.ok(groups.length >= 4, `found ${groups.length} groups`);
  const scopes = groups.map((g) => g[2]);
  assert.ok(scopes.includes("diagram"), "some groups are diagram-only");
  assert.ok(scopes.includes("both"), "and some apply to both modes");
  // The diagram-only ones must actually be hidden, or the scope is decoration.
  assert.match(view, /group\.dataset\.scope === "diagram"/, "the scope is read back");
  assert.match(view, /group\.style\.display = diagramOnly && isCode \? "none" : ""/, "and applied");
});

test("the group separator is styled, so grouping is visible", () => {
  const group = /(?:^|\n)\.modelica-studio-btn-group\s*\{[^}]*\}/.exec(css);
  assert.ok(group, "the group has a rule");
  assert.match(group[0], /border-right/, "groups are divided");
  assert.match(group[0], /display:\s*flex/, "and laid out in a row");
});

test("checking a trace does not move it", () => {
  // Checked traces used to be moved to the top, which moved the row out from
  // under the pointer at the moment of the click, so the next click landed on a
  // different trace. A list that rearranges itself as you use it is worse than
  // one you have to scroll.
  const src = view;
  const list = /const list = parent\.createDiv\(\{ cls: "modelica-studio-series" \}\)[\s\S]*?for \(const s of ordered/.exec(src);
  assert.ok(list, "the trace list is found");
  assert.match(list[0], /this\.result\.series\.filter\(matching\)/, "the order is the simulation's");
  assert.ok(!/\bselected\.filter\(matching\)/.test(list[0]), "checked traces are not hoisted");
  assert.ok(!/\.\.\.rest\.filter/.test(list[0]), "and there is no second, reordered list");
});

test("a routine run reports no warnings", () => {
  // The filter matched LOG_STDOUT, which carries ordinary output, so a good run
  // reported "The initialization finished successfully" as a warning — five of
  // them on one run, in yellow, about nothing.
  const backend = fs.readFileSync(path.join(repoRoot, "src/omc/backend.ts"), "utf8");
  const fn = /export function collectRunWarnings[\s\S]*?\n\}/.exec(backend);
  assert.ok(fn, "the collector is present");
  // Severity decides, not which stream the line arrived on.
  assert.match(fn[0], /structured\[2\]\.toLowerCase\(\)/, "the severity field is read");
  assert.match(fn[0], /severity === "warning" \|\| severity === "error"/, "only warning and error count");
  assert.match(fn[0], /structured\[1\] === "ASSERT"/, "and LOG_ASSERT always does");
  assert.ok(!/LOG_\(ASSERT\|ERROR\|STDOUT\)/.test(fn[0]), "LOG_STDOUT is no longer treated as a warning");
});

test("no tooltip simply repeats its own label", () => {
  // A tooltip that says "Zoom in" on a button labelled "Zoom in" tells the reader
  // nothing they cannot already see, and reads as a bug. Every tooltip is checked
  // against the label of the control it belongs to.
  /** label, hint pairs from the toolbar and code-toolbar factories. */
  const pairs = [];
  for (const m of view.matchAll(/addBtn\(\s*\w+,\s*"[^"]+",\s*"([^"]+)",\s*\n?\s*(?:`([^`]+)`|"([^"]+)")/g)) {
    pairs.push([m[1], m[2] ?? m[3]]);
  }
  for (const m of view.matchAll(/mk\("([^"]+)",\s*"([^"]+)",\s*(?:`([^`]+)`|"([^"]+)")/g)) {
    pairs.push([m[2], m[3] ?? m[4]]);
  }
  assert.ok(pairs.length >= 16, `found ${pairs.length} labelled controls`);

  for (const [label, hint] of pairs) {
    if (!hint) continue;
    assert.notEqual(
      label.trim().toLowerCase(),
      hint.trim().toLowerCase(),
      `"${label}" has a tooltip that only repeats it`
    );
    // Nor a tooltip that is just the label with a full stop or key appended.
    const bare = hint.replace(/[.。]$/, "").trim();
    assert.notEqual(bare.toLowerCase(), label.trim().toLowerCase(), `"${label}" tooltip repeats it`);
  }
});

test("a nested control does not steal the tooltip it sits inside", () => {
  // A browser shows the NEAREST ancestor's title, so a child title REPLACES the
  // parent's rather than adding to it. The palette row's tooltip carries the class
  // name and its description; giving the help icon its own title threw both away
  // for anyone hovering the icon -- which is where the pointer lands when reaching
  // for help.
  const palette = /const help = btn\.createEl\("a", \{ cls: "modelica-studio-palette-help"[\s\S]{0,700}?help\.setAttribute\("aria-label"[^\n]*\n/.exec(view);
  assert.ok(palette, "the palette help icon is present");
  assert.ok(
    !/help\.title\s*=/.test(palette[0]),
    "the palette icon must not set a title, or it hides the row's"
  );
  // It still needs an accessible name, since it has no visible text.
  assert.match(palette[0], /aria-label/, "but it is still labelled for a screen reader");
  // And the row keeps its own tooltip.
  assert.match(view, /btn\.setAttr\("title", `\$\{item\.name\}\\n\$\{item\.comment/, "the row still has one");
});

test("the inspector help icon keeps a title, because nothing above it has one", () => {
  // The opposite case: in the inspector the class name is plain text with no
  // tooltip, so the icon is the only thing that can explain itself.
  const inspector = /const help = classRow\.createEl\("a"[\s\S]{0,700}?help\.setAttribute\("aria-label"[^\n]*\n/.exec(view);
  assert.ok(inspector, "the inspector help icon is present");
  assert.match(inspector[0], /help\.title =/, "it explains itself");
  assert.match(inspector[0], /aria-label/, "and is labelled");
});
