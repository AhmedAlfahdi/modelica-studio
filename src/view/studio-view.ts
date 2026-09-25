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

import {
  App,
  ItemView,
  MarkdownView,
  Modal,
  Notice,
  Platform,
  Scope,
  setIcon,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import type ModelicaStudioPlugin from "../main";
import { SchematicEditor } from "./editor";
import { choose } from "./confirm";
import { copyText } from "./clipboard";
import { formatLint, lintModel, repairInstruction, summariseLint, type LintFinding } from "../modelica/lint";
import { overlayResults, parseSweepValues, type FamilyRun } from "./family";
import { copyCanvasImage, linkFigure, saveCanvasImage } from "./figure";
import {
  drawPlot,
  plotThemeFrom,
  seriesColor,
  summarize,
  timeAtPlotX,
  type SeriesStyle,
} from "./plot";
import { defaultSeriesNames, seriesPreset, SERIES_PRESETS, summarizeSeries } from "./series";
import type { SeriesPreset, SeriesPresetId } from "./series";
import { describeError } from "../errors";
import { collectParameters, sweepableParameters } from "./parameters";
import type { TreeNode as PackageNode } from "../modelica/library";
import { drawGraphic, portIsEnabled, substituteMacros } from "../render/canvas";
import { domainAttributes, domainOfLabel, domainOfPackage } from "../render/domains";
import { currentTheme } from "../render/theme";
import { EXAMPLES, findExample } from "../modelica/examples";
import type {
  ComponentClass,
  ComponentInstance,
  DiagramModel,
  ParameterDef,
} from "../modelica/types";
import { serializeDiagram } from "../modelica/serializer";
import { formatMatchCount, fuzzyFilter } from "../modelica/fuzzy";
import { docUrlFor, libraryVersionFrom } from "../modelica/doclinks";
import { acceptsFileDrag, droppedVaultFile } from "./drop";
import { RESULTS_TABS, resultsTabState, tabLabel, type ResultsTab } from "./bottom-tabs";
import { buildPlotActions } from "./plot-actions";
import { noLabelTooltip } from "./a11y";
import { setBusy, setButtonBusy } from "./busy";
import { describeTitle, savePrompt } from "../modelica/save-state";
import { keptSourceNote, reasonDetail, stopMessage } from "../ai/stop-message";
import { formatExchanges, formatSummary, summarise } from "../ai/interaction-log";
import { TextModal } from "./saved-models-modal";
import { SavedModelsModal } from "./saved-models-modal";
import { HelpModal } from "./help-modal";
import { SimulationError } from "../omc/backend";
import {
  CODE_RESULTS_H,
  DEFAULT_INSPECTOR_W,
  DEFAULT_PALETTE_W,
  DEFAULT_RESULTS_H,
  MIN_RESULTS_H,
  clampInspectorWidth,
  clampPaletteWidth,
  clampResultsHeight,
  sizeFromDividerDrag,
  type DividerSide,
} from "./panes";
import { checkModel, ModelProblem } from "../modelica/checks";
import { createCodeEditor, CodeEditorHandle, Diagnostic } from "./code-editor";
import { AiError, buildMessages, chat } from "../ai/client";
import { GenerationOutcome, generateModel } from "../ai/generate";
import { DEFAULT_TIMEOUT_SECONDS } from "../ai/prompts";
import type { SimResult, SimSeries } from "../omc/backend";

export const VIEW_TYPE_MODELICA = "modelica-studio-view";

/**
 * Bind Ctrl/Cmd+S to saving the model, two ways.
 *
 * Through a view SCOPE first: Obsidian's own `editor:save-file` command claims Mod+S at
 * the application level and consumes the keystroke before anything in the page sees it,
 * so a DOM listener alone does nothing — which is what shipped, and what a user found
 * by pressing it. A scope is the API for this: its bindings take precedence while the
 * view is in focus, which is how Obsidian's own editor owns the same key.
 *
 * The DOM listener stays as the fallback for a host where the page does see the key.
 * Both paths call the same save, and a save that arrives twice is harmless because the
 * second finds nothing to write.
 *
 * Exported and free-standing because the wiring is the part that was wrong: a view needs
 * a whole application to exist, and this needs a scope and an element.
 */
export function wireSaveShortcut(
  view: { scope?: unknown; app?: { scope?: unknown } },
  root: HTMLElement,
  save: () => void
): void {
  const apply = (): false => {
    save();
    return false;
  };
  try {
    const ScopeClass = Scope as unknown as new (parent?: unknown) => {
      register(modifiers: string[], key: string, func: () => false): unknown;
    };
    const scope = (view.scope as InstanceType<typeof ScopeClass> | undefined) ?? new ScopeClass(view.app?.scope);
    view.scope = scope;
    scope.register(["Mod"], "s", apply);
  } catch {
    // A host without scopes: the listener below is all there is.
  }
  root.addEventListener(
    "keydown",
    (ev) => {
      if (!isSaveShortcut(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      apply();
    },
    true
  );
}

/**
 * Is this keystroke "save"?
 *
 * A plain function so it can be tested on its own: the listener above is attached to a
 * view that needs a whole application to build, and "does Ctrl+S mean save" is the part
 * worth pinning down.
 */
export function isSaveShortcut(ev: { key?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
  const mod = ev.ctrlKey === true || ev.metaKey === true;
  // Alt is excluded: Ctrl+Alt+S is somebody else's shortcut on Windows.
  return mod && ev.altKey !== true && (ev.key === "s" || ev.key === "S");
}

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
  /** Watches the view, so every pane's ceiling tracks the window. */
  private resultsReclamp: ResizeObserver | undefined;
  /** Guards the one settled layout reading, so a resize does not spam the log. */
  private settledLayoutLogged = false;
  /** The palette's divider. */
  private paletteSplitterEl: HTMLElement | undefined;
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
  /**
   * The buttons that start a compile or a check, in both toolbars.
   *
   * Kept so their icons can turn while the work is in flight: one button per mode
   * exists at a time, and the hidden one costs nothing.
   */
  private runBtns: HTMLElement[] = [];
  private checkBtns: HTMLElement[] = [];
  private modeButtons: Record<string, HTMLElement> = {};
  private statusEl!: HTMLElement;
  private titleNameEl?: HTMLElement;
  private titleFileEl?: HTMLElement;
  private titleStateEl?: HTMLElement;
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
  /**
   * Which preset narrows the variable list.
   *
   * Kept like the filter text, rather than reset per run: someone working through
   * a model's derivatives wants that again after the next simulation.
   */
  private seriesPreset: SeriesPresetId = "all";
  /**
   * The variables that change over the run, for the "Varying" preset.
   *
   * Cached against the result object: `summarizeSeries` walks every sample of
   * every variable, and the list is rebuilt on every keystroke in the filter.
   */
  private varyingCache: { result: SimResult | null; names: Set<string> } = {
    result: null,
    names: new Set(),
  };
  /**
   * Where the reader had scrolled to in the variable list.
   *
   * The list is rebuilt on every check, and a fresh element starts at the top:
   * clicking the thirtieth trace threw the list back to the first, so every box
   * after it had to be found again. Kept here rather than read back off the
   * element, which is gone by the time the next one is built.
   */
  private seriesScroll = 0;

  /**
   * Take a result as the one being shown.
   *
   * The list of traces describes a different set of variables after this, so the
   * reader's place in the old one means nothing: it is reset here rather than at
   * each of the four places a result arrives or goes away.
   */
  private adoptResult(result: SimResult | null): void {
    this.result = result;
    this.seriesScroll = 0;
  }

  /**
   * Drop the sweep family and the label that goes with it.
   *
   * A `FamilyRun` holds another model's `SimResult`, and `paint` folds every run
   * in unconditionally — a name the current model does not have defaults to
   * visible in one shared colour. Nothing cleared it on a model change, so opening
   * B after sweeping A drew A's curves, dashed and in A's colour, inside B's plot
   * and let them set B's y extent. A family is cleared by its own button, by a
   * sweep, and now by the model changing under it.
   */
  private forgetFamily(): void {
    this.family = [];
    this.lastSweep = null;
  }
  /** Which bottom tab is showing. */
  private bottomTab: ResultsTab = "plot";
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
  /**
   * Whether the scale panel is open, as a decision rather than as a style.
   *
   * It used to be read back off `display`, and the pane's own layout pass set
   * that to "" whenever the panel had content — so closing it, then changing a
   * trace (which re-renders the pane), opened it again. Reported as "the scale
   * button keeps appearing if I change traces".
   */
  private scaleOpen = false;
  private scaleInputs: Array<() => void> = [];

  private result: SimResult | null = null;
  private seriesStyles: Record<string, SeriesStyle> = {};
  /**
   * Runs drawn behind the current one: a sweep's members, and any run kept with
   * "Keep as before". One list, because they are one picture.
   */
  private family: FamilyRun[] = [];
  /**
   * What the family's current run was made with, so the legend can name it.
   *
   * Cleared by a plain run: after Simulate the run on screen is not the sweep's
   * last value any more, and labelling it as if it were is worse than not
   * labelling it at all.
   */
  private lastSweep: { parameter: string; value: string } | null = null;
  /** The sweep controls as they were left, so a rebuild does not blank them. */
  private sweepField = { parameter: "", values: "" };
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
    // The model's name, so the tab, the view switcher and anything else Obsidian labels
    // says which model this is rather than which plugin it belongs to.
    return this.plugin.model?.name ? `Modelica Studio — ${this.plugin.model.name}` : "Modelica Studio";
  }

  getIcon(): string {
    return "circuit-board";
  }

  async onOpen(): Promise<void> {
    const openStart = performance.now();
    const root = this.contentEl;
    root.empty();
    root.addClass("modelica-studio-root");

    wireSaveShortcut(this, root, () => void this.saveWithConflictCheck());

    // Which model, in which file, and whether the file has the edits. Nothing said any of
    // this before: the tab read "Modelica Studio" and the toolbar is all buttons.
    const title = root.createDiv({ cls: "modelica-studio-title" });
    this.titleNameEl = title.createSpan({ cls: "modelica-studio-title-name" });
    this.titleFileEl = title.createSpan({ cls: "modelica-studio-title-file" });
    this.titleStateEl = title.createSpan({ cls: "modelica-studio-title-state" });
    this.refreshTitle();

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
    // The index is parsed in the background and the palette is empty until it
    // arrives — for a second or two on a first launch, with nothing saying why.
    if (!this.plugin.hasLibrary) setBusy(this.paletteEl, true);

    // The palette is resizable too. It was the one pane with no divider, so its
    // width was a constant and a long class name in the list was cut off with no
    // way to widen the column.
    const paletteDivider = this.makeDivider(body, "x", "Component palette");
    this.paletteSplitterEl = paletteDivider;

    // Canvas
    this.canvasHost = body.createDiv({ cls: "modelica-studio-col modelica-studio-canvas-host" });

    // Inspector + results, with a draggable divider so the parameters can be read.
    const splitter = this.makeDivider(body, "x", "Inspector");
    this.splitterEl = splitter;
    const rightCol = body.createDiv({ cls: "modelica-studio-col modelica-studio-inspector" });
    this.inspectorCol = rightCol;
    this.inspectorTabsEl = rightCol.createDiv({ cls: "modelica-studio-tabs" });
    this.inspectorTabsEl.setAttribute("role", "tablist");
    // Named for a screen reader, but not a tooltip: a tab strip's label would
    // otherwise appear over every tab in it.
    noLabelTooltip(this.inspectorTabsEl, "Inspector");
    this.inspectorEl = rightCol.createDiv({ cls: "modelica-studio-inspector-body" });
    // The inspector is to the RIGHT of its divider, so dragging left widens it.
    this.installDivider({
      el: splitter,
      axis: "x",
      side: () => "after",
      pane: rightCol,
      apply: (w) => this.applyInspectorWidth(w),
      reset: () => DEFAULT_INSPECTOR_W,
    });
    // The palette is to the LEFT of its divider, so dragging right widens it.
    this.installDivider({
      el: paletteDivider,
      axis: "x",
      side: () => "before",
      pane: paletteCol,
      apply: (w) => this.applyPaletteWidth(w),
      reset: () => DEFAULT_PALETTE_W,
    });

    // Results get their own pane across the window rather than a slot inside the
    // inspector. In a 380px column a plot is unreadable, and the legend covers
    // half the traces; spanning the window is what makes it legible.
    // The grip goes BEFORE the pane, so it renders on the pane's TOP edge: the
    // boundary between the diagram and the results, which is the line it moves.
    //
    // It used to go after the pane, which put it on the pane's BOTTOM edge. That
    // is still "a handle for the results pane", but it sits against the status bar
    // at the far end of the window -- nowhere near the diagram it divides, and easy
    // to miss. The editing area is ABOVE the results, so the top edge is the shared
    // boundary and the bottom edge is the window's own.
    const resultsSplitter = this.makeDivider(root, "y", "Results");
    const resultsCol = root.createDiv({ cls: "modelica-studio-results" });
    // Restore the height the user dragged it to, so the choice survives a
    // reload rather than resetting to the default every time.
    //
    // Floored but NOT ceilinged here. The ceiling depends on how tall the view is,
    // and the view has not been laid out yet: `contentEl.clientHeight` is not the
    // window's height at this point, so clamping against it shrank a stored 309px
    // pane to 274 and applied that permanently -- the pane came back the wrong
    // size on every launch, and the mode switch that would have corrected it only
    // runs when the mode CHANGES. `installResultsReclamp` applies the real ceiling
    // as soon as there is a real height to apply it against.
    const storedH = this.storedResultsHeight();
    if (storedH > 0) {
      resultsCol.style.height = `${Math.max(MIN_RESULTS_H, storedH)}px`;
    }
    this.resultsEl = resultsCol;
    this.resultsResize = resultsSplitter;
    // The results are BELOW their divider, so dragging down makes the pane shorter.
    this.installDivider({
      el: resultsSplitter,
      axis: "y",
      // The plot is BELOW its divider in diagram mode (the divider draws the
      // boundary with the canvas) and ABOVE it in code mode (the divider draws
      // the boundary with the editor), so the sign follows the mode.
      side: () => (this.mode === "code" ? "before" : "after"),
      pane: resultsCol,
      apply: (h) => this.applyResultsHeight(h),
      reset: () => (this.mode === "code" ? CODE_RESULTS_H : DEFAULT_RESULTS_H),
    });
    this.installPaneReclamp();

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
      // Ctrl+Enter in diagram mode, as Help and the toolbar document it.
      onRun: () => void this.runSimulation(),
      resolveParam: (inst, name) => this.resolveInstanceParam(inst, name),
      // Read per frame rather than captured, so a settings change shows on the
      // next redraw instead of after the editor is rebuilt.
      display: () => {
        return {
          labelScale: this.plugin.settings.labelScale,
          instanceLabels: this.plugin.settings.showInstanceLabels,
          dynamicLabels: this.plugin.settings.dynamicLabels,
          hoverParameters: this.plugin.settings.hoverParameters,
          readoutScale: this.plugin.settings.diagramReadoutScale,
          wireScale: this.plugin.settings.wireScale,
          symbolStrokeScale: this.plugin.settings.symbolStrokeScale,
          // The editor applies the link, so both surfaces cannot disagree.
          syncStrokeScale: this.plugin.settings.syncStrokeScale,
        };
      },
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
    // The mode buttons are drawn with `aria-pressed="false"` and the active one is
    // shown ONLY by that attribute and `.is-active`, both written by
    // `syncToolbarToMode` -- which ran on a mode CHANGE. So every open in the
    // default diagram mode looked like neither button was selected, until Code and
    // Diagram were pressed once.
    this.syncToolbarToMode();
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
    // A model of only variables — `DampedBounce`, a pure equation model — is
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
    // A menu left open when the view closes must not leave its document handlers
    // behind for the rest of the session.
    this.exampleMenuClose?.();
    this.resultsReclamp?.disconnect();
    this.resultsReclamp = undefined;
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
      cls = "",
      iconOnly = false
    ) => {
      const b = parent.createEl("button", {
        cls: `modelica-studio-btn ${cls} ${iconOnly ? "is-icon-only" : ""}`.trim(),
      });
      setIcon(b, icon);
      if (!iconOnly) {
        // The visible label IS the accessible name, so no aria-label: Obsidian
        // renders one from it, and having both attributes showed two tooltips in
        // two different styles.
        b.createSpan({ text: label });
      }
      // `aria-label` is the ONLY attribute Obsidian renders a tooltip from -- its
      // handler reads `aria-label` and never `title`. Setting `title` as well drew
      // the browser's native tooltip on top of Obsidian's, which is the overlap.
      //
      // Without a visible label it is also the ACCESSIBLE NAME, which is why every
      // hint on an icon-only button begins with the action rather than with the
      // consequence: a reader who cannot see the icon should hear "Zoom in", not
      // "Enlarge the diagram".
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
      void this.saveWithConflictCheck()
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
    this.runBtns.push(
      addBtn(
        run,
        "play",
        "Simulate",
        `Compile and run the model (${mod}+Enter)`,
        () => void this.runSimulation(),
        "mod-cta"
      )
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
    // Icon only: these are the six every editor has, and the words cost more width
    // than they earn once the icons are learned. The name survives in the tooltip
    // and in the accessible label.
    const edit = addGroup(bar, "Edit", "diagram");
    const ICON_ONLY = true;
    this.btnUndo = addBtn(edit, "undo-2", "Undo", `Undo (${mod}+Z)`, () => this.editor?.undo(), "", ICON_ONLY);
    this.btnRedo = addBtn(edit, "redo-2", "Redo", `Redo (${mod}+Shift+Z)`, () => this.editor?.redo(), "", ICON_ONLY);
    this.btnCopy = addBtn(edit, "copy", "Copy", `Copy the selection (${mod}+C)`, () => this.editor?.copy(), "", ICON_ONLY);
    this.btnPaste = addBtn(
      edit,
      "clipboard-paste",
      "Paste",
      `Paste (${mod}+V)`,
      () => void this.editor?.paste(),
      "",
      ICON_ONLY
    );
    this.btnDelete = addBtn(
      edit,
      "trash",
      "Delete",
      "Delete the selected components (Del or Backspace)",
      () => this.editor?.deleteSelection(),
      "",
      ICON_ONLY
    );
    this.btnRotate = addBtn(
      edit,
      "rotate-cw",
      "Rotate",
      "Rotate the selection a quarter turn clockwise (R, or Shift+R anticlockwise)",
      () => this.editor?.rotateSelection(90),
      "",
      ICON_ONLY
    );

    // ---- View: diagram only ----
    const view = addGroup(bar, "View", "diagram");
    // The wheel zooms about the pointer with no modifier, so the tooltip says
    // scroll rather than inventing a chord for it.
    addBtn(
      view,
      "zoom-in",
      "Zoom in",
      "Zoom in: enlarge the diagram, or scroll up over the canvas",
      () => this.editor?.zoomBy(1.25),
      "",
      ICON_ONLY
    );
    addBtn(
      view,
      "zoom-out",
      "Zoom out",
      "Zoom out: shrink the diagram, or scroll down over the canvas",
      () => this.editor?.zoomBy(0.8),
      "",
      ICON_ONLY
    );
    addBtn(
      view,
      "maximize",
      "Fit to view",
      `Fit to view: the whole diagram in the canvas (${mod}+0)`,
      () => this.editor?.scheduleFit(),
      "",
      ICON_ONLY
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
      group.toggleClass("modelica-studio-hidden", diagramOnly && isCode);
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
    const host = root.createDiv({ cls: "modelica-studio-code modelica-studio-hidden" });
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
      const path = droppedVaultFile((t) => ev.dataTransfer?.getData(t) ?? "", this.plugin.settings.modelFolder);
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

    this.runBtns.push(
      mk("play", "Simulate", "Compile and run the source in the editor (Ctrl+Enter)", () =>
        void this.runSimulation()
      )
    );
    mk("git-compare", "Apply to diagram", "Re-parse the source and rebuild the schematic", () =>
      this.applyCodeToDiagram(true)
    );
    mk("sparkles", "AI", "Describe what you want, or ask for a repair", () => this.toggleAiRow());
    this.checkBtns.push(
      mk(
        "clipboard-check",
        "Check",
        "Look for wiring mistakes and ask the compiler about the model, without running it",
        () => void this.checkModel()
      )
    );

    const diagEl = bar.createDiv({ cls: "modelica-studio-code-diag" });
    this.codeDiagEl = diagEl;

    // The AI request row, hidden until asked for.
    const aiRow = host.createDiv({ cls: "modelica-studio-ai modelica-studio-hidden" });
    aiRow.setAttribute("role", "group");
    noLabelTooltip(aiRow, "Generate a model with AI");
    this.aiRow = aiRow;

    const input = aiRow.createEl("input", {
      cls: "modelica-studio-ai-input",
      attr: {
        type: "text",
        placeholder: "A tank draining through an orifice, 2 m of water",
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
    stop.addClass("modelica-studio-hidden");
    stop.addEventListener("click", () => {
      this.aiCancel = true;
      // Interrupt the call, not just the loop: the loop only looks at the flag
      // between attempts, and the attempt in flight can be minutes long.
      this.aiAbort?.abort();
      stop.setAttribute("disabled", "true");
      this.setAiProgress("Stopping…");
    });
    this.aiStopBtn = stop;

    // A way into the log from the row that reports the failure. The summary line
    // can only carry so much, and "the same problem came back" is not actionable
    // without the problem -- which is exactly what the log holds.
    const logBtn = aiRow.createEl("button", { cls: "modelica-studio-btn" });
    setIcon(logBtn, "file-text");
    logBtn.createSpan({ text: "Prompt log" });
    logBtn.setAttribute(
      "aria-label",
      "What was sent to the AI and what came back, with the reason each attempt was rejected"
    );
    logBtn.addEventListener("click", () => this.showAiLog());
    this.aiLogBtn = logBtn;

    const progress = aiRow.createDiv({ cls: "modelica-studio-ai-progress modelica-studio-hidden" });
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
  /** Opens the AI exchange log, from the row that reports the failure. */
  private aiLogBtn: HTMLButtonElement | null = null;
  /**
   * Aborts the request in flight.
   *
   * `aiCancel` alone was not enough: it is only read BETWEEN attempts, and one
   * attempt is one HTTP call that can legitimately take minutes. Pressing Stop
   * therefore did nothing at all until the call returned on its own, which is what
   * "press stop it wont stop" was. This reaches into the call itself.
   */
  private aiAbort: AbortController | null = null;
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
    // Through the class, not an inline style. The panes are BUILT with the class --
    // the code pane is created hidden by it -- so the state after the first paint and
    // the state after a switch have to be the same mechanism, or they disagree: an
    // inline `display: ""` cannot re-hide an element whose class has been overridden
    // by its own layout rule, and clearing an inline style cannot reveal one whose
    // class still applies.
    this.bodyEl?.toggleClass("modelica-studio-hidden", isCode);
    this.codeHost?.toggleClass("modelica-studio-hidden", !isCode);
    this.syncToolbarToMode();
    // Before the height is applied: the divider's side is read from the mode, so
    // it has to be on the right boundary first.
    this.positionResultsDivider();
    this.applyModeResultsHeight(isCode);
    if (isCode) {
      this.codeEditor?.focus();
      this.validateCode();
    } else {
      // Belt and braces. The canvas and the inspector must be describing the
      // same object; any path that swaps one without the other is a bug, and the
      // symptom is silent -- an inspector with no fields for EVERY component.
      // Re-established here rather than only trusted.
      if (this.editor && this.editor.currentModel !== this.plugin.model) {
        this.editor.setModel(this.plugin.model);
      }
      this.editor?.requestDraw();
    }
    this.setStatus(isCode ? "Code mode. Ctrl+Space completes, Ctrl+Enter simulates." : "Diagram mode.");
    // Reported per mode change, because the results divider MOVES between the
    // plot's two edges and "the pane is the wrong size" is a per-mode question.
    // The one-shot settled reading runs before the stored mode is restored, so it
    // reports the other mode's geometry.
    this.reportLayout(mode);
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
      this.codeHost.setCssStyles({ flex: "", height: "" });
    }
    // Only the results pane carries a height. Code mode starts it small, because
    // there a plot is a reference rather than the subject.
    const stored = isCode ? this.plugin.settings.codePlotHeight : this.plugin.settings.plotHeight;
    const fallback = isCode ? CODE_RESULTS_H : DEFAULT_RESULTS_H;
    this.resultsEl.style.height = `${this.clampResultsHeight(stored > 0 ? stored : fallback)}px`;
    if (this.bottomTab === "plot") this.drawResults();
  }

  /**
   * Keep every pane inside a view that may have changed size.
   *
   * The sizes are restored before the view is laid out, so they cannot be clamped
   * against the window at that point, and nothing re-clamped them afterwards: a
   * layout chosen on a wide monitor kept its widths on a narrow one until the
   * diagram had nowhere to draw.
   */
  private installPaneReclamp(): void {
    if (!this.contentEl || typeof ResizeObserver === "undefined") return;
    let lastW = 0;
    let lastH = 0;
    const observer = new ResizeObserver(() => {
      const w = this.contentEl?.clientWidth ?? 0;
      const h = this.contentEl?.clientHeight ?? 0;
      // Only on a real change. Re-applying on every callback would fight the
      // observer it was triggered by.
      if (w <= 0 || h <= 0 || (w === lastW && h === lastH)) return;
      lastW = w;
      lastH = h;
      // Each pane is clamped against the CURRENT width of the others, so a
      // combination that no longer fits is brought back in without any of them
      // being reset to a default.
      this.applyResultsHeight(this.resultsEl?.getBoundingClientRect().height ?? 0);
      this.applyPaletteWidth(this.plugin.settings.paletteWidth || DEFAULT_PALETTE_W);
      this.applyInspectorWidth(this.plugin.settings.inspectorWidth || DEFAULT_INSPECTOR_W);
      this.afterPaneResize();
      // The probe in `onOpen` runs before the panes are laid out and reports zeros
      // for the body, which is the line you most want when a pane is the wrong
      // size. This is the same reading once there is something to measure.
      if (!this.settledLayoutLogged) {
        this.settledLayoutLogged = true;
        this.reportLayout("settled");
      }
    });
    observer.observe(this.contentEl);
    this.resultsReclamp = observer;
  }

  /**
   * Apply a pane size, clamped, and remember it.
   *
   * One place per pane, so the drag, the double-click reset and the re-clamp all
   * go through the same arithmetic -- three callers writing a width three ways is
   * how they came to disagree.
   *
   * `remember` is what separates a size the USER chose from one the CLAMP produced.
   * The re-clamp runs whenever the view changes size, so writing its result back
   * turned a moment of narrowness into a permanent choice: the palette came back
   * 194px wide, a number nobody ever asked for, because some earlier layout had
   * been narrower. Only a gesture persists.
   */
  private applyResultsHeight(h: number, remember = false): number {
    const next = clampResultsHeight(h, this.contentEl?.clientHeight ?? 0);
    if (this.resultsEl) this.resultsEl.style.height = `${next}px`;
    if (remember) this.storeResultsHeight(next);
    return next;
  }

  private applyInspectorWidth(w: number, remember = false): number {
    const next = clampInspectorWidth(
      w,
      this.contentEl?.clientWidth ?? 0,
      this.plugin.settings.paletteWidth || DEFAULT_PALETTE_W
    );
    this.contentEl?.style.setProperty("--ms-inspector-width", `${next}px`);
    if (remember) this.plugin.settings.inspectorWidth = next;
    return next;
  }

  private applyPaletteWidth(w: number, remember = false): number {
    const next = clampPaletteWidth(
      w,
      this.contentEl?.clientWidth ?? 0,
      this.plugin.settings.inspectorWidth || DEFAULT_INSPECTOR_W
    );
    this.contentEl?.style.setProperty("--ms-palette-width", `${next}px`);
    if (remember) this.plugin.settings.paletteWidth = next;
    return next;
  }

  /**
   * Put the results divider on the boundary that is on screen.
   *
   * The pane it sizes has the canvas above it in diagram mode and the code editor
   * below it in code mode, so "the edge of the results pane" is a different edge in
   * each. Leaving it before the pane put the grip directly under the toolbar in
   * code mode -- attached to the pane, but nowhere near the plot/editor boundary it
   * controls, which is the one a reader looks for.
   *
   * Still ONE divider. A second handle on the same boundary was tried before and
   * gave two grips dragging in opposite directions.
   */
  private positionResultsDivider(): void {
    const splitter = this.resultsResize;
    const results = this.resultsEl;
    if (!splitter || !results) return;
    const wantAfter = this.mode === "code";
    const isAfter = results.nextElementSibling === splitter;
    if (wantAfter === isAfter) return;
    if (wantAfter) results.insertAdjacentElement("afterend", splitter);
    else results.insertAdjacentElement("beforebegin", splitter);
  }

  /**
   * Re-measure after any pane changes size.
   *
   * The canvas is sized from the DOM, so it has to be told or it keeps drawing at
   * the old width and the diagram appears clipped.
   */
  private afterPaneResize(): void {
    this.editor?.resize();
    this.drawResults();
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
      // The SOURCE when it is current, and the diagram only when it is not.
      //
      // This is the last place the lossy serializer was still winning: switching
      // into code mode rebuilt the text from the diagram, so the comments and
      // formatting that were on disk were replaced by the normalised form the
      // moment the editor appeared. Loading a model correctly and then showing
      // code mode therefore threw the file's text away -- the save had worked, and
      // the screen said otherwise.
      //
      // `sourceForSave` is the same rule saving uses, so the two cannot disagree
      // about which representation is the truth.
      text = this.plugin.sourceForSave();
    } catch (err) {
      text = `// The source could not be produced:\n// ${String(err)}\n`;
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
      this.codeBaseline = text;
      return;
    }
    if (this.codeEditor.getValue() !== text) {
      // A NEW document: the pane's undo history belongs to the one being replaced.
      this.codeEditor.setValue(text, { resetHistory: true });
    }
    this.codeBaseline = text;
  }

  /**
   * Parse the editor's text into the model.
   *
   * `announce` separates the two callers: switching modes should say so, while
   * a background change should stay quiet unless it failed.
   */
  /**
   * Adopt the pane's text as the model.
   *
   * Returns FALSE when the text could not be parsed, which is the answer the SAVE
   * path needs: without it, `saveModelToNote` wrote `sourceForSave()` -- still the
   * previous text -- and reported "Saved", so an edit that did not parse was
   * silently dropped and gone on the next open.
   */
  private applyCodeToDiagram(announce: boolean): boolean {
    if (!this.codeEditor) return true;
    const text = this.codeEditor.getValue();
    // The pane has not been touched since it was filled. Adopting it would replace
    // the diagram with the text we put there -- which on a MODE SWITCH cleared the
    // diagram's undo history for no reason (add a component, press Code and Diagram,
    // and Undo was dead), and, when a diagram edit could not be written into the
    // source, discarded that edit on the way into code mode.
    if (text === this.codeBaseline) return true;
    try {
      const model = this.plugin.parseSource(text);
      if (!model) {
        this.reportCodeProblem("The source declares no model class.", []);
        return false;
      }
      this.plugin.adoptModel(model, text);
      this.clearCodeProblem();
      this.editor?.setModel(model);
      this.editor?.scheduleFit();
      if (announce) this.setStatus(`Diagram rebuilt from source (${model.components.length} components).`);
      return true;
    } catch (err) {
      this.reportCodeProblem(String(err), []);
      return false;
    }
  }

  /** Parse and report, without touching the diagram. */
  private validateCode(): void {
    if (!this.codeEditor) return;
    // Only while the pane is on screen. The editor debounces this by 250 ms, and the
    // debounce is not cancelled by a mode switch -- so typing in code mode and then
    // pressing an arrow key in diagram mode let the pending validation re-parse the
    // OLD text and adopt it over the diagram edit that had just been made.
    if (this.mode !== "code") return;
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
      // The same object into the editor. Adopting into the plugin alone is what
      // left the canvas drawing one model while the inspector read another.
      this.editor?.adoptModel(model);

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
      // The terminator set includes `=`, or a declaration with a BINDING was not
      // recognised at all: `parameter Real g = 9.81;` fell through to the pending
      // block that the class header opened, so the block's name came out as "?" and
      // its text as `model M   parameter Real g = 9.81;`. `checks.ts` then built a
      // RegExp from that name -- `/\b?\s*\(…/` -- which throws "Nothing to repeat",
      // and the throw was reported as the model's diagnostic on line 1 while every
      // real finding was suppressed. A parameter-first model is the most common
      // layout there is, including the text this plugin's own serializer emits.
      const decl = /^\s*(?:parameter|constant|discrete|input|output|final|inner|outer|flow|stream|replaceable|each|\s)*([A-Za-z_][\w.]*)\s+([A-Za-z_]\w*)\s*(\(|;|=|$)/.exec(line);
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
    const logged = direct ? undefined : this.plugin.runLog.lastFailure();
    const base = direct ?? logged?.detail ?? this.codeDiagEl?.getText()?.trim() ?? "";
    // The findings are appended rather than substituted: a model can both fail to
    // compile AND have two blocks wired to nothing, and the second explains the
    // first ("variable p has no remaining equation").
    const findings = this.lintFindings();
    if (findings.length === 0) return base;
    const section = `The diagram has a problem the compiler does not report: ${summariseLint(findings)}`;
    return base ? `${base}\n\n${section}` : section;
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
    // The class is the state, so it is also what is asked -- the row is created
    // hidden, and reading a style back would call that "shown".
    const show = force ?? this.aiRow.hasClass("modelica-studio-hidden");
    this.aiRow.toggleClass("modelica-studio-hidden", !show);
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

    const prompt = repair ? repairInstruction(this.lintFindings()) : (this.aiInput?.value.trim() ?? "");
    if (!prompt) {
      this.setStatus("Describe the model you want first.");
      this.aiInput?.focus();
      return;
    }

    const original = this.codeEditor?.getValue() ?? "";

    this.aiBusy = true;
    this.aiCancel = false;
    // The controller is created HERE, not when the loop reports a later phase.
    // It used to be made inside `onProgress` for every phase except "asking" --
    // and "asking" is the first phase, so the first request was sent with no
    // signal at all: Stop reached nothing and the user waited out the provider's
    // timeout, which is the exact failure the abort was added to fix.
    this.aiAbort = new AbortController();
    // The wait that most needs saying: a request can legitimately take minutes,
    // and the text beside it is a countdown the eye has to read. The bar is on the
    // element that already exists to report the run, and the button that started
    // it turns while it waits.
    const pressed = repair ? this.aiFixBtn : this.aiGoBtn;
    // On the ROW, not on the progress text: the text is a short element at the end
    // of the row, and a bar across it reads as a line drawn over the sentence. The
    // row is the full width of the panel and has no absolutely positioned children,
    // so `position: relative` from the busy class moves nothing.
    setBusy(this.aiRow, true);
    setButtonBusy(pressed, true, repair ? "wrench" : "sparkles");
    this.aiGoBtn?.setAttribute("disabled", "true");
    this.aiFixBtn?.setAttribute("disabled", "true");
    this.aiStopBtn?.removeClass("modelica-studio-hidden");
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
        // The library's verdict on what is a component, so a type declaration is
        // not mistaken for an unwired block.
        isComponent: (name) => this.plugin.isComponentClass(name),
        // The signal, so Stop reaches the request instead of waiting for it.
        send: (messages) =>
          chat(cfg, messages, () => this.plugin.aiKey(), this.aiAbort?.signal),
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
        onExchange: (exchange) => this.plugin.appendAiExchange(exchange),
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
            // The clock restarts per phase; the controller lives for the whole run.
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
        this.aiStopBtn.addClass("modelica-studio-hidden");
        this.aiStopBtn.removeAttribute("disabled");
      }
      this.aiCancel = false;
      this.aiAbort = null;
      // In the `finally`, so a request that fails, is stopped, or times out leaves
      // nothing running.
      setBusy(this.aiRow, false);
      setButtonBusy(this.aiGoBtn, false, "sparkles");
      setButtonBusy(this.aiFixBtn, false, "wrench");
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
      this.codeEditor?.setValue(outcome.source, { resetHistory: true });
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
      // And then offer to keep it. Nothing else distinguishes "it ran" from "it is
      // saved", so the run succeeds, the status says "Ready", and the model is
      // only in memory -- which is exactly how a repair came to be lost after a
      // restart. Asked rather than saved silently: writing a file is the user's
      // decision, and a folder quietly filling with models is its own problem.
      void this.offerToSave(`"${name ?? "the model"}" compiled`);
      // Done. Falling through to the failure path below re-applied the same
      // source and overwrote the state it had just set.
      return;
    }

    // Nothing usable. The last attempt is kept in the editor so the failure can
    // be read, but only when it is different from what was there.
    if (outcome.source && outcome.source !== original) {
      this.codeEditor?.setValue(outcome.source, { resetHistory: true });
      this.applyCodeToDiagram(false);
    }
    this.lastSimulationError = outcome.attempts[outcome.attempts.length - 1]?.failure ?? null;

    // A model that BUILT and was rejected is not a model that failed to build:
    // it compiles, it is in the editor, and pressing Simulate runs it. Saying
    // "gave up" about it is what made a working model look broken.
    const why = stopMessage(outcome.reason, outcome.message, attempts);
    const kept = outcome.source && outcome.source !== original ? keptSourceNote(outcome.builds) : "";

    // The REASON, not just the loop's description of it. "The same problem came
    // back" says nothing a reader can act on, and the check that rejected the model
    // said exactly what was wrong.
    const last = outcome.attempts[outcome.attempts.length - 1];
    const because = reasonDetail(last?.failure);
    const tail = [because, outcome.message, kept].filter(Boolean).join(" ");
    this.setAiProgress(`${why} ${tail}`.trim());
    this.setStatus(`AI: ${why} ${kept || "See the Run log for the compiler output."}`.trim());
    // The panel line is one line; the full reason goes to the log, where it can be
    // read and copied.
    if (because) this.plugin.diag(`ai stopped: ${why} Reason: ${last?.failure}`, "warn");
    new Notice(`Modelica AI: ${why}`, 8000);
  }

  /**
   * Show that time is passing, and for how long.
   *
   * The label is kept and only the elapsed part is replaced, so a phase change
   * does not fight the clock.
   */
  /**
   * Show what was sent to the AI and what came back.
   *
   * Reachable from the AI row because the summary line can only carry so much: a
   * reader told "the same problem came back" has no way to find out what the
   * problem was, and the log is where it is written down.
   */
  private showAiLog(): void {
    const exchanges = this.plugin.readAiExchanges();
    const summary = formatSummary(summarise(exchanges), exchanges.slice(-15));
    const detail = formatExchanges(exchanges);
    const text = detail ? `${summary}\n\n${"-".repeat(72)}\n\n${detail}` : summary;
    new TextModal(this.app, "AI prompt log", text).open();
  }

  private tickAiProgress(model: string): void {
    if (!this.aiProgressEl) return;
    const seconds = Math.round((Date.now() - this.aiStartedAt) / 1000);
    const base = this.aiPhase || `Asking ${model}`;
    const limit = this.plugin.settings.ai.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
    const left = Math.max(0, limit - seconds);
    // The thinking level is named while a request runs, because it is the one
    // setting that decides whether the wait is seconds or minutes and nothing
    // else on screen says so. A clock that climbs for five minutes with no
    // explanation is indistinguishable from a hang.
    const thinking = this.plugin.settings.ai.thinking ?? "off";
    const why = thinking === "off" ? "" : `, thinking=${thinking}`;
    this.aiProgressEl.setText(
      `${base} — ${seconds}s${why} (gives up at ${limit}s, ${left}s left)`
    );
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
    this.aiProgressEl.removeClass("modelica-studio-hidden");
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
        // Worded by `formatMatchCount`, which says MATCHES rather than leaving a
        // bare "200 of 434" that reads as a component count.
        text: formatMatchCount(hits.length, total),
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
      // The package name carries its domain's colour, so the palette reads as
      // physics rather than as a directory listing. A span rather than the head
      // itself, so anything else added to the row stays in the normal colour.
      head.createSpan({
        ...domainAttributes(domainOfPackage(root)),
        text: shortPackage(root),
      });
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
    list: HTMLElement = this.paletteEl,
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
    // Placing from the keyboard needs a canvas position; the centre of the
    // visible area is the least surprising one.
    const placeFromKeyboard = () => {
      const ed = this.editor;
      if (!ed) return;
      // The view's centre, through the canvas's own transform — see `viewCentre`.
      const [cx, cy] = ed.viewCentre();
      const inst = ed.addComponent(item.name, cx, cy);
      if (inst) this.setStatus(`Added ${inst.id}.`);
    };
    btn.addEventListener("keydown", (ev) => {
      // The index space IS the drawn order. `paletteItems` grows in the order
      // packages were EXPANDED, which is not the order they are drawn in once a
      // later package is opened before an earlier one -- so ArrowDown from a row in
      // the second package landed on a row in the first, skipping the list being
      // walked.
      const all = this.paletteEl?.querySelectorAll<HTMLElement>(".modelica-studio-palette-item");
      const rows = all ? Array.from(all) : [];
      const move = paletteKeyTarget(
        rows.map((_, i) => i),
        rows.indexOf(btn),
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
      rows[move.next]?.focus();
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
      const [cx, cy] = ed.viewCentre();
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
      // A thumbnail is a CLASS, so the only values it can show are the class's own
      // defaults -- and `%name` has nothing to name. Without this the macro was
      // painted as written: every `HeatCapacitor` in the palette read `%C`, and
      // every labelled block read `%name` in its corner.
      if (g.kind === "Text") {
        const raw = g.textString ?? "";
        if (raw.includes("%name")) continue;
        if (raw.includes("%")) {
          const withValues = {
            ...g,
            textString: substituteMacros(raw, g, (n) =>
              n === "class"
                ? item.shortName
                : item.parameters.find((p) => p.name === n)?.defaultValue
            ),
          };
          try {
            drawGraphic(ctx, withValues, t, 1, theme, strokePx);
          } catch {
            /* a single bad primitive must not break the palette */
          }
          continue;
        }
      }
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
      const dropped = droppedVaultFile((t) => ev.dataTransfer?.getData(t) ?? "", this.plugin.settings.modelFolder);
      if (dropped) {
        void this.plugin.loadModelFromPath(dropped);
        return;
      }
      const className =
        ev.dataTransfer?.getData("text/modelica-class") ||
        ev.dataTransfer?.getData("text/plain");
      if (!className || !this.editor) return;
      // Through the canvas's own mapping, so the symbol lands under the pointer:
      // the y axis is mirrored (Modelica's +y is up), and that sign lives in
      // `sceneTransform` alone.
      const [dx, dy] = this.editor.toDiagram(ev);
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
    // Looked up in the model the EDITOR is drawing, not the one the plugin
    // happens to hold. They are kept identical (see `adoptEditorModel`), but the
    // symptom of them drifting is silent and total -- a selection that is not in
    // the model being inspected renders an empty panel, for every component at
    // once -- so the inspector reads what the user is actually looking at.
    const drawn = this.editor?.currentModel ?? this.plugin.model;
    const inst =
      selected.length === 1 ? drawn.components.find((c) => c.id === selected[0]) : undefined;


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
    // Which tab this body holds, so the stylesheet can let the trace list take the
    // height that is left over. The Selection tab is a long form whose content has
    // to be able to scroll the pane; the Traces tab is a list, and a list should
    // fill the space it is given.
    el.toggleClass("is-results", this.inspectorTab === "results");
    // The pane carries the same fact as a class of its own, because the rule that
    // turns it into a column has to match the PANE. It was written as
    // `:has(> .…-body.is-results)`, which the review rejects: a selector that
    // depends on a descendant invalidates broadly. Toggled here, next to the
    // class it mirrors, so the two cannot drift.
    this.inspectorCol?.toggleClass("is-results-tab", this.inspectorTab === "results");
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
      // A selected wire is not "nothing selected", and telling the user to select
      // a component while one is already picked reads as the click not having
      // worked.
      const wires = this.editor?.selectedWireIds ?? [];
      if (wires.length > 0) {
        const conns = (this.plugin.model.connections ?? []).filter((c) => wires.includes(c.id));
        const one = conns.length === 1 ? conns[0] : undefined;
        parent.createDiv({
          cls: "modelica-studio-empty",
          text: one
            ? `Connection ${one.from.component}.${one.from.port} → ` +
              `${one.to.component}.${one.to.port}. Drag a corner to re-route it, ` +
              `or press Delete to remove it.`
            : `${conns.length} connections selected. Press Delete to remove them.`,
        });
        return;
      }
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
      // Which of this component's connectors a wire already reaches. A port can
      // be switched OFF while a wire is on it -- `useHeatPort` was true when the
      // wire was drawn -- and the ring disappears with the connector, so the
      // wire would otherwise be left ending in mid-air with nothing said.
      const wired = new Set<string>();
      for (const c of (this.editor?.currentModel ?? this.plugin.model).connections ?? []) {
        if (c.from.component === inst.id) wired.add(c.from.port);
        if (c.to.component === inst.id) wired.add(c.to.port);
      }
      const list = parent.createDiv({ cls: "modelica-studio-portlist" });
      for (const p of def.ports) {
        // A conditional connector does not exist until its parameter is on, so
        // it is shown as unavailable rather than offered like the others. This
        // is the same test the editor applies before letting a wire start or
        // end here, so the list and the canvas agree.
        const live = portIsEnabled(inst, def, p);
        const connected = wired.has(p.name);
        const kind = p.causality === "acausal" ? shortType(p.type) : p.causality;
        const detail = live
          ? `${kind}${p.isFlow ? " · flow" : ""}`
          : connected
            ? `${kind} · wired, but it needs ${p.condition} = true`
            : `${kind} · needs ${p.condition} = true`;
        const row = list.createDiv({
          cls:
            "modelica-studio-portrow" +
            (live ? "" : connected ? " is-conditional-broken" : " is-conditional-off"),
        });
        row.createSpan({ cls: "modelica-studio-portname", text: p.name });
        row.createSpan({ cls: "modelica-studio-muted", text: detail });
        if (!live) {
          row.setAttribute(
            "aria-label",
            connected
              ? `${p.name} has a wire on it but does not exist: it is declared only when ${p.condition} is true`
              : `${p.name} is not available: it is declared only when ${p.condition} is true`
          );
        }
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
    // Healed here as well as on a click. Nothing can invalidate the active tab now
    // that every tab is a view of the results, but the guard is what keeps that
    // true if a third one is ever added back.
    this.bottomTab = resultsTabState(this.bottomTab, this.bottomTab);
    const showPlot = this.bottomTab === "plot" && this.result !== null;
    const showLog = this.bottomTab === "log";
    this.plotHost?.toggleClass("modelica-studio-hidden", !showPlot);
    this.logHost?.toggleClass("modelica-studio-hidden", !showLog);
    // Only the plot tab is empty without a result; the log is useful before one.
    this.emptyEl?.toggleClass("modelica-studio-hidden", Boolean(this.result) || showLog);
    if (showLog) this.renderRunLog();
    // The plot's actions and scale controls belong to the plot, not the log.
    this.bottomActionsEl?.toggleClass("modelica-studio-hidden", !showPlot);
    if (this.inlineScale) {
      // Hidden while the log is showing, and hidden when the user closed it:
      // `scaleOpen` is the decision, the layout is not.
      this.inlineScale.toggleClass(
        "modelica-studio-hidden",
        !(this.scaleOpen && showPlot && this.inlineScale.childElementCount > 0)
      );
    }
    // No tab is hidden per mode any more. The one that was -- Source, in code
    // mode, where it would have been a no-op -- is gone entirely.
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
  /**
   * What is wrong with the drawing, as one line for the top of the run log.
   *
   * The failure this prevents is silent: components that are not wired together
   * still compile, and the flat line that comes out reads as a fact about the
   * physics. Shown above the run output rather than as a notice, so it is next to
   * the plot it explains and does not have to be dismissed on every run.
   */
  private wiringWarning(): string | undefined {
    const findings = this.lintFindings();
    return findings.length > 0 ? summariseLint(findings) : undefined;
  }

  /** What is wrong with the drawing. One place, so every reader agrees. */
  private lintFindings(): LintFinding[] {
    return lintModel(this.plugin.sourceForSave(), {
      isComponent: (name) => this.plugin.library.component(name) !== undefined,
    });
  }

  private renderRunLog(): void {
    if (!this.logText) return;
    const warning = this.wiringWarning();
    const text = this.plugin.runLog.toText() || "No simulations have been run yet.";
    this.logText.setText(warning ? `${warning}\n\n${text}` : text);
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

    const stored = inst.params[p.name];
    // Commit on change/Enter rather than every keystroke: an edit triggers a
    // re-simulation, which must not fire per character.
    const commit = (value: string) => {
      this.editor?.setParam(inst.id, p.name, value);
      void this.runSimulation({ silent: true });
    };

    // A Boolean is one of two values, and a text field let a user write anything
    // else: `useSupport = yes` is reported by OpenModelica as "Variable yes not
    // found in scope Force" -- naming neither the parameter nor the type, and
    // only after a Simulate. A select cannot express the mistake.
    //
    // Used only while the binding really is one of the two literals. A model may
    // legitimately write `useSupport = someFlag`, and a select would render that
    // as "default" and then silently drop it on the next change, so anything else
    // keeps the text field it was written in.
    const isLiteralBoolean = stored === undefined || stored === "true" || stored === "false";
    if (p.type === "Boolean" && isLiteralBoolean) {
      const select = row.createEl("select", { cls: "modelica-studio-param-select" });
      // First, so the panel can say "I have not overridden this" -- which is what
      // the model means when the modifier is absent, and what an empty value
      // restores, since `setParam` deletes the key.
      select.createEl("option", {
        attr: { value: "" },
        text: p.defaultValue !== undefined ? `default (${p.defaultValue})` : "default",
      });
      for (const value of ["true", "false"]) {
        select.createEl("option", { attr: { value }, text: value });
      }
      select.value = stored ?? "";
      select.addEventListener("change", () => commit(select.value));
      return;
    }

    const input = row.createEl("input", {
      type: "text",
      value: stored ?? p.defaultValue ?? "",
    });
    if (p.defaultValue !== undefined) input.placeholder = `default ${p.defaultValue}`;
    input.addEventListener("change", () => commit(input.value.trim()));
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
      // Published like every other change to what is drawn: a note's block for the
      // same model kept drawing the traces that were just cleared, because the
      // shared per-model chart state was only written from some of the paths.
      this.publishChart();
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
      // A new filter is a new list, so it opens at the top: keeping the old
      // offset would show the middle of a set the reader has not seen.
      this.seriesScroll = 0;
      this.renderInspector();
      const next = this.inspectorEl?.querySelector<HTMLInputElement>(
        'input[placeholder="Filter variables…"]'
      );
      if (next) {
        next.focus();
        next.setSelectionRange(caret, caret);
      }
    });

    // Presets, because the list is every variable the model has — a hundred and
    // seventy for a small motor — and the question asked of it is nearly always
    // one of four. They combine with the text: pick Varying, then type "phi".
    const presets = parent.createDiv({ cls: "modelica-studio-presets" });
    for (const preset of SERIES_PRESETS) {
      const on = this.seriesPreset === preset.id;
      const b = presets.createEl("button", {
        cls: `modelica-studio-preset${on ? " is-active" : ""}`,
        text: preset.label,
      });
      // A pill is a toggle, so it says which one is showing rather than relying
      // on the colour alone.
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.setAttribute("aria-label", preset.hint);
      b.addEventListener("click", () => {
        if (this.seriesPreset === preset.id) return;
        this.seriesPreset = preset.id;
        // A different set of rows: the reader's place in the old one means nothing.
        this.seriesScroll = 0;
        this.renderInspector();
      });
    }

    const needle = this.seriesFilter.trim().toLowerCase();
    const preset = seriesPreset(this.seriesPreset);
    const varying = this.varyingNames();
    const matching = (s: SimSeries) =>
      (!needle || s.name.toLowerCase().includes(needle)) &&
      preset.keeps(s.name, {
        visible: this.seriesStyles[s.name]?.visible === true,
        varies: varying.has(s.name),
      });
    // Simulation order, filtered — not checked-first, so a click never moves a row.
    const ordered = this.result.series.filter(matching);

    // How much of the list is not on screen, ABOVE the list rather than at its
    // foot: the list is a window onto up to forty rows, and a note at the end of
    // it can only be read by scrolling to the end — which is the one thing a
    // reader looking for a variable is not doing.
    if (ordered.length > SERIES_PAGE) {
      parent.createDiv({
        cls: "modelica-studio-muted modelica-studio-series-more",
        text: `Showing the first ${SERIES_PAGE} of ${ordered.length} — type to narrow the list.`,
      });
    }

    const list = parent.createDiv({ cls: "modelica-studio-series" });
    for (const s of ordered.slice(0, SERIES_PAGE)) this.renderSeriesRow(list, s);
    if (ordered.length === 0) {
      list.createDiv({ cls: "modelica-studio-muted", text: emptySeriesMessage(preset, needle) });
    }
    // Rebuilt after every check, so the reader's place is put back: clicking the
    // thirtieth trace used to throw the list back to the top, and every box after
    // it had to be found again.
    list.scrollTop = this.seriesScroll;
    list.addEventListener("scroll", () => {
      this.seriesScroll = list.scrollTop;
    });
  }

  /** The names of the traces whose values move over the run on screen. */
  private varyingNames(): Set<string> {
    if (this.varyingCache.result !== this.result) {
      const names = new Set<string>();
      if (this.result) {
        for (const s of summarizeSeries(this.result)) if (s.varies) names.add(s.name);
      }
      this.varyingCache = { result: this.result, names };
    }
    return this.varyingCache.names;
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
   * Build the bottom pane: a tab strip, the plot, and the run log.
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
      for (const id of RESULTS_TABS) {
        const b = tabs.createEl("button", { cls: "modelica-studio-tab", text: tabLabel(id) });
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", "false");
        b.addEventListener("click", () => {
          // One state machine rather than two assignments in the click path and a
          // third in the mode switch. Clicking Source used to change the MODE and
          // leave the active tab on a tab that mode hides, so the strip ended up
          // with nothing selected and the way back was the tab that had vanished.
          // No mode switch: every tab is a view of the results now, so clicking
          // one only chooses what to show.
          this.bottomTab = resultsTabState(this.bottomTab, id);
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

      const logHost = el.createDiv({ cls: "modelica-studio-log modelica-studio-hidden" });
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
        // Through the shared helper, which reports a refused write instead of
        // claiming a copy that did not happen.
        void copyText(this.plugin.runLog.toText() || "No simulations have been run yet.", "the run log");
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
      // The row itself lives in `plot-actions.ts`, where it can be rendered and
      // asserted in a real DOM. What is passed in is the view's own state and
      // commands, so the builder never reaches back into this class.
      buildPlotActions(actions, {
        stopTime: () => this.plugin.stopTime(),
        // Recording the span and running again are one action from here: the
        // field is how the question is asked, and a new answer needs the run.
        applyStopTime: (seconds) => {
          this.plugin.setStopTime(seconds);
          void this.runSimulation({ silent: true });
        },
        hasResult: () => !!this.result,
        // Only what can actually be swept: `collectParameters` also reports the
        // initial-state entries, and overriding one of those is silently ignored
        // -- a family of identical curves for a value that never changed.
        sweepParameters: () => sweepableParameters(collectParameters(this.plugin.model)),
        sweepField: () => ({ ...this.sweepField }),
        setSweepField: (field) => {
          this.sweepField = field;
        },
        familyCount: () => this.family.length,
        deltasOn: () => this.plugin.settings.plotDeltas,
        toggleScalePanel: () => this.toggleScalePanel(),
        openFullScreen: () => this.openFullScreen(),
        autoScale: () => this.autoScale(),
        toggleDeltas: () => void this.toggleDeltas(),
        runSweep: (parameter, values) => void this.runSweep(parameter, values),
        keepAsBefore: () => this.keepAsBefore(),
        copyFigure: () => void this.copyFigure(),
        saveFigure: () => void this.saveFigure(),
        clearFamily: () => {
          this.family = [];
          this.lastSweep = null;
          this.drawResults();
          this.renderPlotPane();
        },
      });
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
    window.requestAnimationFrame(() => this.drawResults());
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

    this.scalePanel = overlay.createDiv({ cls: "modelica-studio-scale modelica-studio-hidden" });
    scaleBtn.addEventListener("click", () => {
      const panel = this.scalePanel;
      if (!panel) return;
      const open = !panel.hasClass("modelica-studio-hidden");
      panel.toggleClass("modelica-studio-hidden", open);
      if (!open) this.buildScalePanel(panel);
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
    window.requestAnimationFrame(() => this.drawFullScreen());
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
      // The three controls go into the panel's own grid, not into a row wrapper.
      // The wrapper was laid out with `display: contents`, which the review
      // rejects as a partially supported feature, and one grid for every row is
      // what keeps the columns shared so the labels line up down the panel.
      panel.createSpan({ cls: "modelica-studio-scale-label", text: label });
      const range = panel.createEl("input", { type: "range" });
      range.min = "0";
      range.max = "1";
      range.step = "0.001";
      const num = panel.createEl("input", { type: "number", cls: "modelica-studio-scale-num" });
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
      this.inlineScale.addClass("modelica-studio-hidden");
    }
    this.scaleOpen = !this.scaleOpen;
    this.inlineScale.toggleClass("modelica-studio-hidden", !this.scaleOpen);
    if (this.scaleOpen) {
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
    // `publishChart` returns the promise the save makes; nothing here waits for it, and
    // the chart is published either way, so the rejection is the plugin's to report.
    void this.plugin.publishChart();
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
    const currentLabel = this.lastSweep
      ? `${this.lastSweep.parameter}=${this.lastSweep.value}`
      : undefined;
    const view = this.zoom ?? {
      xMin: this.result.time[0],
      xMax: this.result.time[this.result.time.length - 1],
    };
    // The family is folded into the result BEFORE anything reads it, so the axes,
    // the legend, the cursor readout and the extents all account for the other
    // runs without knowing they exist.
    const { result, familyNames } = overlayResults(this.result, this.family, currentLabel);
    const styled: Record<string, SeriesStyle> = { ...this.seriesStyles };
    // Under the CURRENT name as well as the family names: an overlay renames the
    // run on screen too, and a style looked up by the old name is not found.
    for (const name of familyNames) {
      const base = this.seriesStyles[name.split(" · ")[0]];
      styled[name] ??= {
        color: base?.color ?? seriesColor(0),
        // Drawn unless the trace it came from was ticked off: a family is the
        // same variables over again, and hiding one should hide its relations.
        visible: base?.visible !== false,
        dashed: true,
      };
    }
    // A renamed series falls back to the style of the series it came from, which
    // is what keeps a family member the same colour as its current twin.
    for (const s of result.series) {
      if (styled[s.name] || !s.name.includes(" · ")) continue;
      const base = this.seriesStyles[s.name.split(" · ")[0]];
      if (base) styled[s.name] = { ...base, dashed: familyNames.has(s.name) };
    }
    const drawn = result.series.filter((s) => styled[s.name]?.visible === true);
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
      `plot: ${drawn.length}/${result.series.length} traces` +
        ` [${drawn.slice(0, 4).map((s) => s.name).join(", ")}]` +
        ` x=[${view.xMin}, ${view.xMax}]` +
        (this.family.length > 0 ? ` +${this.family.length} family` : "")
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
    drawPlot(ctx, w, h, result, {
      theme: plotThemeFrom(theme),
      legendBackground: theme.plotLegendBackground,
      styles: styled,
      view: {
        xMin: view.xMin,
        xMax: view.xMax,
        yMin: this.yLimits?.yMin,
        yMax: this.yLimits?.yMax,
      },
      cursorX: this.cursorX,
      // The overlay has the room to list every drawn trace at the cursor, which
      // is the point of inspecting there.
      cursorRows: canvas === this.fullCanvas ? result.series.length : 6,
      showDeltas: this.plugin.settings.plotDeltas,
      readoutScale: this.plugin.settings.plotReadoutScale,
      snapIntersections: this.plugin.settings.plotSnapCrossings,
      snapTolerancePx: this.plugin.settings.plotSnapTolerance,
      currentLabel,
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
   * Say what is wrong with the model without running it.
   *
   * Two answers, in one report: the connectivity check, which is static and
   * instant and describes the DRAWING, and the compiler's own diagnostics, which
   * are authoritative about everything else — a parameter with no value, a
   * variable with no equation, a unit that does not add up. Neither replaces the
   * other, and the second is what a person reaches for a compiler to get.
   *
   * Compiling is not simulating: no integration, and the built model is kept for
   * the next run, so asking is nearly free.
   */
  async checkModel(): Promise<void> {
    if (this.checking) {
      new Notice("Modelica: a check is already running.");
      return;
    }
    this.checking = true;
    this.beginBusy();
    const source = this.plugin.sourceForSave();
    const findings = this.lintFindings();
    const backend = this.plugin.backend;
    if (!backend) {
      new TextModal(this.app, "Check", formatLint(findings)).open();
      this.plugin.showSetupHelp();
      return;
    }
    this.setStatus("Checking…");
    let diagnostics: Array<{ severity: string; message: string; line?: number }> = [];
    let checked = false;
    // Asking the compiler is the other wait long enough to need saying: the status
    // line is one line of text in the corner, and the bar rides the surface whose
    // contents are being worked out.
    setBusy(this.resultsEl, true);
    for (const b of this.checkBtns) setButtonBusy(b, true, "clipboard-check");
    try {
      const outcome = await backend.compile({
        modelName: this.plugin.model.name,
        source,
        parameters: collectParameters(this.plugin.model),
        startTime: this.plugin.settings.startTime,
        stopTime: this.plugin.stopTime(),
        numberOfIntervals: this.plugin.settings.numberOfIntervals,
        tolerance: this.plugin.settings.tolerance,
        solver: this.plugin.settings.solver || undefined,
      });
      diagnostics = outcome.diagnostics;
      checked = outcome.ok;
      this.setStatus(outcome.ok ? "Check: compiles" : "Check: the compiler reported errors");
    } catch (err) {
      this.setStatus("Check failed");
      new TextModal(
        this.app,
        "Check",
        `${formatLint(findings)}\n\nthe compiler could not be asked: ${describeError(err)}`
      ).open();
      return;
    } finally {
      // In a `finally`, because the catch above returns: a bar left running after
      // the work has stopped is worse than no bar at all. `endBusy` only clears the
      // pane when this was the last operation using it.
      this.checking = false;
      this.endBusy();
      for (const b of this.checkBtns) setButtonBusy(b, false, "clipboard-check");
    }
    const report = formatLint(findings, diagnostics, checked);
    new TextModal(this.app, "Check", report, {
      label: "Ask the AI to fix it",
      hint: "Send the model and this report to the AI; the result lands in the editor for review",
      run: () => this.repairFromReport(),
    }).open();
  }

  /**
   * Run the model once per value of one parameter, and draw them together.
   *
   * Sequentially, because the compiler is the expensive part and running four of
   * them at once on the same model name would have them fight over the build
   * directory. Each result is kept, so the family survives changing which traces
   * are visible.
   */
  async runSweep(parameter: string, valuesText: string, opts: { silent?: boolean } = {}): Promise<void> {
    const values = parseSweepValues(valuesText);
    // Two values at least, and said out loud rather than quietly doing something
    // else. One value used to run: the single run became the result on screen and
    // the family came out empty, so a "sweep" of one number looked like the plot
    // simply changing — with nothing on screen to say why there was no family.
    if (values.length < 2) {
      if (!opts.silent) {
        new Notice(
          values.length === 0
            ? "Modelica: a sweep needs values — 100, 200, 400 runs three, or 0:0.5:2 for a range."
            : "Modelica: a sweep needs at least two values — one value is a single run. " +
              "Try 100, 200, 400, or 0:0.5:2 for a range."
        );
      }
      return;
    }
    if (this.busy) {
      // Silence here read as a broken button: the t_end field commits on blur and
      // starts a silent run, so clicking Sweep during it did nothing at all.
      if (!opts.silent) {
        new Notice(
          "Modelica: a run is already going — the sweep starts when it finishes. " +
            "Try again in a moment."
        );
      }
      return;
    }
    if (!this.plugin.backend) {
      if (!opts.silent) this.plugin.showSetupHelp();
      return;
    }
    if (!parameter) return;
    if (this.plugin.stopTime() <= this.plugin.settings.startTime) {
      const msg =
        `the run window is empty: start ${this.plugin.settings.startTime} s, ` +
        `end ${this.plugin.stopTime()} s. The end time must be greater than the start.`;
      this.setStatus(`Not swept — ${msg}`);
      if (!opts.silent) new Notice(`Modelica: ${msg}`, 8000);
      return;
    }
    this.flushEditorIntoModel();
    // Read BEFORE the busy state is taken. A throw from either of these — the
    // source is produced by the patcher, which can refuse but must not be trusted
    // not to throw — used to leave `busy` set and the pane marked for good, so no
    // run, sweep or check could start again. Nothing is taken now until the
    // preparation has succeeded.
    let source: string;
    let base: Record<string, string>;
    try {
      source = this.plugin.sourceForSave();
      base = collectParameters(this.plugin.model);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus(`Sweep failed. ${msg}`);
      if (!opts.silent) new Notice(`Modelica: the sweep could not start — ${msg}`, 8000);
      return;
    }
    this.busy = true;
    this.beginBusy();
    // The same text Check, Save and a note block compile (read above, before the
    // busy state): simulating the serializer's rebuild instead made one model
    // behave two ways -- Check said it compiled, and Simulate failed on a
    // declaration the rebuild had dropped.
    //
    // As in `runSimulation`: a sweep can take a minute, and the model can be
    // replaced while it runs. Everything below names the model it started on.
    const ranModel = this.plugin.model;
    const ranName = ranModel.name;
    const runs: FamilyRun[] = [];
    // Determinate, because the count is known: a bar that fills to 2 of 5 says
    // more than a bar that sweeps forever, and the sweep is the one run that can
    // take a minute. Set before the first run, so the bar is there from the click.
    setBusy(this.resultsEl, true, 0);
    for (const b of this.runBtns) setButtonBusy(b, true, "play");
    try {
      for (const [i, value] of values.entries()) {
        this.setStatus(
          `Sweeping ${ranName}: ${parameter}=${value} (${i + 1} of ${values.length})…`
        );
        setBusy(this.resultsEl, true, (i / values.length) * 100);
        const result = await this.plugin.backend.simulate({
          modelName: ranName,
          source,
          parameters: { ...base, [parameter]: String(value) },
          startTime: this.plugin.settings.startTime,
          stopTime: this.plugin.stopTime(),
          numberOfIntervals: this.plugin.settings.numberOfIntervals,
          tolerance: this.plugin.settings.tolerance,
          solver: this.plugin.settings.solver || undefined,
        });
        setBusy(this.resultsEl, true, ((i + 1) / values.length) * 100);
        runs.push({ label: `${parameter}=${value}`, result });
      }
    } catch (err) {
      this.setStatus("Sweep failed");
      // Recorded like any other failed run, so the log and "Send to AI" carry the
      // compiler's own output for THIS failure.
      const detail = describeFailure(err);
      this.plugin.diag(`sweep failed: ${firstLine(err instanceof Error ? err.message : String(err))}`, "error");
      this.lastSimulationError = detail;
      this.setCodeStatus(firstLine(err instanceof Error ? err.message : String(err)), true);
      this.plugin.runLog.add({
        at: new Date().toISOString(),
        model: ranName,
        ok: false,
        source,
        parameters: { ...base, [parameter]: values.join(", ") },
        settings: {
          startTime: this.plugin.settings.startTime,
          stopTime: this.plugin.stopTime(),
          tolerance: this.plugin.settings.tolerance,
          numberOfIntervals: this.plugin.settings.numberOfIntervals,
          solver: this.plugin.settings.solver,
        },
        detail: firstLine(err instanceof Error ? err.message : String(err)),
        elapsedMs: 0,
        reused: false,
      });
      // Named, because a sweep of the wrong model is the failure that looks like
      // a physics problem: the error quotes components the user did not draw.
      new Notice(
        `Modelica: the sweep of ${ranName} stopped — ` + describeError(err)
      );
      this.busy = false;
      this.endBusy();
      return;
    }
    this.busy = false;
    this.endBusy();
    if (this.plugin.model !== ranModel) {
      // The sweep belongs to a model that is no longer open: its runs would be
      // drawn as a family over the new model's plot.
      this.setStatus(`${ranName} was swept, but the studio moved on — the runs were discarded.`);
      this.plugin.diag(`sweep ${ranName}: discarded, the model changed while it ran`, "warn");
      return;
    }
    this.sweepField = { parameter, values: valuesText };
    // The last run becomes the current one, so the cursor, the trace list and the
    // inspector all describe something real; the rest are drawn behind it.
    const last = runs.pop();
    this.lastSweep = last ? { parameter, value: String(values[values.length - 1]) } : null;
    if (last) this.adoptResult(last.result);
    this.family = runs;
    // A sweep is a run, and the log is where runs are recorded: a twelve-value
    // sweep used to leave no trace in the panel that exists to hold them, and a
    // failure inside one left the previous failure standing -- so "Send to AI"
    // sent a compiler error from an earlier run, possibly of another model.
    this.lastSimulationError = null;
    this.setCodeStatus("");
    this.clearLogBadge();
    this.plugin.runLog.add({
      at: new Date().toISOString(),
      model: ranName,
      ok: true,
      source,
      parameters: { ...base, [parameter]: values.join(", ") },
      settings: {
        startTime: this.plugin.settings.startTime,
        stopTime: this.plugin.stopTime(),
        tolerance: this.plugin.settings.tolerance,
        numberOfIntervals: this.plugin.settings.numberOfIntervals,
        solver: this.plugin.settings.solver,
      },
      detail: `swept ${parameter} over ${values.length} values: ${values.join(", ")}`,
      elapsedMs: 0,
      reused: runs.length > 0 ? runs[runs.length - 1].result.reusedBinary : false,
    });
    // The traces are chosen by the ONE seeder, exactly as a single run chooses
    // them: a second rule here would override it, which is the fault the seeding
    // invariant exists for (a sweep of a 25-variable model would draw all 25).
    if (this.result) {
      const preferred = findExample(this.plugin.model.name)?.series ?? [];
      const wanted = preferred.length
        ? preferred.filter((n) => this.result!.series.some((s) => s.name === n))
        : defaultSeriesNames(this.result, 4);
      this.seedVisible(
        wanted.length ? wanted : defaultSeriesNames(this.result, 8),
        this.result.series.map((s) => s.name).join("|")
      );
    }
    this.drawResults();
    this.renderPlotPane();
    this.setStatus(`Swept ${parameter} over ${values.length} values of ${ranName}`);
    this.plugin.diag(`sweep ${ranName}: ${parameter} = ${values.join(", ")}`);
  }

  /** Repaint the results pane: the plots settings are read while drawing. */
  refreshPlot(): void {
    this.drawResults();
    this.renderPlotPane();
  }

  /** Turn the cursor readout's deltas on or off, and remember the choice. */
  private async toggleDeltas(): Promise<void> {
    this.plugin.settings.plotDeltas = !this.plugin.settings.plotDeltas;
    await this.plugin.saveSettings();
    // The effect lives in the hover readout, so the message says where to look —
    // and says when there is nothing to compare, which is the case where a toggle
    // legitimately changes nothing on screen.
    const on = this.plugin.settings.plotDeltas;
    this.setStatus(
      !on
        ? "Cursor readout: differences hidden"
        : this.family.length > 0
          ? "Cursor readout: differences shown — rest the cursor on the plot"
          : "Differences are on, but there is nothing to compare yet: sweep a parameter or press Keep as before"
    );
    this.refreshPlot();
  }

  /** Keep the run on screen, dashed, so the next one can be compared with it. */
  private keepAsBefore(): void {
    if (!this.result) return;
    this.family = [...this.family, { label: "before", result: this.result, before: true }];
    this.drawResults();
    this.renderPlotPane();
    this.setStatus("Kept the current run as \"before\" — run again to compare");
  }

  /**
   * Hand the report to the repair path.
   *
   * The same path the log's "Send to AI" uses, which is the point: a loose
   * diagram usually SIMULATES — flatly — so the log's button was never offered
   * for the one fault this report exists to find. The result goes to the code
   * editor, not over the model, so nothing is lost by asking.
   */
  private repairFromReport(): void {
    this.setMode("code");
    this.toggleAiRow(true);
    if (this.aiInput) this.aiInput.value = "Fix the wiring this report describes.";
    void this.runAiRequest(true);
  }

  /** The canvas holding the result the user is looking at. */
  private visiblePlot(): HTMLCanvasElement | undefined {
    return this.fullCanvas ?? this.plotCanvas ?? undefined;
  }

  /** Copy the visible plot into the clipboard as a PNG. */
  async copyFigure(): Promise<void> {
    const canvas = this.visiblePlot();
    if (!canvas) return;
    await copyCanvasImage(canvas, "the plot");
  }

  /** Save the visible plot beside the note, and link it there. */
  async saveFigure(): Promise<void> {
    const canvas = this.visiblePlot();
    if (!canvas) return;
    const path = await saveCanvasImage(
      this.app,
      canvas,
      this.plugin.model.name,
      this.plugin.settings.modelFolder
    );
    if (path) linkFigure(path, this.activeNoteEditor());
  }

  /** The editor of the note in front of the user, if a note is open. */
  private activeNoteEditor(): { replaceSelection(text: string): void } | undefined {
    const active = this.app.workspace.activeEditor;
    if (active?.editor) return active.editor;
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? undefined;
  }

  /** Copy the DIAGRAM as a PNG, for a note or a slide about the model itself. */
  async copyDiagramFigure(): Promise<void> {
    const canvas = this.editor?.canvasEl;
    if (!canvas) {
      new Notice("Modelica: there is no diagram to copy.");
      return;
    }
    await copyCanvasImage(canvas, "the diagram");
  }

  /** Save the diagram beside the note, and link it there. */
  async saveDiagramFigure(): Promise<void> {
    const canvas = this.editor?.canvasEl;
    if (!canvas) {
      new Notice("Modelica: there is no diagram to save.");
      return;
    }
    const path = await saveCanvasImage(
      this.app,
      canvas,
      this.plugin.model.name,
      this.plugin.settings.modelFolder
    );
    if (path) linkFigure(path, this.activeNoteEditor());
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
      // The time at that pixel, computed from the layout `drawPlot` paints with,
      // so the readout cannot drift from the drawing. This used to be a second,
      // hand-kept copy of the margins and it had already drifted -- left 62
      // against the renderer's 56 -- putting the readout beside its own crosshair.
      // Read off the VISIBLE window, not the whole run: after a zoom the two
      // differ and the readout would lag.
      const view = this.zoom ?? {
        xMin: this.result.time[0],
        xMax: this.result.time[this.result.time.length - 1],
      };
      this.cursorX = timeAtPlotX(
        x,
        rect.width,
        rect.height,
        this.result,
        this.seriesStyles,
        view
      );
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
      // As above: without this the block beside the studio stayed zoomed into the
      // window the studio had just left.
      this.publishChart();
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

  private onModelChanged(m: DiagramModel): void {
    // An edit changes the state (saved -> modified), and a rename changes the name.
    this.refreshChrome();
    // The editor may hand over a NEW object — an undo or a redo restores a parsed
    // copy rather than mutating in place — and the plugin has to take it, or the
    // two drift apart and the inspector ends up looking the selection up in a
    // model that no longer contains it.
    this.plugin.adoptEditorModel(m);
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
    const wires = this.editor?.selectedWireIds ?? [];
    // Wires are a second selection, so a toolbar that only counted components
    // left Delete greyed out with a wire plainly selected.
    const has = sel.length > 0 || wires.length > 0;
    const single = sel.length === 1;
    const set = (btn: HTMLButtonElement | undefined, enabled: boolean) => {
      if (!btn) return;
      btn.toggleClass("is-disabled", !enabled);
      btn.disabled = !enabled;
    };
    // Rotation is a component transform; a wire has nothing to rotate. Delete
    // takes either kind.
    set(this.btnRotate, sel.length > 0);
    set(this.btnDelete, has);
    set(this.btnUndo, this.editor?.history.canUndo ?? false);
    set(this.btnRedo, this.editor?.history.canRedo ?? false);
    set(this.btnCopy, sel.length > 0);
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
    // `discardStudioEdits`: the point is to put the FILE back, so the studio's
    // copy must not be written over it on the way in.
    await this.plugin.loadModelFromPath(path, { discardStudioEdits: true });
    this.setStatus(`Reverted ${name} to ${path}.`);
  }

  /**
   * Realise whatever the pane holds. True when the model now reflects it.
   *
   * In diagram mode there is nothing to flush, so that is a success.
   */
  flushEditorIntoModel(): boolean {
    if (this.mode !== "code" || !this.codeEditor) return true;
    return this.applyCodeToDiagram(false);
  }

  /** The pane's own diagnostic, for a caller that has to explain a refusal. */
  codeProblemText(): string {
    return this.codeDiagEl?.textContent?.trim() ?? "";
  }

  loadModelIntoEditor(): void {
    // A different model: its name, its file and its state are all new.
    this.refreshChrome();
    // The user asked for this model, so the canvas is meant to be empty. Without
    // this the seeding below replaced a brand-new model with an example the
    // moment it was created, and New looked like it did nothing.
    this.freshModel = true;
    this.editor?.setModel(this.plugin.model);
    // Anything derived from the previous model goes with it: a result would plot
    // traces that no longer match the source, and a family of runs would plot
    // another model's variables.
    this.adoptResult(null);
    this.forgetFamily();
    this.lastSimulationError = null;
    this.clearCodeProblem();
    // The exact source when there is one, and the serialised diagram only as a
    // fallback. Rebuilding the text from the diagram loses declaration comments
    // and normalises formatting, so a model saved and reopened came back subtly
    // different from what was written -- and a user who had fixed a line would
    // find the fix apparently gone.
    if (this.codeEditor) {
      const source = this.plugin.modelSourceText();
      this.codeEditor.setValue(source.trim() ? source : serializeDiagram(this.plugin.model), {
        resetHistory: true,
      });
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
    setBusy(this.paletteEl, false);
    this.renderPalette();
  }

  /**
   * Redraw the diagram after a display setting changed.
   *
   * The label scale and the hover readout are read on every frame, so a redraw
   * is all it takes -- there is nothing to rebuild and no state to reload.
   */
  refreshDiagram(): void {
    this.editor?.requestDraw();
  }

  /**
   * How many operations are sharing the busy indicator.
   *
   * `setBusy` has no ownership: Simulate, Sweep and Check all mark the same
   * results pane, and Check did not even set `this.busy`. Whichever finished first
   * cleared the bar, so pressing Check during a run removed the run's progress
   * mid-compile, and the run's end reset a still-running Check's spinner. The
   * count keeps the pane marked until the LAST of them is done.
   */
  private busyOwners = 0;

  private beginBusy(): void {
    this.busyOwners++;
  }

  private endBusy(): void {
    this.busyOwners = Math.max(0, this.busyOwners - 1);
    if (this.busyOwners === 0) this.clearBusy();
  }

  /**
   * How to close the Examples menu, when one is open.
   *
   * The menu installs document-level listeners, so it needs a single, reachable
   * way out that every closing path uses.
   */
  private exampleMenuClose: (() => void) | null = null;

  /** A check and a run share the results pane, so only one check at a time. */
  private checking = false;

  /**
   * The text the pane was last FILLED with, as opposed to what is in it now.
   *
   * Two things need to tell "the user typed something" from "this is the document
   * we put there": a mode switch must not adopt an unchanged pane over the diagram
   * (that cleared the diagram's undo history and discarded unwritten edits), and a
   * pane holding a source that no longer describes the diagram must not overwrite
   * the diagram merely because code mode was opened.
   */
  private codeBaseline = "";

  /** Re-read the plugin's model, e.g. after it was replaced elsewhere. */
  reloadFromPlugin(): void {
    this.adoptResult(null);
    this.forgetFamily();
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
    if (!ex) {
      // Named but not found is a bug of ours, not something to swallow.
      this.plugin.diag(`example ${name}: not in the shipped set`, "error");
      new Notice(`Modelica: there is no example called "${name}".`);
      return;
    }
    const t0 = performance.now();
    this.setStatus(`Loading ${ex.name}…`);
    void this.plugin
      // `fromExample` is what stops a shipped model being written over a file of
      // the same name: an example is not a document, and it holds no path until
      // the user saves it somewhere on purpose.
      .setModelFromSource(ex.source, { fromExample: true })
      .then((m) => {
        this.plugin.diag(`example ${name}: loaded in ${(performance.now() - t0).toFixed(0)} ms`);
        if (!m) {
          // The source parsed to nothing usable. Saying so beats leaving the
          // previous model on screen as if the click had not registered.
          this.plugin.diag(`example ${name}: the source produced no model`, "error");
          new Notice(`Modelica: "${ex.name}" could not be read as a model.`, 8000);
          this.setStatus(`Could not load ${ex.name}.`);
          return;
        }
        // Adopt the example's natural time span. Done through the plugin so it
        // replaces any span restored with the previous model rather than being
        // ignored as one the user had chosen.
        this.plugin.setStopTime(ex.stopTime, ex.name);
        this.editor?.scheduleFit();
        this.renderInspector();
        this.setStatus(`Loaded example: ${ex.name} — ${ex.description}`);
      })
      // A rejected load used to be INVISIBLE: the promise was neither awaited nor
      // caught, so an error anywhere along it -- the library index, the parse, the
      // flush that saves the outgoing model, the persist -- left the previous model
      // on screen with no notice, no status line and nothing in the log. That is
      // indistinguishable from a menu click that never registered, which is exactly
      // how it was reported: "I used the Examples menu and the change didn't take".
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.plugin.diag(`example ${name}: could not load — ${msg}`, "error");
        new Notice(`Modelica: "${ex.name}" could not be loaded — ${msg}`, 10000);
        this.setStatus(`Could not load ${ex.name}.`);
      });
  }

  /** Toolbar picker listing the built-in examples. */
  private showExamplePicker(anchor: HTMLElement): void {
    const existing = this.contentEl.querySelector(".modelica-studio-examples-menu");
    if (existing) {
      // Through `close`, not by removing the element: two of the four ways this
      // menu could go away left its capture-phase handlers on `document`, so arrow
      // keys stayed swallowed app-wide and Enter re-clicked items[0] -- loading a
      // DIFFERENT example over the model on the canvas.
      this.exampleMenuClose?.();
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
      const dom = domainOfLabel(domain);
      menu
        .createDiv({ cls: "modelica-studio-examples-group" })
        .createSpan({ ...domainAttributes(dom), text: domain });
      for (const ex of list) {
        const item = menu.createDiv({ cls: "modelica-studio-examples-item" });
        item.setAttribute("role", "menuitem");
        item.tabIndex = -1;
        // Which example is OPEN, marked in the list. Without it a click that loads
        // the row next to the one you meant looks like "nothing happened", because
        // the canvas simply redraws a different model -- and two rows in this menu
        // are easy to confuse: the group heading and the row under it are both
        // called "Electrical".
        if (ex.name === this.plugin.model.name) {
          item.addClass("is-current");
          item.setAttribute("aria-current", "true");
        }
        items.push(item);
        item.createDiv({ cls: "modelica-studio-examples-name", text: ex.name });
        // The domain prefix is already the group heading.
        const detail = ex.description.includes(":")
          ? ex.description.slice(ex.description.indexOf(":") + 1).trim()
          : ex.description;
        item.createDiv({ cls: "modelica-studio-examples-desc", text: detail });
        item.addEventListener("click", () => {
          // `close` rather than `menu.remove()`: see the toggle above.
          this.exampleMenuClose?.();
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
      // Idempotent, and registered so every other path can reach it.
      if (this.exampleMenuClose === close) this.exampleMenuClose = null;
    };
    this.exampleMenuClose = close;

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

    window.setTimeout(() => {
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
  /**
   * Make a pane resizable by its divider.
   *
   * One implementation for every divider. There were two, which is why they did
   * not behave alike: the results divider clamped against the view and re-applied
   * on resize, and the inspector's did neither, so a width chosen on a wide window
   * stayed on a narrow one until the diagram was gone.
   *
   * `side` says which way the pane lies from its divider, and that is the whole of
   * the arithmetic -- see `sizeFromDividerDrag`, where the sign lives and is
   * tested.
   */
  private installDivider(opts: {
    el: HTMLElement;
    /** `x` for a column's width, `y` for a pane's height. */
    axis: "x" | "y";
    /**
     * Which side the pane is on, read at DRAG time.
     *
     * A function rather than a value because the results divider moves: in
     * diagram mode it draws the plot's top edge and the pane is below it, and in
     * code mode it draws the plot's bottom edge and the pane is above. A value
     * captured at install time would give the wrong sign for one of the two.
     */
    side: () => DividerSide;
    /** The pane this divider sizes. */
    pane: HTMLElement;
    /** Apply a size, clamped, returning what was actually applied. */
    apply: (size: number, remember?: boolean) => number;
    /** The size a double-click restores. */
    reset: () => number;
  }): void {
    let startPos = 0;
    let startSize = 0;
    let lastSize = 0;
    let dragging = false;

    const onMove = (ev: PointerEvent) => {
      if (!dragging) return;
      const delta = opts.axis === "x" ? ev.clientX - startPos : ev.clientY - startPos;
      // Rendered but not remembered: only the finished gesture is the user's
      // choice, and a drag that ends elsewhere must not leave the intermediate
      // sizes behind if the app closes mid-drag.
      lastSize = opts.apply(sizeFromDividerDrag({ startSize, delta, side: opts.side() }));
      this.afterPaneResize();
    };
    const onUp = (ev: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      // The size the gesture ended on is the one to keep.
      if (lastSize > 0) opts.apply(lastSize, true);
      opts.el.removeClass("is-dragging");
      document.body.removeClass("modelica-studio-resizing");
      try {
        opts.el.releasePointerCapture(ev.pointerId);
      } catch {
        /* capture may already be released */
      }
      void this.plugin.persist();
    };

    opts.el.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      dragging = true;
      startPos = opts.axis === "x" ? ev.clientX : ev.clientY;
      // Measured rather than read back from the setting: the setting may have been
      // clamped on apply, and starting from the pre-clamp value makes the first
      // drag jump.
      const rect = opts.pane.getBoundingClientRect();
      startSize = opts.axis === "x" ? rect.width : rect.height;
      opts.el.addClass("is-dragging");
      document.body.addClass("modelica-studio-resizing");
      opts.el.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    opts.el.addEventListener("pointermove", onMove);
    opts.el.addEventListener("pointerup", onUp);
    opts.el.addEventListener("pointercancel", onUp);
    // Double-click restores the default. Without it a pane dragged to an awkward
    // size has to be dragged back by hand.
    opts.el.addEventListener("dblclick", () => {
      lastSize = opts.apply(opts.reset(), true);
      this.afterPaneResize();
      void this.plugin.persist();
    });
  }

  /**
   * Build one of the drag dividers.
   *
   * They share a class and a tooltip, so they read as the same control in three
   * places and a test can find them all instead of knowing each name.
   */
  private makeDivider(parent: HTMLElement, axis: "x" | "y", label: string): HTMLElement {
    const el = parent.createDiv({
      cls: `modelica-studio-divider is-${axis === "x" ? "col" : "row"}`,
    });
    el.setAttribute("role", "separator");
    el.setAttribute("aria-orientation", axis === "x" ? "vertical" : "horizontal");
    // Obsidian tooltips come from `aria-label`, never `title`.
    el.setAttribute("aria-label", `${label} — drag to resize, double-click to reset`);
    return el;
  }

  /**
   * Re-render once the library index has finished building.
   *
   * The index is built asynchronously (parsing the Modelica Standard Library
   * takes a couple of seconds) so the view opens immediately with an empty
   * palette and fills in as soon as the index is ready.
   */
  async refreshLibrary(): Promise<void> {
    // Belt and braces with `onLibraryReady`: whichever arrives first, the bar
    // stops. An index that failed to build leaves it running, which is honest —
    // the palette really is empty — and the status line says what happened.
    setBusy(this.paletteEl, false);
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

  /** What the status line says, without the save state appended. */
  private statusMessage = "Ready.";

  setStatus(text: string): void {
    this.statusMessage = text;
    this.renderStatus();
  }

  /**
   * The status line: what just happened, and whether the file has it.
   *
   * The save state is appended rather than replacing the message -- the message says what
   * just happened, the state says whether it is safe -- and the state is read fresh each
   * time, so a message that outlives an edit does not keep an old label.
   */
  private renderStatus(): void {
    if (!this.statusEl) return;
    const desc = this.plugin.saveState();
    this.statusEl.setText(desc.state === "saved" ? this.statusMessage : `${this.statusMessage} — ${desc.label}`);
    this.statusEl.toggleClass("is-unsaved", desc.state !== "saved");
    // The header shows the same state, and every action that changes it also writes a
    // status message. Refreshing it here rather than at forty call sites is what stops the
    // three-way mismatch a reader hit: the tab said DCMotor, the header named
    // HeatExchanger.mo, and the canvas held RLC, because loading an example wrote a status
    // line without touching either of them. `refreshTitle` does not write the status, so
    // this cannot recurse.
    this.refreshTitle();
  }

  // `setBusy` and `setButtonBusy` are imported from `./busy`, so the studio and an
  // embedded block cannot drift apart on what "working" looks like.

  /**
   * Stop every indication that a run or a check is in flight.
   *
   * One call rather than four, because they always end together: a bar left
   * running after the work has stopped is worse than no bar at all, and it is the
   * failure mode of doing this at each exit by hand.
   *
   * Not the palette: the library index is a different wait, with a different
   * lifetime, and it ends when the index is ready rather than when a run is.
   */
  private clearBusy(): void {
    setBusy(this.resultsEl, false);
    for (const b of this.runBtns) setButtonBusy(b, false, "play");
    for (const b of this.checkBtns) setButtonBusy(b, false, "clipboard-check");
  }

  /**
   * Ask whether to keep a model that was not written anywhere.
   *
   * Only when there is something to save, and only once per run: a prompt that
   * appears when the model is already saved is noise, and one that appears twice
   * teaches the reader to dismiss it.
   */
  /**
   * Save, unless the file changed on disk — in which case ask which version wins.
   *
   * Without this, Save silently overwrote a file that had moved ahead of the studio.
   * It happened for real: a model was repaired outside Obsidian, the studio was opened
   * with its older copy in memory, and one Save put the broken model straight back. The
   * status line had said "unsaved changes", which reads as "you have edits" rather than
   * "the file is not what you think it is".
   */
  async saveWithConflictCheck(): Promise<boolean> {
    const desc = this.plugin.saveState();
    if (desc.state !== "conflict") {
      await this.saveToNote();
      return true;
    }
    const path = this.plugin.settings.modelFiles[this.plugin.model.name] ?? "the file";
    const answer = await choose(
      this.app,
      `${path} changed on disk`,
      `It is not what this studio loaded. Reloading reads the file and discards what is ` +
        `on the canvas; overwriting writes the canvas over it.`,
      [
        { id: "reload", label: "Reload from disk", focused: true },
        { id: "overwrite", label: "Overwrite the file", warning: true },
        { id: "cancel", label: "Cancel" },
      ]
    );
    if (answer === "cancel" || answer === null) {
      this.setStatus("Not saved. The file on disk is newer than the studio.");
      return false;
    }
    if (answer === "reload") {
      await this.revertToSaved();
      return false;
    }
    await this.saveToNote();
    return true;
  }

  async offerToSave(reason: string): Promise<void> {
    const desc = this.plugin.saveState();
    const prompt = savePrompt(desc, this.plugin.model.name, this.plugin.settings.modelFiles[this.plugin.model.name] ?? null);
    if (!prompt) return;
    const wanted = await confirmSave(this.app, reason, prompt, desc.state === "unsaved");
    if (!wanted) {
      // Declining is a decision, not a failure: the status line keeps saying so.
      this.setStatus(`${reason}, but not saved.`);
      return;
    }
    await this.saveToNote();
  }

  /**
   * Redraw everything that shows the save state: the status line, the header, the tab.
   *
   * Called from the paths that CHANGE it -- the model being edited, saved or loaded. The
   * first version of the header was wired to this method, which nothing called, so the
   * model's name and file were drawn once at open and never again: reported as "the
   * file's name didn't update".
   */
  private refreshChrome(): void {
    this.renderStatus();
    this.refreshTitle();
    // The tab's label comes from `getDisplayText`, and Obsidian renders a header when it
    // chooses. This asks it to; the method is internal, so calling it is optional.
    const leaf = this.leaf as unknown as { updateHeader?: () => void };
    leaf?.updateHeader?.();
  }

  /** The model, its file, and the save state, in one line above the toolbar. */
  private refreshTitle(): void {
    if (!this.titleNameEl || !this.titleFileEl || !this.titleStateEl) return;
    const name = this.plugin.model?.name ?? "";
    const path = name ? this.plugin.settings.modelFiles[name] ?? null : null;
    const title = describeTitle(this.plugin.saveState(), name, path);
    this.titleNameEl.setText(title.name);
    this.titleFileEl.setText(title.file);
    this.titleStateEl.setText(title.state);
    this.titleStateEl.className = `modelica-studio-title-state ${title.stateClass}`;
  }

  /* ---------------- simulation ---------------- */

  async runSimulation(opts: { silent?: boolean } = {}): Promise<void> {
    if (this.busy) return;
    // Which model this run belongs to. A compile takes seconds, and the model can
    // be replaced while it runs; everything after the `await` used to re-read
    // `this.plugin.model`, so a finished run was adopted as the NEW model's result
    // and published under its name. Identity is the test, because every model
    // change replaces the object.
    const ranModel = this.plugin.model;
    const ranName = ranModel.name;
    // What is on screen is what runs: the code editor holds edits that have not
    // been parsed into the model yet, and simulating the previous version of the
    // source would be a lie about what was tested.
    this.flushEditorIntoModel();
    if (!this.plugin.backend) {
      if (!opts.silent) this.plugin.showSetupHelp();
      return;
    }
    // The share of the busy indicator is taken BEFORE the checks below, so every
    // early return releases what it took. (Matching them up is exactly the kind of
    // bookkeeping this counter exists to replace, so it is worth saying.)
    this.beginBusy();
    // An empty window is not a run, and OpenModelica does not say so: asked for
    // start=5, stop=1 it returns a valid two-sample result whose time is [5, 5],
    // which plotted as a blank canvas while the status line reported success.
    if (this.plugin.stopTime() <= this.plugin.settings.startTime) {
      const msg =
        `the run window is empty: start ${this.plugin.settings.startTime} s, ` +
        `end ${this.plugin.stopTime()} s. The end time must be greater than the start.`;
      this.setStatus(`Not run — ${msg}`);
      new Notice(`Modelica: ${msg}`, 8000);
      this.endBusy();
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
      this.endBusy();
      return;
    }

    this.busy = true;
    // Indeterminate: a compile is one opaque wait, and a bar that fills to a
    // number nobody knows would be a lie. The status line says what it is doing.
    setBusy(this.resultsEl, true);
    for (const b of this.runBtns) setButtonBusy(b, true, "play");
    const previous = this.statusEl?.textContent ?? "";
    this.setStatus("Simulating…");
    const t0 = performance.now();

    let source = "";
    let parameters: Record<string, string> = {};
    try {
      // As above, and for the same reason: what runs is what would be saved.
      source = this.plugin.sourceForSave();
      parameters = collectParameters(this.plugin.model);

      const result = await this.plugin.backend.simulate({
        modelName: ranName,
        source,
        parameters,
        startTime: this.plugin.settings.startTime,
        stopTime: this.plugin.stopTime(),
        numberOfIntervals: this.plugin.settings.numberOfIntervals,
        tolerance: this.plugin.settings.tolerance,
        solver: this.plugin.settings.solver || undefined,
      });

      if (this.plugin.model !== ranModel) {
        // The model was replaced while this was compiling. Its result belongs to a
        // model that is no longer on screen: adopting it would draw one model's
        // curves under another's name. Say so and drop it.
        this.setStatus(`${ranName} finished, but the studio moved on — the result was discarded.`);
        this.plugin.diag(`sim ${ranName}: discarded, the model changed while it ran`, "warn");
        return;
      }
      this.adoptResult(result);
      // A plain run replaces the run on screen, so the sweep's label no longer
      // describes it.
      this.lastSweep = null;
      this.lastSimulationError = null;
      this.setCodeStatus("");
      // A successful run clears the failure marker, so the tab only carries one
      // while the last run is actually broken.
      this.clearLogBadge();
      this.resetZoom();
      this.plugin.diag(
        `sim ${ranName}: t=${result.time[0]}..${result.time[result.time.length - 1]}` +
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
      // A new result has a new range, so the panel starts closed rather than
      // showing the previous run's limits.
      this.scaleOpen = false;
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
      this.endBusy();
    }
  }

  /**
   * Report the geometry of the main regions.
   *
   * A region that does not reach its neighbour shows as an unexplained band, and
   * which element is short is not visible from the outside.
   */
  private reportLayout(why = "open"): void {
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
      // `asked` beside the rendered box: a pane that ignored the height it was
      // given looked identical to one that had been given the wrong height.
      `layout${why === "open" ? "" : " (" + why + ")"}: resultsH=` +
        (this.resultsEl?.style.height || "(none)") +
        " | content=" + box(this.contentEl) +
        " root=" + box(q(".modelica-studio-root")) +
        " body=" + box(q(".modelica-studio-body")) +
        " canvasHost=" + box(q(".modelica-studio-canvas-host")) +
        " canvas=" + box(q(".modelica-studio-canvas")) +
        " palette=" + box(q(".modelica-studio-palette")) +
        // All three dividers, found by the one class they share. The old names
        // went stale with the markup and the diag silently reported nothing --
        // "?" is what a missing element looks like here, so it has to be checked.
        " paletteDiv=" + box(this.paletteSplitterEl) +
        " paletteW=" + (this.contentEl?.style.getPropertyValue("--ms-palette-width") || "?") +
        " inspectorDiv=" + box(this.splitterEl) +
        " inspector=" + box(q(".modelica-studio-inspector")) +
        " inspectorW=" + (this.contentEl?.style.getPropertyValue("--ms-inspector-width") || "?") +
        " resultsDiv=" + box(q(".modelica-studio-divider.is-row")) +
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
    // Through the plugin's own log rather than the console: the plugin directory's
    // guidelines ask for no unsolicited console output, and this is a debug surface that
    // the reader asked for by pressing the button.
    this.plugin.appendDiagnostic(text);
  }

  async saveToNote(): Promise<void> {
    try {
      const { path, created } = await this.plugin.saveModelToNote();
      new Notice(`Modelica: ${created ? "created" : "saved"} ${path}`, 4000);
      // The message is set AFTER the write, so the save state it appends is the
      // one the write produced rather than the one before it.
      this.setStatus(created ? `Created ${path}.` : `Saved ${path}.`);
      // The model has a path now, and the file has its edits. Both are in the header.
      this.refreshChrome();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Could not save: ${message}`, 8000);
      // A failed save must leave the state visibly unsaved, not merely quiet.
      this.setStatus(`Could not save: ${message}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */


/** Smallest height the results pane can be dragged to, in pixels. */

/** Components listed per package before the user narrows the search. */
const SEARCH_LIMIT = 200;

/** Variables listed before the filter must be used to narrow them. */
const SERIES_PAGE = 40;

/**
 * What an empty trace list says.
 *
 * "No variable matches that filter" was the only answer, and it is the wrong one
 * for a preset that has nothing to show: nothing is drawn yet, or nothing in this
 * model moves, or it has no derivatives. Each of those has its own way out.
 */
function emptySeriesMessage(preset: SeriesPreset, needle: string): string {
  if (needle) return "No variable matches that filter.";
  switch (preset.id) {
    case "active":
      return "No trace is being drawn yet — choose All to pick some.";
    case "varying":
      return "Nothing in this result changes over the run.";
    case "derivative":
      return "This result has no derivatives.";
    default:
      return "The result holds no variables.";
  }
}

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
 * Ask whether to save, with the answer as the two buttons rather than a checkbox.
 *
 * A dialog rather than a Notice: a Notice cannot be answered, and this needs an
 * answer. Cancel is focused, so a stray Enter does not write a file.
 */
function confirmSave(app: App, title: string, body: string, creates: boolean): Promise<boolean> {
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
    // The label says what will happen: creating a file and updating one are
    // different enough to name separately.
    const yes = buttons.createEl("button", {
      cls: "mod-cta",
      text: creates ? "Save as .mo" : "Save changes",
    });
    yes.addEventListener("click", () => done(true));
    const no = buttons.createEl("button", { text: "Not now" });
    no.addEventListener("click", () => done(false));
    modal.onClose = () => done(false);
    modal.open();
    window.setTimeout(() => no.focus(), 0);
  });
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
  const a = createEl("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
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
