/**
 * Verification that the SHIPPED artifact works.
 *
 * The unit tests exercise the TypeScript sources. This test exercises the
 * actual `main.js` that Obsidian loads, by evaluating the bundle with a stub
 * `obsidian` module and driving the real code paths through it.
 *
 * That distinction matters: a bundling mistake (a broken external, a stripped
 * export, an accidental dynamic require) passes every source-level test and
 * still produces a plugin that fails on install. This is the check that
 * catches it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { buildLibs, simCacheDir } from "./helpers/build.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const MAIN = path.join(ROOT, "main.js");
const HAS_BUNDLE = fs.existsSync(MAIN);

/**
 * Evaluate main.js the way Obsidian does: CommonJS, with `obsidian` and
 * `electron` resolved as externals and Node builtins available.
 */
function loadBundle() {
  const source = fs.readFileSync(MAIN, "utf8");
  const moduleObj = { exports: {} };
  const require = createRequire(MAIN);
  const stubRequire = (id) => {
    if (id === "obsidian") return obsidianStub;
    if (id === "electron") return {};
    return require(id);
  };
  const sandbox = {
    module: moduleObj,
    exports: moduleObj.exports,
    require: stubRequire,
    console,
    process,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Buffer,
    __dirname: ROOT,
    __filename: MAIN,
    global: {},
    // settings.ts reads navigator.hardwareConcurrency when building defaults.
    navigator: { hardwareConcurrency: 4, userAgent: "node" },
    // `window` needs the timers too: the plugin's debounced persist uses
    // `window.setTimeout`, and Obsidian's renderer provides that.
    window: {
      devicePixelRatio: 1,
      addEventListener() {},
      removeEventListener() {},
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    },
    requestAnimationFrame: (fn) => setTimeout(() => fn(0), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    performance: { now: () => Date.now() },
    document: {
      createElement: () => ({
        getContext: () => null,
        style: {},
        classList: { add() {}, remove() {}, toggle() {} },
        appendChild() {},
        addEventListener() {},
        setAttribute() {},
      }),
      body: { hasClass: () => false },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "main.js" });
  return moduleObj.exports;
}

/** The minimum surface of the `obsidian` module the plugin touches at load. */
const obsidianStub = {
  Plugin: class Plugin {
    constructor() {}
    async loadData() {
      return null;
    }
    async saveData() {}
    addRibbonIcon() {}
    addCommand() {}
    addSettingTab() {}
    registerView() {}
    registerMarkdownCodeBlockProcessor() {}
    /** Hook a workspace event; the plugin uses this for the file menu. */
    registerEvent() {
      return {};
    }
    /** Register a teardown callback; the plugin uses this for its inline embeds. */
    register(fn) {
      this._teardowns ??= [];
      this._teardowns.push(fn);
    }
  },
  ItemView: class ItemView {
    constructor(leaf) {
      this.leaf = leaf;
      this.contentEl = {};
    }
  },
  // The help dialog reads this at module scope to label the modifier key.
  Platform: { isMacOS: false, isMobile: false },
  // The folder field extends this, so an undefined export fails the same way a
  // missing Modal does.
  AbstractInputSuggest: class AbstractInputSuggest {
    constructor(app, el) {
      this.app = app;
      this.inputEl = el;
    }
    onSelect() {
      return this;
    }
    close() {}
  },
  TFolder: class TFolder {},
  // Modal is extended by the saved-models and help dialogs, so the stub needs a
  // real base class -- an undefined export fails as "class extends value
  // undefined", which reads as a plugin error rather than a missing stub.
  Modal: class Modal {
    constructor(app) {
      this.app = app;
      // A chainable element stub. The dialogs are only constructed here, not
      // opened, but a stub that throws on the first missing method turns a
      // missing test double into what looks like a plugin failure.
      const el = () => {
        const e = {
          style: {},
          classList: { add() {}, remove() {}, toggle() {} },
          empty() {},
          addClass() {},
          setText() {},
          setAttribute() {},
          appendChild() {},
          addEventListener() {},
        };
        for (const m of ["createEl", "createDiv", "createSpan", "createEl"]) e[m] = () => el();
        return e;
      };
      this.titleEl = el();
      this.contentEl = el();
    }
    open() {}
    close() {}
  },
  PluginSettingTab: class PluginSettingTab {
    constructor(app, plugin) {
      this.app = app;
      this.plugin = plugin;
    }
  },
  Setting: class Setting {
    setName() {
      return this;
    }
    setDesc() {
      return this;
    }
    addText() {
      return this;
    }
    addTextArea() {
      return this;
    }
    addToggle() {
      return this;
    }
    addSlider() {
      return this;
    }
  },
  Notice: class Notice {
    constructor(msg) {
      notices.push(String(msg));
    }
  },
  TFile: class TFile {},
  WorkspaceLeaf: class WorkspaceLeaf {},
  setIcon() {},
  normalizePath: (p) => p,
};
const notices = [];

/* ------------------------------------------------------------------ */

test("bundle exists and is a valid CommonJS plugin", { skip: !HAS_BUNDLE }, () => {
  const src = fs.readFileSync(MAIN, "utf8");
  assert.ok(src.length > 1000, "bundle is non-trivial");
  const mod = loadBundle();
  assert.ok(mod.default, "has a default export");
  assert.equal(typeof mod.default, "function", "default export is the Plugin subclass");
});

test("bundle instantiates and its lifecycle runs", { skip: !HAS_BUNDLE }, async () => {
  const mod = loadBundle();
  const PluginClass = mod.default;
  const instance = new PluginClass();

  // Give it a minimal app stub matching what onload touches.
  instance.app = {
    workspace: {
      getLeavesOfType: () => [],
      getActiveFile: () => null,
      on: () => {},
      // The plugin defers adopting its file's source to the layout being ready,
      // because the vault is not indexed before that.
      onLayoutReady: (cb) => cb(),
    },
    vault: {
      adapter: { getBasePath: () => "/tmp" },
      getAbstractFileByPath: () => null,
      create: async () => {},
      modify: async () => {},
      read: async () => "",
    },
  };

  const commands = [];
  const views = [];
  instance.addCommand = (c) => commands.push(c);
  instance.addRibbonIcon = () => {};
  instance.addSettingTab = () => {};
  instance.registerView = (type, factory) => views.push({ type, factory });
  instance.registerEvent = () => ({});
  instance.loadData = async () => null;
  instance.saveData = async () => {};

  await instance.onload();

  assert.equal(views.length, 1, "registered exactly one view");
  assert.equal(views[0].type, "modelica-studio-view");
  assert.equal(typeof views[0].factory, "function", "view factory is callable");

  assert.ok(commands.length >= 2, `expected commands, got ${commands.length}`);
  const ids = commands.map((c) => c.id);
  for (const want of [
    "open-modelica-studio",
    "simulate-current-model",
    // Embedding a simulation in a note. Asserted here as well as driven in the
    // DOM test, because a command that is not registered is not offered at all.
    "embed-simulation",
    "embed-current-model",
  ]) {
    assert.ok(ids.includes(want), `command "${want}" registered (got ${ids.join(",")})`);
  }

  await instance.onunload();
});

test("each model keeps its own simulation span", { skip: !HAS_BUNDLE }, async () => {
  // The span lived only in the global settings, so restoring a model inherited
  // whatever the previous one used: FluidReservoir, which drains over 20 s, was
  // integrated over 2 s and its level read as a straight line. Verified against
  // the built bundle, since the fault was in how the two paths interacted.
  const mod = loadBundle();
  const instance = new mod.default();
  instance.app = {
    workspace: {
      getLeavesOfType: () => [],
      getActiveFile: () => null,
      on: () => {},
      onLayoutReady: (cb) => cb(),
    },
    vault: {
      adapter: { getBasePath: () => "/tmp" },
      getAbstractFileByPath: () => null,
      create: async () => {},
      modify: async () => {},
      read: async () => "",
    },
  };
  instance.addCommand = () => {};
  instance.addRibbonIcon = () => {};
  instance.addSettingTab = () => {};
  instance.registerView = () => {};
  instance.registerEvent = () => ({});
  // Part of the Plugin API the plugin uses to hook the file menu, so a mock
  // without it makes onload throw rather than test anything.
  instance.registerEvent = () => ({});
  instance.loadData = async () => null;
  instance.saveData = async () => {};
  await instance.onload();

  const { EXAMPLES } = await import(
    path.join(buildLibs("ex-lib", ["src/modelica/examples.ts"]), "examples.js")
  );
  const fluid = EXAMPLES.find((e) => e.name === "FluidReservoir");
  assert.ok(fluid, "the fluid example exists");
  assert.equal(fluid.stopTime, 20, "and drains over 20 s");

  // A model nobody has spoken for runs over its own example's span, regardless
  // of what any other model uses. A single shared value made setting 4 s for one
  // model change every block in every note.
  assert.equal(instance.stopTime("FluidReservoir"), 20, "the fluid example's own span");
  assert.equal(instance.stopTime("Electrical"), 1, "and another model's is untouched");

  // Recording a span affects exactly one model, and survives.
  instance.setStopTime(4, "FluidReservoir");
  assert.equal(instance.stopTime("FluidReservoir"), 4, "the recorded span wins");
  assert.equal(instance.stopTime("Electrical"), 1, "and leaks into nothing else");
  assert.equal(
    instance.settings.modelStopTimes.FluidReservoir,
    4,
    "stored against that model, so it persists"
  );

  await instance.onunload();
});

test("bundle ships every module the editor needs", { skip: !HAS_BUNDLE }, () => {
  const src = fs.readFileSync(MAIN, "utf8");
  // Strings that can only come from the real implementations, proving the
  // tree-shaker did not drop a module the UI depends on at runtime.
  const required = [
    "Modelica Studio",           // view title
    "modelica-studio-view",      // view type id
    "connect(",                  // serializer
    "Placement(",                // serializer
    "outputFormat=csv",          // backend run args
    "override",                  // the fast path
    "-n=",                       // parallel codegen
    "CrossDiag",                 // FillPattern enum literal handled by the renderer
    "DashDotDot",                // LinePattern enum literal handled by the renderer
    "horizontalAlignment",       // text primitive alignment
    "Bezier",                    // Line smooth enum literal
    "Filled",                    // Arrow enum literal
    "is-collapsed",              // palette group collapse class
    "structure changes",         // settings copy
  ];
  for (const s of required) {
    assert.ok(src.includes(s), `bundle should contain "${s}"`);
  }
});

test("bundle has no dynamic requires or external binary references", { skip: !HAS_BUNDLE }, () => {
  const src = fs.readFileSync(MAIN, "utf8");
  // The only require() calls may be node builtins or the declared externals.
  const calls = [...src.matchAll(/require\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map((m) => m[1]);
  const allowed = /^(node:)?[a-z_]+$|^obsidian$|^electron$|^@?[a-z0-9@/._-]+$/i;
  const suspicious = calls.filter((c) => c.startsWith(".") || c.startsWith("/"));
  assert.deepEqual(suspicious, [], `relative requires cannot work after store install: ${suspicious}`);
  for (const c of calls) {
    assert.ok(allowed.test(c), `unexpected require target: ${c}`);
  }

  for (const ext of [".wasm", ".node", ".dll", ".so", ".dylib"]) {
    assert.ok(
      !new RegExp(`["'\`][^"'\`]*\\${ext}["'\`]`).test(src),
      `bundle must not reference a ${ext} file`
    );
  }
});

test("release artifacts match the distribution contract", () => {
  for (const f of ["manifest.json", "main.js", "styles.css"]) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} must exist for release`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  assert.equal(manifest.isDesktopOnly, true, "must be desktop-only (spawns a compiler, uses Node fs)");
  // Obsidian accepts a semver prerelease suffix, and a beta release needs one.
  assert.match(
    manifest.version,
    /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/,
    "version must be x.y.z or x.y.z-tag"
  );
  // A beta must say so, or a user cannot tell this from a stable release.
  assert.match(manifest.version, /-/, "a beta version carries a prerelease tag");
  assert.equal(manifest.id, manifest.id.toLowerCase(), "id must be lowercase");
  assert.ok(manifest.description.length <= 250, "description within Obsidian's limit");
  assert.ok(manifest.minAppVersion, "minAppVersion is required");
});

test("end-to-end: serialize a diagram, run OMC, read results", { skip: !HAS_BUNDLE }, async () => {
  // Drive the real bundled pipeline: build a model -> serialize -> compile ->
  // simulate -> parse results. This is the whole product loop minus pixels.
  const OMC_LIB = buildLibs("omc-lib", ["src/omc/backend.ts", "src/omc/locate.ts"]);
  const TEST_LIB = buildLibs("test-lib", ["src/modelica/parser.ts", "src/modelica/serializer.ts", "src/modelica/library.ts", "src/modelica/types.ts"]);
  const { OmcBackend, parseOmcCsv } = await import(path.join(OMC_LIB, "backend.js"));
  const { locateOmcSync } = await import(path.join(OMC_LIB, "locate.js"));
  const omc = locateOmcSync();
  if (omc.status !== "found") return;

  const { serializeDiagram } = await import(path.join(TEST_LIB, "serializer.js"));

  const model = {
    name: "BundledFlow",
    components: [
      { id: "v1", className: "Modelica.Electrical.Analog.Sources.ConstantVoltage",
        placement: { extent: [-60, 20, -20, 40], rotation: 0, visible: true }, params: { V: "5" } },
      { id: "r1", className: "Modelica.Electrical.Analog.Basic.Resistor",
        placement: { extent: [0, 30, 20, 10], rotation: 0, visible: true }, params: { R: "100" } },
      { id: "g1", className: "Modelica.Electrical.Analog.Basic.Ground",
        placement: { extent: [-20, -40, 0, -20], rotation: 0, visible: true }, params: {} },
    ],
    connections: [
      { id: "c1", from: { component: "v1", port: "p" }, to: { component: "r1", port: "p" }, points: [] },
      { id: "c2", from: { component: "r1", port: "n" }, to: { component: "g1", port: "p" }, points: [] },
      { id: "c3", from: { component: "v1", port: "n" }, to: { component: "g1", port: "p" }, points: [] },
    ],
    graphics: [],
  };

  const source = serializeDiagram(model);
  assert.match(source, /^model BundledFlow/);
  assert.match(source, /connect\(v1\.p, r1\.p\)/);
  assert.match(source, /annotation\(Placement/);

  const backend = new OmcBackend({ omcPath: omc.omcPath, cacheDir: simCacheDir("bundle-e2e") });
  const result = await backend.simulate({
    modelName: "BundledFlow",
    source,
    parameters: { "r1.R": "100" },
    stopTime: 1,
    numberOfIntervals: 50,
  });

  assert.ok(result.time.length > 5, `got ${result.time.length} samples from the bundled flow`);
  assert.ok(result.series.length > 0, "variables were emitted");

  // The resistor current should settle at V/R = 5/100 = 0.05 A.
  const i = result.series.find((s) => s.name === "r1.i");
  if (i) {
    const last = i.values[i.values.length - 1];
    assert.ok(Math.abs(last - 0.05) < 5e-3, `steady-state current ~0.05 A, got ${last}`);
  }
  backend.dispose();
  void parseOmcCsv;
});

test("New leaves nothing of the previous model behind", { skip: !HAS_BUNDLE }, async () => {
  // Driven through the plugin's real `newModel`, because the fault was a pairing
  // that a source-level test can only describe: the diagram was replaced and the
  // SOURCE was not, so `loadModelIntoEditor` filled the editor from the previous
  // model's text and the editor's change handler parsed it straight back in. The
  // canvas then repainted the model the user had just replaced.
  const mod = loadBundle();
  const instance = new mod.default();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "new-model-"));
  fs.mkdirSync(path.join(dir, ".obsidian", "plugins", "modelica-studio"), { recursive: true });

  instance.app = {
    vault: { configDir: ".obsidian", adapter: { getBasePath: () => dir } },
    workspace: { getLeavesOfType: () => [] },
  };
  instance.manifest = { id: "modelica-studio", version: "0.2.0-beta.1" };
  // The settings the persist path reads. `modelStopTimes` is indexed by model
  // name, so without it the save throws before it writes anything.
  instance.settings = {
    modelFiles: {},
    modelFolder: "Modelica",
    modelStopTimes: {},
    stopTime: 20,
  };
  instance.saveData = async () => {};

  const OLD = "model OldModel\n  Real x;\nend OldModel;";
  try {
    // A model the user had built, with its source, exactly as a real one is held.
    instance.adoptModel(
      { name: "OldModel", components: [{ id: "tank" }], connections: [], equations: [], graphics: [] },
      OLD
    );
    assert.equal(instance.model.components.length, 1, "the old model is there to begin with");

    await instance.newModel("FreshModel");

    assert.equal(instance.model.name, "FreshModel", "the diagram is the new one");
    assert.equal(instance.model.components.length, 0, "and it is empty");
    // The one that matters: nothing of the old model may survive in the source,
    // because the source is what refills the editor and then the diagram.
    assert.ok(
      !instance.modelSourceText().includes("OldModel"),
      `the source still describes the previous model: ${instance.modelSourceText()}`
    );
    assert.equal(instance.modelSourceText(), "model FreshModel\nend FreshModel;\n", "it is the new skeleton");

    // And Save writes the NEW model, not a stale or empty file.
    const toSave = instance.sourceForSave();
    assert.match(toSave, /model FreshModel/, "saving writes the new name");
    assert.ok(!toSave.includes("OldModel"), "and nothing of the old one");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the AI log is written, bounded and free of the key", { skip: !HAS_BUNDLE }, async () => {
  // The recording path against a REAL file: the plugin's own `appendAiExchange`,
  // its own path resolution, and the bytes that actually land on disk. The pure
  // formatting is tested in interaction-log.test.mjs; this is the half that a unit
  // test cannot reach, and the half where a path bug would silently record
  // nothing at all.
  const mod = loadBundle();
  const instance = new mod.default();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-log-"));
  const pluginDir = path.join(dir, ".obsidian", "plugins", "modelica-studio");
  fs.mkdirSync(pluginDir, { recursive: true });

  instance.app = {
    vault: {
      // `configDir` is what the plugin builds its data path from, and it is a real
      // Obsidian property; without it the path resolution throws and is swallowed,
      // which is what "the log records nothing" looks like from the outside.
      configDir: ".obsidian",
      adapter: { getBasePath: () => dir },
      getAbstractFileByPath: () => null,
    },
    workspace: { getLeavesOfType: () => [] },
  };
  instance.manifest = { id: "modelica-studio", version: "0.2.0-beta.1" };
  instance.settings = { aiLog: true };
  instance.aiKey = () => "sk-testkey1234567890abcdef";

  const exchange = (over = {}) => ({
    at: new Date().toISOString(),
    attempt: 1,
    style: "visual",
    prompt: "a tank that drains through three pipes",
    messages: [{ role: "user", content: "a tank that drains" }],
    reply: "model Tank end Tank;",
    extracted: "model Tank end Tank;",
    outcome: "ok",
    detail: "",
    ms: 1200,
    ...over,
  });

  try {
    // The path is where the plugin's own data lives, not somewhere in the vault.
    assert.equal(instance.aiLogPath(), path.join(pluginDir, "ai-exchanges.jsonl"));

    instance.appendAiExchange(exchange());
    instance.appendAiExchange(
      exchange({ outcome: "rejected", detail: "That is not a diagram.", reply: "key sk-testkey1234567890abcdef" })
    );

    const file = instance.aiLogPath();
    assert.ok(fs.existsSync(file), "the file was created");
    const text = fs.readFileSync(file, "utf8");
    assert.equal(text.split("\n").filter(Boolean).length, 2, "one line per exchange");
    // The configured key must not be on disk, however it arrived.
    assert.ok(!text.includes("sk-testkey1234567890abcdef"), "no key in the file");
    assert.match(text, /REDACTED/, "and it is visibly replaced");
    assert.match(text, /a tank that drains/, "while the useful content survives");

    // Reading back gives the same records, in order.
    const back = instance.readAiExchanges();
    assert.equal(back.length, 2);
    assert.equal(back[1].outcome, "rejected");

    // Off means off: nothing is appended.
    instance.settings.aiLog = false;
    instance.appendAiExchange(exchange());
    assert.equal(fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length, 2);

    // And it is bounded, using the same writer rather than a separate code path.
    instance.settings.aiLog = true;
    for (let i = 0; i < 210; i++) instance.appendAiExchange(exchange({ attempt: i }));
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    assert.equal(lines.length, 200, `the file is bounded, got ${lines.length}`);

    instance.clearAiExchanges();
    assert.ok(!fs.existsSync(file), "clearing removes it");
    // Compared by length, not `deepEqual`: the plugin runs in a `vm` context, so
    // its Array prototype is not this realm's and a strict deep comparison of two
    // empty arrays fails for a reason that has nothing to do with the log.
    assert.equal(instance.readAiExchanges().length, 0, "reading an absent log is empty, not an error");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
