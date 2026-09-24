/**
 * Where a note lives, and what it is called.
 *
 * One definition, used by the generator that writes the notes and by the tests that read
 * them: a layout computed in two places is a layout that disagrees with itself, and the
 * tests would then have to guess paths rather than check the real thing.
 *
 * The numbering follows the studio's Examples PICKER, which groups by domain before it
 * lists -- so `16-fluid-pipe` follows `15-gear-train` even though the flat EXAMPLES array
 * has them far apart. Numbers run across the folders rather than restarting, so a folder
 * listing and the picker read in the same order.
 *
 * Takes the examples as an argument rather than importing them: this file is plain
 * JavaScript and `examples.ts` is not.
 */

/** `ResistorSelfHeating` -> `resistor-self-heating`. */
export const slug = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/**
 * The domain an example belongs to: the part of its description before the colon.
 *
 * The same rule the picker groups by, so the folders here and the headings there cannot
 * disagree about what is electrical and what is mechanical.
 */
export const domainOf = (ex) =>
  ex.description.includes(":") ? ex.description.slice(0, ex.description.indexOf(":")) : "Other";

/** The placement of every example, and the questions worth asking about it. */
export function buildPlacement(EXAMPLES) {
  const placement = new Map();
  // Grouped first, because that is the order the picker displays: numbering the raw array
  // gave 01-Electrical a folder holding 16, 17 and 27.
  const grouped = new Map();
  for (const ex of EXAMPLES) {
    const domain = domainOf(ex);
    grouped.set(domain, [...(grouped.get(domain) ?? []), ex]);
  }
  const folderNumber = new Map([...grouped.keys()].map((d, i) => [d, i + 1]));
  [...grouped.values()].flat().forEach((ex, i) => {
    const domain = domainOf(ex);
    const num = String(i + 1).padStart(2, "0");
    // No spaces in a folder name: a Markdown link destination with one is not a link
    // unless it is wrapped or percent-encoded.
    const folder = `${String(folderNumber.get(domain)).padStart(2, "0")}-${domain.replace(/\s+/g, "-")}`;
    placement.set(ex.name, { folder, file: `${num}-${slug(ex.name)}.md`, num, domain });
  });

  const where = (name) => {
    const p = placement.get(name);
    if (!p) throw new Error(`no note is placed for ${name}`);
    return p;
  };

  return {
    placement,
    /** The domains in the order the picker shows them. */
    domains: [...grouped.keys()],
    /** The examples in the order the picker shows them. */
    ordered: [...grouped.values()].flat(),
    folderOf: (name) => where(name).folder,
    fileOf: (name) => where(name).file,
    numberOf: (name) => where(name).num,
    /** Path relative to the notes directory. */
    pathOf: (name) => `${where(name).folder}/${where(name).file}`,
    domainOf,
  };
}
