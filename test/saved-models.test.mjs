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
import { buildLibs } from "./helpers/build.mjs";

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
