/**
 * Embedding a model in a note from the command palette.
 *
 * The two things worth testing without a browser are the ones a person cannot
 * check by looking at the result: the TEXT of the block — because a directive
 * that says the wrong thing produces a block that runs for the wrong time, which
 * looks like a simulation fault rather than a directive fault — and the LIST of
 * what can be embedded, because a row that cannot be loaded produces nothing at
 * all. The picker's own behaviour is covered in `ui-render.test.mjs`, where there
 * is a DOM to render it in.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { repoRoot, testTmpDir } from "./helpers/build.mjs";

// The module imports `obsidian` for its dialog; stub it the way the embed's tests
// do, so the pure parts can be exercised in plain Node.
const staging = testTmpDir("mo-embed-insert-");
execFileSync(
  "npx",
  [
    "esbuild",
    "src/view/embed-insert.ts",
    "--bundle",
    "--format=esm",
    "--platform=node",
    "--external:obsidian",
    `--outdir=${staging}`,
    "--log-level=error",
  ],
  { cwd: repoRoot, stdio: "pipe" }
);
const pkgDir = path.join(staging, "node_modules", "obsidian");
fs.mkdirSync(pkgDir, { recursive: true });
fs.writeFileSync(
  path.join(pkgDir, "package.json"),
  JSON.stringify({ name: "obsidian", version: "0.0.0", type: "module", main: "index.js" })
);
fs.writeFileSync(
  path.join(pkgDir, "index.js"),
  [
    "export class Notice { constructor(m) { this.message = m; } }",
    "export class App {}",
    "export class Setting { constructor(el) { this.el = el; } setName() { return this; } setDesc() { return this; } addText() { return this; } addToggle() { return this; } }",
    "export class Modal { constructor(app) { this.app = app; this.contentEl = { empty() {}, createEl() {}, createDiv() {}, addClass() {} }; this.titleEl = { setText() {} }; } open() {} close() {} }",
  ].join("\n")
);
const {
  embedBlockText,
  insertEmbedBlock,
  buildEmbedCandidates,
  filterCandidates,
  EMBED_DEFAULTS,
  EMBED_DEFAULT_HEIGHT,
  EMBED_GROUPS,
} = await import(path.join(staging, "embed-insert.js"));

const SOURCE = 'model Demo "A demo"\n  Real x;\nend Demo;\n';

/* ------------------------------------------------------------------ */
/* The block text                                                     */
/* ------------------------------------------------------------------ */

test("the block carries the span it was made with", () => {
  // A block is a result a reader opens the note to see, so it has to run over the
  // span its model was written for. Writing it into the directive rather than
  // relying on the settings means a later change to the plugin's default cannot
  // silently re-scale a note written against a 3000-second thermal model.
  const text = embedBlockText(SOURCE, { ...EMBED_DEFAULTS, stopTime: 20 });
  assert.equal(text, "```modelica\n//@ time=20\n" + SOURCE.trimEnd() + "\n```\n".trimEnd());

  // A span that is not a whole number keeps its own digits and gains no noise.
  assert.match(embedBlockText(SOURCE, { ...EMBED_DEFAULTS, stopTime: 0.05 }), /^```modelica\n\/\/@ time=0\.05\n/);
  assert.match(embedBlockText(SOURCE, { ...EMBED_DEFAULTS, stopTime: 1 / 3 }), /time=0\.333333\n/);

  // Nothing to say when the span is not known: the block resolves it from the
  // model's own record, exactly as it does today.
  assert.match(embedBlockText(SOURCE, { ...EMBED_DEFAULTS, stopTime: 0 }), /^```modelica\nmodel Demo/);
});

test("the block states only what differs from a block's own defaults", () => {
  // A directive that restates the default is noise on a line a reader has to
  // read, so `height=320` and "open on the plot" are left out.
  const plain = embedBlockText(SOURCE, { ...EMBED_DEFAULTS, stopTime: 1, height: EMBED_DEFAULT_HEIGHT });
  assert.equal(plain, "```modelica\n//@ time=1\n" + SOURCE.trimEnd() + "\n```");

  const tall = embedBlockText(SOURCE, { ...EMBED_DEFAULTS, stopTime: 1, height: 420 });
  assert.match(tall, /^```modelica\n\/\/@ time=1 height=420\n/, "a chosen height is written");

  const diagram = embedBlockText(SOURCE, { ...EMBED_DEFAULTS, stopTime: 1, showPlot: false });
  assert.match(diagram, /^```modelica\n\/\/@ time=1 edit\n/, "and so is starting on the diagram");

  const both = embedBlockText(SOURCE, { ...EMBED_DEFAULTS, stopTime: 2, height: 500, showPlot: false });
  assert.match(both, /^```modelica\n\/\/@ time=2 height=500 edit\n/, "in a fixed order");
});

test("the block's body is the model, not a reformatted copy of it", () => {
  // The body is what will be parsed, so it is passed through as written — only
  // the trailing blank lines a source file carries are dropped, because they
  // would sit between the model and the closing fence.
  const indented = "model M\n  // a comment\n  Real x;\nend M;\n\n\n";
  const text = embedBlockText(indented, { ...EMBED_DEFAULTS, stopTime: 1 });
  assert.match(text, /\n  \/\/ a comment\n  Real x;\nend M;\n```$/, "indentation and comments survive");
  assert.doesNotMatch(text, /\n\n```$/, "and the trailing blank lines do not");
  assert.equal(text.split("```").length - 1, 2, "exactly one fenced block");
});

/* ------------------------------------------------------------------ */
/* Placing it                                                         */
/* ------------------------------------------------------------------ */

/** The editor surface `insertEmbedBlock` uses, recording what it was given. */
function fakeEditor(cursor, line = "") {
  return {
    replaced: null,
    getCursor: () => cursor,
    getLine: () => line,
    replaceSelection(t) {
      this.replaced = t;
    },
  };
}

test("a block is placed on lines of its own", () => {
  // A fence is only a fence when its backticks start a line, and whatever
  // followed the cursor must not end up glued to the closing backticks.
  const BLOCK = "```modelica\nmodel M\nend M;\n```";

  const midLine = fakeEditor({ line: 3, ch: 5 }, "some text here");
  insertEmbedBlock(midLine, BLOCK);
  assert.equal(midLine.replaced, "\n" + BLOCK + "\n", "a break before and after");

  const lineEnd = fakeEditor({ line: 3, ch: 14 }, "some text here");
  insertEmbedBlock(lineEnd, BLOCK);
  assert.equal(lineEnd.replaced, "\n" + BLOCK + "\n", "a break before it");

  const lineStart = fakeEditor({ line: 3, ch: 0 }, "some text here");
  insertEmbedBlock(lineStart, BLOCK);
  assert.equal(lineStart.replaced, BLOCK + "\n", "and none needed at the start of a line");
});

/* ------------------------------------------------------------------ */
/* What can be embedded                                               */
/* ------------------------------------------------------------------ */

const candidate = (label, group, detail, stopTime = 1) => ({
  label,
  group,
  detail,
  stopTime,
  load: () => `model ${label}\nend ${label};`,
});

test("the list offers what you have open, then the examples, then the vault", () => {
  const list = buildEmbedCandidates({
    current: { name: "Mine", detail: "from Modelica Studio", stopTime: 4, load: () => SOURCE },
    examples: [candidate("RLC", "Examples", "Electrical: series RLC step response", 0.05)],
    saved: [candidate("Tank", "In this vault", "Modelica/Tank.mo", 20)],
  });

  assert.deepEqual(
    list.map((c) => c.group),
    [EMBED_GROUPS[0], EMBED_GROUPS[1], EMBED_GROUPS[2]],
    "nearest first"
  );
  assert.equal(list[0].label, "Mine", "the open model is the first thing offered");
  assert.equal(list[0].stopTime, 4, "and carries its own span");
  assert.equal(new Set(list.map((c) => c.id)).size, list.length, "ids are distinct");

  // Every row must be loadable: a row that produces nothing is worse than absent.
  for (const c of list) {
    assert.match(c.load(), /^model /, `${c.label} loads something`);
  }

  // With nothing open in the Studio there is simply no first section.
  const withoutCurrent = buildEmbedCandidates({
    examples: [candidate("RLC", "Examples", "x", 0.05)],
    saved: [],
  });
  assert.deepEqual(withoutCurrent.map((c) => c.label), ["RLC"]);
});

test("the search ranks names first and still finds a model by its path", () => {
  const list = buildEmbedCandidates({
    examples: [
      candidate("Tank", "Examples", "Fluid: a tank draining", 20),
      candidate("RLC", "Examples", "Electrical: ringing", 0.05),
    ],
    saved: [candidate("Drain", "In this vault", "Modelica/tank-drain.mo", 20)],
  });

  // An empty box is not a filter: the whole list, in the order it was built.
  assert.deepEqual(
    filterCandidates(list, "").map((r) => r.candidate.label),
    ["Tank", "RLC", "Drain"],
    "everything, unfiltered"
  );

  const tank = filterCandidates(list, "tank");
  assert.equal(tank[0].candidate.label, "Tank", "the name that matches ranks first");
  assert.deepEqual(tank[0].positions, [0, 1, 2, 3], "with the matched characters marked");

  // A match on the path is found too, but reports no positions: they index the
  // path, and highlighting them in the label would light up the wrong letters.
  const byFolder = filterCandidates(list, "modelica");
  assert.deepEqual(byFolder.map((r) => r.candidate.label), ["Drain"], "found by its folder");
  assert.deepEqual(byFolder[0].positions, [], "a path match marks nothing in the name");
  const byFile = filterCandidates(list, "tank-drain");
  assert.equal(byFile[0].candidate.label, "Drain", "and by its file name");

  assert.deepEqual(filterCandidates(list, "nothinglikethis"), [], "no match, no rows");
  assert.equal(filterCandidates(list, "e", 1).length, 1, "the limit is respected");
});
