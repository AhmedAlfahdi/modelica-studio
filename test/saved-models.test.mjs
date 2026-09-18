/**
 * Where each saved model is, and whether that is where it belongs.
 *
 * Worth testing because the display hid two faults behind one flat shape: a
 * tracked path with no file behind it, and a model outside the configured folder.
 * Both rendered as `Name → path`, so a broken vault looked tidy.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { buildLibs, repoRoot } from "./helpers/build.mjs";

const { describeSavedModels, describeRow } = await import(
  path.join(buildLibs("saved-models", ["src/modelica/saved-models.ts"]), "saved-models.js")
);

/** A vault where these paths exist. */
const vault = (...present) => (p) => present.includes(p);

test("a model in the configured folder is in place", () => {
  const view = describeSavedModels({
    modelFolder: "Modelica",
    modelFiles: { Tank: "Modelica/Tank.mo" },
    exists: vault("Modelica/Tank.mo"),
  });
  assert.equal(view.rows[0].status, "ok");
  assert.equal(view.rows[0].folder, "Modelica");
  assert.equal(view.rows[0].file, "Tank.mo");
  assert.equal(view.misplaced + view.missing, 0);
});

test("a model outside the folder is reported as misplaced, not as fine", () => {
  // The fault that was invisible: `ResistorDivider -> ResistorDivider.mo` while
  // the file sat in Modelica/. It reads as a normal entry and is not one.
  const view = describeSavedModels({
    modelFolder: "Modelica",
    modelFiles: { ResistorDivider: "ResistorDivider.mo" },
    exists: vault("ResistorDivider.mo"),
  });
  assert.equal(view.rows[0].status, "misplaced");
  assert.equal(view.rows[0].folder, "", "at the vault root");
  assert.equal(view.misplaced, 1);
  assert.match(describeRow(view.rows[0], "Modelica"), /outside the save folder/);
  assert.match(describeRow(view.rows[0], "Modelica"), /moves to Modelica\/ResistorDivider\.mo/);
});

test("a tracked path with no file is reported as missing", () => {
  // The other invisible fault: the path was recorded, the file had moved, and the
  // entry looked exactly like a working one.
  const view = describeSavedModels({
    modelFolder: "",
    modelFiles: { Gone: "Gone.mo" },
    exists: vault(),
  });
  assert.equal(view.rows[0].status, "missing");
  assert.equal(view.missing, 1);
  assert.match(describeRow(view.rows[0], ""), /no file there/);
  assert.match(describeRow(view.rows[0], ""), /recreated on save/);
});

test("with no folder configured, the vault root is the intended home", () => {
  // An empty setting means the root deliberately, so a file there is not
  // misplaced -- reporting it as a fault would be crying wolf about a choice.
  const view = describeSavedModels({
    modelFolder: "",
    modelFiles: { Tank: "Tank.mo" },
    exists: vault("Tank.mo"),
  });
  assert.equal(view.rows[0].status, "ok");
  assert.match(describeRow(view.rows[0], ""), /vault root/, "and the row says so");
});

test("a file no model claims is listed separately", () => {
  // A .mo file in the vault that nothing tracks is either a model the plugin has
  // forgotten or one the user keeps by hand; either way it is worth naming.
  const view = describeSavedModels({
    modelFolder: "Modelica",
    modelFiles: { Tank: "Modelica/Tank.mo" },
    exists: vault("Modelica/Tank.mo", "Modelica/Orphan.mo", "AirplaneDrag.mo"),
    allModelFiles: ["Modelica/Tank.mo", "Modelica/Orphan.mo", "AirplaneDrag.mo"],
  });
  assert.deepEqual(view.untracked, ["AirplaneDrag.mo", "Modelica/Orphan.mo"]);
});

test("the list is sorted by name and tolerates a messy vault", () => {
  const view = describeSavedModels({
    modelFolder: "  Modelica/  ",
    modelFiles: { Zebra: "Modelica/Zebra.mo", Alpha: "/Modelica/Alpha.mo", Empty: "   " },
    // Matching normalised paths, because that is what the function reports: a
    // stored path with a stray leading slash is the same file, and the row says so.
    exists: vault("Modelica/Zebra.mo", "Modelica/Alpha.mo"),
  });
  assert.deepEqual(view.rows.map((r) => r.name), ["Alpha", "Zebra"], "sorted, blank entry dropped");
  assert.deepEqual(
    view.rows.map((r) => r.path),
    ["Modelica/Alpha.mo", "Modelica/Zebra.mo"],
    "a leading slash is normalised away, not carried into the comparison"
  );
  // A configured folder is matched with its padding and slashes normalised, so a
  // stray space in the setting does not mark every model misplaced.
  assert.ok(view.rows.every((r) => r.status === "ok"), "folder comparison is normalised");
});

/* ---- repairing stale records ---- */

const { repairModelFiles } = await import(
  path.join(buildLibs("saved-models-repair", ["src/modelica/saved-models.ts"]), "saved-models.js")
);

test("a stale path is repointed at the file that exists", () => {
  // The reported state: five records pointing at vault-root paths with no files,
  // while the files themselves sit in Modelica/. The plugin copes -- a save looks
  // the file up again -- but the settings report a vault full of missing models
  // and each one is only corrected when it happens to be saved.
  const r = repairModelFiles({
    modelFolder: "Modelica",
    modelFiles: { Electrical: "Electrical.mo", Fluid: "Modelica/Fluid.mo" },
    allModelFiles: ["Modelica/Electrical.mo", "Modelica/Fluid.mo"],
    exists: (p) => p === "Modelica/Fluid.mo",
  });
  assert.deepEqual(r.modelFiles, { Electrical: "Modelica/Electrical.mo", Fluid: "Modelica/Fluid.mo" });
  assert.deepEqual(r.repointed, [{ name: "Electrical", from: "Electrical.mo", to: "Modelica/Electrical.mo" }]);
  assert.deepEqual(r.stillMissing, []);
});

test("a record that is still correct is left exactly as it is", () => {
  // A model deliberately saved outside the folder must not be dragged into it by
  // a repair. Only a record that points at NOTHING is rewritten.
  const r = repairModelFiles({
    modelFolder: "Modelica",
    modelFiles: { Elsewhere: "notes/Elsewhere.mo" },
    allModelFiles: ["notes/Elsewhere.mo", "Modelica/Elsewhere.mo"],
    exists: (p) => p === "notes/Elsewhere.mo",
  });
  assert.deepEqual(r.modelFiles, { Elsewhere: "notes/Elsewhere.mo" });
  assert.equal(r.repointed.length, 0);
});

test("the configured folder wins when a file exists in two places", () => {
  // Resolution is by file name, so a duplicate needs a rule rather than the
  // filesystem's listing order.
  const r = repairModelFiles({
    modelFolder: "Modelica",
    modelFiles: { Tank: "Tank.mo" },
    allModelFiles: ["Tank.mo", "Modelica/Tank.mo"],
    exists: () => false,
  });
  assert.equal(r.modelFiles.Tank, "Modelica/Tank.mo");
});

test("a model with no file anywhere is reported, not invented", () => {
  const r = repairModelFiles({
    modelFolder: "Modelica",
    modelFiles: { Ghost: "Ghost.mo" },
    allModelFiles: ["Modelica/Other.mo"],
    exists: () => false,
  });
  assert.deepEqual(r.stillMissing, ["Ghost"]);
  assert.equal(r.modelFiles.Ghost, "Ghost.mo", "the record is kept so a save still has somewhere to go");
});

test("adopting claims the files no model owns", () => {
  // Eleven .mo files in the vault, seven tracked: the other four are models the
  // plugin has lost track of, and their own name is the only sensible key.
  const r = repairModelFiles({
    modelFolder: "Modelica",
    modelFiles: { Electrical: "Modelica/Electrical.mo" },
    allModelFiles: [
      "Modelica/Electrical.mo",
      "Modelica/DampedBounce.mo",
      "Modelica/Thermal.mo",
      "AirplaneDrag.mo",
    ],
    exists: (p) => p === "Modelica/Electrical.mo",
    adopt: true,
  });
  assert.deepEqual(r.adopted.map((a) => a.name), ["DampedBounce", "Thermal", "AirplaneDrag"]);
  assert.equal(r.modelFiles.DampedBounce, "Modelica/DampedBounce.mo");
  // A file whose name is already a model does not create a second entry.
  assert.equal(Object.keys(r.modelFiles).filter((k) => k === "Electrical").length, 1);
});

test("adopting is off unless asked for", () => {
  // An unclaimed file may be deliberate -- a scratch model, or one kept by hand.
  const r = repairModelFiles({
    modelFolder: "Modelica",
    modelFiles: {},
    allModelFiles: ["Modelica/Spare.mo"],
    exists: () => false,
  });
  assert.deepEqual(r.adopted, []);
  assert.deepEqual(r.modelFiles, {});
});

test("the list lives in the studio, not in settings", () => {
  // It is about the model being worked on and where it lives -- something you
  // want to see while working, not a preference. Settings kept it behind a scroll
  // through unrelated panels.
  const settings = fs.readFileSync(path.join(repoRoot, "src/settings.ts"), "utf8");
  assert.ok(
    !/describeSavedModels\(/.test(settings),
    "settings no longer builds the list"
  );
  assert.match(settings, /shown in the studio/, "and points at where it went");

  const view = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  assert.match(view, /SavedModelsModal\(this\.app, this\.plugin\)\.open\(\)/, "the studio opens it");
  assert.match(view, /"Model list…"/, "from a named button");
  assert.match(view, /Click one to open it|click one to open it/i, "and the tooltip says what it is for");

  // A modal, built the way the others are.
  const modal = fs.readFileSync(path.join(repoRoot, "src/view/saved-models-modal.ts"), "utf8");
  assert.match(modal, /export class SavedModelsModal extends Modal/);
  assert.match(modal, /onOpen\(\)/, "it renders on open");
  // The rows do something rather than only reporting.
  assert.match(modal, /addClass\("is-openable"\)/, "an existing file is openable");
  assert.match(modal, /await this\.plugin\.loadModelFromPath\(row\.path\)/, "and opens the model");
  // A row with no file behind it must NOT be clickable: a click that fails is
  // worse than a row that plainly does not respond.
  const render = /private renderRow[\s\S]*?\n  \}/.exec(modal);
  assert.ok(render, "the row renderer is present");
  const missingCheck = render[0].indexOf('row.status === "missing"');
  const openable = render[0].indexOf('addClass("is-openable")');
  assert.ok(missingCheck > 0 && missingCheck < openable, "the missing case returns before that");
});

test("the folder field completes from the folders that exist", () => {
  // A plain text box meant remembering a folder's name and spelling it right, and
  // a typo produced a NEW folder rather than an error -- the plugin creates
  // whatever path it is given. A vault with Models, models and Modelica is the
  // predictable result.
  const src = fs.readFileSync(path.join(repoRoot, "src/view/folder-suggest.ts"), "utf8");
  assert.match(src, /extends AbstractInputSuggest/, "it uses the app's own mechanism");
  assert.match(src, /getSuggestions\(query: string\)/, "and implements the one abstract method");
  assert.match(src, /selectSuggestion\(value: string\)/, "with selection wired to the field");

  // A folder that does NOT exist is offered, because the plugin creates it -- and
  // it is marked, since "choose this" and "create this" look identical in a list.
  assert.match(src, /new folder/, "a folder that would be created is marked");
  assert.match(src, /TFolder/, "existence is checked against the vault");

  // And the setting uses it.
  const settings = fs.readFileSync(path.join(repoRoot, "src/settings.ts"), "utf8");
  assert.match(settings, /new FolderSuggest\(this\.app, t\.inputEl/, "the save folder wires it up");
  assert.match(settings, /addSearch\(/, "on a search-shaped input");
});
