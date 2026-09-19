/**
 * The domain colour code.
 *
 * Modelica is organised by physical domain, and the Modelica Standard Library
 * publishes a colour for each one in `Modelica.UsersGuide.Conventions.Icons`:
 * electrical `{0,0,255}`, thermal `{191,0,0}`, fluid `{0,127,255}`, magnetic
 * `{255,127,0}`, and so on. It is the library's own convention rather than one
 * invented here, and that page is worth reading before changing anything below.
 *
 * The codes in that table are ICON FILL colours, and a fill that reads well on a
 * white icon can be unreadable as text — `{85,170,255}` measures 1.9:1 on a pale
 * background. So each domain keeps the library's HUE and takes a lightness that
 * works as text in both themes, which is what `styles.css` holds and what
 * `test/domains.test.mjs` measures. Where the library's own value already clears
 * the bar it is used unchanged: electrical is exactly `{0,0,255}`.
 *
 * Only the mapping and the reference table live here. The colours are in
 * `styles.css`, because a colour has to change with the theme and CSS is what can
 * do that — and it means a Markdown note in the example vault and a palette
 * heading are coloured by one definition rather than two kept in step by hand.
 */

export type Domain =
  | "electrical"
  | "mechanical"
  | "fluid"
  | "thermal"
  | "magnetic"
  | "blocks"
  | "discrete"
  | "aerospace"
  | "multiphysics"
  | "other";

/** Every domain, so a test can require a colour for each. */
export const DOMAINS: Domain[] = [
  "electrical",
  "mechanical",
  "fluid",
  "thermal",
  "magnetic",
  "blocks",
  "discrete",
  "aerospace",
  "multiphysics",
  "other",
];

export interface DomainInfo {
  domain: Domain;
  /** What to call it in the legend. */
  label: string;
  /**
   * The library's own icon colour, as `Modelica.UsersGuide.Conventions.Icons`
   * gives it, or null where the library assigns none — `Modelica.Media`,
   * `Modelica.Math`, `Modelica.Utilities` and the rest are left uncoloured.
   */
  msl: string | null;
  /** The package that code is quoted from, since some domains have several. */
  from?: string;
}

/**
 * The reference table, for the legend in Help.
 *
 * Quoted from MSL 4.1.0. Where a domain has more than one code — mechanics is
 * grey for rotational and multibody but green for translational — the one covering
 * most of the domain is given, and `from` says which.
 */
export const DOMAIN_INFO: DomainInfo[] = [
  { domain: "electrical", label: "Electrical", msl: "rgb(0, 0, 255)", from: "Electrical.Analog" },
  { domain: "mechanical", label: "Mechanical", msl: "rgb(95, 95, 95)", from: "Mechanics.Rotational" },
  { domain: "fluid", label: "Fluid", msl: "rgb(0, 127, 255)", from: "Fluid" },
  { domain: "thermal", label: "Thermal", msl: "rgb(191, 0, 0)", from: "Thermal.HeatTransfer" },
  { domain: "magnetic", label: "Magnetic", msl: "rgb(255, 127, 0)", from: "Magnetic.FluxTubes" },
  { domain: "blocks", label: "Blocks", msl: "rgb(0, 0, 127)", from: "Blocks" },
  { domain: "discrete", label: "Discrete", msl: "rgb(0, 0, 0)", from: "StateGraph" },
  { domain: "aerospace", label: "Aerospace", msl: null },
  { domain: "multiphysics", label: "Multiphysics", msl: null },
  { domain: "other", label: "Other", msl: null, from: "uncoloured in the library" },
];

/** The reference row for a domain. */
export function domainInfo(domain: Domain): DomainInfo | undefined {
  return DOMAIN_INFO.find((d) => d.domain === domain);
}

/**
 * The domain of a palette group.
 *
 * Keyed on the second segment of the package path, which is the level Modelica
 * divides by physics: `Modelica.Mechanics.Rotational` and
 * `Modelica.Mechanics.Translational` are one domain, and so are the two electrical
 * packages. `ModelicaServices` and the obsolete tree have no physics at all and
 * fall to `other`.
 */
export function domainOfPackage(qualified: string): Domain {
  const parts = qualified.split(".");
  // Lowercased because the palette shows these upper-cased -- `MODELICA.BLOCKS` --
  // and a comparison against the library's own spelling would silently miss.
  const top = (parts[0] ?? "").toLowerCase();
  const branch = (parts[1] ?? "").toLowerCase();

  if (top.startsWith("obsolete") || top === "modelicaservices") return "other";

  switch (branch) {
    case "electrical":
      return "electrical";
    case "mechanics":
      return "mechanical";
    case "fluid":
      return "fluid";
    case "thermal":
      return "thermal";
    case "magnetic":
    case "magneticflux":
      return "magnetic";
    case "blocks":
    case "complexblocks":
      return "blocks";
    case "stategraph":
    case "clocked":
    case "synchronous":
      return "discrete";
    default:
      return "other";
  }
}

/**
 * The domain an example's label names.
 *
 * The labels come from the example descriptions — "Electrical: a resistor
 * divider" — and are already the grouping the Examples menu uses, so this is a
 * reading of the vocabulary that is there rather than a second one to maintain.
 */
export function domainOfLabel(label: string): Domain {
  const word = label.trim().toLowerCase().replace(/[^a-z]/g, "");
  switch (word) {
    case "electrical":
    case "electronics":
      return "electrical";
    case "mechanical":
      return "mechanical";
    case "fluid":
    case "hydraulic":
    case "pneumatic":
      return "fluid";
    case "thermal":
    case "heat":
      return "thermal";
    case "magnetic":
      return "magnetic";
    case "blocks":
    case "control":
      return "blocks";
    case "discrete":
    case "state":
      return "discrete";
    case "aerospace":
      return "aerospace";
    case "multiphysics":
      return "multiphysics";
    default:
      // Media, Math, Utilities, Constants, Icons: the library gives them no
      // colour, and neither does this.
      return "other";
  }
}

/**
 * The class and attribute that colour a piece of text by domain.
 *
 * Returned as attributes rather than a colour so the same call works for an
 * element in the plugin and for the HTML a generated note carries: `styles.css`
 * defines the light and dark values once, and the theme picks between them.
 *
 * `attr` is not decoration. Obsidian's element helpers read a fixed set of keys
 * from their options -- `cls`, `text`, `attr`, `title`, `value`, `type`,
 * `placeholder`, `href` -- and IGNORE everything else, so a bare `"data-domain"`
 * key was silently dropped and the selector matched nothing. Every group heading
 * in the palette rendered in the ordinary colour while the code, the CSS and a
 * source-level test all said otherwise.
 */
export function domainAttributes(domain: Domain): {
  cls: string;
  attr: { "data-domain": Domain };
} {
  return { cls: "modelica-studio-domain", attr: { "data-domain": domain } };
}
