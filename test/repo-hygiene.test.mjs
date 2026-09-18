/**
 * The repository should contain sources, not compiler output.
 *
 * A whole OpenModelica build tree reached the repository in f1d55c4 — 58 files
 * including the compiled `BouncingBall` binary and its `_res.mat` — because one
 * `buildModel` run happened in the root and `git add -A` swept it up. Nothing
 * failed at the time; it was noticed two days later in a file listing.
 *
 * `.gitignore` covers the extensions. This covers the rest, and a comment in a
 * `.gitignore` cannot be wrong out loud, so it is a test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

function check() {
  try {
    const out = execFileSync("node", ["scripts/check-repo.mjs"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return { ok: true, out };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

test("no OpenModelica build output is committed", () => {
  const result = check();
  assert.ok(result.ok, `the repository carries build output:\n${result.out}`);
  assert.match(result.out, /Repository clean/, "and it says so");
});

test("the check would notice, rather than passing on anything", () => {
  // A guard that cannot fail is worse than none, because it reads as coverage.
  // This proves the detector fires by running it against a fake artifact, and the
  // shape it has to catch is the awkward one: a compiled Modelica model has NO
  // extension, so no ignore pattern can match it.
  const dir = mkdtempSync(path.join(os.tmpdir(), "repo-hygiene-"));
  const script = path.join(repoRoot, "scripts/check-repo.mjs");
  try {
    // A stand-in repository: the script only reads `git ls-files` and .gitignore.
    execFileSync("git", ["init", "-q"], { cwd: dir });
    writeFileSync(path.join(dir, ".gitignore"), "*.o\n*.libs\n*.makefile\n*_res.mat\n");
    writeFileSync(path.join(dir, "Tank"), "a compiled model\n");
    writeFileSync(path.join(dir, "Tank_01exo.o"), "an object file\n");
    execFileSync("git", ["add", "-f", "Tank", "Tank_01exo.o"], { cwd: dir });
    // The script resolves its repository from its own location, so copy it in.
    const local = path.join(dir, "scripts");
    mkdirSync(local, { recursive: true });
    writeFileSync(path.join(local, "check-repo.mjs"), readFileSync(script, "utf8"));
    let failed = false;
    let output = "";
    try {
      output = execFileSync("node", [path.join(local, "check-repo.mjs")], {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      failed = true;
      output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    assert.ok(failed, "the check must fail when build output is tracked");
    assert.match(output, /Tank/, "and name the extensionless binary");
    assert.match(output, /Tank_01exo\.o/, "and the object file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
