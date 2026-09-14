/**
 * Canvas colour themes.
 *
 * The diagram and the plot are drawn with the 2D canvas API, which knows
 * nothing about CSS variables — every colour has to be handed to it explicitly.
 * Those colours were literals chosen for a light background, so in Obsidian's
 * dark theme the symbols were near-black on near-black and the wires were a
 * dark navy that vanished.
 *
 * They now come from one place, resolved for the theme in effect, so the
 * diagram, the plot and the surrounding UI agree in both themes.
 *
 * Modelica's own convention is respected rather than overridden: an icon that
 * does not state a colour means "the default ink", and the default fill means
 * "no fill". Those two are mapped to the theme's ink and surface, while any
 * colour a model states explicitly is drawn exactly as written — a red line is
 * red in either theme, which is the point of stating it.
 */

import type { Color } from "../modelica/types";

export interface Theme {
  /** True when the dark theme is in effect. */
  dark: boolean;
  /** Default colour for graphics that state none. */
  ink: Color;
  /** Default fill, matching the canvas background. */
  paper: Color;
  /** Canvas background. */
  background: string;
  /**
   * Lowest relative luminance a stated colour may have before it is adapted.
   *
   * Set to the luminance that yields 3:1 against this theme's canvas — for the
   * dark background (luminance 0.0151) that is 0.145 — which is the threshold at
   * which a thin outline stops being readable. In the light theme it is 0: every
   * stated colour is legible on a pale surface, so nothing is altered and the
   * diagram is exactly what the library asked for.
   */
  minInkLuminance: number;
  /** Minor grid lines. */
  grid: string;
  /** Major grid lines, drawn every fifth cell. */
  gridMajor: string;

  /** Default wire colour, and the colour of a selected wire. */
  wire: Color;
  wireSelected: string;
  /** Wire being dragged from a pin. */
  wirePending: string;
  /** Wire highlight while a connection is hovered. */
  wireHover: string;

  /** Selection outline and resize handles. */
  selection: string;
  handleFill: string;
  handleStroke: string;

  /** Connection pins. */
  pinFill: string;
  pinStroke: string;
  pinFillMuted: string;
  pinStrokeMuted: string;
  pinHot: string;

  /** Instance labels under each component. */
  label: string;
  /** The level-of-detail chip drawn when a symbol is too small to read. */
  chip: string;
  /** Frame and digit colour of the bitmap-icon placeholder. */
  placeholderFill: string;
  placeholderStroke: string;
  placeholderText: string;

  /** Plot surfaces. */
  plotBackground: string;
  plotForeground: string;
  plotGrid: string;
  plotAxis: string;
  plotCursor: string;
  plotLegendBackground: string;
  /** Series colours, in order. Legible on either background. */
  series: string[];

  /** Rubber-band selection fill. */
  bandFill: string;
  /** Diagnostic overlay: clickable region, drawn box, and click marker. */
  diagHitRegion: string;
  diagDrawnBox: string;
  diagMarker: string;
  diagPanelBackground: string;
  diagPanelStroke: string;
  diagText: string;
}

/**
 * Modelica's implicit black/white.
 *
 * MSL writes `lineColor={0,0,0}` for "ink" and `fillColor={255,255,255}` for
 * "no fill" rather than stating a colour it intends literally. Those two are
 * therefore treated as theme-dependent; everything else is passed through.
 */
function isPureBlack(c: Color | undefined): boolean {
  return !!c && c[0] === 0 && c[1] === 0 && c[2] === 0;
}

function isPureWhite(c: Color | undefined): boolean {
  return !!c && c[0] === 255 && c[1] === 255 && c[2] === 255;
}

/**
 * Is this colour too dark to read on the dark canvas?
 *
 * MSL's palette is semantic, not decorative: blue outlines electrical and block
 * diagrams, green mechanical, red thermal. Lightening all of it would destroy
 * that coding, so only colours that would actually be illegible are adjusted.
 *
 * The measure is relative luminance against the dark surface. A colour that is
 * a *shading* tone rather than a hue the library chose to be seen — a near-grey
 * or a very dark neutral — is left alone, because lightening it would make the
 * shading brighter than the symbol it is meant to shade.
 */
function isTooDarkForTheme(c: Color, theme: Theme): boolean {
  if (theme.minInkLuminance <= 0) return false;
  const [r, g, b] = c;
  const saturation = Math.max(r, g, b) - Math.min(r, g, b);
  const luminance = relativeLuminance(c);
  // A saturated hue is a colour the library chose to be seen; an unsaturated
  // dark tone is shading, and lightening it would make the shading brighter
  // than the symbol it is meant to shade.
  if (saturation < 60) return false;
  return luminance < theme.minInkLuminance;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function relativeLuminance(c: Color): number {
  const channel = (v: number): number => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
}

/**
 * Lighten a colour until it reads on a dark surface, keeping its hue.
 *
 * Blending towards white preserves the hue, so blue stays recognisably blue and
 * the library's colour coding survives while the outline becomes visible.
 */
function lightenForTheme(c: Color, theme: Theme): Color {
  const target = theme.ink;
  const mix = (t: number): Color => [
    Math.round(c[0] + (target[0] - c[0]) * t),
    Math.round(c[1] + (target[1] - c[1]) * t),
    Math.round(c[2] + (target[2] - c[2]) * t),
  ];
  // The smallest blend that clears the floor, so the result stays as close to
  // the library's own colour as legibility allows.
  for (let t = 0.2; t <= 0.85; t += 0.05) {
    const candidate = mix(t);
    if (relativeLuminance(candidate) >= theme.minInkLuminance) return candidate;
  }
  return mix(0.85);
}

/**
 * Resolve a graphic's colour for the theme.
 *
 * `kind` distinguishes a stroke from a fill, because the same literal means
 * different things: black is ink when stroking, and "no fill" when filling.
 */
export function themedColor(
  c: Color | undefined,
  theme: Theme,
  kind: "stroke" | "fill" = "stroke"
): Color {
  // No colour stated: Modelica means "the default", which is ink for a stroke
  // and no fill for a fill.
  if (!c) return kind === "fill" ? theme.paper : theme.ink;
  // Stated as black: ink when stroking, "no fill" when filling.
  if (isPureBlack(c)) return kind === "fill" ? theme.paper : theme.ink;
  // Stated as white: "no fill" when filling, but a white STROKE stays white —
  // MSL uses it deliberately as a highlight over a dark body, and turning it
  // into ink would erase that detail.
  if (isPureWhite(c)) return kind === "fill" ? theme.paper : c;
  // Fills are treated more conservatively than strokes: hatch and pattern
  // colours are also used as fills, and lightening them would flatten the
  // shading they exist to provide.
  if (kind === "fill") {
    const [r, g, b] = c;
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    if (theme.dark && saturation < 60 && relativeLuminance(c) < theme.minInkLuminance) {
      return theme.paper;
    }
    return c;
  }
  // On a light background every stated colour is legible, so the diagram is
  // exactly what the library asked for.
  if (theme.minInkLuminance <= 0) return c;
  // On dark, a colour too dark to read is lightened along its own hue, which
  // keeps MSL's colour coding instead of replacing it with one flat ink colour.
  return isTooDarkForTheme(c, theme) ? lightenForTheme(c, theme) : c;
}

/** `rgb(...)` for a colour tuple. */
function cssColor(c: Color): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** The canvas surface colour for a theme. */
const LIGHT_PAPER: Color = [250, 251, 253];
const DARK_PAPER: Color = [30, 33, 39];

const LIGHT: Theme = {
  dark: false,
  ink: [0, 0, 0],
  // The fill colour and the canvas background must be the same value, or a
  // "no fill" shape shows a seam against the surface it sits on.
  paper: LIGHT_PAPER,
  background: cssColor(LIGHT_PAPER),
  // Nothing is adapted on a light background.
  minInkLuminance: 0,
  grid: "rgba(120,135,160,0.13)",
  gridMajor: "rgba(120,135,160,0.24)",

  wire: [0, 0, 127],
  wireSelected: "rgb(40,110,225)",
  wirePending: "rgb(90,140,235)",
  wireHover: "rgb(70,130,225)",

  selection: "rgb(40,110,225)",
  handleFill: "rgb(255,255,255)",
  handleStroke: "rgb(50,100,190)",

  pinFill: "rgba(255,255,255,0.98)",
  pinStroke: "rgba(70,110,180,0.85)",
  pinFillMuted: "rgba(255,255,255,0.85)",
  pinStrokeMuted: "rgba(90,130,200,0.75)",
  pinHot: "rgb(60,130,240)",

  label: "rgb(70,75,90)",
  chip: "rgba(90,110,140,0.35)",
  placeholderFill: "rgba(230,235,245,0.9)",
  placeholderStroke: "rgba(120,140,170,0.9)",
  placeholderText: "rgb(80,90,110)",

  plotBackground: "rgb(252,252,254)",
  plotForeground: "rgb(40,44,52)",
  plotGrid: "rgba(120,130,150,0.18)",
  plotAxis: "rgba(90,100,120,0.7)",
  plotCursor: "rgba(200,80,80,0.85)",
  plotLegendBackground: "rgba(255,255,255,0.94)",
  // Distinct in hue and lightness, and readable on a pale background.
  series: [
    "#c0392b", "#1f6feb", "#1a7f37", "#8250df",
    "#bf6a02", "#0f7b8a", "#a3186e", "#5a5f6a",
  ],

  bandFill: "rgba(60,120,225,0.12)",
  diagHitRegion: "rgba(230,120,20,0.95)",
  diagDrawnBox: "rgba(20,150,60,0.9)",
  diagMarker: "rgba(230,60,60,0.95)",
  diagPanelBackground: "rgba(255,255,255,0.92)",
  diagPanelStroke: "rgba(200,60,60,0.9)",
  diagText: "rgb(20,20,20)",
};

const DARK: Theme = {
  dark: true,
  ink: [235, 238, 245],
  paper: DARK_PAPER,
  background: cssColor(DARK_PAPER),
  minInkLuminance: 0.145,
  grid: "rgba(150,165,190,0.10)",
  gridMajor: "rgba(150,165,190,0.20)",

  wire: [150, 190, 255],
  wireSelected: "rgb(120,180,255)",
  wirePending: "rgb(140,190,255)",
  wireHover: "rgb(150,200,255)",

  selection: "rgb(120,180,255)",
  handleFill: "rgb(38,42,50)",
  handleStroke: "rgb(130,180,255)",

  pinFill: "rgba(38,42,50,0.98)",
  pinStroke: "rgba(150,185,240,0.9)",
  pinFillMuted: "rgba(38,42,50,0.85)",
  pinStrokeMuted: "rgba(130,165,220,0.8)",
  pinHot: "rgb(120,180,255)",

  label: "rgb(190,196,210)",
  chip: "rgba(140,160,195,0.35)",
  placeholderFill: "rgba(60,66,78,0.9)",
  placeholderStroke: "rgba(140,160,195,0.9)",
  placeholderText: "rgb(190,200,215)",

  plotBackground: "rgb(30,33,39)",
  plotForeground: "rgb(214,219,228)",
  plotGrid: "rgba(150,165,190,0.14)",
  plotAxis: "rgba(170,180,200,0.65)",
  plotCursor: "rgba(240,130,130,0.85)",
  plotLegendBackground: "rgba(30,33,39,0.94)",
  // Lighter and slightly desaturated so they read against a dark surface.
  series: [
    "#ff6b5e", "#5aa9ff", "#4fd07a", "#b98cff",
    "#ffa63d", "#3fd0d8", "#ff7ac6", "#a8b0bd",
  ],

  bandFill: "rgba(120,180,255,0.16)",
  diagHitRegion: "rgba(255,150,60,0.95)",
  diagDrawnBox: "rgba(70,210,120,0.95)",
  diagMarker: "rgba(255,90,90,0.95)",
  diagPanelBackground: "rgba(30,33,39,0.94)",
  diagPanelStroke: "rgba(240,110,110,0.9)",
  diagText: "rgb(235,238,245)",
};

/**
 * The theme in effect.
 *
 * Obsidian marks the dark theme with `theme-dark` on `body`, so that is the
 * signal rather than the OS preference — the user may override either way.
 */
export function currentTheme(): Theme {
  if (typeof document === "undefined") return LIGHT;
  const body = document.body;
  if (body && body.classList.contains("theme-dark")) return DARK;
  return LIGHT;
}
