#!/usr/bin/env node
/**
 * Fail if OpenModelica build output is sitting in the repository.
 *
 * `buildModel` writes generated C, objects, a makefile, an executable and a results
 * file into its working directory. A whole BouncingBall build tree — 58 files,
 * including the compiled binary and its `_res.mat` — reached the repository in
 * f1d55c4 because one run happened in the root and `git add -A` swept it up.
 *
 * `.gitignore` covers the extensions, but a compiled Modelica model has NO
 * extension, so no pattern can match it. This checks for the shape instead: a
 * tracked file with no extension, at the repository root, that is not one of the
 * few extensionless files a project of this kind legitimately has.
 *
 * Run by the test suite, so it fails there rather than being noticed months later
 * in a file listing.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

/** Extensionless files that belong in the root. */
const ALLOWED_BARE = new Set([
  "LICENSE",
  "NOTICE",
  "README",
  "CHANGELOG",
  "Makefile",
  "Dockerfile",
  "Procfile",
]);

/** Extensions `buildModel` produces, which are never sources in this project. */
const BUILD_EXT = /\.(o|libs|makefile|mat|log)$|_init\.xml$|_info\.json$/;

const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const offenders = tracked.filter((file) => {
  if (file.includes("/")) return false; // only the root, where it happened
  if (BUILD_EXT.test(file)) return true;
  // A compiled model: no extension, and not a name the project uses.
  const hasExtension = /\.[A-Za-z0-9]+$/.test(file);
  return !hasExtension && !ALLOWED_BARE.has(file);
});

// And confirm the ignore rules are actually in place, so a NEW build in the root is
// ignored by git rather than being committed first and caught afterwards.
const ignore = readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
const missing = ["*.o", "*.libs", "*.makefile", "*_res.mat"].filter((rule) => !ignore.includes(rule));

if (offenders.length || missing.length) {
  if (offenders.length) {
    console.error(`OpenModelica build output is tracked in the repository root:`);
    for (const file of offenders.slice(0, 20)) console.error(`  ${file}`);
    if (offenders.length > 20) console.error(`  …and ${offenders.length - 20} more`);
    console.error(`\nRemove it with:  git rm --cached <files>`);
  }
  if (missing.length) {
    console.error(`.gitignore is missing rules: ${missing.join(", ")}`);
  }
  process.exit(1);
}

console.log(`Repository clean: no build output among ${tracked.length} tracked files.`);
