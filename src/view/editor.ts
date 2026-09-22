/**
 * The schematic editor: selection, dragging, resizing, wiring, multi-select,
 * undo/redo, clipboard and keyboard navigation.
 *
 * ## Interaction model
 *
 * Pointer events resolve in a fixed priority so a gesture is never ambiguous:
 *
 *   1. resize handle   (only for a lone selection)
 *   2. pan             (middle button, right button, or Shift)
 *   3. component body  -> select and drag
 *   4. component port  -> start a wire
 *   5. empty space     -> rubber-band select
 *
 * The body is tested before the ports on purpose: Modelica pins sit exactly on
 * a component's extent edge, so a generous port hit area would swallow the
 * whole symbol and turn every click into an accidental wire.
 *
 * ## Two subtle rules
 *
 * **Keyboard ownership.** Shortcuts are bound to the document, not the canvas.
 * Binding them to the canvas meant Delete, Ctrl+A and Ctrl+0 silently stopped
 * working as soon as focus moved to the palette, a parameter field or the
 * toolbar — which is most of the time in real use. Only one editor claims the
 * keyboard at a time, and only while the pointer is over its canvas or it holds
 * focus, so other Obsidian panes are unaffected.
 *
 * **Selection is observable.** Selection changes are reported through
 * `onSelectionChange`. Without that, the inspector and toolbar had no way to
 * know what was selected, so clicking a component appeared to do nothing.
 */

import type {
  ComponentClass,
  ComponentInstance,
  Connection,
  DiagramModel,
  Viewport,
} from "../modelica/types";
import { emptyDiagram } from "../modelica/types";
import { currentTheme, type Theme } from "../render/theme";
import { effectiveStrokeScales } from "../settings-merge";
import {
  connectorWireStyle,
  LINE_THICKNESS_UNIT,
  type ConnectorWireStyle,
} from "../render/connector-style";
import {
  apply,
  defaultComponentSize,
  defaultExtent,
  diagramBounds,
  instanceHitBounds,
  instanceOutlineBounds,
  mul,
  placementTransform,
  transformedBounds,
  viewportTransform,
  distanceToPolyline,
  drawComponent,
  drawConnection,
  drawHandles,
  drawWireVertices,
  nearestVertexIndex,
  polylineInBox,
  drawPorts,
  findPortAt,
  hoverParameterLines,
  placeReadout,
  handleCursor,
  hitTestComponent,
  hitTestHandle,
  portPosition,
  resizeExtent,
  routeConnection,
  type ResizeHandle,
} from "../render/canvas";
import { History, PASTE_OFFSET } from "./history";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface EditorCallbacks {
  /** Look up a class definition for rendering and port geometry. */
  lookup: (className: string) => ComponentClass | undefined;
  /** Called whenever the model changes, for persistence and preview. */
  onChange?: (model: DiagramModel) => void;
  /** Called whenever the selection changes. */
  onSelectionChange?: (ids: string[]) => void;
  /** Resolve `%param` macros in icon text. */
  resolveParam?: (inst: ComponentInstance, name: string) => string | undefined;
  /** Report transient status text (e.g. "moved 3 components"). */
  onStatus?: (text: string) => void;
  /**
   * Text scales, wire weight and the hover readout, from the settings.
   *
   * Read on every frame rather than captured at construction, so changing the
   * setting shows immediately instead of after the editor is rebuilt.
   */
  display?: () => {
    labelScale: number;
    hoverParameters: boolean;
    /** Font scale of the parameter popup. */
    readoutScale?: number;
    /** Stroke weight of the wires, as a multiple of the standard. */
    wireScale?: number;
    /** Whether the name under each component is drawn. */
    instanceLabels?: boolean;
    /** Multiplier on the weight of the lines the component symbols are drawn with. */
    symbolStrokeScale?: number;
    /**
     * Whether the two weights above are one setting.
     *
     * Resolved HERE, not by each surface: the link is a rule about how the two
     * settings combine, and a surface that forgot to apply it would draw a
     * different diagram from the same settings.
     */
    syncStrokeScale?: boolean;
  };
  /** Read text from the system clipboard. */
  readClipboard?: () => Promise<string>;
  /** Write text to the system clipboard. */
  writeClipboard?: (text: string) => Promise<void>;
  /**
   * Diagnostic hook, used to record why a press resolved the way it did.
   * Off unless the debug log is enabled.
   */
  onDiagnostic?: (info: {
    /** Present on the once-per-press "map" record. */
    boxes?: { id: string; box: [number, number, number, number] }[];
    clientX: number;
    clientY: number;
    rectLeft: number;
    rectTop: number;
    canvasCss: [number, number];
    canvasBacking: [number, number];
    canvasRect?: [number, number];
    canvasStyle?: [number, number];
    windowDpr?: number;
    dpr: number;
    reconstructed?: [number, number];
    pointerLocal?: [number, number];
    modifiers?: { shift: boolean; ctrl: boolean; meta: boolean; alt: boolean; button: number };
    viewport: { x: number; y: number; scale: number };
    diagram: [number, number];
    bodyHit?: string;
    portHit?: { component: string; port: string; distance: number; withinBody: boolean };
    handleHit?: string;
    outcome: string;
  }) => void;
}

type Interaction =
  | { kind: "none" }
  | { kind: "pan"; lastX: number; lastY: number }
  | {
      kind: "maybeDrag";
      id: string;
      startX: number;
      startY: number;
      grabDX: number;
      grabDY: number;
      /** Extents captured at gesture start, so a multi-drag stays rigid. */
      origin: Map<string, [number, number, number, number]>;
      moved: boolean;
    }
  | {
      kind: "resize";
      id: string;
      handle: ResizeHandle;
      startExtent: [number, number, number, number];
      moved: boolean;
    }
  | {
      kind: "rubber";
      startX: number;
      startY: number;
      x: number;
      y: number;
      additive: boolean;
      baseSelection: Set<string>;
      baseWireSelection: Set<string>;
    }
  | {
      /**
       * Dragging one corner of a wire to re-route it.
       *
       * `index` is a VERTEX index, so the flat points array is indexed at
       * `index * 2`. Only interior vertices are ever dragged: the first and last
       * are the pins, and `connectionPoints` rewrites them from the ports on
       * every draw, so a drag there would snap straight back.
       */
      kind: "wireVertex";
      connId: string;
      index: number;
      startX: number;
      startY: number;
      moved: boolean;
    }
  | {
      /**
       * Pressed on a pin, but not yet committed to wiring.
       *
       * A pin sits on the component's edge and its own lead is part of the
       * symbol, so the press may equally mean "select this component". Which
       * gesture it is only becomes clear once the pointer moves, so the wire is
       * armed here and promoted on the first real movement. Committing on
       * pointerdown instead made clicks on a pin — or anywhere within the grab
       * radius of one — start a wire rather than select.
       */
      kind: "armWire";
      from: { component: string; port: string };
      fromPos: [number, number];
      startX: number;
      startY: number;
      toX: number;
      toY: number;
      hoverPort?: { component: string; port: string };
    }
  | {
      kind: "wire";
      from: { component: string; port: string };
      fromPos: [number, number];
      toX: number;
      toY: number;
      hoverPort?: { component: string; port: string };
    };

/* ------------------------------------------------------------------ */
/* Editor                                                             */
/* ------------------------------------------------------------------ */

export class SchematicEditor {
  model: DiagramModel;
  viewport: Viewport = { x: 0, y: 0, scale: 1 };
  readonly history = new History();
  /**
   * Draw the coordinate diagnostics: the click marker, the clickable region and
   * the drawn box for every component, plus the live viewport readout.
   *
   * Driven by the "Show coordinate diagnostics" setting. Off by default; the
   * Geometry button reports the same information as text.
   */
  showProbe = false;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rafId: number | null = null;
  private dpr = 1;

  private interaction: Interaction = { kind: "none" };
  private selection = new Set<string>();
  /**
   * Selected wires, by connection id.
   *
   * Kept SEPARATE from `selection` rather than mixed into it with a prefix. Every
   * consumer of `selection` -- the inspector, copy, the "still alive" filter after
   * an undo, rotation -- assumes a component id, and a wire id in there would be
   * silently dropped by some of them and passed to a component lookup by others.
   * Two sets make that class of mistake impossible instead of merely unlikely.
   *
   * A connection's id is `component.port|component.port`, which cannot collide
   * with the other set anyway.
   */
  private wireSelection = new Set<string>();
  /** The wire under the pointer, so it can be shown as clickable. */
  private hoveredWire: string | null = null;
  private hovered: string | null = null;
  private hoveredPort: { component: string; port: string } | undefined;
  /** Pin the current press is armed on, before the gesture is decided. */
  private armedPort: { component: string; port: string } | undefined;
  /**
   * Where the editor thinks the last press landed, in screen pixels relative to
   * the canvas. Drawn briefly so a mismatch between the pointer and the
   * editor's idea of it is visible on screen rather than inferred.
   */
  private probePoint: { x: number; y: number; at: number } | null = null;
  private probeTimer: number | null = null;

  /** Serialised fragment for paste. */
  private clipboardSource: string | undefined;
  private pasteCount = 0;

  private cssWidth = 0;
  private cssHeight = 0;
  private destroyed = false;

  private menuEl: HTMLElement | null = null;
  private menuCleanup: (() => void) | undefined;

  /** Watches for a light/dark switch so the diagram is redrawn in the new palette. */
  private themeObserver: MutationObserver | undefined;

  /**
   * Palette for the current frame.
   *
   * Resolved once per draw so every overlay uses one theme, rather than each
   * helper re-reading the document and possibly disagreeing mid-frame.
   */
  private frameTheme: Theme = currentTheme();

  /** Watches the host element, which resizes independently of the window. */
  private resizeObserver: ResizeObserver | undefined;

  /** True while the pointer is over this canvas; decides keyboard ownership. */
  private pointerInside = false;
  /** True once the canvas has been focused at least once. */
  private hasFocus = false;

  /** Snapshot taken at the start of an edit. */
  private pendingBefore: string | undefined;
  private pendingLabel = "edit";
  private pendingCoalesce = false;

  constructor(
    private readonly container: HTMLElement,
    model: DiagramModel | undefined,
    private readonly cb: EditorCallbacks
  ) {
    this.model = model ?? emptyDiagram();

    this.canvas = document.createElement("canvas");
    this.canvas.className = "modelica-studio-canvas";
    // Focusable so it can hold keyboard focus, even though key handling is
    // document-level, so Obsidian's own shortcuts can see the focus location.
    this.canvas.tabIndex = 0;
    this.container.appendChild(this.canvas);

    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D is unavailable in this environment.");
    this.ctx = ctx;

    this.attachEvents();
    this.resize();
    this.requestDraw();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.closeContextMenu();
    this.detachEvents();
    this.canvas.remove();
  }

  /* ---------------- state accessors ---------------- */

  get selectedIds(): string[] {
    return [...this.selection];
  }

  /** Selected wires, by connection id. */
  get selectedWireIds(): string[] {
    return [...this.wireSelection];
  }

  /** Whatever is selected, of either kind. */
  get hasSelection(): boolean {
    return this.selection.size > 0 || this.wireSelection.size > 0;
  }

  get canvasRect(): DOMRect {
    return this.canvas.getBoundingClientRect();
  }

  /**
   * The drawing surface. Exposed so tests can drive real pointer events against
   * the same element the view wires up, rather than a re-implementation.
   */
  get canvasEl(): HTMLCanvasElement {
    return this.canvas;
  }

  get canPaste(): boolean {
    return this.clipboardSource !== undefined;
  }

  /**
   * Whether a change of canvas size should reframe the view.
   *
   * True for the main editor, where the panel can be resized freely and the
   * diagram should stay in view. False for an inline diagram: its height is set
   * by the note, content appears beneath it, and refitting each time would leave
   * the diagram progressively smaller.
   */
  autoFit = true;

  /** A fit was requested while the canvas may not have its true size yet. */
  private fitPending = false;
  /** Pending retry for a fit that is waiting on layout. */
  private fitRetry: number | null = null;

  /** Last size at which a fit was performed, to detect a stale fit. */
  private fittedFor: { w: number; h: number } | null = null;

  /**
   * Request a fit, performed once the canvas size is known and stable.
   *
   * `zoomToFit` is called on open, on model swap and by the Fit button — all of
   * which can happen before layout has settled. Fitting to a stale size produced
   * a scale that neither framed the diagram nor centred it, which is why the
   * view could end up with the circuit tiny in a corner or outside the canvas
   * altogether.
   */
  scheduleFit(): void {
    this.fitPending = true;
    this.resolveFit();
  }

  /**
   * Perform a pending fit once the canvas has a usable size.
   *
   * A pending fit is retried rather than dropped. `scheduleFit` runs before
   * layout in several places — an inline diagram in a note calls it from
   * `requestAnimationFrame`, which fires before the block has been measured —
   * and returning silently there left the diagram never framed AND never drawn,
   * because nothing else asks for a frame on a canvas of zero size.
   */
  private resolveFit(): void {
    if (!this.fitPending || this.destroyed) return;
    if (this.cssWidth < 80 || this.cssHeight < 80) {
      if (this.fitRetry === null) {
        this.fitRetry = window.setTimeout(() => {
          this.fitRetry = null;
          if (this.destroyed) return;
          this.resize();
          this.resolveFit();
        }, 50);
      }
      return;
    }
    this.fitPending = false;
    this.zoomToFit();
  }

  /**
   * Set the component selection.
   *
   * The wire selection is dropped unless `keepWires` is asked for, because a
   * press that lands on a component means the component: leaving a wire selected
   * as well would make the next Delete remove a connection the user had stopped
   * thinking about. The marquee passes `keepWires` because it sweeps both on
   * purpose.
   */
  private setSelection(ids: Iterable<string>, opts: { keepWires?: boolean } = {}): void {
    const next = new Set(ids);
    const wiresDropped = !opts.keepWires && this.wireSelection.size > 0;
    if (sameSet(next, this.selection) && !wiresDropped) return;
    this.selection = next;
    if (wiresDropped) this.wireSelection = new Set();
    // Tell the view, so the inspector and toolbar track the canvas.
    this.cb.onSelectionChange?.([...this.selection]);
    this.requestDraw();
  }

  /* ---------------- event wiring ---------------- */

  private boundResize = () => this.resize();
  private boundKeyDown = (ev: KeyboardEvent) => this.onKeyDown(ev);

  private attachEvents(): void {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerCancel);
    this.canvas.addEventListener("pointerenter", this.onPointerEnter);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("dblclick", this.onDoubleClick);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    this.canvas.addEventListener("focus", () => {
      this.hasFocus = true;
    });
    this.canvas.addEventListener("blur", () => {
      this.hasFocus = false;
    });
    // Document-level so shortcuts survive focus moving to any panel.
    document.addEventListener("keydown", this.boundKeyDown, true);
    window.addEventListener("resize", this.boundResize);

    // The canvas host resizes without the window resizing — toggling a sidebar,
    // dragging the splitter, or re-laying-out a tab. Listening only for window
    // resize left the backing store stale, and the browser then stretched the
    // old bitmap to fit the new box, displacing everything drawn on it.
    // Redraw when the theme changes, or the diagram keeps the palette it was
    // drawn with until something else happens to trigger a frame.
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
      this.themeObserver = new MutationObserver(() => {
        if (this.destroyed) return;
        const next = currentTheme();
        if (next.dark !== this.frameTheme.dark) this.requestDraw();
      });
      this.themeObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.container);
      // Observe the canvas too. Observing only the container missed the case
      // where the canvas element itself is resized by CSS or by the host's
      // layout: the bitmap then keeps its old size and the browser stretches it
      // to fit, which displaces every drawn coordinate.
      this.resizeObserver.observe(this.canvas);
    }
  }

  private detachEvents(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("pointerenter", this.onPointerEnter);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("dblclick", this.onDoubleClick);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    document.removeEventListener("keydown", this.boundKeyDown, true);
    window.removeEventListener("resize", this.boundResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.themeObserver?.disconnect();
    this.themeObserver = undefined;
    if (this.fitRetry !== null) window.clearTimeout(this.fitRetry);
    this.fitRetry = null;
  }

  /** Whether this editor should act on a keyboard event. */
  private ownsKeyboard(): boolean {
    if (this.destroyed) return false;
    if (!this.canvas.isConnected) return false;
    // Both conditions are required. The pointer says which view the user is
    // working in; focus says they are not typing into a field elsewhere. Either
    // one alone is too permissive — a pointer parked over the canvas must not
    // let Delete fire while the user edits a note in another pane.
    return this.pointerInside && this.hasFocus;
  }

  resize(): void {
    if (this.destroyed) return;
    const host = this.container.getBoundingClientRect();
    const own = this.canvas.getBoundingClientRect();
    // The canvas's own box is preferred, but only when BOTH axes are usable. A
    // present-but-degenerate rect — 1x1, which is what a canvas reports before
    // the browser has laid it out — otherwise wins over the host and is then
    // locked in: the guard below sees "nothing changed" on every later call and
    // the editor stays at one pixel forever. That is what kept inline diagrams
    // in notes blank while the host measured a perfectly good 699x320.
    // The host is the source of truth; the canvas's own box is only a fallback.
    //
    // The canvas is positioned to fill its host, so the two should always agree —
    // and when they disagree, the canvas is the one that is stale, because its
    // own rect is what the inline style written on a previous pass imposed. That
    // is how a canvas sized at 22px in a 491px host stayed at 22px: the
    // stylesheet says `height: 100%` but the inline style says 22px and wins.
    // Reading the host instead cannot be fooled that way, and it still shrinks
    // on purpose, which taking the larger of the two did not.
    const hostUsable = host.width >= 2 && host.height >= 2;
    const w = Math.floor(hostUsable ? host.width : own.width);
    const h = Math.floor(hostUsable ? host.height : own.height);
    // Nothing measurable yet. Returning WITHOUT writing anything is what makes
    // this recoverable: writing a 1x1 backing store also writes
    // `style.width = "1px"`, which shrinks the element, so its own rect reports
    // 1x1 from then on and every later call re-reads that value. The editor then
    // stays at one pixel for good, and the browser stretches that single pixel
    // across the whole box — a black slab that shifts as the layout changes.
    if (w < 2 || h < 2) return;
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    // Skip work only when BOTH the CSS size and the bitmap size already match.
    // A bitmap that does not match its layout box is being stretched by the
    // browser, which is the one case that must always be corrected.
    if (
      w === this.cssWidth &&
      h === this.cssHeight &&
      dpr === this.dpr &&
      this.canvas.width === Math.floor(w * dpr) &&
      this.canvas.height === Math.floor(h * dpr)
    ) {
      return;
    }
    this.cssWidth = w;
    this.cssHeight = h;
    this.dpr = dpr;
    this.canvas.width = Math.floor(this.cssWidth * this.dpr);
    this.canvas.height = Math.floor(this.cssHeight * this.dpr);
    this.canvas.style.width = `${this.cssWidth}px`;
    this.canvas.style.height = `${this.cssHeight}px`;
    this.requestDraw();
    // Refit when the canvas changes size, unless the caller frames the view
    // itself. An inline diagram in a note is fitted once, when it is first
    // measured; refitting on every size change would fight the surrounding
    // layout, shrinking the view each time the plot below it appears.
    if (
      this.autoFit &&
      this.fittedFor &&
      (this.fittedFor.w !== this.cssWidth || this.fittedFor.h !== this.cssHeight)
    ) {
      this.fitPending = true;
    }
    this.resolveFit();
  }

  /**
   * The scene transform: diagram units -> CSS pixels, relative to the canvas.
   *
   * This is the single definition of "where things are". Drawing applies it (and
   * the device ratio on top); hit testing inverts it. Because both derive from
   * one function, they cannot drift apart.
   */
  sceneTransform(): { scale: number; yScale: number; x: number; y: number } {
    return {
      scale: this.viewport.scale,
      // Negative, because Modelica's diagram coordinates have +y UP and canvas y
      // is down. Drawing multiplies a diagram y by this, hit testing divides by
      // it, and both get the sign from here -- the same reason the scales share
      // one function, since a sign that lived in two places is exactly how the
      // drawing and the clicking came apart before.
      yScale: -this.viewport.scale,
      x: this.viewport.x,
      y: this.viewport.y,
    };
  }

  /**
   * Canvas-local CSS pixel for a pointer event.
   *
   * Derived from the canvas's own layout box each time rather than from a cached
   * rectangle, and used by every pointer path.
   */
  private pointerLocal(ev: { clientX: number; clientY: number }): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const sx = rect.width > 0 ? this.cssWidth / rect.width : 1;
    const sy = rect.height > 0 ? this.cssHeight / rect.height : 1;
    return [(ev.clientX - rect.left) * sx, (ev.clientY - rect.top) * sy];
  }

  private toDiagram(ev: { clientX: number; clientY: number }): [number, number] {
    const [px, py] = this.pointerLocal(ev);
    const t = this.sceneTransform();
    return [(px - t.x) / t.scale, (py - t.y) / t.yScale];
  }

  /* ---------------- pointer handling ---------------- */

  private onPointerEnter = () => {
    this.pointerInside = true;
  };

  private onPointerLeave = () => {
    this.pointerInside = false;
    if (this.hovered || this.hoveredPort) {
      this.hovered = null;
      this.hoveredPort = undefined;
      this.requestDraw();
    }
  };

  private onContextMenu = (ev: MouseEvent) => {
    // Right-drag pans, so the native menu is always suppressed on the canvas.
    ev.preventDefault();
    this.openContextMenu(ev);
  };

  private onPointerDown = (ev: PointerEvent) => {
    this.closeContextMenu();
    this.canvas.focus();
    this.hasFocus = true;
    const [dx, dy] = this.toDiagram(ev);
    const portHitRadius = PORT_GRAB_PX / this.viewport.scale;

    // Diagnostics: record the raw geometry behind this press so a mismatch
    // between what is drawn and what is clickable can be seen directly.
    const rect = this.canvas.getBoundingClientRect();
    const diag = {
      clientX: ev.clientX,
      clientY: ev.clientY,
      /** Where the conversion chain puts the press, back in canvas-local px. */
      reconstructed: [
        dx * this.viewport.scale + this.viewport.x,
        -dy * this.viewport.scale + this.viewport.y,
      ] as [number, number],
      /** The same point derived directly from the pointer, for comparison. */
      pointerLocal: [ev.clientX - rect.left, ev.clientY - rect.top] as [number, number],
      rectLeft: rect.left,
      rectTop: rect.top,
      canvasCss: [this.cssWidth, this.cssHeight] as [number, number],
      canvasBacking: [this.canvas.width, this.canvas.height] as [number, number],
      /** What the browser reports for the canvas RIGHT NOW. */
      canvasRect: [rect.width, rect.height] as [number, number],
      /** The computed style size, which is what the user actually sees. */
      canvasStyle: [
        parseFloat(this.canvas.style.width) || 0,
        parseFloat(this.canvas.style.height) || 0,
      ] as [number, number],
      dpr: this.dpr,
      windowDpr: typeof window !== "undefined" ? window.devicePixelRatio : undefined,
      modifiers: {
        shift: ev.shiftKey,
        ctrl: ev.ctrlKey,
        meta: ev.metaKey,
        alt: ev.altKey,
        button: ev.button,
      },
      viewport: { ...this.viewport },
      diagram: [dx, dy] as [number, number],
      bodyHit: undefined as string | undefined,
      portHit: undefined as
        | { component: string; port: string; distance: number; withinBody: boolean }
        | undefined,
      handleHit: undefined as string | undefined,
      outcome: "none",
    };
    const report = (outcome: string) => {
      diag.outcome = outcome;
      this.cb.onDiagnostic?.(diag);
    };

    if (this.showProbe) {
      const t = this.sceneTransform();
      this.probePoint = { x: dx * t.scale + t.x, y: dy * t.yScale + t.y, at: Date.now() };
      if (this.probeTimer !== null) window.clearTimeout(this.probeTimer);
      this.probeTimer = window.setTimeout(() => {
        this.probePoint = null;
        this.probeTimer = null;
        this.requestDraw();
      }, 2000);
    }

    // Extents of everything on screen, so a press can be checked against what
    // was actually clickable at that moment rather than assumed.
    if (this.cb.onDiagnostic) {
      this.cb.onDiagnostic({
        ...diag,
        outcome: "map",
        boxes: this.model.components.map((c) => ({
          id: c.id,
          box: c.placement.extent as [number, number, number, number],
        })),
      } as never);
    }

    // 1. Resize handles, for a lone selection.
    if (ev.button === 0 && this.selection.size === 1) {
      const inst = this.instanceOf([...this.selection][0]);
      if (inst) {
        const h = hitTestHandle(
          inst,
          this.cb.lookup(inst.className),
          dx,
          dy,
          9 / this.viewport.scale
        );
        diag.handleHit = h;
        if (h) {
          report("resize");
          this.beginInteraction(
            {
              kind: "resize",
              id: inst.id,
              handle: h,
              startExtent: [...inst.placement.extent] as [number, number, number, number],
              moved: false,
            },
            ev
          );
          this.pendingLabelResize = `resize ${inst.id}`;
          return;
        }
      }
    }

    // 2. Pick what is under the press before deciding what the gesture means.
    //
    // Hit testing has to come before the pan check. Shift was both a pan
    // modifier and an add-to-selection modifier, and testing it first meant
    // shift-clicking a component panned the view instead of selecting it —
    // which is how Shift is most naturally used.
    const bodyHit = hitTestComponent(this.model, this.cb.lookup, dx, dy, 3 / this.viewport.scale);
    diag.bodyHit = bodyHit?.id;

    const portHit = findPortAt(this.model, this.cb.lookup, dx, dy, portHitRadius);
    diag.portHit = portHit
      ? {
          component: portHit.component,
          port: portHit.port,
          distance: portHit.distance,
          withinBody: portHit.withinBody,
        }
      : undefined;
    const onPin = portHit !== undefined && (portHit.withinBody || !bodyHit || ev.altKey);

    // 3. Start a wire when the press is on a pin. A pin sits exactly on a
    // component's extent edge, so the body is also hit here; the small grab
    // radius is what distinguishes "on the pin" from "on the symbol".
    if (onPin && portHit && ev.button === 0 && !ev.shiftKey) {
      report("armWire");
      this.armedPort = { component: portHit.component, port: portHit.port };
      this.beginInteraction(
        {
          kind: "armWire",
          from: { component: portHit.component, port: portHit.port },
          fromPos: portHit.pos,
          startX: dx,
          startY: dy,
          toX: dx,
          toY: dy,
        },
        ev
      );
      return;
    }

    // 4. A component body: select (respecting modifiers) and prepare to drag.
    if (bodyHit) {
      report("select+drag");
      const additive = ev.ctrlKey || ev.metaKey || ev.shiftKey;
      if (additive) {
        const next = new Set(this.selection);
        if (next.has(bodyHit.id)) next.delete(bodyHit.id);
        else next.add(bodyHit.id);
        this.setSelection(next);
      } else if (!this.selection.has(bodyHit.id)) {
        this.setSelection([bodyHit.id]);
      }
      // Every selected component moves together, so record all their extents.
      const origin = new Map<string, [number, number, number, number]>();
      for (const id of this.selection) {
        const inst = this.instanceOf(id);
        if (inst) origin.set(id, [...inst.placement.extent] as [number, number, number, number]);
      }
      const c = centreOf(bodyHit.placement.extent);
      this.beginInteraction(
        {
          kind: "maybeDrag",
          id: bodyHit.id,
          startX: dx,
          startY: dy,
          grabDX: dx - c[0],
          grabDY: dy - c[1],
          origin,
          moved: false,
        },
        ev
      );
      return;
    }

    // 5. A wire. Tested AFTER the component body, so a wire crossing a symbol
    // does not steal the click from the symbol, and before empty space, so a wire
    // in open space is reachable at all -- which it previously was not, at any
    // zoom, by any gesture.
    const wireHit = this.hitTestWire(dx, dy, (WIRE_GRAB_PX * this.wireScale()) / this.viewport.scale);
    if (wireHit && ev.button === 0) {
      const additive = ev.ctrlKey || ev.metaKey || ev.shiftKey;
      if (additive) {
        const next = new Set(this.wireSelection);
        if (next.has(wireHit.conn.id)) next.delete(wireHit.conn.id);
        else next.add(wireHit.conn.id);
        this.setWireSelection(next);
      } else if (!this.wireSelection.has(wireHit.conn.id)) {
        this.setWireSelection([wireHit.conn.id]);
      }
      // A press on an interior corner starts a reshape; a press anywhere else on
      // the wire just selects it. The endpoints are skipped because they are the
      // pins: `connectionPoints` rewrites them from the ports on every draw, so a
      // drag there would snap straight back and look broken.
      const vertex = nearestVertexIndex(
        wireHit.points,
        dx,
        dy,
        WIRE_VERTEX_GRAB_PX / this.viewport.scale
      );
      const interior = vertex > 0 && vertex * 2 + 3 < wireHit.points.length;
      report(interior ? "wire-vertex" : "select-wire");
      if (interior) {
        // No `beginEdit` here: a press that never moves is a selection, and
        // opening an edit on pointerdown would leave one pending for the next
        // gesture to record against the wrong before-state.
        this.beginInteraction(
          {
            kind: "wireVertex",
            connId: wireHit.conn.id,
            index: vertex,
            startX: dx,
            startY: dy,
            moved: false,
          },
          ev
        );
      }
      return;
    }

    // 6. Empty space. Pan on the middle or right button, or with Shift held;
    // otherwise a rubber-band selection.
    if (ev.button === 1 || ev.button === 2 || ev.shiftKey) {
      report("pan");
      this.beginInteraction({ kind: "pan", lastX: ev.clientX, lastY: ev.clientY }, ev);
      return;
    }

    // 5. Empty space: rubber-band select, keeping any additive base selection.
    report("rubber-band");
    const additive = ev.ctrlKey || ev.metaKey || ev.shiftKey;
    this.beginInteraction(
      {
        kind: "rubber",
        startX: dx,
        startY: dy,
        x: dx,
        y: dy,
        additive,
        baseSelection: additive ? new Set(this.selection) : new Set<string>(),
        baseWireSelection: additive ? new Set(this.wireSelection) : new Set<string>(),
      },
      ev
    );
  };

  /** Label used for the history entry a resize gesture produces. */
  private pendingLabelResize = "resize";

  private beginInteraction(next: Interaction, ev: PointerEvent): void {
    this.interaction = next;
    try {
      this.canvas.setPointerCapture(ev.pointerId);
    } catch {
      /* capture is best-effort */
    }
    this.requestDraw();
  }

  private onPointerMove = (ev: PointerEvent): void => {
    const [dx, dy] = this.toDiagram(ev);
    const inter = this.interaction;

    switch (inter.kind) {
      case "pan": {
        this.viewport.x += ev.clientX - inter.lastX;
        this.viewport.y += ev.clientY - inter.lastY;
        inter.lastX = ev.clientX;
        inter.lastY = ev.clientY;
        this.requestDraw();
        return;
      }

      case "maybeDrag": {
        // Only promote to a real drag past a small threshold, so a click that
        // jitters by a pixel still counts as a selection.
        const dist = Math.hypot(dx - inter.startX, dy - inter.startY) * this.viewport.scale;
        if (!inter.moved && dist < DRAG_THRESHOLD_PX) return;
        if (!inter.moved) {
          inter.moved = true;
          this.beginEdit(
            inter.origin.size > 1 ? `move ${inter.origin.size} components` : `move ${inter.id}`
          );
        }
        const c = centreOf(inter.origin.get(inter.id)!);
        const sx = Math.round((dx - inter.grabDX) / GRID) * GRID;
        const sy = Math.round((dy - inter.grabDY) / GRID) * GRID;

        // Move the whole selection rigidly, from the extents captured at the
        // start, so a multi-selection keeps its relative arrangement.
        for (const [id, ext] of inter.origin) {
          const inst = this.instanceOf(id);
          if (!inst) continue;
          const ec = centreOf(ext);
          const w = ext[2] - ext[0];
          const h = ext[3] - ext[1];
          const ncx = sx + (ec[0] - c[0]);
          const ncy = sy + (ec[1] - c[1]);
          inst.placement.extent = [ncx - w / 2, ncy - h / 2, ncx + w / 2, ncy + h / 2];
        }
        this.requestDraw();
        return;
      }

      case "resize": {
        const inst = this.instanceOf(inter.id);
        if (inst) {
          if (!inter.moved) {
            inter.moved = true;
            this.beginEdit(this.pendingLabelResize);
          }
          inst.placement.extent = resizeExtent(
            inter.startExtent,
            inter.handle,
            dx,
            dy,
            MIN_SIZE,
            GRID
          );
          this.requestDraw();
        }
        return;
      }

      case "wireVertex": {
        const conn = this.model.connections.find((c) => c.id === inter.connId);
        if (!conn) return;
        // The resolved route, WITHOUT writing it back yet: `beginEdit` must
        // capture the state before the route is materialised, or undo would
        // restore a route that was already explicit and the derived form could
        // never be recovered.
        const route = conn.points.length >= 8 ? conn.points : this.connectionPoints(conn);
        const i = inter.index * 2;
        if (i <= 0 || i + 1 >= route.length - 1) return;
        const dist = Math.hypot(dx - inter.startX, dy - inter.startY) * this.viewport.scale;
        if (!inter.moved && dist < DRAG_THRESHOLD_PX) return;
        if (!inter.moved) {
          inter.moved = true;
          this.beginEdit(`route ${conn.id}`);
        }
        // Materialise on the first movement. Until then `points` may be empty and
        // the polyline is derived from the ports, so there is nothing to edit --
        // writing the derived route back is what turns "reshape this wire" into an
        // edit of stored waypoints.
        if (conn.points.length < 8) conn.points = route;
        // Snapped to the same grid as components, so a reshaped wire lines up with
        // the symbols it runs between.
        conn.points[i] = Math.round(dx / GRID) * GRID;
        conn.points[i + 1] = Math.round(dy / GRID) * GRID;
        this.requestDraw();
        return;
      }

      case "rubber": {
        inter.x = dx;
        inter.y = dy;
        const box = rubberBox(inter);
        const inside = this.componentsInBox(box);
        this.setSelection(inter.additive ? [...inter.baseSelection, ...inside] : inside, {
          keepWires: true,
        });
        // Wires are swept too, so a marquee can clear a tangle in one gesture.
        // A wire counts as caught only when the whole route is inside: catching
        // one that merely crosses the box would delete a connection the user was
        // not pointing at.
        const wires = this.model.connections
          .filter((c) => polylineInBox(this.connectionPoints(c), box))
          .map((c) => c.id);
        this.wireSelection = new Set(
          inter.additive ? [...inter.baseWireSelection, ...wires] : wires
        );
        this.requestDraw();
        return;
      }

      case "armWire": {
        const travelled =
          Math.hypot(dx - inter.startX, dy - inter.startY) * this.viewport.scale;
        if (travelled < DRAG_THRESHOLD_PX) return; // still just a click

        // Promote to a real wire, then fall through to the wire handling below
        // in this same move — so the target under the pointer is picked up
        // immediately rather than only on the next mouse-move.
        this.interaction = {
          kind: "wire",
          from: inter.from,
          fromPos: inter.fromPos,
          toX: dx,
          toY: dy,
        };
        this.armedPort = undefined;
        return this.onPointerMove(ev);
      }

      case "wire": {
        inter.toX = dx;
        inter.toY = dy;
        const p = findPortAt(this.model, this.cb.lookup, dx, dy, 14 / this.viewport.scale);
        inter.hoverPort =
          p && !(p.component === inter.from.component && p.port === inter.from.port)
            ? { component: p.component, port: p.port }
            : undefined;
        this.requestDraw();
        return;
      }

      case "none":
        break;
    }

    // Idle: cursor and hover feedback.
    this.updateHoverCursor(dx, dy);
  };

  private updateHoverCursor(dx: number, dy: number): void {
    if (this.selection.size === 1) {
      const inst = this.instanceOf([...this.selection][0]);
      if (inst) {
        const h = hitTestHandle(
          inst,
          this.cb.lookup(inst.className),
          dx,
          dy,
          9 / this.viewport.scale
        );
        if (h) {
          this.canvas.style.cursor = handleCursor(h, inst.placement.rotation ?? 0);
          this.setHoveredPort(undefined);
          if (this.hovered !== inst.id) {
            this.hovered = inst.id;
            this.requestDraw();
          }
          return;
        }
      }
    }
    this.canvas.style.cursor = "default";

    const bodyHit = hitTestComponent(this.model, this.cb.lookup, dx, dy, 2 / this.viewport.scale);
    const p = bodyHit
      ? undefined
      : findPortAt(this.model, this.cb.lookup, dx, dy, PORT_GRAB_PX / this.viewport.scale);
    this.setHoveredPort(p ? { component: p.component, port: p.port } : undefined);
    const next = bodyHit?.id ?? null;
    if (next !== this.hovered) {
      this.hovered = next;
      this.requestDraw();
    }

    // A wire is not a component and has no symbol to light up, so the cursor is
    // what says it can be clicked. Without this the wire is selectable but nothing
    // on screen suggests it, which is how it stayed unselectable in practice.
    const wire =
      bodyHit || p
        ? undefined
        : this.hitTestWire(dx, dy, (WIRE_GRAB_PX * this.wireScale()) / this.viewport.scale);
    const wireId = wire?.conn.id ?? null;
    if (wireId !== this.hoveredWire) {
      this.hoveredWire = wireId;
      this.requestDraw();
    }
    if (wire) this.canvas.style.cursor = "pointer";
  }

  private setHoveredPort(p: { component: string; port: string } | undefined): void {
    const changed =
      (p?.component ?? "") !== (this.hoveredPort?.component ?? "") ||
      (p?.port ?? "") !== (this.hoveredPort?.port ?? "");
    this.hoveredPort = p;
    if (changed) this.requestDraw();
  }

  private onPointerUp = (ev: PointerEvent) => {
    const inter = this.interaction;
    this.interaction = { kind: "none" };

    switch (inter.kind) {
      case "maybeDrag":
        // A click without movement is just a selection; nothing to commit.
        if (inter.moved) this.commitEdit();
        break;
      case "resize":
        if (inter.moved) this.commitEdit();
        break;
      case "wireVertex":
        if (inter.moved) this.commitEdit();
        break;
      case "rubber":
        // A plain click on empty space clears the selection.
        if (!inter.additive && isZeroSize(inter)) this.clearSelection();
        break;
      case "armWire": {
        // Never moved: the user meant to select, not to wire.
        const inst = this.instanceOf(inter.from.component);
        if (inst) {
          const additive = ev.ctrlKey || ev.metaKey || ev.shiftKey;
          if (additive) {
            const next = new Set(this.selection);
            if (next.has(inst.id)) next.delete(inst.id);
            else next.add(inst.id);
            this.setSelection(next);
          } else {
            this.setSelection([inst.id]);
          }
        }
        this.armedPort = undefined;
        break;
      }
      case "wire": {
        const target = inter.hoverPort;
        if (target) {
          this.beginEdit(`connect ${inter.from.component}.${inter.from.port}`);
          this.addConnection(inter.from, target);
          this.commitEdit();
        }
        break;
      }
      default:
        break;
    }

    try {
      this.canvas.releasePointerCapture(ev.pointerId);
    } catch {
      /* capture may already be released */
    }
    this.requestDraw();
  };

  /**
   * Recover from an interrupted gesture (pointercancel, or a lost capture).
   * Restores the pre-gesture state rather than leaving a half-applied edit.
   */
  private onPointerCancel = (ev: PointerEvent) => {
    this.revertGesture();
    try {
      this.canvas.releasePointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
  };

  /** Put back the extents captured at gesture start, and drop the snapshot. */
  private revertGesture(): void {
    const inter = this.interaction;
    this.interaction = { kind: "none" };
    this.armedPort = undefined;
    if (inter.kind === "maybeDrag") {
      for (const [id, ext] of inter.origin) {
        const inst = this.instanceOf(id);
        if (inst) inst.placement.extent = [...ext] as [number, number, number, number];
      }
    } else if (inter.kind === "resize") {
      const inst = this.instanceOf(inter.id);
      if (inst) inst.placement.extent = [...inter.startExtent] as [number, number, number, number];
    }
    this.pendingBefore = undefined;
    this.requestDraw();
  }

  private onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const factor = Math.exp(-ev.deltaY * 0.0015);
    const next = clamp(this.viewport.scale * factor, MIN_ZOOM, MAX_ZOOM);
    const applied = next / this.viewport.scale;
    if (applied === 1) return;
    this.viewport.x = px - (px - this.viewport.x) * applied;
    this.viewport.y = py - (py - this.viewport.y) * applied;
    this.viewport.scale = next;
    this.requestDraw();
  };

  private onDoubleClick = (ev: MouseEvent) => {
    const [dx, dy] = this.toDiagram(ev);
    const hit = hitTestComponent(this.model, this.cb.lookup, dx, dy, 2 / this.viewport.scale);
    if (hit) {
      this.setSelection([hit.id]);
      return;
    }
    // Double-clicking a wire restores its automatic route, so the gesture that
    // reshapes a wire also has an obvious inverse. Without this the only way back
    // from a route dragged into a symbol is to undo, which also undoes whatever
    // else came after it.
    const wire = this.hitTestWire(dx, dy, (WIRE_GRAB_PX * this.wireScale()) / this.viewport.scale);
    if (wire) {
      this.setWireSelection([wire.conn.id]);
      this.resetWireRoutes();
    }
  };

  /* ---------------- keyboard ---------------- */

  private onKeyDown(ev: KeyboardEvent) {
    if (!this.ownsKeyboard()) return;
    // Never steal keys from a text field.
    if (isTextEntry(ev.target)) return;

    const mod = ev.ctrlKey || ev.metaKey;

    if (mod && ev.key.toLowerCase() === "z") {
      ev.preventDefault();
      if (ev.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && ev.key.toLowerCase() === "y") {
      ev.preventDefault();
      this.redo();
      return;
    }
    if (mod && ev.key.toLowerCase() === "a") {
      ev.preventDefault();
      this.selectAll();
      return;
    }
    if (mod && ev.key.toLowerCase() === "c") {
      ev.preventDefault();
      this.copy();
      return;
    }
    if (mod && ev.key.toLowerCase() === "x") {
      ev.preventDefault();
      this.copy();
      this.deleteSelection();
      return;
    }
    if (mod && ev.key.toLowerCase() === "v") {
      ev.preventDefault();
      void this.paste();
      return;
    }
    if (mod && ev.key.toLowerCase() === "d") {
      ev.preventDefault();
      this.duplicate();
      return;
    }
    if (mod && ev.key === "0") {
      ev.preventDefault();
      this.zoomToFit();
      return;
    }

    switch (ev.key) {
      case "Delete":
      case "Backspace":
        // Either kind counts: guarding on the component selection alone left a
        // selected wire undeletable by the key, which is the main way to delete
        // one.
        if (!this.hasSelection) return;
        ev.preventDefault();
        this.deleteSelection();
        return;
      case "Escape":
        ev.preventDefault();
        this.cancelGesture();
        return;
      case "Tab":
        // Cycle through components, so the diagram is usable without a mouse.
        if (this.model.components.length === 0) return;
        ev.preventDefault();
        this.cycleSelection(ev.shiftKey ? -1 : 1);
        return;
      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight": {
        if (this.selection.size === 0) return;
        ev.preventDefault();
        const step = ev.shiftKey ? GRID * 5 : GRID;
        const [sx, sy] = arrowDelta(ev.key, step);
        this.nudge(sx, sy);
        return;
      }
      case "r":
      case "R":
        if (this.selection.size === 0) return;
        ev.preventDefault();
        this.rotateSelection(ev.shiftKey ? -90 : 90);
        return;
      default:
        break;
    }
  }

  /** Abort whatever gesture is in flight, restoring the pre-gesture state. */
  cancelGesture(): void {
    const wasGesture =
      this.interaction.kind === "maybeDrag" || this.interaction.kind === "resize";
    if (wasGesture) {
      this.revertGesture();
      return;
    }
    this.interaction = { kind: "none" };
    this.setSelection([]);
    this.requestDraw();
  }

  /** Move the selection by a delta, coalescing repeats into one undo step. */
  nudge(dx: number, dy: number): void {
    if (this.selection.size === 0) return;
    this.beginEdit(this.selection.size > 1 ? `move ${this.selection.size} components` : "move", {
      coalesce: true,
    });
    for (const id of this.selection) {
      const inst = this.instanceOf(id);
      if (!inst) continue;
      const [x1, y1, x2, y2] = inst.placement.extent;
      inst.placement.extent = [x1 + dx, y1 + dy, x2 + dx, y2 + dy];
    }
    this.commitEdit();
  }

  /** Move the selection to the next/previous component, wrapping around. */
  private cycleSelection(dir: number): void {
    const ids = this.model.components.map((c) => c.id);
    if (ids.length === 0) return;
    const current = [...this.selection][0];
    const idx = current ? ids.indexOf(current) : -1;
    const next = ids[(idx + dir + ids.length * 2) % ids.length];
    this.setSelection([next]);
    const inst = this.instanceOf(next);
    if (inst) this.revealComponent(inst);
    this.cb.onStatus?.(`selected ${next}`);
  }

  /** Pan so a component is visible, used by keyboard navigation. */
  private revealComponent(inst: ComponentInstance): void {
    const [x1, y1, x2, y2] = inst.placement.extent;
    const s = this.viewport.scale;
    const left = x1 * s + this.viewport.x;
    const right = x2 * s + this.viewport.x;
    // y1 is the extent's LOWER edge in Modelica, which is the LARGER canvas y.
    const top = -y2 * s + this.viewport.y;
    const bottom = -y1 * s + this.viewport.y;
    const margin = 40;
    let dx = 0;
    let dy = 0;
    if (left < margin) dx = margin - left;
    else if (right > this.cssWidth - margin) dx = this.cssWidth - margin - right;
    if (top < margin) dy = margin - top;
    else if (bottom > this.cssHeight - margin) dy = this.cssHeight - margin - bottom;
    if (dx || dy) {
      this.viewport.x += dx;
      this.viewport.y += dy;
      this.requestDraw();
    }
  }

  /* ---------------- history ---------------- */

  /**
   * Record the pre-edit state.
   *
   * Called at the START of an edit, because the state worth restoring is the
   * one the user is about to leave. `commitEdit` closes the entry.
   */
  private beginEdit(label: string, opts: { coalesce?: boolean } = {}): void {
    if (this.pendingBefore !== undefined) return; // already inside an edit
    this.pendingBefore = JSON.stringify(this.model);
    this.pendingLabel = label;
    this.pendingCoalesce = opts.coalesce === true;
  }

  /** Close the current edit and record it in history. */
  private commitEdit(): void {
    const before = this.pendingBefore;
    this.pendingBefore = undefined;
    if (before === undefined) return;
    this.history.push(before, JSON.stringify(this.model), this.pendingLabel, {
      coalesce: this.pendingCoalesce,
    });
    this.cb.onChange?.(this.model);
  }

  undo(): void {
    const r = this.history.undo(JSON.stringify(this.model));
    if (!r) {
      this.cb.onStatus?.("nothing to undo");
      return;
    }
    this.pendingBefore = undefined;
    this.applyRestored(r.state);
    this.cb.onStatus?.(`undid ${r.label}`);
  }

  redo(): void {
    const r = this.history.redo();
    if (!r) {
      this.cb.onStatus?.("nothing to redo");
      return;
    }
    this.pendingBefore = undefined;
    this.applyRestored(r.state);
    this.cb.onStatus?.(`redid ${r.label}`);
  }

  private applyRestored(state: string): void {
    this.model = JSON.parse(state) as DiagramModel;
    // Anything that no longer exists must leave the selection -- and that includes
    // wires. A wire id that has been undone away would otherwise stay in the
    // selection: the inspector would report connections that are not there, and
    // the next Delete would act on a set the user cannot see.
    const aliveComponents = new Set(this.model.components.map((c) => c.id));
    const aliveWires = new Set(this.model.connections.map((c) => c.id));
    const keptWires = new Set([...this.wireSelection].filter((id) => aliveWires.has(id)));
    const wiresChanged = keptWires.size !== this.wireSelection.size;
    this.wireSelection = keptWires;
    this.setSelection([...this.selection].filter((id) => aliveComponents.has(id)), {
      keepWires: true,
    });
    if (wiresChanged) this.cb.onSelectionChange?.(this.selectedIds);
    this.cb.onChange?.(this.model);
    this.requestDraw();
  }

  /* ---------------- clipboard ---------------- */

  /** Copy the selection into the in-memory fragment and the system clipboard. */
  copy(): void {
    const picked = this.picked();
    if (picked.components.length === 0) return;
    this.clipboardSource = JSON.stringify({
      name: `${this.model.name}Fragment`,
      components: picked.components,
      connections: picked.connections,
      graphics: [],
    });
    this.pasteCount = 0;
    void this.cb.writeClipboard?.(this.clipboardSource);
    this.cb.onStatus?.(`copied ${picked.components.length} component(s)`);
  }

  /**
   * Paste. Prefers the system clipboard when it holds one of our fragments, so
   * a copy in one studio view can be pasted into another.
   */
  async paste(): Promise<void> {
    let text = this.clipboardSource;
    try {
      const external = await this.cb.readClipboard?.();
      if (external && looksLikeFragment(external)) text = external;
    } catch {
      /* clipboard access is optional */
    }
    if (!text) {
      this.cb.onStatus?.("clipboard is empty");
      return;
    }
    const saved = this.clipboardSource;
    this.clipboardSource = text;
    const ok = this.pasteFragment();
    if (!ok) {
      this.clipboardSource = saved;
      this.cb.onStatus?.("clipboard does not contain a diagram fragment");
    }
  }

  /** Paste from the in-memory fragment. Returns false when unusable. */
  private pasteFragment(): boolean {
    if (!this.clipboardSource) return false;
    let frag: DiagramModel;
    try {
      frag = JSON.parse(this.clipboardSource) as DiagramModel;
    } catch {
      return false;
    }
    if (!Array.isArray(frag.components) || frag.components.length === 0) return false;

    this.pasteCount++;
    const offset = PASTE_OFFSET * this.pasteCount;
    this.beginEdit(`paste ${frag.components.length} component(s)`);

    const idMap = new Map<string, string>();
    const created: ComponentInstance[] = [];
    for (const c of frag.components) {
      const id = this.uniqueId(shortName(c.className));
      idMap.set(c.id, id);
      const inst: ComponentInstance = {
        id,
        className: c.className,
        placement: { ...c.placement, extent: offsetExtent(c.placement.extent, offset) },
        params: { ...c.params },
      };
      this.model.components.push(inst);
      created.push(inst);
    }
    // Re-create connections whose endpoints were both copied.
    for (const conn of frag.connections ?? []) {
      const a = idMap.get(conn.from.component);
      const b = idMap.get(conn.to.component);
      if (!a || !b) continue;
      const pa = this.instancePos(a, conn.from.port);
      const pb = this.instancePos(b, conn.to.port);
      this.model.connections.push({
        id: `${a}.${conn.from.port}|${b}.${conn.to.port}`,
        from: { component: a, port: conn.from.port },
        to: { component: b, port: conn.to.port },
        points: pa && pb ? routeConnection(pa, pb) : [],
        color: conn.color,
      });
    }

    this.commitEdit();
    this.setSelection(created.map((c) => c.id));
    this.cb.onStatus?.(`pasted ${created.length} component(s)`);
    return true;
  }

  /** Duplicate the selection in one step (Ctrl+D). */
  duplicate(): void {
    const picked = this.picked();
    if (picked.components.length === 0) return;
    const saved = this.clipboardSource;
    const savedCount = this.pasteCount;
    this.clipboardSource = JSON.stringify({
      name: `${this.model.name}Fragment`,
      components: picked.components,
      connections: picked.connections,
      graphics: [],
    });
    this.pasteCount = 0;
    this.pasteFragment();
    this.clipboardSource = saved;
    this.pasteCount = savedCount;
  }

  /** Components and the connections wholly inside the current selection. */
  private picked(): { components: ComponentInstance[]; connections: Connection[] } {
    const ids = this.selection;
    return {
      components: this.model.components.filter((c) => ids.has(c.id)),
      connections: this.model.connections.filter(
        (c) => ids.has(c.from.component) && ids.has(c.to.component)
      ),
    };
  }

  /* ---------------- context menu ---------------- */

  private openContextMenu(ev: MouseEvent): void {
    const [dx, dy] = this.toDiagram(ev);
    const hit = hitTestComponent(this.model, this.cb.lookup, dx, dy, 2 / this.viewport.scale);
    // Right-clicking an unselected component selects it first, which is what
    // makes the menu's actions apply to what the user pointed at.
    if (hit && !this.selection.has(hit.id)) this.setSelection([hit.id]);
    else if (!hit) {
      // No component: a wire may still be under the pointer, and right-clicking
      // it should offer the same actions. Falling straight through to clearing
      // the selection made the menu's Delete unavailable on the one thing the
      // user had pointed at.
      const wire = this.hitTestWire(dx, dy, (WIRE_GRAB_PX * this.wireScale()) / this.viewport.scale);
      if (wire && !this.wireSelection.has(wire.conn.id)) this.setWireSelection([wire.conn.id]);
      else if (!wire) this.clearSelection();
    }

    this.closeContextMenu();
    const rect = this.container.getBoundingClientRect();
    const menu = this.container.ownerDocument.createElement("div");
    menu.className = "modelica-studio-context-menu";

    // Delete applies to either kind; the clipboard and rotation are component
    // operations and stay disabled for a wire rather than appearing to do nothing.
    const comps = this.selection.size > 0;
    const anySelected = this.hasSelection;
    const items: { label: string; enabled: boolean; run: () => void }[] = [
      { label: "Cut", enabled: comps, run: () => { this.copy(); this.deleteSelection(); } },
      { label: "Copy", enabled: comps, run: () => this.copy() },
      { label: "Paste", enabled: this.canPaste, run: () => void this.paste() },
      { label: "Duplicate", enabled: comps, run: () => this.duplicate() },
      { label: "Delete", enabled: anySelected, run: () => this.deleteSelection() },
      {
        label: "Reset route",
        enabled: this.canResetRoutes,
        run: () => this.resetWireRoutes(),
      },
      { label: "Rotate 90°", enabled: comps, run: () => this.rotateSelection(90) },
      { label: "Undo", enabled: this.history.canUndo, run: () => this.undo() },
      { label: "Redo", enabled: this.history.canRedo, run: () => this.redo() },
      {
        label: "Select all",
        enabled: this.model.components.length > 0 || this.model.connections.length > 0,
        run: () => this.selectAll(),
      },
      {
        label: "Fit to view",
        enabled: this.model.components.length > 0,
        run: () => this.zoomToFit(),
      },
    ];

    for (const item of items) {
      const row = menu.createDiv({
        cls: "modelica-studio-context-item" + (item.enabled ? "" : " is-disabled"),
      });
      row.setText(item.label);
      if (item.enabled) {
        row.addEventListener("click", () => {
          this.closeContextMenu();
          item.run();
        });
      }
    }

    menu.style.left = `${ev.clientX - rect.left}px`;
    menu.style.top = `${ev.clientY - rect.top}px`;
    this.container.appendChild(menu);
    this.menuEl = menu;

    // Dismiss on an outside click.
    const onDown = (e: MouseEvent) => {
      if (this.menuEl && !this.menuEl.contains(e.target as Node)) this.closeContextMenu();
    };
    setTimeout(() => document.addEventListener("pointerdown", onDown, true), 0);
    this.menuCleanup = () => document.removeEventListener("pointerdown", onDown, true);
  }

  private closeContextMenu(): void {
    if (!this.menuEl) return;
    this.menuCleanup?.();
    this.menuCleanup = undefined;
    this.menuEl.remove();
    this.menuEl = null;
  }

  /* ---------------- geometry helpers ---------------- */

  private instanceOf(id: string): ComponentInstance | undefined {
    return this.model.components.find((c) => c.id === id);
  }

  private instancePos(componentId: string, port: string): [number, number] | undefined {
    const inst = this.instanceOf(componentId);
    if (!inst) return undefined;
    return portPosition(inst, this.cb.lookup(inst.className), port);
  }

  /** Component ids whose box intersects a rubber-band rectangle. */
  private componentsInBox(box: [number, number, number, number]): string[] {
    const [bx1, by1, bx2, by2] = box;
    const out: string[] = [];
    for (const inst of this.model.components) {
      const e = inst.placement.extent;
      if (e[0] <= bx2 && bx1 <= e[2] && e[1] <= by2 && by1 <= e[3]) out.push(inst.id);
    }
    return out;
  }

  /* ---------------- mutations ---------------- */

  addComponent(className: string, x: number, y: number): ComponentInstance | undefined {
    const def = this.cb.lookup(className);
    if (!def) return undefined;

    this.beginEdit(`add ${def.shortName}`);
    const id = this.uniqueId(def.shortName);
    const sx = Math.round(x / GRID) * GRID;
    const sy = Math.round(y / GRID) * GRID;
    const inst: ComponentInstance = {
      id,
      className,
      placement: {
        // Sized from the class's own artwork so the symbol fills its box, which
        // keeps the visible symbol and the clickable region in agreement.
        extent: defaultExtent(def, sx, sy),
        rotation: 0,
        visible: true,
      },
      params: defaultParams(def),
    };
    this.model.components.push(inst);
    this.commitEdit();
    this.setSelection([id]);
    this.cb.onStatus?.(`added ${id}`);
    return inst;
  }

  addConnection(
    from: { component: string; port: string },
    to: { component: string; port: string }
  ): Connection | undefined {
    if (from.component === to.component && from.port === to.port) return undefined;

    const exists = this.model.connections.some(
      (c) =>
        (c.from.component === from.component &&
          c.from.port === from.port &&
          c.to.component === to.component &&
          c.to.port === to.port) ||
        (c.from.component === to.component &&
          c.from.port === to.port &&
          c.to.component === from.component &&
          c.to.port === from.port)
    );
    if (exists) {
      this.cb.onStatus?.("those connectors are already joined");
      return undefined;
    }

    const a = this.instancePos(from.component, from.port);
    const b = this.instancePos(to.component, to.port);
    const conn: Connection = {
      id: `${from.component}.${from.port}|${to.component}.${to.port}`,
      from,
      to,
      points: a && b ? routeConnection(a, b) : [],
    };
    this.model.connections.push(conn);
    this.cb.onStatus?.(
      `connected ${from.component}.${from.port} to ${to.component}.${to.port}`
    );
    return conn;
  }

  /**
   * Put the selected wires back on their automatic route.
   *
   * A stored route is a snapshot of where the corners were; when the components
   * move it is not recomputed, so a wire can end up doubling back through a
   * symbol -- which is exactly what a route that was reshaped and then left
   * behind by a move looks like. This throws the stored corners away and lets
   * `routeConnection` derive the L again, which is the escape hatch from a route
   * that has gone bad.
   */
  resetWireRoutes(): void {
    const wires = this.model.connections.filter((c) => this.wireSelection.has(c.id));
    if (wires.length === 0) return;
    // Only the ones that actually have a stored route: clearing an already
    // derived wire would put an undo entry in the history for no change.
    const stored = wires.filter((c) => c.points.length >= 4);
    if (stored.length === 0) {
      this.cb.onStatus?.("that connection already follows the automatic route");
      return;
    }
    this.beginEdit(stored.length > 1 ? `re-route ${stored.length} wires` : `re-route ${stored[0].id}`);
    for (const conn of stored) conn.points = [];
    this.commitEdit();
    this.cb.onStatus?.(`re-routed ${stored.length} connection(s)`);
    this.requestDraw();
  }

  /** Whether any selected wire carries a stored route worth resetting. */
  get canResetRoutes(): boolean {
    return this.model.connections.some(
      (c) => this.wireSelection.has(c.id) && c.points.length >= 4
    );
  }

  deleteSelection(): void {
    if (this.selection.size === 0 && this.wireSelection.size === 0) return;
    const doomed = new Set(this.selection);
    const doomedWires = new Set(this.wireSelection);
    const parts: string[] = [];
    if (doomed.size) parts.push(`${doomed.size} component(s)`);
    if (doomedWires.size) parts.push(`${doomedWires.size} connection(s)`);
    this.beginEdit(`delete ${parts.join(" and ")}`);
    this.model.components = this.model.components.filter((c) => !doomed.has(c.id));
    // Connections to a removed component must go too, or the generated
    // Modelica would reference a missing instance. A wire the user picked goes
    // whether or not its components survive.
    this.model.connections = this.model.connections.filter(
      (c) =>
        !doomed.has(c.from.component) && !doomed.has(c.to.component) && !doomedWires.has(c.id)
    );
    this.commitEdit();
    this.clearSelection();
    this.cb.onStatus?.(`deleted ${parts.join(" and ")}`);
  }

  rotateSelection(deltaDeg: number): void {
    if (this.selection.size === 0) return;
    this.beginEdit("rotate", { coalesce: true });
    for (const id of this.selection) {
      const inst = this.instanceOf(id);
      if (!inst) continue;
      const cur = inst.placement.rotation ?? 0;
      let next = (((cur + deltaDeg) % 360) + 360) % 360;
      if (next > 180) next -= 360;
      inst.placement.rotation = next;
    }
    this.commitEdit();
  }

  private uniqueId(base: string): string {
    const cleaned = base.charAt(0).toLowerCase() + base.slice(1);
    if (!this.model.components.some((c) => c.id === cleaned)) return cleaned;
    let i = 2;
    while (this.model.components.some((c) => c.id === `${cleaned}${i}`)) i++;
    return `${cleaned}${i}`;
  }

  setParam(id: string, name: string, value: string): void {
    const inst = this.instanceOf(id);
    if (!inst) return;
    this.beginEdit(`set ${id}.${name}`);
    if (value === "") delete inst.params[name];
    else inst.params[name] = value;
    this.commitEdit();
  }

  renameInstance(oldId: string, newId: string): { ok: boolean; error?: string } {
    if (!newId || newId === oldId) return { ok: true };
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newId)) {
      return { ok: false, error: "A Modelica instance name must start with a letter or underscore." };
    }
    if (this.model.components.some((c) => c.id === newId)) {
      return { ok: false, error: `An instance named "${newId}" already exists.` };
    }
    const inst = this.instanceOf(oldId);
    if (!inst) return { ok: false, error: "That component no longer exists." };

    this.beginEdit(`rename ${oldId}`);
    inst.id = newId;
    for (const conn of this.model.connections) {
      if (conn.from.component === oldId) conn.from.component = newId;
      if (conn.to.component === oldId) conn.to.component = newId;
      conn.id = `${conn.from.component}.${conn.from.port}|${conn.to.component}.${conn.to.port}`;
    }
    this.commitEdit();
    this.setSelection([newId]);
    return { ok: true };
  }

  select(id: string | undefined): void {
    this.setSelection(id ? [id] : []);
  }

  selectAll(): void {
    this.setSelection(this.model.components.map((c) => c.id), { keepWires: true });
    // Everything, so a single Delete clears the diagram. The two sets are kept
    // apart everywhere else; here they are both filled on purpose.
    this.wireSelection = new Set(this.model.connections.map((c) => c.id));
    this.cb.onSelectionChange?.(this.selectedIds);
    this.requestDraw();
  }

  getModel(): DiagramModel {
    return this.model;
  }

  setModel(model: DiagramModel): void {
    this.model = model;
    this.selection = new Set();
    this.cb.onSelectionChange?.([]);
    this.history.clear();
    this.scheduleFit();
  }

  /** The model this editor is drawing. See `adoptModel` for why it matters. */
  get currentModel(): DiagramModel {
    return this.model;
  }

  /**
   * Take a new model object for the SAME document, keeping the viewport.
   *
   * `setModel` is for opening a different model: it drops the selection, throws
   * away the undo stack and refits. This is for a model re-parsed from the text
   * while the user is in code mode — the canvas must not jump, but the editor
   * and the plugin MUST hold the same object.
   *
   * They did not, and the cost was silent: `validateCode` adopted the parsed
   * model into the plugin while the editor kept the old one, so switching back
   * to the diagram drew one model and inspected another. Every component then
   * reported "1 components selected." with no fields, and any edit made
   * afterwards went into the model the plugin was no longer holding, so it never
   * reached the file.
   */
  adoptModel(model: DiagramModel): void {
    if (this.model === model) return;
    this.model = model;
    // Ids that the new text no longer declares must leave the selection, or the
    // inspector reports a component that is not there.
    const alive = new Set(model.components.map((c) => c.id));
    this.selection = new Set([...this.selection].filter((id) => alive.has(id)));
    // The undo stack describes the text that was replaced; stepping back into it
    // would restore a model the plugin does not hold.
    this.history.clear();
    this.requestDraw();
  }

  /* ---------------- viewport ---------------- */

  /**
   * Fit the diagram to the canvas. Prefer `scheduleFit` when size may be stale.
   *
   * The margin is in SCREEN pixels, and the scale is allowed all the way to
   * `MAX_ZOOM`. Both were wrong in a way that only shows on a small model in a
   * large pane: the bounds were padded by 40 diagram units — 40px at scale 1, but
   * 200px at scale 5 — and the fitted scale was capped at 2, so a circuit drawn
   * over 150x60 units could not fill a 1300x330 pane even with no margin at all.
   * It came out as 120px of drawing in the middle of the canvas, reported as "the
   * real estate is not filled".
   */
  zoomToFit(): void {
    this.resize();
    if (this.cssWidth < 80 || this.cssHeight < 80) {
      // No usable size yet; try again once layout has settled.
      this.fitPending = true;
      window.setTimeout(() => this.resolveFit(), 50);
      return;
    }
    this.fittedFor = { w: this.cssWidth, h: this.cssHeight };
    const [x1, y1, x2, y2] = diagramBounds(this.model);
    const w = Math.max(1, x2 - x1);
    const h = Math.max(1, y2 - y1);
    // A margin on every side, and more at the bottom: a component's name is drawn
    // BELOW its symbol and is not part of any extent, so a fit that ignores it
    // clips the labels off the bottom row.
    const availW = Math.max(40, this.cssWidth - 2 * FIT_MARGIN);
    const availH = Math.max(40, this.cssHeight - 2 * FIT_MARGIN - FIT_LABEL_ROOM);
    const scale = clamp(Math.min(availW / w, availH / h), MIN_ZOOM, MAX_ZOOM);
    this.viewport.scale = scale;
    this.viewport.x = this.cssWidth / 2 - ((x1 + x2) / 2) * scale;
    // Centred in the box that EXCLUDES the label room, not in the whole canvas:
    // centring in the canvas splits that extra room evenly, so half of it ends up
    // above and the bottom row of names is clipped anyway — which is what the
    // first version of this did.
    const band = (FIT_MARGIN + (this.cssHeight - FIT_MARGIN - FIT_LABEL_ROOM)) / 2;
    this.viewport.y = band + ((y1 + y2) / 2) * scale;
    this.requestDraw();
  }

  zoomBy(factor: number): void {
    const next = clamp(this.viewport.scale * factor, MIN_ZOOM, MAX_ZOOM);
    const applied = next / this.viewport.scale;
    const cx = this.cssWidth / 2;
    const cy = this.cssHeight / 2;
    this.viewport.x = cx - (cx - this.viewport.x) * applied;
    this.viewport.y = cy - (cy - this.viewport.y) * applied;
    this.viewport.scale = next;
    this.requestDraw();
  }

  /* ---------------- drawing ---------------- */

  requestDraw(): void {
    if (this.destroyed || this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      if (!this.destroyed) this.draw();
    });
  }

  /** Count of completed paints, for diagnosing a blank diagram. */
  drawCount = 0;

  private draw(): void {
    this.drawCount++;
    const ctx = this.ctx;
    const vp = this.viewport;
    const dpr = this.dpr;
    // Resolved once per frame so every part of the diagram uses one palette.
    const theme = currentTheme();
    this.frameTheme = theme;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    this.drawGrid(ctx);

    // Read once per frame, before anything that needs it: the wires, the symbols
    // and their port rings all take their weight from these settings.
    const display = this.cb.display?.() ?? { labelScale: 1, hoverParameters: false };

    // Resolved once per frame: a model of a hundred components has a couple of
    // hundred connections, and looking each endpoint up by scanning would be
    // quadratic on every paint.
    const componentsById = new Map(this.model.components.map((c) => [c.id, c]));
    // One resolution per frame, used by the wires, the symbols and their pins.
    const scales = this.strokeScales();

    for (const conn of this.model.connections) {
      const picked = this.wireSelection.has(conn.id);
      const points = this.connectionPoints(conn);
      // The connector's own colour, unless the model carries an explicit
      // annotation on the connect clause, which is what a tool writes when a
      // route is edited by hand — that wins.
      const wire = this.connectionStyle(conn, componentsById);
      drawConnection(ctx, conn, points, vp, dpr, {
        // A wire is highlighted when it is selected itself, and also when a
        // component it attaches to is selected: moving a component takes its
        // wires with it, so showing which ones those are is what makes the
        // consequence of the selection visible before the drag.
        selected:
          picked ||
          this.selection.has(conn.from.component) ||
          this.selection.has(conn.to.component) ||
          this.hoveredWire === conn.id,
        // The connector's own thickness, so the wire is drawn through the same
        // clamp the symbols use: 0.5 is double 0.25, as MSL's documentation says
        // a bus line is. `widthScale` is then only the reader's preference.
        thickness: LINE_THICKNESS_UNIT * (wire?.widthRatio ?? 1),
        widthScale: scales.wires,
        ...(conn.color ? {} : wire?.color ? { color: wire.color } : {}),
      });
      // Corners to drag, but only for the wire in hand: showing them for every
      // wire attached to a selected component would litter a multi-selection with
      // handles that mostly do not belong to the thing being moved.
      if (picked) drawWireVertices(ctx, points, vp, dpr, theme);
    }

    for (const inst of this.model.components) {
      drawComponent(ctx, inst, this.cb.lookup(inst.className), vp, dpr, {
        lookup: this.cb.lookup,
        resolveParam: this.cb.resolveParam,
        selection: this.selection,
        hovered: this.hovered,
        showCentre: this.showProbe,
        labelScale: display.labelScale,
        instanceLabels: display.instanceLabels ?? true,
        strokeScale: scales.symbols,
      });
    }

    // Last, so the readout sits over the symbols rather than under the ones
    // drawn after the component it describes.
    if (display.hoverParameters && this.hovered && this.interaction.kind === "none") {
      const hovered = this.instanceOf(this.hovered);
      if (hovered) this.drawHoverReadout(ctx, hovered, display.labelScale);
    }

    if (this.selection.size === 1) {
      const inst = this.instanceOf([...this.selection][0]);
      if (inst) {
        drawHandles(
          ctx,
          inst,
          this.cb.lookup(inst.className),
          vp,
          dpr,
          this.interaction.kind === "resize" ? this.interaction.handle : undefined
        );
      }
    }

    // Ports are drawn for every component so wiring is discoverable, with the
    // selection, the hovered component and the wiring source emphasised.
    for (const inst of this.model.components) {
      const def = this.cb.lookup(inst.className);
      const size = (inst.placement.extent[2] - inst.placement.extent[0]) * vp.scale;
      const emphasised =
        this.selection.has(inst.id) ||
        this.hovered === inst.id ||
        (this.interaction.kind === "wire" && this.interaction.from.component === inst.id);
      const highlight =
        this.hoveredPort?.component === inst.id
          ? this.hoveredPort.port
          : this.interaction.kind === "wire" && this.interaction.from.component === inst.id
            ? this.interaction.from.port
            : undefined;
      drawPorts(ctx, inst, def, vp, dpr, highlight, {
        emphasised,
        componentPx: size,
        strokeScale: scales.symbols,
      });
    }

    this.drawEmptyState(ctx, theme);

    if (this.showProbe) this.drawHitRegions(ctx);
    this.drawRubberBand(ctx);
    this.drawPendingWire(ctx);
    if (this.showProbe) this.drawViewportReadout(ctx);
    this.drawProbe(ctx);
  }

  /**
   * What a component's parameters are set to, while the pointer rests on it.
   *
   * Screen-space furniture, drawn with the identity transform like the label it
   * sits beside, so it does not scale with the zoom and stays readable when the
   * diagram is zoomed out to see the whole model.
   *
   * Placed below the symbol by preference and above it when there is no room, so
   * it never covers the component being described.
   */
  private drawHoverReadout(
    ctx: CanvasRenderingContext2D,
    inst: ComponentInstance,
    labelScale: number
  ): void {
    const def = this.cb.lookup(inst.className);
    const rows = hoverParameterLines(inst, def);
    const t = this.frameTheme;

    // A parameter whose default is a library EXPRESSION has no value this can
    // report. Saying so is the honest option; leaving the row out would read as
    // the parameter not existing.
    const lines: { text: string; overridden: boolean }[] = rows.map((r) => ({
      text: r.value === "" ? `${r.name} = library default` : `${r.name} = ${r.value}`,
      overridden: r.overridden,
    }));
    if (lines.length === 0) lines.push({ text: "no parameters", overridden: false });

    // The popup's own scale, NOT the label size: the name under a symbol is read
    // at a glance and the popup is read deliberately, so wanting one larger says
    // nothing about the other. `labelScale` still sets the gap it is placed in,
    // because that gap is about clearing the caption.
    //
    // Clamped to the range the setting offers, and no tighter: the old 9-13px
    // clamps were there to keep a label derived from the symbol's size
    // proportionate, and against a deliberate setting they simply ignore it —
    // 200% came out as 13px.
    const readoutScale = Math.max(0.5, Math.min(2.5, this.cb.display?.().readoutScale ?? 1));
    const headPx = 13 * readoutScale;
    const bodyPx = 12 * readoutScale;
    // Padding and leading follow the text, or a large font overflows its box.
    const pad = Math.round(6 * readoutScale);
    const gap = Math.round(14 * readoutScale);
    const lineH = bodyPx + Math.round(4 * readoutScale);
    const margin = 4;
    const canvasW = this.cssWidth * this.dpr;
    const canvasH = this.cssHeight * this.dpr;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${headPx}px sans-serif`;
    const title = inst.id;
    ctx.font = `${bodyPx}px monospace`;
    let colW = ctx.measureText(title).width;
    for (const line of lines) colW = Math.max(colW, ctx.measureText(line.text).width);

    // EVERY parameter is shown, so a long list has to be laid out rather than
    // truncated: the tallest in MSL, `FreeMotionScalarInit`, has 49. Filling
    // whole columns top-to-bottom keeps the reading order natural, and the panel
    // is as tall as the canvas allows rather than as tall as the list.
    const room = canvasH - margin * 2 - pad * 2 - headPx - 2;
    const perColumn = Math.max(1, Math.floor(room / lineH));
    const columns = Math.max(1, Math.ceil(lines.length / perColumn));
    const rowsHere = Math.max(1, Math.ceil(lines.length / columns));
    const width = columns * colW + (columns - 1) * gap + pad * 2;
    const height = pad * 2 + headPx + 2 + rowsHere * lineH;

    // Where the symbol actually is, in the same device pixels.
    const box = transformedBounds(
      viewportTransform(this.viewport, this.dpr),
      ...instanceOutlineBounds(inst, def)
    );
    const { x, y } = placeReadout(
      box,
      { width, height },
      { width: canvasW, height: canvasH },
      { margin, labelGap: 18 * labelScale }
    );

    // Opaque, not the translucent panel the diagnostics use: this one has to sit
    // over the diagram, and a see-through panel invites clicking what shows
    // through it. `theme.background` IS the canvas colour, so it reads the same
    // while hiding what is behind it.
    ctx.fillStyle = t.background;
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = t.diagPanelStroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = t.diagText;
    ctx.font = `${headPx}px sans-serif`;
    ctx.fillText(title, x + pad, y + pad);
    ctx.font = `${bodyPx}px monospace`;
    lines.forEach((line, i) => {
      const col = Math.floor(i / rowsHere);
      const row = i % rowsHere;
      // The value this instance overrides stands out from the ones it inherits,
      // which is the distinction the readout exists to make.
      ctx.globalAlpha = line.overridden ? 1 : 0.72;
      ctx.fillText(line.text, x + pad + col * (colW + gap), y + pad + headPx + 2 + row * lineH);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /**
   * Explain a canvas with nothing on it.
   *
   * A model can legitimately have no schematic: `DampedBounce` is an equation
   * model whose declarations are all variables, so there is no icon, port or
   * wire to draw. An empty grid with no explanation is indistinguishable from a
   * model that failed to load, so the canvas says which it is and what the model
   * does contain.
   */
  private drawEmptyState(ctx: CanvasRenderingContext2D, theme: Theme): void {
    if (this.model.components.length > 0 || this.model.connections.length > 0) return;
    const vars = this.model.variables ?? [];
    const w = this.cssWidth;
    const h = this.cssHeight;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const lines: Array<[string, string]> = vars.length
      ? [
          ["This model has no schematic.", "16px sans-serif"],
          [
            `${vars.length} variable${vars.length === 1 ? "" : "s"} and ${vars.length === 1 ? "its" : "their"} equations —` +
              ` switch to Code to read the physics.`,
            "13px sans-serif",
          ],
          [vars.map((v) => v.id).join(", "), "13px monospace"],
          ["Press Simulate to plot the result.", "13px sans-serif"],
        ]
      : [["Drag a component in from the palette to start.", "14px sans-serif"]];

    const step = 22;
    const top = h / 2 - ((lines.length - 1) * step) / 2;
    lines.forEach(([text, font], i) => {
      ctx.font = font;
      // `grid` is a hairline tone at 13% opacity — fine for a grid, invisible as
      // text. `chip` is 35%. The theme's opaque annotation tone is
      // `placeholderText`, which is meant to be read.
      ctx.fillStyle = i === 0 ? theme.label : theme.placeholderText;
      ctx.globalAlpha = i === 0 ? 1 : 0.8;
      ctx.fillText(text, w / 2, top + i * step);
    });
    ctx.globalAlpha = 1;
  }

  /**
   * Dump the geometry the editor is actually using, as text.
   *
   * Built for reading in the developer console: it reports the canvas position
   * and size, the viewport, and — for each component — where the symbol is
   * drawn versus where the hit box is, in canvas-local, client and diagram
   * coordinates. Any disagreement between those is then a number, not an
   * impression.
   */
  dumpGeometry(): string {
    const rect = this.canvas.getBoundingClientRect();
    const host = this.container.getBoundingClientRect();
    const vt = viewportTransform(this.viewport, this.dpr);
    const lines = [
      "=== Modelica Studio geometry ===",
      `canvas rect : ${rect.width.toFixed(1)}x${rect.height.toFixed(1)} at (${rect.left.toFixed(1)}, ${rect.top.toFixed(1)})`,
      `host   rect : ${host.width.toFixed(1)}x${host.height.toFixed(1)} at (${host.left.toFixed(1)}, ${host.top.toFixed(1)})`,
      `canvas css  : ${this.cssWidth}x${this.cssHeight}   backing: ${this.canvas.width}x${this.canvas.height}`,
      `dpr         : this.dpr=${this.dpr}  window.devicePixelRatio=${window.devicePixelRatio}`,
      `window      : inner ${window.innerWidth}x${window.innerHeight}  screen ${window.screen.width}x${window.screen.height}`,
      `viewport    : x=${this.viewport.x.toFixed(2)} y=${this.viewport.y.toFixed(2)} scale=${this.viewport.scale.toFixed(4)}`,
      "",
      "id     extent                 draw(css)        hit(css)         draw(client)     hit(client)",
    ];
    for (const inst of this.model.components) {
      const def = this.cb.lookup(inst.className);
      const t = mul(viewportTransform(this.viewport, this.dpr), placementTransform(inst));
      // Device-space centre of the drawn symbol, converted to CSS pixels.
      const drawDev = apply(t, 0, 0);
      const drawCss: [number, number] = [drawDev[0] / this.dpr, drawDev[1] / this.dpr];
      const hb = transformedBounds(vt, ...instanceHitBounds(inst, def));
      const hitCss: [number, number] = [
        ((hb[0] + hb[2]) / 2) / this.dpr,
        ((hb[1] + hb[3]) / 2) / this.dpr,
      ];
      const ex = inst.placement.extent;
      lines.push(
        `${inst.id.padEnd(6)} [${ex.map((v) => v.toFixed(0)).join(",")}]`.padEnd(30) +
          `(${drawCss[0].toFixed(1)},${drawCss[1].toFixed(1)})`.padEnd(17) +
          `(${hitCss[0].toFixed(1)},${hitCss[1].toFixed(1)})`.padEnd(17) +
          `(${(drawCss[0] + rect.left).toFixed(1)},${(drawCss[1] + rect.top).toFixed(1)})`.padEnd(17) +
          `(${(hitCss[0] + rect.left).toFixed(1)},${(hitCss[1] + rect.top).toFixed(1)})`
      );
    }
    return lines.join("\n");
  }

  /**
   * Print the live viewport and canvas geometry onto the canvas.
   *
   * Diagnostic: the viewport origin decides where every diagram coordinate
   * lands, so printing it makes a mismatch visible rather than inferred.
   */
  private drawViewportReadout(ctx: CanvasRenderingContext2D): void {
    const t = this.frameTheme;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const rect = this.canvas.getBoundingClientRect();
    const lines = [
      `vp x=${this.viewport.x.toFixed(1)} y=${this.viewport.y.toFixed(1)} scale=${this.viewport.scale.toFixed(3)}`,
      `dpr=${this.dpr} css=${this.cssWidth}x${this.cssHeight} backing=${this.canvas.width}x${this.canvas.height}`,
      `rect=${rect.width.toFixed(0)}x${rect.height.toFixed(0)} at (${rect.left.toFixed(0)},${rect.top.toFixed(0)})`,
      `win=${window.innerWidth}x${window.innerHeight} screen=${window.screen.width}x${window.screen.height}`,
      `host rect ${(() => {
        const r = this.container.getBoundingClientRect();
        return `${r.width.toFixed(0)}x${r.height.toFixed(0)} at (${r.left.toFixed(0)},${r.top.toFixed(0)})`;
      })()}`,
      `view content ${(() => {
        const el = this.container.parentElement?.parentElement?.parentElement;
        const r = el?.getBoundingClientRect();
        return r ? `${r.width.toFixed(0)}x${r.height.toFixed(0)} at (${r.left.toFixed(0)},${r.top.toFixed(0)})` : "n/a";
      })()}`,
    ];
    ctx.fillStyle = t.diagPanelBackground;
    ctx.fillRect(6, 6, 420, 16 * lines.length + 10);
    ctx.strokeStyle = t.diagPanelStroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(6.5, 6.5, 420, 16 * lines.length + 10);
    ctx.fillStyle = t.diagText;
    ctx.font = "12px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    lines.forEach((t, i) => ctx.fillText(t, 12, 12 + i * 16));
    ctx.restore();
  }

  /**
   * Outline the region that responds to a click, for every component.
   *
   * Diagnostic only. If this outline does not sit on the drawn symbol, the
   * clickable area and the picture disagree, and the discrepancy is visible
   * directly instead of having to be deduced from logs.
   */
  private drawHitRegions(ctx: CanvasRenderingContext2D): void {
    const t = this.frameTheme;
    const vt = viewportTransform(this.viewport, this.dpr);
    ctx.save();
    // `transformedBounds(vt, ...)` already includes the device pixel ratio, so
    // its results are DEVICE pixels and the transform must be IDENTITY.
    // Applying `dpr` here scaled them again, drawing the boxes (dpr - 1) x their
    // position closer to the origin than the symbols they describe.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = t.diagHitRegion;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    for (const inst of this.model.components) {
      const b = transformedBounds(vt, ...instanceHitBounds(inst, this.cb.lookup(inst.className)));
      ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    }
    // Also outline the DRAWN box, to compare the two.
    ctx.strokeStyle = t.diagDrawnBox;
    ctx.setLineDash([]);
    for (const inst of this.model.components) {
      const b = transformedBounds(vt, ...instanceOutlineBounds(inst, this.cb.lookup(inst.className)));
      ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    }
    ctx.restore();
  }

  /**
   * Draw a marker where the editor believes the last press landed.
   *
   * Enabled by the "Show click marker" setting. If the marker does not appear
   * under the pointer, the screen-to-diagram mapping is wrong, and that is
   * visible at a glance instead of needing to be deduced.
   */
  private drawProbe(ctx: CanvasRenderingContext2D): void {
    const p = this.probePoint;
    if (!p) return;
    const t = this.frameTheme;
    ctx.save();
    // `probePoint` comes from `sceneTransform()`, which maps diagram units to
    // CSS pixels — NOT device pixels. Drawing it under the identity transform
    // therefore placed the marker at 1/dpr of its true position, so the cross
    // appeared offset from the click it was reporting.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.strokeStyle = t.diagMarker;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x - 14, p.y);
    ctx.lineTo(p.x + 14, p.y);
    ctx.moveTo(p.x, p.y - 14);
    ctx.lineTo(p.x, p.y + 14);
    ctx.stroke();
    ctx.restore();
  }

  private drawRubberBand(ctx: CanvasRenderingContext2D): void {
    const inter = this.interaction;
    if (inter.kind !== "rubber") return;
    const t = this.frameTheme;
    const vp = this.viewport;
    const [bx1, by1, bx2, by2] = rubberBox(inter);
    const x = bx1 * vp.scale + vp.x;
    // `by2` is the LARGER diagram y, which is the TOP of the band on screen
    // because the viewport negates y -- and a canvas rect grows downward from the
    // corner it is given, so the top is the corner to anchor at. Anchoring at
    // `by1` instead draws the band as far below the gesture as it belongs above
    // it: detached from the pointer, and over whatever is on the other side.
    const y = -by2 * vp.scale + vp.y;
    const w = (bx2 - bx1) * vp.scale;
    const h = (by2 - by1) * vp.scale;
    if (w < 0.5 && h < 0.5) return;
    ctx.save();
    ctx.fillStyle = t.bandFill;
    ctx.strokeStyle = t.selection;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.restore();
  }

  private drawPendingWire(ctx: CanvasRenderingContext2D): void {
    const inter = this.interaction;
    // Only draw once the gesture is a real wire; while merely armed, the pin
    // highlight is enough feedback.
    if (inter.kind !== "wire") return;
    const vp = this.viewport;
    const [ax, ay] = inter.fromPos;
    const t = this.frameTheme;
    const bx = inter.hoverPort
      ? (this.instancePos(inter.hoverPort.component, inter.hoverPort.port)?.[0] ?? inter.toX)
      : inter.toX;
    const by = inter.hoverPort
      ? (this.instancePos(inter.hoverPort.component, inter.hoverPort.port)?.[1] ?? inter.toY)
      : inter.toY;
    ctx.save();
    ctx.strokeStyle = t.wirePending;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(ax * vp.scale + vp.x, -ay * vp.scale + vp.y);
    ctx.lineTo(bx * vp.scale + vp.x, -by * vp.scale + vp.y);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Wire route in diagram coordinates.
   *
   * Endpoints are always re-anchored to the live port positions — stored
   * waypoints are only the path between them — so a wire stays attached when a
   * component moves and never leaves a gap at the pin.
   */
  private connectionPoints(conn: Connection): number[] {
    const a = this.instancePos(conn.from.component, conn.from.port);
    const b = this.instancePos(conn.to.component, conn.to.port);
    if (!a || !b) return conn.points;
    if (conn.points.length >= 4) {
      const pts = conn.points.slice();
      pts[0] = a[0];
      pts[1] = a[1];
      pts[pts.length - 2] = b[0];
      pts[pts.length - 1] = b[1];
      return pts;
    }
    return routeConnection(a, b, conn.points);
  }

  /**
   * The wire under a point, and the resolved polyline it was hit on.
   *
   * `slack` is in diagram units, so the caller divides a screen tolerance by the
   * zoom and the grab distance stays constant on screen at any scale. Wires are
   * tested nearest-first so that crossing wires pick the one on top, which is the
   * one drawn last.
   */
  /** The wire weight, for the grab radius: a thick wire must stay grabbable. */
  private wireScale(): number {
    return this.strokeScales().wires;
  }

  /**
   * The two thickness weights, with the link applied — read per use rather than
   * captured, so a settings change shows on the next redraw.
   */
  private strokeScales(): { wires: number; symbols: number } {
    const display = this.cb.display?.() ?? { labelScale: 1, hoverParameters: false };
    return effectiveStrokeScales({
      wireScale: display.wireScale ?? 1,
      symbolStrokeScale: display.symbolStrokeScale ?? 1,
      syncStrokeScale: display.syncStrokeScale === true,
    });
  }

  /**
   * How MSL says a wire to this connection's connectors is drawn.
   *
   * The rule takes the colour and the weight from the connector's own icon — see
   * `connectorWireStyle` — so this resolves each end's port to its connector
   * class and asks it. The `from` end decides; the `to` end is the fallback for
   * a wire whose first end is a plain signal port (`input Real u`) with no
   * connector class of its own.
   */
  private connectionStyle(
    conn: Connection,
    byId: Map<string, ComponentInstance>
  ): ConnectorWireStyle | undefined {
    for (const end of [conn.from, conn.to]) {
      const inst = byId.get(end.component);
      if (!inst) continue;
      const port = this.cb.lookup(inst.className)?.ports.find((p) => p.name === end.port);
      if (!port?.connectorClass) continue;
      const style = connectorWireStyle(this.cb.lookup(port.connectorClass));
      if (style) return style;
    }
    return undefined;
  }

  private hitTestWire(
    x: number,
    y: number,
    slack: number
  ): { conn: Connection; points: number[]; distance: number } | undefined {
    let best: { conn: Connection; points: number[]; distance: number } | undefined;
    for (const conn of this.model.connections) {
      const points = this.connectionPoints(conn);
      const distance = distanceToPolyline(points, x, y);
      if (distance > slack) continue;
      // `<=` keeps the LAST wire among equals, matching the draw order.
      if (!best || distance <= best.distance) best = { conn, points, distance };
    }
    return best;
  }

  /**
   * Set the wire selection, and tell the view.
   *
   * The component selection is cleared unless asked otherwise: a press on a wire
   * means the wire, and leaving components selected as well would make the next
   * Delete remove things the user had stopped thinking about.
   */
  private setWireSelection(ids: Iterable<string>, opts: { keepComponents?: boolean } = {}): void {
    const next = new Set(ids);
    const same = sameSet(next, this.wireSelection);
    if (same && (opts.keepComponents || this.selection.size === 0)) return;
    this.wireSelection = next;
    if (!opts.keepComponents) this.selection = new Set();
    this.cb.onSelectionChange?.(this.selectedIds);
    this.requestDraw();
  }

  /** Drop both selections. */
  private clearSelection(): void {
    const had = this.selection.size > 0 || this.wireSelection.size > 0;
    this.selection = new Set();
    this.wireSelection = new Set();
    if (had) {
      this.cb.onSelectionChange?.([]);
      this.requestDraw();
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const step = GRID * this.viewport.scale;
    if (step < 6) return;
    ctx.save();
    ctx.strokeStyle = this.frameTheme.grid;
    ctx.lineWidth = 1;
    const startX = ((this.viewport.x % step) + step) % step;
    const startY = ((this.viewport.y % step) + step) % step;
    ctx.beginPath();
    for (let x = startX; x < this.cssWidth; x += step) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, this.cssHeight);
    }
    for (let y = startY; y < this.cssHeight; y += step) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(this.cssWidth, Math.round(y) + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Smallest grid step for placement snapping, in diagram units. */
export const GRID = 10;

/** Minimum component size, in diagram units. */
const MIN_SIZE = 8;

/** Pointer travel, in screen pixels, before a click becomes a drag. */
const DRAG_THRESHOLD_PX = 4;

/** Radius, in screen pixels, within which a connector can be grabbed. */
const PORT_GRAB_PX = 7;

/**
 * How close, in screen pixels, a press must be to a wire to land on it.
 *
 * Wider than a port's grab radius because a wire is a thin line with nothing
 * behind it: aiming at one exactly is fiddly, and the nearest-miss is
 * unambiguous in a way that two overlapping components are not.
 */
/**
 * How near a click has to be to a wire, in screen pixels.
 *
 * Multiplied by the wire-thickness setting wherever it is used: a wire drawn
 * three times as heavy has to be grabbable across its face, or the setting makes
 * the diagram look right and feel wrong.
 */
const WIRE_GRAB_PX = 6;

/** Radius within which a press on a wire grabs a corner instead of the wire. */
const WIRE_VERTEX_GRAB_PX = 8;

const MIN_ZOOM = 0.08;
const MAX_ZOOM = 16;

/**
 * Space a fit leaves around the diagram, in CSS pixels.
 *
 * Pixels rather than diagram units, because a margin is something the eye sees:
 * the same 40 units is a comfortable border at scale 1 and most of the pane at
 * scale 5. The extra room at the bottom is for the component names, which are
 * drawn below their symbols.
 */
const FIT_MARGIN = 24;
const FIT_LABEL_ROOM = 22;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function centreOf(ext: number[]): [number, number] {
  return [(ext[0] + ext[2]) / 2, (ext[1] + ext[3]) / 2];
}

function offsetExtent(
  ext: [number, number, number, number],
  d: number
): [number, number, number, number] {
  return [ext[0] + d, ext[1] + d, ext[2] + d, ext[3] + d];
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/** Normalised rubber-band rectangle from the current interaction. */
function rubberBox(inter: {
  startX: number;
  startY: number;
  x: number;
  y: number;
}): [number, number, number, number] {
  return [
    Math.min(inter.startX, inter.x),
    Math.min(inter.startY, inter.y),
    Math.max(inter.startX, inter.x),
    Math.max(inter.startY, inter.y),
  ];
}

/** True when the rubber band never grew, i.e. the gesture was a plain click. */
function isZeroSize(inter: { startX: number; startY: number; x: number; y: number }): boolean {
  return Math.abs(inter.x - inter.startX) < 1e-6 && Math.abs(inter.y - inter.startY) < 1e-6;
}

function arrowDelta(key: string, step: number): [number, number] {
  switch (key) {
    case "ArrowUp":
      return [0, -step];
    case "ArrowDown":
      return [0, step];
    case "ArrowLeft":
      return [-step, 0];
    default:
      return [step, 0];
  }
}

function shortName(className: string): string {
  const parts = className.split(".");
  return parts[parts.length - 1] ?? "component";
}

/** True when the event target is a text input, where shortcuts must not fire. */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return el.isContentEditable === true;
}

/** Cheap shape check for a pasted fragment. */
function looksLikeFragment(text: string): boolean {
  if (!text || text[0] !== "{") return false;
  try {
    const o = JSON.parse(text) as { components?: unknown };
    return Array.isArray(o.components);
  } catch {
    return false;
  }
}

/** Give a new instance the class's declared parameter defaults. */
export function defaultParams(def: ComponentClass): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of def.parameters) {
    if (p.defaultValue !== undefined) out[p.name] = p.defaultValue;
  }
  return out;
}
