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

import { App, ItemView, Modal, Notice, Platform, TFile, WorkspaceLeaf, setIcon } from "obsidian";
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
import { fuzzyFilter } from "../modelica/fuzzy";
import { docUrlFor, libraryVersionFrom } from "../modelica/doclinks";
import { acceptsFileDrag, droppedVaultFile } from "./drop";
import { SavedModelsModal } from "./saved-models-modal";
import { HelpModal } from "./help-modal";
import { SimulationError } from "../omc/backend";
import { CODE_RESULTS_H, DEFAULT_RESULTS_H, clampInspectorWidth, clampResultsHeight } from "./panes";
import { checkModel, ModelProblem } from "../modelica/checks";
import { createCodeEditor, CodeEditorHandle, Diagnostic } from "./code-editor";
import { AiError, buildMessages, chat } from "../ai/client";
import { GenerationOutcome, generateModel } from "../ai/generate";
import { DEFAULT_TIMEOUT_SECONDS } from "../ai/prompts";
import type { SimResult, SimSeries } from "../omc/backend";

export const VIEW_TYPE_MODELICA = "modelica-studio-view";

export class ModelicaStudioView extends ItemView {
  plugin: ModelicaStudioPlugin;

  private editor: SchematicEditor | null = null;
  private paletteEl!: HTMLElement;
  private canvasHost!: HTMLElement;
  private inspectorEl!: HTMLElement;
  /** The run-log pane and its text, sharing the bottom area with the plot. */
  private logHost: HTMLElement | null = null;
  /** Reverts to the saved file; disabled when there is nothing to go back to. */
  private btnRevert: HTMLButtonElement | undefined;
  /**
   * The palette's rows, in the order they are drawn.
   *
   * Kept as a flat list so the keyboard can walk it: the rows are nested under
   * package and group headings, but the arrows should cross those boundaries
   * rather than stopping at each one.
   */
  private paletteItems: string[] = [];
  private logText: HTMLElement | null = null;
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
  private bottomTab: "plot" | "source" | "log" = "plot";
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
      attr: {
        type: "search",
        placeholder: "Search components…",
        // A placeholder is not a label: it vanishes once anything is typed, and
        // a screen reader may not announce it at all.
        "aria-label": "Search the component library",
        spellcheck: "false",
        autocomplete: "off",
      },
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
    this.inspectorTabsEl.setAttribute("role", "tablist");
    // Named for a screen reader, but not a tooltip: a tab strip's label would
    // otherwise appear over every tab in it.
    noLabelTooltip(this.inspectorTabsEl, "Inspector");
    this.inspectorEl = rightCol.createDiv({ cls: "modelica-studio-inspector-body" });
    this.installSplitter(splitter, rightCol);

    // Results get their own pane across the window rather than a slot inside the
    // inspector. In a 380px column a plot is unreadable, and the legend covers
    // half the traces; spanning the window is what makes it legible.
    const resultsCol = root.createDiv({ cls: "modelica-studio-results" });
    // The handle goes AFTER the results pane so it renders on that pane's BOTTOM
    // edge — the line where the results end and the editing area begins, which is
    // where a divider between the two belongs. Before the pane it sat on the
    // pane's top edge instead, above the tab strip, which read as a bar floating
    // over the plot rather than as the boundary it controls.
    const resultsSplitter = root.createDiv({ cls: "modelica-studio-results-splitter" });
    // Restore the height the user dragged it to, so the choice survives a
    // reload rather than resetting to the default every time.
    if (this.storedResultsHeight() > 0) {
      // Clamped on restore as well: a height stored before the maximum existed,
      // or on a larger window, would otherwise come back out of range.
      resultsCol.style.height = `${this.clampResultsHeight(this.storedResultsHeight())}px`;
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
    // Restore the remembered mode after the first layout pass, so switching does
    // not measure a pane the browser has not laid out yet.
    window.setTimeout(() => {
      if (this.plugin.settings.editorMode === "code" && this.mode === "diagram") {
        this.setMode("code");
      }
      this.reportLayout();
    }, 400);
    // An empty canvas is a dead end for a first-time user: nothing to
    // simulate and nothing to drag a wire between. Seed it with an example.
    // A model of only variables — `BouncingBall`, a pure equation model — is
    // genuinely without a schematic, so it is not replaced.
    const declaredVariables = this.plugin.model.variables?.length ?? 0;
    if (
      !this.freshModel &&
      this.plugin.model.components.length === 0 &&
      declaredVariables === 0
    ) {
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

  /**
   * The toolbar.
   *
   * Organised in labelled groups rather than one run of fifteen buttons: at that
   * length a flat row stops being scannable, and grouping is what tells a reader
   * that Undo and Paste belong together and Zoom does not. Groups are also the
   * unit that shows and hides with the mode, because a button that does nothing
   * in the current mode is worse than an absent one.
   *
   * Naming rules applied throughout: sentence case, a verb first where the action
   * is one ("Zoom in", not "Zoom"), an ellipsis on anything that opens a dialog
   * or a menu, and a tooltip that says what the action does rather than repeating
   * the label.
   */
  private buildToolbar(bar: HTMLElement): void {
    /** Platform-correct modifier, so a shortcut reads the way the OS writes it. */
    const mod = Platform.isMacOS ? "⌘" : "Ctrl";

    const addBtn = (
      parent: HTMLElement,
      icon: string,
      label: string,
      hint: string,
      onClick: () => void,
      cls = ""
    ) => {
      const b = parent.createEl("button", { cls: `modelica-studio-btn ${cls}`.trim() });
      setIcon(b, icon);
      // The visible label IS the accessible name, so no aria-label: Obsidian
      // renders one from it, and having both attributes showed two tooltips in
      // two different styles.
      b.createSpan({ text: label });
      // `aria-label` is the ONLY attribute Obsidian renders a tooltip from -- its
      // handler reads `aria-label` and never `title`. Setting `title` as well drew
      // the browser's native tooltip on top of Obsidian's, which is the overlap.
      b.setAttribute("aria-label", hint);
      b.addEventListener("click", onClick);
      return b;
    };

    const addGroup = (parent: HTMLElement, name: string, scope: "both" | "diagram") => {
      const g = parent.createDiv({ cls: "modelica-studio-btn-group" });
      g.dataset.scope = scope;
      g.setAttribute("role", "group");
      noLabelTooltip(g, name);
      return g;
    };

    // ---- the mode switch leads, because it decides what the rest acts on ----
    const modeGroup = bar.createDiv({ cls: "modelica-studio-modes" });
    modeGroup.setAttribute("role", "group");
    // "Editor mode" appeared as a second tooltip over the Diagram and Code
    // buttons, because the tooltip handler is delegated on `[aria-label]` and
    // fired for the group when the pointer crossed a button inside it.
    noLabelTooltip(modeGroup, "Editor mode");
    const addMode = (id: "diagram" | "code", icon: string, label: string, hint: string) => {
      const b = modeGroup.createEl("button", { cls: "modelica-studio-btn modelica-studio-mode" });
      setIcon(b, icon);
      // Same as the toolbar: the text is the accessible name, and a second
      // attribute would render a second tooltip.
      b.createSpan({ text: label });
      b.setAttribute("aria-label", hint);
      // A pair of mutually exclusive views is what `aria-pressed` describes, and
      // it is also what makes the active one announce itself.
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => this.setMode(id));
      this.modeButtons[id] = b;
      return b;
    };
    addMode("diagram", "shapes", "Diagram", "Build the model by dragging components");
    addMode("code", "code", "Code", "Edit the Modelica source with completion and AI");

    // ---- Model: what is being edited, and saving it ----
    const model = addGroup(bar, "Model", "both");
    const examplesBtn = addBtn(
      model,
      "library",
      "Examples…",
      "Open the list of built-in example models",
      () => this.showExamplePicker(examplesBtn)
    );
    addBtn(model, "file-plus", "New…", "Start an empty model, discarding the current one", () =>
      void this.plugin.promptNewModel()
    );
    addBtn(model, "save", "Save as .mo", "Write the model to a .mo file in the vault", () =>
      void this.saveToNote()
    );
    // The list of saved models belongs here rather than in settings: it is about
    // the model being worked on and where it lives, which is something you want
    // to see while working. The dialog also opens a model, so it is the way
    // between them rather than only a report.
    addBtn(model, "files", "Model list…", "Every model saved in this vault; click one to open it", () =>
      new SavedModelsModal(this.app, this.plugin).open()
    );
    // The way back to the file on disk. It was the missing escape hatch: once a
    // bad edit reached the editor and was persisted, there was no one-click return
    // to what was last saved -- which is exactly what is wanted after a repair
    // that made things worse.
    this.btnRevert = addBtn(
      model,
      "history",
      "Revert",
      "Discard the changes since the last save and reload the file from disk",
      () => void this.revertToSaved()
    );
    // Help sits at the end, after the actions: it is where you look when the
    // others have not answered the question.
    addBtn(bar, "help-circle", "Help", "What this installation is, the documentation, and the keyboard shortcuts", () =>
      new HelpModal(this.app, this.plugin).open()
    );

    // ---- Run ----
    const run = addGroup(bar, "Run", "both");
    addBtn(
      run,
      "play",
      "Simulate",
      `Compile and run the model (${mod}+Enter)`,
      () => void this.runSimulation(),
      "mod-cta"
    );
    addBtn(
      run,
      "refresh-cw",
      "Rebuild",
      "Discard the compiled model, so the next simulation compiles again",
      () => {
        this.plugin.invalidateBuild();
        this.setStatus("Build cache cleared; the next simulation will recompile.");
      }
    );

    // ---- Edit: diagram only. The code editor has its own toolbar, and hiding
    // these is more honest than showing buttons that would do nothing.
    const edit = addGroup(bar, "Edit", "diagram");
    this.btnUndo = addBtn(edit, "undo-2", "Undo", `Undo (${mod}+Z)`, () => this.editor?.undo());
    this.btnRedo = addBtn(edit, "redo-2", "Redo", `Redo (${mod}+Shift+Z)`, () => this.editor?.redo());
    this.btnCopy = addBtn(edit, "copy", "Copy", `Copy the selection (${mod}+C)`, () => this.editor?.copy());
    this.btnPaste = addBtn(
      edit,
      "clipboard-paste",
      "Paste",
      `Paste (${mod}+V)`,
      () => void this.editor?.paste()
    );
    this.btnDelete = addBtn(
      edit,
      "trash",
      "Delete",
      "Delete the selected components (Del or Backspace)",
      () => this.editor?.deleteSelection()
    );
    this.btnRotate = addBtn(
      edit,
      "rotate-cw",
      "Rotate",
      "Turn the selection a quarter turn clockwise (R, or Shift+R anticlockwise)",
      () => this.editor?.rotateSelection(90)
    );

    // ---- View: diagram only ----
    const view = addGroup(bar, "View", "diagram");
    // The wheel zooms about the pointer with no modifier, so the tooltip says
    // scroll rather than inventing a chord for it.
    addBtn(view, "zoom-in", "Zoom in", "Enlarge the diagram, or scroll up over the canvas", () =>
      this.editor?.zoomBy(1.25)
    );
    addBtn(view, "zoom-out", "Zoom out", "Shrink the diagram, or scroll down over the canvas", () =>
      this.editor?.zoomBy(0.8)
    );
    addBtn(view, "maximize", "Fit to view", `Fit the whole diagram in the canvas (${mod}+0)`, () =>
      this.editor?.scheduleFit()
    );

    // Diagnostic: report the geometry the editor is using. Shown only when the
    // debug overlay is enabled in settings.
    this.geometryBtn = addBtn(
      bar,
      "ruler",
      "Geometry",
      "Report the editor's exact geometry as text",
      () => this.showGeometry()
    );
    this.applyDebugOverlay();

    // Buttons start disabled until there is a selection to act on, rather than
    // appearing live and doing nothing when pressed.
    this.updateToolbarState();
    window.setTimeout(() => this.reportToolbar(), 700);
  }

  /** Show or hide each toolbar group for the mode, and mark the active mode. */
  private syncToolbarToMode(): void {
    const isCode = this.mode === "code";
    for (const group of Array.from(this.contentEl.querySelectorAll<HTMLElement>(".modelica-studio-btn-group"))) {
      const diagramOnly = group.dataset.scope === "diagram";
      group.style.display = diagramOnly && isCode ? "none" : "";
    }
    for (const [id, b] of Object.entries(this.modeButtons)) {
      b.toggleClass("is-active", id === this.mode);
      b.setAttribute("aria-pressed", id === this.mode ? "true" : "false");
    }
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
    // Dragging a `.mo` onto the code pane opens it too: it is the surface where
    // source is edited, so it is where someone would expect to drop source.
    host.addEventListener("dragover", (ev) => {
      // By TYPE, not by content: the data is unreadable here, and without
      // preventDefault the browser refuses the drop and `drop` never fires —
      // which is why dragging a file onto this pane did nothing at all.
      if (!acceptsFileDrag(ev.dataTransfer?.types ?? [], ev.dataTransfer?.files.length ?? 0)) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
    });
    host.addEventListener("drop", (ev) => {
      const path = droppedVaultFile((t) => ev.dataTransfer?.getData(t) ?? "");
      if (!path) return;
      ev.preventDefault();
      void this.plugin.loadModelFromPath(path);
    });

    // Its own toolbar: the diagram's zoom, rotate and delete buttons mean
    // nothing here, and leaving them visible would be a lie about what they do.
    const bar = host.createDiv({ cls: "modelica-studio-code-bar" });
    this.codeToolbar = bar;

    const mk = (icon: string, label: string, hint: string, onClick: () => void) => {
      const b = bar.createEl("button", { cls: "modelica-studio-btn" });
      setIcon(b, icon);
      b.createSpan({ text: label });
      // `aria-label` is the ONLY attribute Obsidian renders a tooltip from -- its
      // handler reads `aria-label` and never `title`. Setting `title` as well drew
      // the browser's native tooltip on top of Obsidian's, which is the overlap.
      b.setAttribute("aria-label", hint);
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
    aiRow.setAttribute("role", "group");
    noLabelTooltip(aiRow, "Generate a model with AI");
    this.aiRow = aiRow;

    const input = aiRow.createEl("input", {
      cls: "modelica-studio-ai-input",
      attr: {
        type: "text",
        placeholder: "e.g. a tank draining through an orifice, 2 m of water",
        "aria-label": "Describe the model you want",
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
    setIcon(go, "sparkles");
    go.createSpan({ text: "Generate" });
    go.setAttribute(
      "aria-label",
      "Write a model from the description, then compile it and repair it until it builds"
    );
    go.addEventListener("click", () => void this.runAiRequest());
    this.aiGoBtn = go;

    const fix = aiRow.createEl("button", { cls: "modelica-studio-btn" });
    setIcon(fix, "wrench");
    fix.createSpan({ text: "Fix errors" });
    fix.setAttribute(
      "aria-label",
      "Repair the current model, using the last simulation's output or the run log"
    );
    fix.addEventListener("click", () => void this.runAiRequest(true));
    this.aiFixBtn = fix;

    // Shown only while a run is in flight. The loop can take minutes, so it must
    // be visible that something is happening and stoppable when it is not wanted.
    const stop = aiRow.createEl("button", { cls: "modelica-studio-btn" });
    setIcon(stop, "square");
    stop.createSpan({ text: "Stop" });
    stop.setAttribute("aria-label", "Stop the run after the current step");
    stop.style.display = "none";
    stop.addEventListener("click", () => {
      this.aiCancel = true;
      stop.setAttribute("disabled", "true");
      this.setAiProgress("Stopping after the current step…");
    });
    this.aiStopBtn = stop;

    const progress = aiRow.createDiv({ cls: "modelica-studio-ai-progress" });
    progress.style.display = "none";
    progress.setAttribute("role", "status");
    progress.setAttribute("aria-live", "polite");
    this.aiProgressEl = progress;

    this.codeStatusEl = bar.createDiv({ cls: "modelica-studio-code-status" });
  }

  private codeDiagEl: HTMLElement | null = null;
  private codeStatusEl: HTMLElement | null = null;
  private aiInput: HTMLInputElement | null = null;
  private aiGoBtn: HTMLButtonElement | null = null;
  private aiStopBtn: HTMLButtonElement | null = null;
  private aiProgressEl: HTMLElement | null = null;
  /** Set by the Stop button; the loop polls it between steps. */
  private aiCancel = false;
  /** Ticks the elapsed time while a request is in flight. */
  private aiTimer: number | null = null;
  /** When the current AI run started, for the elapsed display. */
  private aiStartedAt = 0;
  /** The step being shown, kept so the elapsed clock can re-render it. */
  private aiPhase = "";
  /**
   * True when the model on screen was just created, so an empty canvas is what
   * the user asked for rather than a dead end to seed.
   */
  private freshModel = false;
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
    // Persisted so the studio opens the way it was left.
    this.plugin.settings.editorMode = mode;
    this.plugin.traceStep("mode");
    void this.plugin.saveSettings();
    const isCode = mode === "code";
    if (this.bodyEl) this.bodyEl.style.display = isCode ? "none" : "";
    if (this.codeHost) this.codeHost.style.display = isCode ? "" : "none";
    this.syncToolbarToMode();
    this.applyModeResultsHeight(isCode);
    if (isCode) {
      this.codeEditor?.focus();
      this.validateCode();
    } else {
      this.editor?.requestDraw();
    }
    this.setStatus(isCode ? "Code mode. Ctrl+Space completes, Ctrl+Enter simulates." : "Diagram mode.");
  }

  /**
   * Give the results pane the height its mode wants.
   *
   * The pane sits ABOVE the editing area, so its height comes straight out of
   * what is being edited. In code mode a tall pane leaves the editor looking like
   * mostly empty space above the text. A height the user chose is respected —
   * this only moves the default.
   */
  private applyModeResultsHeight(isCode: boolean): void {
    if (!this.resultsEl) return;
    // The editing area ALWAYS grows to fill whatever the results pane does not
    // use. Giving the code pane a height of its own was the fault: on a tall
    // window it stopped filling, leaving dead space below the editor, and the
    // drag appeared to move a fixed block about inside it rather than resizing
    // the editor.
    if (this.codeHost) {
      this.codeHost.style.flex = "";
      this.codeHost.style.height = "";
    }
    // Only the results pane carries a height. Code mode starts it small, because
    // there a plot is a reference rather than the subject.
    const stored = isCode ? this.plugin.settings.codePlotHeight : this.plugin.settings.plotHeight;
    const fallback = isCode ? CODE_RESULTS_H : DEFAULT_RESULTS_H;
    this.resultsEl.style.height = `${this.clampResultsHeight(stored > 0 ? stored : fallback)}px`;
    if (this.bottomTab === "plot") this.drawResults();
  }

  /** Remember a height the user dragged, against the current mode. */
  private storeResultsHeight(px: number): void {
    const value = Math.round(px);
    if (this.mode === "code") this.plugin.settings.codePlotHeight = value;
    else this.plugin.settings.plotHeight = value;
    void this.plugin.saveSettings();
  }

  /** The stored results height for the mode currently on screen. */
  private storedResultsHeight(): number {
    return this.mode === "code" ? this.plugin.settings.codePlotHeight : this.plugin.settings.plotHeight;
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
        // JSON, not key=value: CSS colours contain spaces, which made the
        // first version of this log unparseable exactly where it mattered.
        probe: (info) => this.plugin.diag("code layers " + JSON.stringify(info)),
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

      // Structural checks, in the editor, where the mistake is. The compiler
      // catches these too, but only after a Simulate and in its own words: an
      // AI-written model naming an undeclared `m` came back as "Variable m not
      // found in scope", several steps after the mistake was made.
      const problems = this.checkCurrentModel(text, model);
      const errors = problems.filter((p) => p.severity === "error");
      this.codeEditor.setDiagnostics(problems);
      if (errors.length) {
        this.reportCodeProblem(
          `${errors.length} problem${errors.length === 1 ? "" : "s"}: ${errors[0].message}`,
          problems
        );
        return;
      }
      this.clearCodeProblem();
      // Warnings are shown in the gutter without claiming the model is broken.
      if (problems.length) this.setCodeStatus(problems[0].message, false);
      else this.setCodeStatus("");
    } catch (err) {
      // A parse failure is reported against the first line if the message names
      // one, and against the top otherwise: the parser does not promise a
      // position, and a wrong mark is worse than a general one.
      const line = lineOfParseError(String(err), text);
      this.reportCodeProblem(String(err), line ? [{ line, message: String(err), severity: "error" }] : []);
    }
  }

  /**
   * Run the local equation checks over a parsed model.
   *
   * The declared-name set is assembled from every place a model can introduce a
   * name: components, plain variables, parameters, and `import` aliases. Getting
   * that set wrong in either direction is what makes such a check useless — too
   * small and it cries wolf, too large and it misses everything.
   */
  private checkCurrentModel(text: string, model: DiagramModel): ModelProblem[] {
    const declared = new Set<string>();
    for (const c of model.components) declared.add(c.id);
    for (const v of model.variables ?? []) declared.add(v.id);

    // `import Modelica.Constants.g_n;` introduces `g_n`.
    for (const m of text.matchAll(/\bimport\s+([A-Za-z_][\w.]*)\s*;/g)) {
      const parts = m[1].split(".");
      declared.add(parts[parts.length - 1]);
    }
    // `import X = Y.Z;` introduces `X`.
    for (const m of text.matchAll(/\bimport\s+([A-Za-z_]\w*)\s*=/g)) declared.add(m[1]);
    // `import Modelica.Math.*;` brings names in wholesale, so nothing can be
    // called undeclared once one is present.
    const starImport = /\bimport\s+[\w.]+\s*\.\s*\*\s*;/.test(text);

    const firstEquationLine = (() => {
      const lines = text.split("\n");
      const at = lines.findIndex((l) => /^\s*equation\b/.test(l));
      return at >= 0 ? at + 2 : 1;
    })();

    // Declarations with their raw text, for checks that are about how something
    // was declared rather than what it is named.
    const lines = text.split("\n");
    const declarations: Array<{ name: string; text: string; line: number }> = [];
    let pending: { parts: string[]; line: number } | null = null;
    lines.forEach((line, i) => {
      const decl = /^\s*(?:parameter|constant|discrete|input|output|final|inner|outer|flow|stream|replaceable|each|\s)*([A-Za-z_][\w.]*)\s+([A-Za-z_]\w*)\s*(\(|;|$)/.exec(line);
      if (decl) {
        if (pending) declarations.push(finishDecl(pending));
        pending = { parts: [line], line: i + 1 };
      } else if (pending) {
        pending.parts.push(line);
        if (line.includes(";")) {
          declarations.push(finishDecl(pending));
          pending = null;
        }
      }
    });
    if (pending) declarations.push(finishDecl(pending));

    // The components, with what the checks need to judge the picture.
    const connectedPins = new Map<string, string[]>();
    for (const cn of model.connections) {
      for (const end of [cn.from, cn.to]) {
        connectedPins.set(end.component, [...(connectedPins.get(end.component) ?? []), end.port]);
      }
    }
    const components = model.components.map((c) => ({
      id: c.id,
      extent: c.placement
        ? ([...c.placement.extent] as [number, number, number, number])
        : undefined,
      connectedPins: connectedPins.get(c.id) ?? [],
      // A primitive declared inline has no class to look up; a library component
      // is the thing a diagram is made of.
      fromLibrary: true,
    }));

    const problems = checkModel({
      declared: starImport ? new Set([...declared, "*"]) : declared,
      declarations,
      components,
      equations: model.equations ?? [],
      hasComponents: model.components.length > 0,
      library: this.plugin.library,
      firstEquationLine,
    });
    // A star import makes every name potentially declared, so nothing is.
    return starImport ? problems.filter((p) => !p.message.includes("never declared")) : problems;
  }

  /**
   * The fullest failure text available for a repair request.
   *
   * Preference order: the last run's complete output, then the run log's most
   * recent failure, then whatever the diagnostics line is showing. The log comes
   * second rather than first because `lastSimulationError` is the run the user is
   * looking at.
   */
  private fullFailureText(): string {
    const direct = this.lastSimulationError?.trim();
    if (direct) return direct;
    const logged = this.plugin.runLog.lastFailure();
    if (logged) return logged.detail;
    return this.codeDiagEl?.getText()?.trim() ?? "";
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
  /**
   * Ask for a model, then compile and repair it until it builds.
   *
   * The whole thing runs in the background with no further input: the user
   * describes what they want and watches. What they see is the attempt number and
   * the fault being repaired, because a loop that takes two minutes with no
   * output is indistinguishable from one that has hung.
   *
   * It ends when the model compiles, when the model stops making progress, or
   * when the attempt ceiling is reached — and it says which.
   */
  private async runAiRequest(repair = false): Promise<void> {
    if (this.aiBusy) return;
    const cfg = this.plugin.settings.ai;
    if (!this.plugin.aiKey()) {
      this.setStatus(
        "No AI key available. Choose or create a secret in the plugin settings under AI assistance."
      );
      this.toggleAiRow(true);
      return;
    }
    if (!this.plugin.backend) {
      this.setStatus("OpenModelica was not found, so a generated model could not be checked.");
      return;
    }

    const prompt = repair
      ? "The model below does not compile. Fix it, keeping what it is trying to do."
      : (this.aiInput?.value.trim() ?? "");
    if (!prompt) {
      this.setStatus("Describe the model you want first.");
      this.aiInput?.focus();
      return;
    }

    const original = this.codeEditor?.getValue() ?? "";
    const failure = repair ? this.fullFailureText() : "";

    this.aiBusy = true;
    this.aiCancel = false;
    this.aiGoBtn?.setAttribute("disabled", "true");
    this.aiFixBtn?.setAttribute("disabled", "true");
    if (this.aiStopBtn) this.aiStopBtn.style.display = "";
    // A previous model is worth keeping: a run that produces nothing must leave
    // the editor as it was, not empty.
    this.setAiProgress("Asking " + cfg.model + "…");
    // A request can legitimately take a minute, and "asking…" alone is
    // indistinguishable from a hang. A clock that keeps moving is the cheapest
    // honest signal that something is still happening.
    this.aiStartedAt = Date.now();
    this.aiTimer = window.setInterval(() => this.tickAiProgress(cfg.model), 1000);

    try {
      const outcome = await generateModel({
        prompt,
        environment: this.plugin.aiContext(prompt),
        current: original,
        getKey: () => this.plugin.aiKey(),
        config: cfg,
        backend: this.plugin.backend,
        settings: {
          startTime: this.plugin.settings.startTime,
          stopTime: this.plugin.stopTime(),
          numberOfIntervals: this.plugin.settings.numberOfIntervals,
          tolerance: this.plugin.settings.tolerance,
          solver: this.plugin.settings.solver,
        },
        send: (messages) => chat(cfg, messages, () => this.plugin.aiKey()),
        buildMessages: (p, current, failureText, style) =>
          buildMessages({
            prompt: p,
            current,
            // The style reaches the prompt, so the fallback changes the answer
            // rather than only the loop's label for it.
            style,
            // The generated source is repaired against the compiler's own words,
            // and the standard brief is attached to every attempt so a repair is
            // made with the same knowledge as the first draft.
            diagnostics: failureText || undefined,
            library: this.plugin.library,
            systemPrompt: cfg.systemPrompt,
            environment: this.plugin.aiContext(p),
          }),
        onProgress: (event) => {
          this.aiPhase =
            event.phase === "compiling"
              ? `Attempt ${event.attempt}: compiling`
              : event.phase === "repairing"
                ? `Attempt ${event.attempt}: repairing${event.detail ? ` — ${event.detail}` : ""}`
                : `Attempt ${event.attempt}: asking ${cfg.model}`;
          // Compiling and repairing are quick, so the clock restarts per phase
          // and the number always describes the step on screen.
          if (event.phase !== "asking") {
            this.aiStartedAt = Date.now();
            this.setAiProgress(`${this.aiPhase}…`);
          }
        },
        isCancelled: () => this.aiCancel,
      });

      this.finishAiRun(outcome, original, repair);
    } catch (err) {
      const msg = err instanceof AiError ? err.message : String(err);
      // To the console as well as the status line: a request can fail for a
      // reason the one-line status cannot carry, and the console is where the
      // full text can be read and copied.
      console.error("[Modelica Studio] AI request failed:", err);
      this.plugin.diag(`ai request failed: ${msg}`, "error");
      this.setStatus(`AI request failed. ${msg}`);
      this.setAiProgress(`Failed: ${msg}`);
    } finally {
      this.stopAiTimer();
      this.aiBusy = false;
      this.aiGoBtn?.removeAttribute("disabled");
      this.aiFixBtn?.removeAttribute("disabled");
      if (this.aiStopBtn) {
        this.aiStopBtn.style.display = "none";
        this.aiStopBtn.removeAttribute("disabled");
      }
      this.aiCancel = false;
    }
  }

  /**
   * Report how a run ended, and put the result where it can be seen.
   *
   * A run that produced nothing usable restores what was in the editor: leaving
   * a broken model in place would be worse than leaving the previous one, and the
   * previous one is what the user still has.
   */
  private finishAiRun(outcome: GenerationOutcome, original: string, repair: boolean): void {
    const attempts = outcome.attempts.length;
    const name = outcome.modelName;

    if (outcome.ok) {
      this.codeEditor?.setValue(outcome.source);
      this.applyCodeToDiagram(false);
      this.lastSimulationError = null;
      if (!repair && this.aiInput) this.aiInput.value = "";
      const lines = outcome.source.split("\n").length;
      this.setAiProgress(
        `${outcome.message} ${name ? `"${name}"` : "The model"} is ${lines} lines; running it now.`
      );
      this.setStatus(`AI wrote ${name ? `"${name}"` : "a model"}. ${outcome.message}`);
      // The model compiled, so run it: the point of generating it is to see it.
      void this.runSimulation();
      return;
    }

    // Nothing usable. The last attempt is kept in the editor so the failure can
    // be read, but only when it is different from what was there.
    if (outcome.source && outcome.source !== original) {
      this.codeEditor?.setValue(outcome.source);
      this.applyCodeToDiagram(false);
    }
    this.lastSimulationError = outcome.attempts[outcome.attempts.length - 1]?.failure ?? null;

    // The reasons are distinct because they need different actions, and calling a
    // timeout a refusal sends the reader to check their key when the problem is
    // that the model is slow.
    const why =
      outcome.reason === "cancelled"
        ? "Stopped."
        : outcome.reason === "attempts-exhausted"
          ? `Gave up after ${attempts} attempts.`
          : outcome.reason === "no-progress"
            ? `Stopped after ${attempts} attempt${attempts === 1 ? "" : "s"}: no progress.`
            : outcome.reason === "provider-error"
              ? outcome.message
              : "The reply contained no Modelica.";

    this.setAiProgress(`${why} ${outcome.message}`);
    this.setStatus(`AI: ${why} See the Run log for the compiler output.`);
    new Notice(`Modelica AI: ${why}`, 8000);
  }

  /**
   * Show that time is passing, and for how long.
   *
   * The label is kept and only the elapsed part is replaced, so a phase change
   * does not fight the clock.
   */
  private tickAiProgress(model: string): void {
    if (!this.aiProgressEl) return;
    const seconds = Math.round((Date.now() - this.aiStartedAt) / 1000);
    const base = this.aiPhase || `Asking ${model}`;
    const limit = this.plugin.settings.ai.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
    const left = Math.max(0, limit - seconds);
    this.aiProgressEl.setText(`${base} — ${seconds}s (gives up at ${limit}s, ${left}s left)`);
  }

  private stopAiTimer(): void {
    if (this.aiTimer !== null) {
      window.clearInterval(this.aiTimer);
      this.aiTimer = null;
    }
  }

  /** Write a line into the AI row, and show a stop button while running. */
  private setAiProgress(text: string): void {
    if (!this.aiProgressEl) return;
    this.aiProgressEl.style.display = "";
    this.aiProgressEl.setText(text);
    this.aiPhase ||= text;
  }

  /** Compiler output from the last failed simulation, used to repair source. */
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
    this.paletteItems = [];
    if (!this.paletteEl) return;
    const started = performance.now();
    let shown = 0;
    this.paletteEl.empty();

    const filter = this.filterText.trim().toLowerCase();

    // A search spans the whole library rather than the visible branch, so a
    // component is always reachable however deep it sits.
    if (filter) {
      // Fuzzy, not substring: in a library of ~6,900 classes the exact spelling
      // is often the thing being looked for. `cvs` finds `ConstantVoltage`, and
      // `moelreba` finds `Modelica.Electrical.Analog.Basic.Resistor`.
      const { hits, total } = this.searchPalette(filter);
      const group = this.paletteEl.createDiv({ cls: "modelica-studio-palette-group" });
      group.createDiv({
        cls: "modelica-studio-palette-group-head",
        text: total
          ? total > hits.length
            ? `Matches (${hits.length} of ${total})`
            : `Matches (${total})`
          : "No matches",
      });
      const list = group.createDiv({ cls: "modelica-studio-palette-group-list" });
      for (const { item, positions } of hits) {
        this.addPaletteItem(item, list, positions);
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
  /**
   * Rank library classes for the palette's search box.
   *
   * Matching runs over the class NAMES, which is cheap; only the winners are
   * resolved into drawable components, because deciding placeability means
   * walking an inheritance chain and doing it for every candidate would cost
   * about a second per keystroke.
   */
  private searchPalette(
    filter: string
  ): { hits: Array<{ item: ComponentClass; positions: number[] }>; total: number } {
    const library = this.plugin.library;
    // Excluded libraries are filtered here as well as in the index, so a
    // candidate that is excluded can never be resolved even if the index's own
    // filter were bypassed.
    const names = library.allNames().filter((n) => !library.isExcluded(n));
    const ranked = fuzzyFilter(names, filter, SEARCH_LIMIT * 3);
    const hits: Array<{ item: ComponentClass; positions: number[] }> = [];
    for (const r of ranked) {
      if (hits.length >= SEARCH_LIMIT) break;
      const item = library.component(r.name);
      if (!item || !item.hasIcon) continue;
      hits.push({ item, positions: r.positions });
    }
    return { hits, total: ranked.length };
  }

  /**
   * Draw a class name with the matched characters emphasised.
   *
   * `positions` index into the full qualified name, so the match can land in the
   * package path rather than the class name. When it does, the package is shown
   * beside the name — otherwise a fuzzy hit on the path looks like a name with
   * nothing in common with what was typed.
   */
  private renderMatchedLabel(
    label: HTMLElement,
    qualified: string,
    shortName: string,
    positions: number[]
  ): void {
    const hit = new Set(positions);
    const shortStart = qualified.length - shortName.length;
    const inPackage = positions.some((p) => p < shortStart);

    if (inPackage) {
      const pkg = qualified.slice(0, Math.max(0, shortStart - 1));
      label.createSpan({ cls: "modelica-studio-palette-path", text: pkg + "." });
    }
    for (let i = 0; i < shortName.length; i++) {
      const ch = shortName[i];
      if (hit.has(shortStart + i)) {
        label.createSpan({ cls: "modelica-studio-palette-hit", text: ch });
      } else {
        label.appendText(ch);
      }
    }
  }

  private addPaletteItem(
    item: ComponentClass,
    list: HTMLElement = this.paletteEl!,
    /** Character positions that matched, to highlight. */
    positions?: number[]
  ): void {
    const btn = list.createDiv({ cls: "modelica-studio-palette-item" });
    btn.draggable = true;
    // The row's tooltip: the class name and what it is. `aria-label` rather than
    // `title`, so it is Obsidian's tooltip and not the browser's.
    btn.setAttribute("aria-label", `${item.name}${item.comment ? ` — ${item.comment}` : ""}`);
    // Focusable, so the palette can be walked from the keyboard: it had no
    // keyboard path at all, and a row now carries a second control (the help
    // icon), which makes aiming with a mouse the only way in.
    btn.tabIndex = 0;
    btn.setAttribute("role", "button");
    this.paletteItems.push(item.name);
    const index = this.paletteItems.length - 1;
    // Placing from the keyboard needs a canvas position; the centre of the
    // visible area is the least surprising one.
    const placeFromKeyboard = () => {
      const vp = this.editor?.viewport;
      if (!vp || !this.editor) return;
      const w = this.canvasHost?.clientWidth ?? 0;
      const h = this.canvasHost?.clientHeight ?? 0;
      const inst = this.editor.addComponent(
        item.name,
        (w / 2 - vp.x) / vp.scale,
        (h / 2 - vp.y) / vp.scale
      );
      if (inst) this.setStatus(`Added ${inst.id}.`);
    };
    btn.addEventListener("keydown", (ev) => {
      const move = paletteKeyTarget(
        this.paletteItems.map((_, i) => i),
        index,
        ev.key
      );
      if (!move) return;
      ev.preventDefault();
      if (move.place) {
        placeFromKeyboard();
        return;
      }
      // Focus moves rather than a cursor being drawn: the browser already tracks
      // focus, and a second notion of "current row" would have to be kept in step.
      const all = this.paletteEl?.querySelectorAll<HTMLElement>(".modelica-studio-palette-item");
      all?.[move.next]?.focus();
    });
    btn.addEventListener("focus", () => this.setStatus(`${item.name} — press Enter to place it.`));

    const thumb = btn.createEl("canvas", { cls: "modelica-studio-palette-thumb" });
    thumb.width = THUMB_SIZE;
    thumb.height = THUMB_SIZE;
    this.drawThumbnail(thumb, item);

    // Show the matched characters, and the package the class came from when the
    // query matched the path rather than the class name — otherwise `moelreba`
    // returns a list of names with nothing visibly in common.
    const label = btn.createSpan({ cls: "modelica-studio-palette-label" });
    if (positions?.length) {
      this.renderMatchedLabel(label, item.name, item.shortName, positions);
    } else {
      label.setText(item.shortName);
    }

    // A way to read about the class BEFORE placing it. The palette is where a
    // class is chosen, so it is where someone wonders what it does; the inspector
    // only helps after the choice has been made.
    const docUrl = docUrlFor(item.name, libraryVersionFrom(this.plugin.libraryRootNames()));
    if (docUrl) {
      const help = btn.createEl("a", { cls: "modelica-studio-palette-help", href: docUrl });
      setIcon(help, "help-circle");
      // Deliberately NO title: the row's own tooltip carries the class name and
      // its description, and a nested title would replace it with less.
      help.setAttribute("aria-label", `Open the documentation for ${item.name}`);
      help.addEventListener("click", (ev) => {
        // Otherwise the click would also place the component, and the anchor
        // would navigate the Obsidian window.
        ev.preventDefault();
        ev.stopPropagation();
        openInBrowser(docUrl);
      });
      // And a drag starting on the icon should not place anything either.
      help.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    }

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
      // Accept both a palette class and a file, decided by type; the palette
      // drag carries its own type and the data is unreadable at this point.
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
    });
    host.addEventListener("drop", (ev) => {
      ev.preventDefault();
      // A file from the explorer opens; a class from the palette is placed. The
      // two are told apart by what the drag carries, because both arrive as a
      // drop on the same surface.
      const dropped = droppedVaultFile((t) => ev.dataTransfer?.getData(t) ?? "");
      if (dropped) {
        void this.plugin.loadModelFromPath(dropped);
        return;
      }
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
        ["component", "Selection"],
        ["results", "Traces"],
      ] as const) {
        const b = tabs.createEl("button", {
          cls: `modelica-studio-tab${this.inspectorTab === id ? " is-active" : ""}`,
          text: label,
        });
        // `aria-selected` is what announces which tab is showing; the class only
        // changes its colour.
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", this.inspectorTab === id ? "true" : "false");
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
    const classRow = head.createDiv({ cls: "modelica-studio-classrow" });
    classRow.createSpan({ cls: "modelica-studio-muted", text: inst.className });
    // The class name is the thing a reader wants to look up, so the link to its
    // documentation sits on it rather than in a menu.
    const url = docUrlFor(inst.className, libraryVersionFrom(this.plugin.libraryRootNames()));
    if (url) {
      const help = classRow.createEl("a", { cls: "modelica-studio-help", href: url });
      setIcon(help, "help-circle");
      // No visible text, so the accessible name has to be given. Only one of the
      // two attributes: carrying both showed a native tooltip and a styled one at
      // the same time.
      help.setAttribute("aria-label", `Open the documentation for ${inst.className}`);
      // A plain click on the anchor would navigate the Obsidian window away from
      // the app. `window.open` in Electron can open a chrome-less popup instead
      // of the browser, so the click is redirected to a synthetic anchor, which
      // goes through the same path a real external link does.
      help.addEventListener("click", (ev) => {
        ev.preventDefault();
        openInBrowser(url);
      });
    }

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
    const showLog = this.bottomTab === "log";
    if (this.plotHost) this.plotHost.style.display = showPlot ? "" : "none";
    if (this.logHost) this.logHost.style.display = showLog ? "" : "none";
    // Only the plot tab is empty without a result; the log is useful before one.
    if (this.emptyEl) {
      this.emptyEl.style.display = this.result || showLog ? "none" : "";
    }
    if (showLog) this.renderRunLog();
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
      b.setAttribute("aria-selected", id === this.bottomTab ? "true" : "false");
    }
    if (showPlot) this.drawResults();
  }

  /**
   * Draw the run log.
   *
   * The SAME text the AI is sent, deliberately: it should never be a mystery
   * what the model was given, and a paraphrase in the panel would make the
   * prompt unverifiable.
   */
  private renderRunLog(): void {
    if (!this.logText) return;
    this.logText.setText(this.plugin.runLog.toText() || "No simulations have been run yet.");
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
    if (p.comment) el.setAttribute("aria-label", p.comment);
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

    /**
     * The traces, in simulation order and never reordered.
     *
     * Checked traces used to be moved to the top, on the reasoning that the
     * selected few should not be pushed out of sight by the many. In practice it
     * moved the row out from under the pointer at the moment of the click, so
     * the next click landed on a different trace: a list that rearranges itself
     * as you use it is worse than one you have to scroll.
     *
     * The count in the header says how many are drawn, and the filter box finds
     * a variable by name, so neither needs the order to change.
     */
    const selected = this.result.series.filter((s) => this.seriesStyles[s.name]?.visible);

    const head = parent.createDiv({ cls: "modelica-studio-series-head" });
    head.createSpan({ text: `Traces (${selected.length} of ${this.result.series.length})` });
    const all = head.createEl("button", { cls: "modelica-studio-btn", text: "Clear traces" });
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
    // Simulation order, filtered — not checked-first, so a click never moves a row.
    const ordered = this.result.series.filter(matching);
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
      tabs.setAttribute("role", "tablist");
      noLabelTooltip(tabs, "Results");
      this.bottomTabEls = {};
      for (const [id, label] of [
        ["plot", "Plot"],
        ["source", "Source"],
        ["log", "Run log"],
      ] as const) {
        const b = tabs.createEl("button", { cls: "modelica-studio-tab", text: label });
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", "false");
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

      const logHost = el.createDiv({ cls: "modelica-studio-log" });
      logHost.style.display = "none";
      this.logHost = logHost;
      const logBar = logHost.createDiv({ cls: "modelica-studio-log-bar" });
      const toAi = logBar.createEl("button", { cls: "modelica-studio-btn" });
      setIcon(toAi, "sparkles");
      toAi.createSpan({ text: "Send to AI" });
      toAi.setAttribute("aria-label", "Ask the model to fix the failure, sending it the full compiler output");
      toAi.addEventListener("click", () => {
        // The whole point of the log: the model gets the compiler's own words,
        // not a paraphrase, and the editor is switched to code mode so the fix
        // lands where it can be read.
        this.setMode("code");
        this.toggleAiRow(true);
        if (this.aiInput) this.aiInput.value = "This model fails to simulate. Fix it.";
        void this.runAiRequest(true);
      });
      const copyBtn = logBar.createEl("button", { cls: "modelica-studio-btn" });
      setIcon(copyBtn, "clipboard-copy");
      copyBtn.createSpan({ text: "Copy log" });
      copyBtn.addEventListener("click", () => {
        void navigator.clipboard.writeText(this.plugin.runLog.toText());
        new Notice("Run log copied.");
      });
      const clearBtn = logBar.createEl("button", { cls: "modelica-studio-btn" });
      setIcon(clearBtn, "trash");
      clearBtn.createSpan({ text: "Clear log" });
      clearBtn.addEventListener("click", () => {
        this.plugin.runLog.clear();
        this.renderRunLog();
      });
      this.logText = logHost.createEl("pre", { cls: "modelica-studio-log-text" });
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
            text: `Press Simulate to run the model; its traces appear here. Use the Code tab to read or edit the source.`,
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
  /**
   * Clamp a requested results height to what the view can actually give.
   *
   * There was a minimum but NO maximum, so the pane could be dragged until it
   * filled the window — which pushed the grip towards the top of the screen,
   * because the grip sits on the pane's top edge. The handle then reads as being
   * "at the top" instead of at the bottom of the editing area it divides.
   *
   * Both ends of the range are derived from the live geometry rather than from
   * constants, because a small window, a large interface scale or a docked side
   * panel can each leave far less room than a fixed maximum assumes.
   */
  private clampResultsHeight(wanted: number): number {
    return clampResultsHeight(wanted, this.contentEl?.clientHeight ?? 0);
  }

  /**
   * Drive the boundary between the editing area and the results.
   *
   * The handle sits at the editing area's BOTTOM edge in diagram mode and at the
   * code editor's TOP edge in code mode, so it is the same boundary described
   * from either side — and the pane that grows is the one the handle appears to
   * belong to. In diagram mode dragging down takes space from the canvas; in code
   * mode dragging up takes it from the plot and gives it to the editor.
   *
   * The code editor's height is therefore authoritative in code mode, and the
   * results pane's in diagram mode, rather than one pane always driving the other.
   * It is stored rather than measured because a hidden pane reports zero height,
   * so the value could not be read back on a later open.
   */
  /**
   * Drag the boundary between the editing area and the results.
   *
   * The results pane always owns the height, in BOTH modes, and the editor takes
   * whatever is left. That is what keeps the editor filling its space: when the
   * code pane had a height of its own it stopped growing on a tall window and
   * left dead space below the text.
   *
   * It also makes the drag mean the same thing everywhere — down shrinks what is
   * above the boundary — and in code mode that is the same movement as growing
   * the editor below it.
   */
  /**
   * Drag the boundary between the editing area and the results.
   *
   * The grip FOLLOWS the pointer. That is the property that was missing: dragging
   * DOWN used to move the grip UP, because the arithmetic shrank the pane the
   * grip sits above. Nothing about a handle should move away from the mouse.
   *
   * Following the pointer settles which pane grows, too. The grip is on the code
   * editor's top edge in code mode, so pulling it down lowers that edge and the
   * editor gives way to the plot; pushing it up does the reverse. In diagram mode
   * the grip is at the canvas's bottom edge, so pulling it down grows the plot.
   *
   * The results pane owns the height in both modes and the editing area takes
   * whatever is left, so the editor can never be left with dead space below it.
   */
  private installResultsResize(handle: HTMLElement, pane: HTMLElement): void {
    let startY = 0;
    let startH = 0;
    const inCode = () => this.mode === "code";

    const apply = (h: number) => {
      const next = this.clampResultsHeight(h);
      pane.style.height = `${next}px`;
      // The editor is measured on screen, so its caret may need bringing back.
      if (inCode()) this.codeEditor?.revealCaret();
      else if (this.bottomTab === "plot") this.drawResults();
      return next;
    };

    const onMove = (ev: PointerEvent) => {
      // Dragging down lowers the boundary, so the pane above the grip grows.
      apply(startH + (ev.clientY - startY));
    };

    const commit = () => this.storeResultsHeight(pane.getBoundingClientRect().height);

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      handle.removeClass("is-dragging");
      commit();
    };
    handle.addEventListener("pointerdown", (ev) => {
      startY = ev.clientY;
      startH = pane.getBoundingClientRect().height;
      handle.addClass("is-dragging");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      ev.preventDefault();
    });
    // Double-click restores the default for the mode on screen. Without it a pane
    // dragged to an awkward size has to be dragged back by hand.
    handle.addEventListener("dblclick", () => {
      apply(inCode() ? CODE_RESULTS_H : DEFAULT_RESULTS_H);
      commit();
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
    this.freshModel = false;
    // A drag, a wire or a delete changes the diagram without replacing the source,
    // so the stored source no longer describes the model. Marking it stale is what
    // stops the next save writing the OLD text over the edit -- the same class of
    // bug as saving the diagram instead of the editor, in the other direction.
    this.plugin.markSourceStale();
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

  /** Log the toolbar's enabled state, so it can be checked without clicking. */
  private reportToolbar(): void {
    this.plugin.diag(
      "toolbar: " +
        describeToolbar({
          undo: this.btnUndo,
          redo: this.btnRedo,
          copy: this.btnCopy,
          paste: this.btnPaste,
          delete: this.btnDelete,
          rotate: this.btnRotate,
        }) +
        ` mode=${this.mode}`
    );
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
    // Revert needs a saved file; a model that has never been written has nothing
    // to go back to, and a button that explains that only after being pressed is
    // worse than one that is plainly unavailable.
    set(this.btnRevert, !!this.plugin.settings.modelFiles[this.plugin.model.name]);
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

  /**
   * Show the plugin's current model in both places it is displayed.
   *
   * Both, deliberately. Code mode is a view of the same model, so setting only
   * the diagram left the previous model's source on screen — asking for a new
   * model emptied the canvas while the old code sat in the editor, and the two
   * disagreed about what was being edited.
   */
  /**
   * Realise whatever the code editor holds, so a save cannot miss it.
   *
   * A repair from the AI, or a line typed and not yet applied, lives only in the
   * editor until something parses it. `applyCodeToDiagram` is what does that, and
   * it is normally triggered by Apply or Simulate — so a save that did not run it
   * wrote the previous version of the model and the fix was lost. Called before
   * every save instead of relying on the user having pressed something else first.
   *
   * Only in code mode: in diagram mode the editor is a rendering of the model, and
   * parsing it back would be a no-op at best.
   */
  /**
   * Put the saved file back, discarding everything since.
   *
   * Confirmed, because it throws away the current text with no undo. The file is
   * read fresh rather than from anything cached: the point is to get back to what
   * is ON DISK, which may have been changed outside the plugin.
   */
  async revertToSaved(): Promise<void> {
    const name = this.plugin.model.name;
    const path = this.plugin.settings.modelFiles[name];
    if (!path) {
      new Notice(`"${name}" has not been saved to a file yet, so there is nothing to revert to.`);
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`The file ${path} is not there, so there is nothing to revert to.`);
      return;
    }
    const confirmed = await confirmDiscard(
      this.app,
      `Revert "${name}"?`,
      `Everything since the last save is discarded, and the model is reloaded from ${path}.`
    );
    if (!confirmed) return;
    await this.plugin.loadModelFromPath(path);
    this.setStatus(`Reverted ${name} to ${path}.`);
  }

  flushEditorIntoModel(): void {
    if (this.mode !== "code" || !this.codeEditor) return;
    this.applyCodeToDiagram(false);
  }

  loadModelIntoEditor(): void {
    // The user asked for this model, so the canvas is meant to be empty. Without
    // this the seeding below replaced a brand-new model with an example the
    // moment it was created, and New looked like it did nothing.
    this.freshModel = true;
    this.editor?.setModel(this.plugin.model);
    // Anything derived from the previous model goes with it: a result would plot
    // traces that no longer match the source.
    this.result = null;
    this.lastSimulationError = null;
    this.clearCodeProblem();
    // The exact source when there is one, and the serialised diagram only as a
    // fallback. Rebuilding the text from the diagram loses declaration comments
    // and normalises formatting, so a model saved and reopened came back subtly
    // different from what was written -- and a user who had fixed a line would
    // find the fix apparently gone.
    if (this.codeEditor) {
      const source = this.plugin.modelSourceText();
      this.codeEditor.setValue(source.trim() ? source : serializeDiagram(this.plugin.model));
    }
    this.installDropTarget();
    this.renderInspector();
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
      anchor.setAttribute("aria-expanded", "false");
      return;
    }
    const menu = this.contentEl.createDiv({ cls: "modelica-studio-examples-menu" });
    // A menu, so a screen reader announces it as one and the arrow keys are
    // expected to work inside it.
    menu.setAttribute("role", "menu");
    noLabelTooltip(menu, "Example models");
    menu.tabIndex = -1;
    anchor.setAttribute("aria-haspopup", "menu");
    anchor.setAttribute("aria-expanded", "true");
    menu.createDiv({ cls: "modelica-studio-examples-title", text: "Example models" });
    const items: HTMLElement[] = [];

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
        item.setAttribute("role", "menuitem");
        item.tabIndex = -1;
        items.push(item);
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
    /**
     * Close the menu and hand the keyboard back to the button that opened it.
     *
     * Anything that disappears must be dismissible from the keyboard and must
     * return focus where it came from, or a keyboard user is left with focus on
     * an element that no longer exists.
     */
    const close = () => {
      menu.remove();
      anchor.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };

    const onDown = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node) && ev.target !== anchor) close();
    };

    /** Arrow keys move between examples, Enter loads one, Escape closes. */
    let active = -1;
    const highlight = (next: number) => {
      if (!items.length) return;
      active = (next + items.length) % items.length;
      items.forEach((el, i) => el.toggleClass("is-active", i === active));
      items[active]?.scrollIntoView({ block: "nearest" });
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        close();
        anchor.focus();
        return;
      }
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        highlight(active + 1);
        return;
      }
      if (ev.key === "ArrowUp") {
        ev.preventDefault();
        highlight(active - 1);
        return;
      }
      if (ev.key === "Enter" && active >= 0) {
        ev.preventDefault();
        const chosen = items[active];
        close();
        chosen.click();
      }
    };

    setTimeout(() => {
      document.addEventListener("pointerdown", onDown, true);
      document.addEventListener("keydown", onKey, true);
      // Focus the first item so the arrow keys work without a click first.
      highlight(0);
      menu.focus();
    }, 0);
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
      const clamped = clampInspectorWidth(w, root.clientWidth);
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
    // Nothing to simulate: no components, no wires, no equations. Sending this
    // to the compiler produces "Too few equations, under-determined system. The
    // model has 0 equation(s) and N variable(s)", which names the symptom and
    // not the cause. The cause is that the model has no physics at all.
    const model = this.plugin.model;
    const hasPhysics =
      model.components.length > 0 ||
      model.connections.length > 0 ||
      (model.equations?.length ?? 0) > 0;
    if (!hasPhysics) {
      const message =
        "Nothing to simulate: this model has no components, no connections and no equations.";
      this.setStatus(message);
      this.setCodeStatus(message, true);
      new Notice(`Modelica: ${message}`, 6000);
      return;
    }

    this.busy = true;
    const previous = this.statusEl?.textContent ?? "";
    this.setStatus("Simulating…");
    const t0 = performance.now();

    let source = "";
    let parameters: Record<string, string> = {};
    try {
      source = serializeDiagram(this.plugin.model);
      parameters = collectParameters(this.plugin.model);

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
      // A successful run clears the failure marker, so the tab only carries one
      // while the last run is actually broken.
      this.clearLogBadge();
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
      this.plugin.runLog.add({
        at: new Date().toISOString(),
        model: this.plugin.model.name,
        ok: true,
        source,
        parameters,
        settings: {
          startTime: this.plugin.settings.startTime,
          stopTime: this.plugin.stopTime(),
          tolerance: this.plugin.settings.tolerance,
          numberOfIntervals: this.plugin.settings.numberOfIntervals,
          solver: this.plugin.settings.solver,
        },
        detail: `${result.time.length} samples in ${wall} ms; compile ${result.compileMs} ms, simulate ${result.simulateMs} ms`,
        elapsedMs: wall,
        reused: result.reusedBinary,
      });
      this.setStatus(
        `${result.time.length} samples · compile ${result.compileMs} ms · ` +
          `simulate ${result.simulateMs} ms · total ${wall} ms` +
          (result.reusedBinary ? " · reused build" : "")
      );
    } catch (err) {
      const detail = describeFailure(err);
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus("Simulation failed.");
      this.plugin.diag(`simulation failed: ${firstLine(msg)}`, "error");
      // The WHOLE output is kept, not its first line. OpenModelica's first line
      // is usually a file path or "Internal error"; the line naming the fault
      // comes later, and a repair request built from the first line was asking
      // the model to fix a fragment.
      this.lastSimulationError = detail;
      this.plugin.runLog.add({
        at: new Date().toISOString(),
        model: this.plugin.model.name,
        ok: false,
        source,
        parameters,
        settings: {
          startTime: this.plugin.settings.startTime,
          stopTime: this.plugin.stopTime(),
          tolerance: this.plugin.settings.tolerance,
          numberOfIntervals: this.plugin.settings.numberOfIntervals,
          solver: this.plugin.settings.solver,
        },
        detail,
        elapsedMs: Math.round(performance.now() - t0),
      });
      this.setCodeStatus(firstLine(msg), true);
      new Notice(`Modelica: ${firstLine(msg)}`, 8000);
      // The Run log, and brought to the front. The message was already written
      // there; showing it AGAIN in the inspector put a compile error in a tab
      // about the selected component, which it has nothing to do with -- and left
      // the user to find the log themselves.
      this.showRunLog(firstLine(msg));
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
    // Top, height AND left, width. A height alone cannot tell a correctly laid
    // out flex row from a collapsed one: every child of a row is the same height,
    // and it was the widths that would have shown the columns sitting on top of
    // each other.
    const box = (el: Element | null | undefined): string => {
      if (!el) return "?";
      const r = el.getBoundingClientRect();
      return (
        `y${Math.round(r.top)}..${Math.round(r.bottom)}(${Math.round(r.height)})` +
        ` x${Math.round(r.left)}..${Math.round(r.right)}(${Math.round(r.width)})`
      );
    };
    const q = (sel: string) => this.contentEl.querySelector(sel);
    this.plugin.diag(
      "layout: content=" + box(this.contentEl) +
        " root=" + box(q(".modelica-studio-root")) +
        " body=" + box(q(".modelica-studio-body")) +
        " canvasHost=" + box(q(".modelica-studio-canvas-host")) +
        " canvas=" + box(q(".modelica-studio-canvas")) +
        " palette=" + box(q(".modelica-studio-palette")) +
        " inspectorSplit=" + box(q(".modelica-studio-splitter")) +
        " inspector=" + box(q(".modelica-studio-inspector")) +
        " resultsSplit=" + box(q(".modelica-studio-results-splitter")) +
        " results=" + box(q(".modelica-studio-results")) +
        " code=" + box(q(".modelica-studio-code")) +
        " status=" + box(q(".modelica-studio-status")) +
        " mode=" + this.mode +
        " bodyDisplay=" + (q(".modelica-studio-body") ? getComputedStyle(q(".modelica-studio-body")!).display : "?")
    );
  }

  /**
   * Bring the Run log to the front, and mark it as holding a failure.
   *
   * A failed run is the moment the log matters, so the tab is selected rather
   * than left for the user to find. The tab carries a marker as well, because a
   * failure is worth seeing when the log is not the tab in view.
   */
  private showRunLog(failure: string): void {
    this.bottomTab = "log";
    this.applyBottomTab();
    this.renderRunLog();
    this.setLogBadge(failure);
  }

  /** Mark the Run log tab, so a failure is visible without opening it. */
  private setLogBadge(failure: string): void {
    const tab = this.bottomTabEls?.log;
    if (!tab) return;
    tab.addClass("is-bad");
    tab.setAttribute("aria-label", `Run log — last run failed: ${failure}`);
  }

  /** Clear the marker once a run succeeds. */
  private clearLogBadge(): void {
    const tab = this.bottomTabEls?.log;
    if (!tab) return;
    tab.removeClass("is-bad");
    tab.setAttribute("aria-label", "Run log");
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
      const { path, created } = await this.plugin.saveModelToNote();
      new Notice(`Modelica: ${created ? "created" : "saved"} ${path}`, 4000);
    } catch (err) {
      new Notice(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const DEFAULT_INSPECTOR_W = 380;

/** Smallest height the results pane can be dragged to, in pixels. */

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

/**
 * Turn a simulation failure into the fullest text available.
 *
 * `SimulationError` carries structured diagnostics with line and column, which
 * the plain message does not, and OpenModelica's own output is appended when the
 * backend captured it. Sending the model a compiler message without its line
 * numbers is sending it half the information.
 */
export function describeFailure(err: unknown): string {
  const parts: string[] = [];
  if (err instanceof SimulationError) {
    parts.push(err.message);
    for (const d of err.diagnostics) {
      if (d.severity === "notification") continue;
      const where = d.line !== undefined ? ` (line ${d.line}${d.column !== undefined ? `, column ${d.column}` : ""})` : "";
      parts.push(`${d.severity}: ${d.message}${where}`);
    }
  } else {
    parts.push(err instanceof Error ? err.message : String(err));
  }
  return parts.join("\n");
}

/** Close a multi-line declaration being collected for the attribute checks. */
function finishDecl(pending: { parts: string[]; line: number }): {
  name: string;
  text: string;
  line: number;
} {
  const text = pending.parts.join(" ");
  const m = /(?:^|\s)([A-Za-z_]\w*)\s*(\(|;)/.exec(text.replace(/^\s*[A-Za-z_][\w.]*\s+/, ""));
  return { name: m?.[1] ?? "?", text, line: pending.line };
}

/** Report which toolbar actions are enabled, for the debug log. */
export function describeToolbar(buttons: Record<string, HTMLButtonElement | undefined>): string {
  return Object.entries(buttons)
    .map(([name, b]) => `${name}=${b ? (b.disabled ? "off" : "on") : "missing"}`)
    .join(" ");
}



/**
 * A yes/no dialog for an action that discards work.
 *
 * Focuses Cancel, so a stray Enter does nothing: this is the one dialog where the
 * wrong keypress loses the user's edits.
 */
function confirmDiscard(app: App, title: string, body: string): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new Modal(app);
    modal.titleEl.setText(title);
    modal.contentEl.createEl("p", { text: body });
    let answered = false;
    const done = (value: boolean) => {
      if (answered) return;
      answered = true;
      modal.close();
      resolve(value);
    };
    const buttons = modal.contentEl.createDiv({ cls: "modelica-studio-prompt-buttons" });
    const yes = buttons.createEl("button", { cls: "mod-warning", text: "Revert" });
    yes.addEventListener("click", () => done(true));
    const no = buttons.createEl("button", { text: "Cancel" });
    no.addEventListener("click", () => done(false));
    modal.onClose = () => done(false);
    modal.open();
    window.setTimeout(() => no.focus(), 0);
  });
}

/**
 * Open a URL in the user's browser rather than the Obsidian window.
 *
 * A plain click on an anchor would navigate the app window away from the studio.
 * A synthetic anchor with `target="_blank"` is how the app treats an external
 * link, and it reaches the browser; a bare `window.open` can produce a
 * chrome-less Electron popup instead.
 */
export function openInBrowser(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Give an element an accessible name that never becomes a tooltip.
 *
 * Obsidian attaches tooltips by delegation on `[aria-label]`, so any container
 * carrying a label pops one up whenever the pointer crosses its children — the
 * mode group's "Editor mode" appeared over the Diagram and Code buttons for
 * exactly that reason. A group still needs its name for a screen reader, so the
 * label stays and the tooltip is switched off with the flag Obsidian checks.
 */
export function noLabelTooltip(el: HTMLElement, name: string): void {
  el.setAttribute("aria-label", name);
  el.style.setProperty("--no-tooltip", "true");
}

/**
 * Move the palette's keyboard cursor.
 *
 * The palette had no keyboard support at all: every component had to be found and
 * dragged with a mouse. Now that each row also carries a help control, a click
 * lands on one of two things, which makes the mouse-only path worse rather than
 * better. Arrow keys move, Enter places.
 *
 * Returns true when the key was handled, so the caller does not also act on it.
 */
export function paletteKeyTarget(
  items: number[],
  active: number,
  key: string
): { next: number; place: boolean } | null {
  if (items.length === 0) return null;
  if (key === "ArrowDown" || key === "ArrowUp") {
    const step = key === "ArrowDown" ? 1 : -1;
    // Wraps, so the ends are not dead stops.
    const next = (active + step + items.length) % items.length;
    return { next, place: false };
  }
  if (key === "Home") return { next: 0, place: false };
  if (key === "End") return { next: items.length - 1, place: false };
  if ((key === "Enter" || key === " ") && active >= 0 && active < items.length) {
    return { next: active, place: true };
  }
  return null;
}
