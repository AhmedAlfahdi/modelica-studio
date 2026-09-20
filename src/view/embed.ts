/**
 * Inline, editable diagram embedded in a note.
 *
 * An Excalidraw-style block: the diagram is drawn and edited in place, and a
 * Simulate button runs it and plots the traces underneath. The note's code block
 * is the document — an edit rewrites it, so the diagram persists with the note
 * and can be diffed, copied and committed like any other text.
 *
 * The editor, serializer, simulation backend and plot renderer are the ones the
 * main view uses; this module only supplies the frame, the write-back and the
 * element lifetime. Reusing them matters beyond effort: it means a fix to the
 * canvas or the serializer reaches embedded diagrams too, rather than the two
 * drifting apart.
 */

import { Notice, type App } from "obsidian";
import type ModelicaStudioPlugin from "../main";
import { SchematicEditor } from "./editor";
import {
  drawPlot,
  layoutForResult,
  plotThemeFrom,
  seriesColor,
  summarize,
  timeAtPlotX,
  type SeriesStyle,
} from "./plot";
import { currentTheme } from "../render/theme";
import { parseModelica, findClass, toDiagramModel } from "../modelica/parser";
import { serializeDiagram } from "../modelica/serializer";
import { DirectiveOptions, withDirective } from "./modelica-lang";
import { EXAMPLES, findExample } from "../modelica/examples";
import type { DiagramModel } from "../modelica/types";
import type { SimResult } from "../omc/backend";
import { collectParameters } from "./parameters";
import { defaultSeriesNames } from "./series";
import type { ChartState } from "../settings";

/** Options parsed from the code block's info line. */
export interface EmbedOptions {
  /**
   * Whether the plot is shown beneath the diagram.
   *
   * The diagram is ALWAYS visible. An embedded diagram is the point of the
   * feature, so hiding it to show a plot in its place removes the thing the user
   * came for — and a plot is the result *of* the diagram, so the two belong
   * together. `result` therefore means "start with the plot open", not "instead
   * of the diagram".
   */
  showPlot: boolean;
  /** Canvas height in pixels. */
  height: number;
  /** Run a simulation as soon as the block renders. */
  autoSimulate: boolean;
  /**
   * Time span for this block, in seconds; 0 means use the plugin setting.
   *
   * A block carries the model it was written with, so it should carry the span
   * that model is meant to run over. Without this a note showing a 60 s thermal
   * model and a 1 s RC circuit would run both over whatever the last model in
   * the Studio happened to use.
   */
  stopTime: number;
}

/** Parse the text after the language tag, e.g. `modelica edit height=320`. */
export function parseEmbedOptions(info: string): EmbedOptions {
  const tokens = info.trim().split(/\s+/).slice(1);
  // A block in a note is a preview of a result. It simulates on open and shows
  // the plot, which is what someone reading a note wants; the editing surface
  // lives in the Modelica Studio view, one button away.
  const opts: EmbedOptions = { showPlot: true, height: 320, autoSimulate: true, stopTime: 0 };
  for (const t of tokens) {
    const [rawKey, rawValue] = t.split("=");
    const key = rawKey.toLowerCase();
    // `result`, `plot` and `both` all mean the same thing now: begin with the
    // plot open. `edit`/`diagram` are accepted for compatibility and mean begin
    // with it closed, since the diagram shows either way.
    if (key === "result" || key === "plot" || key === "both") opts.showPlot = true;
    else if (key === "edit" || key === "diagram") opts.showPlot = false;
    else if (key === "auto") opts.autoSimulate = true;
    else if (key === "noauto" || key === "manual") opts.autoSimulate = false;
    else if (key === "height" && rawValue) {
      const n = Number(rawValue);
      if (Number.isFinite(n) && n >= 120 && n <= 2000) opts.height = Math.floor(n);
    } else if ((key === "time" || key === "t") && rawValue) {
      const n = Number(rawValue);
      if (Number.isFinite(n) && n > 0) opts.stopTime = n;
    }
  }
  return opts;
}

/**
 * Everything the inline block needs from the plugin.
 *
 * Narrowed to an interface so the embed can be exercised in tests without a
 * whole Obsidian plugin, and so it is obvious what it depends on.
 */
/**
 * Options written as a directive comment on the block's first line.
 *
 *   ```modelica
 *   //@ time=20 height=400
 *   model T
 *   ...
 *
 * Obsidian calls a code-block processor with three arguments and does not pass
 * the fence's info string, so ` ```modelica time=20 ` is registered as the
 * language "modelica" and everything after it is dropped before the plugin sees
 * it. Verified at runtime: argc=3, no `alt` attribute. Options therefore live
 * inside the block, where they survive.
 */
const DIRECTIVE = /^\s*\/\/\s*@([^\n]*)$/m;

/** Split a directive line into `key=value` tokens. */
export function parseDirective(source: string): { opts: Partial<EmbedOptions>; body: string } {
  const m = DIRECTIVE.exec(source);
  if (!m) return { opts: {}, body: source };
  const tokens = m[1].trim().split(/\s+/).filter(Boolean);
  const opts: Partial<EmbedOptions> = {};
  for (const t of tokens) {
    const [rawKey, rawValue] = t.split("=");
    const key = rawKey.toLowerCase();
    if (key === "result" || key === "plot" || key === "both") opts.showPlot = true;
    else if (key === "edit" || key === "diagram") opts.showPlot = false;
    else if (key === "auto") opts.autoSimulate = true;
    else if (key === "noauto" || key === "manual") opts.autoSimulate = false;
    else if (key === "height" && rawValue) {
      const n = Number(rawValue);
      if (Number.isFinite(n) && n >= 120 && n <= 2000) opts.height = Math.floor(n);
    } else if ((key === "time" || key === "t") && rawValue) {
      const n = Number(rawValue);
      if (Number.isFinite(n) && n > 0) opts.stopTime = n;
    }
  }
  // The directive is removed: it is plugin metadata, not Modelica.
  return { opts, body: source.replace(DIRECTIVE, "").replace(/^\n+/, "") };
}

/**
 * Which pane a block was left showing, by model name.
 *
 * Obsidian rebuilds a code block's DOM on every re-render -- a keystroke in the
 * note, a metadata change, a theme switch -- and each rebuild constructs a fresh
 * embed whose directive default is "plot open". Without somewhere to keep the
 * choice, it lasted only until the note next re-rendered, which reads as the
 * view switching on its own.
 *
 * Module scope rather than per instance, because the instance is what is thrown
 * away. Keyed by model name: two blocks of the same model are the same diagram.
 */
const plotChoice = new Map<string, boolean>();

/**
 * Models whose block has already simulated itself once, this session.
 *
 * A block is destroyed and rebuilt every time its note re-renders, and editing a
 * diagram writes the note back -- so a single drag mounted the block four times
 * and ran four simulations, which reads as the block flashing while you move
 * something. One automatic run per model is what a reader needs; after that the
 * button is the only thing that starts one.
 */
const autoSimulated = new Set<string>();

/**
 * The last result per model, so a block rebuilt by a re-render is not blank.
 *
 * Without this, "never simulate twice" would mean an edit emptied the plot until
 * the reader pressed Simulate. The result is kept with the source it came from,
 * so a block whose model has changed since can say so rather than presenting a
 * stale curve as current.
 *
 * Bounded: a vault may hold any number of blocks, and a result is the largest
 * thing this plugin keeps in memory.
 */
const lastResults = new Map<
  string,
  { result: SimResult; styles: Record<string, SeriesStyle>; source: string }
>();
const LAST_RESULTS_MAX = 6;

/**
 * Which pane a block shows, given what its directive asks for and what the user
 * last chose.
 *
 * The choice wins: a block is rebuilt on every re-render, so a directive that
 * reopens the plot each time is the same fault as the automatic reveal below,
 * arriving by a different route.
 *
 * Exported for its own tests -- the rule is the part that can be wrong.
 */
export function effectiveShowPlot(directiveDefault: boolean, remembered: boolean | undefined): boolean {
  return remembered ?? directiveDefault;
}

/**
 * Whether a finished simulation should open the plot by itself.
 *
 * A user who has switched to the diagram means it, so a result must not overrule
 * them. It used to: the rule was "the plot is not showing", the block simulates
 * on open and re-renders re-open it, so the plot came back seconds after the
 * click and the pane looked like it was switching on its own. With no choice
 * recorded yet, a result is worth showing.
 */
export function shouldRevealPlot(showPlot: boolean, remembered: boolean | undefined): boolean {
  return !showPlot && remembered !== false;
}

export interface EmbedHost {
  /** Diagnostic sink; the plugin writes it to the debug log when enabled. */
  report?: (message: string) => void;
  /** Open the editing surface with this source, in the main view. */
  openDiagram?: (source: string) => void;
  /** The plot configuration for a model, or undefined before one is set. */
  chart?: (model: string) => ChartState | undefined;
  /** The span recorded for a model, falling back to its example or the default. */
  stopTimeFor: (model: string) => number;
  /** Record a new plot configuration and share it with the other views. */
  notifyChart?: () => void;
  app: App;
  library: { component(name: string): ReturnType<ModelicaStudioPlugin["library"]["component"]> };
  backend: ModelicaStudioPlugin["backend"];
  settings: ModelicaStudioPlugin["settings"];
  showSetupHelp(): void;
}

/**
 * One embedded diagram.
 *
 * Owns its container and tears its listeners down in `destroy`; Obsidian
 * re-creates code block elements on every re-render, so a block that leaks
 * listeners leaks them for the life of the app.
 */
export class EmbeddedDiagram {
  private editor: SchematicEditor | null = null;
  private plotCanvas: HTMLCanvasElement | null = null;
  private result: SimResult | null = null;
  private styles: Record<string, SeriesStyle> = {};
  private busy = false;
  private destroyed = false;
  private statusEl: HTMLElement | null = null;
  private plotHost: HTMLElement | null = null;
  /** Label of the plot toggle, so its wording can change with the state. */
  private plotButton: { setText(text: string): void } | null = null;
  private plotButtonBtn: HTMLButtonElement | null = null;
  /** The button element itself, for its tooltip. */
  /** Axis range adopted from the shared configuration. */
  private chartView: { xMin?: number; xMax?: number; yMin?: number; yMax?: number } = {};
  /** The parameter values the current result was produced with. */
  private lastParameters: Record<string, string> | null = null;
  private readonly resizeHandler = () => this.drawPlot();
  /** The data x under the pointer on the plot, or undefined when it is away. */
  private cursorX: number | undefined;
  /** The block's own t_end field, so it can be reset when a value is refused. */
  private timeInput: HTMLInputElement | null = null;
  /** True when the result on screen came from an earlier version of the source. */
  private stale = false;
  /** Watches the plot pane's width; a window resize does not cover it. */
  private plotObserver?: ResizeObserver;

  constructor(
    private readonly host: EmbedHost,
    private readonly container: HTMLElement,
    source: string,
    opts: EmbedOptions,
    /** Replace the block's text so the edit persists in the note. */
    private readonly writeBack: (source: string) => void
  ) {
    const { opts: fromBlock, body } = parseDirective(source);
    /** The span the block itself declared, if it declared one. */
    this.blockStopTime = fromBlock.stopTime;
    this.source = body;
    this.opts = { ...opts, ...fromBlock };
    // What the user last chose wins over the directive: the block is rebuilt on
    // every re-render, and a directive that reopens the plot each time is the
    // same fault as the automatic reveal below, arriving by a different route.
    this.opts.showPlot = effectiveShowPlot(this.opts.showPlot, this.rememberedPlotChoice());
  }

  private source: string;
  private readonly opts: EmbedOptions;

  /** Build the DOM and load the model. */
  /**
   * Whether this block may run itself, recording that it did.
   *
   * Keyed by model rather than by instance, because the instance is exactly what
   * a re-render throws away.
   */
  private claimAutoSimulation(): boolean {
    const name = this.modelName();
    if (!name) return true;
    if (autoSimulated.has(name)) return false;
    autoSimulated.add(name);
    return true;
  }

  /** Repaint the last result for this model, if there is one. */
  private restoreLastResult(): void {
    const name = this.modelName();
    const kept = name ? lastResults.get(name) : undefined;
    if (!kept || this.result) return;
    this.result = kept.result;
    this.styles = { ...kept.styles };
    // Whether the run still describes the model in front of the reader. The
    // block is rebuilt on every edit, so the alternative to saying this is
    // showing a curve that no longer matches the source without a word.
    this.stale = kept.source !== this.source;
    this.drawPlot();
    this.reportResultStatus();
  }

  /** Remember a finished run for the next time this model's block is rebuilt. */
  private rememberResult(): void {
    const name = this.modelName();
    if (!name || !this.result) return;
    lastResults.delete(name);
    lastResults.set(name, {
      result: this.result,
      styles: { ...this.styles },
      source: this.source,
    });
    while (lastResults.size > LAST_RESULTS_MAX) {
      const oldest = lastResults.keys().next().value;
      if (oldest === undefined) break;
      lastResults.delete(oldest);
    }
    this.stale = false;
  }

  /** The samples/varying line, saying so when the run predates the source. */
  private reportResultStatus(): void {
    const r = this.result;
    if (!r) return;
    const varying = r.series.filter((s) => {
      const v = (s.values ?? []).filter(Number.isFinite);
      return v.length > 1 && Math.max(...v) - Math.min(...v) > 1e-9;
    }).length;
    const counts =
      varying === 0
        ? `${r.time.length} samples · nothing varies`
        : `${r.time.length} samples · ${varying} varying`;
    this.setStatus(
      this.stale ? `${counts} · from the previous run, press Simulate` : `${counts} · ${r.simulateMs} ms`
    );
  }

  mount(): void {
    const root = this.container;
    root.empty();
    root.addClass("modelica-studio-embed");

    root.createDiv({
      cls: "modelica-studio-embed-head",
      text: this.modelName() ?? "Modelica",
    });

    const toolbar = root.createDiv({ cls: "modelica-studio-embed-toolbar" });
    const button = (label: string, cls: string, onClick: () => void) => {
      const b = toolbar.createEl("button", { cls: `modelica-studio-btn ${cls}`.trim() });
      // Keep the label element: setting text on the button itself would replace
      // the span rather than the words inside it.
      const span = b.createSpan({ text: label });
      b.addEventListener("click", onClick);
      return { b, span };
    };
    button("Simulate", "mod-cta", () => void this.simulate());
    // The span the block runs over, as a field. The Studio has had one in its
    // results row all along; a block's span was reachable only by editing the
    // directive text, which is not something to ask of someone reading a note.
    const time = toolbar.createDiv({ cls: "modelica-studio-embed-time" });
    time.createSpan({ cls: "modelica-studio-muted", text: "t_end" });
    const endInput = time.createEl("input", {
      type: "number",
      cls: "modelica-studio-embed-time-input",
      attr: { step: "any", min: "0" },
    });
    endInput.value = String(this.span());
    this.timeInput = endInput;
    const applyTime = () => this.applyStopTime(Number(endInput.value));
    endInput.addEventListener("change", applyTime);
    endInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        applyTime();
      }
    });
    time.createSpan({ cls: "modelica-studio-muted", text: "s" });
    // The editing surface belongs to the main view, so the block links to it
    // rather than trying to reproduce an editor inside a note.
    const open = toolbar.createEl("button", { cls: "modelica-studio-btn" });
    open.createSpan({ text: "Open diagram" });
    open.addEventListener("click", () => this.host.openDiagram?.(this.source));
    button("Fit", "", () => this.editor?.scheduleFit());
    // The pane shows either the plot or the diagram, so this swaps between them.
    // "Hide plot" named only half of that: pressing it also brings the diagram
    // back, which is not what a button labelled "hide" leads one to expect.
    const toggle = button(
      this.opts.showPlot ? "Switch to diagram" : "Switch to plot",
      "",
      () => this.setPlotVisible(!this.opts.showPlot, true)
    );
    this.plotButton = toggle.span;
    this.plotButtonBtn = toggle.b;
    this.statusEl = toolbar.createDiv({ cls: "modelica-studio-embed-status" });

    const canvasHost = root.createDiv({ cls: "modelica-studio-embed-canvas" });
    canvasHost.style.height = `${this.opts.height}px`;
    this.plotHost = root.createDiv({ cls: "modelica-studio-embed-plot" });

    this.applyPlotVisibility();

    const model = this.parse();
    if (!model) {
      root.createDiv({
        cls: "modelica-studio-embed-error",
        text: "No Modelica class with components was found in this block.",
      });
      return;
    }

    this.editor = new SchematicEditor(canvasHost, model, {
      lookup: (n) => this.host.library.component(n),
      onChange: (m) => this.persist(m),
      onStatus: (t) => this.setStatus(t),
      // The same two settings the Studio passes. Without a `display` callback
      // the editor falls back to its own default -- label scale 1, no hover
      // readout -- so the setting existed, said it applied to hovering a
      // component, and did nothing in a note, which is the surface most people
      // read a diagram on.
      display: () => ({
        labelScale: this.host.settings.labelScale,
        hoverParameters: this.host.settings.hoverParameters,
      }),
    });
    // Paint now, and fit once the element has been measured.
    //
    // The two are separate on purpose. `scheduleFit` is deferred while the block
    // has no size — it is rendered before a note is laid out — and a canvas of
    // zero size is not painted at all, so waiting on the fit left the diagram
    // blank. Asking for a frame unconditionally means the diagram appears as
    // soon as there is anything to draw on, and the fit then frames it.
    // Fitted once, when the block is first measured; see `autoFit`.
    this.editor.autoFit = false;
    this.editor.requestDraw();
    this.diag("mounted");
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        this.editor?.resize();
        this.editor?.requestDraw();
        this.editor?.scheduleFit();
        this.diag("frame 1");
      });
    }
    // A second, later measurement. `requestAnimationFrame` runs before a note is
    // laid out, so the block is still zero-sized there; this catches the size
    // arriving without depending on a resize event.
    window.setTimeout(() => {
      if (this.destroyed) return;
      this.editor?.resize();
      this.editor?.requestDraw();
      this.editor?.scheduleFit();
      this.diag("after 250 ms");
    }, 250);

    if (this.opts.autoSimulate && this.claimAutoSimulation()) void this.simulate();
    // A block that has already run this session repaints what it last had, so a
    // re-render does not blank the pane while the reader is editing something.
    else this.restoreLastResult();
  }

  /** Report the embed's own geometry, for diagnosing a blank diagram. */
  private diag(stage: string): void {
    const host = this.container.querySelector<HTMLElement>(".modelica-studio-embed-canvas");
    const canvas = host?.querySelector("canvas");
    const ed = this.editor as unknown as {
      cssWidth?: number;
      cssHeight?: number;
      dpr?: number;
      drawCount?: number;
    } | null;
    this.host.report?.(
      `embed ${this.modelName() ?? "?"} ${stage}: host=${host?.clientWidth ?? -1}x${host?.clientHeight ?? -1}` +
        ` canvasAttr=${canvas?.width ?? -1}x${canvas?.height ?? -1}` +
        ` editor=${ed?.cssWidth ?? -1}x${ed?.cssHeight ?? -1} dpr=${ed?.dpr ?? -1}` +
        ` draws=${ed?.drawCount ?? -1}`
    );
  }

  /**
   * Adopt a span typed into the block's own field.
   *
   * The value goes into the block's directive rather than the shared per-model
   * setting: a block's own span beats the model's, so writing it anywhere else
   * would leave the field showing one number while the block ran another.
   */
  private applyStopTime(value: number): void {
    if (!Number.isFinite(value) || value <= 0) {
      if (this.timeInput) this.timeInput.value = String(this.span());
      return;
    }
    this.opts.stopTime = value;
    this.blockStopTime = value;
    // Into the note, so the number survives a reload the same way a moved
    // component does.
    const model = this.editor?.getModel() ?? this.parse();
    if (model) this.persist(model);
    void this.simulate();
  }

  /** The pane this model was last left showing, if the user has chosen. */
  private rememberedPlotChoice(): boolean | undefined {
    const name = this.modelName();
    return name ? plotChoice.get(name) : undefined;
  }

  /** The class name declared in the source, for the heading. */
  private modelName(): string | undefined {
    const m = /^\s*model\s+([A-Za-z_]\w*)/m.exec(this.source);
    return m?.[1];
  }

  private parse(): DiagramModel | undefined {
    try {
      const classes = parseModelica(this.source);
      if (classes.length === 0) return undefined;
      const target = classes.find((c) => c.components.length > 0) ?? classes[0];
      return toDiagramModel(target, (n) => this.host.library.component(n));
    } catch {
      return undefined;
    }
  }

  /**
   * The span the block's own `//@` line declared, when it declared one.
   *
   * Kept so a write-back can re-emit the directive. Without it the line was
   * lost the first time the block was edited in the studio, and the block then
   * inherited the studio's current span instead of its own.
   */
  private blockStopTime: number | undefined;

  /**
   * The directive to write back.
   *
   * The span is re-emitted when the block declared one OR when it has since
   * been changed by the host — a user who adjusts the span in the studio
   * expects the note to follow, and the block's declared value is what records
   * that it was a deliberate choice rather than a default.
   */
  private directiveOptions(): DirectiveOptions {
    const effective = this.span();
    const declaredOwn = this.blockStopTime !== undefined;
    const hostChanged =
      declaredOwn && this.host.stopTimeFor(this.modelName() ?? "") !== this.blockStopTime;
    return {
      stopTime: declaredOwn || hostChanged ? effective : undefined,
      height: this.opts.height,
      showPlot: this.opts.showPlot,
      autoSimulate: this.opts.autoSimulate,
    };
  }

  /** Re-serialize and write the block back, debounced so a drag is one write. */
  private writeTimer: number | null = null;
  private persist(model: DiagramModel): void {
    // The directive is re-attached here, not at the write-back, so `source` and
    // what the note receives always agree.
    this.source = withDirective(serializeDiagram(model), this.directiveOptions());
    if (this.writeTimer !== null) window.clearTimeout(this.writeTimer);
    this.writeTimer = window.setTimeout(() => {
      this.writeTimer = null;
      if (!this.destroyed) this.writeBack(this.source);
    }, 400);
  }

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.setText(text);
  }

  /**
   * Show or hide the plot. The diagram is never hidden.
   *
   * `byUser` distinguishes a click from the automatic reveal below: a click is a
   * decision to keep, an automatic reveal is only a default.
   */
  private setPlotVisible(visible: boolean, byUser = false): void {
    this.opts.showPlot = visible;
    if (byUser) {
      const name = this.modelName();
      if (name) plotChoice.set(name, visible);
    }
    this.applyPlotVisibility();
  }

  private applyPlotVisibility(): void {
    // The label lives here rather than in `setPlotVisible`, because this also
    // runs while building the block. Setting it only on the click path left the
    // button blank until it had been pressed once.
    const visible = this.opts.showPlot;
    if (this.plotButton) this.plotButton.setText(visible ? "Switch to diagram" : "Switch to plot");
    // A tooltip that says what happens to the pane, not a repeat of the button.
    // Only one attribute: the aria-label that used to sit here as well rendered a
    // second tooltip in Obsidian's own style, on top of the browser's.
    if (this.plotButtonBtn) {
      this.plotButtonBtn.setAttr(
        "aria-label",
        visible ? "Show the schematic instead of the plot" : "Show the result plot instead of the schematic"
      );
    }

    const host = this.plotHost;
    if (host) host.style.display = this.opts.showPlot ? "" : "none";
    const canvas = this.container.querySelector<HTMLElement>(".modelica-studio-embed-canvas");
    if (canvas) {
      // Collapsed while the plot is shown, so the block does not carry hundreds
      // of pixels of empty canvas above its result — but taken OUT OF FLOW
      // rather than hidden. `display: none` measures 0x0, which would leave the
      // editor unable to size or draw itself for when the user switches back.
      canvas.style.display = "";
      canvas.style.position = this.opts.showPlot ? "absolute" : "relative";
      canvas.style.visibility = this.opts.showPlot ? "hidden" : "";
      canvas.style.pointerEvents = this.opts.showPlot ? "none" : "";
      // The box keeps its full size so it still measures; only its visibility
      // changes. `display: none` or `height: 0` would both report 0x0 and leave
      // the editor unable to size itself.
      canvas.style.height = `${this.opts.height}px`;
    }
    if (this.opts.showPlot) {
      this.drawPlot();
      this.editor?.resize();
      this.editor?.requestDraw();
    } else {
      this.editor?.resize();
      this.editor?.requestDraw();
    }
  }

  /** Run the embedded model and plot it. */
  async simulate(): Promise<void> {
    if (this.busy || this.destroyed) return;
    if (!this.host.backend) {
      this.host.showSetupHelp();
      return;
    }
    const model = this.editor?.getModel() ?? this.parse();
    if (!model) return;

    // The span a block runs over is easy to get wrong invisibly: it inherits the
    // plugin setting when the block declares none, and a mismatched window shows
    // a plausible but useless plot.
    this.host.report?.(
      `embed ${model.name}: info="${this.infoLine}" span=${this.span()}s (declared ${this.opts.stopTime})`
    );

    this.busy = true;
    this.setStatus("Simulating…");
    // The studio's values win: the block follows the shared configuration, so it
    // must run with what the studio is showing rather than its own reading of
    // the source it was written with.
    const effective = { ...collectParameters(model), ...(this.host.chart?.(this.modelName() ?? "")?.parameters ?? {}) };
    try {
      const result = await this.host.backend.simulate({
        modelName: model.name,
        source: this.source,
        parameters: effective,
        startTime: this.host.settings.startTime,
        stopTime: this.span(),
        numberOfIntervals: this.host.settings.numberOfIntervals,
        tolerance: this.host.settings.tolerance,
        solver: this.host.settings.solver || undefined,
      });
      if (this.destroyed) return;
      this.result = result;
      this.lastParameters = effective;
      // A built-in example names what it demonstrates; otherwise show the
      // variables that move rather than the first four declared.
      const preferred = findExample(model.name)?.series ?? [];
      const wanted = preferred.filter((n) => result.series.some((s) => s.name === n));
      const sharedTrace = this.host.chart?.(this.modelName() ?? "")?.traces;
      const seed = new Set(
        sharedTrace
          ? sharedTrace.filter((n) => result.series.some((s) => s.name === n))
          : wanted.length
            ? wanted
            : defaultSeriesNames(result, 4)
      );
      // Mark the rest hidden explicitly: `drawPlot` draws anything not hidden,
      // so only seeding the chosen traces would draw all of them.
      result.series.forEach((s, i) => {
        this.styles[s.name] ??= {
          color: seriesColor(i, currentTheme().dark),
          visible: seed.has(s.name),
        };
      });
      // Kept for the next time this block is rebuilt, then reported: a result
      // whose every variable is constant plots as a flat line, which reads as a
      // failure, so that is said rather than presented as success.
      this.rememberResult();
      this.reportResultStatus();
      void summarize;
      // A simulation is only useful if its result is visible -- but a user who
      // has switched to the diagram has said they want the diagram, and this
      // line used to overrule them the moment any simulation finished. Since the
      // block simulates on open, and re-renders re-open it, that was often
      // seconds after the click: the pane appeared to switch by itself.
      if (shouldRevealPlot(this.opts.showPlot, this.rememberedPlotChoice())) this.setPlotVisible(true);
      else this.drawPlot();
    } catch (err) {
      if (this.destroyed) return;
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus("Simulation failed");
      new Notice(`Modelica: ${message.split("\n")[0]}`, 8000);
    } finally {
      this.busy = false;
    }
  }

  /** Render the result into the inline plot. */
  drawPlot(): void {
    const host = this.plotHost;
    if (!host || !this.result || this.destroyed) return;

    // The pane's width, not a remembered one. The canvas carries a fixed inline
    // width so the bitmap cannot be stretched, which also means a stale value is
    // never corrected by the browser — it just leaves the drawing short of the
    // right edge. The canvas is hidden while the diagram shows, so fall back to
    // the container for the width in that state.
    const width = Math.max(200, Math.floor(host.clientWidth || this.container.clientWidth || 480));
    // The height the block asked for, for whichever pane is showing. A fraction
    // of the width stood here instead, so `height=...` appeared to do nothing at
    // all whenever the plot was the pane on show -- which is the default.
    const height = Math.max(120, Math.round(this.opts.height));
    let canvas = this.plotCanvas;
    if (!canvas) {
      canvas = host.createEl("canvas", { cls: "modelica-studio-embed-plot-canvas" });
      this.plotCanvas = canvas;
      window.addEventListener("resize", this.resizeHandler);
      this.observePlotHost(host);
      canvas.addEventListener("pointermove", this.plotPointerMove);
      canvas.addEventListener("pointerleave", this.plotPointerLeave);
    }
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    // Assigning width or height reallocates the backing store and clears the
    // canvas, so it is done only when the size actually changed: the hover
    // readout repaints on every pointer move.
    const pixelW = Math.floor(width * dpr);
    const pixelH = Math.floor(height * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }
    if (canvas.style.width !== `${width}px`) canvas.style.width = `${width}px`;
    if (canvas.style.height !== `${height}px`) canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const theme = currentTheme();
    // The layout the renderer is about to paint with, so the readout is sized to
    // the box that exists rather than to a guess.
    const lay = layoutForResult(width, height, this.result, this.styles);
    drawPlot(ctx, width, height, this.result, {
      theme: plotThemeFrom(theme),
      legendBackground: theme.plotLegendBackground,
      styles: this.styles,
      view: this.plotView(),
      dpr,
      cursorX: this.cursorX,
      // As many traces as the box has room for rather than a fixed six: the pane
      // is as tall as the note makes it, and a readout taller than the plot runs
      // off the bottom.
      cursorRows: Math.max(1, Math.floor((height - lay.top - 16) / 14) - 1),
    });
  }

  /** The plotted range: whatever the shared configuration says, else the run. */
  private plotView(): { xMin: number; xMax: number; yMin?: number; yMax?: number } {
    const t = this.result?.time ?? [];
    const full = t.length === 0 ? { xMin: 0, xMax: 1 } : { xMin: t[0], xMax: t[t.length - 1] };
    const shared = this.host.chart?.(this.modelName() ?? "");
    return {
      xMin: this.chartView.xMin ?? shared?.xMin ?? full.xMin,
      xMax: this.chartView.xMax ?? shared?.xMax ?? full.xMax,
      yMin: this.chartView.yMin ?? shared?.yMin,
      yMax: this.chartView.yMax ?? shared?.yMax,
    };
  }

  /** The block's own info line, kept for diagnostics. */
  infoLine = "";

  /**
   * This block's time span.
   *
   * Its own directive wins; otherwise the span recorded for ITS model; otherwise
   * the plugin default. Reading a single shared setting here meant a block
   * showing a 250 s thermal model ran over whatever span the Studio last used
   * for a different model.
   */
  private span(): number {
    if (this.opts.stopTime > 0) return this.opts.stopTime;
    const model = this.modelName();
    if (model) return this.host.stopTimeFor(model);
    return this.host.settings.stopTime;
  }

  /**
   * Adopt the plot configuration the studio is showing.
   *
   * Called when the studio adjusts its scale or its traces, so a note's blocks
   * stay in step with it. A trace the current result does not have is ignored:
   * the studio may be showing a different model.
   */
  applyChart(): void {
    const chart = this.host.chart?.(this.modelName() ?? "");
    if (!chart || !this.result) return;
    for (const [i, s] of this.result.series.entries()) {
      const style = (this.styles[s.name] ??= {
        color: seriesColor(i, currentTheme().dark),
        visible: false,
      });
      style.visible = chart.traces.includes(s.name);
    }
    this.chartView = {
      xMin: chart.xMin,
      xMax: chart.xMax,
      yMin: chart.yMin,
      yMax: chart.yMax,
    };
    this.drawPlot();

    // Parameter values are part of the same configuration, but adopting them
    // means RUNNING again — they cannot be painted on. Without this the block
    // kept showing the result of the values the studio had since changed.
    if (this.parametersDiffer(chart.parameters)) void this.simulate();
  }

  /** Whether the shared parameter values differ from the ones last run. */
  private parametersDiffer(shared: Record<string, string> | undefined): boolean {
    if (!shared) return false;
    const mine = this.lastParameters ?? {};
    const keys = new Set([...Object.keys(shared), ...Object.keys(mine)]);
    for (const k of keys) if (shared[k] !== mine[k]) return true;
    return false;
  }

  /**
   * Redraw when the pane changes width.
   *
   * A window resize is not enough: opening a sidebar or dragging a splitter
   * changes the note's width while the window stays the same size, and the
   * canvas keeps the width it was first drawn at.
   */
  private observePlotHost(host: HTMLElement): void {
    if (this.plotObserver || typeof ResizeObserver === "undefined") return;
    this.plotObserver = new ResizeObserver(() => this.drawPlot());
    this.plotObserver.observe(host);
  }

  /**
   * Track the pointer across the plot and read the values off the crosshair.
   *
   * The same readout the Studio's plots have. It is bound to the canvas rather
   * than to the pane so it goes quiet by itself when the diagram is the pane on
   * show -- a hidden canvas receives no pointer events.
   */
  private readonly plotPointerMove = (ev: PointerEvent) => {
    const canvas = this.plotCanvas;
    if (!this.result || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const next = timeAtPlotX(
      ev.clientX - rect.left,
      rect.width,
      rect.height,
      this.result,
      this.styles,
      this.plotView()
    );
    // Redrawing only when the reading changed keeps a pointer sweeping the
    // margins from repainting the plot on every event.
    if (next === undefined && this.cursorX === undefined) return;
    this.cursorX = next;
    this.drawPlot();
  };

  private readonly plotPointerLeave = () => {
    if (this.cursorX === undefined) return;
    this.cursorX = undefined;
    this.drawPlot();
  };

  /** Repaint after a settings change that the diagram reads while drawing. */
  refreshDiagram(): void {
    this.editor?.requestDraw();
  }

  /** Release listeners and the editor. */
  destroy(): void {
    this.destroyed = true;
    if (this.writeTimer !== null) window.clearTimeout(this.writeTimer);
    this.writeTimer = null;
    window.removeEventListener("resize", this.resizeHandler);
    this.plotObserver?.disconnect();
    this.plotObserver = undefined;
    this.editor?.destroy();
    this.editor = null;
    const canvas = this.plotCanvas;
    if (canvas) {
      canvas.removeEventListener("pointermove", this.plotPointerMove);
      canvas.removeEventListener("pointerleave", this.plotPointerLeave);
    }
    this.plotCanvas = null;
    this.plotHost = null;
    this.result = null;
  }
}

/**
 * Source used when a block is empty.
 *
 * An empty block is what a user gets by typing the fence and nothing else, so it
 * must produce something they can immediately edit and simulate rather than an
 * error.
 */
export function starterSource(): string {
  return findExample("Electrical")?.source ?? EXAMPLES[0].source;
}

/**
 * Replace a fenced block's body in a note.
 *
 * `lineStart` and `lineEnd` are the fences themselves, as Obsidian reports them,
 * so only the content between them is replaced. Extracted from the plugin so the
 * arithmetic can be tested directly: getting it wrong corrupts the user's note,
 * which is the worst thing this feature could do.
 *
 * Returns the text unchanged when the range is not usable, so a bad report can
 * never delete content.
 */
export function replaceFencedBlock(
  text: string,
  lineStart: number,
  lineEnd: number,
  body: string
): string {
  const lines = text.split("\n");
  const from = lineStart + 1;
  const to = lineEnd;
  // Every bound must be usable. `splice` clamps an over-long delete count to the
  // end of the array, so an out-of-range `lineEnd` would silently delete the
  // rest of the note — the one outcome that must never happen here.
  if (lineStart < 0 || lineEnd < 0) return text;
  if (from > to || from >= lines.length || to >= lines.length) return text;
  lines.splice(from, to - from, ...body.split("\n"));
  return lines.join("\n");
}
