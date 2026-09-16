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
const { EXAMPLES } = await import(
  path.join(buildLibs("showcase-ex", ["src/modelica/examples.ts"]), "examples.js")
);

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
  const files = fs
    .readdirSync(NOTES_DIR)
    .filter((f) => f.endsWith(".md") && f !== "README.md" && !NON_EXAMPLE_NOTES.includes(f));
  assert.equal(
    files.length,
    EXAMPLES.length,
    `one note per example: ${files.length} notes for ${EXAMPLES.length} examples`
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
  assert.match(intro, /\]\(electrical\.md\)/, "it links to an example");
  assert.match(intro, /\]\(README\.md\)/, "and to the index");

  // Every example links back, so a reader who lands anywhere can find it.
  for (const ex of EXAMPLES) {
    const slug = ex.name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    const text = fs.readFileSync(path.join(NOTES_DIR, `${slug}.md`), "utf8");
    assert.match(
      text,
      /\]\(00-modelica-intro\.md\)/,
      `${ex.name} links back to the introduction`
    );
  }

  // The index lists it too.
  const index = fs.readFileSync(path.join(NOTES_DIR, "README.md"), "utf8");
  assert.match(index, /\]\(00-modelica-intro\.md\)/, "the index links to the introduction");
});

test("each note embeds the example it documents, unchanged", () => {
  for (const ex of EXAMPLES) {
    const slug = ex.name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    const file = path.join(NOTES_DIR, `${slug}.md`);
    assert.ok(fs.existsSync(file), `${ex.name}: note ${slug}.md exists`);
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
    const slug = ex.name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    const text = fs.readFileSync(path.join(NOTES_DIR, `${slug}.md`), "utf8");
    assert.ok(text.includes("## What this shows"), `${ex.name}: the note carries it`);
    assert.ok(text.includes("### Reading the equations"), `${ex.name}: and explains the equations`);
  }
});

test("each note states the derivation and the agreement", () => {
  for (const ex of EXAMPLES) {
    const slug = ex.name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    const text = fs.readFileSync(path.join(NOTES_DIR, `${slug}.md`), "utf8");
    assert.ok(text.includes("## The physics"), `${ex.name}: has a derivation section`);
    assert.ok(/\$\$[\s\S]+?\$\$/.test(text), `${ex.name}: states at least one equation`);
    assert.ok(text.includes("## Does the simulation agree?"), `${ex.name}: states the agreement`);
    assert.ok(/Expected \(independent\)/.test(text), `${ex.name}: distinguishes expected from measured`);
  }
});
