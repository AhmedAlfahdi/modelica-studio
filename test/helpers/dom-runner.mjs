/**
 * Run DOM tests in a real browser engine.
 *
 * The UI tests used to grep the source, which proves a line of code exists and
 * nothing about whether anything renders — a test could pass while the element is
 * never created, or created somewhere invisible. That is a real gap: most of the
 * UI in this plugin is verified that way.
 *
 * Electron is used rather than jsdom because it is already on the machine and is a
 * real engine. The package policy forbids install scripts, and jsdom's own
 * `prepare` script is blocked by it; Electron needs no installation at all.
 *
 * The bundle is built by esbuild with `obsidian` aliased to a stub, then loaded
 * into a blank page. Results come back as JSON over the bridge and are printed as
 * TAP, so the output reads like any other test in the suite.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Where the Electron binary lives, or null when it cannot be found. */
export function findElectron() {
  // Already used by the geometry harness in this repo.
  for (const name of ["electron43", "electron"]) {
    const found = spawnSync("which", [name], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  const local = path.join(process.cwd(), "node_modules", ".bin", "electron");
  return existsSync(local) ? local : null;
}

const RUNNER = `
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const pagePath = process.argv[2];
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1200, height: 900, show: false });
  const errors = [];
  win.webContents.on("console-message", (_e, level, message) => {
    // A page error is a failed test, not noise: the suite must not pass because a
    // module threw on import.
    if (level >= 2) errors.push(String(message));
  });
  await win.loadFile(pagePath);
  // The page sets this when its tests have finished.
  const results = await win.webContents.executeJavaScript("window.__done ? window.__results : null");
  if (results === null) {
    console.log("RESULT " + JSON.stringify({ fatal: "tests did not finish", errors }));
  } else {
    console.log("RESULT " + JSON.stringify({ results, errors }));
  }
  app.exit(0);
});
`;

/**
 * Build a page from `entry` and run it.
 *
 * Returns `{ results, errors }`, where each result is
 * `{ name, ok, error?, detail? }`.
 */
export function runInDom(entrySource, opts = {}) {
  // Set MST_DUMP_PAGE to write the composed page out instead of running it, which
  // is how a composition bug is told apart from a rendering one -- it is what
  // found a test asserting against a detached element.
  if (process.env.MST_DUMP_PAGE) {
    const { writeFileSync, existsSync } = require("node:fs");
    const base = process.env.MST_DUMP_PAGE;
    let n = 1;
    while (existsSync(`${base}.${n}`)) n++;
    writeFileSync(`${base}.${n}`, entrySource, "utf8");
    return { skip: "dumped" };
  }
  const electron = findElectron();
  if (!electron) return { skip: "no electron binary found" };

  const dir = mkdtempSync(path.join(tmpdir(), "mst-dom-"));
  const entry = path.join(dir, "entry.js");
  const page = path.join(dir, "index.html");
  const runner = path.join(dir, "runner.cjs");
  writeFileSync(entry, entrySource, "utf8");
  writeFileSync(runner, RUNNER, "utf8");
  writeFileSync(
    page,
    `<!doctype html><meta charset="utf-8"><body><script type="module" src="./bundle.js"></script></body>`,
    "utf8"
  );

  const esbuild = path.join(process.cwd(), "node_modules", ".bin", "esbuild");
  // Node builtins appear through the plugin's own imports -- the backend spawns
  // processes, and the history store reads files. None of that runs in a DOM test,
  // so each is aliased to an empty module rather than pulling a Node shim into the
  // browser bundle.
  const empty = path.join(process.cwd(), "test/helpers/empty-module.ts");
  writeFileSync(empty, "export default {};\nexport const spawn = () => {};\n", "utf8");
  const builtins = [
    "node:child_process", "node:fs", "node:path", "node:os", "node:util",
    "node:crypto", "node:events", "node:stream", "node:url", "node:buffer",
    "fs", "path", "os", "child_process", "crypto", "util",
  ].map((m) => `--alias:${m}=${empty}`);

  const built = spawnSync(
    esbuild,
    [
      entry,
      "--bundle",
      "--format=esm",
      "--platform=browser",
      "--target=chrome120",
      `--outfile=${path.join(dir, "bundle.js")}`,
      "--log-level=error",
      // The stub stands in for the app's module.
      `--alias:obsidian=${path.join(process.cwd(), "test/helpers/obsidian-stub.ts")}`,
      ...builtins,
    ],
    { encoding: "utf8", cwd: process.cwd() }
  );
  if (built.status !== 0) {
    return { fatal: `esbuild failed:\n${built.stderr || built.stdout}` };
  }

  const run = spawnSync(electron, [runner, page], {
    encoding: "utf8",
    timeout: opts.timeout ?? 120000,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
  });
  const line = (run.stdout ?? "").split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) {
    return { fatal: `no result from electron\n${run.stdout}\n${run.stderr}`.slice(0, 2000) };
  }
  return JSON.parse(line.slice("RESULT ".length));
}

/**
 * The preamble every DOM entry needs: the results array, a `test` function and a
 * `finish` call. Kept here so each test file is only its assertions.
 */
export const DOM_PREAMBLE = `
window.__results = [];
window.__done = false;
window.test = function (name, fn) {
  try {
    const detail = fn();
    window.__results.push({ name, ok: true, detail: detail === undefined ? "" : String(detail) });
  } catch (err) {
    window.__results.push({ name, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
window.finish = function () { window.__done = true; };
`;
