// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ahmed N. Alfahdi
//
// Modelica Studio is free software: you can redistribute it and/or modify it under
// the terms of the GNU General Public License as published by the Free Software
// Foundation, either version 3 of the License, or (at your option) any later
// version. It is distributed in the hope that it will be useful, but WITHOUT ANY
// WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
// PARTICULAR PURPOSE. See the LICENSE file, or
// <https://www.gnu.org/licenses/>, for the full terms.

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
  App,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
  type Editor,
  type MarkdownPostProcessorContext,
} from "obsidian";
import { LibraryIndex, loadLibraryIndex } from "./modelica/library";
import {
  EmbeddedDiagram,
  parseEmbedOptions,
  replaceFencedBlock,
  starterSource,
  type FenceRefusal,
} from "./view/embed";
import { createBackend, SimulationError, type SimulationBackend } from "./omc/backend";
import { detectOmc, installHint, type OmcInstallation } from "./omc/locate";
import { emptyDiagram, type DiagramModel } from "./modelica/types";
import { findClass, parseModelica, toDiagramModel } from "./modelica/parser";
import { serializeDiagram } from "./modelica/serializer";
import { lastPatchRefusal, patchDiagramEdits, structureLostBy } from "./modelica/text-edit";
import { EXAMPLES, findExample } from "./modelica/examples";
import { AiError, chat, listModels } from "./ai/client";
import { RunLog } from "./ai/run-log";
import { AiEnvironment, describeAvailableClasses, describeEnvironment, describeLog } from "./ai/context";
import { LEGACY_SECRET_NAME, buildMessages, legacyKeyOf, secretNameOf } from "./ai/prompts";
import { describeSaveState, type SaveDescription } from "./modelica/save-state";
import { TextModal } from "./view/saved-models-modal";
import { describeSavedModels } from "./modelica/saved-models";
import {
  EMBED_DEFAULTS,
  EmbedPickerModal,
  buildEmbedCandidates,
  embedBlockText,
  insertEmbedBlock,
  type EmbedCandidate,
  type EmbedCandidateSource,
} from "./view/embed-insert";
import {
  formatExchanges,
  formatSummary,
  parseLog,
  pruneLines,
  summarise,
  toLogLine,
  type AiExchange,
} from "./ai/interaction-log";
import { Trace, describeStateForTrace, type TraceKind } from "./diagnostics/trace";
import { BENCH_PROMPTS, formatBenchmark, runBenchmark } from "./ai/benchmark";
import {
  isNewRevision,
  revisionDirName,
  revisionFileName,
  revisionTime,
  revisionsToPrune,
  type Revision,
} from "./modelica/revisions";
import { ModelicaStudioView, VIEW_TYPE_MODELICA } from "./view/studio-view";
import { ModelicaStudioSettingTab, DEFAULT_SETTINGS, type ModelicaStudioSettings , mergeSettings, migrateSettings } from "./settings";

/** How a model is loaded over the one that is open. */
export interface LoadOptions {
  /**
   * Load the file WITHOUT writing the studio's current model first.
   *
   * Set by Revert and by "Reload from disk", which exist to put the file back:
   * flushing first would overwrite the version being read.
   */
  discardStudioEdits?: boolean;
}

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
  /** Set when a save could not write a diagram change into the file's own text. */
  private patchNote = "";
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
      // The EXPECTATION is the block's source as Obsidian handed it over, not the
      // starter text an empty block is given: the writer compares it against the
      // lines actually in the file.
      (next, expectBody) =>
        this.writeEmbedSource(ctx.sourcePath, section, next, { language: info, body: expectBody })
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
    source: string,
    /** The block's text as the writer last knew it, and the fence's language. */
    expect: { language: string; body: string }
  ): void {
    if (!section) return;
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(file instanceof TFile)) return;

    // The refusal is decided inside the process callback, which must return the
    // new text, so it is carried out in a variable rather than thrown.
    let refused: FenceRefusal | undefined;
    void this.app.vault
      .process(file, (text) => {
        const write = replaceFencedBlock(text, section.lineStart, section.lineEnd, source, expect);
        if (!write.ok) refused = write.reason;
        return write.text;
      })
      .then(() => {
        if (!refused) return;
        // Say so rather than dropping the edit quietly: the diagram on screen has
        // moved and the note has not, and the user is the only one who can decide
        // which of the two is right.
        this.diag(`embed write refused (${refused}) for ${sourcePath}`);
        new Notice(
          "Modelica: the note changed since this block was drawn, so the edit was " +
            "not written over it. Reload the note and make the change again.",
          8000
        );
      });
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

  /**
   * Repaint every open embed.
   *
   * Needed by the settings the diagram READS while drawing -- the label size and
   * the hover readout -- because those are consulted per frame rather than
   * captured at construction. The Studio is told separately; a note holds any
   * number of blocks and they are not part of its view.
   */
  refreshEmbeds(): void {
    for (const embed of this.embeds.values()) embed.refreshDiagram();
  }

  /**
   * The editor in front of the user, if there is one.
   *
   * `activeEditor` covers source mode and live preview. The view lookup is the
   * fallback for reading mode, where the note is still the active view but has no
   * editor to insert into.
   */
  private activeEditor(): Editor | undefined {
    const active = this.app.workspace.activeEditor;
    if (active?.editor) return active.editor;
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? undefined;
  }

  /**
   * Everything that can be embedded, nearest first.
   *
   * A vault's `.mo` files are offered by PATH and read only when one is chosen:
   * there may be hundreds, and reading them all to fill a list would cost more
   * than the list is worth.
   */
  private embedCandidates(): EmbedCandidate[] {
    const vault = this.app.vault;
    const view = describeSavedModels({
      modelFolder: this.settings.modelFolder,
      modelFiles: this.settings.modelFiles,
      exists: (p) => vault.getAbstractFileByPath(p) instanceof TFile,
      allModelFiles: vault
        .getFiles()
        .filter((f) => f.extension === "mo")
        .map((f) => f.path),
    });
    const file = (path: string): EmbedCandidateSource => {
      const name = path.split("/").pop()?.replace(/\.mo$/, "") ?? path;
      return {
        label: name,
        group: "In this vault",
        detail: path,
        // The span recorded for the model, or its example's, or the default --
        // the same rule the block itself resolves a span with.
        stopTime: this.stopTime(name),
        load: async () => {
          const f = vault.getAbstractFileByPath(path);
          if (!(f instanceof TFile)) throw new Error(`${path} is not in the vault`);
          return vault.read(f);
        },
      };
    };
    const source = this.sourceForSave();
    const name = this.model.name;
    return buildEmbedCandidates({
      current:
        source.trim() && name
          ? {
              name,
              detail: "from Modelica Studio",
              stopTime: this.stopTime(name),
              // The text that would be saved, not a re-serialisation of the
              // diagram: anything the code editor holds is part of the model.
              load: () => source,
            }
          : undefined,
      examples: EXAMPLES.map((e) => ({
        label: e.name,
        group: "Examples",
        detail: e.description,
        stopTime: e.stopTime,
        load: () => e.source,
      })),
      // A tracked model whose file is missing is left out: every row here has to
      // be loadable, or choosing it produces nothing.
      saved: [
        ...view.rows.filter((r) => r.status !== "missing").map((r) => file(r.path)),
        ...view.untracked.map(file),
      ],
    });
  }

  /** Ask which model, then place the block at the cursor. */
  embedIntoNote(): void {
    const editor = this.activeEditor();
    new EmbedPickerModal({
      app: this.app,
      candidates: this.embedCandidates(),
      editor,
      noEditorHint: "open a note and put the cursor where the block should go",
    }).open();
  }

  /** Place the model the Studio has open, without asking which. */
  embedCurrent(editor: Editor): void {
    const source = this.sourceForSave();
    if (!source.trim()) {
      new Notice("Modelica: there is no model to embed.");
      return;
    }
    const name = this.model.name;
    insertEmbedBlock(editor, embedBlockText(source, { ...EMBED_DEFAULTS, stopTime: this.stopTime(name) }));
    new Notice(`Modelica: ${name} embedded in the note.`);
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

  /**
   * The text to write to a `.mo` file.
   *
   * The SOURCE wins whenever there is one, and this is the fix for a data-losing
   * bug: saving used to serialise the DIAGRAM, so anything the code editor held
   * that had not been pushed into it — a repair from the AI, a line typed and not
   * yet applied — was not written. The user saw a saved file that did not contain
   * their fix, and after a restart the old text was back.
   *
   * The serializer is a fallback, not the primary path. It rebuilds from the
   * parsed model, which is lossy: declaration comments go, formatting is
   * normalised, and anything the parser does not model is simply absent. It is
   * only correct when the diagram IS the truth, which is the case for a model
   * assembled by dragging, where the source is regenerated from it on every edit.
   */
  sourceForSave(): string {
    if (this.modelSource.trim() && !this.modelOutdated) return this.modelSource;
    if (this.modelSource.trim()) {
      // The diagram is the truth from here, but the file's TEXT is still the
      // model's text. Rebuilding it from the parsed model is what deleted a
      // nested `package Medium = ...` from a user's tank model and left every
      // later run with "Base class Medium not found in scope TwoOutletTank"
      // (see modelica/text-edit). So the diagram's changes are written INTO the
      // text, and only the declarations it owns are touched.
      const patched = patchDiagramEdits(this.modelSource, this.model);
      if (patched) {
        this.patchNote = "";
        return patched.text;
      }
      const reason = lastPatchRefusal() ?? "unknown reason";
      const rebuilt = serializeDiagram(this.model);
      const lost = structureLostBy(this.modelSource, rebuilt);
      if (!lost.length) {
        this.patchNote = "";
        this.trace.add("save", this.model.name, { patched: "no", reused: rebuilt.length, because: reason });
        return rebuilt;
      }
      // The file says something the rebuild cannot, and the patch could not be
      // applied. Writing the rebuild would destroy it, so the file is left as it
      // is and the caller says so rather than losing it quietly.
      this.patchNote = `${reason}; a rebuild would lose ${lost.slice(0, 3).join(", ")}`;
      this.trace.add("save", this.model.name, { patched: "refused", because: this.patchNote });
      return this.modelSource;
    }
    return serializeDiagram(this.model);
  }

  /**
   * What the last save could not write into the source, if anything.
   *
   * Read once, by whoever is about to tell the user the save happened.
   */
  takePatchNote(): string {
    const note = this.patchNote;
    this.patchNote = "";
    return note;
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
  /**
   * Where a model's revisions are kept.
   *
   * In the plugin's own folder, NOT in the vault: snapshots that sit beside the
   * models they protect can be moved, renamed or deleted along with them, which is
   * the opposite of a backup. The plugin's folder is the one location guaranteed
   * writable and guaranteed to belong to this plugin.
   */
  private revisionsRoot(): string | undefined {
    try {
      const adapter = this.app.vault.adapter as { getBasePath?: () => string };
      const base = adapter.getBasePath?.();
      if (!base) return undefined;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require("node:path") as typeof import("node:path");
      return path.join(base, this.app.vault.configDir, "plugins", this.manifest.id, "history");
    } catch {
      return undefined;
    }
  }

  /** Every revision of a model, newest first. Never throws: history is a bonus. */
  listRevisions(modelName: string): Revision[] {
    const root = this.revisionsRoot();
    if (!root) return [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("node:fs") as typeof import("node:fs");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require("node:path") as typeof import("node:path");
      const dir = path.join(root, revisionDirName(modelName));
      if (!fs.existsSync(dir)) return [];
      const out: Revision[] = [];
      for (const file of fs.readdirSync(dir)) {
        const at = revisionTime(file);
        if (!at) continue;
        out.push({ file, at, bytes: fs.statSync(path.join(dir, file)).size });
      }
      return out.sort((a, b) => b.at.getTime() - a.at.getTime());
    } catch {
      return [];
    }
  }

  /** The text of one revision, or null when it cannot be read. */
  readRevision(modelName: string, file: string): string | null {
    const root = this.revisionsRoot();
    if (!root) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("node:fs") as typeof import("node:fs");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require("node:path") as typeof import("node:path");
      // `file` comes from our own listing, but it is still checked: a name with a
      // separator in it would escape the model's directory.
      if (file.includes("/") || file.includes("\\") || file.includes("..")) return null;
      return fs.readFileSync(path.join(root, revisionDirName(modelName), file), "utf8");
    } catch {
      return null;
    }
  }

  /**
   * Record a revision, if it differs from the last one.
   *
   * Called before a save overwrites a file, so what is stored is the version being
   * replaced rather than the one replacing it. Never throws: a history that cannot
   * be written must not stop a model being saved.
   */
  snapshotRevision(modelName: string, source: string): void {
    const root = this.revisionsRoot();
    if (!root || !source.trim()) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("node:fs") as typeof import("node:fs");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require("node:path") as typeof import("node:path");
      const dir = path.join(root, revisionDirName(modelName));
      const existing = this.listRevisions(modelName);
      const newest = existing[0] ? this.readRevision(modelName, existing[0].file) : undefined;
      if (!isNewRevision(newest ?? undefined, source)) return;

      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, revisionFileName(new Date())), source, "utf8");

      for (const old of revisionsToPrune(this.listRevisions(modelName))) {
        fs.rmSync(path.join(dir, old.file), { force: true });
      }
      this.trace.add("snapshot", modelName, { revisions: existing.length + 1 });
      this.diag(`history: kept a revision of ${modelName} (${existing.length + 1} total)`);
    } catch (err) {
      this.diag(`history: could not record a revision of ${modelName}: ${String(err)}`, "warn");
    }
  }

  /** Throw away a model's whole history. Used when the model itself is deleted. */
  clearRevisions(modelName: string): void {
    const root = this.revisionsRoot();
    if (!root) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("node:fs") as typeof import("node:fs");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require("node:path") as typeof import("node:path");
      fs.rmSync(path.join(root, revisionDirName(modelName)), { recursive: true, force: true });
    } catch {
      /* a history that cannot be removed is not worth a failure */
    }
  }

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
  /** The settings tab, kept so it can re-render when the index becomes known. */
  private settingsTab: ModelicaStudioSettingTab | null = null;

  /**
   * Every step that changes what is on disk.
   *
   * `modelicaStudio.trace()` reads it back. See `diagnostics/trace.ts` for why it
   * exists: the losses here have all been two modules disagreeing about when
   * something is written, with nothing failing at the time.
   */
  readonly trace = new Trace();

  /**
   * Take the model's source from its file, when there is one.
   *
   * Called on load, and after a save, so the file and the studio cannot disagree
   * about what the model is. Silently does nothing when there is no file, or the
   * file cannot be read: the snapshot is a real fallback, just not the authority.
   */
  /** Set when a file's source should be adopted once the vault is indexed. */
  private pendingSourceAdoption = false;

  /**
   * Adopt the pending source once the vault is usable.
   *
   * Called from `onLayoutReady`. Doing this during `loadSettings` looked right and
   * did nothing: the vault is not indexed yet, so the model's file is not found
   * and the snapshot is kept.
   */
  adoptPendingSource(): boolean {
    if (!this.pendingSourceAdoption) return false;
    this.pendingSourceAdoption = false;
    return this.adoptSourceFromFile();
  }

  /** True when the file's text was taken. */
  private adoptSourceFromFile(): boolean {
    const path = this.settings.modelFiles[this.model.name];
    if (!path) {
      this.diag(`load: ${this.model.name} has no tracked file`, "info");
      return false;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      this.diag(`load: ${path} is not in the vault yet`, "warn");
      return false;
    }
    const text = this.cachedFileText(path);
    if (text === null || !text.trim()) {
      this.diag(`load: ${path} could not be read`, "warn");
      return false;
    }
    this.modelSource = text;
    this.modelOutdated = true; // the diagram came from the snapshot, not this text
    this.diag(`load: took the source from ${path} (${text.length} chars)`, "info");
    return true;
  }

  /**
   * Whether the model in the studio differs from its file.
   *
   * Read from the vault rather than tracked as a flag: a flag can drift out of
   * step with the file -- the whole class of bug this plugin keeps having -- and
   * comparing two strings is cheap next to being wrong about whether the user's
   * work is safe.
   */
  saveState(): SaveDescription {
    const path = this.settings.modelFiles[this.model.name];
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (!(file instanceof TFile)) return describeSaveState({ source: "", onDisk: null });
    const onDisk = this.cachedFileText(file.path);
    return describeSaveState({
      source: this.sourceForSave(),
      onDisk,
      // What this plugin last read or wrote for that path. Anything else on disk now is
      // somebody else's write — another editor, a script, a repair — and saving over it
      // would destroy it silently.
      lastSeen: this.fileSeen.get(file.path),
    });
  }

  /**
   * The file contents this plugin last read or wrote, by path.
   *
   * Recorded on load and after every save. It is what separates "the user has unsaved
   * edits" from "the file changed underneath the studio" — two states that used to look
   * identical in the status line.
   */
  readonly fileSeen = new Map<string, string>();

  /** Note what a path holds, so a later difference means someone else wrote it. */
  rememberFileText(path: string, text: string): void {
    this.fileSeen.set(path, text);
  }

  /**
   * A file's text, cached by modification time.
   *
   * `saveState` runs to draw the status bar, which happens often; reading the file
   * each time would put a disk read in the paint path. The mtime is what makes the
   * cache safe -- a file changed outside the plugin is still picked up.
   */
  private fileTextCache = new Map<string, { mtime: number; text: string }>();
  private cachedFileText(path: string): string | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("node:fs") as typeof import("node:fs");
      const adapter = this.app.vault.adapter as { getBasePath?: () => string };
      const base = adapter.getBasePath?.();
      if (!base) return null;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const nodePath = require("node:path") as typeof import("node:path");
      const full = nodePath.join(base, path);
      const mtime = fs.statSync(full).mtimeMs;
      const hit = this.fileTextCache.get(path);
      if (hit && hit.mtime === mtime) return hit.text;
      const text = fs.readFileSync(full, "utf8");
      this.fileTextCache.set(path, { mtime, text });
      return text;
    } catch {
      return null;
    }
  }

  /**
   * Where the AI exchange log lives.
   *
   * Beside `data.json` in the plugin's own folder rather than in the vault: it is
   * diagnostic evidence, not a note, and it should not appear in the file
   * explorer or be synced as content.
   */
  aiLogPath(): string | undefined {
    const data = this.dataFilePath();
    if (!data) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodePath = require("node:path") as typeof import("node:path");
    return nodePath.join(nodePath.dirname(data), "ai-exchanges.jsonl");
  }

  /**
   * Record one exchange, if the log is on.
   *
   * Never allowed to break a generation: a log that cannot be written is a lost
   * diagnostic, not a failed request.
   */
  appendAiExchange(exchange: AiExchange): void {
    if (!this.settings.aiLog) return;
    const file = this.aiLogPath();
    if (!file) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("node:fs") as typeof import("node:fs");
      fs.appendFileSync(file, toLogLine(exchange, this.aiKey()) + "\n");
      // Trimmed on write rather than on read: the file is bounded by construction,
      // so it cannot grow without limit if nobody ever opens it.
      const text = fs.readFileSync(file, "utf8");
      const pruned = pruneLines(text);
      if (pruned !== text) fs.writeFileSync(file, pruned, "utf8");
    } catch (err) {
      this.diag(`ai log: could not record the exchange: ${String(err)}`, "warn");
    }
  }

  /** Read the exchanges back, newest last. */
  readAiExchanges(): AiExchange[] {
    const file = this.aiLogPath();
    if (!file) return [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("node:fs") as typeof import("node:fs");
      if (!fs.existsSync(file)) return [];
      return parseLog(fs.readFileSync(file, "utf8")).exchanges;
    } catch {
      return [];
    }
  }

  /** Delete the log, for when it has served its purpose. */
  clearAiExchanges(): void {
    const file = this.aiLogPath();
    if (!file) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("node:fs") as typeof import("node:fs");
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      /* nothing to clear */
    }
  }

  /** Forget the cached text for a path, after writing it. */
  forgetFileText(path: string): void {
    this.fileTextCache.delete(path);
  }


  /**
   * Record the current state under one step.
   *
   * One call rather than passing five facts at each site, so a new field is added
   * in one place and every existing step gains it -- which is what makes the trace
   * comparable step to step, and comparison is the whole point.
   */
  traceStep(kind: TraceKind, model = this.model.name): void {
    this.trace.add(
      kind,
      model,
      describeStateForTrace({
        modelName: model,
        sourceLength: this.modelSource.length,
        sourceIsCurrent: !this.modelOutdated,
        components: this.model.components.length,
        equations: this.model.equations?.length ?? 0,
        savedPath: this.settings.modelFiles[model] ?? null,
        mode: this.settings.editorMode,
      })
    );
  }

  /** Print every diagnostic to the console, not only the ones the setting allows. */
  verbose = false;


  /**
   * Diagnostics, to the developer console AND to a file.
   *
   * The console is the point. Obsidian's developer console is where anyone
   * debugs a plugin — Ctrl+Shift+I, watch it live — and this wrote only to a file
   * in the vault, so nothing appeared there at all. A plugin that is silent in
   * the console is a plugin you cannot debug.
   *
   * The file remains, and remains opt-in, because it survives a reload and can be
   * read from outside the app; the console is live but scrolls away.
   *
   * Levels exist so the console is usable. `error` and `warn` always print: a
   * failure the user cannot see is the one they will report as "nothing
   * happened". `info` prints when the debug setting is on. `debug` additionally
   * needs the console's own verbose toggle, because a hundred geometry lines
   * between two useful ones is not debugging.
   */
  diag(message: string, level: "debug" | "info" | "warn" | "error" = "debug"): void {
    if (level === "error" || level === "warn") {
      const out = level === "error" ? console.error : console.warn;
      out(`[Modelica Studio] ${message}`);
      this.appendDiagnosticLog(`[${level}] ${message}`);
      return;
    }
    if (!this.settings.debugLog) {
      // Nothing to print and nothing to write; return before doing either.
      return;
    }
    if (level === "info" || this.verbose) console.log(`[Modelica Studio] ${message}`);
    this.appendDiagnosticLog(message);
  }

  /** Write one line to the vault's diagnostic file, when logging is enabled. */
  private appendDiagnosticLog(message: string): void {
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

  /**
   * Everything worth inspecting, in one object.
   *
   * Assigning this to `window.modelicaStudio` turns the developer console from a
   * log tail into a prompt: the plugin's state is a graph of settings, a parsed
   * model, an index of several thousand classes and a live view, and reading it
   * out of log lines is guesswork. From the console:
   *
   *   modelicaStudio.state()          // what the plugin currently holds
   *   modelicaStudio.settings         // the stored settings
   *   modelicaStudio.model            // the parsed diagram
   *   modelicaStudio.source()         // the model as Modelica
   *   modelicaStudio.view             // the open studio view, if any
   *   modelicaStudio.library.size     // how many classes were indexed
   *   modelicaStudio.runLog.toText()  // every simulation this session
   *   modelicaStudio.verbose = true   // and then every diag line prints
   */
  debugHandle(): Record<string, unknown> {
    return {
      plugin: this,
      get settings() {
        return (this as unknown as { plugin: ModelicaStudioPlugin }).plugin.settings;
      },
      get model() {
        return (this as unknown as { plugin: ModelicaStudioPlugin }).plugin.model;
      },
      get view() {
        return (this as unknown as { plugin: ModelicaStudioPlugin }).plugin.getView();
      },
      get library() {
        return (this as unknown as { plugin: ModelicaStudioPlugin }).plugin.library;
      },
      get backend() {
        return (this as unknown as { plugin: ModelicaStudioPlugin }).plugin.backend;
      },
      get runLog() {
        return (this as unknown as { plugin: ModelicaStudioPlugin }).plugin.runLog;
      },
      // What would be saved, not what a rebuild of the diagram looks like:
      // the two differ, and the difference is the bug this surface is for.
      source: () => this.sourceForSave(),
      state: () => this.describeState(),
      setVerbose: (on: boolean) => {
        this.verbose = on;
        return `Modelica Studio: verbose ${on ? "on" : "off"}`;
      },
      /**
       * Measure the two forms against each other.
       *
       * Lives on the plugin because the API key is in the keychain and the
       * compiler is a backend this object already holds -- neither is reachable
       * from outside the app, and the key must not leave it.
       *
       *   await modelicaStudio.benchmark()                     // all prompts, both styles
       *   await modelicaStudio.benchmark({ styles: ["visual"] })
       *   await modelicaStudio.benchmark({ only: ["divider", "tank"] })
       */
      /**
       * Run the measurement without typing `await`.
       *
       * DevTools refuses a pasted `await ...` until it is unlocked, and the guide
       * for that is a paragraph of security text. A short name with no `await` is
       * typeable from memory, and results print as they arrive rather than at the
       * end, so nothing has to be kept on screen.
       */
      bench: (options?: { styles?: Array<"visual" | "equations">; only?: string[] }) => {
        const handle = (window as unknown as { modelicaStudio: Record<string, unknown> }).modelicaStudio;
        void (handle.benchmark as (o?: unknown) => Promise<string>)(options).then((table) => {
          console.log(table);
        });
        return "Running… results print here as they finish.";
      },
      benchmark: async (options?: { styles?: Array<"visual" | "equations">; only?: string[] }) => {
        if (!this.backend) return "No OpenModelica backend, so nothing can be compiled.";
        const library = await this.ensureLibrary();
        const prompts = options?.only?.length
          ? BENCH_PROMPTS.filter((p) => options.only!.includes(p.id))
          : BENCH_PROMPTS;
        const environment = describeEnvironment(this.aiEnvironment());
        const available = describeAvailableClasses(library, "modelica", 24);
        console.log(`[Modelica Studio] benchmark: ${prompts.length} prompt(s), ${(options?.styles ?? ["visual", "equations"]).length} style(s)`);
        const results = await runBenchmark({
          config: this.settings.ai,
          backend: this.backend,
          environment,
          getKey: () => this.aiKey(),
          settings: {
            startTime: this.settings.startTime,
            stopTime: this.stopTime(),
            numberOfIntervals: this.settings.numberOfIntervals,
            tolerance: this.settings.tolerance,
            solver: this.settings.solver,
          },
          prompts,
          styles: options?.styles,
          buildMessages: (prompt, current, failure, style) =>
            buildMessages({
              prompt,
              current,
              diagnostics: failure || undefined,
              library: this.library,
              systemPrompt: this.settings.ai.systemPrompt,
              environment,
              availableClasses: available,
              style,
            }),
          send: (messages) => chat(this.settings.ai, messages, () => this.aiKey()),
          onProgress: (line) => console.log(`[Modelica Studio] ${line}`),
        });
        const table = formatBenchmark(results);
        console.log(table);
        return table;
      },
      /**
       * What the plugin has held, step by step.
       *
       *   modelicaStudio.trace()                 the last 20 steps
       *   modelicaStudio.trace({ all: true })    the whole session
       *   modelicaStudio.trace({ model: "Tank" }) just that model
       */
      trace: (options?: { all?: boolean; model?: string; last?: number }) => {
        const entries = options?.model
          ? this.trace.forModel(options.model)
          : options?.all
            ? this.trace.all()
            : this.trace.last(options?.last ?? 20);
        const text = this.trace.toText(entries);
        console.log(text);
        return text;
      },
      /**
       * The AI exchanges, as text.
       *
       *   modelicaStudio.aiLog()            a summary of what went wrong
       *   modelicaStudio.aiLog({ all: true })  every exchange, verbatim
       */
      aiLog: (options?: { all?: boolean }) => {
        const exchanges = this.readAiExchanges();
        const text = options?.all
          ? exchanges.map((e) => toLogLine(e, null)).join("\n")
          : formatSummary(summarise(exchanges), exchanges.slice(-15));
        console.log(text);
        return text;
      },
      /** Delete the AI log. */
      clearAiLog: () => {
        this.clearAiExchanges();
        return "AI log cleared.";
      },
      /** Forget the trace, so the next steps are read on their own. */
      clearTrace: () => {
        this.trace.clear();
        return "Trace cleared.";
      },
      probeHelp: () => {
        const anchor = document.querySelector(".modelica-studio-help") as HTMLElement | null;
        const row = document.querySelector(".modelica-studio-classrow") as HTMLElement | null;
        const svg = anchor?.querySelector("svg") ?? null;
        return {
          classRowFound: !!row,
          classRowText: row?.textContent ?? null,
          anchorFound: !!anchor,
          href: anchor?.getAttribute("href") ?? null,
          svgFound: !!svg,
          rect: anchor
            ? (() => {
                const r = anchor.getBoundingClientRect();
                return `${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.left)},${Math.round(r.top)}`;
              })()
            : null,
          svgFill: svg ? getComputedStyle(svg).fill : null,
          svgStroke: svg ? getComputedStyle(svg).stroke : null,
          anchorColor: anchor ? getComputedStyle(anchor).color : null,
          libraryRootNames: this.libraryRootNames(),
        };
      },
      help: () =>
        [
          "modelicaStudio.state()      what the plugin holds",
          "modelicaStudio.settings     stored settings",
          "modelicaStudio.model        the parsed diagram",
          "modelicaStudio.source()     the model as Modelica",
          "modelicaStudio.view         the open studio view",
          "modelicaStudio.library      the class index",
          "modelicaStudio.runLog       every simulation this session",
          "modelicaStudio.trace()      what the plugin held, step by step",
          "modelicaStudio.setVerbose(true)   print every diagnostic",
        ].join("\n"),
    };
  }

  /** A one-screen summary of what the plugin is holding, for the console. */
  describeState(): Record<string, unknown> {
    const view = this.getView();
    return {
      model: {
        name: this.model.name,
        components: this.model.components.length,
        connections: this.model.connections.length,
        equations: this.model.equations?.length ?? 0,
      },
      stopTime: this.stopTime(),
      savedAs: this.settings.modelFiles[this.model.name] ?? null,
      saveFolder: this.settings.modelFolder || "(vault root)",
      library: { ready: this.libraryReady, classes: this.library.size },
      openModelica: this.omc ? `${this.omc.version ?? "?"} at ${this.omc.omcPath}` : "not found",
      backend: this.backend ? "ready" : "none",
      studioOpen: view ? view.getViewType() : null,
      simulations: this.runLog.size,
      debugLog: this.settings.debugLog,
      verboseConsole: this.verbose,
    };
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    // Move an old plaintext key into the keychain before anything can use it.
    await this.migrateLegacyAiKey();
    this.diag("ai: " + describeSecretPresence(this.app, secretNameOf(this.settings.ai)));
    // Exposed before anything can fail, so a plugin that fails to load is still
    // inspectable from the console rather than silent.
    (window as unknown as { modelicaStudio?: unknown }).modelicaStudio = this.debugHandle();
    // Only with the debug log on. The console is the user's, not ours: a line printed
    // on every load is noise in everyone's DevTools to advertise a tool that the
    // README documents and that a reader who wants it knows how to find.
    if (this.settings.debugLog) {
      console.log(
        "[Modelica Studio] loaded. Type modelicaStudio.help() in this console for what you can inspect."
      );
    }
    this.diag(`onload start; omcPath="${this.settings.omcPath}" jobs=${this.settings.jobs}`, "info");

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

    // The id must not contain the plugin's own id: Obsidian prefixes every command id
    // with it, so the palette entry would read "Modelica Studio: Open Modelica
    // Studio". The submission requirements call this out by name.
    this.addCommand({
      id: "open-view",
      name: "Open Modelica Studio",
      callback: () => void this.activateView(),
    });

    this.addCommand({
      id: "check-model",
      name: "Check the current model",
      checkCallback: (checking) => {
        const view = this.getView();
        if (!view) return false;
        if (!checking) void view.checkModel();
        return true;
      },
    });

    this.addCommand({
      id: "copy-diagram-image",
      name: "Copy the diagram as an image",
      checkCallback: (checking) => {
        const view = this.getView();
        if (!view) return false;
        if (!checking) void view.copyDiagramFigure();
        return true;
      },
    });

    this.addCommand({
      id: "save-diagram-image",
      name: "Save the diagram as an image",
      checkCallback: (checking) => {
        const view = this.getView();
        if (!view) return false;
        if (!checking) void view.saveDiagramFigure();
        return true;
      },
    });

    this.addCommand({
      id: "embed-simulation",
      name: "Embed a simulation in the current note",
      callback: () => this.embedIntoNote(),
    });

    this.addCommand({
      id: "embed-current-model",
      name: "Embed the open model in the current note",
      // Offered only where there is somewhere to put it: a command that quietly
      // does nothing is worse than one that is not in the list.
      checkCallback: (checking) => {
        const editor = this.activeEditor();
        if (!editor) return false;
        if (!checking) this.embedCurrent(editor);
        return true;
      },
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
      id: "new-model",
      name: "New model",
      callback: () => void this.promptNewModel(),
    });

    this.addCommand({
      id: "show-ai-log",
      name: "Show the AI prompt log",
      callback: () => {
        const exchanges = this.readAiExchanges();
        const summary = formatSummary(summarise(exchanges), exchanges.slice(-15));
        // The summary says WHAT keeps going wrong; the exchanges say what was
        // actually sent and answered, which is what a prompt change needs.
        const detail = formatExchanges(exchanges);
        const text = detail
          ? `${summary}\n\n${"-".repeat(72)}\n\n${detail}`
          : summary;
        new TextModal(this.app, "AI prompt log", text).open();
      },
    });

    this.addCommand({
      id: "save-model",
      name: "Save model to a .mo file",
      checkCallback: (checking) => {
        const view = this.getView();
        if (!view) return false;
        if (!checking) void view.saveToNote();
        return true;
      },
    });

    // A `.mo` file opens as plain text by default, which is the right default:
    // the source is the thing, and it is readable. The studio is offered as a
    // second way in rather than taking the click away.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "mo") return;
        menu.addItem((item) =>
          item
            .setTitle("Open in Modelica Studio")
            .setIcon("circuit-board")
            .onClick(() => void this.loadModelFromFile(file))
        );
      })
    );

    this.addCommand({
      id: "new-model-from-note",
      name: "Open the active .mo file in Modelica Studio",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "mo") return false;
        if (!checking) void this.loadModelFromFile(file);
        return true;
      },
    });

    // Kept, so the tab can be told when the library index arrives: it lists the
    // libraries, and can be open before they are known.
    this.settingsTab = new ModelicaStudioSettingTab(this);
    this.addSettingTab(this.settingsTab);

    // The model's file is the authority, but the vault cannot be read until the
    // layout is ready. This replaces the snapshot's source with the file's, which
    // is what makes a save survive a restart.
    this.app.workspace.onLayoutReady(() => {
      if (!this.pendingSourceAdoption) return;
      // Whether the DIAGRAM in the snapshot is newer than the source beside it:
      // true when the last session ended with a diagram edit that had not been
      // written to the file. Read before adoption, which sets it.
      const diagramIsNewer = this.modelOutdated;
      const adopted = this.adoptPendingSource();
      // No file to adopt from (a model the user built and never saved): the
      // snapshot's diagram is the only copy there is. Re-parsing its source --
      // which for an un-saved model is the bare `model X end X;` skeleton the
      // diagram was built over -- is what emptied a hand-built model on the next
      // launch, so there is nothing to re-parse and nothing to replace.
      if (!adopted) {
        this.getView()?.loadModelIntoEditor();
        return;
      }
      if (diagramIsNewer) {
        // The file's text is now the model's text, but the diagram holds edits the
        // file has not got. Leaving `modelOutdated` set is what makes the next save
        // write those edits INTO that text instead of discarding them.
        this.modelOutdated = true;
        this.getView()?.loadModelIntoEditor();
        return;
      }
      // Re-parse so the diagram matches the source that was just adopted, and
      // push it to the view: the view may already have rendered the snapshot,
      // because it opens before the layout is ready. `setModelFromSource` alone
      // updates the plugin and leaves the editor showing the old text.
      void this.setModelFromSource(this.modelSource, { flushFirst: false }).then(() => {
        // The view may already have rendered the snapshot, so it is told again
        // after the source has been adopted.
        this.getView()?.loadModelIntoEditor();
      });
    });

    // Detect OpenModelica in the background so startup stays fast, and so the
    // index build (which is slower still) is not competing with it.
    void this.detectToolchain();
    this.diag("onload complete: view registered, commands added");
  }

  async onunload(): Promise<void> {
    // Before anything else: a change made in the last 600 ms is still in the
    // debounce timer, and once this returns there is no plugin left to write it.
    this.flushPersistSync();
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
        this.applySettingsToBackend();
      } else {
        this.backend?.dispose();
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

  /**
   * Re-probe for OpenModelica, e.g. after the path setting changed.
   *
   * The rows for the toolchain and the library wrote their value and stopped, so
   * typing a path after an automatic detection failed left the status box saying
   * "not detected" and Simulate offering the install help until a restart.
   */
  async reprobeToolchain(): Promise<void> {
    this.omc = null;
    this.libraryIndex = null;
    this.libraryPromise = null;
    this.libraryReady = false;
    await this.detectToolchain();
    // The rows below the path show what was found, so the tab has to be redrawn.
    this.settingsTab?.onLibraryReady();
    this.settingsTab?.display();
    this.warmLibrary();
  }

  /**
   * Rebuild the component index, e.g. after the library paths changed.
   *
   * The index is memoised and cached on disk under its roots, so a new path only
   * takes effect if the memo is dropped first. Without this the classes a user had
   * just added never reached the palette, search or completion.
   */
  reloadLibrary(): void {
    this.libraryIndex = null;
    this.libraryPromise = null;
    this.libraryReady = false;
    this.warmLibrary();
  }

  /** Push settings that the backend reads when it is created. */
  applySettingsToBackend(): void {
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
  /** The exclusion list, parsed from the settings text. */
  excludedLibraries(): string[] {
    return this.settings.excludedLibraries
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  }

  /**
   * Whether a library class is a connectable component, rather than a type.
   *
   * Asked of the index, which records the class KIND: `Modelica.Units.SI.Height`
   * is a `type` and `Modelica.Blocks.Math.Gain` is a `model`. The difference is
   * what tells a physical quantity apart from a block, and it is what stops a
   * correct equations model being read as an unwired schematic.
   */
  isComponentClass(className: string): boolean {
    const kind = this.library.get(className)?.kind;
    return kind === "model" || kind === "block" || kind === "connector";
  }

  /** Apply the exclusion list to an index and refresh anything showing it. */
  applyExclusions(index: LibraryIndex = this.library): void {
    index.setExcluded(this.excludedLibraries());
  }

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
      this.diag("no Modelica libraries found; the palette will be empty", "error");
      new Notice(
        "Modelica Studio: no Modelica libraries were found. " +
          "Set a library path in Settings → Modelica Studio.",
        10000
      );
    }
    this.libraryRootsUsed = loadedRoots;
    this.libraryIndex = index;
    // Exclusions are part of the index rather than of the palette, so the tree,
    // search and completion all honour them.
    this.applyExclusions(index);
    this.libraryReady = true;
    this.diag(
      `library ready; ${this.excludedLibraries().length} exclusion(s)` 
    );
    // An index that stopped early is missing whole libraries, and every class in
    // them then reads as "not in the library" with nothing to explain why. Said
    // out loud rather than left to be discovered.
    for (const root of index.truncatedRoots) {
      new Notice(
        `Modelica Studio: "${root}" has more files than the indexer will read in ` +
          `one pass, so some of its classes are missing. Split it into smaller ` +
          `library folders, or exclude the ones you do not use.`,
        10000
      );
      this.diag(`library TRUNCATED at ${root}`);
    }
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
        // The settings tab lists the libraries, and can be open before the index
        // exists. Without this it kept saying "no libraries indexed yet".
        this.settingsTab?.onLibraryReady();
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

  getView(): ModelicaStudioView | null {
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
   * The API key for the configured secret, from Obsidian's keychain.
   *
   * Returns null when no secret is chosen or the secret has no value. The legacy
   * plaintext field is consulted last so a key configured before secret storage
   * existed keeps working until it is migrated.
   */
  aiKey(): string | null {
    const name = secretNameOf(this.settings.ai);
    if (name) {
      try {
        const value = this.app.secretStorage?.getSecret(name);
        if (value) return value;
      } catch {
        // SecretStorage is absent before Obsidian 1.11.4, or the name is invalid.
      }
    }
    return legacyKeyOf(this.settings.ai) || null;
  }

  /** True when this Obsidian build has the keychain at all. */
  get hasSecretStorage(): boolean {
    return Boolean(this.app.secretStorage);
  }

  /**
   * Move a plaintext key out of `data.json` and into the keychain.
   *
   * The old field was written unencrypted into the plugin's data file, which
   * lives inside the vault: it travelled to every backup and sync service and
   * was readable by anything that could read the vault. Called once on load when
   * a legacy key is present, and the plaintext copy is removed only after the
   * secret is actually stored.
   */
  async migrateLegacyAiKey(): Promise<void> {
    const legacy = legacyKeyOf(this.settings.ai);
    if (!legacy) return;

    if (!this.hasSecretStorage) {
      // Nothing to migrate into. Leave it alone rather than delete the only copy.
      return;
    }

    const name = secretNameOf(this.settings.ai) || LEGACY_SECRET_NAME;
    try {
      this.app.secretStorage.setSecret(name, legacy);
      this.settings.ai.secretName = name;
      delete this.settings.ai.apiKey;
      await this.saveSettings();
      new Notice(
        `Modelica: your AI API key was moved into Obsidian's keychain as "${name}", ` +
          "and removed from the plugin's data file.",
        8000
      );
    } catch (err) {
      // Keep the plaintext key rather than lose it, and say why.
      new Notice(
        `Modelica: could not move your AI API key into the keychain (${String(err)}). ` +
          "It remains in the plugin settings.",
        10000
      );
    }
  }

  /**
   * Confirm the AI provider answers, and say why if it does not.
   *
   * Exists because "nothing happened" is the hardest failure to act on: a wrong
   * base URL, a rejected key and an unavailable model all look identical from
   * the editor. This asks the provider directly and reports what it said.
   */
  async testAiConnection(): Promise<{ ok: boolean; text: string }> {
    const cfg = this.settings.ai;
    const key = this.aiKey();
    if (!key) {
      return {
        ok: false,
        text: this.hasSecretStorage
          ? "No secret selected. Choose or create one under AI assistance."
          : "This Obsidian version has no keychain. Update Obsidian to store the key securely.",
      };
    }
    try {
      const reply = await chat(
        cfg,
        [
          { role: "system", content: "Reply with the single word: ready" },
          { role: "user", content: "ping" },
        ],
        () => this.aiKey()
      );
      return { ok: true, text: `Connected to ${cfg.model}. The provider replied: ${reply.trim().slice(0, 80)}` };
    } catch (err) {
      return { ok: false, text: err instanceof AiError ? err.message : String(err) };
    }
  }

  /**
   * Refresh the model list from the provider and remember it.
   *
   * Stored so the next visit to the settings page is instant, and so a model
   * that was fetched once is still offered if the provider is unreachable.
   */
  async refreshAiModels(): Promise<{ ok: boolean; text: string; models?: string[] }> {
    const cfg = this.settings.ai;
    const key = this.aiKey();
    if (!key) return { ok: false, text: "Choose or create an API key first." };
    try {
      const models = await listModels(cfg, key);
      if (!models.length) return { ok: false, text: "The provider returned an empty model list." };
      this.settings.aiModels = models;
      await this.saveSettings();
      return { ok: true, text: `${models.length} models available from ${cfg.baseUrl}.`, models };
    } catch (err) {
      return { ok: false, text: err instanceof AiError ? err.message : String(err) };
    }
  }

  /**
   * Every simulation this session, kept so a failure can be handed to the AI
   * in full rather than as a first line.
   */
  readonly runLog = new RunLog();

  /** Library roots the index was built from, for reporting. */
  private libraryRootsUsed: string[] = [];

  /** Short names of the indexed libraries, e.g. "Modelica 4.1.0". */
  libraryRootNames(): string[] {
    return this.libraryRootsUsed.map((r) => r.split("/").filter(Boolean).pop() ?? r);
  }

  /** What the AI needs to know about this installation. */
  aiEnvironment(): AiEnvironment {
    const s = this.settings;
    const example = findExample(this.model.name);
    return {
      omcPath: this.omc?.omcPath,
      omcVersion: this.omc?.version,
      libraryRoots: this.omc?.libraryRoots,
      classCount: this.library.size || undefined,
      libraryNames: this.libraryRootNames?.(),
      startTime: s.startTime,
      stopTime: this.stopTime(),
      numberOfIntervals: s.numberOfIntervals,
      tolerance: s.tolerance,
      solver: s.solver,
      jobs: s.jobs,
      excluded: this.excludedLibraries(),
      fromExample: example?.name,
    };
  }

  /**
   * The standing brief for every AI request.
   *
   * Environment first, then the log of failed runs, because a model that knows
   * which OpenModelica and which libraries it is writing for does not invent
   * class names, and one that can see the compiler output can fix the actual
   * fault instead of a paraphrase of it.
   */
  aiContext(request: string): string {
    const parts = [describeEnvironment(this.aiEnvironment())];
    if (this.library.size) parts.push(describeAvailableClasses(this.library, request));
    const failures = describeLog(
      this.runLog.recentFailures().map((e) => ({ at: e.at, model: e.model, ok: e.ok, detail: e.detail }))
    );
    if (failures) parts.push(failures);
    return parts.join("\n\n");
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
      /** True when the diagram holds edits that source has not got. */
      modelOutdated?: boolean;
    } | null;
    this.settings = migrateSettings(mergeSettings(DEFAULT_SETTINGS, data), data);
    if (data?.model && Array.isArray(data.model.components)) {
      // `modelOutdated` comes back too, because the snapshot's DIAGRAM is the only
      // copy of a diagram-only edit: without the flag the layout-ready handler
      // treated the source as the truth and re-parsed it over the restored model.
      this.replaceModel(
        data.model,
        typeof data.modelSource === "string" ? data.modelSource : "",
        data.modelOutdated === true
      );
      // The FILE wins over the snapshot -- see `adoptSourceFromFile`. Deferred to
      // `onLayoutReady` rather than done here: `loadSettings` runs before Obsidian
      // has indexed the vault, so every lookup returned "not in the vault yet" and
      // the adoption silently did nothing. The vault is only trustworthy once the
      // layout is ready.
      this.pendingSourceAdoption = true;
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

  /**
   * Make sure everything currently open is on disk.
   *
   * Called before the model is replaced. Two things are written: the pending
   * state, synchronously, because the debounce is about to be cancelled; and the
   * model's own `.mo` file, because an unsaved repair is worth more than a tidy
   * vault.
   *
   * Only for a model that already has a file. A model that has never been saved
   * is not given one here -- creating files behind the user's back is a different
   * decision from not losing their work.
   */
  async flushCurrentModel(): Promise<void> {
    this.flushPersistSync();
    const name = this.model.name;
    if (!this.settings.modelFiles[name]) return;
    try {
      // Whatever the editor holds, first: the same rule saving follows.
      this.getView()?.flushEditorIntoModel();
      await this.saveModelToNote();
      this.traceStep("switch", name);
      this.diag(`switch: saved ${name} before replacing it`, "info");
    } catch (err) {
      // The switch goes ahead regardless -- refusing to open a file because
      // another could not be written would be its own kind of trap -- but it must
      // not pass unnoticed.
      this.diag(`switch: could not save ${name} before replacing it: ${String(err)}`, "warn");
      new Notice(
        `Modelica Studio: could not save "${name}" before opening the other model. ` +
          `Its changes are still in the studio.`
      );
    }
  }

  /**
   * Where the plugin's own data file lives.
   *
   * Obsidian writes it through `saveData`, which is asynchronous. That is fine
   * everywhere except unload, where the process may be gone before the promise
   * settles — see `flushPersistSync`.
   */
  private dataFilePath(): string | undefined {
    try {
      const adapter = this.app.vault.adapter as { getBasePath?: () => string };
      const base = adapter.getBasePath?.();
      if (!base) return undefined;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require("node:path") as typeof import("node:path");
      return path.join(
        base,
        this.app.vault.configDir,
        "plugins",
        this.manifest.id,
        "data.json"
      );
    } catch {
      return undefined;
    }
  }

  /**
   * The payload both save paths write.
   *
   * One function so the synchronous and asynchronous saves cannot disagree about
   * what is persisted — a divergence there would be a data-loss bug of its own.
   */
  private persistPayload(): Record<string, unknown> {
    return {
      ...this.settings,
      model: this.model,
      modelSchema: MODEL_SCHEMA,
      modelSource: this.modelSource,
      // Whether the diagram is newer than that source. Without it a restart
      // re-parsed the stale source over the restored diagram, which threw away
      // every diagram-only edit -- and, for a model with no file, the model.
      modelOutdated: this.modelOutdated,
      // The time span belongs to the model, not to the plugin. Kept beside the
      // diagram so restoring the model restores the span it is meant to run
      // over, instead of inheriting whatever the previous model used.
      modelStopTime: this.stopTime(),
    };
  }

  /**
   * Write the pending state synchronously, if any is pending.
   *
   * Called from `onunload`. Saving is debounced by 600 ms, so an edit made just
   * before a reload or a quit was still in the timer when the plugin went away and
   * was never written: the user's last change silently vanished. `saveData` cannot
   * be awaited there, so the same payload is written straight to the file the app
   * would have written.
   *
   * Only when a write is actually pending. Writing unconditionally on every
   * unload would touch the file each time the plugin is disabled or the app
   * closes, for no gain.
   */
  flushPersistSync(): void {
    if (this.persistTimer === null) return;
    window.clearTimeout(this.persistTimer);
    this.persistTimer = null;
    const file = this.dataFilePath();
    if (!file) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("node:fs") as typeof import("node:fs");
      fs.writeFileSync(file, JSON.stringify(this.persistPayload(), null, 2), "utf8");
      this.traceStep("unload");
      this.diag("unload: wrote the pending change synchronously");
    } catch (err) {
      // Nothing more can be done here, but it should not pass unnoticed.
      this.diag(`unload: could not write the pending change: ${String(err)}`, "warn");
    }
  }

  /** Persist settings and the current diagram together. */
  async persist(): Promise<void> {
    await this.saveData(this.persistPayload());
  }

  /* ---------------- model I/O ---------------- */

  /**
   * Open a model by vault path, for the places that have a path rather than a
   * file: a drop carries `Modelica/Tank.mo`, not the object.
   */
  async loadModelFromPath(path: string, opts: LoadOptions = {}): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Modelica: ${path} was not found in the vault.`);
      return;
    }
    await this.activateView();
    await this.loadModelFromFile(file, opts);
  }

  async loadModelFromFile(file: TFile, opts: LoadOptions = {}): Promise<void> {
    // Write out whatever is currently open, before it is replaced.
    //
    // This was a silent data-loss path: loading a model overwrote the current one
    // and rescheduled the debounced persist, which CANCELS the pending save. So a
    // repair made just before opening another model was never written -- and the
    // debounce that would have written it was cancelled by the very act of
    // switching. Nothing warned, because nothing had failed.
    //
    // `discardStudioEdits` is the exception, and it is the whole point of Revert
    // and of "Reload from disk": both mean "put the FILE back", so flushing first
    // wrote the studio's copy over the very version that was about to be read --
    // the one action whose purpose is to protect a newer external write destroyed
    // it, and the pre-revert text survived only in the history folder.
    if (!opts.discardStudioEdits) await this.flushCurrentModel();
    const text = await this.app.vault.read(file);
    // What this plugin saw, so that a later difference means someone else wrote it.
    this.rememberFileText(file.path, text);
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
    this.replaceModel(toDiagramModel(withComponents, (n) => this.library.describe(n)), text);
    // Remember the file it came from, so Save writes back to it instead of
    // creating a second copy under the class name.
    this.settings.modelFiles[withComponents.name] = file.path;
    this.traceStep("open", withComponents.name);
    await this.saveSettings();
    await this.persist();
    this.getView()?.loadModelIntoEditor();
    new Notice(`Loaded ${withComponents.name} from ${file.path}.`);
  }

  /**
   * Write the current diagram back to a `.mo` file.
   *
   * The model is the note's content, so the file round-trips through OMEdit.
   */
  /**
   * Write the model to a `.mo` file in the vault.
   *
   * The format is plain Modelica source, which is the only format that matters
   * here: it is what OpenModelica compiles, what OMEdit opens, and what the
   * round trip through the diagram preserves. Nothing is lost by saving it — the
   * graphical annotations are part of the same text.
   *
   * The destination is `<modelFolder>/<ModelName>.mo`. A model that has been
   * saved before goes back to the file it came from, so renaming the class
   * overwrites that file rather than leaving a second copy beside it.
   */
  async saveModelToNote(): Promise<{ path: string; created: boolean }> {
    // Whatever the editor holds is realised first, so a repair made in code mode
    // is saved even if Simulate was never pressed.
    //
    // And if it does not parse, the save is REFUSED. Writing anyway meant
    // `sourceForSave()` returned the previous text while the status line and the
    // notice said "Saved", so the edit the user could see on screen was not in the
    // file and was gone the next time the model was opened.
    const view = this.getView();
    if (view && !view.flushEditorIntoModel()) {
      const why = view.codeProblemText() || "the code pane has an error";
      new Notice(`Modelica: not saved — ${why}`);
      throw new Error(`the code pane does not parse: ${why}`);
    }
    const source = this.sourceForSave();
    // Recorded BEFORE the write, so a trace shows the length that was saved and
    // the length afterwards can be compared against it.
    this.trace.add("save", this.model.name, { bytes: source.length, to: "" });
    const note = this.takePatchNote();
    if (note) {
      new Notice(
        `Modelica: the file was left as it is — this change could not be written into its text (${note}).`,
        10000
      );
    }
    const folder = this.settings.modelFolder.trim().replace(/^\/+|\/+$/g, "");
    if (folder) await this.ensureFolder(folder);

    /**
     * Where a model belongs: the configured folder, named after the class.
     *
     * This is the intended home, not necessarily the current one. A model saved
     * before a folder was configured sits at the root, and re-saving it should
     * put it where it belongs rather than leave a copy in each place.
     */
    const intended = folder ? `${folder}/${this.model.name}.mo` : `${this.model.name}.mo`;

    /**
     * Where it is now, if it is anywhere.
     *
     * The remembered path wins when the model has not been renamed and the
     * target still matches the current setting — that is the common case of
     * saving the same file again. Anything else means the file should move.
     */
    const remembered = (this.settings.modelFiles[this.model.name] ?? "").trim();
    /**
     * Where it is now, if it is anywhere.
     *
     * The intended path is checked FIRST and the remembered one second, so a model
     * saved before a folder was configured is found where it is rather than shadowed
     * by a new file at the conventional path. A path only counts when a FILE is
     * there: taking the remembered path on trust is what made a save whose .mo had
     * been deleted call `vault.modify(null, …)` -- "Cannot read properties of null
     * (reading 'path')" -- instead of recreating it, which is what the Saved-models
     * row promises.
     */
    const at = (path: string): TFile | null => {
      const f = path ? this.app.vault.getAbstractFileByPath(path) : null;
      return f instanceof TFile ? f : null;
    };
    const existing = at(intended) ?? at(remembered);

    if (existing) {
      const here = existing.path;
      this.trace.add("save", this.model.name, { bytes: source.length, to: here, existed: true });
      // The cached text is now stale, and the status bar is about to read it.
      this.forgetFileText(here);
      // The studio now holds exactly what the file holds. Without this the snapshot
      // kept the PREVIOUS text while the file had the new one -- so a restart
      // loaded the old model and the save looked like it had not happened.
      this.modelSource = source;
      this.modelOutdated = false;
      // Snapshot what is being REPLACED, before it is replaced. On disk rather
      // than in memory, so it survives the plugin and can be read with `ls`.
      try {
        this.snapshotRevision(this.model.name, await this.app.vault.read(existing));
      } catch {
        /* history is a bonus; a save must not fail because it could not be kept */
      }
      // `Vault.process`, not `Vault.modify`: the guidelines ask for it, and it is
      // the honest call here -- the replacement is a read-modify-write of a file that
      // another writer (Obsidian's own editor, a sync client) may have touched since
      // the read above, and `modify` would write our text over whatever arrived in
      // between. The callback ignores the text it is handed because a save replaces
      // the whole model by design.
      await this.app.vault.process(existing, () => source);
      this.rememberFileText(here, source);
      this.settings.modelFiles[this.model.name] = here;
      await this.saveSettings();
      return { path: here, created: false };
    }

    // No file anywhere: a new model, or one whose .mo was deleted behind the record.
    // It is written at the INTENDED path -- the configured folder, named after the
    // class -- so recreating a deleted model never puts a file back in the vault root
    // beside the notes. (An existing file is still saved where it is: see above.)
    await this.app.vault.create(intended, source);
    this.trace.add("save", this.model.name, { bytes: source.length, to: intended, created: true });
    this.forgetFileText(intended);
    // Same as above: the studio and the file must agree from here on.
    this.modelSource = source;
    this.modelOutdated = false;
    this.settings.modelFiles[this.model.name] = intended;
    await this.saveSettings();
    return { path: intended, created: true };
  }

  /** Create a vault folder, and any parents, if it is not already there. */
  private async ensureFolder(folder: string): Promise<void> {
    const parts = folder.split("/").filter(Boolean);
    let soFar = "";
    for (const part of parts) {
      soFar = soFar ? `${soFar}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(soFar)) {
        try {
          await this.app.vault.createFolder(soFar);
        } catch (err) {
          // A race with another save, or a path that already exists as a file.
          if (!this.app.vault.getAbstractFileByPath(soFar)) throw err;
        }
      }
    }
  }

  /**
   * Start an empty model.
   *
   * A new model used to be reachable only from the command palette and always
   * took the name passed in; this asks for one and refuses a name that is not a
   * legal Modelica identifier, because the class name and the file name are the
   * same string and OpenModelica cannot compile the difference.
   */
  async promptNewModel(): Promise<void> {
    // Replacing a model that has content is destructive, so it says so. An empty
    // canvas has nothing to lose and needs no warning.
    const hasContent =
      this.model.components.length > 0 ||
      this.model.connections.length > 0 ||
      (this.model.equations?.length ?? 0) > 0;
    // The current model's file, if it has one, so "Save and replace" can write to
    // it rather than asking the user to invent a name.
    const currentName = this.model.name;
    const answer = await promptForText(this.app, {
      // Still a creation dialog: the name being asked for is the new model's.
      title: "New Modelica model",
      placeholder: "ModelName",
      initial: "MyModel",
      confirmLabel: hasContent ? "Replace" : "Create",
      alternativeLabel: hasContent ? "Save and replace" : undefined,
      warning: hasContent
        ? `The studio holds "${currentName}". Naming a new model replaces it here; ` +
          `its file, if it has one, is not touched.`
        : undefined,
      validate: (value) => {
        const v = value.trim();
        if (!v) return "A name is required.";
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) {
          return "Use letters, digits and underscores, and do not start with a digit.";
        }
        if (findExample(v)) return `"${v}" is the name of a built-in example. Choose another.`;
        return null;
      },
    });
    if (!answer) return;
    const name = answer.value.trim();

    // "Save and replace" means what it says: the model being replaced is written
    // to a file first, under its OWN name, so nothing is lost and no extra step
    // is asked of the user.
    if (answer.action === "alternative" && hasContent) {
      try {
        const saved = await this.saveModelToNote();
        new Notice(`Saved ${currentName} to ${saved.path}.`);
      } catch (err) {
        // The save failed, so replacing now WOULD lose the model. Stop rather
        // than proceed on a promise that was not kept.
        new Notice(
          `Could not save "${currentName}", so it was not replaced. ${String(err)}`,
          10000
        );
        return;
      }
    }

    // A new model is a new file, so no remembered path may carry over.
    delete this.settings.modelFiles[name];
    await this.newModel(name);
    await this.activateView();
  }

  /**
   * Replace the active diagram from Modelica source and refresh the view.
   * Returns the parsed model, or undefined when the source has no classes.
   *
   * `fromExample` says the source is one of the SHIPPED models rather than
   * something the user opened, and it is what keeps a built-in example from
   * writing itself over a file. The name-to-path record is keyed by model name,
   * so a user with `Modelica/RLC.mo` who then picked Examples -> RLC kept the
   * record: the header named their file while the canvas held the shipped model,
   * and the next switch saved the shipped text into their file. Two files in the
   * test vault were overwritten exactly that way. Dropping the record cannot lose
   * anything -- the outgoing model was flushed a line earlier -- and it makes the
   * example a model with no file until the user saves it somewhere on purpose.
   */
  async setModelFromSource(
    source: string,
    opts: { flushFirst?: boolean; fromExample?: boolean } = {}
  ): Promise<DiagramModel | undefined> {
    // Replacing what is open is a save point for it: every path that does this
    // (a note block's "Open diagram", the Examples picker, restoring a revision)
    // used to drop the outgoing model's unsaved work with no prompt, while
    // `loadModelFromFile` flushed and `newModel` asked. The default is to flush,
    // so a caller that forgets gets the safe behaviour rather than the lossy one;
    // the startup path passes `false` because there is nothing of the user's to
    // save yet and a write at every launch is not wanted.
    if (opts.flushFirst !== false) await this.flushCurrentModel();
    await this.ensureLibrary();
    const classes = parseModelica(source);
    if (classes.length === 0) return undefined;
    // Prefer the first class that actually has components.
    const target = classes.find((c) => c.components.length > 0) ?? classes[0];
    this.replaceModel(toDiagramModel(target, (n) => this.library.component(n)), source);
    // AFTER the replace, so the name is the new model's: deleting first would
    // drop the record the flush above needs to save the outgoing model at all.
    if (opts.fromExample) delete this.settings.modelFiles[this.model.name];
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

  /**
   * Make a model current, with the source it came from.
   *
   * ONE method, because setting them separately is how `newModel` came to leave
   * the previous model's source behind: `loadModelIntoEditor` then filled the
   * editor from that stale text, and the editor's own change handler parsed it
   * straight back into the plugin -- so the canvas repainted the model the user
   * had just replaced. Every path that replaces the diagram goes through here, so
   * a new one cannot repeat it.
   *
   * `outdated` says the source does NOT describe the diagram, which is true only
   * while a diagram edit has not yet been realised back into text.
   */
  private replaceModel(model: DiagramModel, source: string, outdated = false): void {
    this.model = model;
    this.modelSource = source;
    this.modelOutdated = outdated;
  }

  /** Make a parsed model current, keeping the source it came from. */
  adoptModel(model: DiagramModel, source: string): void {
    this.replaceModel(model, source);
    this.traceStep("adopt", model.name);
    this.schedulePersist();
  }

  /**
   * The diagram editor replaced the model OBJECT it holds.
   *
   * The editor builds a fresh model for an undo, a redo or a re-parse, and each
   * rebuild is a new object. The plugin has to follow it.
   *
   * While the two were allowed to drift, the inspector looked the selected
   * component up in a model that no longer contained it — so clicking a
   * component showed "1 components selected." and no fields at all, for every
   * component in the library, which reads as the plugin being broken rather
   * than as one stale reference. Worse, edits made after the drift went into
   * the copy the plugin had forgotten, and `persist` writes `this.model`, so
   * they never reached the file.
   */
  adoptEditorModel(model: DiagramModel): void {
    if (this.model === model) return;
    this.model = model;
    this.markSourceStale();
  }

  /**
   * The model changed without the source being replaced.
   *
   * Called when a component is dragged, wired or deleted. The stored source no
   * longer describes the model, so it must not be saved — the diagram is the
   * truth from that moment, and the source is regenerated from it.
   */
  markSourceStale(): void {
    // Only the first change per edit burst is worth recording, or a drag would
    // fill the trace with identical steps.
    if (!this.modelOutdated) this.traceStep("edit");
    this.modelOutdated = true;
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

  /**
   * Create a fresh diagram, e.g. from the command palette.
   *
   * The SOURCE goes with the model. Leaving it behind -- which is what this did --
   * meant the editor was filled from the previous model's text, and the editor's
   * change handler parsed that straight back into the plugin, so the canvas
   * repainted the model the user had just replaced. Reported as "the canvas
   * doesn't clean up".
   *
   * The skeleton rather than an empty string: the editor should not open blank,
   * and Save should write a valid class rather than nothing. It is the source OF
   * the empty diagram, so the two agree and nothing re-parses anything.
   */
  async newModel(name: string): Promise<void> {
    this.replaceModel(emptyDiagram(name), `model ${name}\nend ${name};\n`);
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

/**
 * Report whether the configured secret resolves, WITHOUT revealing it.
 *
 * Added because "the key moved into the keychain" cannot be verified from the
 * outside: the value lives in the app's local storage, so the only way to tell a
 * successful migration from a silently dropped key is to ask the app. Only the
 * length is reported, never any part of the value.
 */
export function describeSecretPresence(app: App, name: string): string {
  if (!name) return "no secret configured";
  try {
    const value = app.secretStorage?.getSecret(name);
    if (value === null || value === undefined) return `secret "${name}" NOT FOUND`;
    return `secret "${name}" resolves, length ${value.length}`;
  } catch (err) {
    return `secret lookup failed: ${String(err)}`;
  }
}

/**
 * A one-field text prompt.
 *
 * Obsidian has no text prompt in its public API, only `SuggestModal` (a list)
 * and `Modal`. This is the smallest modal that does the job, with validation
 * shown inline so a bad name is refused before it becomes a file.
 */
/** Which button the user chose in a prompt. */
export type PromptAction = "confirm" | "alternative";

export interface PromptResult {
  value: string;
  action: PromptAction;
}

function promptForText(
  app: App,
  opts: {
    title: string;
    placeholder?: string;
    initial?: string;
    validate?: (value: string) => string | null;
    /**
     * A consequence to state before the user commits.
     *
     * Shown as a warning above the field. A prompt that replaces the current
     * model silently makes the replacement a surprise; saying so first is what
     * makes the action deliberate.
     */
    warning?: string;
    /** Label of the confirming button; "Create" suits creation, "Replace" does not. */
    confirmLabel?: string;
    /**
     * A second confirming action that keeps what is being replaced.
     *
     * A dialog that says "save this first" and offers only Replace and Cancel is
     * asking the user to cancel, save by hand, and start again — a warning about
     * a loss it could have prevented in one click.
     */
    alternativeLabel?: string;
  }
): Promise<PromptResult | null> {
  return new Promise((resolve) => {
    const modal = new Modal(app);
    modal.titleEl.setText(opts.title);
    let settled = false;

    const finish = (value: string | null, action: PromptAction = "confirm") => {
      if (settled) return;
      settled = true;
      modal.close();
      resolve(value === null ? null : { value, action });
    };

    if (opts.warning) {
      modal.contentEl.createDiv({ cls: "modelica-studio-warn", text: opts.warning });
    }
    const input = modal.contentEl.createEl("input", {
      cls: "modelica-studio-prompt-input",
      attr: { type: "text", placeholder: opts.placeholder ?? "" },
    });
    input.value = opts.initial ?? "";
    const problem = modal.contentEl.createDiv({ cls: "modelica-studio-warn" });
    problem.style.display = "none";

    const submit = (action: PromptAction = "confirm") => {
      const value = input.value.trim();
      const error = opts.validate?.(value) ?? null;
      if (error) {
        problem.setText(error);
        problem.style.display = "";
        return;
      }
      finish(value);
    };

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        submit();
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        finish(null);
      }
    });

    const buttons = modal.contentEl.createDiv({ cls: "modelica-studio-prompt-buttons" });
    const ok = buttons.createEl("button", { cls: "mod-cta", text: opts.confirmLabel ?? "Create" });
    ok.addEventListener("click", () => submit());
    // The safe option sits beside the destructive one, so keeping the current
    // model costs a click rather than a retry.
    if (opts.alternativeLabel) {
      const alt = buttons.createEl("button", { text: opts.alternativeLabel });
      alt.addEventListener("click", () => submit("alternative"));
    }
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => finish(null));

    // Resolve if the modal is dismissed by clicking away, or the promise never
    // settles and its caller waits for ever.
    modal.onClose = () => finish(null);
    modal.open();
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  });
}
