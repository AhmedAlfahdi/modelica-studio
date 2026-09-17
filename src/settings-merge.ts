import { AI_DEFAULTS } from "./ai/prompts";
import type { AiConfig } from "./ai/prompts";

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

/**
 * Merging stored settings over the defaults.
 *
 * Its own module, free of any Obsidian import, because this is the code that
 * decides whether a new setting takes effect at all — and that has already gone
 * wrong once in a way nothing else could catch.
 */

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
   * Vault folder that models are saved into, relative to the vault root.
   *
   * Defaults to `Modelica` so a vault does not end up with `.mo` files scattered
   * among its notes: they are source for a compiler, not notes, and mixing them
   * made the vault root unreadable. Empty means the vault root, for anyone who
   * wants that.
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
  // A browser global, guarded so this module can be loaded where there is no
  // DOM -- it holds the merge rules, which are worth testing directly.
  jobs: Math.max(
    1,
    Math.min(8, ((typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 0) || 4) - 1)
  ),
  extraOmcOptions: "",
  startTime: 0,
  stopTime: 1,
  numberOfIntervals: 500,
  tolerance: 1e-6,
  solver: "",
  paletteRoots: [],
  modelFolder: "Modelica",
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

/**
 * Merge stored settings over the defaults, one level deep.
 *
 * A SHALLOW spread is not enough, and the difference is not cosmetic: the stored
 * `ai` object replaces the default one wholesale, so every field added to `AiConfig`
 * after a user's settings were first written is silently lost. `thinking:
 * "disabled"` never survived a reload, so every request ran in DeepSeek's
 * high-effort thinking mode -- minutes of reasoning before an answer -- and timed
 * out. The setting existed, was correct, and had no effect.
 *
 * One level deep rather than a general deep merge: the nested objects here are
 * flat settings groups, and merging further would make it impossible to remove a
 * key deliberately.
 */
export function mergeSettings(
  defaults: ModelicaStudioSettings,
  stored: Partial<ModelicaStudioSettings> | null | undefined
): ModelicaStudioSettings {
  if (!stored) return { ...defaults };
  const merged: Record<string, unknown> = { ...(defaults as unknown as Record<string, unknown>) };
  for (const [key, value] of Object.entries(stored)) {
    if (value === undefined) continue;
    const base = (defaults as unknown as Record<string, unknown>)[key];
    // Groups of settings merge; everything else, including objects used as
    // values (the per-model maps), replaces.
    const isGroup =
      base !== null &&
      typeof base === "object" &&
      !Array.isArray(base) &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !isMapLike(key);
    merged[key] = isGroup ? { ...(base as object), ...(value as object) } : value;
  }
  return merged as unknown as ModelicaStudioSettings;
}

/**
 * Keys whose value is a map of user data rather than a group of settings.
 *
 * These must replace wholesale. Merging them would merge the defaults' empty
 * object with the stored one, which happens to be harmless, but it also means a
 * user who deletes an entry cannot get rid of it -- the default would restore it.
 */
function isMapLike(key: string): boolean {
  return key === "modelFiles" || key === "modelStopTimes" || key === "charts";
}

/**
 * Bring a stored config forward when a setting's values change.
 *
 * `thinking` was a switch whose "on" value was the string "disabled"; it is now a
 * level whose equivalent is "off". Left alone, an old value is neither a valid
 * level nor a default, so it reaches the provider as an unrecognised parameter --
 * which the provider accepts and quietly ignores, putting the setting back to
 * having no effect. That is the failure this whole area already had once.
 */
export function migrateSettings(settings: ModelicaStudioSettings): ModelicaStudioSettings {
  const ai = settings.ai as unknown as Record<string, unknown> | undefined;
  if (!ai) return settings;
  const thinking = ai.thinking;
  if (thinking === "disabled") ai.thinking = "off";
  else if (thinking === "default") ai.thinking = "high";
  // A config written before the choice existed asks for a diagram, which is what
  // the prompt already preferred.
  if (ai.style !== "visual" && ai.style !== "equations") ai.style = "visual";
  return settings;
}
