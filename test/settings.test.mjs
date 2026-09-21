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
    "export class App {}\n" +
    // The save folder field completes from the vault's folders.
    "export class AbstractInputSuggest { constructor(app, el) { this.app = app; this.inputEl = el; } " +
    "onSelect() { return this; } close() {} }\n" +
    "export class TFolder {}\n" +
    // TFile is used at run time -- the saved-models list tests each tracked path
    // with `instanceof TFile` -- so it must be a real class here, not a type.
    // Notice is called by the saved-models repair button.
    "export class Notice { constructor(message) { this.message = message; } }\n" +
    "export class TFile { constructor(path) { this.path = path; this.extension = (path.split('.').pop() || ''); } }\n" +
    // The settings tab builds a SecretComponent, so the stub must export it or
    // the module fails to instantiate at import time.
    "export class SecretComponent { constructor(app, el) { this.app = app; this.el = el; } " +
    "setValue(v) { this.value = v; return this; } onChange(cb) { this.cb = cb; return this; } }\n"
);
const { DEFAULT_SETTINGS, mergeSettings } = await import(path.join(staging, "settings.js"));

// The plot, for the one number the two modules have to agree on: the snap
// distance the settings ship with, and the distance the plot falls back to when
// no setting reaches it. Two literals in two files stay equal only by luck, so
// this compares them.
execFileSync(
  "npx",
  [
    "esbuild",
    "src/view/plot.ts",
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--outfile=${path.join(staging, "plot.js")}`,
    "--log-level=error",
  ],
  { cwd: repoRoot, stdio: "pipe" }
);
const plotMod = await import(path.join(staging, "plot.js"));

test("wire weight and the two readout sizes are settings of their own", () => {
  // Asked for separately, and separate they are: wires are diagram geometry, the
  // plot readout is read on the plot, and the parameter popup is read over a
  // diagram. Wanting one larger says nothing about the others.
  for (const key of ["wireScale", "plotReadoutScale", "diagramReadoutScale"]) {
    assert.equal(DEFAULT_SETTINGS[key], 1, `${key} starts at the standard size`);
  }

  const older = mergeSettings(DEFAULT_SETTINGS, { stopTime: 5 });
  assert.equal(older.wireScale, 1, "an older data.json gains the wire weight");
  assert.equal(older.plotReadoutScale, 1, "and the plot readout size");
  assert.equal(older.diagramReadoutScale, 1, "and the popup size");

  const chosen = mergeSettings(DEFAULT_SETTINGS, {
    wireScale: 1.6,
    plotReadoutScale: 1.8,
    diagramReadoutScale: 1.3,
  });
  assert.equal(chosen.wireScale, 1.6, "a stored value wins");
  assert.equal(chosen.plotReadoutScale, 1.8);
  assert.equal(chosen.diagramReadoutScale, 1.3);
  // And they are not the same key: the diagram's popup has its own.
  assert.notEqual(chosen.plotReadoutScale, chosen.diagramReadoutScale);
});

test("the crossing snap is on by default, at the distance the plot itself uses", () => {
  // Reported as: tell me whether it is on, and how far it reaches. Both are now
  // settings, so both have to survive a data.json written before they existed --
  // and the distance has to be the SAME number the renderer falls back to, or a
  // caller that passes no tolerance would behave like a different plugin.
  assert.equal(DEFAULT_SETTINGS.plotSnapCrossings, true, "the snap is on out of the box");
  assert.equal(
    DEFAULT_SETTINGS.plotSnapTolerance,
    plotMod.SNAP_TOLERANCE_PX,
    "the default distance is the renderer's own fallback"
  );

  const older = mergeSettings(DEFAULT_SETTINGS, { stopTime: 5 });
  assert.equal(older.plotSnapCrossings, true, "an older data.json gains the switch");
  assert.equal(older.plotSnapTolerance, plotMod.SNAP_TOLERANCE_PX, "and the distance");

  const chosen = mergeSettings(DEFAULT_SETTINGS, { plotSnapCrossings: false, plotSnapTolerance: 15 });
  assert.equal(chosen.plotSnapCrossings, false, "a stored choice wins");
  assert.equal(chosen.plotSnapTolerance, 15);
});

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
  const settings = fs.readFileSync(path.join(repoRoot, "src/settings-merge.ts"), "utf8");
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

test("diagram label settings have usable defaults", () => {
  // Both are read on every frame by the editor, so they must exist on a fresh
  // install AND on a vault whose data.json predates them -- `mergeSettings`
  // starts from the defaults, which is what makes the second case work.
  assert.equal(DEFAULT_SETTINGS.labelScale, 1, "labels are unscaled by default");
  assert.equal(DEFAULT_SETTINGS.hoverParameters, true, "and the hover readout is on");

  // A stored file from before these existed.
  const merged = mergeSettings(DEFAULT_SETTINGS, { stopTime: 5 });
  assert.equal(merged.labelScale, 1, "an older data.json gains the label scale");
  assert.equal(merged.hoverParameters, true, "and the hover option");
  assert.equal(merged.stopTime, 5, "without losing what it did store");

  // A stored value wins over the default.
  const chosen = mergeSettings(DEFAULT_SETTINGS, { labelScale: 1.6, hoverParameters: false });
  assert.equal(chosen.labelScale, 1.6);
  assert.equal(chosen.hoverParameters, false);
});
