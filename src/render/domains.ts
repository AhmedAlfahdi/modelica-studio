/**
 * Which domain a package or an example belongs to.
 *
 * Modelica is organised by physical domain, and the library, the palette and the
 * examples all use those names already — `Modelica.Thermal`, `Modelica.Fluid`,
 * "Thermal", "Fluid". What was missing was a single place that decides what those
 * names MEAN, so the same domain can be coloured the same way wherever it appears.
 *
 * Only the mapping lives here. The colours are in `styles.css`, because a colour
 * has to change with the theme and CSS is what can do that: a Markdown note in the
 * example vault uses the same class as the palette, so one definition covers both.
 * `test/domains.test.mjs` measures every pair for contrast against both themes.
 */

export type Domain =
  | "electrical"
  | "mechanical"
  | "fluid"
  | "thermal"
  | "magnetic"
  | "blocks"
  | "media"
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
  "media",
  "discrete",
  "aerospace",
  "multiphysics",
  "other",
];

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
  const top = parts[0] ?? "";
  const branch = (parts[1] ?? "").toLowerCase();

  if (top.toLowerCase().startsWith("obsolete")) return "other";
  if (top === "ModelicaServices") return "other";

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
    case "media":
      return "media";
    case "stategraph":
    case "clocked":
    case "synchronous":
      return "discrete";
    case "icons":
      return "other";
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
    case "media":
      return "media";
    case "discrete":
    case "state":
      return "discrete";
    case "aerospace":
      return "aerospace";
    case "multiphysics":
      return "multiphysics";
    default:
      return "other";
  }
}

/**
 * The class and attribute that colour a piece of text by domain.
 *
 * Returned as attributes rather than a colour so the same call works for an
 * element in the plugin and for the HTML a generated note carries: `styles.css`
 * defines the light and dark values once, and the theme picks between them.
 */
export function domainAttributes(domain: Domain): { cls: string; "data-domain": Domain } {
  return { cls: "modelica-studio-domain", "data-domain": domain };
}
