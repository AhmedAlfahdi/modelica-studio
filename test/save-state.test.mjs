/**
 * Whether the model in the studio differs from its file.
 *
 * There was no notion of this, which is why the loss reports kept coming: a
 * repair compiled and ran, the status line said "Ready", and the work was only in
 * memory. Nothing distinguished "it ran" from "it is saved" from the outside, so a
 * successful run read as "kept".
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";

const { describeSaveState, savePrompt } = await import(
  path.join(buildLibs("save-state", ["src/modelica/save-state.ts"]), "save-state.js")
);

test("a model with no file is unsaved, not modified", () => {
  // The action differs: one creates a file and the dialog should say so.
  const d = describeSaveState({ source: "model A\nend A;", onDisk: null });
  assert.equal(d.state, "unsaved");
  assert.equal(d.label, "not saved");
  assert.equal(d.worthAsking, true);
});

test("identical text is saved, whatever the line endings", () => {
  // The same model written on two platforms differs only in line endings;
  // reporting "modified" for a file that has not changed trains the reader to
  // ignore the indicator.
  assert.equal(describeSaveState({ source: "a\nb", onDisk: "a\nb" }).state, "saved");
  assert.equal(describeSaveState({ source: "a\r\nb", onDisk: "a\nb" }).state, "saved");
  // A trailing blank line is not a change worth prompting about.
  assert.equal(describeSaveState({ source: "a\nb\n\n", onDisk: "a\nb" }).state, "saved");
  assert.equal(describeSaveState({ source: "a\nb", onDisk: "a\nb\n\n" }).state, "saved");
  assert.equal(describeSaveState({ source: "a\nb", onDisk: "a\nb" }).worthAsking, false);
});

test("a real difference is modified and worth asking about", () => {
  const d = describeSaveState({ source: "a\nc", onDisk: "a\nb" });
  assert.equal(d.state, "modified");
  assert.equal(d.label, "unsaved changes");
  assert.equal(d.worthAsking, true);
  // Whitespace in the MIDDLE is a real difference.
  assert.equal(describeSaveState({ source: "a  b", onDisk: "a b" }).state, "modified");
});

test("the prompt says what will happen, and names the file", () => {
  // "Save this model?" is answerable; "the model has unsaved changes" is not.
  const unsaved = describeSaveState({ source: "x", onDisk: null });
  assert.match(savePrompt(unsaved, "Tank", null), /Save "Tank" to a \.mo file so it is kept\?/);

  const modified = describeSaveState({ source: "y", onDisk: "x" });
  const prompt = savePrompt(modified, "Tank", "Modelica/Tank.mo");
  assert.match(prompt, /Save the changes to "Tank"\?/);
  // "Save" beside a vault full of models is ambiguous, so the path is named.
  assert.match(prompt, /Modelica\/Tank\.mo/);

  // Nothing to ask when it is already saved.
  const saved = describeSaveState({ source: "x", onDisk: "x" });
  assert.equal(savePrompt(saved, "Tank", "Modelica/Tank.mo"), null);
});
