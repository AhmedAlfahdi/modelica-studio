/**
 * Plugin settings.
 *
 * Defaults are chosen so the plugin works with no configuration on a machine
 * where OpenModelica is installed normally; every field exists to rescue an
 * unusual setup rather than to require tuning.
 */

import { App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type ModelicaStudioPlugin from "./main";
import { AI_DEFAULTS, AI_PROVIDERS, AiConfig, LEGACY_SECRET_NAME, legacyKeyOf } from "./ai/prompts";

/**
 * How the result plot is configured: which traces, and over what range.
 *
 * Held by the plugin rather than by each view so the studio and every inline
 * diagram in a note show the same thing. Adjusting the scale or switching a
 * trace in one place is otherwise invisible everywhere else.
 */
export interface ChartState {
  /** Traces drawn, by variable name. */
  traces: string[];
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  /**
   * Parameter overrides in `instance.param` form.
   *
   * Shared with the traces because they are the same kind of thing — how the
   * result is produced and displayed — and because a note's block otherwise
   * kept plotting the values the studio had since changed.
   */
  parameters?: Record<string, string>;
}

export interface ModelicaStudioSettings {
  /** Explicit path to `omc`; empty means auto-detect. */
  omcPath: string;
  /** Extra library search paths, one per line. */
  libraryPaths: string;
  /** Parallel codegen jobs. OMC defaults to 1, which is ~2.4x slower. */
  jobs: number;
  /** Extra raw omc command-line options. */
  extraOmcOptions: string;

  /** Simulation defaults. */
  startTime: number;
  stopTime: number;
  numberOfIntervals: number;
  tolerance: number;
  solver: string;

  /** Palette packages, in display order. */
  paletteRoots: string[];

  /**
   * Vault folder that models are saved into, relative to the vault root. Empty
   * means the root itself. Created on first save if it does not exist.
   */
  modelFolder: string;

  /**
   * Where each model was last saved, keyed by model name.
   *
   * Remembered so saving an existing model overwrites the file it came from
   * rather than writing a second copy beside it after the model is renamed.
   */
  modelFiles: Record<string, string>;

  /**
   * Libraries to leave out of search, the palette and completion, one qualified
   * name per line.
   *
   * A whole library is a lot to scroll past when a project uses two of them.
   * Excluding is done by qualified-name prefix and matched on segment
   * boundaries, so `Modelica.Electrical` does not also exclude
   * `Modelica.ElectricalExtra`.
   */
  excludedLibraries: string;

  /** Append startup/simulation diagnostics to `.modelica-studio.log` in the vault. */
  debugLog: boolean;

  /**
   * Draw the editor's coordinate diagnostics: the clickable region, the drawn
   * box and centre of every component, the click marker, and the live viewport
   * readout.
   *
   * Exists because the hardest faults in this editor have been coordinate
   * mismatches — where the picture and the region that responds to a click
   * disagree. Reported symptoms ("selection is offset", "I have to click to the
   * left of the shape") are ambiguous, but this overlay makes the discrepancy
   * visible on screen in one glance, and the Geometry panel reports the same
   * geometry as text for a bug report.
   */
  debugOverlay: boolean;

  /**
   * Which mode the studio opens in.
   *
   * Remembered because it is a working preference, not a per-session choice:
   * someone editing an equation model wants code mode every time, and being put
   * back into an empty diagram on each open reads as the work having been lost.
   */
  editorMode: "diagram" | "code";

  /** Right-hand inspector width in pixels; 0 means the default. */
  inspectorWidth: number;
  /**
   * Results-pane height in DIAGRAM mode; 0 means the default.
   *
   * Per mode rather than shared: the pane sits above the editing area, so one
   * height cannot suit both. Sized for a plot it left the code editor with about
   * half the window and the appearance of empty space above the text.
   */
  plotHeight: number;

  /** Results-pane height in CODE mode; 0 means the default. */
  codePlotHeight: number;


  /** Shared plot configuration, or null before anything has been chosen. */
  /**
   * Simulation span per model name.
   *
   * Keyed by model, not global. A single shared value meant setting 4 s for one
   * model silently changed every inline block in every note whose model had no
   * span of its own — the tank that drains over 20 s would be integrated over 4
   * and its curve would read as a straight line.
   */
  modelStopTimes: Record<string, number>;

  /**
   * Plot configuration per model name.
   *
   * Keyed by model because the studio shows ONE model while a note may hold
   * blocks for several. A single shared object meant configuring the model in
   * the studio overwrote the traces of every other block on the page, leaving
   * each of them filtering a result whose variable names it did not contain.
   */
  charts: Record<string, ChartState>;

  /**
   * AI assistance configuration.
   *
   * The key is stored in this plugin's own `data.json` inside the vault. It is
   * never written to the debug log, never included in an error message, and only
   * ever sent to the endpoint configured here.
   */
  ai: AiConfig;

  /**
   * Model ids fetched from the provider, newest fetch wins.
   *
   * Held on the plugin rather than inside `ai` so that clearing the AI settings
   * does not also discard the list, and so it is obvious this is discovered
   * rather than configured.
   */
  aiModels: string[];
}

export const DEFAULT_SETTINGS: ModelicaStudioSettings = {
  omcPath: "",
  libraryPaths: "",
  jobs: Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)),
  extraOmcOptions: "",
  startTime: 0,
  stopTime: 1,
  numberOfIntervals: 500,
  tolerance: 1e-6,
  solver: "",
  paletteRoots: [],
  modelFolder: "",
  modelFiles: {},
  excludedLibraries: "",
  debugLog: false,
  debugOverlay: false,
  editorMode: "diagram",
  inspectorWidth: 380,
  plotHeight: 0,
  codePlotHeight: 0,
  modelStopTimes: {},
  charts: {},
  ai: { ...AI_DEFAULTS },
  aiModels: [],
};

export class ModelicaStudioSettingTab extends PluginSettingTab {
  plugin: ModelicaStudioPlugin;

  constructor(plugin: ModelicaStudioPlugin) {
    super(plugin.app as App, plugin);
    this.plugin = plugin;
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

    new Setting(containerEl)
      .setName("Solver")
      .setDesc(
        "Leave empty for OpenModelica's default (dassl). Other useful values: " +
          "ida, cvode, euler, rungekutta4, gbode."
      )
      .addText((t) =>
        t
          .setPlaceholder("dassl")
          .setValue(this.plugin.settings.solver)
          .onChange(async (v) => {
            this.plugin.settings.solver = v.trim();
            await this.plugin.saveSettings();
          })
      );

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
      .setDesc("Vault folder for new models. Empty saves to the vault root. Created on first save.")
      .addText((t) =>
        t
          .setPlaceholder("models")
          .setValue(this.plugin.settings.modelFolder)
          .onChange(async (v) => {
            this.plugin.settings.modelFolder = v.trim();
            await this.plugin.saveSettings();
          })
      );

    const saved = Object.entries(this.plugin.settings.modelFiles);
    if (saved.length) {
      const list = containerEl.createDiv({ cls: "modelica-studio-muted" });
      list.setText("Saved models: " + saved.map(([name, file]) => `${name} → ${file}`).join(", "));
    }

    containerEl.createEl("h3", { text: "Library" });
    containerEl.createEl("p", {
      cls: "modelica-studio-muted",
      text:
        "Leave out libraries you do not use. Excluded classes disappear from the " +
        "palette, from search and from completion, which keeps a two-library " +
        "project from scrolling past all of them.",
    });

    new Setting(containerEl)
      .setName("Excluded libraries")
      .setDesc(
        "One qualified name per line, e.g. Modelica.Fluid. Lines starting with # " +
          "are ignored. Matched on segment boundaries, so Modelica.Electrical " +
          "does not also exclude Modelica.ElectricalExtra."
      )
      .addTextArea((t) => {
        t.setPlaceholder("Modelica.Fluid\nModelica.Media")
          .setValue(this.plugin.settings.excludedLibraries)
          .onChange(async (v) => {
            this.plugin.settings.excludedLibraries = v;
            await this.plugin.saveSettings();
            // Re-applying is cheap: the index clears its caches only when the
            // list actually changed.
            this.plugin.applyExclusions();
            this.plugin.getView()?.refreshLibrary();
          });
        t.inputEl.rows = 4;
        t.inputEl.style.width = "100%";
      });

    const known = containerEl.createDiv({ cls: "modelica-studio-muted" });
    known.setText("Libraries found on this machine: " + (this.plugin.library.packages().join(", ") || "none indexed yet"));

    containerEl.createEl("h3", { text: "Performance" });
    containerEl.createEl("p", {
      cls: "modelica-studio-muted",
      text:
        "Translation dominates the cost of an edit (roughly 1.9 s with parallel " +
        "codegen, 4.6 s without), while re-running an already-translated model " +
        "with changed parameters takes about 20 ms. The plugin therefore only " +
        "recompiles when the model's structure changes, and reuses the compiled " +
        "model when only parameter values differ.",
    });
  }
}
