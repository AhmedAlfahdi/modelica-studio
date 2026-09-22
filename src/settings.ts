/**
 * Plugin settings.
 *
 * Defaults are chosen so the plugin works with no configuration on a machine
 * where OpenModelica is installed normally; every field exists to rescue an
 * unusual setup rather than to require tuning.
 */

import { App, Notice, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type ModelicaStudioPlugin from "./main";
import { FolderSuggest } from "./view/folder-suggest";
// The snap distance is defined by the plot, which has to clamp whatever it is
// given: the slider offers exactly the range the plot will honour, so the number
// shown is the number in force rather than a value silently pinned at the end.
import { MAX_SNAP_TOLERANCE_PX, MIN_SNAP_TOLERANCE_PX, snapTolerancePx } from "./view/plot";
import { exclusionsFrom, libraryRows } from "./modelica/library-exclusions";
import { SOLVERS, solverDescription, AI_THINKING_LEVELS, MODEL_STYLES, type AiThinking, type ModelStyle, AI_DEFAULTS,
  DEFAULT_TIMEOUT_SECONDS, AI_PROVIDERS, AiConfig, LEGACY_SECRET_NAME, legacyKeyOf } from "./ai/prompts";



export class ModelicaStudioSettingTab extends PluginSettingTab {
  plugin: ModelicaStudioPlugin;

  constructor(plugin: ModelicaStudioPlugin) {
    super(plugin.app as App, plugin);
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

  /** Re-render if the tab is open and the library list has just become known. */
  onLibraryReady(): void {
    if (!this.containerEl.isShown?.()) return;
    if (this.packagesReady === null) this.display();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Modelica Studio" });

    /* ---- toolchain status ---- */
    const status = this.plugin.toolchainSummary();
    const statusBox = containerEl.createDiv({ cls: "modelica-studio-setting-status" });
    statusBox.createEl("strong", { text: status.ok ? "OpenModelica detected" : "OpenModelica not detected" });
    statusBox.createEl("div", { cls: "modelica-studio-muted", text: status.text });
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
          })
      );

    containerEl.createEl("h3", { text: "Simulation defaults" });

    new Setting(containerEl)
      .setName("Stop time")
      .setDesc("Default end time in seconds.")
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
          "Your API key is never written. Read it with the \"Show the AI prompt " +
          'log\" command.'
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
    containerEl.createEl("h3", { text: "Diagram" });

    new Setting(containerEl)
      .setName("Label size")
      .setDesc(
        "Scales the name under each component in the diagram, as a percentage " +
          "of the default. The label is sized from the component's on-screen " +
          "size, so this moves that whole curve rather than pinning one size: " +
          "it still shrinks when you zoom out, and two components side by side " +
          "do not start overlapping. Applies to the Studio and to diagrams " +
          "embedded in notes."
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

    new Setting(containerEl)
      .setName("Wire thickness")
      .setDesc(
        "Scales the strokes of the wires, as a percentage of the default: 100% is " +
          "the standard weight, 1000% is ten times it. The default is a fixed " +
          "fraction of a symbol's size, so wires and symbols keep their " +
          "relationship at every zoom; this moves that whole curve, and the area a " +
          "wire can be clicked in follows, or a thick wire would look right and be " +
          "hard to grab. Symbols and grid are unaffected."
      )
      .addSlider((sl) =>
        sl
          .setLimits(50, 1000, 10)
          .setValue(Math.round(this.plugin.settings.wireScale * 100))
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.wireScale = v / 100;
            await this.plugin.saveSettings();
            this.plugin.getView()?.refreshDiagram();
            this.plugin.refreshEmbeds();
          })
      );

    new Setting(containerEl)
      .setName("Component line thickness")
      .setDesc(
        "Scales the lines the component symbols are drawn with, as a percentage " +
          "of the default: 100% is the standard weight, 400% is four times it. The " +
          "library draws its own emphasis this way — a body outline at 0.5 against " +
          "a shaft or a flange at 1.0 — and the whole curve scales together, so " +
          "those differences survive instead of all landing on the same ceiling. " +
          "The pins on a component follow it. Text, fills and the selection outline " +
          "are unaffected."
      )
      .addSlider((sl) =>
        sl
          .setLimits(50, 400, 10)
          .setValue(Math.round(this.plugin.settings.symbolStrokeScale * 100))
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.symbolStrokeScale = v / 100;
            await this.plugin.saveSettings();
            this.plugin.getView()?.refreshDiagram();
            this.plugin.refreshEmbeds();
          })
      );

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
    containerEl.createEl("h3", { text: "Results plot" });
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
    containerEl.createEl("h3", { text: "AI assistance" });
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
        AI_PROVIDERS.forEach((p, i) => d.addOption(String(i), p.label));
        d.setValue("");
        d.onChange(async (v) => {
          if (v === "") return;
          const p = AI_PROVIDERS[Number(v)];
          if (!p) return;
          this.plugin.settings.ai.baseUrl = p.baseUrl;
          this.plugin.settings.ai.model = p.model;
          // A list fetched from one provider says nothing about another.
          this.plugin.settings.aiModels = [];
          await this.plugin.saveSettings();
          this.display();
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
        t.inputEl.style.minWidth = "220px";
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

    const modelStatus = containerEl.createDiv({ cls: "modelica-studio-setting-status" });
    modelStatus.style.display = "none";

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
          modelStatus.style.display = "";
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
        t.setPlaceholder("e.g. Prefer SI units and add a comment above each equation.")
          .setValue(this.plugin.settings.ai.systemPrompt)
          .onChange(async (v) => {
            this.plugin.settings.ai.systemPrompt = v;
            await this.plugin.saveSettings();
          });
        t.inputEl.rows = 3;
      });

    const resultBox = containerEl.createDiv({ cls: "modelica-studio-setting-status" });
    resultBox.style.display = "none";

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
          resultBox.style.display = "";
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

    containerEl.createEl("h3", { text: "Models" });
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
        new FolderSuggest(this.app, t.inputEl, async (path) => {
          this.plugin.settings.modelFolder = path;
          await this.plugin.saveSettings();
        });
      });

    containerEl.createDiv({
      cls: "modelica-studio-muted",
      text:
        "Which models are saved, and where, is shown in the studio: open it and " +
        "choose Model list in the toolbar. It lives there rather than here because " +
        "it is about the model being worked on, not a preference.",
    });

    containerEl.createEl("h3", { text: "Library" });
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
    this.packagesReady = packages.length ? packages : null;

    const apply = async () => {
      await this.plugin.saveSettings();
      // Re-applying is cheap: the index clears its caches only when the list
      // actually changed.
      this.plugin.applyExclusions();
      this.plugin.getView()?.refreshLibrary();
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
        box.addEventListener("change", async () => {
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
    area.addEventListener("change", async () => {
      this.plugin.settings.excludedLibraries = area.value;
      await apply();
      renderRows();
    });

    containerEl.createEl("h3", { text: "Performance" });
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
  }
}

export { DEFAULT_SETTINGS, mergeSettings, migrateSettings } from "./settings-merge";
export type { ChartState, ModelicaStudioSettings } from "./settings-merge";
