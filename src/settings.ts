/**
 * Plugin settings.
 *
 * Defaults are chosen so the plugin works with no configuration on a machine
 * where OpenModelica is installed normally; every field exists to rescue an
 * unusual setup rather than to require tuning.
 */

import { Notice, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type ModelicaStudioPlugin from "./main";
import { FolderSuggest } from "./view/folder-suggest";
// The snap distance is defined by the plot, which has to clamp whatever it is
// given: the slider offers exactly the range the plot will honour, so the number
// shown is the number in force rather than a value silently pinned at the end.
import { MAX_SNAP_TOLERANCE_PX, MIN_SNAP_TOLERANCE_PX, snapTolerancePx } from "./view/plot";
import { exclusionsFrom, libraryRows } from "./modelica/library-exclusions";
import { SOLVERS, solverDescription, AI_THINKING_LEVELS, MODEL_STYLES, type AiThinking, type ModelStyle, AI_DEFAULTS,
  DEFAULT_TIMEOUT_SECONDS, AI_PROVIDERS, LEGACY_SECRET_NAME, legacyKeyOf } from "./ai/prompts";



// Used by the thickness sliders, and re-exported below for anything that needs
// to know the band without importing the merge module.
import {
  resetPreferences,
  STROKE_SCALE_MAX,
  STROKE_SCALE_MIN,
} from "./settings-merge";
import { confirm } from "./view/confirm";

/*
 * Two Obsidian APIs this tab still calls are deprecated, and it calls them on purpose.
 * The directory lists a deprecation as a recommendation, so they stay visible there; what
 * follows is why they have not been replaced.
 *
 * - `setDynamicTooltip` (nine sliders) prints a slider's value while it is dragged. On
 *   Obsidian 1.13 and later the value is shown beside the control anyway, and the call is
 *   a no-op; before 1.13 it is the only place the number appears. `minAppVersion` is
 *   1.11.4, so removing the call would take the value away from those readers.
 * - `display` is the classic entry point for a settings tab. Its replacement,
 *   `getSettingDefinitions()`, is `@since 1.13.0` and describes rows declaratively: it
 *   cannot express this tab's custom parts — the toolchain status box, the library
 *   checkboxes, the performance table, the keychain row — without `render` callbacks, and
 *   adopting it while `minAppVersion` is 1.11.4 would leave older Obsidian with a tab
 *   that draws nothing. Revisit both when the minimum version rises to 1.13.
 */
export class ModelicaStudioSettingTab extends PluginSettingTab {
  plugin: ModelicaStudioPlugin;

  constructor(plugin: ModelicaStudioPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  /**
   * The library list to draw, or null while the index is still being built.
   *
   * The index takes a couple of seconds on a cold start, and the settings tab can
   * be opened before it finishes. Recording that here lets the plugin re-render
   * this tab when the index arrives, so the list is not left saying "no libraries
   * indexed yet" for the rest of the session.
   */
  private packagesReady: string[] | null = null;

  /**
   * Re-render if the tab is open and the library list has CHANGED.
   *
   * It used to rebuild whenever the list had been empty a moment ago, and the index
   * finishing is exactly the kind of thing that lands seconds after a click: a reader
   * toggled something, scrolled, and the tab jumped when the index arrived. Comparing
   * the list means a rebuild happens when there is something new to show and not
   * otherwise — and `display()` keeps the place when it does (see below).
   */
  onLibraryReady(): void {
    if (!this.containerEl.isShown?.()) return;
    const now = this.plugin.library.packages();
    const drew = this.packagesReady ?? [];
    if (now.length === drew.length && now.every((p, i) => p === drew[i])) return;
    this.display();
  }

  /**
   * Every element the pane could be scrolled in, with its offset.
   *
   * A LIST, not one element. The first version of this looked for the first ancestor
   * that scrolls or carries Obsidian's own container class and restored only that one
   * — and when the DOM around it changed, or an inner wrapper happened to report
   * `scrollHeight > clientHeight`, the offset was restored on an element nobody was
   * looking at while the real pane went back to the top. Which element Obsidian
   * actually scrolls is its business, so every candidate on the way up is captured,
   * and each is written back (the browser clamps any that are too short).
   *
   * The walk stops at the modal, and after a handful of levels, so the document
   * itself is never touched.
   */
  private capturePlaces(): Array<[HTMLElement, number]> {
    const out: Array<[HTMLElement, number]> = [];
    let el = this.containerEl?.parentElement ?? null;
    for (let depth = 0; el && depth < 8; depth++, el = el.parentElement) {
      const classList = el.classList;
      const scrolls =
        el.scrollTop > 0 ||
        el.scrollHeight > el.clientHeight ||
        el.style?.overflowY === "auto" ||
        el.style?.overflowY === "scroll" ||
        !!classList?.contains("vertical-tab-content-container") ||
        !!classList?.contains("vertical-tab-content");
      if (scrolls) out.push([el, el.scrollTop]);
      if (classList?.contains("modal") || classList?.contains("modal-container")) break;
    }
    return out;
  }

  /** Put the captured offsets back. */
  private restorePlaces(places: Array<[HTMLElement, number]>): void {
    for (const [el, top] of places) if (el.scrollTop !== top) el.scrollTop = top;
  }

  /**
   * Undo a clamp that lands AFTER the rebuild, without fighting the reader.
   *
   * A browser clamps a scroll offset while it lays out content that momentarily had no
   * height (`empty()` then refill), and that layout can happen in the frame after the
   * rebuild — so restoring the offset synchronously is not always enough, which is
   * exactly how this came back: the harness forces the layout read inside `empty()` and
   * passed, while the app laid the pane out a frame later and jumped to the top.
   *
   * Only an offset that has been clamped to zero is put back, and only while the
   * reader has not scrolled somewhere themselves: a deliberate scroll in that window is
   * not ours to overwrite.
   */
  private keepPlaceAfterLayout(places: Array<[HTMLElement, number]>): void {
    if (places.length === 0) return;
    const again = () => {
      for (const [el, top] of places) if (top > 0 && el.scrollTop === 0) el.scrollTop = top;
    };
    if (typeof window.requestAnimationFrame === "function") {
      // Called on `window` rather than through an alias: the method has to keep its
      // receiver, and an alias loses it (the linter says so, and it is right).
      window.requestAnimationFrame(() => {
        again();
        window.requestAnimationFrame(again);
      });
    }
    // And on a timer as well, not instead: frames do not arrive in a hidden or
    // occluded window — Obsidian minimised, or a pane that is not on screen — and a
    // reader who comes back to a jumped pane is the same bug however it happened.
    window.setTimeout(again, 0);
    window.setTimeout(again, 60);
  }

  /**
   * Run `after` when the reader has finished with a text field.
   *
   * `onChange` on a text component fires on every keystroke, and this tab rebuilds
   * itself from several rows. Rebuilding per character destroyed the field being typed
   * in — caret and all — and moved the pane, which is the other half of "settings jump
   * whenever I toggle or click something". One edit, one rebuild: on blur, or on Enter
   * for a reader who does not leave the field.
   */
  private whenDoneTyping(input: HTMLElement, after: () => void): void {
    // The listeners are attached ONCE per field, and the action is looked up when they
    // fire. Registering a blur listener per keystroke instead meant one keystroke, one
    // listener, and then one re-probe per character typed the moment the field was
    // left -- three letters, three toolchain probes, three rebuilds.
    this.typingPending.set(input, after);
    if (this.typingWired.has(input)) return;
    this.typingWired.add(input);
    const done = () => {
      input.removeEventListener("blur", done);
      input.removeEventListener("keydown", onKey);
      this.typingWired.delete(input);
      const action = this.typingPending.get(input);
      this.typingPending.delete(input);
      action?.();
    };
    const onKey = (ev: Event) => {
      if ((ev as KeyboardEvent).key === "Enter") done();
    };
    input.addEventListener("blur", done);
    input.addEventListener("keydown", onKey);
  }

  /** What each field should do when the reader leaves it. */
  private typingPending = new WeakMap<HTMLElement, () => void>();
  /** Fields already listening, so an edit per keystroke does not stack listeners. */
  private typingWired = new WeakSet<HTMLElement>();

  /** True once the tab has been built at least once for this showing. */
  private builtOnce = false;

  /** A fresh open starts at the top; a rebuild keeps the reader's place. */
  hide(): void {
    this.builtOnce = false;
  }

  /**
   * Build the tab, and never move the reader while doing it.
   *
   * Every rebuild goes through here — the six rows that have to redraw the tab, the
   * library index arriving, and the toolchain being re-probed from the main plugin —
   * so "a rebuild keeps your place" is a property of the tab rather than a discipline
   * each call site has to remember. The offsets are captured before the container is
   * emptied, restored immediately, and restored again after layout.
   */
  display(): void {
    const places = this.builtOnce ? this.capturePlaces() : [];
    this.buildSettings();
    if (places.length > 0) {
      this.restorePlaces(places);
      this.keepPlaceAfterLayout(places);
    }
    this.builtOnce = true;
  }

  /** Empty the container and draw every row. */
  private buildSettings(): void {
    const { containerEl } = this;
    containerEl.empty();
    // A heading through the API rather than an `h2` in the container, which is what
    // the plugin submission checklist asks for.
    ;

    /* ---- toolchain status ---- */
    const status = this.plugin.toolchainSummary();
    const statusBox = containerEl.createDiv({ cls: "modelica-studio-setting-status" });
    statusBox.createEl("strong", { text: status.ok ? "OpenModelica detected" : "OpenModelica not detected" });
    statusBox.createDiv({ cls: "modelica-studio-muted", text: status.text });
    if (!status.ok && status.action) {
      statusBox.createEl("pre", { cls: "modelica-studio-muted", text: status.action });
    }

    new Setting(containerEl)
      .setName("OpenModelica path")
      .setDesc(
        "Path to the omc executable. Leave empty to detect automatically " +
          "(checks PATH, then the usual install locations)."
      )
      .addText((t) =>
        t
          .setPlaceholder("/usr/bin/omc")
          .setValue(this.plugin.settings.omcPath)
          .onChange(async (v) => {
            this.plugin.settings.omcPath = v.trim();
            await this.plugin.saveSettings();
            // Re-probe and redraw when the field is DONE, not per keystroke. This row
            // rebuilds the tab (the status box above and the library list below both
            // depend on the path), so doing it on every character destroyed the field
            // being typed in, caret and all, and moved the pane.
            this.whenDoneTyping(t.inputEl, () => void this.plugin.reprobeToolchain());
          })
      );

    new Setting(containerEl)
      .setName("Library paths")
      .setDesc(
        "Extra directories to index for components, one per line. " +
          "OpenModelica's own library directory is added automatically."
      )
      .addTextArea((t) => {
        t.setValue(this.plugin.settings.libraryPaths).onChange(async (v) => {
          this.plugin.settings.libraryPaths = v;
          await this.plugin.saveSettings();
          // The index is built from these roots and memoised, so it has to be rebuilt
          // or the new library never appears in the palette — once the reader has
          // finished with the field, rather than once per character: an index build per
          // keystroke is seconds of work per word, and it re-renders this tab when it
          // lands.
          this.whenDoneTyping(t.inputEl, () => this.plugin.reloadLibrary());
        });
        t.inputEl.rows = 3;
      });

    new Setting(containerEl)
      .setName("Parallel compile jobs")
      .setDesc(
        "Passed to omc as -n. OpenModelica defaults to 1, which makes " +
          "translation roughly 2.4x slower than necessary."
      )
      .addSlider((s) =>
        s
          .setLimits(1, 16, 1)
          .setValue(this.plugin.settings.jobs)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.jobs = v;
            await this.plugin.saveSettings();
            // `-n` is read when the backend is created.
            this.plugin.applySettingsToBackend();
          })
      );

    new Setting(containerEl)
      .setName("Extra omc options")
      .setDesc("Advanced. Raw command-line options appended to every omc invocation.")
      .addText((t) =>
        t
          .setPlaceholder("-d=initialization")
          .setValue(this.plugin.settings.extraOmcOptions)
          .onChange(async (v) => {
            this.plugin.settings.extraOmcOptions = v;
            await this.plugin.saveSettings();
            this.plugin.applySettingsToBackend();
          })
      );

    new Setting(containerEl).setName("Simulation defaults").setHeading();

    // Two different things, which were one row: the span the OPEN model runs over
    // (kept per model) and the span a model starts with. The row was labelled
    // "Default end time" and wrote the per-model value, so the plugin-wide default
    // could not be set from anywhere -- a new model always ran over 1 s.
    new Setting(containerEl)
      .setName("Stop time for this model")
      .setDesc(
        `End time in seconds for "${this.plugin.model.name}". Each model keeps its own ` +
          "span."
      )
      .addText((t) =>
        t.setValue(String(this.plugin.stopTime())).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) {
            this.plugin.setStopTime(n);
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName("Default stop time")
      .setDesc("End time in seconds for a model that has no span of its own yet.")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.stopTime)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) {
            this.plugin.settings.stopTime = n;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName("Start time")
      .setDesc("Default start time in seconds.")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.startTime)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n)) {
            this.plugin.settings.startTime = n;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName("Number of intervals")
      .setDesc("Output resolution. Higher values produce larger result sets.")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.numberOfIntervals)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) {
            this.plugin.settings.numberOfIntervals = Math.floor(n);
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName("Tolerance")
      .setDesc("Integrator tolerance.")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.tolerance)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) {
            this.plugin.settings.tolerance = n;
            await this.plugin.saveSettings();
          }
        })
      );

    // Everything about the chosen solver lives INSIDE this setting's block. The
    // description used to be one line and the detail was appended to the container
    // afterwards, so it floated loose below the block it belonged to.
    const solverSetting = new Setting(containerEl).setName("Solver");
    const showSolver = (id: string) => {
      const solver = SOLVERS.find((s) => s.id === id);
      solverSetting.setDesc(
        solver ? solverDescription(solver) : "Not a solver this runtime lists."
      );
    };
    solverSetting.addDropdown((d) => {
      for (const solver of SOLVERS) d.addOption(solver.id, solver.label);
      // A stored value the list does not carry is kept rather than silently
      // reset: it may be a name from a different OpenModelica version, and
      // discarding it would change a setting the user chose.
      const stored = this.plugin.settings.solver.trim();
      if (!SOLVERS.some((s) => s.id === stored)) d.addOption(stored, `${stored} (unverified)`);
      d.setValue(stored);
      showSolver(stored);
      d.onChange(async (v) => {
        this.plugin.settings.solver = v;
        showSolver(v);
        await this.plugin.saveSettings();
      });
    });

    new Setting(containerEl)
      .setName("Write diagnostic log")
      .setDesc(
        "Append startup and simulation events to .modelica-studio.log in the vault. " +
          "Useful when reporting a problem."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.debugLog).onChange(async (v) => {
          this.plugin.settings.debugLog = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Keep a log of AI requests and replies")
      .setDesc(
        "Records what was sent to the AI, what came back and what the compiler " +
          "made of it, in the plugin folder as ai-exchanges.jsonl. The reasons a " +
          "model was rejected after building are what a prompt change should be " +
          "aimed at, and they are only visible at the moment of the exchange. " +
          'Your API key is never written. Read it with the "Show the AI prompt ' +
          '"log" command.'
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.aiLog).onChange(async (v) => {
          this.plugin.settings.aiLog = v;
          await this.plugin.saveSettings();
          new Notice(v ? "AI log on." : "AI log off. Existing entries are kept.");
        })
      );

    new Setting(containerEl)
      .setName("Show coordinate diagnostics in the editor")
      .setDesc(
        "Draws, over the diagram: the region that responds to a click (orange " +
          "dashed), the box the symbol is drawn in (green), a dot at each " +
          "component's centre, a marker where the last click was interpreted, " +
          "and the live viewport. Use this when selection or wires look offset " +
          "from the symbols. Adds a Geometry button to the toolbar that reports " +
          "the same values as text."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.debugOverlay).onChange(async (v) => {
          this.plugin.settings.debugOverlay = v;
          await this.plugin.saveSettings();
          this.plugin.applyDebugOverlay();
        })
      );

    /* ---- the diagram ---- */
    new Setting(containerEl).setName("Diagram").setHeading();

    // The names are how a diagram is read while it is being built and clutter
    // once it is understood, so they can be switched off. The SIZE below then has
    // nothing to read, and says so by being greyed rather than looking live.
    let labelScaleRow: Setting | null = null;
    let dynamicRow: Setting | null = null;

    new Setting(containerEl)
      .setName("Show component names")
      .setDesc(
        "Draws the name under each component — `motor`, `load`, `resistor1`. Off, " +
          "the diagram is the symbols alone, which is what a screenshot in a note " +
          "usually wants. The library's own text INSIDE a symbol (a valve's state, " +
          "a machine's rating) is part of the drawing and stays, as does the name on " +
          "a component with no icon, which is the only thing identifying it."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showInstanceLabels).onChange(async (v) => {
          this.plugin.settings.showInstanceLabels = v;
          // Applied before the write, so the row greys as the switch moves rather
          // than one disk round-trip later.
          labelScaleRow?.setDisabled(!v);
          dynamicRow?.setDisabled(!v);
          this.plugin.getView()?.refreshDiagram();
          this.plugin.refreshEmbeds();
          await this.plugin.saveSettings();
        })
      );

    labelScaleRow = new Setting(containerEl)
      .setName("Label size")
      .setDesc(
        "Scales the name under each component in the diagram, as a percentage " +
          "of the default. The label is sized from the component's on-screen " +
          "size, so this moves that whole curve rather than pinning one size: " +
          "it still shrinks when you zoom out, and two components side by side " +
          "do not start overlapping. Applies to the Studio and to diagrams " +
          "embedded in notes, and reads nothing while the names are hidden."
      )
      .addSlider((sl) =>
        sl
          .setLimits(50, 250, 10)
          .setValue(Math.round(this.plugin.settings.labelScale * 100))
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.labelScale = v / 100;
            await this.plugin.saveSettings();
            // Both surfaces, because the setting is read while drawing: the
            // Studio repaints itself, and the embeds in any open note repaint
            // here. Telling only the Studio left a note's diagrams at the old
            // size until something else happened to redraw them.
            this.plugin.getView()?.refreshDiagram();
            this.plugin.refreshEmbeds();
          })
      );
    labelScaleRow.setDisabled(!this.plugin.settings.showInstanceLabels);

    // Placement is a separate question from size: a name can be the right size and
    // still be unreadable because it is sitting on the symbol below it or on a wire.
    dynamicRow = new Setting(containerEl)
      .setName("Move names out of the way")
      .setDesc(
        "Places each name beside its symbol instead of always under it: the four " +
          "sides are tried in turn and the first that lands on nothing wins, so a " +
          "name clears the other symbols, the wires and the other names. With this " +
          "off, every name sits centred below its own symbol, and one that would " +
          "overlap stays where it is. Applies to the Studio and to diagrams " +
          "embedded in notes, and reads nothing while the names are hidden."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.dynamicLabels).onChange(async (v) => {
          this.plugin.settings.dynamicLabels = v;
          await this.plugin.saveSettings();
          this.plugin.getView()?.refreshDiagram();
          this.plugin.refreshEmbeds();
        })
      );
    dynamicRow.setDisabled(!this.plugin.settings.showInstanceLabels);

    // The two thickness settings are two knobs on ONE curve. MSL's `thickness`
    // is a single scale — a connector asking for 0.5 draws a double line, and a
    // graphic asking for 0.5 draws the same weight — so the numbers mean the same
    // thing on both sliders, and linking them keeps the library's ratio.
    const strokeCommit = async () => {
      await this.plugin.saveSettings();
      this.plugin.getView()?.refreshDiagram();
      this.plugin.refreshEmbeds();
    };

    // All three rows exist, and the link chooses which of them are SHOWN.
    //
    // Building only the applicable rows and rebuilding the tab on every toggle was
    // the first attempt, and it dropped the reader at the top of Settings: the tab
    // is scrolled inside Obsidian's container, and emptying it lets the browser
    // clamp the scroll offset before the new rows go in. Hiding a row changes no
    // offset at all, so the jump is impossible rather than compensated for — and
    // the toggle is instant.
    let sharedRow: Setting | null = null;
    let wireRow: Setting | null = null;
    let symbolRow: Setting | null = null;
    let sharedSlider: { setValue: (v: number) => unknown } | null = null;
    let wireSlider: { setValue: (v: number) => unknown } | null = null;
    let symbolSlider: { setValue: (v: number) => unknown } | null = null;

    const applyStrokeLink = (linked: boolean) => {
      sharedRow?.settingEl.toggleClass("modelica-studio-hidden", !linked);
      wireRow?.settingEl.toggleClass("modelica-studio-hidden", linked);
      symbolRow?.settingEl.toggleClass("modelica-studio-hidden", linked);
      // The sliders show the values in force, which linking may have changed.
      if (linked) sharedSlider?.setValue(Math.round(this.plugin.settings.symbolStrokeScale * 100));
      else {
        wireSlider?.setValue(Math.round(this.plugin.settings.wireScale * 100));
        symbolSlider?.setValue(Math.round(this.plugin.settings.symbolStrokeScale * 100));
      }
    };

    new Setting(containerEl)
      .setName("Link wire and component thickness")
      .setDesc(
        "One slider for both, so the ratio the library draws with cannot be " +
          "broken by accident: the wires follow the component line weight at the " +
          "same declared thickness. Turning it on sets the wires to the component " +
          "weight. Off, each has its own slider."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.syncStrokeScale).onChange(async (v) => {
          this.plugin.settings.syncStrokeScale = v;
          if (v) this.plugin.settings.wireScale = this.plugin.settings.symbolStrokeScale;
          // Shown and hidden in place: nothing is rebuilt, so the reader keeps
          // their place and the control they moved stays under the pointer.
          applyStrokeLink(v);
          await strokeCommit();
        })
      );

    sharedRow = new Setting(containerEl)
      .setName("Line thickness")
      .setDesc(
        "Both wires and component lines, as a percentage of the weight the " +
          "library declares: 100% draws a single line at 1.5 px and a double one " +
          "at 3 px at 100% zoom, and each line keeps its own thickness relative " +
          "to that — a bus stays double a signal wire, a shaft outline stays " +
          "half a body outline. 50% is a hairline for a dense diagram; 400% is " +
          "as heavy as a wire or a symbol can take before it stops reading."
      )
      .addSlider((sl) => {
        sharedSlider = sl;
        return sl
          .setLimits(STROKE_SCALE_MIN * 100, STROKE_SCALE_MAX * 100, 10)
          .setValue(Math.round(this.plugin.settings.symbolStrokeScale * 100))
          .setDynamicTooltip()
          .onChange(async (v) => {
            // One value, two settings: there is nothing to keep in step.
            this.plugin.settings.symbolStrokeScale = v / 100;
            this.plugin.settings.wireScale = v / 100;
            await strokeCommit();
          });
      });

    wireRow = new Setting(containerEl)
      .setName("Wire thickness")
      .setDesc(
        "Scales every wire, as a percentage of the thickness its own connector " +
          "declares: 100% is the library's own weight, which draws a single line " +
          "at 1.5 px and a double one at 3 px at 100% zoom, and the ratio between " +
          "them is kept at any setting. The default, 90%, is a touch lighter than " +
          "the library draws them. The area a wire can be clicked in follows, or a " +
          "thick wire would look right and be hard to grab. Symbols and the grid are " +
          "unaffected — link the two if you would rather set them together. 400% " +
          "is the ceiling because past it a wire is heavier than the pin it " +
          "lands on."
      )
      .addSlider((sl) => {
        wireSlider = sl;
        return sl
          .setLimits(STROKE_SCALE_MIN * 100, STROKE_SCALE_MAX * 100, 10)
          .setValue(Math.round(this.plugin.settings.wireScale * 100))
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.wireScale = v / 100;
            await strokeCommit();
          });
      });

    symbolRow = new Setting(containerEl)
      .setName("Component line thickness")
      .setDesc(
        "Scales the lines the component symbols are drawn with, as a percentage " +
          "of the thickness each graphic declares: 100% is the library's own " +
          "weight, which draws a single line at 1.5 px and the library's double " +
          "and quadruple lines at 3 px and 6 px. The default, 190%, draws them " +
          "heavier than the library does, which is what reads best on screen. " +
          "Lines are drawn in proportion to a symbol's own size, so a " +
          "small symbol keeps the same look as a large one. The pins on a " +
          "component follow it; text, fills and the selection outline do not. " +
          "400% is the ceiling: past it a symbol stops being a symbol."
      )
      .addSlider((sl) => {
        symbolSlider = sl;
        return sl
          .setLimits(STROKE_SCALE_MIN * 100, STROKE_SCALE_MAX * 100, 10)
          .setValue(Math.round(this.plugin.settings.symbolStrokeScale * 100))
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.symbolStrokeScale = v / 100;
            await strokeCommit();
          });
      });

    applyStrokeLink(this.plugin.settings.syncStrokeScale);

    new Setting(containerEl)
      .setName("Show parameters when hovering a component")
      .setDesc(
        "While the pointer rests on a component, shows what its parameters are " +
          "set to, with the ones this instance overrides first. Reading a " +
          "diagram's settings otherwise means selecting each component in turn. " +
          "Applies to the Studio and to diagrams embedded in notes; a large " +
          "list fills columns rather than being cut off."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.hoverParameters).onChange(async (v) => {
          this.plugin.settings.hoverParameters = v;
          await this.plugin.saveSettings();
          this.plugin.getView()?.refreshDiagram();
          this.plugin.refreshEmbeds();
        })
      );

    new Setting(containerEl)
      .setName("Parameter popup size")
      .setDesc(
        "Scales the text of the panel that appears while hovering a component. " +
          "Its own setting rather than part of the label size: the name under a " +
          "symbol is read at a glance and the popup is read deliberately, so " +
          "wanting one larger says nothing about the other. The panel grows with " +
          "its text, so nothing is cut off."
      )
      .addSlider((sl) =>
        sl
          .setLimits(50, 250, 10)
          .setValue(Math.round(this.plugin.settings.diagramReadoutScale * 100))
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.diagramReadoutScale = v / 100;
            await this.plugin.saveSettings();
            this.plugin.getView()?.refreshDiagram();
            this.plugin.refreshEmbeds();
          })
      );

    /* ---- reading the results plot ---- */
    new Setting(containerEl).setName("Results plot").setHeading();
    containerEl.createEl("p", {
      cls: "modelica-studio-muted",
      text:
        "What the pointer tells you while it is over a result plot — in the " +
        "Studio, and in a simulation block embedded in a note.",
    });

    new Setting(containerEl)
      .setName("Readout size")
      .setDesc(
        "Scales the text of the box that follows the cursor across a result " +
          "plot, which lists the time and each trace's value there. Separate " +
          "from the diagram's parameter popup: a plot is read on its own. The " +
          "box grows with its text. The axis ticks, the legend and the trace " +
          "names are not affected."
      )
      .addSlider((sl) =>
        sl
          .setLimits(50, 250, 10)
          .setValue(Math.round(this.plugin.settings.plotReadoutScale * 100))
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.plotReadoutScale = v / 100;
            await this.plugin.saveSettings();
            this.plugin.getView()?.refreshPlot();
            this.plugin.refreshEmbeds();
          })
      );

    new Setting(containerEl)
      .setName("Show differences in the plot readout")
      .setDesc(
        "With a family on screen — a sweep, or a run kept with “Keep as before” — " +
          "resting the cursor on the plot says how far each curve is from the run on " +
          "screen at that moment, signed. On by default; the Δ button in the results " +
          "bar toggles the same thing without leaving the plot."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.plotDeltas).onChange(async (v) => {
          this.plugin.settings.plotDeltas = v;
          await this.plugin.saveSettings();
          this.plugin.getView()?.refreshPlot();
        })
      );

    // The two settings below are one feature split in two, so the second is
    // dimmed while the first is off rather than left looking as if it does
    // something. Re-rendering the whole tab would scroll back to the top.
    const SNAP_ON_DESC =
      "How close, in pixels on screen, the pointer has to come to a crossing " +
      "before it snaps. Pixels rather than seconds so it feels the same at every " +
      "zoom level: raise it if the snap is hard to catch, lower it if the cursor " +
      "ever jumps to a crossing you were not aiming at.";
    const SNAP_OFF_DESC = "Not used while the snap above is off.";
    // Held rather than built in place because the toggle above it owns whether
    // this row is enabled, and the row has to exist before it can be greyed.
    let snapDistance: Setting | null = null;

    new Setting(containerEl)
      .setName("Snap the cursor to where curves cross")
      .setDesc(
        "When the pointer is about to cross a point where two traces meet, the " +
          "readout takes that exact instant instead of the nearest round number, " +
          "and says “crossing”. On by default, and it is what makes a crossing " +
          "readable: the instant is interpolated between samples, so it is a time " +
          "no sample actually has."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.plotSnapCrossings).onChange(async (v) => {
          this.plugin.settings.plotSnapCrossings = v;
          // Applied before the write, so the row greys as the switch moves
          // rather than one disk round-trip later. `setDisabled` on the row greys
          // the label and the slider together, which is the honest state: with
          // the snap off nothing reads this value.
          snapDistance?.setDisabled(!v);
          snapDistance?.setDesc(v ? SNAP_ON_DESC : SNAP_OFF_DESC);
          this.plugin.getView()?.refreshPlot();
          this.plugin.refreshEmbeds();
          await this.plugin.saveSettings();
        })
      );

    snapDistance = new Setting(containerEl)
      .setName("Snap distance")
      .setDesc(this.plugin.settings.plotSnapCrossings ? SNAP_ON_DESC : SNAP_OFF_DESC)
      .addSlider((sl) =>
        sl
          .setLimits(MIN_SNAP_TOLERANCE_PX, MAX_SNAP_TOLERANCE_PX, 1)
          .setValue(snapTolerancePx(this.plugin.settings.plotSnapTolerance))
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.plotSnapTolerance = v;
            await this.plugin.saveSettings();
            this.plugin.getView()?.refreshPlot();
            this.plugin.refreshEmbeds();
          })
      );
    snapDistance.setDisabled(!this.plugin.settings.plotSnapCrossings);

    /* ---- AI assistance ---- */
    new Setting(containerEl).setName("AI assistance").setHeading();
    containerEl.createEl("p", {
      cls: "modelica-studio-muted",
      text:
        "Optional. Adds a prompt box to the source editor that can write or " +
        "repair a model for you. It works with any OpenAI-compatible endpoint. " +
        "The key is held in Obsidian's keychain, not in this plugin's data file, " +
        "so it stays out of vault backups and sync and can be shared with any " +
        "other plugin that wants it. It is only ever sent to the endpoint below. " +
        "Code the model writes is not verified — simulate it before trusting it.",
    });

    // The key itself lives in Obsidian's keychain. Only the NAME of the secret is
    // stored here, which is what makes it survive a vault backup without the
    // secret travelling with it.
    if (this.plugin.hasSecretStorage) {
      const keySetting = new Setting(containerEl)
        .setName("API key")
        .setDesc(
          "Select a secret from Obsidian's keychain, or create one. " +
            "Leave empty to switch the feature off."
        );
      keySetting.addComponent((el) =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings.ai.secretName ?? "")
          .onChange(async (value) => {
            this.plugin.settings.ai.secretName = value ?? "";
            await this.plugin.saveSettings();
          })
      );

      const legacy = legacyKeyOf(this.plugin.settings.ai);
      if (legacy) {
        // Say plainly that the old key is still in the data file, rather than
        // silently leaving it there.
        const warn = keySetting.descEl.createDiv({ cls: "modelica-studio-warn" });
        warn.setText(
          "An API key from an earlier version is still stored unencrypted in this " +
            "plugin's data.json. Choose a secret above to replace it."
        );
        new Setting(containerEl)
          .setName("Move the old key into the keychain")
          .setDesc(
            `Stores it as "${LEGACY_SECRET_NAME}" and removes the plaintext copy from data.json.`
          )
          .addButton((b) =>
            b.setButtonText("Move").onClick(async () => {
              await this.plugin.migrateLegacyAiKey();
              this.display();
            })
          );
      }
    } else {
      // No keychain in this Obsidian build. Say so instead of quietly writing a
      // key in plaintext.
      containerEl.createDiv({
        cls: "modelica-studio-warn",
        text:
          "This Obsidian version has no keychain, so AI assistance is unavailable. " +
          "Obsidian 1.11.4 or later is required. Updating Obsidian is the fix — " +
          "this plugin will not store an API key in plain text.",
      });
    }

    new Setting(containerEl)
      .setName("Provider preset")
      .setDesc(
        "Fills in the base URL and model for a known provider. Defaults were " +
          "confirmed against each provider's documentation on 2026-09-16; use " +
          "Refresh below to get the current list from the provider itself."
      )
      .addDropdown((d) => {
        d.addOption("", "Choose...");
        for (const [i, p] of AI_PROVIDERS.entries()) d.addOption(String(i), p.label);
        d.setValue("");
        d.onChange((v) => {
          // The async work is voided rather than awaited: `onChange` is a void callback,
          // and the dropdown must not report a rejected promise into it.
          void (async (): Promise<void> => {
          if (v === "") return;
          const p = AI_PROVIDERS[Number(v)];
          if (!p) return;
          this.plugin.settings.ai.baseUrl = p.baseUrl;
          this.plugin.settings.ai.model = p.model;
          // A list fetched from one provider says nothing about another.
          this.plugin.settings.aiModels = [];
          await this.plugin.saveSettings();
          this.display();
          })();
        });
      });

    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("Without the trailing /chat/completions.")
      .addText((t) =>
        t
          .setPlaceholder(AI_DEFAULTS.baseUrl)
          .setValue(this.plugin.settings.ai.baseUrl)
          .onChange(async (v) => {
            this.plugin.settings.ai.baseUrl = v.trim();
            await this.plugin.saveSettings();
          })
      );

    // Models on offer: whatever the provider last reported, else the built-in
    // suggestions for the chosen provider, else nothing. A curated list baked
    // into the plugin is what went stale when `deepseek-chat` was retired, so the
    // fetched list always wins.
    const fetched = this.plugin.settings.aiModels;
    const preset = AI_PROVIDERS.find((p) => p.baseUrl === this.plugin.settings.ai.baseUrl);
    const suggested = fetched.length
      ? fetched
      : (preset?.models ?? (preset ? [preset.model] : []));
    const source = fetched.length ? "fetched from the provider" : "built in";

    const modelSetting = new Setting(containerEl)
      .setName("Model")
      .setDesc(
        suggested.length
          ? `Choose one of ${suggested.length} models (${source}), or type any name the provider accepts.`
          : "The model name the provider expects."
      )
      .addText((t) => {
        t.setPlaceholder(AI_DEFAULTS.model)
          .setValue(this.plugin.settings.ai.model)
          .onChange(async (v) => {
            this.plugin.settings.ai.model = v.trim();
            await this.plugin.saveSettings();
          });
        t.inputEl.addClass("modelica-studio-path-input");
      });

    if (suggested.length) {
      modelSetting.addDropdown((d) => {
        d.addOption("", "Suggestions...");
        for (const m of suggested.slice(0, 200)) d.addOption(m, m);
        d.setValue(suggested.includes(this.plugin.settings.ai.model) ? this.plugin.settings.ai.model : "");
        d.onChange(async (v) => {
          if (!v) return;
          this.plugin.settings.ai.model = v;
          await this.plugin.saveSettings();
          this.display();
        });
      });
    }

    const modelStatus = containerEl.createDiv({
      cls: "modelica-studio-setting-status modelica-studio-hidden",
    });

    new Setting(containerEl)
      .setName("Refresh model list")
      .setDesc(
        "Asks the provider which models it currently offers and replaces the " +
          "suggestions above. Model names are retired without notice, so this is " +
          "the reliable way to see what is available."
      )
      .addButton((b) =>
        b.setButtonText("Refresh").onClick(async () => {
          b.setButtonText("Asking...");
          b.setDisabled(true);
          const result = await this.plugin.refreshAiModels();
          b.setButtonText("Refresh");
          b.setDisabled(false);
          modelStatus.removeClass("modelica-studio-hidden");
          modelStatus.setText(result.text);
          modelStatus.toggleClass("is-ok", result.ok);
          modelStatus.toggleClass("is-bad", !result.ok);
          if (result.ok) this.display();
        })
      );

    new Setting(containerEl)
      .setName("Temperature")
      .setDesc("Lower is more literal. 0.2 suits code.")
      .addSlider((sl) =>
        sl
          .setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.ai.temperature)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.ai.temperature = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Reasoning effort")
      .setDesc(
        "How much the model reasons before answering. Providers that default to thinking " +
          "spend that time on every request, and it silently disables Temperature. " +
          "Off is fastest and suits code; raise it if attempts keep failing."
      )
      .addDropdown((d) => {
        for (const level of AI_THINKING_LEVELS) d.addOption(level.id, level.label);
        d.setValue(this.plugin.settings.ai.thinking ?? "off");
        // The hint for the chosen level, since a dropdown cannot show one per item.
        const hint = containerEl.createDiv({ cls: "modelica-studio-muted" });
        const show = (id: string) => {
          hint.setText(AI_THINKING_LEVELS.find((l) => l.id === id)?.hint ?? "");
        };
        show(this.plugin.settings.ai.thinking ?? "off");
        d.onChange(async (v) => {
          this.plugin.settings.ai.thinking = v as AiThinking;
          show(v);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Model style")
      .setDesc(
        "Diagram first builds from library components, so the result is a schematic you " +
          "can see and rewire; if it will not compile the run falls back to equations. " +
          "Equations skips straight to the physics, which compiles more reliably but draws nothing."
      )
      .addDropdown((d) => {
        for (const style of MODEL_STYLES) d.addOption(style.id, style.label);
        d.setValue(this.plugin.settings.ai.style ?? "visual");
        const hint = containerEl.createDiv({ cls: "modelica-studio-muted" });
        const show = (id: string) => hint.setText(MODEL_STYLES.find((s) => s.id === id)?.hint ?? "");
        show(this.plugin.settings.ai.style ?? "visual");
        d.onChange(async (v) => {
          this.plugin.settings.ai.style = v as ModelStyle;
          show(v);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Reply timeout")
      .setDesc(
        "Seconds to wait for a reply before giving up. Without a deadline a request " +
          "that never answers waits forever. Raise it for a slow local model."
      )
      .addText((t) =>
        t
          .setPlaceholder(String(DEFAULT_TIMEOUT_SECONDS))
          .setValue(String(this.plugin.settings.ai.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS))
          .onChange(async (raw) => {
            const n = Number(raw);
            this.plugin.settings.ai.timeoutSeconds =
              Number.isFinite(n) && n >= 5 ? Math.round(n) : DEFAULT_TIMEOUT_SECONDS;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Extra instructions")
      .setDesc("Appended to every request. Use it for house style or units.")
      .addTextArea((t) => {
        t.setPlaceholder("Prefer SI units, and add a comment above each equation.")
          .setValue(this.plugin.settings.ai.systemPrompt)
          .onChange(async (v) => {
            this.plugin.settings.ai.systemPrompt = v;
            await this.plugin.saveSettings();
          });
        t.inputEl.rows = 3;
      });

    const resultBox = containerEl.createDiv({
      cls: "modelica-studio-setting-status modelica-studio-hidden",
    });

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Sends a one-line request to confirm the key and model work.")
      .addButton((b) =>
        b.setButtonText("Test").onClick(async () => {
          b.setButtonText("Testing...");
          b.setDisabled(true);
          const result = await this.plugin.testAiConnection();
          b.setButtonText("Test");
          b.setDisabled(false);
          resultBox.removeClass("modelica-studio-hidden");
          resultBox.setText(result.text);
          resultBox.toggleClass("is-ok", result.ok);
          resultBox.toggleClass("is-bad", !result.ok);
        })
      );

    containerEl.createDiv({
      cls: "modelica-studio-muted",
      text:
        "Reference links, what this installation is, and the keyboard shortcuts are " +
        "in the studio: open it and choose Help in the toolbar.",
    });

    new Setting(containerEl).setName("Models").setHeading();
    containerEl.createEl("p", {
      cls: "modelica-studio-muted",
      text:
        "Models are saved as plain Modelica source, which is what OpenModelica " +
        "compiles and what OMEdit opens. Nothing about the diagram is lost by " +
        "saving: the graphical annotations are part of the same text.",
    });

    new Setting(containerEl)
      .setName("Save folder")
      .setDesc(
        "Vault folder for saved models, created on first save. Start typing to " +
          "choose from the folders that exist, or type a new name to make one."
      )
      .addSearch((t) => {
        t.setPlaceholder("Modelica")
          .setValue(this.plugin.settings.modelFolder)
          .onChange(async (v) => {
            this.plugin.settings.modelFolder = v.trim();
            await this.plugin.saveSettings();
          });
        // `addSearch` supplies a search-shaped input, which is also what
        // AbstractInputSuggest expects.
        // `void`, not an `async` callback: the suggest component wants a void handler,
        // and the save is asynchronous.
        new FolderSuggest(this.app, t.inputEl, (path) => {
          this.plugin.settings.modelFolder = path;
          void this.plugin.saveSettings();
        });
      });

    containerEl.createDiv({
      cls: "modelica-studio-muted",
      text:
        "Which models are saved, and where, is shown in the studio: open it and " +
        "choose Model list in the toolbar. It lives there rather than here because " +
        "it is about the model being worked on, not a preference.",
    });

    new Setting(containerEl).setName("Library").setHeading();
    containerEl.createEl("p", {
      cls: "modelica-studio-muted",
      text:
        "Leave out libraries you do not use. Excluded classes disappear from the " +
        "palette, from search and from completion, which keeps a two-library " +
        "project from scrolling past all of them.",
    });

    // Checkboxes for the libraries that were actually found. The ordinary case is
    // "I do not use Fluid", and a text area made that the awkward one: it required
    // typing a qualified name by hand and gave no sign of what was available.
    new Setting(containerEl)
      .setName("Libraries in use")
      .setDesc(
        "Untick a library to leave it out of the palette, search and completion. " +
          "Only libraries found on this machine are listed."
      );

    const rowsHost = containerEl.createDiv({ cls: "modelica-studio-library-list" });
    const packages = this.plugin.library.packages();
    // What this build actually drew, so `onLibraryReady` can tell a change from a
    // repeat. An empty list is recorded as empty rather than as `null`, or every
    // library event would look like news.
    this.packagesReady = packages;

    const apply = async () => {
      await this.plugin.saveSettings();
      // Re-applying is cheap: the index clears its caches only when the list
      // actually changed.
      this.plugin.applyExclusions();
      // The view's refresh is asynchronous and nothing here waits for it; the exclusions
      // are already applied to the index, which is what the palette reads.
      const view = this.plugin.getView();
      if (view) void view.refreshLibrary();
    };

    const renderRows = () => {
      rowsHost.empty();
      const rows = libraryRows(packages, this.plugin.settings.excludedLibraries);
      if (!rows.length) {
        rowsHost.createDiv({
          cls: "modelica-studio-muted",
          text: "No libraries indexed yet. The list appears once the index is built.",
        });
        return;
      }
      for (const row of rows) {
        const line = rowsHost.createDiv({
          cls: `modelica-studio-library-row${row.excluded ? " is-excluded" : ""}`,
        });
        const box = line.createEl("input", { type: "checkbox" });
        box.checked = !row.excluded;
        box.id = `mst-lib-${row.name.replace(/\W/g, "-")}`;
        const label = line.createEl("label", { text: row.label });
        label.htmlFor = box.id;
        label.setAttribute("title", row.name);
        if (row.excludedBy) {
          // The case a text area could not show at all: this library is out
          // because something above it is, so ticking it here alone does nothing.
          line.createSpan({ cls: "modelica-studio-library-note", text: `excluded by ${row.excludedBy}` });
        }
        box.addEventListener("change", () => {
          void (async () => {
          const next = libraryRows(packages, this.plugin.settings.excludedLibraries).map((r) => ({
            name: r.name,
            excluded: r.name === row.name ? !box.checked : r.excluded,
          }));
          this.plugin.settings.excludedLibraries = exclusionsFrom(
            next,
            this.plugin.settings.excludedLibraries
          );
          await apply();
          // Re-rendered because one tick can change another row's reason: with
          // `Modelica` excluded, ticking `Modelica.Fluid` changes its note.
          renderRows();
          area.value = this.plugin.settings.excludedLibraries;
          })();
        });
      }
    };

    renderRows();

    // Kept, and folded away, for the entries no checkbox can express: the text
    // area also accepts a sub-library such as Modelica.Fluid.Vessels.
    const advanced = containerEl.createEl("details", { cls: "modelica-studio-library-advanced" });
    advanced.createEl("summary", { text: "Exclude part of a library instead" });
    advanced.createEl("p", {
      cls: "modelica-studio-muted",
      text:
        "One qualified name per line, for entries a checkbox cannot express. Lines " +
          "starting with # are ignored. Matched on segment boundaries, so " +
          "Modelica.Electrical does not also exclude Modelica.ElectricalExtra. " +
          "Ticking a library above writes its name here.",
    });
    const area = advanced.createEl("textarea", { cls: "modelica-studio-library-text" });
    area.rows = 4;
    area.value = this.plugin.settings.excludedLibraries;
    area.addEventListener("change", () => {
      this.plugin.settings.excludedLibraries = area.value;
      void apply().then(renderRows);
    });

    new Setting(containerEl).setName("Performance").setHeading();
    containerEl.createEl("p", {
      cls: "modelica-studio-muted",
      text:
        "Measured on the development machine with the current build. The pattern " +
          "matters more than the exact figures: translation is the expensive step, " +
          "and everything after it is effectively free.",
    });

    /** A row of the performance table: what, how long, and what to make of it. */
    const metric = (
      parent: HTMLElement,
      label: string,
      value: string,
      note: string,
      tone: "fast" | "slow" | "once"
    ) => {
      const row = parent.createDiv({ cls: `modelica-studio-metric is-${tone}` });
      row.createSpan({ cls: "modelica-studio-metric-label", text: label });
      row.createSpan({ cls: "modelica-studio-metric-value", text: value });
      row.createSpan({ cls: "modelica-studio-metric-note", text: note });
    };

    // Grouped by WHEN the cost is paid, because that is the distinction a user
    // acts on: the top group is worth configuring for, the bottom group is why
    // the studio feels immediate while you drag a value.
    //
    // These are a SNAPSHOT, not a measurement taken here -- the table is built
    // from literals, so they drift as the code changes. They are re-measured by
    // hand when something that moves them changes; the two library figures were
    // corrected when the indexer stopped reading three MSL releases at once.
    containerEl.createDiv({ cls: "modelica-studio-metric-group", text: "Once, or when the structure changes" });
    const slow = containerEl.createDiv({ cls: "modelica-studio-metrics" });
    metric(slow, "Parse the Modelica library", "1.2 s", "First launch after an install or upgrade", "slow");
    metric(slow, "Load the library index", "~0.3 s", "Every later launch, from a 25 MB cache", "once");
    metric(slow, "Compile a 4-component circuit", "1.4 s", "With 8 parallel codegen jobs", "slow");
    metric(slow, "The same compile, 1 job", "4.1 s", "Why Parallel compile jobs matters", "slow");

    containerEl.createDiv({ cls: "modelica-studio-metric-group", text: "Every edit \u2014 imperceptible by design" });
    const fast = containerEl.createDiv({ cls: "modelica-studio-metrics" });
    metric(fast, "Change a parameter and re-run", "~30 ms", "A run-time override, not a rebuild", "fast");
    metric(fast, "Simulate an already-built model", "18\u201336 ms", "The compiled binary is reused", "fast");
    metric(fast, "Re-open a model that has been built", "0 ms", "Recognised by fingerprint", "fast");

    containerEl.createDiv({
      cls: "modelica-studio-muted modelica-studio-metric-footer",
      text:
        "Only a structural change \u2014 adding a component, rewiring, editing an " +
          "equation \u2014 pays for a rebuild. That is why the studio answers immediately " +
          "while you drag a value or switch between models.",
    });

    /* ---- reset ---- */
    //
    // Last, where a setting that undoes other settings belongs: after everything
    // it affects has been seen. It keeps what records WORK — the saved-model
    // registry, each model's stop time and chart, the AI model list, the name of
    // the API-key secret — and says so, because "reset" beside a plugin whose
    // settings include a model registry is a button someone presses carefully.
    new Setting(containerEl).setName("Reset").setHeading();
    new Setting(containerEl)
      .setName("Reset settings to defaults")
      .setDesc(
        "Puts every appearance, simulation and behaviour setting back to its " +
          "default. Kept, because they record work rather than a preference: the " +
          "saved-model list, each model's stop time and chart setup, the models " +
          "added to the AI picker, and the name of the secret holding the API key. " +
          "Files in the vault are never touched."
      )
      .addButton((b) =>
        b
          .setButtonText("Reset")
          // `setWarning`, not `setDestructive`: the replacement is Obsidian 1.13+ and
          // `minAppVersion` is 1.11.4, so the newer call would break the promise the
          // manifest makes. The deprecation is a recommendation; the version gate is not.
          .setWarning()
          .onClick(async () => {
            const confirmed = await confirm(
              this.app,
              "Reset settings to defaults?",
              "Every setting in this tab goes back to its default value, including " +
                "the solver, the panel widths and the line weights. Your saved " +
                "models, each model's stop time and chart, the AI model list and the " +
                "name of the API-key secret are kept, and no file is touched.",
              "Reset"
            );
            if (!confirmed) return;

            const { settings: next, reset, kept } = resetPreferences(this.plugin.settings);
            // Onto the live object, not in place of it: the studio, the embeds and
            // the toolchain all hold this reference.
            Object.assign(this.plugin.settings, next);
            await this.plugin.saveSettings();
            // The library exclusions are part of what was reset, and they change
            // what the palette and completion offer.
            this.plugin.applyExclusions();
            this.display();
            this.plugin.getView()?.refreshDiagram();
            this.plugin.refreshEmbeds();
            new Notice(
              `Modelica Studio: ${reset.length} setting${reset.length === 1 ? "" : "s"} ` +
                `reset to defaults.` +
                (kept.length > 0 ? ` Kept your ${kept.join(", ")}.` : "")
            );
          })
      );
  }
}

export {
  DEFAULT_SETTINGS,
  effectiveStrokeScales,
  mergeSettings,
  migrateSettings,
  PRESERVED_ON_RESET,
  resetPreferences,
  STROKE_SCALE_MAX,
  STROKE_SCALE_MIN,
} from "./settings-merge";
export type { ChartState, ModelicaStudioSettings } from "./settings-merge";
