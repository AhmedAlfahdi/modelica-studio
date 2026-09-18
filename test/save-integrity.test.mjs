/**
 * The save round trip, which was losing the user's work.
 *
 * Reported as "when I fix the code with AI it doesn't save". The save was writing
 * the DIAGRAM rather than the editor's text, so a repair that had not been pushed
 * into the diagram was not written at all; and loading rebuilt the editor from the
 * diagram, which is lossy. Both directions had to be checked to see it.
 *
 * These tests pin the rules that make the round trip faithful.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildLibs, repoRoot } from "./helpers/build.mjs";

const main = fs.readFileSync(path.join(repoRoot, "src/main.ts"), "utf8");
const view = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");

test("saving writes the source, not a re-serialisation of the diagram", () => {
  // This is the bug. `serializeDiagram(this.model)` writes the DIAGRAM, so
  // anything the editor held that had not been applied -- an AI repair, a typed
  // line -- was silently dropped from the file.
  const save = /async saveModelToNote[\s\S]*?\n  \}/.exec(main);
  assert.ok(save, "the save function is present");
  assert.match(save[0], /this\.getView\(\)\?\.flushEditorIntoModel\(\)/, "the editor is realised first");
  assert.match(save[0], /const source = this\.sourceForSave\(\)/, "and the source is taken from the model's text");
  assert.ok(
    !/const source = serializeDiagram\(this\.model\)/.test(save[0]),
    "the diagram must not be the source of truth"
  );
});

test("the source wins while it is current, and the diagram when it is not", () => {
  const rule = /sourceForSave\(\): string \{[\s\S]*?return serializeDiagram\(this\.model\);\n  \}/.exec(main);
  assert.ok(rule, "the rule is present");
  assert.match(rule[0], /if \(this\.modelSource\.trim\(\) && !this\.modelOutdated\) return this\.modelSource/);
  assert.match(rule[0], /return serializeDiagram\(this\.model\)/, "with the serializer as a fallback");
  // The fallback is correct for a model assembled by dragging, where the source is
  // regenerated from the diagram -- not for one that came from a file. The
  // explanation lives in the doc comment ABOVE the method, which is where a reader
  // meets it, so it is looked for there rather than inside the body.
  const above = main.slice(Math.max(0, main.indexOf("sourceForSave()") - 1400), main.indexOf("sourceForSave()"));
  assert.match(above, /assembled by dragging/, "and the rule says when it applies");
});

test("editing the diagram invalidates the source it came from", () => {
  // The same fault in the other direction: after a drag, the stored source no
  // longer describes the model, so saving it would write the OLD text over the
  // edit.
  assert.match(main, /markSourceStale\(\): void \{/, "there is a way to mark it");
  const changed = /private onModelChanged[\s\S]*?\n  \}/.exec(view);
  assert.ok(changed, "the model-change handler is present");
  assert.match(changed[0], /markSourceStale\(\)/, "which is called when the model changes");
});

test("a save in code mode realises the editor even if nothing was pressed", () => {
  // Apply and Simulate both parse the editor, so a user who pressed either before
  // saving got their fix written. A user who only pressed Save did not.
  const flush = /flushEditorIntoModel\(\): void \{[\s\S]*?\n  \}/.exec(view);
  assert.ok(flush, "the flush is present");
  assert.match(flush[0], /if \(this\.mode !== "code"/, "only in code mode");
  assert.match(flush[0], /this\.applyCodeToDiagram\(false\)/, "and it parses the editor");
});

test("reopening a model shows the source, not a lossy rebuild", () => {
  // The load half. `serializeDiagram` drops declaration comments and normalises
  // formatting, so a model saved and reopened came back different from what was
  // written -- which is what made a fix look like it had not been saved.
  const load = /loadModelIntoEditor\(\): void \{[\s\S]*?\n  \}/.exec(view);
  assert.ok(load, "the load is present");
  assert.match(load[0], /const source = this\.plugin\.modelSourceText\(\)/, "the stored source is read");
  assert.match(load[0], /source\.trim\(\) \? source : serializeDiagram/, "and preferred over the serializer");
});

test("the round trip through the parser is known to be lossy", async () => {
  // Pinned as a fact, so the reason the source is preferred does not become
  // folklore. If the serializer ever became faithful this test would fail and the
  // preference could be reconsidered.
  const { parseModelica, toDiagramModel } = await import(
    path.join(buildLibs("save-rt-parser", ["src/modelica/parser.ts"]), "parser.js")
  );
  const { serializeDiagram } = await import(
    path.join(buildLibs("save-rt-ser", ["src/modelica/serializer.ts"]), "serializer.js")
  );
  const source = [
    'model M "A model with documentation"',
    "  // This comment explains the parameter and must survive a save.",
    "  parameter Real k = 1;",
    "equation",
    "  der(x) = -k*x;",
    "end M;",
  ].join("\n");
  const model = toDiagramModel(parseModelica(source)[0], () => undefined);
  const round = serializeDiagram(model);
  assert.ok(
    !round.includes("must survive a save"),
    "the serializer drops declaration comments, which is why the source is preferred"
  );
});

test("a fix made in the editor survives a save and a reload", async () => {
  // The reported failure, end to end. The pieces are the real ones -- the real
  // parser, the real serializer, a real file -- and only the plugin's state
  // machine is reproduced, because that is what the two bugs lived in.
  const { parseModelica, toDiagramModel } = await import(
    path.join(buildLibs("save-e2e-parser", ["src/modelica/parser.ts"]), "parser.js")
  );
  const { serializeDiagram } = await import(
    path.join(buildLibs("save-e2e-ser", ["src/modelica/serializer.ts"]), "serializer.js")
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mst-save-"));
  const file = path.join(dir, "Tank.mo");
  const original = [
    'model Tank "A tank draining through an orifice"',
    "  // Cross-sectional area of the tank, and it must survive a save.",
    "  parameter Real area = 1.0;",
    "  Real level(start = 2, fixed = true);",
    "equation",
    "  der(level) = -0.1*sqrt(level);",
    "end Tank;",
  ].join("\n");
  fs.writeFileSync(file, original, "utf8");

  // What the plugin holds after loading the file.
  const state = { source: original, outdated: false };
  const model = () => toDiagramModel(parseModelica(state.source)[0], () => undefined);

  // `sourceForSave` as the plugin implements it.
  const sourceForSave = () =>
    state.source.trim() && !state.outdated ? state.source : serializeDiagram(model());

  // 1. An AI fix arrives as new source, exactly as the repair path sets it.
  const fixed = original.replace("-0.1*sqrt(level)", "-0.05*sqrt(level)");
  state.source = fixed;
  state.outdated = false;

  // 2. Save.
  fs.writeFileSync(file, sourceForSave(), "utf8");

  // 3. Restart: read the file back and rebuild the editor's text.
  const reloaded = fs.readFileSync(file, "utf8");
  assert.ok(reloaded.includes("-0.05*sqrt(level)"), "the fix was written");
  assert.ok(reloaded.includes("must survive a save"), "and the comment was kept");
  assert.ok(reloaded.includes("A tank draining"), "and the description");

  // The old path is pinned as the failure it was, so the test cannot pass by
  // accident if the preference is removed.
  const lossy = serializeDiagram(toDiagramModel(parseModelica(original)[0], () => undefined));
  assert.ok(!lossy.includes("must survive a save"), "the serializer is still lossy (the reason for the fix)");
});

test("editing the diagram after a load saves the diagram, not the stale source", async () => {
  // The other direction: once a component is dragged the source no longer
  // describes the model, so saving the source would write the OLD text over the
  // edit -- the same bug pointing the other way.
  const { parseModelica, toDiagramModel } = await import(
    path.join(buildLibs("save-e2e2-parser", ["src/modelica/parser.ts"]), "parser.js")
  );
  const { serializeDiagram } = await import(
    path.join(buildLibs("save-e2e2-ser", ["src/modelica/serializer.ts"]), "serializer.js")
  );

  const source = 'model M "d"\n  Real x(start = 1, fixed = true);\nequation\n  der(x) = -x;\nend M;';
  const state = { source, outdated: false };
  const model = toDiagramModel(parseModelica(source)[0], () => undefined);
  const sourceForSave = () =>
    state.source.trim() && !state.outdated ? state.source : serializeDiagram(model);

  assert.equal(sourceForSave(), source, "unchanged: the source is saved verbatim");

  // A drag calls markSourceStale.
  state.outdated = true;
  const after = sourceForSave();
  assert.ok(after.includes("model M"), "the diagram is serialised instead");
  assert.notEqual(after, source, "and it is not the stale source");
});

test("there is a way back to the file on disk", () => {
  // The missing escape hatch: once a bad edit reached the editor and was
  // persisted there was no one-click return to what was last saved, which is
  // exactly what is wanted after a repair that made things worse.
  assert.match(view, /async revertToSaved\(\): Promise<void>/, "the revert exists");
  assert.match(view, /addBtn\(\s*model,\s*"history",\s*"Revert"/, "and has a button in the Model group");
  const revert = /async revertToSaved\(\): Promise<void> \{[\s\S]*?\n  \}/.exec(view);
  assert.ok(revert, "the implementation is present");

  // It reloads from the FILE, not from anything cached: the point is to get back
  // to what is on disk, which may have changed outside the plugin.
  assert.match(revert[0], /loadModelFromPath\(path\)/, "it reloads from the path");
  // It is confirmed, because it discards work with no undo.
  assert.match(revert[0], /confirmDiscard\(/, "it asks first");
  assert.match(revert[0], /discarded/, "and says what will be lost");
  // And it explains itself when there is nothing to revert to.
  assert.match(revert[0], /has not been saved to a file yet/, "no file: it says so");
  assert.match(revert[0], /is not there, so there is nothing to revert to/, "missing file: it says so");

  // The confirmation focuses Cancel.
  const dialog = /function confirmDiscard[\s\S]*?\n\}/.exec(view);
  assert.ok(dialog, "the dialog is present");
  assert.match(dialog[0], /no\.focus\(\)/, "Cancel takes focus, so a stray Enter does nothing");

  // The button is disabled when there is nothing to revert to.
  assert.match(view, /set\(this\.btnRevert, !!this\.plugin\.settings\.modelFiles/, "disabled without a file");
});
