/**
 * Where a saved model goes, and what a new model clears.
 *
 * Both are file-structure behaviour rather than UI, and both were wrong: models
 * were written loose into the vault root beside the notes, and starting a new
 * model left the previous model's source in the code editor while the canvas
 * went empty — so the two disagreed about what was being edited.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./helpers/build.mjs";

const main = fs.readFileSync(path.join(repoRoot, "src/main.ts"), "utf8");
const view = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
const settings = fs.readFileSync(path.join(repoRoot, "src/settings.ts"), "utf8");

test("models are saved into a folder, not beside the notes", () => {
  // A vault whose root is a mix of notes and compiler source is unreadable, and
  // the source is not a note.
  assert.match(settings, /modelFolder: "Modelica"/, "the default folder is Modelica");
  assert.match(main, /const intended = folder \? `\$\{folder\}\/\$\{this\.model\.name\}\.mo`/);
});

test("the folder is created before anything is written into it", () => {
  // Saving into a folder that does not exist fails, and the failure reads as a
  // permission problem rather than a missing directory.
  assert.match(main, /if \(folder\) await this\.ensureFolder\(folder\)/);
  const ensure = /private async ensureFolder[\s\S]*?\n  \}/.exec(main);
  assert.ok(ensure, "ensureFolder is defined");
  // Every level, not just the leaf: `a/b` needs `a` first.
  assert.match(ensure[0], /for \(const part of parts\)/, "it walks the path");
  assert.match(ensure[0], /createFolder/, "and creates each level");
});

test("saving an existing model goes back to the file it came from", () => {
  // Otherwise every save would write a second copy under the conventional name.
  assert.match(main, /remembered && this\.app\.vault\.getAbstractFileByPath\(remembered\) instanceof TFile/);
  assert.match(main, /await this\.app\.vault\.modify\(file, source\)/);
});

test("a model saved before the folder existed is found, not duplicated", () => {
  // The intended path is checked first and the remembered one second, so a model
  // at the root is still found rather than shadowed by a new file.
  const save = /async saveModelToNote[\s\S]*?\n  \}/.exec(main);
  assert.ok(save, "the save function is present");
  const intendedCheck = save[0].indexOf("getAbstractFileByPath(intended)");
  const rememberedCheck = save[0].indexOf("getAbstractFileByPath(remembered)");
  assert.ok(intendedCheck > 0 && rememberedCheck > intendedCheck, "intended first, remembered second");
  assert.match(save[0], /await this\.app\.vault\.create\(intended, source\)/, "and one create path only");
});

test("a new model clears the code editor as well as the canvas", () => {
  // The two are views of one model. Setting only the diagram left the previous
  // model's source on screen, which is what "new model" looked like: an empty
  // canvas and someone else's code.
  const load = /loadModelIntoEditor\(\): void \{[\s\S]*?\n  \}/.exec(view);
  assert.ok(load, "loadModelIntoEditor is present");
  assert.match(load[0], /this\.editor\?\.setModel\(this\.plugin\.model\)/, "the diagram is set");
  assert.match(load[0], /this\.codeEditor\.setValue\(serializeDiagram\(this\.plugin\.model\)\)/, "and so is the source");
  // Results from the previous model would plot traces that no longer match.
  assert.match(load[0], /this\.result = null/, "the previous result is dropped");
});

test("a new model is not replaced by an example", () => {
  // The empty-canvas seeding exists for a first-time user; without a guard it
  // replaced a model the user had just asked for, and New looked inert.
  assert.match(view, /private freshModel = false/, "there is a flag");
  assert.match(view, /!this\.freshModel &&[\s\S]{0,120}components\.length === 0/, "the seeding respects it");
  assert.match(view, /this\.freshModel = true;/, "set when a model is loaded into the editor");
  assert.match(view, /this\.freshModel = false;/, "and cleared once it is edited");
});

test("the vault root is not written to when a folder is configured", () => {
  // Every path the save can produce must be inside the folder.
  const save = /async saveModelToNote[\s\S]*?\n  \}/.exec(main)[0];
  const bareRootWrite = /create\(\s*`\$\{this\.model\.name\}\.mo`/.test(save);
  assert.ok(!bareRootWrite, "no write to the bare model name");
  const paths = [...save.matchAll(/create\((\w+)/g)].map((m) => m[1]);
  assert.deepEqual(paths, ["intended"], "there is exactly one destination");
});

/* ---- how a saved model is opened ---- */

test("a .mo file can be opened four ways, and the default is left alone", () => {
  // The question was which opening gesture to support. All of them, because they
  // suit different moments -- but the OS default must not be taken away: a `.mo`
  // file IS source, and reading it as text is a legitimate thing to want.
  const src = fs.readFileSync(path.join(repoRoot, "src/main.ts"), "utf8");
  const view = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");

  // 1. The file explorer's context menu, which is where "open this with" lives.
  assert.match(src, /workspace\.on\("file-menu"/, "a context-menu item");
  assert.match(src, /setTitle\("Open in Modelica Studio"\)/, "named for what it does");
  // Only for .mo: the item must not appear on a note.
  assert.match(src, /file\.extension !== "mo"\) return/, "and only on .mo files");

  // 2. The command palette.
  assert.match(src, /id: "new-model-from-note"/, "a command exists");
  assert.match(src, /Open the active \.mo file in Modelica Studio/, "named for a file, not a note");

  // 3. Dragging onto the canvas or the code pane.
  assert.match(view, /droppedVaultFile/, "a dropped file is recognised");
  assert.match(view, /loadModelFromPath/, "and opened");
  assert.ok(
    (view.match(/droppedVaultFile\(ev\)/g) ?? []).length >= 3,
    "both surfaces handle a drop"
  );

  // 4. It is NOT registered as the handler for the extension, so clicking a file
  //    still opens the text. Taking that over would be the surprising choice.
  assert.ok(
    !/registerExtensions\(\[[^\]]*"mo"/.test(src),
    "the extension is not hijacked"
  );
});

test("a drop tells a palette class from a file", () => {
  // Both arrive as a drop on the same surface, so the handler must distinguish
  // them or dragging a class would try to open a file called "Resistor".
  const view = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  const fn = /export function droppedVaultFile[\s\S]*?\n\}/.exec(view);
  assert.ok(fn, "the helper is present");
  assert.match(fn[0], /endsWith\("\.mo"\)/, "only a .mo path counts as a file");
  assert.match(fn[0], /text\/vnd\.obsidian\.file/, "the explorer's own drag type is checked first");
});

test("opening a file remembers where it came from", () => {
  // Otherwise Save writes a second copy under the class name and the vault fills
  // with two files for one model -- the same fault as saving to the root.
  const src = fs.readFileSync(path.join(repoRoot, "src/main.ts"), "utf8");
  const load = /async loadModelFromFile[\s\S]*?\n  \}/.exec(src);
  assert.ok(load, "the loader is present");
  assert.match(load[0], /this\.settings\.modelFiles\[withComponents\.name\] = file\.path/, "the path is recorded");
  assert.match(load[0], /this\.modelSource = text/, "and the source, so a re-parse round-trips");
});

test("opening by path checks the file exists before reading it", () => {
  // A drop can carry a stale path, and reading a missing file throws.
  const src = fs.readFileSync(path.join(repoRoot, "src/main.ts"), "utf8");
  const byPath = /async loadModelFromPath[\s\S]*?\n  \}/.exec(src);
  assert.ok(byPath, "the path loader is present");
  assert.match(byPath[0], /instanceof TFile/, "it resolves the path first");
  assert.match(byPath[0], /was not found in the vault/, "and says so when it cannot");
  assert.match(byPath[0], /await this\.activateView\(\)/, "and brings the studio forward");
});
