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
   * Keep a record of what was sent to the AI and what came back.
   *
   * On by default: the evidence for improving a prompt exists only at the moment
   * of the exchange. The run log keeps the compiler's verdict and not the reply
   * that provoked it, and by the time a model has been repaired twice the
   * original answer is gone.
   */
  aiLog: boolean;

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
  /** Left-hand palette width in pixels; 0 means the default. */
  paletteWidth: number;

  /**
   * Scale applied to the diagram's own text -- the name under each component and
   * the hover readout.
   *
   * A multiplier rather than a pixel size, because the label is already sized
   * from the component's on-screen size: a fixed size would stop it shrinking
   * with the zoom and start the labels overlapping on a large model. This moves
   * the whole curve up or down.
   */
  labelScale: number;

  /**
   * Whether resting the pointer on a component shows what its parameters are set
   * to.
   *
   * On by default: the values that make one component different from the next
   * are otherwise only visible by selecting each in turn, and a diagram of
   * twenty components is then twenty clicks to read.
   */
  hoverParameters: boolean;

  /**
   * Whether the cursor readout shows how far each swept curve is from the run on
   * screen. On by default: it is the question a sweep is asked, and it is empty
   * unless there is a family to compare against.
   */
  plotDeltas: boolean;
  /**
   * Stroke weight of the wires, as a multiple of the standard weight.
   *
   * The standard is a fixed fraction of a symbol's on-screen size, so wires and
   * symbols keep their relationship at every zoom — this scales that whole curve,
   * and the area a wire can be grabbed in, rather than pinning one width.
   */
  wireScale: number;
  /**
   * Whether the wire weight and the component line weight are one setting.
   *
   * MSL's `thickness` is a single scale: a connector asking for 0.5 draws a
   * DOUBLE line, and a graphic asking for 0.5 draws a line of the same weight, so
   * the two settings are two knobs on one curve. Linked, there is one knob, and
   * the library's ratio between wires and symbols cannot be broken by accident.
   *
   * Off by default: it changes what a stored pair of values means, and existing
   * diagrams should not move because a setting was added.
   */
  syncStrokeScale: boolean;
  /**
   * Multiplier on the weight of the lines the component symbols are drawn with.
   *
   * The symbols' own weights are already screen-space and follow the zoom; this
   * scales that whole curve, clamps included, so the library's own emphasis (0.5
   * outlines against 1.0 details against the few that ask for 5.0) survives at
   * any setting instead of piling into the cap.
   */
  symbolStrokeScale: number;
  /**
   * Font scale of the cursor readout drawn on a result plot.
   *
   * Separate from the diagram's own readout: a plot is read on its own, often in
   * a pane, and the two have nothing to do with each other.
   */
  plotReadoutScale: number;
  /**
   * Font scale of the parameter popup drawn over a diagram.
   *
   * Its own setting rather than part of `labelScale`: the name under a symbol is
   * read at a glance while the popup is read deliberately, so wanting one larger
   * says nothing about the other.
   */
  diagramReadoutScale: number;
  /**
   * Whether the cursor readout snaps to the instant two traces cross.
   *
   * On by default: the crossing is usually the moment being read off, and the
   * snap only acts when the pointer is already within `plotSnapTolerance` of it.
   */
  plotSnapCrossings: boolean;
  /**
   * How near, in pixels, a crossing has to be for the readout to snap to it.
   *
   * Pixels, not seconds, because that is the distance being aimed at on screen
   * and it means the same thing at every zoom level. `SNAP_TOLERANCE_PX` in
   * `view/plot.ts` is the same number, and a test holds the two together.
   */
  plotSnapTolerance: number;
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

/**
 * The band the thickness settings share.
 *
 * 100% is the weight MSL declares, which is what makes the numbers mean
 * something. Below 50% a line is a hairline the legibility floor clamps anyway;
 * above 400% a wire is heavier than the pin it connects to, and a symbol is a
 * blob. Both sliders use the same band, and so does the linked one.
 */
export const STROKE_SCALE_MIN = 0.5;
export const STROKE_SCALE_MAX = 4;

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
  aiLog: true,
  debugOverlay: false,
  editorMode: "diagram",
  inspectorWidth: 380,
  paletteWidth: 210,
  labelScale: 1,
  hoverParameters: true,
  // The weights these sliders start at, as a multiple of what MSL declares. 100%
  // is the library's own weight and stays the reference — the range's midpoint in
  // meaning, not in number — but the defaults are a taste: wires a little lighter
  // than the library draws them, and symbols noticeably heavier, which is what
  // reads best on a screen at the sizes these diagrams are looked at. A stored
  // value always wins, so changing this does not move an existing diagram.
  wireScale: 0.9,
  symbolStrokeScale: 1.9,
  syncStrokeScale: false,
  plotReadoutScale: 1,
  diagramReadoutScale: 1,
  plotDeltas: true,
  plotSnapCrossings: true,
  // Matches SNAP_TOLERANCE_PX: 7px is under a tenth of a character's width on
  // screen, so it is a magnet rather than a move.
  plotSnapTolerance: 7,
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
export function migrateSettings(
  settings: ModelicaStudioSettings,
  stored?: Partial<ModelicaStudioSettings> | null
): ModelicaStudioSettings {
  // A save folder that was never recorded gets the default. An EMPTY one that was
  // recorded is left empty, because that is a choice: the setting says leaving it
  // blank saves beside the notes, and quietly overriding a deliberate value is
  // worse than an untidy vault. The two look identical in the merged object,
  // which is why the stored data is consulted.
  const recordedFolder = stored ? Object.prototype.hasOwnProperty.call(stored, "modelFolder") : false;
  if (!recordedFolder && !settings.modelFolder.trim()) {
    settings.modelFolder = DEFAULT_SETTINGS.modelFolder;
  }

  // The thickness settings were calibrated against a scale that turned out to be
  // wrong: the wire slider went to 1000% because a wire was drawn 1.47x a symbol
  // line declaring the same thickness, which made ten times it look reasonable.
  // MSL's own scale says what the numbers mean — 100% is the library's weight —
  // and past 400% a wire is heavier than the pin it lands on, so the stored value
  // is brought into the range the slider now offers. The UI and the drawing then
  // agree, which a clamp applied only when drawing would not.
  for (const key of ["wireScale", "symbolStrokeScale"] as const) {
    const v = settings[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      settings[key] = Math.min(STROKE_SCALE_MAX, Math.max(STROKE_SCALE_MIN, v));
    }
  }
  if (settings.syncStrokeScale) settings.wireScale = settings.symbolStrokeScale;

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

/**
 * The weights the renderer should draw with, after the link is applied.
 *
 * One place decides this, so the Studio, an embedded diagram and the Help legend
 * cannot disagree about what the settings mean.
 */
export function effectiveStrokeScales(settings: {
  wireScale: number;
  symbolStrokeScale: number;
  syncStrokeScale: boolean;
}): { wires: number; symbols: number } {
  const symbols = settings.symbolStrokeScale;
  return settings.syncStrokeScale
    ? { wires: symbols, symbols }
    : { wires: settings.wireScale, symbols };
}
