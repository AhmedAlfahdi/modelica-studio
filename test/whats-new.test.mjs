/**
 * The update popup: when it opens, and what it shows.
 *
 * Two halves, and both are tested where they can be WRONG rather than where they are
 * convenient:
 *
 *  - The extraction runs against the real CHANGELOG.md, because the way this feature
 *    fails in the wild is a version bumped without its section — which no fixture would
 *    catch, since a fixture is written by the same person who wrote the extractor.
 *  - The decision runs as a table, because the cases worth getting right (a first
 *    install, a downgrade, a version already seen) are exactly the ones nobody
 *    reproduces by hand.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildLibs, repoRoot } from "./helpers/build.mjs";
import { changelogSection, reflow, whatsNewFor } from "../scripts/whats-new.mjs";

const LIB = buildLibs("whats-new-lib", ["src/whats-new.ts"]);
const { announcementFor, compareVersions } = await import(path.join(LIB, "whats-new.js"));

const CHANGELOG = fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));

test("the version being shipped has notes, so the popup is never empty", () => {
  // The one assertion that fails a release rather than a user: bump the version without a
  // changelog section and the popup either shows nothing or shows the wrong release.
  const notes = whatsNewFor(CHANGELOG, MANIFEST.version);
  assert.ok(notes, `no changelog section for ${MANIFEST.version}`);
  assert.equal(notes.version, MANIFEST.version, "the notes are for the version in manifest.json");
  assert.ok(notes.body.length > 200, `the notes are thin (${notes.body.length} chars)`);
  assert.match(notes.body, /^###\s/m, "the section keeps its Added/Changed/Fixed headings");
});

test("the source's hard wrapping is not what the reader sees", () => {
  // Reported: the popup showed a paragraph chopped into ragged 95-column pieces, because
  // the changelog is wrapped for a terminal and Obsidian renders a single newline as a
  // line break. The notes are re-flowed at build time; a paragraph is one line of markdown.
  // Asserted as a PROPERTY of whatever version is being shipped, not against a sentence from
  // one release: the first version of this test quoted 0.5.0's prose, and bumping the manifest
  // to 0.6.0 — which is the moment this test exists for — made it fail.
  const notes = whatsNewFor(CHANGELOG, MANIFEST.version);
  const raw = changelogSection(CHANGELOG, MANIFEST.version).body;
  const rawLines = raw.split("\n").length;
  assert.ok(
    notes.body.split("\n").length * 2 < rawLines,
    `the notes are re-flowed: ${notes.body.split("\n").length} lines against ${rawLines} in the source`
  );
  // A paragraph longer than the source's own wrapping is proof the joins happened, and every
  // such line is one a terminal-wrapped file would not have.
  assert.ok(
    notes.body.split("\n").some((line) => line.length > 120),
    "at least one paragraph runs past the column the changelog is wrapped at"
  );
  // A wrapped continuation sits under a line that is not blank; an indented line under a
  // BLANK one is a second paragraph of the same item, which is structure and stays.
  const lines = notes.body.split("\n");
  const continuations = lines.filter((l, i) => i > 0 && /^ {2,}\S/.test(l) && lines[i - 1].trim() !== "");
  assert.deepEqual(continuations, [], "no continuation line is left where the renderer would break it");
  assert.ok(lines.length < 60, `the notes are still wrapped (${lines.length} lines)`);
});

test("re-flowing keeps the structure and nothing else", () => {
  const wrapped = [
    "### Added",
    "",
    "- **A thing.** It does something, and the sentence",
    "  continues on the next line the way this file is written.",
    "",
    "  A second paragraph of the same item, indented so it stays inside the bullet.",
    "",
    "- **Another.** With its own continuation",
    "  and a nested item:",
    "  - nested, kept as an item",
    "",
    "| a | b |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "```",
    "let x = 1;",
    "let y = 2;",
    "```",
  ].join("\n");
  const out = reflow(wrapped);
  assert.match(out, /- \*\*A thing\.\*\* It does something, and the sentence continues on the next line the way this file is written\./);
  assert.match(out, /\n\n {2}A second paragraph of the same item/, "a second paragraph stays a paragraph, and stays indented");
  assert.match(out, /\n {2}- nested, kept as an item/, "a nested item is an item, not a continuation");
  assert.match(out, /\| a \| b \|\n\| - \| - \|\n\| 1 \| 2 \|/, "a table is left alone");
  assert.match(out, /```\nlet x = 1;\nlet y = 2;\n```/, "and so is code: inside a fence the breaks are the content");
  assert.equal(out, `${out.trim()}`, "with no leading or trailing blank");
});

test("the notes stop at the next release", () => {
  const notes = whatsNewFor(CHANGELOG, MANIFEST.version);
  assert.doesNotMatch(notes.body, /^## /m, "no heading of the next release leaked in");
  assert.doesNotMatch(notes.body, /^\[[^\]]+\]:/m, "and no link definitions from the file's tail");
  assert.doesNotMatch(notes.body, /\n---\s*$/, "and not the rule that separates releases");
  // The section is one release, not the history: 170KB of changelog would ride in every
  // download to show one page of it.
  assert.ok(notes.body.length < 20000, `the notes are the whole history (${notes.body.length} chars)`);
});

test("a version with no section falls back to Unreleased, and then to nothing", () => {
  const sample = [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    "### Added",
    "",
    "- Something not released yet.",
    "",
    "## [1.2.3] - 2026-01-02",
    "",
    "### Fixed",
    "",
    "- A bug.",
    "",
    "[Unreleased]: https://example.invalid/compare",
  ].join("\n");
  assert.deepEqual(changelogSection(sample, "1.2.3"), {
    version: "1.2.3",
    date: "2026-01-02",
    body: "### Fixed\n\n- A bug.",
  });
  // A development build runs a version whose section does not exist yet.
  assert.equal(changelogSection(sample, "9.9.9").version, "Unreleased");
  assert.equal(whatsNewFor(sample, "9.9.9").version, "9.9.9", "and it is labelled with the running version");
  assert.equal(changelogSection("# Changelog\n\nnothing here\n", "1.0.0"), null);
  assert.equal(whatsNewFor("# Changelog\n", "1.0.0"), null, "no popup rather than an empty one");
});

test("the heading is matched whether the date is an em dash, an en dash or a hyphen", () => {
  for (const dash of ["—", "–", "-"]) {
    const text = `## [0.5.0] ${dash} 2026-10-06\n\n### Added\n\n- A thing.\n`;
    assert.deepEqual(changelogSection(text, "0.5.0"), {
      version: "0.5.0",
      date: "2026-10-06",
      body: "### Added\n\n- A thing.",
    });
  }
});

test("what opens the popup, and what does not", () => {
  const cases = [
    // [last seen, running, setting, announce, seen]
    ["", "0.4.0", true, false, "0.4.0", "a fresh install is not an update"],
    [undefined, "0.4.0", true, false, "0.4.0", "and neither is a data.json written before this existed"],
    ["0.4.0", "0.4.0", true, false, "0.4.0", "the same version, again"],
    ["0.3.27", "0.4.0", true, true, "0.4.0", "an update"],
    ["0.9.0", "0.10.0", true, true, "0.10.0", "ten is newer than nine, which is not a string comparison"],
    ["0.4.0", "0.3.27", true, false, "0.3.27", "a downgrade is not news"],
    ["0.3.27", "0.4.0", false, false, "0.4.0", "the setting is the last word"],
    ["", "0.4.0", false, false, "0.4.0", "and the version is recorded even then"],
    ["0.3.27", "", true, false, "0.3.27", "no version to compare"],
    ["1.0.0", "1.0.0-beta", true, false, "1.0.0-beta", "a prerelease is older than its release"],
    ["1.0.0-beta", "1.0.0", true, true, "1.0.0", "and moving to the release is an update"],
  ];
  for (const [lastSeen, current, enabled, announce, seen, why] of cases) {
    const got = announcementFor(lastSeen, current, enabled);
    assert.deepEqual(got, { announce, seen }, `${lastSeen || "(none)"} -> ${current} (${why})`);
  }
});

test("versions compare the way a release orders them", () => {
  const ordered = ["0.3.27", "0.4.0", "0.4.1", "0.10.0", "1.0.0-beta", "1.0.0", "1.0.1", "2.0.0"];
  for (let i = 1; i < ordered.length; i++) {
    const older = ordered[i - 1];
    const newer = ordered[i];
    assert.equal(compareVersions(older, newer), -1, `${older} < ${newer}`);
    assert.equal(compareVersions(newer, older), 1, `${newer} > ${older}`);
    assert.equal(compareVersions(older, older), 0, `${older} == ${older}`);
  }
});
