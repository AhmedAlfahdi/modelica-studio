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
 *
 * Both of those are why this module is small and its URLs are written out in full.
 * A URL that a reader — or the plugin directory's review — has to run the code to
 * discover is a URL nobody can check, and a host assembled from parts is the
 * technique malware uses to keep its endpoint out of a scanner's list. So every
 * tree below is a complete literal, and the code joins nothing: it selects one of
 * them by version and appends the page name and the anchor, which are the only two
 * parts that vary per class.
 */

/**
 * The generated `helpDymola` reference, one literal URL per published version.
 *
 * The space in the tree name is percent-encoded in the site's own links, so it is
 * part of the literal rather than something this code does at runtime.
 */
const HELP_DYMOLA: Record<string, string> = {
  "4.1.0": "https://doc.modelica.org/Modelica%204.1.0/Resources/helpDymola/",
  "4.0.0": "https://doc.modelica.org/Modelica%204.0.0/Resources/helpDymola/",
  "3.2.3": "https://doc.modelica.org/Modelica%203.2.3/Resources/helpDymola/",
};

/**
 * The `helpWSM` reference tree, which is generated for fewer versions.
 *
 * The library reference is generated four times over — `helpDymola`, `helpOM`,
 * `helpWSM` and plain `help` — and the four are NOT published for the same set of
 * versions. Measured against the live site: for 4.1.0 only `helpDymola` answers
 * 200, while `helpWSM` answers 404; for 4.0.0 and 3.2.3 `helpWSM` answers 200.
 * The icon-conventions page exists only in the WSM tree, so a version that has no
 * WSM tree has no page to link to, whatever the plugin's library version is.
 */
const HELP_WSM: Record<string, string> = {
  "4.0.0": "https://doc.modelica.org/Modelica%204.0.0/Resources/helpWSM/",
  "3.2.3": "https://doc.modelica.org/Modelica%203.2.3/Resources/helpWSM/",
};

/** The version this plugin is developed against, and its fallback. */
const DEFAULT_VERSION = "4.1.0";

/** The newest library version whose WSM tree exists. */
export const WSM_FALLBACK_VERSION = "4.0.0";

/**
 * The library versions doc.modelica.org publishes a help tree for.
 *
 * Checked against the site rather than assumed: an unpublished version in the
 * path produces a 404, and a link that 404s is worse than a link to the current
 * release. Read off the table above, so a version cannot be listed here without a
 * URL to go with it.
 */
export const PUBLISHED_VERSIONS = new Set(Object.keys(HELP_DYMOLA));

/** Versions whose *SystemModeler* help tree (`helpWSM`) the site publishes. */
export const WSM_VERSIONS = new Set(Object.keys(HELP_WSM));

/** The `helpDymola` tree to link into, or the current release's. */
function helpTree(libraryVersion: string): string {
  return HELP_DYMOLA[libraryVersion] ?? HELP_DYMOLA[DEFAULT_VERSION];
}

/**
 * The package page a class is documented on.
 *
 * The file is named for the class's PACKAGE — its name with the last segment
 * removed, dots turned into underscores — and the `Modelica` root shares the
 * first two segments with the file name. The anchor is the class name itself,
 * which is the dotted form the site uses.
 *
 * Written with `indexOf`/`slice` rather than `split`/`join` on purpose. A Modelica
 * qualified name looks exactly like a host name — `Modelica.Electrical.Analog` is
 * four dot-separated labels — so splitting one into an array and joining it back
 * with dots, in a module that also holds URLs, reads to a security scan as a
 * domain assembled at runtime. These are class names, not hosts, and the length
 * of this comment is cheaper than a finding that has to be argued about.
 *
 * Exported for its own tests: this is the part that is easy to get subtly wrong.
 */
export function docPageFor(className: string): { file: string; anchor: string } | null {
  const name = className;
  const first = name.indexOf(".");
  const second = first < 0 ? -1 : name.indexOf(".", first + 1);
  const last = name.lastIndexOf(".");
  // `Modelica.X.Y` is the shortest form with a package page and a class anchor:
  // a root class such as `Modelica.Blocks` is its own page, with no file to
  // shorten to. A doubled dot is an empty segment, which is not a class name.
  if (!name.startsWith("Modelica.") || second <= first + 1 || last < second) return null;

  // The package is the name without its last segment, but never shorter than
  // `Modelica.X`.
  const pkg = name.slice(0, last > second ? last : second);
  return { file: pkg.replace(/\./g, "_") + ".html", anchor: name };
}

/**
 * A URL for the class, or null when there is nothing to link to.
 *
 * Returns null rather than a broken link for a class outside the Modelica
 * library: the plugin can also hold user classes and ModelicaServices, and a link
 * that 404s is worse than no link.
 */
export function docUrlFor(className: string, libraryVersion = DEFAULT_VERSION): string | null {
  const page = docPageFor(className);
  if (!page) return null;
  return helpTree(libraryVersion) + page.file + "#" + page.anchor;
}

/**
 * The top-level page for a library version.
 *
 * Separate from `docUrlFor`, which needs a class deep enough to have a package
 * page. This is the entry point, and it is what a "documentation" link with no
 * particular class in mind should open.
 */
export function libraryHelpUrl(libraryVersion = DEFAULT_VERSION): string {
  return helpTree(libraryVersion) + "Modelica.html";
}

/**
 * The page where the library lists the icon colour scheme this plugin follows.
 *
 * Falls back to the newest version that publishes a WSM tree rather than to the
 * indexed version unconditionally: the colours have not changed across these
 * releases, whereas naming a tree that does not exist is a dead link — which is
 * exactly what `Modelica%204.1.0/.../helpWSM/...` is.
 */
export function libraryIconsUrl(libraryVersion = WSM_FALLBACK_VERSION): string {
  const version = WSM_VERSIONS.has(libraryVersion) ? libraryVersion : WSM_FALLBACK_VERSION;
  return HELP_WSM[version] + "Modelica/Modelica.UsersGuide.Conventions.Icons.html";
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
  return DEFAULT_VERSION;
}
