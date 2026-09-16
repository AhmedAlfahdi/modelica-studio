/**
 * The Modelica Studio view.
 *
 * Layout: component palette (left) · schematic canvas (centre) · inspector and
 * results (right), with a Modelica source preview along the bottom.
 *
 * The source preview is not decoration: the authoritative representation of a
 * model is its Modelica text, so showing it keeps the diagram honest and gives
 * an escape hatch when a construct has no diagram form.
 */

import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type ModelicaStudioPlugin from "../main";
import { SchematicEditor } from "./editor";
import { drawPlot, plotThemeFrom, seriesColor, summarize, type SeriesStyle } from "./plot";
import { defaultSeriesNames } from "./series";
import { collectParameters } from "./parameters";
import type { TreeNode as PackageNode } from "../modelica/library";
import { drawGraphic } from "../render/canvas";
import { currentTheme } from "../render/theme";
import { EXAMPLES, findExample } from "../modelica/examples";
import type {
  ComponentClass,
  ComponentInstance,
  DiagramModel,
  ParameterDef,
} from "../modelica/types";
import { serializeDiagram } from "../modelica/serializer";
import { createCodeEditor, CodeEditorHandle, Diagnostic } from "./code-editor";
import { AiError, buildMessages, chat, extractModelica, modelNameOf } from "../ai/client";
import type { SimResult, SimSeries } from "../omc/backend";

export const VIEW_TYPE_MODELICA = "modelica-studio-view";

export class ModelicaStudioView extends ItemView {
  plugin: ModelicaStudioPlugin;

  private editor: SchematicEditor | null = null;
  private paletteEl!: HTMLElement;
  private canvasHost!: HTMLElement;
  private inspectorEl!: HTMLElement;
  private inspectorCol!: HTMLElement;
  private splitterEl!: HTMLElement;
  /** The whole editable area: palette, canvas and inspector. */
  private bodyEl!: HTMLElement;
  /** Editing mode. Diagram and code are two views of one model. */
  private mode: "diagram" | "code" = "diagram";
  /** Code-mode pane, created on first use. */
  private codeHost!: HTMLElement;
  private codeEditor: CodeEditorHandle | null = null;
  private codeToolbar!: HTMLElement;
  private aiRow!: HTMLElement;
  private modeButtons: Record<string, HTMLElement> = {};
  private statusEl!: HTMLElement;
  private plotCanvas: HTMLCanvasElement | null = null;
  private plotHost: HTMLElement | null = null;
  /** Tab strip above the inspector body. */
  private inspectorTabsEl: HTMLElement | null = null;
  /**
   * Which inspector tab is showing.
   *
   * Two, not three. "Properties" and "Parameters" both rendered the identity
   * block and the whole parameter list, so they differed only by the connectors
   * list — two names for one panel.
   */
  private inspectorTab: "component" | "results" = "component";
  /** Filter text for the variable list. */
  private seriesFilter = "";
  /** Which bottom tab is showing. */
  private bottomTab: "plot" | "source" = "plot";
  /** Header of the bottom pane, whose actions depend on the tab. */
  private bottomBarEl: HTMLElement | null = null;
  private bottomActionsEl: HTMLElement | null = null;
  private bottomTabEls: Record<string, HTMLElement> = {};
  /** Placeholder shown in the pane before any result exists. */
  private emptyEl: HTMLElement | null = null;
  /** Pane holding the result plot, below the editing row. */
  private resultsEl: HTMLElement | null = null;
  /** Drag handle above the results pane. */
  private resultsResize: HTMLElement | null = null;
  /** Plot shown in the full-screen overlay, when open. */
  private fullCanvas: HTMLCanvasElement | null = null;
  private fullHost: HTMLElement | null = null;
  /** Axis-scale controls in the overlay, and their refresh callbacks. */
  private scalePanel: HTMLElement | null = null;
  /** The same controls, inline in the bottom pane. */
  private inlineScale: HTMLElement | null = null;
  private scaleInputs: Array<() => void> = [];

  private result: SimResult | null = null;
  private seriesStyles: Record<string, SeriesStyle> = {};
  /** Identifies the result the current trace choices belong to. */
  private seriesSignature = "";
  private cursorX: number | undefined;
  private filterText = "";
  private btnRotate: HTMLButtonElement | undefined;
  private btnDelete: HTMLButtonElement | undefined;
  private btnUndo: HTMLButtonElement | undefined;
  private btnRedo: HTMLButtonElement | undefined;
  private btnCopy: HTMLButtonElement | undefined;
  private btnPaste: HTMLButtonElement | undefined;
  /** Toolbar button for the geometry report; shown only in debug mode. */
  private geometryBtn: HTMLButtonElement | undefined;
  private busy = false;
  /** When true the plot takes the whole inspector panel. */

  constructor(leaf: WorkspaceLeaf, plugin: ModelicaStudioPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_MODELICA;
  }

  getDisplayText(): string {
    return "Modelica Studio";
  }

  getIcon(): string {
    return "circuit-board";
  }

  async onOpen(): Promise<void> {
    const openStart = performance.now();
    const root = this.contentEl;
    root.empty();
    root.addClass("modelica-studio-root");

    const header = root.createDiv({ cls: "modelica-studio-toolbar" });
    this.buildToolbar(header);

    const body = root.createDiv({ cls: "modelica-studio-body" });
    this.bodyEl = body;

    // Palette
    const paletteCol = body.createDiv({ cls: "modelica-studio-col modelica-studio-palette" });
    const search = paletteCol.createEl("input", {
      cls: "modelica-studio-search",
      attr: { type: "text", placeholder: "Search components…" },
    });
    search.addEventListener("input", () => {
      this.filterText = search.value;
      this.renderPalette();
    });
    this.paletteEl = paletteCol.createDiv({ cls: "modelica-studio-palette-list" });

    // Canvas
    this.canvasHost = body.createDiv({ cls: "modelica-studio-col modelica-studio-canvas-host" });

    // Inspector + results, with a draggable splitter so results can be made
    // large enough to actually read.
    const splitter = body.createDiv({ cls: "modelica-studio-splitter" });
    this.splitterEl = splitter;
    const rightCol = body.createDiv({ cls: "modelica-studio-col modelica-studio-inspector" });
    this.inspectorCol = rightCol;
    this.inspectorTabsEl = rightCol.createDiv({ cls: "modelica-studio-tabs" });
    this.inspectorEl = rightCol.createDiv({ cls: "modelica-studio-inspector-body" });
    this.installSplitter(splitter, rightCol);

    // Results get their own pane across the window rather than a slot inside the
    // inspector. In a 380px column a plot is unreadable, and the legend covers
    // half the traces; spanning the window is what makes it legible.
    // The handle comes BEFORE the pane in the DOM. Flex lays out in document
    // order, so appending it after put it below the pane it is meant to sit on
    // top of.
    const resultsSplitter = root.createDiv({ cls: "modelica-studio-results-splitter" });
    const resultsCol = root.createDiv({ cls: "modelica-studio-results" });
    // Restore the height the user dragged it to, so the choice survives a
    // reload rather than resetting to the default every time.
    if (this.plugin.settings.plotHeight > 0) {
      resultsCol.style.height = `${this.plugin.settings.plotHeight}px`;
    }
    this.resultsEl = resultsCol;
    this.resultsResize = resultsSplitter;
    this.installResultsResize(resultsSplitter, resultsCol);

    // There is deliberately no source preview here. It was a read-only copy of
    // the model, which code mode now edits directly, and showing the same text
    // in two places at once made it unclear which one was authoritative.

    // Code mode replaces the whole editing area rather than sitting beside
    // Results. Diagram and code are two views of the same model, so showing both
    // at once would mean two things claiming to be the truth.
    this.buildCodePane(root);

    this.statusEl = root.createDiv({ cls: "modelica-studio-status" });
    this.setStatus("Ready.");

    this.editor = new SchematicEditor(this.canvasHost, this.plugin.model, {
      lookup: (name) => this.plugin.library.component(name),
      onChange: (m) => this.onModelChanged(m),
      onSelectionChange: (ids) => this.onSelectionChanged(ids),
      onStatus: (text) => this.setStatus(text),
      resolveParam: (inst, name) => this.resolveInstanceParam(inst, name),
      readClipboard: () => navigator.clipboard.readText(),
      writeClipboard: (text) => navigator.clipboard.writeText(text),
      // Recorded to the debug log when it is enabled, so a press that behaves
      // unexpectedly can be traced after the fact.
      onDiagnostic: (info) => this.plugin.diag(`press ${JSON.stringify(info)}`),
    });

    // A model restored from an older schema is rebuilt from its source before
    // anything is shown, so the user never sees a model missing fields the
    // serializer needs.
    if (this.plugin.takeModelOutdated()) {
      const source = this.plugin.modelSourceText();
      if (source) await this.plugin.setModelFromSource(source);
    }
    this.loadModelIntoEditor();
    this.applyDebugOverlay();
    this.updateToolbarState();
    this.renderPalette();
    this.renderInspector();
    this.editor.scheduleFit();

    this.plugin.diag(`view open: ${(performance.now() - openStart).toFixed(0)} ms`);
    // Geometry, on the debug channel: which region is short is invisible from
    // the outside, and a wrong canvas size shows as an unexplained dark band.
    window.setTimeout(() => this.reportLayout(), 400);
    // An empty canvas is a dead end for a first-time user: nothing to
    // simulate and nothing to drag a wire between. Seed it with an example.
    // A model of only variables — `BouncingBall`, a pure equation model — is
    // genuinely without a schematic, so it is not replaced.
    const declaredVariables = this.plugin.model.variables?.length ?? 0;
    if (this.plugin.model.components.length === 0 && declaredVariables === 0) {
      this.loadExample(EXAMPLES[0].name);
    }
  }

  async onClose(): Promise<void> {
    this.editor?.destroy();
    this.editor = null;
    this.codeEditor?.destroy();
    this.codeEditor = null;
  }

  /* ---------------- toolbar ---------------- */

  private buildToolbar(bar: HTMLElement): void {
    const addBtn = (icon: string, label: string, onClick: () => void, cls = "") => {
      const b = bar.createEl("button", { cls: `modelica-studio-btn ${cls}`.trim() });
      setIcon(b, icon);
      b.createSpan({ text: label });
      b.title = label;
      b.addEventListener("click", onClick);
      return b;
    };

    // The mode switch leads the toolbar: it changes what the rest of the bar
    // acts on, so it belongs before the actions rather than among them.
    const modeGroup = bar.createDiv({ cls: "modelica-studio-modes" });
    const addMode = (id: "diagram" | "code", icon: string, label: string, hint: string) => {
      const b = modeGroup.createEl("button", { cls: "modelica-studio-btn modelica-studio-mode" });
      setIcon(b, icon);
      b.createSpan({ text: label });
      b.title = hint;
      b.addEventListener("click", () => this.setMode(id));
      this.modeButtons[id] = b;
      return b;
    };
    addMode("diagram", "shapes", "Diagram", "Build the model by dragging components");
    addMode("code", "code", "Code", "Edit the Modelica source directly, with completion and AI");
    bar.createDiv({ cls: "modelica-studio-mode-sep" });

    const examplesBtn = addBtn("library", "Examples", () => this.showExamplePicker(examplesBtn));
    addBtn("play", "Simulate", () => void this.runSimulation(), "mod-cta");

    this.btnUndo = addBtn("undo-2", "Undo", () => this.editor?.undo());
    this.btnRedo = addBtn("redo-2", "Redo", () => this.editor?.redo());

    this.btnCopy = addBtn("copy", "Copy", () => this.editor?.copy());
    this.btnPaste = addBtn("clipboard-paste", "Paste", () => void this.editor?.paste());

    addBtn("zoom-in", "Zoom in", () => this.editor?.zoomBy(1.25));
    addBtn("zoom-out", "Zoom out", () => this.editor?.zoomBy(0.8));
    addBtn("maximize", "Fit", () => this.editor?.scheduleFit());
    this.btnRotate = addBtn("rotate-cw", "Rotate", () => this.editor?.rotateSelection(90));
    this.btnDelete = addBtn("trash", "Delete", () => this.editor?.deleteSelection());
    addBtn("refresh-cw", "Rebuild", () => {
      this.plugin.invalidateBuild();
      this.setStatus("Build cache cleared; the next simulation will recompile.");
    });
    addBtn("save", "Save model", () => void this.saveToNote());
    // Diagnostic: report the exact geometry the editor is using. Shown only
    // when the debug overlay is enabled in settings.
    this.geometryBtn = addBtn("ruler", "Geometry", () => this.showGeometry());
    this.applyDebugOverlay();
  }

  /* ---------------- code mode ---------------- */

  /**
   * The code pane.
   *
   * Built once and hidden until needed: creating the editor lazily would make
   * the first switch stutter, and the pane is cheap when it is empty.
   */
  private buildCodePane(root: HTMLElement): void {
    const host = root.createDiv({ cls: "modelica-studio-code" });
    host.style.display = "none";
    this.codeHost = host;

    // Its own toolbar: the diagram's zoom, rotate and delete buttons mean
    // nothing here, and leaving them visible would be a lie about what they do.
    const bar = host.createDiv({ cls: "modelica-studio-code-bar" });
    this.codeToolbar = bar;

    const mk = (icon: string, label: string, hint: string, onClick: () => void) => {
      const b = bar.createEl("button", { cls: "modelica-studio-btn" });
      setIcon(b, icon);
      b.createSpan({ text: label });
      b.title = hint;
      b.addEventListener("click", onClick);
      return b;
    };

    mk("play", "Simulate", "Compile and run the source in the editor (Ctrl+Enter)", () => void this.runSimulation());
    mk("git-compare", "Apply to diagram", "Re-parse the source and rebuild the schematic", () =>
      this.applyCodeToDiagram(true)
    );
    mk("sparkles", "AI", "Describe what you want, or ask for a repair", () => this.toggleAiRow());

    const diagEl = bar.createDiv({ cls: "modelica-studio-code-diag" });
    this.codeDiagEl = diagEl;

    // The AI request row, hidden until asked for.
    const aiRow = host.createDiv({ cls: "modelica-studio-ai" });
    aiRow.style.display = "none";
    this.aiRow = aiRow;

    const input = aiRow.createEl("input", {
      cls: "modelica-studio-ai-input",
      attr: {
        type: "text",
        placeholder: "e.g. a tank draining through an orifice, 2 m of water",
      },
    });
    this.aiInput = input;
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        void this.runAiRequest();
      }
      if (ev.key === "Escape") this.toggleAiRow(false);
    });

    const go = aiRow.createEl("button", { cls: "modelica-studio-btn mod-cta" });
    setIcon(go, "send");
    go.createSpan({ text: "Generate" });
    go.addEventListener("click", () => void this.runAiRequest());
    this.aiGoBtn = go;

    const fix = aiRow.createEl("button", { cls: "modelica-studio-btn" });
    setIcon(fix, "wrench");
    fix.createSpan({ text: "Fix errors" });
    fix.title = "Ask the model to repair the current source using the compiler messages";
    fix.addEventListener("click", () => void this.runAiRequest(true));
    this.aiFixBtn = fix;

    aiRow.createDiv({
      cls: "modelica-studio-ai-note",
      text: "Generated code is unverified. Simulate it before trusting it.",
    });

    this.codeStatusEl = bar.createDiv({ cls: "modelica-studio-code-status" });
  }

  private codeDiagEl: HTMLElement | null = null;
  private codeStatusEl: HTMLElement | null = null;
  private aiInput: HTMLInputElement | null = null;
  private aiGoBtn: HTMLButtonElement | null = null;
  private aiFixBtn: HTMLButtonElement | null = null;
  private aiBusy = false;

  /** Switch between the diagram and the source, keeping the model in step. */
  private setMode(mode: "diagram" | "code"): void {
    if (mode === this.mode) return;

    if (mode === "code") {
      // Carry the diagram's current state into the editor before showing it, so
      // switching never loses an edit.
      this.syncDiagramToCode();
    } else {
      // Leaving code mode: what is in the editor becomes the model.
      this.applyCodeToDiagram(false);
    }

    this.mode = mode;
    const isCode = mode === "code";
    if (this.bodyEl) this.bodyEl.style.display = isCode ? "none" : "";
    if (this.codeHost) this.codeHost.style.display = isCode ? "" : "none";
    for (const [id, b] of Object.entries(this.modeButtons)) {
      b.toggleClass("is-active", id === mode);
    }
    // The diagram-only actions belong to the diagram.
    this.setDiagramActionsEnabled(!isCode);
    if (isCode) {
      this.codeEditor?.focus();
      this.validateCode();
    } else {
      this.editor?.requestDraw();
    }
    this.setStatus(isCode ? "Code mode. Ctrl+Space completes, Ctrl+Enter simulates." : "Diagram mode.");
  }

  /**
   * Hide the actions that only make sense on the diagram.
   *
   * Rather than tracking each button, everything in the toolbar after the mode
   * group is diagram-specific, which is exactly why the switch sits first.
   */
  private setDiagramActionsEnabled(enabled: boolean): void {
    const bar = this.modeButtons["diagram"]?.parentElement?.parentElement;
    if (!bar) return;
    let seenSep = false;
    for (const child of Array.from(bar.children) as HTMLElement[]) {
      if (child.classList.contains("modelica-studio-mode-sep")) {
        seenSep = true;
        continue;
      }
      if (!seenSep) continue;
      child.style.display = enabled ? "" : "none";
    }
  }

  /** Serialize the diagram into the editor. */
  private syncDiagramToCode(): void {
    let text: string;
    try {
      text = serializeDiagram(this.plugin.model);
    } catch (err) {
      text = `// The diagram could not be serialized:\n// ${String(err)}\n`;
    }
    if (!this.codeEditor) {
      this.codeEditor = createCodeEditor(this.codeHost, text, {
        library: () => this.plugin.library,
        onChange: () => this.validateCode(),
        onSubmit: () => void this.runSimulation(),
        onStatus: (t) => this.setStatus(t),
        probe: (info) =>
          this.plugin.diag("code layers: " + Object.entries(info).map(([k, v]) => `${k}=${v}`).join(" ")),
      });
    } else if (this.codeEditor.getValue() !== text) {
      this.codeEditor.setValue(text);
    }
  }

  /**
   * Parse the editor's text into the model.
   *
   * `announce` separates the two callers: switching modes should say so, while
   * a background change should stay quiet unless it failed.
   */
  private applyCodeToDiagram(announce: boolean): void {
    if (!this.codeEditor) return;
    const text = this.codeEditor.getValue();
    try {
      const model = this.plugin.parseSource(text);
      if (!model) {
        this.reportCodeProblem("The source declares no model class.", []);
        return;
      }
      this.plugin.adoptModel(model, text);
      this.clearCodeProblem();
      this.editor?.setModel(model);
      this.editor?.scheduleFit();
        if (announce) this.setStatus(`Diagram rebuilt from source (${model.components.length} components).`);
    } catch (err) {
      this.reportCodeProblem(String(err), []);
    }
  }

  /** Parse and report, without touching the diagram. */
  private validateCode(): void {
    if (!this.codeEditor) return;
    const text = this.codeEditor.getValue();
    try {
      const model = this.plugin.parseSource(text);
      if (!model) {
        this.reportCodeProblem("The source declares no model class.", []);
        return;
      }
      // Adopt silently so Simulate works without a mode switch, but leave the
      // diagram alone until the user asks for it.
      this.plugin.adoptModel(model, text);
      this.clearCodeProblem();
    } catch (err) {
      // A parse failure is reported against the first line if the message names
      // one, and against the top otherwise: the parser does not promise a
      // position, and a wrong mark is worse than a general one.
      const line = lineOfParseError(String(err), text);
      this.reportCodeProblem(String(err), line ? [{ line, message: String(err), severity: "error" }] : []);
    }
  }

  /** Show compiler output beside the code, where it is needed. */
  private setCodeStatus(text: string, bad = false): void {
    if (!this.codeStatusEl) return;
    this.codeStatusEl.setText(text);
    this.codeStatusEl.toggleClass("is-bad", bad && text.length > 0);
  }

  private reportCodeProblem(message: string, diags: Diagnostic[]): void {
    this.codeEditor?.setDiagnostics(diags);
    if (this.codeDiagEl) {
      this.codeDiagEl.setText(message);
      this.codeDiagEl.addClass("is-bad");
    }
  }

  private clearCodeProblem(): void {
    this.codeEditor?.setDiagnostics([]);
    if (this.codeDiagEl) {
      this.codeDiagEl.setText("");
      this.codeDiagEl.removeClass("is-bad");
    }
  }

  /* ---------------- AI ---------------- */

  private toggleAiRow(force?: boolean): void {
    if (!this.aiRow) return;
    const show = force ?? this.aiRow.style.display === "none";
    this.aiRow.style.display = show ? "" : "none";
    if (show) this.aiInput?.focus();
  }

  /**
   * Ask the configured model to write or repair the source.
   *
   * The request carries the current source and any compiler output, because a
   * model asked to fix code it cannot see is guessing.
   */
  private async runAiRequest(repair = false): Promise<void> {
    if (this.aiBusy) return;
    const cfg = this.plugin.settings.ai;
    if (!this.plugin.aiKey()) {
      this.setStatus(
        "No AI key available. Choose or create a secret in the plugin settings under AI assistance."
      );
      return;
    }

    const prompt = repair
      ? "The model below does not compile. Fix it, keeping what it is trying to do."
      : this.aiInput?.value.trim() ?? "";
    if (!prompt) {
      this.setStatus("Describe the model you want first.");
      return;
    }

    this.aiBusy = true;
    this.aiGoBtn?.setAttribute("disabled", "true");
    this.aiFixBtn?.setAttribute("disabled", "true");
    this.setStatus(`Asking ${cfg.model}…`);

    try {
      const messages = buildMessages({
        prompt,
        current: this.codeEditor?.getValue(),
        diagnostics: repair ? this.lastSimulationError ?? this.codeDiagEl?.getText() ?? "" : "",
        library: this.plugin.library,
        systemPrompt: cfg.systemPrompt,
      });
      const reply = await chat(cfg, messages, () => this.plugin.aiKey());
      const source = extractModelica(reply);
      if (!source) {
        this.setStatus("The model replied without any Modelica source. Nothing was changed.");
        return;
      }
      const name = modelNameOf(source);
      this.codeEditor?.setValue(source);
      this.applyCodeToDiagram(false);
      this.setStatus(
        `AI wrote ${name ? `"${name}"` : "a model"} (${source.split("\n").length} lines). Simulate it to check it works.`
      );
      if (!repair && this.aiInput) this.aiInput.value = "";
    } catch (err) {
      const msg = err instanceof AiError ? err.message : String(err);
      this.setStatus(`AI request failed. ${msg}`);
    } finally {
      this.aiBusy = false;
      this.aiGoBtn?.removeAttribute("disabled");
      this.aiFixBtn?.removeAttribute("disabled");
    }
  }

  /** Compiler output from the last failed simulation, used to repair source. */
  private lastSimulationError: string | null = null;

  /* ---------------- palette ---------------- */

  /**
   * Render the component palette as a package tree.
   *
   * Mirrors how OMEdit presents a library: packages expand to reveal
   * sub-packages and components, rather than one flat list per top-level
   * package. That matters because MSL nests most of its components inside
   * package files — `Step` lives in `Blocks/Sources.mo` — so the nesting is the
   * only thing that makes a large library navigable.
   *
   * Children are built on first expansion. Building all of `Modelica.Electrical`
   * up front is 551 nodes, and the user is looking at one branch of it.
   */
  private renderPalette(): void {
    if (!this.paletteEl) return;
    const started = performance.now();
    let shown = 0;
    this.paletteEl.empty();

    const filter = this.filterText.trim().toLowerCase();

    // A search spans the whole library rather than the visible branch, so a
    // component is always reachable however deep it sits.
    if (filter) {
      const hits = this.plugin.library.listPlaceable(filter, SEARCH_LIMIT);
      const group = this.paletteEl.createDiv({ cls: "modelica-studio-palette-group" });
      group.createDiv({
        cls: "modelica-studio-palette-group-head",
        text: hits.length ? `Matches (${hits.length})` : "No matches",
      });
      const list = group.createDiv({ cls: "modelica-studio-palette-group-list" });
      for (const item of hits) {
        this.addPaletteItem(item, list);
        shown++;
      }
      if (shown === 0) {
        this.paletteEl.createDiv({
          cls: "modelica-studio-empty",
          text: this.plugin.hasLibrary
            ? `Nothing matches "${this.filterText.trim()}".`
            : "Indexing the Modelica libraries…",
        });
      }
      this.plugin.diag(
        `palette: search "${filter}" -> ${shown} in ${(performance.now() - started).toFixed(0)} ms`
      );
      return;
    }

    const roots = this.plugin.settings.paletteRoots.length
      ? this.plugin.settings.paletteRoots
      : this.plugin.library.packages();

    if (roots.length === 0) {
      this.paletteEl.createDiv({
        cls: "modelica-studio-empty",
        text: this.plugin.hasLibrary
          ? "No Modelica libraries indexed. Check the library paths in settings."
          : "Indexing the Modelica libraries…",
      });
      return;
    }

    for (const root of roots) {
      const tree = this.plugin.library.packageTree(root);
      if (tree.children.length === 0 && !tree.placeable) continue;
      // Collapsed to begin with. Each package now lists everything it contains,
      // and building all of them up front described every class in the library —
      // over a second of work before the palette could be drawn.
      const group = this.paletteEl.createDiv({
        cls: "modelica-studio-palette-group is-collapsed",
      });
      const head = group.createDiv({ cls: "modelica-studio-palette-group-head" });
      head.setText(shortPackage(root));
      const list = group.createDiv({ cls: "modelica-studio-palette-group-list" });
      let built = false;
      head.addEventListener("click", () => {
        const collapsed = !group.hasClass("is-collapsed");
        group.toggleClass("is-collapsed", collapsed);
        if (collapsed) return;
        if (!built) {
          built = true;
          this.addPaletteContents(list, tree);
        }
      });
    }

    this.plugin.diag(
      `palette: ${roots.length} packages in ${(performance.now() - started).toFixed(0)} ms`
    );
  }

  /**
   * Add one tree node: a draggable component, or a collapsible sub-package.
   */
  /**
   * Add a package's components, one level deep.
   *
   * Expanding `Modelica.Fluid` lists everything it contains — components and the
   * contents of its sub-packages — as one flat alphabetical list. MSL nests
   * components several levels down (`Fluid.Sources` holds `Boundary_pT`), and
   * mirroring that nesting meant expanding branch after branch to reach a part;
   * one level per `Modelica.[x]` reaches everything in a single click.
   */
  private addPaletteContents(list: HTMLElement, node: PackageNode): void {
    const found = new Map<string, ComponentClass>();
    const walk = (n: PackageNode): void => {
      if (n.placeable && !found.has(n.full)) {
        const def = this.plugin.library.component(n.full);
        if (def) found.set(n.full, def);
      }
      for (const child of n.children) walk(child);
    };
    walk(node);

    // Sorted as one list, so the order reflects the names rather than the
    // package they happen to live in.
    const items = [...found.values()].sort((a, b) => a.shortName.localeCompare(b.shortName));
    for (const def of items) this.addPaletteItem(def, list);
  }

  /** One draggable palette entry, with its icon drawn as a thumbnail. */
  private addPaletteItem(item: ComponentClass, list: HTMLElement = this.paletteEl!): void {
    const btn = list.createDiv({ cls: "modelica-studio-palette-item" });
    btn.draggable = true;
    btn.setAttr("title", `${item.name}\n${item.comment ?? ""}`.trim());

    const thumb = btn.createEl("canvas", { cls: "modelica-studio-palette-thumb" });
    thumb.width = THUMB_SIZE;
    thumb.height = THUMB_SIZE;
    this.drawThumbnail(thumb, item);

    btn.createSpan({ cls: "modelica-studio-palette-label", text: item.shortName });

    btn.addEventListener("dragstart", (ev) => {
      ev.dataTransfer?.setData("text/modelica-class", item.name);
      ev.dataTransfer?.setData("text/plain", item.name);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "copy";
    });
    // Double-click places at the centre of the view, a quick alternative to
    // dragging when the palette is long.
    btn.addEventListener("dblclick", () => {
      const ed = this.editor;
      if (!ed) return;
      const cx = (ed.canvasRect.width / 2 - ed.viewport.x) / ed.viewport.scale;
      const cy = (ed.canvasRect.height / 2 - ed.viewport.y) / ed.viewport.scale;
      ed.addComponent(item.name, cx, cy);
    });
  }


  /** Render a component's icon into a small palette thumbnail. */
  private drawThumbnail(canvas: HTMLCanvasElement, item: ComponentClass): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);
    if (item.icon.length === 0) {
      ctx.fillStyle = "rgba(150,160,180,0.5)";
      ctx.fillRect(8, 8, size - 16, size - 16);
      return;
    }
    // Render the canonical -100..100 icon box into the thumbnail.
    const pad = 4;
    const scale = (size - pad * 2) / 200;
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.scale(scale, scale);
    const t = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const theme = currentTheme();
    // The weight is stated in the scaled space the context now uses, so it must
    // be at least one SCREEN pixel: a lineWidth of 1 is 0.24px here, which is
    // why icons drawn only with `Line` — Modelica.StateGraph.Alternative among
    // them — rendered as nothing at all.
    const strokePx = Math.max(1, 1 / scale);
    for (const g of item.icon) {
      try {
        drawGraphic(ctx, g, t, 1, theme, strokePx);
      } catch {
        /* a single bad primitive must not break the palette */
      }
    }
    ctx.restore();
  }

  /* ---------------- drag & drop onto canvas ---------------- */

  installDropTarget(): void {
    const host = this.canvasHost;
    if (!host || host.dataset.dropBound === "1") return;
    host.dataset.dropBound = "1";

    host.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
    });
    host.addEventListener("drop", (ev) => {
      ev.preventDefault();
      const className =
        ev.dataTransfer?.getData("text/modelica-class") ||
        ev.dataTransfer?.getData("text/plain");
      if (!className || !this.editor) return;
      const rect = host.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;
      const vp = this.editor.viewport;
      const dx = (px - vp.x) / vp.scale;
      const dy = (py - vp.y) / vp.scale;
      const inst = this.editor.addComponent(className, dx, dy);
      if (inst) this.setStatus(`Added ${inst.id}.`);
    });
  }

  /* ---------------- inspector ---------------- */

  /**
   * Rebuild the inspector: a tab strip and the body of the active tab.
   *
   * Tabs rather than one long scroll. The panel was doing three unrelated jobs —
   * what is selected, what it is set to, and what the run produced — and they
   * pushed each other off the bottom of a 380px column.
   */
  private renderInspector(): void {
    const el = this.inspectorEl;
    if (!el) return;
    const tabs = this.inspectorTabsEl;
    const selected = this.editor?.selectedIds ?? [];
    const inst =
      selected.length === 1
        ? this.plugin.model.components.find((c) => c.id === selected[0])
        : undefined;


    if (tabs) {
      tabs.empty();
      for (const [id, label] of [
        ["component", "Component"],
        ["results", "Results"],
      ] as const) {
        const b = tabs.createEl("button", {
          cls: `modelica-studio-tab${this.inspectorTab === id ? " is-active" : ""}`,
          text: label,
        });
        b.addEventListener("click", () => {
          this.inspectorTab = id;
          this.renderInspector();
        });
      }
    }

    el.empty();
    if (this.inspectorTab === "results") {
      this.renderResultSummary(el);
    } else {
      this.renderComponentTab(el, inst, selected);
    }
    this.renderPlotPane();
  }

  /** The Component tab: what is selected, its connectors, and its values. */
  private renderComponentTab(
    parent: HTMLElement,
    inst: ComponentInstance | undefined,
    selected: string[]
  ): void {
    if (selected.length === 0) {
      parent.createDiv({
        cls: "modelica-studio-empty",
        text: "Select a component to edit it, or drag one in from the palette.",
      });
      return;
    }
    if (selected.length > 1 || !inst) {
      parent.createDiv({
        cls: "modelica-studio-empty",
        text: `${selected.length} components selected.`,
      });
      return;
    }
    this.renderComponentInspector(parent, inst);
  }

  private renderComponentInspector(parent: HTMLElement, inst: ComponentInstance): void {
    const def = this.plugin.library.component(inst.className);

    const head = parent.createDiv({ cls: "modelica-studio-inspector-head" });
    head.createEl("strong", { text: inst.id });
    head.createDiv({ cls: "modelica-studio-muted", text: inst.className });

    const nameRow = parent.createDiv({ cls: "modelica-studio-field" });
    nameRow.createEl("label", { text: "Instance name" });
    const nameInput = nameRow.createEl("input", { type: "text", value: inst.id });
    nameInput.addEventListener("change", () => this.renameInstance(inst.id, nameInput.value.trim()));

    if (!def) {
      parent.createDiv({ cls: "modelica-studio-muted", text: "Class definition not found in the library index." });
      return;
    }

    if (def.ports.length) {
      parent.createDiv({ cls: "modelica-studio-section", text: "Connectors" });
      const list = parent.createDiv({ cls: "modelica-studio-portlist" });
      for (const p of def.ports) {
        const row = list.createDiv({ cls: "modelica-studio-portrow" });
        row.createSpan({ cls: "modelica-studio-portname", text: p.name });
        row.createSpan({
          cls: "modelica-studio-muted",
          text: `${p.causality === "acausal" ? shortType(p.type) : p.causality}${p.isFlow ? " · flow" : ""}`,
        });
      }
    }

    this.renderParameterFields(parent, inst, def);
  }

  /**
   * Parameters and initial values, as fields.
   *
   * Separate sections because they are set differently: a parameter changes
   * with `-override` and no rebuild, an initial value rewrites the model and
   * recompiles.
   */
  private renderParameterFields(
    parent: HTMLElement,
    inst: ComponentInstance,
    def: ComponentClass
  ): void {
    const params = def.parameters.filter((p) => !p.isStart);
    const starts = def.parameters.filter((p) => p.isStart);

    parent.createDiv({ cls: "modelica-studio-section", text: "Parameters" });
    if (params.length === 0) {
      parent.createDiv({ cls: "modelica-studio-muted", text: "This component has no parameters." });
    }
    for (const p of params) this.renderParamField(parent, inst, p);

    if (starts.length > 0) {
      parent.createDiv({ cls: "modelica-studio-section", text: "Initial values" });
      parent.createDiv({
        cls: "modelica-studio-muted",
        text: "Starting conditions. Changing one rebuilds the model.",
      });
      for (const p of starts) this.renderParamField(parent, inst, p);
    }
  }

  /** Show the bottom pane's active tab. */
  private applyBottomTab(): void {
    const showPlot = this.bottomTab === "plot" && this.result !== null;
    if (this.plotHost) this.plotHost.style.display = showPlot ? "" : "none";
    if (this.emptyEl) this.emptyEl.style.display = this.result ? "none" : "";
    // The plot's actions and scale controls belong to the plot, not the source.
    if (this.bottomActionsEl) {
      this.bottomActionsEl.style.display = showPlot ? "" : "none";
    }
    if (this.inlineScale) {
      this.inlineScale.style.display =
        showPlot && this.inlineScale.childElementCount > 0 ? "" : "none";
    }
    // In code mode the source is already on screen, so the tab that reveals it
    // is removed rather than left as a no-op.
    if (this.bottomTabEls?.source) {
      this.bottomTabEls.source.style.display = this.mode === "code" ? "none" : "";
    }
    for (const [id, b] of Object.entries(this.bottomTabEls ?? {})) {
      b.toggleClass("is-active", id === this.bottomTab);
    }
    if (showPlot) this.drawResults();
  }

  /** One labelled value field, for a parameter or an initial value. */
  private renderParamField(
    parent: HTMLElement,
    inst: ComponentInstance,
    p: ParameterDef
  ): void {
    const row = parent.createDiv({ cls: "modelica-studio-field" });
    // `T.start` reads better as "T (initial)".
    const label = p.isStart
      ? `${p.name.replace(/\.start$/, "")} (initial)`
      : p.name + (p.unit ? ` (${p.unit})` : "");
    const el = row.createEl("label", { text: label });
    if (p.comment) el.setAttr("title", p.comment);
    const input = row.createEl("input", {
      type: "text",
      value: inst.params[p.name] ?? p.defaultValue ?? "",
    });
    if (p.defaultValue !== undefined) input.placeholder = `default ${p.defaultValue}`;
    // Commit on change/Enter rather than every keystroke: an edit triggers a
    // re-simulation, which must not fire per character.
    input.addEventListener("change", () => {
      this.editor?.setParam(inst.id, p.name, input.value.trim());
      void this.runSimulation({ silent: true });
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") input.blur();
    });
  }

  /**
   * Rename through the editor, so the change lands in the undo history and
   * connection references are rewritten in one place.
   */
  private renameInstance(oldId: string, newId: string): void {
    if (!newId || newId === oldId) return;
    const res = this.editor?.renameInstance(oldId, newId);
    if (res && !res.ok) {
      new Notice(res.error ?? "Could not rename the component.");
      this.renderInspector();
      return;
    }
    this.onModelChanged(this.plugin.model);
  }


  /* ---------------- results ---------------- */

  /**
   * The inspector's result summary and trace toggles.
   *
   * The PLOT itself lives in the results pane, which spans the window; these
   * toggles drive it. Named apart from `renderResults` so the two are not
   * confused: this one fills the inspector, that one fills the pane.
   */
  /**
   * The Results tab: what ran, what went wrong, and which traces are shown.
   *
   * Warnings are folded away and the variable list is filtered, because a real
   * model reports dozens of each. OpenModelica emits one "not possible to
   * override" note per parameter it ignored, and a fluid model exposes fifty
   * variables — listing both outright buried the two traces the user came for.
   */
  private renderResultSummary(parent: HTMLElement): void {
    parent.createDiv({ cls: "modelica-studio-section", text: "Results" });

    if (!this.result) {
      parent.createDiv({ cls: "modelica-studio-empty", text: "Run a simulation to see traces." });
      return;
    }

    const meta = parent.createDiv({ cls: "modelica-studio-muted" });
    meta.setText(
      `${summarize(this.result)} · compile ${this.result.compileMs} ms · ` +
        `simulate ${this.result.simulateMs} ms`
    );

    if (this.result.warnings.length > 0) {
      const box = parent.createEl("details", { cls: "modelica-studio-warnings" });
      box.createEl("summary", {
        text: `${this.result.warnings.length} warning${this.result.warnings.length === 1 ? "" : "s"}`,
      });
      for (const w of this.result.warnings) {
        box.createDiv({ cls: "modelica-studio-warning", text: w });
      }
    }

    // Traces that are drawn come first, so the selected few are never pushed
    // out of sight by the many.
    const selected = this.result.series.filter((s) => this.seriesStyles[s.name]?.visible);
    const rest = this.result.series.filter((s) => !this.seriesStyles[s.name]?.visible);

    const head = parent.createDiv({ cls: "modelica-studio-series-head" });
    head.createSpan({ text: `Traces (${selected.length} of ${this.result.series.length})` });
    const all = head.createEl("button", { cls: "modelica-studio-btn", text: "Clear" });
    all.addEventListener("click", () => {
      for (const s of this.result!.series) {
        (this.seriesStyles[s.name] ??= {
          color: seriesColor(this.result!.series.indexOf(s), currentTheme().dark),
          visible: false,
        }).visible = false;
      }
      this.renderInspector();
      this.drawResults();
    });

    const filter = parent.createEl("input", {
      cls: "modelica-studio-search",
      attr: { type: "text", placeholder: "Filter variables…", value: this.seriesFilter },
    });
    // Re-render on input, then put the caret back where it was: the list has to
    // be rebuilt, which would otherwise drop focus on every keystroke.
    filter.addEventListener("input", () => {
      this.seriesFilter = filter.value;
      const caret = filter.selectionStart ?? filter.value.length;
      this.renderInspector();
      const next = this.inspectorEl?.querySelector<HTMLInputElement>(
        'input[placeholder="Filter variables…"]'
      );
      if (next) {
        next.focus();
        next.setSelectionRange(caret, caret);
      }
    });

    const list = parent.createDiv({ cls: "modelica-studio-series" });
    const needle = this.seriesFilter.trim().toLowerCase();
    const matching = (s: SimSeries) => !needle || s.name.toLowerCase().includes(needle);
    const ordered = [...selected.filter(matching), ...rest.filter(matching)];
    for (const s of ordered.slice(0, SERIES_PAGE)) this.renderSeriesRow(list, s);
    if (ordered.length > SERIES_PAGE) {
      list.createDiv({
        cls: "modelica-studio-muted",
        text: `…${ordered.length - SERIES_PAGE} more — narrow with the filter`,
      });
    }
    if (ordered.length === 0) {
      list.createDiv({ cls: "modelica-studio-muted", text: "No variable matches that filter." });
    }
  }

  /** One trace toggle, with its colour and current value range. */
  private renderSeriesRow(list: HTMLElement, s: SimSeries): void {
    const style = (this.seriesStyles[s.name] ??= {
      color: seriesColor(this.result!.series.indexOf(s), currentTheme().dark),
      visible: false,
    });
    const row = list.createDiv({
      cls: `modelica-studio-series-row${style.visible ? " is-shown" : ""}`,
    });
    const cb = row.createEl("input", { type: "checkbox" });
    cb.checked = style.visible;
    cb.addEventListener("change", () => {
      style.visible = cb.checked;
      this.renderInspector();
      this.drawResults();
      this.drawFullScreen();
      this.publishChart();
    });
    const swatch = row.createSpan({ cls: "modelica-studio-swatch" });
    swatch.style.background = style.color;
    swatch.toggleClass("is-off", !style.visible);
    row.createSpan({ cls: "modelica-studio-series-name", text: s.name });
  }

  /**
   * Build the results pane: a header, a reset, and the plot.
   *
   * Rebuilt whenever the result changes. It lives here rather than inside the
   * inspector so the plot can span the window: in a 380px column the legend
   * covers half the traces and the curves are unreadable.
   */
  /**
   * Build the bottom pane: a tab strip, the plot, and the source.
   *
   * Runs when the result changes. Clicking a tab must NOT rebuild any of this —
   * the plot canvas and the source element are long-lived, and recreating them
   * on every click loses the trace styles and the scroll position while making
   * the tab handler re-enter this method.
   */
  private renderPlotPane(): void {
    const el = this.resultsEl;
    if (!el) return;

    // The header and the canvas are built once; only their contents change.
    if (!this.bottomBarEl) {
      const bar = el.createDiv({ cls: "modelica-studio-plotbar" });
      const tabs = bar.createDiv({ cls: "modelica-studio-tabs" });
      this.bottomTabEls = {};
      for (const [id, label] of [
        ["plot", "Plot"],
        ["source", "Source"],
      ] as const) {
        const b = tabs.createEl("button", { cls: "modelica-studio-tab", text: label });
        b.addEventListener("click", () => {
          if (id === "source") {
            // Code mode is the source, so the tab switches to it rather than
            // showing a second read-only copy of the same text.
            this.setMode("code");
            return;
          }
          this.bottomTab = id;
          this.applyBottomTab();
        });
        this.bottomTabEls[id] = b;
      }
      this.bottomActionsEl = bar.createDiv({ cls: "modelica-studio-plotbar-actions" });
      this.bottomBarEl = bar;

      const host = el.createDiv({ cls: "modelica-studio-plot" });
      this.plotHost = host;
      this.plotCanvas = host.createEl("canvas");
      this.bindPlotEvents(this.plotCanvas, () => this.drawResults());
    }

    const actions = this.bottomActionsEl;
    if (actions) {
      actions.empty();
      // Simulation time lives here rather than in the settings tab: it is part
      // of asking the question, not of configuring the plugin, and changing it
      // means running again — which is what this row is for.
      const time = actions.createDiv({ cls: "modelica-studio-time" });
      time.createSpan({ cls: "modelica-studio-muted", text: "t_end" });
      const endInput = time.createEl("input", {
        type: "number",
        cls: "modelica-studio-time-input",
        attr: { step: "any", min: "0" },
      });
      endInput.value = String(this.plugin.stopTime());
      const apply = () => {
        const v = Number(endInput.value);
        if (!Number.isFinite(v) || v <= 0) {
          endInput.value = String(this.plugin.stopTime());
          return;
        }
        // Recorded against THIS model, so it neither reverts on reload nor
        // leaks into every other model's blocks.
        this.plugin.setStopTime(v);
        void this.runSimulation({ silent: true });
      };
      endInput.addEventListener("change", apply);
      endInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          apply();
        }
      });
      time.createSpan({ cls: "modelica-studio-muted", text: "s" });

      if (this.result) {
        actions
          .createEl("button", { cls: "modelica-studio-btn", text: "Scale" })
          .addEventListener("click", () => this.toggleScalePanel());
        actions
          .createEl("button", { cls: "modelica-studio-btn", text: "Full screen" })
          .addEventListener("click", () => this.openFullScreen());
        actions
          .createEl("button", { cls: "modelica-studio-btn", text: "Auto scale" })
          .addEventListener("click", () => this.autoScale());
      }
    }
    if (this.emptyEl?.isConnected) this.emptyEl.remove();
    this.emptyEl =
      !this.result
        ? el.createDiv({
            cls: "modelica-studio-empty",
            text: "Run a simulation to see traces, or open the Source tab to read the model.",
          })
        : null;

    this.applyBottomTab();
    // Freshly laid out, so draw on the next frame and again once it settles.
    requestAnimationFrame(() => this.drawResults());
    window.setTimeout(() => this.drawResults(), 120);
  }
  /**
   * Drag the divider above the bottom pane to change its height.
   *
   * The pane is one region holding both tabs, so resizing it resizes whichever
   * is showing — the plot canvas and the source both fill it.
   */
  private installResultsResize(handle: HTMLElement, pane: HTMLElement): void {
    let startY = 0;
    let startH = 0;
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(MIN_RESULTS_H, startH - (ev.clientY - startY));
      pane.style.height = `${next}px`;
      if (this.bottomTab === "plot") this.drawResults();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      handle.removeClass("is-dragging");
      this.plugin.settings.plotHeight = Math.round(pane.getBoundingClientRect().height);
      void this.plugin.saveSettings();
    };
    handle.addEventListener("pointerdown", (ev) => {
      startY = ev.clientY;
      startH = pane.getBoundingClientRect().height;
      handle.addClass("is-dragging");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      ev.preventDefault();
    });
  }

  /**
   * Show the plot over the whole window.
   *
   * A separate canvas, so the inline plot and its layout are untouched and
   * closing the overlay needs no re-layout. It carries its own trace list,
   * because choosing what to look at is the reason for opening it.
   */
  private openFullScreen(): void {
    if (!this.result || this.fullHost) return;
    const overlay = this.contentEl.createDiv({ cls: "modelica-studio-fullplot" });
    const bar = overlay.createDiv({ cls: "modelica-studio-plotbar" });
    bar.createSpan({ text: "Trace plot" });
    bar
      .createEl("button", { cls: "modelica-studio-btn", text: "Auto scale" })
      .addEventListener("click", () => this.autoScale());
    const scaleBtn = bar.createEl("button", { cls: "modelica-studio-btn", text: "Scale…" });
    bar
      .createEl("button", { cls: "modelica-studio-btn", text: "Close" })
      .addEventListener("click", () => this.closeFullScreen());

    this.scalePanel = overlay.createDiv({ cls: "modelica-studio-scale" });
    this.scalePanel.style.display = "none";
    scaleBtn.addEventListener("click", () => {
      const open = this.scalePanel?.style.display !== "none";
      if (this.scalePanel) this.scalePanel.style.display = open ? "none" : "";
      if (!open) this.buildScalePanel(this.scalePanel);
    });

    const row = overlay.createDiv({ cls: "modelica-studio-fullplot-body" });
    const list = row.createDiv({ cls: "modelica-studio-fullplot-traces" });
    list.createDiv({ cls: "modelica-studio-section", text: "Variables" });
    this.result.series.forEach((s) => {
      const style = (this.seriesStyles[s.name] ??= {
        color: seriesColor(this.result!.series.indexOf(s), currentTheme().dark),
        visible: false,
      });
      const item = list.createDiv({ cls: "modelica-studio-series-row" });
      const cb = item.createEl("input", { type: "checkbox" });
      cb.checked = style.visible;
      cb.addEventListener("change", () => {
        style.visible = cb.checked;
        this.drawFullScreen();
        this.drawResults();
        this.publishChart();
      });
      const swatch = item.createSpan({ cls: "modelica-studio-swatch" });
      swatch.style.background = style.color;
      item.createSpan({ text: s.name });
    });

    const host = row.createDiv({ cls: "modelica-studio-fullplot-plot" });
    this.fullHost = host;
    this.fullCanvas = host.createEl("canvas");
    this.bindPlotEvents(this.fullCanvas, () => this.drawFullScreen());
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      document.removeEventListener("keydown", onKey, true);
      this.closeFullScreen();
    };
    document.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() => this.drawFullScreen());
  }

  /**
   * Build the four axis sliders: x from, x to, y from, y to.
   *
   * Each is a slider for coarse movement plus a number box for an exact value,
   * because the range worth looking at is rarely a round number. Positions are
   * a fraction of the data's own span, so a slider keeps its meaning when the
   * result changes underneath it.
   */
  private buildScalePanel(
    panel: HTMLElement | null = this.scalePanel,
    onInput: () => void = () => {
      this.drawFullScreen();
      this.drawResults();
      this.publishChart();
    }
  ): void {
    if (!panel || !this.result) return;
    panel.empty();
    this.scaleInputs = [];

    const t = this.result.time;
    const xFull = { min: t[0], max: t[t.length - 1] };
    const drawn = this.result.series.filter((s) => this.seriesStyles[s.name]?.visible);
    const yFull = this.dataYRange(drawn.length ? drawn : this.result.series);

    // Normalised to {yMin, yMax} so the two axes share one shape below.
    const x = { yMin: this.zoom?.xMin ?? xFull.min, yMax: this.zoom?.xMax ?? xFull.max };
    const y = { yMin: this.yLimits?.yMin ?? yFull.min, yMax: this.yLimits?.yMax ?? yFull.max };

    const row = (label: string, lo: number, hi: number, get: () => number, set: (v: number) => void) => {
      const line = panel.createDiv({ cls: "modelica-studio-scale-row" });
      line.createSpan({ cls: "modelica-studio-scale-label", text: label });
      const range = line.createEl("input", { type: "range" });
      range.min = "0";
      range.max = "1";
      range.step = "0.001";
      const num = line.createEl("input", { type: "number", cls: "modelica-studio-scale-num" });
      const span = hi - lo || 1;
      const toPos = (v: number) => Math.min(1, Math.max(0, (v - lo) / span));
      const refresh = () => {
        const v = get();
        range.value = String(toPos(v));
        if (document.activeElement !== num) num.value = String(Number(v.toPrecision(6)));
      };
      range.addEventListener("input", () => {
        set(lo + Number(range.value) * span);
        refresh();
        onInput();
      });
      num.addEventListener("change", () => {
        const v = Number(num.value);
        if (Number.isFinite(v)) {
          set(v);
          refresh();
          onInput();
        }
      });
      this.scaleInputs.push(refresh);
      refresh();
    };

    const applyX = () => {
      const z = this.zoom;
      if (!z) return;
      // A dragged slider can cross the other one; keep the window non-empty.
      if (z.xMax - z.xMin < (xFull.max - xFull.min) * 1e-4) {
        z.xMax = z.xMin + (xFull.max - xFull.min) * 1e-4;
      }
    };
    // The current window, read once: the slider callbacks update it, so they
    // must not read a stale snapshot back out of `this`.
    const curX = (): { yMin: number; yMax: number } => {
      const z: { xMin: number; xMax: number } | null = this.zoom;
      return z ? { yMin: z.xMin, yMax: z.xMax } : x;
    };
    const curY = (): { yMin: number; yMax: number } => {
      const l: { yMin: number; yMax: number } | null = this.yLimits;
      return l ?? y;
    };
    row("X from", xFull.min, xFull.max, () => curX().yMin, (v) => {
      this.zoom = { xMin: v, xMax: curX().yMax };
      applyX();
    });
    row("X to", xFull.min, xFull.max, () => curX().yMax, (v) => {
      this.zoom = { xMin: curX().yMin, xMax: v };
      applyX();
    });

    const yLo = Math.min(yFull.min, y.yMin);
    const yHi = Math.max(yFull.max, y.yMax);
    row("Y from", yLo, yHi, () => curY().yMin, (v) => {
      this.yLimits = { yMin: v, yMax: curY().yMax };
    });
    row("Y to", yLo, yHi, () => curY().yMax, (v) => {
      this.yLimits = { yMin: curY().yMin, yMax: v };
    });
  }

  /**
   * Show or hide the inline scale controls.
   *
   * The panel is built on first open rather than kept in the DOM: it holds
   * several inputs and a callback each, and none of that is wanted until the
   * user asks to adjust the scale.
   */
  private toggleScalePanel(): void {
    const pane = this.resultsEl;
    if (!pane) return;
    if (!this.inlineScale) {
      // Before the plot, so it takes its space from the pane rather than being
      // appended under a canvas that already fills the pane.
      this.inlineScale = pane.createDiv({ cls: "modelica-studio-scale" });
      if (this.plotHost?.parentElement === pane) {
        pane.insertBefore(this.inlineScale, this.plotHost);
      }
      this.inlineScale.style.display = "none";
    }
    const open = this.inlineScale.style.display !== "none";
    this.inlineScale.style.display = open ? "none" : "";
    if (!open) {
      this.buildScalePanel(this.inlineScale, () => {
        this.drawResults();
        this.publishChart();
      });
    }
  }

  /** The model this view is showing, for the per-model configuration. */
  currentModelName(): string {
    return this.plugin.model.name;
  }

  /** Return both axes to limits derived from the data. */
  private autoScale(): void {
    this.zoom = null;
    this.yLimits = null;
    this.scaleInputs.forEach((set) => set());
    this.drawResults();
    this.drawFullScreen();
    this.publishChart();
  }

  /**
   * Share this plot's configuration with the inline diagrams.
   *
   * The studio is where the traces and the scale are chosen, so it is the
   * source of truth; a note's blocks follow it. Published on each change rather
   * than on every redraw, since a repaint changes nothing about the setup.
   */
  private publishChart(): void {
    if (!this.result) return;
    // Stored under this model's name, so configuring one model leaves the
    // other blocks on the page alone.
    this.plugin.settings.charts[this.plugin.model.name] = {
      traces: this.result.series
        .filter((s) => this.seriesStyles[s.name]?.visible)
        .map((s) => s.name),
      ...(this.zoom ? { xMin: this.zoom.xMin, xMax: this.zoom.xMax } : {}),
      ...(this.yLimits ? { yMin: this.yLimits.yMin, yMax: this.yLimits.yMax } : {}),
      // The parameter values travel with the traces: a block that showed the
      // right trace names but ran the studio's old values was still wrong.
      parameters: collectParameters(this.plugin.model),
    };
    this.plugin.publishChart();
  }

  /** The y-extent of the given series, for the slider bounds. */
  private dataYRange(series: SimSeries[]): { min: number; max: number } {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) {
      for (const v of s.values) {
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo)) return { min: -1, max: 1 };
    if (lo === hi) return { min: lo - 1, max: hi + 1 };
    return { min: lo, max: hi };
  }

  private closeFullScreen(): void {
    this.fullHost?.closest(".modelica-studio-fullplot")?.remove();
    this.fullHost = null;
    this.fullCanvas = null;
    this.drawResults();
  }

  private drawFullScreen(): void {
    if (this.fullCanvas && this.fullHost) this.paint(this.fullCanvas, this.fullHost);
  }

  /**
   * Size a canvas to its host and draw the plot into it.
   *
   * Shared by the inline plot and the full-screen one, so they cannot drift:
   * whichever canvas is passed gets the same scaling, theme and cursor.
   */
  private paint(canvas: HTMLCanvasElement, host: HTMLElement): void {
    if (!this.result) return;
    const view = this.zoom ?? {
      xMin: this.result.time[0],
      xMax: this.result.time[this.result.time.length - 1],
    };
    const drawn = this.result.series.filter((s) => this.seriesStyles[s.name]?.visible === true);
    if (drawn.length === 0) {
      // Nothing ticked. Drawing a grid here is actively misleading: the axis is
      // derived from whatever is left, which is a near-zero range around zero,
      // so the plot looks like a flat line at 0 and reads as a broken result
      // rather than an empty selection.
      this.paintMessage(canvas, host, "No traces selected — tick a variable in the inspector.");
      return;
    }
    // Report what is actually being drawn. A plot that disagrees with the data
    // is otherwise invisible: the axes come from whatever is visible, so a wrong
    // selection looks like a wrong simulation.
    this.plugin.diag(
      `plot: ${drawn.length}/${this.result.series.length} traces` +
        ` [${drawn.slice(0, 4).map((s) => s.name).join(", ")}]` +
        ` x=[${view.xMin}, ${view.xMax}]`
    );
    const rect = host.getBoundingClientRect();
    const w = Math.max(120, Math.floor(rect.width));
    // Fill whatever height the pane has, rather than a fixed sliver.
    const h = Math.max(160, Math.floor(rect.height || 240));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const theme = currentTheme();
    drawPlot(ctx, w, h, this.result, {
      theme: plotThemeFrom(theme),
      legendBackground: theme.plotLegendBackground,
      styles: this.seriesStyles,
      view: {
        xMin: view.xMin,
        xMax: view.xMax,
        yMin: this.yLimits?.yMin,
        yMax: this.yLimits?.yMax,
      },
      cursorX: this.cursorX,
      // The overlay has the room to list every drawn trace at the cursor, which
      // is the point of inspecting there.
      cursorRows: canvas === this.fullCanvas ? this.result.series.length : 6,
      dpr,
    });
  }

  /** Draw a short message in place of the plot. */
  private paintMessage(canvas: HTMLCanvasElement, host: HTMLElement, text: string): void {
    const rect = host.getBoundingClientRect();
    const w = Math.max(120, Math.floor(rect.width));
    const h = Math.max(160, Math.floor(rect.height || 240));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const theme = currentTheme();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t = plotThemeFrom(theme);
    ctx.fillStyle = t.background;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = t.foreground;
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2);
  }

  /**
   * Wire one plot canvas: cursor tracking, wheel zoom, double-click reset.
   *
   * `redraw` is the canvas's own repaint. It has to be passed in rather than
   * assumed: the full-screen overlay and the inline plot are separate canvases,
   * and repainting the wrong one leaves the visible plot with no cursor at all.
   */
  private bindPlotEvents(canvas: HTMLCanvasElement, redraw: () => void): void {
    canvas.addEventListener("pointermove", (ev) => {
      if (!this.result) return;
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const lay = plotLayoutFor(rect.width, rect.height, this.result);
      if (x < lay.left || x > lay.left + lay.width) {
        this.cursorX = undefined;
      } else {
        const view = this.zoom ?? {
          xMin: this.result.time[0],
          xMax: this.result.time[this.result.time.length - 1],
        };
        // Read the time off the VISIBLE window, not the whole run: after a
        // zoom the two differ and the readout would lag the crosshair.
        this.cursorX = view.xMin + ((x - lay.left) / lay.width) * (view.xMax - view.xMin);
      }
      void y;
      redraw();
    });
    canvas.addEventListener("pointerleave", () => {
      this.cursorX = undefined;
      redraw();
    });
    canvas.addEventListener("wheel", (ev) => {
      if (!this.result) return;
      // A modifier is required, because a plain wheel over the plot is almost
      // always an attempt to scroll the view or the note. Claiming it zoomed the
      // time axis instead — a trackpad flick over the plot widened the range
      // several times over, to a window starting at minus twenty seconds.
      if (!ev.ctrlKey && !ev.metaKey && !ev.altKey) return;
      ev.preventDefault();
      // Ctrl (or Cmd, or Alt) and scroll zooms the time axis about the cursor.
      const t0r = this.result.time[0];
      const t1r = this.result.time[this.result.time.length - 1];
      const z = (this.zoom ??= { xMin: t0r, xMax: t1r });
      const factor = Math.exp(-ev.deltaY * 0.0015);
      const span = (z.xMax - z.xMin) / factor;
      const t0 = t0r;
      const t1 = t1r;
      const centre = this.cursorX ?? (z.xMin + z.xMax) / 2;
      const frac = (centre - z.xMin) / Math.max(1e-12, z.xMax - z.xMin);
      z.xMin = centre - span * frac;
      z.xMax = centre + span * (1 - frac);
      clampToRange(z, t0, t1);
      // Both plots share one time window, so both are repainted.
      this.drawResults();
      this.drawFullScreen();
      this.publishChart();
    }, { passive: false });
    canvas.addEventListener("dblclick", () => {
      if (!this.result) return;
      this.resetZoom();
      this.drawResults();
      this.drawFullScreen();
    });
  }

  /**
   * Time window, or null for "the whole run".
   *
   * Null rather than a placeholder is what makes this safe: a default of
   * `{0, 1}` silently means one second, and drawing a 3000 s run through a 1 s
   * window shows a slope over 0.03% of it — a straight line, with an axis to
   * match. Resolved against the current result at draw time, so it cannot go
   * stale between a simulation finishing and the plot being painted.
   */
  private zoom: { xMin: number; xMax: number } | null = null;
  /**
   * Fixed y-limits, or null to derive them from what is drawn.
   *
   * Held separately from `zoom` because the two axes are controlled
   * independently: pinning the vertical scale is how one compares two runs,
   * while the horizontal is about which part of the run to look at.
   */
  private yLimits: { yMin: number; yMax: number } | null = null;

  /**
   * Choose which traces are drawn, and hide the rest.
   *
   * Everything not named is marked hidden, so the plot shows exactly the
   * intended set; all variables stay listed in the inspector, where each can be
   * switched on.
   *
   * A choice the user made for the SAME result is preserved. Choices from an
   * earlier result are not: an older version of this method seeded only the
   * chosen traces and left the rest drawn, so stale entries marked every
   * variable visible. Reusing them kept the plot wrong no matter how the
   * seeding was fixed — the fix must be able to take effect on the next run.
   */
  private seedVisible(names: string[], signature: string): void {
    if (!this.result) return;
    if (this.seriesSignature !== signature) {
      this.seriesStyles = {};
      this.seriesSignature = signature;
    }
    const wanted = new Set(names);
    this.result.series.forEach((s, i) => {
      this.seriesStyles[s.name] ??= {
        color: seriesColor(i, currentTheme().dark),
        visible: wanted.has(s.name),
      };
    });
  }

  private resetZoom(): void {
    this.zoom = null;
  }

  /** Draw the inline plot into its pane. */
  private drawResults(): void {
    if (this.plotCanvas && this.plotHost) this.paint(this.plotCanvas, this.plotHost);
  }

  /* ---------------- model plumbing ---------------- */

  private onModelChanged(_m: DiagramModel): void {
    this.renderInspector();
    this.updateToolbarState();
    void this.plugin.persist();
  }

  /**
   * Reflect editor state in the toolbar and inspector.
   *
   * Called on every selection change as well as every model change, so the
   * buttons and the parameter panel always describe what is actually selected.
   */
  private onSelectionChanged(_ids: string[]): void {
    this.renderInspector();
    this.updateToolbarState();
  }

  /** Enable or disable toolbar actions for the current selection. */
  private updateToolbarState(): void {
    const sel = this.editor?.selectedIds ?? [];
    const has = sel.length > 0;
    const single = sel.length === 1;
    const set = (btn: HTMLButtonElement | undefined, enabled: boolean) => {
      if (!btn) return;
      btn.toggleClass("is-disabled", !enabled);
      btn.disabled = !enabled;
    };
    set(this.btnRotate, has);
    set(this.btnDelete, has);
    set(this.btnUndo, this.editor?.history.canUndo ?? false);
    set(this.btnRedo, this.editor?.history.canRedo ?? false);
    set(this.btnCopy, has);
    set(this.btnPaste, this.editor?.canPaste ?? false);
    void single;
  }

  /**
   * Apply the debug-overlay setting to the editor and toolbar.
   *
   * Safe to call before the editor exists, and after the setting changes, so the
   * overlay tracks the setting without reopening the view.
   */
  applyDebugOverlay(): void {
    const on = this.plugin.settings.debugOverlay === true;
    if (this.editor) this.editor.showProbe = on;
    if (this.geometryBtn) this.geometryBtn.toggleClass("is-hidden", !on);
    this.editor?.requestDraw();
  }

  loadModelIntoEditor(): void {
    this.editor?.setModel(this.plugin.model);
    this.installDropTarget();
  }

  /**
   * Called when the component index becomes available.
   *
   * The palette renders before the index exists — building it takes seconds,
   * and blocking the view on it would be the freeze this avoids — so it is
   * filled in when the index arrives.
   */
  onLibraryReady(): void {
    this.renderPalette();
  }

  /** Re-read the plugin's model, e.g. after it was replaced elsewhere. */
  reloadFromPlugin(): void {
    this.result = null;
    this.editor?.setModel(this.plugin.model);
    this.renderInspector();
    // Loading a model replaces the source too, or code mode keeps showing the
    // previous model while the diagram shows the new one.
    if (this.mode === "code") this.syncDiagramToCode();
    this.setStatus(`Loaded ${this.plugin.model.name}.`);
  }

  /**
   * Load one of the built-in examples.
   *
   * Examples are parsed through the same path as a file on disk, so they also
   * prove that serialize -> parse -> render round-trips.
   */
  loadExample(name: string): void {
    const ex = findExample(name);
    if (!ex) return;
    const t0 = performance.now();
    void this.plugin.setModelFromSource(ex.source).then((m) => {
      this.plugin.diag(`example ${name}: loaded in ${(performance.now() - t0).toFixed(0)} ms`);
      if (!m) return;
      // Adopt the example's natural time span. Done through the plugin so it
      // replaces any span restored with the previous model rather than being
      // ignored as one the user had chosen.
      this.plugin.setStopTime(ex.stopTime, ex.name);
      this.editor?.scheduleFit();
        this.renderInspector();
      this.setStatus(`Loaded example: ${ex.name} — ${ex.description}`);
    });
  }

  /** Toolbar picker listing the built-in examples. */
  private showExamplePicker(anchor: HTMLElement): void {
    const existing = this.contentEl.querySelector(".modelica-studio-examples-menu");
    if (existing) {
      existing.remove();
      return;
    }
    const menu = this.contentEl.createDiv({ cls: "modelica-studio-examples-menu" });
    menu.createDiv({ cls: "modelica-studio-examples-title", text: "Example models" });

    // Grouped by domain: with several examples per domain a flat list makes the
    // set look arbitrary, and the domain is what a user is usually choosing by.
    // The domain is the part of the description before the colon.
    const groups = new Map<string, typeof EXAMPLES>();
    for (const ex of EXAMPLES) {
      const domain = ex.description.includes(":")
        ? ex.description.slice(0, ex.description.indexOf(":"))
        : "Other";
      const list = groups.get(domain) ?? [];
      list.push(ex);
      groups.set(domain, list);
    }

    for (const [domain, list] of groups) {
      menu.createDiv({ cls: "modelica-studio-examples-group", text: domain });
      for (const ex of list) {
        const item = menu.createDiv({ cls: "modelica-studio-examples-item" });
        item.createDiv({ cls: "modelica-studio-examples-name", text: ex.name });
        // The domain prefix is already the group heading.
        const detail = ex.description.includes(":")
          ? ex.description.slice(ex.description.indexOf(":") + 1).trim()
          : ex.description;
        item.createDiv({ cls: "modelica-studio-examples-desc", text: detail });
        item.addEventListener("click", () => {
          menu.remove();
          this.loadExample(ex.name);
        });
      }
    }
    // Dismiss on an outside click.
    const onDown = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node) && ev.target !== anchor) {
        menu.remove();
        document.removeEventListener("pointerdown", onDown, true);
      }
    };
    setTimeout(() => document.addEventListener("pointerdown", onDown, true), 0);
  }

  /**
   * Make the inspector column resizable by dragging its left edge.
   *
   * The width is written to a CSS custom property on the root so it survives
   * re-renders of the panel contents, and persisted in settings.
   */
  private installSplitter(splitter: HTMLElement, col: HTMLElement): void {
    const root = this.contentEl;
    const apply = (w: number) => {
      const clamped = Math.max(MIN_INSPECTOR_W, Math.min(w, Math.max(MIN_INSPECTOR_W, root.clientWidth - 260)));
      root.style.setProperty("--ms-inspector-width", `${clamped}px`);
      return clamped;
    };
    apply(this.plugin.settings.inspectorWidth || DEFAULT_INSPECTOR_W);

    let startX = 0;
    let startW = 0;
    let dragging = false;

    const onMove = (ev: PointerEvent) => {
      if (!dragging) return;
      const next = apply(startW - (ev.clientX - startX));
      this.plugin.settings.inspectorWidth = next;
      // The canvas must resize with the column, or it keeps drawing at the old
      // width and the diagram appears clipped.
      this.editor?.resize();
      this.drawResults();
    };
    const onUp = (ev: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      splitter.removeClass("is-dragging");
      document.body.removeClass("modelica-studio-resizing");
      try {
        splitter.releasePointerCapture(ev.pointerId);
      } catch {
        /* capture may already be released */
      }
      void this.plugin.persist();
    };

    splitter.addEventListener("pointerdown", (ev: PointerEvent) => {
      dragging = true;
      startX = ev.clientX;
      startW = col.getBoundingClientRect().width;
      splitter.addClass("is-dragging");
      document.body.addClass("modelica-studio-resizing");
      splitter.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    splitter.addEventListener("pointermove", onMove);
    splitter.addEventListener("pointerup", onUp);
    splitter.addEventListener("pointercancel", onUp);

    // Double-click restores a sensible default.
    splitter.addEventListener("dblclick", () => {
      const w = apply(DEFAULT_INSPECTOR_W);
      this.plugin.settings.inspectorWidth = w;
      this.editor?.resize();
      this.drawResults();
      void this.plugin.persist();
    });
  }

  /**
   * Re-render once the library index has finished building.
   *
   * The index is built asynchronously (parsing the Modelica Standard Library
   * takes a couple of seconds) so the view opens immediately with an empty
   * palette and fills in as soon as the index is ready.
   */
  async refreshLibrary(): Promise<void> {
    this.renderPalette();
    this.renderInspector();
    this.editor?.requestDraw();
    const n = this.plugin.library.size;
    if (n > 0) this.setStatus(`Indexed ${n} Modelica classes.`);
  }

  /** Resolve `%param` macros for an instance, from its current parameters. */
  private resolveInstanceParam(inst: ComponentInstance, name: string): string | undefined {
    if (name === "class") return inst.className.split(".").pop();
    const v = inst.params[name];
    if (v !== undefined) return v;
    const def = this.plugin.library.component(inst.className);
    return def?.parameters.find((p) => p.name === name)?.defaultValue;
  }

  setStatus(text: string): void {
    if (this.statusEl) this.statusEl.setText(text);
  }

  /* ---------------- simulation ---------------- */

  async runSimulation(opts: { silent?: boolean } = {}): Promise<void> {
    if (this.busy) return;
    if (!this.plugin.backend) {
      if (!opts.silent) this.plugin.showSetupHelp();
      return;
    }
    this.busy = true;
    const previous = this.statusEl?.textContent ?? "";
    this.setStatus("Simulating…");
    const t0 = performance.now();

    try {
      const source = serializeDiagram(this.plugin.model);
      const parameters = collectParameters(this.plugin.model);

      const result = await this.plugin.backend.simulate({
        modelName: this.plugin.model.name,
        source,
        parameters,
        startTime: this.plugin.settings.startTime,
        stopTime: this.plugin.stopTime(),
        numberOfIntervals: this.plugin.settings.numberOfIntervals,
        tolerance: this.plugin.settings.tolerance,
        solver: this.plugin.settings.solver || undefined,
      });

      this.result = result;
      this.lastSimulationError = null;
      this.setCodeStatus("");
      this.resetZoom();
      this.plugin.diag(
        `sim ${this.plugin.model.name}: t=${result.time[0]}..${result.time[result.time.length - 1]}` +
          ` in ${result.time.length} samples`
      );
      // Prefer what the model itself names, when it came from a built-in
      // example; otherwise fall back to the variables that actually change.
      // Taking the first few in declaration order showed whatever constants a
      // library declared first, so the plot sat flat while the interesting
      // quantities stayed hidden.
      const preferred = findExample(this.plugin.model.name)?.series ?? [];
      const wanted = preferred.length
        ? preferred.filter((n) => result.series.some((s) => s.name === n))
        : defaultSeriesNames(result, 4);
      // Seeding decides what is DRAWN, not merely what is marked. `drawPlot`
      // treats a series as visible unless it is explicitly hidden, so seeding a
      // few traces used to leave every other variable drawn as well — sixteen
      // lines where two were intended, and the plot read as flat straight lines
      // because the largest of them set the scale.
      // The variable list identifies the result; a different one resets the
      // trace choices so a stale set cannot hide a fix.
      const signature = result.series.map((s) => s.name).join("|");
      this.seedVisible(wanted.length ? wanted : defaultSeriesNames(result, 8), signature);
      // A finished run is what the user is waiting for, so show it.
      this.inspectorTab = "results";
      // The scale controls span the previous result's range, so they are
      // rebuilt empty and reopened on demand rather than left misleading.
      this.inlineScale?.remove();
      this.inlineScale = null;
      // A new result resets the range, so the shared configuration follows.
      this.zoom = null;
      this.yLimits = null;
      this.renderInspector();
      this.publishChart();
      const wall = Math.round(performance.now() - t0);
      this.setStatus(
        `${result.time.length} samples · compile ${result.compileMs} ms · ` +
          `simulate ${result.simulateMs} ms · total ${wall} ms` +
          (result.reusedBinary ? " · reused build" : "")
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus("Simulation failed.");
      // Kept so the AI can be asked to repair the model it just failed on.
      this.lastSimulationError = msg;
      this.setCodeStatus(firstLine(msg), true);
      new Notice(`Modelica: ${firstLine(msg)}`, 8000);
      this.showDiagnostics(msg);
      void previous;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Report the geometry of the main regions.
   *
   * A region that does not reach its neighbour shows as an unexplained band, and
   * which element is short is not visible from the outside.
   */
  private reportLayout(): void {
    const box = (el: Element | null | undefined): string => {
      if (!el) return "?";
      const r = el.getBoundingClientRect();
      return `${Math.round(r.top)}..${Math.round(r.bottom)} (${Math.round(r.height)})`;
    };
    const q = (sel: string) => this.contentEl.querySelector(sel);
    this.plugin.diag(
      "layout: content=" + box(this.contentEl) +
        " root=" + box(q(".modelica-studio-root")) +
        " body=" + box(q(".modelica-studio-body")) +
        " canvasHost=" + box(q(".modelica-studio-canvas-host")) +
        " canvas=" + box(q(".modelica-studio-canvas")) +
        " splitter=" + box(q(".modelica-studio-results-splitter")) +
        " results=" + box(q(".modelica-studio-results")) +
        " status=" + box(q(".modelica-studio-status"))
    );
  }

  /** Show compiler errors in the inspector, where they are readable. */
  private showDiagnostics(message: string): void {
    const el = this.inspectorEl;
    if (!el) return;
    const box = el.createDiv({ cls: "modelica-studio-diagnostics" });
    box.createDiv({ cls: "modelica-studio-diagnostics-head", text: "Diagnostics" });
    box.createEl("pre", { text: message });
    el.prepend(box);
  }

  /**
   * Show the editor's live geometry.
   *
   * Diagnostic for a coordinate mismatch: reports the canvas position and size,
   * the viewport, and each component's drawn-versus-clickable position, so the
   * disagreement is a set of numbers rather than something to infer.
   */
  showGeometry(): void {
    const text = this.editor?.dumpGeometry() ?? "no editor";
    // Outline the clickable and drawn regions while the panel is open, so the
    // numbers can be checked against the picture.
    if (this.editor) {
      this.editor.showProbe = true;
      this.editor.requestDraw();
    }
    this.plugin.diag(`geometry\n${text}`);
    // Also put it on screen, since the debug log may not be readable.
    const box = this.contentEl.createDiv({ cls: "modelica-studio-geometry" });
    const pre = box.createEl("pre");
    pre.setText(text);
    const close = box.createEl("button", { text: "Close" });
    close.addEventListener("click", () => {
      box.remove();
      if (this.editor) {
        this.editor.showProbe = false;
        this.editor.requestDraw();
      }
    });
    console.info(text);
  }

  async saveToNote(): Promise<void> {
    try {
      await this.plugin.saveModelToNote();
      new Notice("Model saved.");
    } catch (err) {
      new Notice(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const MIN_INSPECTOR_W = 260;
const DEFAULT_INSPECTOR_W = 380;

/** Smallest height the results pane can be dragged to, in pixels. */
const MIN_RESULTS_H = 160;

/** Components listed per package before the user narrows the search. */
const SEARCH_LIMIT = 200;

/** Variables listed before the filter must be used to narrow them. */
const SERIES_PAGE = 40;

/** Palette thumbnail edge, in CSS pixels. */
const THUMB_SIZE = 56;

/** Collect `instance.param` overrides for every component in the diagram. */

function shortPackage(qualified: string): string {
  const parts = qualified.split(".");
  return parts.length <= 2 ? qualified : parts.slice(-2).join(".");
}

function shortType(qualified: string): string {
  const parts = qualified.split(".");
  return parts[parts.length - 1] ?? qualified;
}

function firstLine(s: string): string {
  return s.split("\n").find((l) => l.trim().length > 0)?.trim() ?? s;
}

function clampToRange(z: { xMin: number; xMax: number }, lo: number, hi: number): void {
  const span = z.xMax - z.xMin;
  const minSpan = (hi - lo) / 1000;
  if (span < minSpan) {
    const c = (z.xMin + z.xMax) / 2;
    z.xMin = c - minSpan / 2;
    z.xMax = c + minSpan / 2;
  }
  if (z.xMin < lo) {
    const s = z.xMax - z.xMin;
    z.xMin = lo;
    z.xMax = lo + s;
  }
  if (z.xMax > hi) {
    const s = z.xMax - z.xMin;
    z.xMax = hi;
    z.xMin = hi - s;
  }
}

/** Layout used by the plot event handlers; mirrors plot.ts. */
function plotLayoutFor(w: number, h: number, result: SimResult) {
  const left = 62;
  const showLegend = result.series.length > 0;
  const right = showLegend ? Math.min(220, Math.max(120, w * 0.28)) : 16;
  const top = 14;
  const bottom = 34;
  return { left, right, top, bottom, width: Math.max(10, w - left - right), height: Math.max(10, h - top - bottom) };
}

/**
 * Best-effort line number from a parse error message.
 *
 * Used only to put a mark in the gutter. Textual position reporting is not
 * guaranteed, so anything that cannot be located is reported as "line 1" rather
 * than guessed at.
 */
function lineOfParseError(message: string, source: string): number | undefined {
  const named = /line\s+(\d+)/i.exec(message);
  if (named) return Math.max(1, Number(named[1]));
  // Quote from the message, if any, and find where it occurs in the source.
  const quoted = /["'\u201c]([^"'\u201d]{2,40})["'\u201d]/.exec(message);
  if (quoted) {
    const at = source.indexOf(quoted[1]);
    if (at >= 0) return source.slice(0, at).split("\n").length;
  }
  return source.trim() ? 1 : undefined;
}
