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
