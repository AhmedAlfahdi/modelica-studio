/**
 * Modelica Studio — plugin entry point.
 *
 * Responsibilities: own the shared state (library index, simulation backend,
 * current diagram), register the view, and provide commands + settings.
 *
 * The library index is built lazily on first use because parsing the Modelica
 * Standard Library takes a couple of seconds and must not block plugin load —
 * Obsidian loads plugins synchronously during startup.
 */

import {
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
  type MarkdownPostProcessorContext,
} from "obsidian";
import { LibraryIndex, loadLibraryIndex } from "./modelica/library";
import {
  EmbeddedDiagram,
  parseEmbedOptions,
  replaceFencedBlock,
  starterSource,
} from "./view/embed";
import { createBackend, SimulationError, type SimulationBackend } from "./omc/backend";
import { detectOmc, installHint, type OmcInstallation } from "./omc/locate";
import { emptyDiagram, type DiagramModel } from "./modelica/types";
import { findClass, parseModelica, toDiagramModel } from "./modelica/parser";
import { serializeDiagram } from "./modelica/serializer";
import { findExample } from "./modelica/examples";
import { AiError, chat } from "./ai/client";
import { ModelicaStudioView, VIEW_TYPE_MODELICA } from "./view/studio-view";
import { ModelicaStudioSettingTab, DEFAULT_SETTINGS, type ModelicaStudioSettings } from "./settings";

export default class ModelicaStudioPlugin extends Plugin {
  settings: ModelicaStudioSettings = { ...DEFAULT_SETTINGS };
  model: DiagramModel = emptyDiagram();

  /**
   * Shape version of the persisted model.
   *
   * Bump this whenever `ComponentInstance` gains or changes a field that the
   * serializer depends on. A snapshot saved by an older version is then
   * recognised as stale and rebuilt from its source, rather than being restored
   * and later failing to compile for reasons the user cannot see.
   *
   * History: 2 — added `ComponentInstance.prefixes`, and began re-emitting
   * `redeclare package`, port subscripts and `transformation(...)`. A model
   * saved before that produced `Medium=X` and lost `inner`, both of which
   * OpenModelica rejects.
   */
  private modelSource = "";
  private modelOutdated = false;
  /**
   * The span to run a model over.
   *
   * A per-model choice wins; otherwise a built-in example supplies its own;
   * otherwise the general default. The plugin-wide `stopTime` remains as that
   * last fallback for a model nobody has spoken for.
   */
  stopTime(model = this.model.name): number {
    return this.settings.modelStopTimes[model] ?? findExample(model)?.stopTime ?? this.settings.stopTime;
  }

  /** Record a span for one model, which then survives reloads. */
  setStopTime(seconds: number, model = this.model.name): void {
    this.settings.modelStopTimes[model] = seconds;
    void this.persist();
  }

  /** @deprecated kept for callers that mean "the current model". */
  adoptStopTime(seconds: number): void {
    this.setStopTime(seconds);
  }

  /** Live inline diagrams, so their editors can be destroyed with the plugin. */
  private readonly embeds = new Map<HTMLElement, EmbeddedDiagram>();

  /**
   * True when the restored model was saved by an older schema.
   *
   * The view asks for this once on open: it re-parses the stored source so the
   * user sees a current model, instead of one missing fields the serializer
   * needs.
   */

  /**
   * Render an inline editable diagram.
   *
   * The block's own text is the document: an edit in the diagram is written back
   * to it, so the diagram travels with the note. The write deliberately does NOT
   * force a re-render — Obsidian re-runs this processor when the section
   * changes, and re-rendering in response to our own write would discard the
   * editor mid-drag and fight the user's undo history.
   */
  private renderEmbed(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    info: string
  ): void {
    const opts = parseEmbedOptions(info);
    const text = source.trim() ? source : starterSource();
    // Obsidian reports the block's line range; writing back through it lands the
    // edit in the right block when a note contains several.
    const section = ctx.getSectionInfo(el);

    const embed = new EmbeddedDiagram(
      {
        app: this.app,
        library: this.library,
        backend: this.backend,
        settings: this.settings,
        showSetupHelp: () => this.showSetupHelp(),
        report: (m) => this.diag(m),
        openDiagram: (source) => void this.openDiagram(source),
        chart: (model) => this.settings.charts[model],
        stopTimeFor: (model) => this.stopTime(model),
        notifyChart: () => void this.publishChart(),
      },
      el,
      text,
      opts,
      (next) => this.writeEmbedSource(ctx.sourcePath, section, next)
    );
    embed.infoLine = info;
    // Obsidian discards the element when the note re-renders, so replace any
    // editor already attached to this element before mounting a new one.
    this.embeds.get(el)?.destroy();
    this.embeds.set(el, embed);
    embed.mount();
  }

  /**
   * Write an edited diagram back into the note.
   *
   * The block's own line range is used rather than a search for matching text,
   * so the edit lands in the right block when a note contains several and does
   * not depend on the diagram remaining byte-identical while it is edited.
   */
  private writeEmbedSource(
    sourcePath: string,
    section: { lineStart: number; lineEnd: number } | null,
    source: string
  ): void {
    if (!section) return;
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(file instanceof TFile)) return;

    void this.app.vault.process(file, (text) =>
      replaceFencedBlock(text, section.lineStart, section.lineEnd, source)
    );
  }

  /**
   * Share a new plot configuration with every inline diagram.
   *
   * The studio and the blocks in notes are separate views of one result, so a
   * change to the scale or the visible traces has to reach all of them. The
   * configured state is persisted too, so a note reopened later matches.
   */
  async publishChart(): Promise<void> {
    await this.saveSettings();
    for (const embed of this.embeds.values()) embed.applyChart();
  }

  /** Show a model's diagram in the main view, opening it if necessary. */
  async openDiagram(source: string): Promise<void> {
    await this.setModelFromSource(source);
    await this.activateView();
  }

  /** The source the current model came from, if it was parsed from one. */
  modelSourceText(): string {
    return this.modelSource;
  }

  takeModelOutdated(): boolean {
    const v = this.modelOutdated;
    this.modelOutdated = false;
    return v;
  }

  /**
   * Where the parsed library index is cached.
   *
   * Stored next to the plugin rather than in the vault, so it is not synced and
   * does not appear as a file the user might edit.
   */
  private libraryCachePath(): string | undefined {
    try {
      // `manifest.dir` is not populated at runtime, so the path is derived from
      // the vault: the plugin's own folder is the one location guaranteed to be
      // writable and guaranteed to belong to this plugin.
      const adapter = this.app.vault.adapter as { getBasePath?: () => string };
      const base = adapter.getBasePath?.();
      if (!base) return undefined;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require("node:path") as typeof import("node:path");
      return path.join(base, this.app.vault.configDir, "plugins", this.manifest.id, "library-index.json");
    } catch {
      return undefined;
    }
  }

  /** Built once; see `ensureLibrary`. */
  private libraryIndex: LibraryIndex | null = null;
  private libraryReady = false;
  private libraryPromise: Promise<LibraryIndex> | null = null;

  backend: SimulationBackend | null = null;
  private omc: OmcInstallation | null = null;


  /**
   * Opt-in diagnostic log.
   *
   * Obsidian's renderer console is not reachable from outside the app, so when
   * `debugLog` is enabled the plugin appends structured lines to a file in the
   * vault. This is how the plugin's startup and simulation path can be verified
   * without a debugger attached.
   */
  diag(message: string): void {
    if (!this.settings.debugLog) return;
    try {
      const adapter = this.app.vault.adapter as { getBasePath?: () => string };
      const base = adapter.getBasePath?.();
      if (!base) return;
      const line = `${new Date().toISOString()} ${message}\n`;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("node:fs") as typeof import("node:fs");
      fs.appendFileSync(`${base}/.modelica-studio.log`, line);
    } catch {
      /* diagnostics must never break the plugin */
    }
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    this.diag(`onload start; omcPath="${this.settings.omcPath}" jobs=${this.settings.jobs}`);

    this.register(() => {
      for (const embed of this.embeds.values()) embed.destroy();
      this.embeds.clear();
    });

    this.registerView(VIEW_TYPE_MODELICA, (leaf) => new ModelicaStudioView(leaf, this));

    // Start indexing immediately. Deferring it until something needed a
    // component name meant the first click of a session froze for the whole
    // parse, which is what made opening an example feel like a hang.
    this.warmLibrary();

    // Inline, editable diagrams in notes.
    for (const language of EMBED_LANGUAGES) {
      // The info string carries the options, e.g. ```modelica result height=400
      // Obsidian passes three arguments and drops the fence's info string, so
      // the block's options cannot be read from here; they live in a directive
      // comment inside the block. See `parseDirective`.
      this.registerMarkdownCodeBlockProcessor(language, (source, el, ctx) => {
        this.renderEmbed(source, el, ctx, language);
      });
    }

    this.addRibbonIcon("circuit-board", "Open Modelica Studio", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-modelica-studio",
      name: "Open Modelica Studio",
      callback: () => void this.activateView(),
    });

    this.addCommand({
      id: "simulate-current-model",
      name: "Simulate current model",
      checkCallback: (checking) => {
        const view = this.getView();
        if (!view) return false;
        if (!checking) void view.runSimulation();
        return true;
      },
    });

    this.addCommand({
      id: "load-example",
      name: "Load example model",
      callback: () => void this.activateView(),
    });

    this.addCommand({
      id: "new-model-from-note",
      name: "Load model from active note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "mo") return false;
        if (!checking) void this.loadModelFromFile(file);
        return true;
      },
    });

    this.addSettingTab(new ModelicaStudioSettingTab(this));

    // Detect OpenModelica in the background so startup stays fast, and so the
    // index build (which is slower still) is not competing with it.
    void this.detectToolchain();
    this.diag("onload complete: view registered, commands added");
  }

  async onunload(): Promise<void> {
    this.backend?.dispose();
    this.backend = null;
  }

  /* ---------------- toolchain ---------------- */

  /**
   * Locate OpenModelica and wire up the simulation backend.
   * Failure is not fatal: the editor still works for building diagrams, and
   * the user is told what to install.
   */
  private async detectToolchain(): Promise<void> {
    try {
      const found = await detectOmc(this.settings.omcPath || undefined);
      this.omc = found;

      this.diag(`toolchain: status=${found.status} path=${found.omcPath ?? "-"} version=${found.versionNumber ?? "-"}`);
      if (found.status === "found" && found.omcPath) {
        this.backend = createBackend({
          omcPath: found.omcPath,
          jobs: this.settings.jobs,
          extraOptions: this.settings.extraOmcOptions
            ? this.settings.extraOmcOptions.split(/\s+/).filter(Boolean)
            : undefined,
        });
        this.applySettingsToBackend();
      } else {
        this.backend = null;
      }
    } catch (err) {
      this.omc = {
        status: "error",
        libraryRoots: [],
        message: err instanceof Error ? err.message : String(err),
      };
      this.backend = null;
    }
  }

  /**
   * Push the debug-overlay setting to every open editor.
   *
   * Called when the setting changes and when a view opens, so toggling it in
   * Settings takes effect immediately without reopening the view.
   */
  applyDebugOverlay(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MODELICA)) {
      const view = leaf.view;
      if (view instanceof ModelicaStudioView) view.applyDebugOverlay();
    }
  }

  /** Push settings that the backend reads at call time. */
  private applySettingsToBackend(): void {
    // Settings that affect compilation are read when the backend is created;
    // recreate it so changes take effect without a reload.
    if (!this.omc?.omcPath) return;
    this.backend?.dispose();
    this.backend = createBackend({
      omcPath: this.omc.omcPath,
      jobs: this.settings.jobs,
      extraOptions: this.settings.extraOmcOptions
        ? this.settings.extraOmcOptions.split(/\s+/).filter(Boolean)
        : undefined,
    });
  }

  /** Force the next simulation to recompile. */
  invalidateBuild(): void {
    (this.backend as { invalidate?: () => void })?.invalidate?.();
  }

  /** Human-readable toolchain state, shown in settings and on failure. */
  toolchainSummary(): { ok: boolean; text: string; action?: string } {
    if (this.backend && this.omc?.status === "found") {
      return {
        ok: true,
        text: `${this.omc.version ?? "OpenModelica"} at ${this.omc.omcPath}`,
      };
    }
    return {
      ok: false,
      text: this.omc?.message ?? "OpenModelica not detected.",
      action: installHint(),
    };
  }

  showSetupHelp(): void {
    const s = this.toolchainSummary();
    new Notice(
      `Modelica Studio needs OpenModelica.\n\n${s.action ?? ""}`,
      12000
    );
  }

  /* ---------------- library ---------------- */

  /**
   * The library index, built once. Parsing the whole Modelica Standard Library
   * takes ~3 s, so it is built off the critical path and shared.
   */
  /**
   * Build the component index, once.
   *
   * Parsing the standard library is seconds of main-thread work. It used to
   * happen lazily, on the first thing that needed a component name — so opening
   * the view looked instant and then the first click froze for the whole parse.
   * It is now started at load and cached on disk, so the cost is paid before
   * the user asks for anything and only once per library version.
   */
  async ensureLibrary(): Promise<LibraryIndex> {
    if (this.libraryIndex) return this.libraryIndex;
    if (this.libraryPromise) return this.libraryPromise;

    this.libraryPromise = this.buildLibrary();
    return this.libraryPromise;
  }

  private async buildLibrary(): Promise<LibraryIndex> {
    const extra = [
      ...(this.omc?.libraryRoots ?? []),
      ...this.settings.libraryPaths.split("\n").map((s) => s.trim()).filter(Boolean),
    ];
    // The index is cached beside the plugin's data, so the parse is paid once
    // per library version rather than on every launch.
    const { index, loadedRoots, fromCache } = loadLibraryIndex({
      roots: extra,
      cacheFile: this.libraryCachePath(),
    });
    this.diag(
      `library: ${index.size} classes from ${loadedRoots.length} root(s)` +
        (fromCache ? " (cached)" : " (parsed)")
    );
    if (loadedRoots.length === 0) {
      new Notice(
        "Modelica Studio: no Modelica libraries were found. " +
          "Set a library path in Settings → Modelica Studio.",
        10000
      );
    }
    this.libraryIndex = index;
    this.libraryReady = true;
    this.diag("library ready");
    return index;
  }

  /** True once `ensureLibrary` has resolved. */
  get hasLibrary(): boolean {
    return this.libraryReady;
  }

  /**
   * Begin building the index in the background.
   *
   * Called at load and whenever the library configuration changes. Deliberately
   * not awaited by callers: the point is that nothing the user does has to wait
   * for it, because it is already under way.
   */
  warmLibrary(): void {
    if (this.libraryIndex || this.libraryPromise) return;
    void this.ensureLibrary()
      .then(() => {
        // Tell any open view that component names are now resolvable.
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MODELICA)) {
          if (leaf.view instanceof ModelicaStudioView) leaf.view.onLibraryReady();
        }
      })
      .catch(() => {
        this.libraryPromise = null;
      });
  }

  /**
   * Synchronous accessor used by the render loop.
   *
   * Returns an empty index until `ensureLibrary()` has resolved; callers
   * re-render once it is ready, which avoids blocking a canvas frame on I/O.
   */
  get library(): LibraryIndex {
    return this.libraryIndex ?? EMPTY_INDEX;
  }

  /* ---------------- view ---------------- */

  private getView(): ModelicaStudioView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_MODELICA)[0];
    if (!leaf) return null;
    // Views are deferred by default; always verify the concrete type.
    return leaf.view instanceof ModelicaStudioView ? leaf.view : null;
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_MODELICA);
    let leaf: WorkspaceLeaf;
    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_MODELICA, active: true });
    }
    this.app.workspace.revealLeaf(leaf);

    // Build the library, then refresh the view that was waiting on it.
    const index = await this.ensureLibrary();
    const view = leaf.view instanceof ModelicaStudioView ? leaf.view : null;
    if (view && index.size > 0) {
      await view.refreshLibrary();
    }
  }

  /* ---------------- persistence ---------------- */

  /**
   * Confirm the AI provider answers, and say why if it does not.
   *
   * Exists because "nothing happened" is the hardest failure to act on: a wrong
   * base URL, a rejected key and an unavailable model all look identical from
   * the editor. This asks the provider directly and reports what it said.
   */
  async testAiConnection(): Promise<{ ok: boolean; text: string }> {
    const cfg = this.settings.ai;
    if (!cfg.apiKey.trim()) {
      return { ok: false, text: "No API key set. The feature is off until one is entered." };
    }
    try {
      const reply = await chat(cfg, [
        { role: "system", content: "Reply with the single word: ready" },
        { role: "user", content: "ping" },
      ]);
      return { ok: true, text: `Connected to ${cfg.model}. The provider replied: ${reply.trim().slice(0, 80)}` };
    } catch (err) {
      return { ok: false, text: err instanceof AiError ? err.message : String(err) };
    }
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<ModelicaStudioSettings> & {
      model?: DiagramModel;
      /** Shape version of the persisted model; see MODEL_SCHEMA. */
      modelSchema?: number;
      /** The time span the persisted model is meant to run over. */
      modelStopTime?: number;
      /** The source the model was parsed from, when it came from a file. */
      modelSource?: string;
    } | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
    if (data?.model && Array.isArray(data.model.components)) {
      this.model = data.model;
      this.modelSource = typeof data.modelSource === "string" ? data.modelSource : "";
      // Restore the span this model ran over. Without it the model inherited
      // the previous one's span, so a tank that drains over 20 s was integrated
      // over 2 s and its curve read as a straight line.
      if (typeof data.modelStopTime === "number" && data.modelStopTime > 0) {
        // Migrate the single saved span into the per-model map, so a value set
        // before this change is not lost.
        this.settings.modelStopTimes[this.model.name] ??= data.modelStopTime;
      }
      if ((data.modelSchema ?? 0) !== MODEL_SCHEMA) {
        // The saved snapshot predates a change in what the model carries, so it
        // cannot be trusted: every component may be missing fields the current
        // code expects, which shows up later as a compile error on a model the
        // user never edited. Rebuild from the source it came from; if there is
        // none (the diagram was built by hand) the snapshot is kept, since
        // discarding it would lose the user's work.
        if (this.modelSource) {
          this.diag(
            `model schema ${data.modelSchema ?? 0} != ${MODEL_SCHEMA}; re-parsing from source`
          );
          this.modelOutdated = true;
        }
      }
    }
  }

  async saveSettings(): Promise<void> {
    await this.persist();
  }

  /** Persist settings and the current diagram together. */
  async persist(): Promise<void> {
    await this.saveData({
      ...this.settings,
      model: this.model,
      modelSchema: MODEL_SCHEMA,
      modelSource: this.modelSource,
      // The time span belongs to the model, not to the plugin. Kept beside the
      // diagram so restoring the model restores the span it is meant to run
      // over, instead of inheriting whatever the previous model used.
      modelStopTime: this.stopTime(),
    });
  }

  /* ---------------- model I/O ---------------- */

  async loadModelFromFile(file: TFile): Promise<void> {
    const text = await this.app.vault.read(file);
    let classes;
    try {
      classes = parseModelica(text);
    } catch (err) {
      new Notice(`Could not parse ${file.name}: ${err instanceof Error ? err.message : err}`);
      return;
    }
    if (classes.length === 0) {
      new Notice(`${file.name} contains no Modelica class.`);
      return;
    }
    // Prefer a class that actually has a diagram; otherwise the first model.
    const withComponents = classes.find((c) => c.components.length > 0) ?? classes[0];
    await this.ensureLibrary();
    this.model = toDiagramModel(withComponents, (n) => this.library.describe(n));
    await this.persist();
    this.getView()?.loadModelIntoEditor();
    new Notice(`Loaded ${withComponents.name} from ${file.name}.`);
  }

  /**
   * Write the current diagram back to a `.mo` file.
   *
   * The model is the note's content, so the file round-trips through OMEdit.
   */
  async saveModelToNote(): Promise<void> {
    const source = serializeDiagram(this.model);
    const existing = this.app.vault.getAbstractFileByPath(`${this.model.name}.mo`);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, source);
      return;
    }
    await this.app.vault.create(`${this.model.name}.mo`, source);
  }

  /**
   * Replace the active diagram from Modelica source and refresh the view.
   * Returns the parsed model, or undefined when the source has no classes.
   */
  async setModelFromSource(source: string): Promise<DiagramModel | undefined> {
    await this.ensureLibrary();
    const classes = parseModelica(source);
    if (classes.length === 0) return undefined;
    // Prefer the first class that actually has components.
    const target = classes.find((c) => c.components.length > 0) ?? classes[0];
    this.model = toDiagramModel(target, (n) => this.library.component(n));
    this.modelSource = source;
    this.modelOutdated = false;
    await this.persist();
    const view = this.getView();
    if (view) {
      view.reloadFromPlugin();
    }
    return this.model;
  }

  /**
   * Parse source into a diagram model without touching the plugin's state.
   *
   * Split from `adoptModel` so the code editor can validate on every keystroke
   * without the diagram lurching about underneath a half-typed line.
   */
  parseSource(source: string): DiagramModel | undefined {
    const classes = parseModelica(source);
    if (classes.length === 0) return undefined;
    // Prefer the first class that actually has components, so a file with a
    // package wrapper still opens on the model inside it.
    const target = classes.find((c) => c.components.length > 0) ?? classes[0];
    return toDiagramModel(target, (n) => this.library.component(n));
  }

  /** Make a parsed model current, keeping the source it came from. */
  adoptModel(model: DiagramModel, source: string): void {
    this.model = model;
    this.modelSource = source;
    this.modelOutdated = false;
    this.schedulePersist();
  }

  /**
   * Persist on a short delay.
   *
   * The code editor validates on a 250 ms debounce, so writing to disk on every
   * call would mean a file write per keystroke burst.
   */
  private persistTimer: number | null = null;
  private schedulePersist(): void {
    if (this.persistTimer !== null) window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, 600);
  }

  /** Create a fresh diagram, e.g. from the command palette. */
  async newModel(name: string): Promise<void> {
    this.model = emptyDiagram(name);
    await this.persist();
    this.getView()?.loadModelIntoEditor();
  }
}

/**
 * Stand-in index used before the real one is built.
 * Returning empty results keeps the render loop non-blocking; the view
 * refreshes as soon as `ensureLibrary()` resolves.
 */
const EMPTY_INDEX = new LibraryIndex();

export { SimulationError };

/**
 * Shape version of the persisted model. See `model` in the plugin class.
 */
const MODEL_SCHEMA = 2;

/**
 * Fence languages that render an inline diagram.
 *
 * `modelica` is the natural one to type; `modelica-studio` is offered because it
 * reads as the plugin's name and makes the intent obvious in a note.
 */
const EMBED_LANGUAGES = ["modelica", "modelica-studio"];
