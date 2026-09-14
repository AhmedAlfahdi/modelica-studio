/**
 * Settings defaults.
 *
 * `settings.ts` imports from the `obsidian` module, which does not exist in
 * Node, so it is bundled with that import left external and resolved to a stub.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoRoot, testTmpDir } from "./helpers/build.mjs";

const staging = testTmpDir("mo-settings-");
execFileSync(
  "npx",
  [
    "esbuild",
    "src/settings.ts",
    "--bundle",
    "--format=esm",
    "--platform=node",
    "--external:obsidian",
    `--outdir=${staging}`,
    "--log-level=error",
  ],
  { cwd: repoRoot, stdio: "pipe" }
);
// Provide the stub as a resolvable package, since the bundle keeps a bare
// `obsidian` import that has no Node equivalent.
const pkgDir = path.join(staging, "node_modules", "obsidian");
fs.mkdirSync(pkgDir, { recursive: true });
fs.writeFileSync(
  path.join(pkgDir, "package.json"),
  JSON.stringify({ name: "obsidian", version: "0.0.0", type: "module", main: "index.js" })
);
fs.writeFileSync(
  path.join(pkgDir, "index.js"),
  "export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }\n" +
    "export class Setting { constructor() {} }\n" +
    "export class App {}\n"
);
const { DEFAULT_SETTINGS } = await import(path.join(staging, "settings.js"));

test("coordinate diagnostics default to off", () => {
  // They are a debugging aid. Earlier they were always on, which drew boxes,
  // callouts and a viewport readout over every diagram — a visual bug in itself.
  assert.equal(
    DEFAULT_SETTINGS.debugOverlay,
    false,
    "the coordinate overlay must not be enabled for ordinary users"
  );
});

test("the diagnostic log is a separate, also-off setting", () => {
  // Writing a log file and drawing an overlay are different concerns; turning on
  // one must not imply the other.
  assert.equal(DEFAULT_SETTINGS.debugLog, false);
  assert.equal(typeof DEFAULT_SETTINGS.debugOverlay, "boolean");
});

test("defaults are safe on a machine with no configuration", () => {
  assert.equal(DEFAULT_SETTINGS.omcPath, "");
  assert.ok(DEFAULT_SETTINGS.jobs >= 1, "at least one compile job");
  assert.ok(DEFAULT_SETTINGS.stopTime > 0);
  assert.ok(DEFAULT_SETTINGS.numberOfIntervals > 0);
});

test("the simulation span is per model, not shared", () => {
  // A single shared value meant setting 4 s for one model changed every inline
  // block in every note whose model had no span of its own — a tank that drains
  // over 20 s would be integrated over 4 and its curve would read as straight.
  const main = fs.readFileSync(path.join(repoRoot, "src/main.ts"), "utf8");
  const settings = fs.readFileSync(path.join(repoRoot, "src/settings.ts"), "utf8");
  const embed = fs.readFileSync(path.join(repoRoot, "src/view/embed.ts"), "utf8");

  assert.ok(settings.includes("modelStopTimes: Record<string, number>"), "spans are keyed by model");
  assert.ok(
    main.includes("this.settings.modelStopTimes[model] ?? findExample(model)?.stopTime"),
    "a model's own span wins, then its example's, then the default"
  );
  assert.ok(main.includes("setStopTime(seconds: number"), "a span can be recorded for one model");
  assert.ok(
    main.includes("this.settings.modelStopTimes[model] = seconds"),
    "and it is stored against that model"
  );
  // The block asks for its OWN model's span rather than a global setting.
  assert.ok(
    embed.includes("return this.host.stopTimeFor(model)"),
    "a block resolves the span for its own model"
  );
  // A span saved by the previous single-value scheme is migrated.
  assert.ok(
    main.includes("this.settings.modelStopTimes[this.model.name] ??= data.modelStopTime"),
    "an older saved span is migrated rather than dropped"
  );
});
