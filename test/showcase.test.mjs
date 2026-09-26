/**
 * The showcase notes must document the models that actually ship.
 *
 * Each note embeds its example inside a `modelica` fence, and that fence is what
 * the plugin runs when a reader opens the note. If an example changes and the
 * note is not regenerated, the note derives an answer for a model nobody runs —
 * worse than having no note, because it looks authoritative.
 *
 *   node showcase/generate.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildLibs, repoRoot } from "./helpers/build.mjs";

const NOTES_DIR = path.join(repoRoot, "showcase", "notes");
const { buildPlacement } = await import(path.join(repoRoot, "showcase", "placement.mjs"));
const { EXAMPLES } = await import(
  path.join(buildLibs("showcase-ex", ["src/modelica/examples.ts"]), "examples.js")
);
const P = buildPlacement(EXAMPLES);

/** Every `modelica` fence in a note, with its info line. */
function fences(text) {
  return [...text.matchAll(/```modelica([^\n]*)\n([\s\S]*?)```/g)].map((m) => ({
    info: m[1].trim(),
    body: m[2].trim(),
  }));
}

/** Notes that are not about one example. */
const NON_EXAMPLE_NOTES = ["00-modelica-intro.md", "01-learning-with-a-simulator.md"];

test("every example has a showcase note, plus the introduction", () => {
  assert.ok(fs.existsSync(NOTES_DIR), "showcase/notes exists");
  // One note per example, at the path the shared placement says, plus the two guides and
  // the index at the top level.
  const placed = EXAMPLES.map((ex) => P.pathOf(ex.name));
  const missing = placed.filter((rel) => !fs.existsSync(path.join(NOTES_DIR, rel)));
  assert.deepEqual(missing, [], `${missing.length} examples have no note at their placed path`);
  const inFolders = fs
    .readdirSync(NOTES_DIR, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".md") && f.includes("/"));
  assert.equal(
    inFolders.length,
    EXAMPLES.length,
    `one note per example: ${inFolders.length} notes in folders for ${EXAMPLES.length} examples`
  );
  for (const extra of NON_EXAMPLE_NOTES) {
    assert.ok(fs.existsSync(path.join(NOTES_DIR, extra)), `${extra} exists`);
  }
});

test("the introduction explains Modelica and links into the examples", () => {
  const intro = fs.readFileSync(path.join(NOTES_DIR, "00-modelica-intro.md"), "utf8");

  // It must actually teach the language, not just list files.
  for (const idea of ["What is Modelica", "der", "connector", "equation", "flatten"]) {
    assert.ok(
      intro.toLowerCase().includes(idea.toLowerCase()),
      `the introduction covers "${idea}"`
    );
  }
  // It carries one runnable model, and links to the notes in both directions.
  assert.equal(fences(intro).length, 1, "one runnable model in the introduction");
  assert.match(intro, /\]\(01-Electrical\/01-electrical\.md\)/, "it links to an example");
  assert.match(intro, /\]\(README\.md\)/, "and to the index");

  // Every example links back, so a reader who lands anywhere can find it.
  for (const ex of EXAMPLES) {
    // A note sits one folder down, so its way back is `../`.
    const text = fs.readFileSync(path.join(NOTES_DIR, P.pathOf(ex.name)), "utf8");
    assert.match(
      text,
      /\]\(\.\.\/00-modelica-intro\.md\)/,
      `${ex.name} links back to the introduction`
    );
  }

  // The index lists it too.
  const index = fs.readFileSync(path.join(NOTES_DIR, "README.md"), "utf8");
  assert.match(index, /\]\(00-modelica-intro\.md\)/, "the index links to the introduction");
});

test("the README indexes every worked example, with a link that resolves", () => {
  // The README carries its own copy of the domain table, because a reader arriving at
  // the repository should see what the plugin does without following a link first --
  // and because "download this vault" is not a thing anybody does. A copy drifts, so
  // this is the test that stops it: add a thirty-first example and the README has to
  // list it before the suite goes green again.
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
  const table = /^\| Domain \| Examples \|\n\|---\|---\|\n([\s\S]*?)\n\n/m.exec(readme);
  assert.ok(table, "the README has a worked-examples table");

  for (const ex of EXAMPLES) {
    const target = `showcase/notes/${P.pathOf(ex.name)}`;
    assert.ok(
      table[1].includes(`](${target})`),
      `${ex.name} is not linked from the README's index (expected ${target})`
    );
    assert.ok(
      fs.existsSync(path.join(repoRoot, target)),
      `${ex.name}: the README links ${target}, which does not exist`
    );
  }

  // And nothing invented: every link in the table is a note that exists.
  for (const m of table[1].matchAll(/\]\((showcase\/notes\/[^)]+)\)/g)) {
    assert.ok(fs.existsSync(path.join(repoRoot, m[1])), `the README links ${m[1]}, which does not exist`);
  }
});

test("each note embeds the example it documents, unchanged", () => {
  for (const ex of EXAMPLES) {
    const file = path.join(NOTES_DIR, P.pathOf(ex.name));
    assert.ok(fs.existsSync(file), `${ex.name}: note ${P.pathOf(ex.name)} exists`);
    const text = fs.readFileSync(file, "utf8");
    const found = fences(text);
    assert.equal(found.length, 1, `${ex.name}: exactly one modelica block, found ${found.length}`);

    // The embedded source must be the shipped example, so what a reader runs is
    // what the note derives an answer for.
    const withoutDirective = found[0].body.replace(/^\s*\/\/\s*@[^\n]*\n?/, "").trim();
    assert.equal(
      withoutDirective,
      ex.source.trim(),
      `${ex.name}: the embedded model is the shipped example (run showcase/generate.mjs?)`
    );

    // And it must carry its own span, or the block would inherit whatever the
    // Studio last used. The option lives in a directive comment INSIDE the
    // block, because Obsidian does not pass a fence's info string to the
    // processor — so it is part of the body, not the info line.
    assert.match(
      found[0].body,
      new RegExp(`^//@ time=${ex.stopTime}\\b`, "m"),
      `${ex.name}: the block declares time=${ex.stopTime}`
    );
  }
});

test("every note has a plain-language explanation, not only mathematics", async () => {
  // A derivation proves the model is right; it does not teach what the model
  // does. Each note opens with a plain section so a reader can learn the point
  // without following any algebra, and then see the same thing proved.
  const { EXPLAIN } = await import(path.join(repoRoot, "showcase", "explain.mjs"));
  for (const ex of EXAMPLES) {
    const why = EXPLAIN[ex.name];
    assert.ok(why, `${ex.name}: has a plain-language explanation (run showcase/generate.mjs?)`);
    assert.ok(why.idea && why.idea.length > 80, `${ex.name}: states the idea in prose`);
    assert.ok(why.reading?.length >= 3, `${ex.name}: explains at least three lines of the model`);
    assert.ok(why.takeaway && why.takeaway.length > 80, `${ex.name}: draws a conclusion`);

    // And it must actually appear in the generated note.
    const rel = P.pathOf(ex.name);
    const text = fs.readFileSync(path.join(NOTES_DIR, rel), "utf8");
    assert.ok(text.includes("## What this shows"), `${ex.name}: the note carries it`);
    assert.ok(text.includes("### Reading the equations"), `${ex.name}: and explains the equations`);
  }
});

test("each note states the derivation and the agreement", () => {
  for (const ex of EXAMPLES) {
    const rel = P.pathOf(ex.name);
    const text = fs.readFileSync(path.join(NOTES_DIR, rel), "utf8");
    assert.ok(text.includes("## The physics"), `${ex.name}: has a derivation section`);
    assert.ok(/\$\$[\s\S]+?\$\$/.test(text), `${ex.name}: states at least one equation`);
    assert.ok(text.includes("## Does the simulation agree?"), `${ex.name}: states the agreement`);
    assert.ok(/Expected \(independent\)/.test(text), `${ex.name}: distinguishes expected from measured`);
  }
});

test("the notes are numbered and grouped exactly as the picker lists them", () => {
  // Asked for by a reader working through the examples: subfolders per domain, numbered
  // so the folder tree reads in the same order as the studio's Examples picker. The
  // picker groups by domain BEFORE it lists, so this is not the order of the flat
  // EXAMPLES array -- numbering that array put 16, 17 and 27 inside 01-Electrical.
  const numbers = P.ordered.map((ex) => P.numberOf(ex.name));
  assert.deepEqual(
    numbers,
    EXAMPLES.length === 30 ? [...Array(30)].map((_, i) => String(i + 1).padStart(2, "0")) : numbers,
    "the numbers run 01..30 in the picker's order, with no gaps and no repeats"
  );

  // One folder per domain, in the order the picker first meets them.
  const folders = [...new Set(P.ordered.map((ex) => P.folderOf(ex.name)))];
  assert.deepEqual(
    folders,
    P.domains.map((d, i) => `${String(i + 1).padStart(2, "0")}-${d.replace(/\s+/g, "-")}`),
    "folders are numbered in the order the picker meets each domain"
  );
  for (const folder of folders) {
    assert.doesNotMatch(folder, / /, "a folder name with a space breaks a Markdown link");
  }

  // Every note is inside the folder for its own domain, and each folder holds its own.
  for (const ex of P.ordered) {
    const folder = P.folderOf(ex.name);
    assert.ok(
      folder.slice(3) === P.domainOf(ex).replace(/\s+/g, "-"),
      `${ex.name} is in ${folder}, which is not its domain`
    );
    assert.ok(
      fs.existsSync(path.join(NOTES_DIR, P.pathOf(ex.name))),
      `${ex.name} is at ${P.pathOf(ex.name)}`
    );
  }

  // The index rows follow the same order as the folders.
  const index = fs.readFileSync(path.join(NOTES_DIR, "README.md"), "utf8");
  const rowOrder = [...index.matchAll(/^\| <span[^>]*>([^<]+)<\/span>/gm)].map((m) => m[1]);
  assert.deepEqual(rowOrder, P.domains, "the index lists the domains in the picker's order");
});
