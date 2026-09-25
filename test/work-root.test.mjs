/**
 * The build cache under the system temporary folder, and the sweep over it.
 *
 * OpenModelica's scratch space is a directory per process: a compiled model and its
 * generated C are tens of megabytes, a re-run reuses them, and that is why they are not
 * deleted when a session ends. What is useless is the directory of a process that has
 * exited -- 201 had collected on this machine, from three days of work -- so the plugin
 * sweeps those when it starts and leaves the rest alone.
 *
 * Run over a real temporary directory here, because the part worth checking is which
 * DIRECTORIES disappear, not what a stub recorded being asked for.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";

const { defaultWorkRoot, isProcessAlive, sweepStaleWorkRoots, workRootParent } = await import(
  path.join(buildLibs("work-root", ["src/omc/work-root.ts"]), "work-root.js")
);

/** A fresh parent directory with the named entries as directories. */
function scratch(names, { age = 0 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mst-work-"));
  for (const name of names) {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    if (age > 0) {
      const at = (Date.now() - age) / 1000;
      fs.utimesSync(dir, at, at);
    }
  }
  return root;
}

const names = (root) => fs.readdirSync(root).sort();

test("the work root is this process's own directory", () => {
  assert.equal(defaultWorkRoot(4242, "/tmp"), path.join("/tmp", "modelica-studio", "4242"));
  assert.equal(workRootParent("/tmp"), path.join("/tmp", "modelica-studio"));
  // The default parent is the system temporary folder, not the vault and not the
  // plugin's own directory: a build is disposable, and it is tens of megabytes.
  assert.equal(path.dirname(defaultWorkRoot(process.pid)), path.join(os.tmpdir(), "modelica-studio"));
});

test("the sweep removes the roots of processes that are gone", () => {
  // A minute old: a directory created in the same millisecond as the sweep can carry
  // an mtime a fraction of a millisecond AFTER `Date.now()`, and the sweep keeps those
  // rather than racing them. That is the safe direction in production (the guard is an
  // hour), and it is asserted in its own test below.
  const root = scratch(["111", "222", "333", "not-a-pid.txt"], { age: 60_000 });
  fs.writeFileSync(path.join(root, "stray.txt"), "not ours\n");

  // Injected, so the assertion does not depend on which PIDs happen to exist: 111 is
  // this process, 222 is another live one, 333 has exited.
  const removed = sweepStaleWorkRoots(root, {
    currentPid: 111,
    alive: (pid) => pid === 111 || pid === 222,
    minAgeMs: 0,
  });

  assert.deepEqual(removed, ["333"], "exactly the exited process's directory");
  assert.deepEqual(names(root), ["111", "222", "not-a-pid.txt", "stray.txt"], "the live roots and anything not ours stay");
});

test("a young directory is kept even when its process cannot be seen", () => {
  // The guard for a shared temporary folder: another container's build can have a PID
  // this process cannot resolve, and deleting a build that is in progress is worse than
  // keeping a stale one.
  const fresh = scratch(["444"], { age: 0 });
  const old = scratch(["444"], { age: 3 * 60 * 60 * 1000 });
  const opts = { currentPid: 111, alive: () => false, minAgeMs: 60 * 60 * 1000 };

  assert.deepEqual(sweepStaleWorkRoots(fresh, opts), [], "a directory from a moment ago is left alone");
  assert.deepEqual(names(fresh), ["444"]);
  assert.deepEqual(sweepStaleWorkRoots(old, opts), ["444"], "an hour-old one from a gone process is removed");
  assert.deepEqual(names(old), []);
});

test("a directory whose timestamp is not in the past yet is kept", () => {
  // Clock skew, or a directory created in the same millisecond as the sweep: `now` can
  // sit a fraction of a millisecond BEHIND an mtime, and that must not read as "older
  // than the guard". Keeping it is the safe direction -- the next start sweeps it -- and
  // this is the case that made an earlier version of this file flaky.
  const root = scratch(["666"]);
  const removed = sweepStaleWorkRoots(root, {
    currentPid: 1,
    alive: () => false,
    minAgeMs: 60 * 60 * 1000,
    now: Date.now() - 24 * 60 * 60 * 1000,
  });
  assert.deepEqual(removed, [], "a future mtime is not evidence of an abandoned build");
  assert.deepEqual(names(root), ["666"]);
});

test("the sweep is safe on a root that does not exist, and reports what it did", () => {
  const missing = path.join(os.tmpdir(), `mst-none-${process.pid}-${Date.now()}`);
  assert.deepEqual(sweepStaleWorkRoots(missing, { alive: () => false, minAgeMs: 0 }), [], "nothing to sweep is not an error");
  // The return value is the list removed, so a caller can log it rather than guess.
  const root = scratch(["555"], { age: 60_000 });
  assert.deepEqual(sweepStaleWorkRoots(root, { currentPid: 1, alive: () => false, minAgeMs: 0 }), ["555"]);
  assert.deepEqual(sweepStaleWorkRoots(root, { currentPid: 1, alive: () => false, minAgeMs: 0 }), [], "and it is not repeated");
});

test("a process check answers for this process and for one that cannot exist", () => {
  assert.equal(isProcessAlive(process.pid), true, "this process is alive");
  // PID space is finite and this one is above every configured maximum on Linux and
  // macOS, so nothing can be running under it.
  assert.equal(isProcessAlive(2 ** 30), false, "a PID beyond the maximum is not alive");
});
