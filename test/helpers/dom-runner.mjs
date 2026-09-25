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
  win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    // A page error is a failed test, not noise: the suite must not pass because a
    // module threw on import. The source and line come along because a rare failure
    // under parallel load is otherwise a message with no place attached: one test in
    // this suite fails roughly once in ten full runs with a page error nobody can
    // locate from the text alone.
    // The one message Chromium reports at error level that is not an error: a
    // ResizeObserver that delivered its notifications in the same frame. It says
    // the observer was busy, not that anything failed, and it appears when several
    // DOM tests lay out at once -- which is why it surfaced only in a full run.
    const benign =
      String(message).includes("ResizeObserver loop") &&
      String(message).includes("undelivered notifications");
    if (level >= 2 && !benign) {
      // A plain string replace: this whole runner is generated from a template literal,
      // and a regex here needs four backslashes to survive the trip.
      const where = sourceId ? " (" + String(sourceId).split("file://").join("") + ":" + line + ")" : "";
      errors.push(String(message) + where);
    }
  });
  await win.loadFile(pagePath);
  // The page sets this when its tests have finished.
  // Polled: the tests may be asynchronous, and finish() then lands after the load.
  let results = null;
  // 120 seconds of polling, not 30. The tests in a page are awaited and chained now, so a
  // page with many cases takes longer than it did, and the suite runs these files in
  // parallel -- under that load a 30 s budget reported "tests did not finish" for pages
  // that pass in a second on their own.
  for (let i = 0; i < 480 && results === null; i++) {
    results = await win.webContents.executeJavaScript("window.__done ? window.__results : null");
    if (results === null) await new Promise((r) => setTimeout(r, 250));
  }
  if (results === null) {
    console.log("RESULT " + JSON.stringify({ fatal: "tests did not finish", errors, unsettled: [] }));
  } else {
    console.log("RESULT " + JSON.stringify({ results, errors, unsettled: await win.webContents.executeJavaScript("window.__unsettled") }));
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
    "node:process",
    "fs", "path", "os", "child_process", "crypto", "util", "process",
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
    timeout: opts.timeout ?? 300000,
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
// Parsed at import: a backtick left in the preamble ends the template early and the
// syntax error surfaces as "esbuild failed" in whichever test runs next, pointing at the
// wrong file. This says so immediately, with the message.
/** @type {string} */
export const DOM_PREAMBLE = `
window.__results = [];
window.__done = false;
window.__pending = [];
window.__unsettled = [];
window.test = function (name, fn) {
  // Started when registered, and NOT waited for -- the behaviour every page here was
  // written against. What is new is that a case which has not settled by the time the page
  // says it is finished is RECORDED in window.__unsettled, reported by the runner.
  //
  // That matters because a case returning a promise used to be scored before it ran, so an
  // assertion could pass without executing. Awaiting them all is the real fix, and it
  // surfaced four genuine defects -- an infinite recursion in the editor's fit, a caret
  // restore that threw on a detached node, and two assertions that had never run -- but it
  // also changed the timing ten pages depend on, so it is a migration rather than a
  // one-line change. Until then, this says which cases are being trusted without evidence
  // instead of staying silent about them.
  let settled = false;
  const run = (async () => {
    try {
      const detail = await fn();
      window.__results.push({ name, ok: true, detail: detail === undefined ? "" : String(detail) });
    } catch (err) {
      window.__results.push({ name, ok: false, error: String(err && err.message ? err.message : err) });
    } finally {
      settled = true;
      const i = window.__unsettled.indexOf(name);
      if (i >= 0) window.__unsettled.splice(i, 1);
    }
  })();
  window.__pending.push(run);
  window.__unsettled.push(name);
  void settled;
  return run;
};
window.finish = function () {
  // Wait for every case that has been registered -- and for any a case registers in
  // turn -- before saying the page is done. The runner reads \`__results\` the moment
  // this flag is true, so setting it while a case was still awaiting its assertions
  // scored the page by whichever cases happened to have finished first. That is the
  // whole of the flake this harness has been living with: a full-suite run reported
  // \`results: [], unsettled: ["..."]\` for a file that passes alone, because the
  // case had not settled when the page declared itself finished.
  //
  // The cases still START on registration, in the order they are written, so nothing
  // about their timing relative to each other changes -- only the moment the runner
  // is allowed to read them.
  const settle = function () {
    Promise.allSettled(window.__pending).then(function () {
      if (window.__unsettled.length > 0) {
        settle();
        return;
      }
      window.__done = true;
    });
  };
  settle();
};
`;

try {
  // eslint-disable-next-line no-new-func
  new Function(DOM_PREAMBLE);
} catch (err) {
  throw new Error(
    `DOM_PREAMBLE does not parse (a stray backtick in a comment ends the template early): ${err.message}`
  );
}
