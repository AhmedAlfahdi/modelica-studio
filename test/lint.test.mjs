/**
 * The plugin directory's own linter, as a test.
 *
 * The submission review runs `eslint-plugin-obsidianmd`'s recommended config over the
 * source, and a submission is a bad place to see that list for the first time: a style
 * finding means a rewrite in public, and an error holds the plugin out of the directory
 * until it is fixed. `eslint.config.mjs` reproduces the same rules with the same
 * severities, so this test is the review, run locally.
 *
 * It is the slowest test in the suite (type-aware linting over the whole source: about
 * forty seconds), which is why it is one test rather than one per rule. Skipped when
 * eslint is not installed — the suite is otherwise usable without the dev tooling.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./helpers/build.mjs";

const eslint = path.join(repoRoot, "node_modules", ".bin", "eslint");
const config = path.join(repoRoot, "eslint.config.mjs");

test("the source passes the plugin directory's linter", { skip: !fs.existsSync(eslint) && "eslint is not installed" }, () => {
  let out = "";
  let status = 0;
  try {
    out = execFileSync(eslint, ["src", "-f", "json"], { cwd: repoRoot, encoding: "utf8" });
  } catch (err) {
    status = 1;
    out = String(err.stdout ?? "");
  }

  const files = JSON.parse(out.slice(out.indexOf("[")));
  const errors = [];
  const warnings = [];
  for (const file of files) {
    const rel = path.relative(repoRoot, file.filePath);
    for (const m of file.messages) {
      const line = `${rel}:${m.line}:${m.column} ${m.ruleId ?? "parse"} ${String(m.message).split("\n")[0]}`;
      if (m.severity === 2) errors.push(line);
      else warnings.push(line);
    }
  }

  // Errors are what the directory refuses to publish: none are allowed, and the message
  // lists them so a failure says what to fix rather than "lint failed".
  assert.deepEqual(errors, [], `${errors.length} lint errors:\n  ${errors.join("\n  ")}`);

  // Warnings are allowed through, but the list is asserted so that it is a KNOWN list. A
  // new warning fails this test, which is the point: the count only ever moves because
  // someone decided it should.
  const allowed = warnings.every(
    (w) =>
      w.includes("@typescript-eslint/no-deprecated") ||
      w.includes("obsidianmd/settings-tab/prefer-setting-definitions")
  );
  assert.ok(
    allowed,
    `unexpected lint warnings:\n  ${warnings.filter((w) => !w.includes("no-deprecated") && !w.includes("prefer-setting-definitions")).join("\n  ")}`
  );
  assert.ok(warnings.length >= 1, "the two known warning families are still being reported");
  void status;
  void config;
});
