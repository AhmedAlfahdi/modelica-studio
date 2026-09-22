/**
 * Version history for saved models.
 *
 * Written because two .mo files vanished from the development vault and there was
 * nothing to recover them from -- no trash, no backup, no copy. The plugin is what
 * writes those files, so the plugin keeps the previous version.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { buildLibs, repoRoot } from "./helpers/build.mjs";

const mod = await import(
  path.join(buildLibs("revisions", ["src/modelica/revisions.ts"]), "revisions.js")
);
const { revisionDirName, revisionFileName, revisionTime, isNewRevision, revisionsToPrune, MAX_REVISIONS } = mod;

test("a revision name round-trips through time", () => {
  const at = new Date(Date.UTC(2026, 8, 18, 3, 40, 12));
  const file = revisionFileName(at);
  // Colons are illegal in a Windows path, so the ISO form keeps its shape with
  // the separators changed -- it stays sortable and readable.
  assert.equal(file, "2026-09-18T03-40-12.mo");
  assert.equal(revisionTime(file).getTime(), at.getTime());
  assert.ok(!file.includes(":"), "no colon, so Windows can store it");
  // Names that are not ours are not mistaken for a time.
  assert.equal(revisionTime("notes.mo"), null);
  assert.equal(revisionTime("2026-09-18.mo"), null);
});

test("a model name becomes a single safe directory", () => {
  // A name with a dot or a slash would otherwise nest or escape.
  assert.equal(revisionDirName("Tank"), "Tank");
  assert.equal(revisionDirName("Tank.v2"), "Tank_v2");
  assert.equal(revisionDirName("a/b"), "a_b");
  assert.equal(revisionDirName(".."), "__");
  assert.equal(revisionDirName(""), "model", "an empty name still gets a directory");
  for (const name of ["Tank.v2", "a/b", "..", ""]) {
    assert.ok(!revisionDirName(name).includes("/"), `${name} cannot escape its directory`);
  }
});

test("an unchanged model does not add a revision", () => {
  // Every save would otherwise append, and saving an unchanged model several times
  // produces a history of identical files that hides the one that mattered.
  assert.equal(isNewRevision(undefined, "model A\nend A;"), true, "the first is always kept");
  assert.equal(isNewRevision("model A\nend A;", "model A\nend A;"), false);
  // Line endings are the same model written on two platforms.
  assert.equal(isNewRevision("model A\r\nend A;", "model A\nend A;"), false);
  assert.equal(isNewRevision("model A\nend A;  ", "model A\nend A;"), false, "trailing space");
  assert.equal(isNewRevision("model A\nend A;", "model B\nend B;"), true);
});

test("pruning keeps the newest and drops the oldest", () => {
  const rev = (minutes) => ({
    file: `x.mo`,
    at: new Date(Date.UTC(2026, 8, 18, 3, minutes)),
    bytes: 10,
  });
  const many = [rev(1), rev(5), rev(3), rev(4), rev(2)];
  assert.deepEqual(revisionsToPrune(many.slice(0, 3), 3), [], "under the limit, nothing goes");

  const pruned = revisionsToPrune(many, 3);
  assert.equal(pruned.length, 2);
  // The two OLDEST, so a run of saves never pushes out what a restore wants.
  assert.deepEqual(pruned.map((r) => r.at.getUTCMinutes()).sort((a, b) => a - b), [1, 2]);
});

test("the limit is a real number to prune against", () => {
  assert.ok(Number.isInteger(MAX_REVISIONS) && MAX_REVISIONS > 1, `got ${MAX_REVISIONS}`);
});

test("the dialog offers deletion and history, safely", () => {
  // Written because two .mo files vanished from the development vault with
  // nothing to recover them from -- no trash, no backup, no copy anywhere.
  const src = fs.readFileSync(path.join(repoRoot, "src/view/saved-models-modal.ts"), "utf8");

  // Deletion is reversible twice: the vault's trash, and a snapshot first.
  assert.match(src, /this\.app\.vault\.trash\(file, true\)/, "the file goes to the vault's trash");
  assert.ok(!/vault\.delete\(file\)/.test(src), "not permanently removed");
  const del = /private async deleteModel[\s\S]*?\n  \}/.exec(src);
  assert.ok(del, "the delete path is present");
  assert.match(del[0], /snapshotRevision/, "and snapshots the contents first");
  // Confirmed, and the confirmation names the file.
  assert.match(del[0], /confirm\(/, "it asks first");
  assert.match(del[0], /row\.path/, "naming the path in the question");

  // The row is no longer itself a button: a click on Delete would also open the
  // model. Only the name opens.
  assert.match(src, /modelica-studio-saved-name", text: row\.name \}\)/, "the name is its own element");
  assert.match(src, /name\.addClass\("is-openable"\)/, "which is what becomes clickable");
  assert.ok(!/line\.addClass\("is-openable"\)/.test(src), "the whole row does not");

  // History: list, view, restore.
  assert.match(src, /listRevisions\(row\.name\)/, "earlier versions are counted");
  assert.match(src, /class RevisionModal/, "there is a history dialog");
  assert.match(src, /readRevision\(/, "a version can be read");
  assert.match(src, /setModelFromSource\(text\)/, "and restored");
});

test("the confirmation focuses the safe button", () => {
  // A stray Enter on a destructive dialog should cancel, not delete. One helper
  // serves both destructive actions — deleting a model and resetting the
  // settings — so the guard cannot be present in one and missing in the other.
  const src = fs.readFileSync(path.join(repoRoot, "src/view/confirm.ts"), "utf8");
  const confirm = /export function confirm\([\s\S]*?\n\}/.exec(src);
  assert.ok(confirm, "the confirmation is present");
  assert.match(confirm[0], /no\.focus\(\)/, "Cancel takes focus");
  assert.match(confirm[0], /modal\.onClose = \(\) => done\(false\)/, "and dismissing it is a no");

  for (const [file, what] of [
    ["src/view/saved-models-modal.ts", "deleting a model"],
    ["src/settings.ts", "resetting the settings"],
  ]) {
    const user = fs.readFileSync(path.join(repoRoot, file), "utf8");
    assert.match(user, /import \{ confirm \} from "\.\/(view\/)?confirm"/, `${what} asks through the shared helper`);
  }
});
