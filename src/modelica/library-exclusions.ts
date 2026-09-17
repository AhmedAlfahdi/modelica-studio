/**
 * The library exclusion list, as checkboxes.
 *
 * The setting is a list of name prefixes that are left out of the palette, search
 * and completion. As a text area it asked the user to type qualified names by
 * hand, which made the ordinary case — "I do not use Fluid" — the awkward one,
 * and gave no indication of what was even available.
 *
 * Two things this has to get right, and both follow from the exclusion list being
 * a PREFIX list rather than a set of exact names:
 *
 *   - `Modelica.Electrical` excludes `Modelica.Electrical.Analog` but must NOT
 *     exclude `Modelica.ElectricalExtra`. Matching is on segment boundaries.
 *   - A library can be excluded without its own name appearing in the list, when
 *     an ancestor is there. `Modelica.Fluid` is unchecked because `Modelica` is
 *     excluded, and the row says so rather than claiming the entry exists.
 *
 * Pure, so both rules can be tested without a vault or an index.
 */

export interface LibraryRow {
  /** The qualified name, e.g. `Modelica.Fluid`. */
  name: string;
  /** Short label for the checkbox, e.g. `Fluid`. */
  label: string;
  /** True when this library is currently left out. */
  excluded: boolean;
  /**
   * The exclusion entry responsible, when it is not this library's own name.
   * Set means the row is unchecked because an ancestor is, and ticking it would
   * have no effect until that ancestor is removed.
   */
  excludedBy?: string;
}

/** Whether `name` is excluded by any entry, on segment boundaries. */
export function isExcludedBy(name: string, entries: string[]): string | null {
  for (const raw of entries) {
    const entry = raw.trim();
    // Comments and blanks are the text format's business, not the caller's.
    if (!entry || entry.startsWith("#")) continue;
    if (name === entry) return entry;
    if (name.startsWith(entry + ".")) return entry;
  }
  return null;
}

/** Parse the stored text into entries, dropping blanks and comments. */
export function parseExclusions(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/**
 * The rows for a set of discovered packages, in display order.
 *
 * Modelica's own sub-libraries come first and sorted, because they are what the
 * setting is usually about; anything else follows. A checkbox list that puts
 * `ObsoleteModelica4` above `Fluid` makes the common choice harder to find.
 */
export function libraryRows(packages: string[], excludedText: string): LibraryRow[] {
  const entries = parseExclusions(excludedText);
  const rows = packages.map((name) => {
    const parts = name.split(".");
    const by = isExcludedBy(name, entries);
    return {
      name,
      label: parts.length > 1 ? parts.slice(1).join(".") : name,
      excluded: by !== null,
      excludedBy: by && by !== name ? by : undefined,
    };
  });

  const rank = (r: LibraryRow) => (r.name.startsWith("Modelica.") ? 0 : r.name === "Modelica" ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * The exclusion text for a new set of checkbox states.
 *
 * Entries that no checkbox covers are PRESERVED. The text area also accepts
 * sub-library names such as `Modelica.Fluid.Vessels`, which no top-level row can
 * represent; dropping them on the next tick would silently undo a setting the
 * user had made deliberately.
 */
export function exclusionsFrom(
  rows: Array<{ name: string; excluded: boolean }>,
  previousText: string
): string {
  // Which entries a checkbox can represent: a row's own name, or a coarser
  // prefix of it. `Modelica.Fluid` is the row for both `Modelica.Fluid` and any
  // `Modelica` entry, but NOT for `Modelica.Fluid.Vessels`, which is finer than
  // any row and is kept.
  const representable = (entry: string): boolean =>
    rows.some((r) => entry === r.name || r.name.startsWith(entry + "."));

  const kept = parseExclusions(previousText).filter((e) => !representable(e));
  const ticked = rows.filter((r) => r.excluded).map((r) => r.name);
  // Sorted and de-duplicated: the stored text is read by a person in the text
  // area as well as by the index.
  return [...new Set([...ticked, ...kept])].sort().join("\n");
}
