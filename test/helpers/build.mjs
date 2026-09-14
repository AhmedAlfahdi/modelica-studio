/**
 * Build a source entry to an ESM bundle for tests.
 *
 * `node --test` runs test files in parallel, and several files need the same
 * modules. Building straight into a shared output directory raced: one file
 * would delete the directory while another was importing from it, producing
 * failures that disappeared when a file was run on its own.
 *
 * The bundle is built into a unique temporary directory and then renamed into
 * place, so a concurrent reader only ever sees a complete directory, and a
 * rebuild never leaves the shared path missing.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/**
 * Where simulated models are compiled during tests.
 *
 * NOT the system temp directory. `/tmp` here is a 7.8 GB tmpfs, and each
 * simulated model leaves 20-30 MB of generated C, objects and a binary behind.
 * A few dozen runs of the suite filled it to 100%, at which point every write
 * in the session failed — including the test runner's own.
 *
 * `MODELICA_STUDIO_TEST_TMP` overrides it.
 */
const simRoot =
  process.env.MODELICA_STUDIO_TEST_TMP ?? path.join(repoRoot, "..", ".modelica-studio-test-tmp");

/**
 * Remove this process's simulated models.
 *
 * Only this process's: `node --test` runs each file in its own process, and
 * deleting the whole root on the first exit removed the directories other files
 * were still compiling into — which OpenModelica reports as "Model translation
 * failed", several tests away from the cause.
 */
/** Extra paths for this process to remove on the way out. */
const cleanups = [];

function registerCleanup(fn) {
  if (!registered) {
    registered = true;
    process.on("exit", cleanupSimRoot);
  }
  cleanups.push(fn);
}

export function cleanupSimRoot() {
  for (const fn of cleanups) {
    try {
      fn();
    } catch {
      /* Best effort: a leftover bundle is not worth failing a run over. */
    }
  }
  try {
    fs.rmSync(processDir, { recursive: true, force: true });
    // Then the root, which fails harmlessly while another process still uses it.
    fs.rmdirSync(simRoot);
  } catch {
    /* A leftover directory is not worth failing a test run over. */
  }
}

/** This process's directory under `simRoot`. */
const processDir = path.join(simRoot, String(process.pid));

/**
 * A directory for one test's compiled models, relative to `simRoot`.
 *
 * Reused across runs rather than made unique, so the run-time `-override` path
 * is still exercised — a fresh directory every time would always recompile.
 */
export function simCacheDir(name) {
  // Namespaced by process: `node --test` runs files in parallel, so two files
  // must not share a cache directory. Each file's own tests still share one, so
  // the run-time `-override` path is still exercised rather than recompiling.
  const dir = path.join(processDir, name);
  fs.mkdirSync(dir, { recursive: true });
  // Removed on the way out, including on failure: 30 MB per run fills a small
  // filesystem given enough of them.
  if (!registered) {
    registered = true;
    process.on("exit", cleanupSimRoot);
  }
  return dir;
}

let registered = false;

/**
 * A temporary directory for one test, removed when this process exits.
 *
 * Separate from the system temp directory because these hold real library
 * indexes — 30 MB each — and the system temp here is a small tmpfs. One file
 * built thirteen of them per run, which filled it.
 */
export function testTmpDir(prefix = "mo-test-") {
  // The parent exists only once something has needed it, so a file whose first
  // use is a temp dir would otherwise fail on the missing directory.
  fs.mkdirSync(processDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(processDir, prefix));
  if (!registered) {
    registered = true;
    process.on("exit", cleanupSimRoot);
  }
  return dir;
}

/**
 * Bundle `entries` (relative to the repo root) into a stable directory named
 * after `name`, and return that directory. Safe to call from parallel files.
 */
export function buildLibs(name, entries) {
  // Namespaced by process. `node --test` runs files in parallel, and two files
  // needing the same bundle otherwise share one output path: the second swap
  // deletes the directory the first is importing from, and a module that fails
  // to load surfaces far away — as "Model translation failed" from a simulation.
  const outDir = path.join(os.tmpdir(), `mo-plugin-${name}-${process.pid}`);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), `mo-build-${name}-`));
  try {
    execFileSync(
      "npx",
      [
        "esbuild",
        ...entries,
        "--bundle",
        "--format=esm",
        "--platform=node",
        `--outdir=${staging}`,
        "--log-level=error",
      ],
      { cwd: repoRoot, stdio: "pipe" }
    );
    // Swap in atomically: rename is atomic within a filesystem, so a reader
    // never observes a partially written or missing directory.
    const previous = `${outDir}.old-${process.pid}`;
    if (fs.existsSync(outDir)) fs.renameSync(outDir, previous);
    fs.renameSync(staging, outDir);
    fs.rmSync(previous, { recursive: true, force: true });
    // The bundle is only needed for this process's lifetime, and its directory
    // is unique to the process, so nothing else can be reading it.
    registerCleanup(() => fs.rmSync(outDir, { recursive: true, force: true }));
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }
  return outDir;
}

/** Bundle one entry and return the ESM module path for it. */
export function buildLib(name, entry) {
  const dir = buildLibs(name, [entry]);
  return path.join(dir, path.basename(entry).replace(/\.ts$/, ".js"));
}
