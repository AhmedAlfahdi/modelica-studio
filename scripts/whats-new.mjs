/**
 * The release notes a user is shown after an update.
 *
 * Obsidian's installer downloads exactly `manifest.json`, `main.js` and `styles.css`
 * (see `check-bundle.mjs`), so the changelog the repository keeps is NOT in the
 * installed plugin: a popup that read `CHANGELOG.md` from the plugin folder would work
 * for a checkout and show nothing for everyone who installed from the community list.
 * The notes are therefore folded into the bundle, and only the section for the version
 * being shipped — the whole file is 170KB and would be carried by every download to
 * display a page of it.
 *
 * Extraction lives here, in a plain module, so the one part that can be WRONG (a
 * version bumped without its changelog section, a heading spelled differently) is
 * testable against the real file rather than only visible after a release.
 */

/**
 * The changelog section for `version`, or the `Unreleased` section, or `null`.
 *
 * `Unreleased` is the fallback rather than an error: a development build runs with a
 * version whose section does not exist yet, and the work in progress is exactly what
 * should be shown there.
 */
export function changelogSection(changelog, version) {
  const wanted = String(version || "").trim();
  const sections = splitSections(changelog);
  if (wanted) {
    const found = sections.find((s) => s.version === wanted);
    if (found) return found;
  }
  return sections.find((s) => s.version === "Unreleased") ?? null;
}

/**
 * The changelog as `## [version] — date` sections.
 *
 * The heading is matched loosely on purpose: this file is written by hand at the end of
 * a long day, and `## [0.4.0] - 2026-09-26` with a hyphen instead of an em dash is not a
 * reason to show the reader nothing.
 */
function splitSections(changelog) {
  const out = [];
  const heading = /^##\s+\[([^\]]+)\]\s*(?:[—–-]\s*(.+))?$/gm;
  let match;
  let current = null;
  while ((match = heading.exec(changelog)) !== null) {
    if (current) out.push(finish(current, changelog, match.index));
    current = { version: match[1].trim(), date: (match[2] ?? "").trim(), start: heading.lastIndex };
  }
  if (current) out.push(finish(current, changelog, changelog.length));
  return out;
}

/** One section's body, with the trailing rule of the next heading left off. */
function finish(section, changelog, end) {
  const body = changelog
    .slice(section.start, end)
    // `---` separates releases and `[Unreleased]:` are link definitions; neither is news.
    .replace(/\n+---\s*$/, "")
    .replace(/\n+\[[^\]]+\]:\s*\S+\s*$/, "")
    .trim();
  return { version: section.version, date: section.date, body };
}

/**
 * The notes to bundle, in the shape the plugin imports.
 *
 * `null` when the changelog has nothing to say about this version AND no `Unreleased`
 * section either — the plugin then shows no popup rather than an empty one.
 */
export function whatsNewFor(changelog, version) {
  const section = changelogSection(changelog, version);
  if (!section || !section.body) return null;
  return {
    version: section.version === "Unreleased" ? String(version) : section.version,
    date: section.date,
    body: reflow(section.body),
  };
}

/**
 * The section with its hard wrapping undone.
 *
 * The changelog is wrapped for a terminal — every line broken near 95 columns — and
 * Obsidian's renderer treats a single newline as a line break, so the popup showed a
 * paragraph chopped into ragged 95-column pieces ("opens a window with what / changed in
 * that version"). A paragraph is one line of markdown; the source's wrapping is a fact
 * about the source.
 *
 * What is preserved, because it is structure rather than wrapping: blank lines, headings,
 * list items (including nested ones), tables, and fenced code — inside a fence the line
 * breaks are the content. Everything else that is indented is a continuation and joins the
 * line above it.
 */
export function reflow(body) {
  const out = [];
  let fenced = false;
  for (const line of String(body).split("\n")) {
    const isFence = /^\s*(```|~~~)/.test(line);
    const joins =
      !fenced &&
      !isFence &&
      out.length > 0 &&
      out[out.length - 1].trim() !== "" &&
      line.trim() !== "" &&
      // What may not be joined: a line that OPENS something -- a heading, an item, a table
      // row, a quote. A list item's own continuation is the most common case there is, so
      // the line being joined INTO may well be a bullet.
      !/^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|\||>)/.test(line) &&
      // ...but nothing joins INTO a heading, a table row or a quote.
      !/^\s*(#{1,6}\s|\||>)/.test(out[out.length - 1]) &&
      /^\s/.test(line);
    if (joins) {
      out[out.length - 1] = `${out[out.length - 1].trimEnd()} ${line.trim()}`;
    } else {
      out.push(line);
    }
    if (isFence) fenced = !fenced;
  }
  return out.join("\n").trim();
}
