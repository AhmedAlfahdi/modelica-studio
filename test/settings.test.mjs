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
    // The reset button asks first, and the confirmation is a Modal.
    "export class Modal { constructor(app) { this.app = app; this.titleEl = { setText() {} }; " +
    "this.contentEl = document.createElement('div'); } open() {} close() {} }\n" +
    "export class TFile { constructor(path) { this.path = path; this.extension = (path.split('.').pop() || ''); } }\n" +
    // The settings tab builds a SecretComponent, so the stub must export it or
    // the module fails to instantiate at import time.
    "export class SecretComponent { constructor(app, el) { this.app = app; this.el = el; } " +
    "setValue(v) { this.value = v; return this; } onChange(cb) { this.cb = cb; return this; } }\n"
);
const merge = await import(path.join(staging, "settings.js"));
const { DEFAULT_SETTINGS, mergeSettings } = merge;
// The band, from the module that defines it: a test-local copy could drift.
const STROKE_SCALE_MIN_D = merge.STROKE_SCALE_MIN;
const STROKE_SCALE_MAX_D = merge.STROKE_SCALE_MAX;

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
  // The readouts start at the standard size. The two WEIGHTS do not: 100% is the
  // library's own weight and stays the reference the percentages are measured
  // against, but the defaults are a taste — wires a little lighter than the
  // library draws them and symbols noticeably heavier — chosen from looking at
  // diagrams rather than derived from anything.
  for (const key of ["plotReadoutScale", "diagramReadoutScale"]) {
    assert.equal(DEFAULT_SETTINGS[key], 1, `${key} starts at the standard size`);
  }
  assert.equal(DEFAULT_SETTINGS.wireScale, 0.9, "the wire default is a taste, not the standard");
  assert.equal(DEFAULT_SETTINGS.symbolStrokeScale, 1.9, "and so is the component default");
  for (const key of ["wireScale", "symbolStrokeScale"]) {
    const v = DEFAULT_SETTINGS[key];
    assert.ok(
      v >= STROKE_SCALE_MIN_D && v <= STROKE_SCALE_MAX_D,
      `${key} is inside the band the sliders offer (${v})`
    );
  }

  // An older data.json gains them, and a stored value always wins over them.
  const older = mergeSettings(DEFAULT_SETTINGS, { stopTime: 5 });
  assert.equal(older.wireScale, 0.9, "an older data.json gains the wire default");
  assert.equal(older.symbolStrokeScale, 1.9, "and the component default");
  assert.equal(
    mergeSettings(DEFAULT_SETTINGS, { wireScale: 1.4 }).wireScale,
    1.4,
    "while a value that was stored is left exactly as it was"
  );
  assert.equal(
    older.syncStrokeScale,
    false,
    "the link is off for a stored document: an added setting must not move an existing diagram"
  );
  assert.equal(older.plotReadoutScale, 1, "and the plot readout size");
  assert.equal(older.diagramReadoutScale, 1, "and the popup size");

  const chosen = mergeSettings(DEFAULT_SETTINGS, {
    wireScale: 1.6,
    symbolStrokeScale: 2.2,
    plotReadoutScale: 1.8,
    diagramReadoutScale: 1.3,
  });
  assert.equal(chosen.wireScale, 1.6, "a stored value wins");
  assert.equal(chosen.symbolStrokeScale, 2.2, "including the component line weight");
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

test("the link resolves the two thicknesses in one place", () => {
  // The Studio, an embedded diagram and the Help legend all ask this, so the
  // meaning of "linked" is decided once.
  const { effectiveStrokeScales } = merge;
  assert.deepEqual(
    effectiveStrokeScales({ wireScale: 3, symbolStrokeScale: 2.2, syncStrokeScale: false }),
    { wires: 3, symbols: 2.2 },
    "unlinked, each keeps its own value"
  );
  assert.deepEqual(
    effectiveStrokeScales({ wireScale: 3, symbolStrokeScale: 2.2, syncStrokeScale: true }),
    { wires: 2.2, symbols: 2.2 },
    "linked, the wires follow the component weight — the symbol is the reference, because the library draws its graphics and the wire follows the connector"
  );
});

test("a stored thickness above the standard's band is brought into it", () => {
  // The wire slider offered up to 1000% because a wire used to be drawn 1.47x a
  // symbol line declaring the same thickness, which made ten times it look
  // reasonable. With MSL's scale the band is 50-400%, and a stored value outside
  // it is clamped — otherwise the slider would show 400% while the diagram drew
  // 1000%.
  const { DEFAULT_SETTINGS: D, migrateSettings, STROKE_SCALE_MIN, STROKE_SCALE_MAX, effectiveStrokeScales } = merge;
  assert.equal(STROKE_SCALE_MIN, 0.5, "the band's floor");
  assert.equal(STROKE_SCALE_MAX, 4, "and its ceiling");

  const wild = migrateSettings({ ...D, wireScale: 10, symbolStrokeScale: 2 }, { wireScale: 10 });
  assert.equal(wild.wireScale, 4, "1000% is clamped to the ceiling");
  assert.equal(wild.symbolStrokeScale, 2, "and a value inside the band is left alone");

  const tiny = migrateSettings({ ...D, wireScale: 0.1 }, { wireScale: 0.1 });
  assert.equal(tiny.wireScale, 0.5, "below the floor it is lifted to it");

  // A linked pair cannot be left disagreeing by an older file either.
  const linked = migrateSettings({ ...D, wireScale: 3, symbolStrokeScale: 1.5, syncStrokeScale: true }, {});
  assert.deepEqual(
    effectiveStrokeScales(linked),
    { wires: 1.5, symbols: 1.5 },
    "linked, the wire takes the component value whatever was stored"
  );
});

test("a reset puts the preferences back and keeps the work", () => {
  // The settings object holds BOTH: how the plugin looks and behaves, and what
  // records the user's sessions. A reset that took the second would be a data
  // loss disguised as a preference.
  const { resetPreferences, PRESERVED_ON_RESET } = merge;
  const live = {
    ...DEFAULT_SETTINGS,
    solver: "ida",
    stopTime: 42,
    jobs: 1,
    labelScale: 2.4,
    wireScale: 3.5,
    symbolStrokeScale: 1.2,
    inspectorWidth: 500,
    editorMode: "code",
    excludedLibraries: "Modelica.Fluid",
    ai: { ...DEFAULT_SETTINGS.ai, model: "someone-elses-model", secretName: "MY_KEY" },
    // The work:
    modelFiles: { Tank: "Modelica/Tank.mo", Motor: "Modelica/DCMotor.mo" },
    modelStopTimes: { Tank: 20 },
    charts: { Tank: { hidden: ["tank.level"], xMin: 0, xMax: 5 } },
    aiModels: ["gpt-5", "local-llama"],
  };

  const { settings: next, reset, kept } = resetPreferences(live);

  // Preferences: back to the defaults.
  for (const key of ["solver", "stopTime", "jobs", "labelScale", "wireScale", "symbolStrokeScale", "inspectorWidth", "editorMode", "excludedLibraries"]) {
    assert.deepEqual(next[key], DEFAULT_SETTINGS[key], `${key} is back to its default`);
  }
  assert.equal(next.ai.model, DEFAULT_SETTINGS.ai.model, "the AI model choice is a preference");
  assert.equal(next.ai.secretName, "MY_KEY", "but the secret's NAME is a pointer to a stored key");
  assert.ok(reset.includes("solver") && reset.includes("wireScale"), `the notice names what changed (${reset.join(", ")})`);

  // Work: untouched, and by reference, because the plugin keeps using the object
  // it already holds.
  for (const key of PRESERVED_ON_RESET) {
    assert.deepEqual(next[key], live[key], `${key} is kept`);
  }
  assert.deepEqual(kept.sort(), ["aiModels", "charts", "modelFiles", "modelStopTimes"], `kept names them (${kept.join(", ")})`);

  // Applying it must leave the live object with the same records, and the
  // defaults everywhere else.
  Object.assign(live, next);
  assert.equal(live.solver, DEFAULT_SETTINGS.solver);
  assert.equal(live.modelFiles.Motor, "Modelica/DCMotor.mo", "the model registry survives the reset");
  assert.equal(live.modelStopTimes.Tank, 20, "and the per-model stop time");
  assert.deepEqual(live.charts.Tank.hidden, ["tank.level"], "and the chart setup");
  assert.deepEqual(live.aiModels, ["gpt-5", "local-llama"], "and the AI model list");
});

test("a reset with nothing to keep says so", () => {
  const { resetPreferences } = merge;
  const { reset, kept } = resetPreferences({ ...DEFAULT_SETTINGS });
  assert.deepEqual(reset, [], "nothing was changed, so nothing is named");
  assert.deepEqual(kept, [], "and there was no work to keep");
});

test("a reset does not delete a plaintext key that is still the only copy", () => {
  // The migration moves an old plaintext key into Obsidian's secret storage and
  // removes it from the settings -- but only AFTER the secret is written. With no
  // keychain, or when writing it threw, the plaintext key is all the user has, and
  // the Reset dialog only ever promised to keep the secret's NAME.
  const { resetPreferences } = merge;
  const live = {
    ...DEFAULT_SETTINGS,
    solver: "ida",
    ai: {
      ...DEFAULT_SETTINGS.ai,
      baseUrl: "https://api.deepseek.com/v1",
      secretName: "MODELICA_STUDIO_KEY",
      apiKey: "sk-legacy-plaintext",
    },
  };

  const { settings: next, kept } = resetPreferences(live);

  assert.equal(next.ai.apiKey, "sk-legacy-plaintext", "the key survived the reset");
  assert.equal(next.ai.secretName, "MODELICA_STUDIO_KEY", "and so did the secret's name");
  assert.equal(next.ai.baseUrl, DEFAULT_SETTINGS.ai.baseUrl, "while the preferences went back");
  assert.ok(
    kept.some((k) => /AI key/.test(k)),
    `and the notice says the key was kept: ${kept.join(", ")}`
  );

  // With no legacy key there is nothing to keep, so the field stays absent.
  const clean = resetPreferences({ ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai } });
  assert.equal(clean.settings.ai.apiKey, undefined, "nothing invented");
});

test("a first session cannot edit the defaults through the settings object", () => {
  // With no data.json, mergeSettings handed out DEFAULT_SETTINGS' own nested
  // objects. Editing settings.ai then changed the DEFAULTS, so a later Reset
  // restored the user's value instead of the default and could not report "ai" as
  // reset -- a preference that could not be put back.
  const { resetPreferences } = merge;
  const fresh = mergeSettings(DEFAULT_SETTINGS, null);
  assert.notEqual(fresh.ai, DEFAULT_SETTINGS.ai, "the group is a copy, not the default object");

  fresh.ai.model = "someone-elses-model";
  fresh.ai.thinking = "high";
  assert.equal(DEFAULT_SETTINGS.ai.model !== "someone-elses-model", true, "the default is untouched");
  assert.notEqual(DEFAULT_SETTINGS.ai.thinking, "high", "and so is every other field");

  const { settings: next, reset } = resetPreferences(fresh);
  assert.equal(next.ai.model, DEFAULT_SETTINGS.ai.model, "a reset puts the model back");
  assert.ok(reset.includes("ai"), `and says so: ${reset.join(", ")}`);

  // The same leak, one level down: a stored config that simply lacks `ai`.
  const partial = mergeSettings(DEFAULT_SETTINGS, { stopTime: 5 });
  assert.notEqual(partial.ai, DEFAULT_SETTINGS.ai, "an absent group is still a copy");
  partial.ai.model = "third-party";
  const second = resetPreferences(partial);
  assert.equal(second.settings.ai.model, DEFAULT_SETTINGS.ai.model, "so a later reset restores it too");
});

test("the toolchain and library rows actually apply what they save", () => {
  // Four rows persisted their value and did nothing else: `applySettingsToBackend`
  // and `warmLibrary` each had exactly one caller, both inside onload, and the
  // library index is memoised. So setting the OpenModelica path after a failed
  // detection still said "not detected" until a restart, and adding a library path
  // never brought its classes into the palette.
  const tab = fs.readFileSync(path.join(repoRoot, "src/settings.ts"), "utf8");
  const main = fs.readFileSync(path.join(repoRoot, "src/main.ts"), "utf8");

  const row = (name) => {
    const at = tab.indexOf(`.setName("${name}")`);
    assert.ok(at > 0, `the row for ${name} exists`);
    return tab.slice(at, at + 900);
  };

  assert.match(row("OpenModelica path"), /reprobeToolchain\(\)/, "the path row re-probes");
  assert.match(row("Library paths"), /reloadLibrary\(\)/, "the library row rebuilds the index");
  assert.match(row("Parallel compile jobs"), /applySettingsToBackend\(\)/, "the jobs row reaches the backend");
  assert.match(row("Extra omc options"), /applySettingsToBackend\(\)/, "and so does the options row");

  // Both entry points exist, and each one drops what would otherwise be reused.
  const reprobe = /async reprobeToolchain\(\): Promise<void> \{[\s\S]*?\n  \}/.exec(main);
  assert.ok(reprobe, "reprobeToolchain is defined");
  assert.match(reprobe[0], /detectToolchain\(\)/, "it probes again");
  assert.match(reprobe[0], /this\.settingsTab\?\.display\(\)/, "and redraws the status box");

  const reload = /  reloadLibrary\(\): void \{[\s\S]*?\n  \}/.exec(main);
  assert.ok(reload, "reloadLibrary is defined");
  assert.match(reload[0], /this\.libraryIndex = null/, "the memoised index is dropped");
  assert.match(reload[0], /this\.libraryPromise = null/, "and so is an in-flight build");
  assert.match(reload[0], /this\.warmLibrary\(\)/, "before the rebuild is started");

  // The backend is built in ONE place, so a probe and a settings change cannot
  // disagree -- and detection no longer creates a backend and recreates it.
  const detect = /private async detectToolchain\(\): Promise<void> \{[\s\S]*?\n  \}/.exec(main);
  assert.ok(detect, "detectToolchain is defined");
  assert.doesNotMatch(detect[0], /createBackend\(/, "detection does not build its own backend");
  assert.match(detect[0], /this\.applySettingsToBackend\(\)/, "it goes through the shared path");
});

test("the stop-time row says which span it edits, and the default is settable", () => {
  // The row was labelled "Default end time in seconds" and wrote the OPEN model's
  // span (`setStopTime`), so `settings.stopTime` -- the plugin-wide default, reset
  // by Reset, and the value a block with no model name uses -- was assigned nowhere
  // in the tree. A new model therefore always ran over 1 s and no UI could change it.
  const tab = fs.readFileSync(path.join(repoRoot, "src/settings.ts"), "utf8");
  const main = fs.readFileSync(path.join(repoRoot, "src/main.ts"), "utf8");

  const perModel = /\.setName\("Stop time for this model"\)[\s\S]*?\n      \);/.exec(tab);
  assert.ok(perModel, "the per-model row exists and says so");
  assert.match(perModel[0], /this\.plugin\.setStopTime\(n\)/, "it writes this model's span");

  const fallback = /\.setName\("Default stop time"\)[\s\S]*?\n      \);/.exec(tab);
  assert.ok(fallback, "and a row for the default exists");
  assert.match(
    fallback[0],
    /this\.plugin\.settings\.stopTime = n/,
    "which writes the plugin-wide default"
  );

  // The default is what a model with no span of its own gets.
  const resolution = /  stopTime\(model = this\.model\.name\): number \{[\s\S]*?\n  \}/.exec(main);
  assert.ok(resolution, "stopTime() resolves the two");
  assert.match(resolution[0], /settings\.stopTime/, "with the plugin-wide default as the fallback");
});
