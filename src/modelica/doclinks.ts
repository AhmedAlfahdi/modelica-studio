/**
 * Links into the Modelica Standard Library documentation.
 *
 * Two things had to be checked rather than assumed, because the obvious URL is
 * wrong in a way that only shows up when someone clicks it.
 *
 * The documentation is not one page per class. It is one page per PACKAGE, with
 * an anchor for each class inside it:
 *
 *   Modelica.Electrical.Analog.Basic.Resistor
 *     -> Modelica_Electrical_Analog_Basic.html#Modelica.Electrical.Analog.Basic.Resistor
 *
 * Asking for `.../Modelica.Electrical.Analog.Basic.Resistor.html` returns 404,
 * which is the natural guess and is not what the site serves.
 *
 * The version belongs in the path, and it is the LIBRARY version rather than the
 * OpenModelica one: Modelica 4.1.0 has its own help tree, and naming a tree that
 * does not exist gives a 404 rather than a fallback.
 */

/** Where the generated MSL documentation lives. */
export const DOC_BASE = "https://doc.modelica.org";

/**
 * The package page a class is documented on.
 *
 * The file is named for the class's PACKAGE — its name with the last segment
 * removed, dots turned into underscores — and the `Modelica` root shares the
 * first two segments with the file name.
 *
 * Exported for its own tests: this is the part that is easy to get subtly wrong.
 */
export function docPageFor(className: string): { file: string; anchor: string } | null {
  const parts = className.split(".").filter(Boolean);
  // `Modelica.X.Y` is the shortest form with a package page and a class anchor.
  // A root class such as `Modelica.Blocks` is its own page, with no file to
  // shorten to.
  if (parts.length < 3 || parts[0] !== "Modelica") return null;

  const pkg = parts.slice(0, Math.max(2, parts.length - 1));
  return { file: pkg.join("_") + ".html", anchor: parts.join(".") };
}

/**
 * A URL for the class, or null when there is nothing to link to.
 *
 * Returns null rather than a broken link for a class outside the Modelica
 * library: the plugin can also hold user classes and ModelicaServices, and a link
 * that 404s is worse than no link.
 */
export function docUrlFor(className: string, libraryVersion = "4.1.0"): string | null {
  const page = docPageFor(className);
  if (!page) return null;
  const version = encodeURIComponent(`Modelica ${libraryVersion}`);
  return `${DOC_BASE}/${version}/Resources/helpDymola/${page.file}#${page.anchor}`;
}

/**
 * The top-level page for a library version.
 *
 * Separate from `docUrlFor`, which needs a class deep enough to have a package
 * page. This is the entry point, and it is what a "documentation" link with no
 * particular class in mind should open.
 */
export function libraryHelpUrl(libraryVersion = "4.1.0"): string {
  const version = encodeURIComponent(`Modelica ${libraryVersion}`);
  return `${DOC_BASE}/${version}/Resources/helpDymola/Modelica.html`;
}

/**
 * The library version from a name such as "Modelica 4.1.0".
 *
 * The indexed roots are named `Modelica <version>`, so the version is read from
 * there rather than hard-coded: a different installation documents a different
 * tree, and guessing 4.1.0 against a 4.0.0 library links to a page whose classes
 * do not match the ones on screen.
 */
export function libraryVersionFrom(names: string[] | undefined): string {
  for (const name of names ?? []) {
    const match = /^Modelica\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)/.exec(name.trim());
    if (!match) continue;
    // Only versions doc.modelica.org actually publishes a tree for. The
    // installed directory is often named with build metadata -- the local copy is
    // `Modelica 4.1.0+maint.om` -- and that suffix is not part of any published
    // tree name: linking to it gives a 404. Verified 404 against the live site.
    if (PUBLISHED_VERSIONS.has(match[1])) return match[1];
  }
  // Nothing matched a published tree. The version this plugin is developed
  // against is a better answer than a link that 404s.
  return "4.1.0";
}

/**
 * The library versions doc.modelica.org publishes a help tree for.
 *
 * Checked against the site rather than assumed: an unpublished version in the
 * path produces a 404, and a link that 404s is worse than a link to the current
 * release.
 */
export const PUBLISHED_VERSIONS = new Set(["4.1.0", "4.0.0", "3.2.3"]);
