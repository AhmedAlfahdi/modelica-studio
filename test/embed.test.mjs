/**
 * Inline embedded diagram tests.
 *
 * The embed edits the user's note, so the two things tested here are the two
 * that can damage it: how a block's options are read, and how its body is
 * spliced back into the file.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildLibs, repoRoot, testTmpDir } from "./helpers/build.mjs";

// The embed imports `obsidian`, which has no Node equivalent; stub it.
const staging = testTmpDir("mo-embed-");
execFileSync(
  "npx",
  [
    "esbuild",
    "src/view/embed.ts",
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
  "export class Notice { constructor(m) { this.message = m; } }\nexport class App {}\nexport class TFile {}\n"
);
const { parseEmbedOptions, replaceFencedBlock } = await import(path.join(staging, "embed.js"));
const { parseDirective } = await import(path.join(staging, "embed.js"));
// The directive formatter lives with the language helpers, which have no
// Obsidian dependency.
const langMod = await import(
  path.join(buildLibs("embed-lang", ["src/view/modelica-lang.ts"]), "modelica-lang.js")
);

/* ------------------------------------------------------------------ */

test("block options are read from the info line", () => {
  // `showPlot` controls the PLOT only: the diagram is always rendered, because
  // an embedded diagram with its diagram hidden is not worth embedding.
  // A block in a note is a result preview: it simulates on open and shows the
  // plot, with the editing surface one button away.
  assert.deepEqual(parseEmbedOptions("modelica"), {
    showPlot: true,
    height: 320,
    autoSimulate: true,
    stopTime: 0,
  });
  for (const word of ["result", "plot", "both"]) {
    assert.equal(parseEmbedOptions(`modelica ${word}`).showPlot, true, word);
  }
  for (const word of ["edit", "diagram"]) {
    assert.equal(parseEmbedOptions(`modelica ${word}`).showPlot, false, word);
  }
  assert.equal(parseEmbedOptions("modelica auto").autoSimulate, true);
  assert.equal(parseEmbedOptions("modelica noauto").autoSimulate, false);
  // A block carries the span its own model is meant to run over.
  assert.equal(parseEmbedOptions("modelica time=20").stopTime, 20);
  assert.equal(parseEmbedOptions("modelica t=0.05").stopTime, 0.05);
  assert.equal(parseEmbedOptions("modelica time=-1").stopTime, 0, "a bad span falls back to the setting");
  assert.equal(parseEmbedOptions("modelica manual").autoSimulate, false);
  assert.equal(parseEmbedOptions("modelica result height=400").height, 400);
});

test("an absurd height is ignored rather than obeyed", () => {
  // The fence is user input, and a wrong value here would make the note
  // unusable — a zero-height canvas cannot be recovered from by scrolling.
  assert.equal(parseEmbedOptions("modelica height=0").height, 320);
  assert.equal(parseEmbedOptions("modelica height=-40").height, 320);
  assert.equal(parseEmbedOptions("modelica height=99999").height, 320);
  assert.equal(parseEmbedOptions("modelica height=abc").height, 320);
});

test("unknown options are ignored, not guessed at", () => {
  const o = parseEmbedOptions("modelica wibble height=500 nonsense=1");
  assert.equal(o.showPlot, true);
  assert.equal(o.height, 500);
});

test("the block shows its result and keeps the diagram one button away", async () => {
  // A block in a note is a result preview. The editing surface belongs to the
  // main view, so the diagram is collapsed while the plot is shown, and a button
  // opens the model there.
  const source = fs.readFileSync(path.join(repoRoot, "src/view/embed.ts"), "utf8");

  assert.match(source, /Open diagram/, "the block offers a link to the diagram");

  // The pane holds either the plot or the diagram, so the toggle names the view
  // it switches TO, not the one that goes away: "Hide plot" also brought the
  // diagram back, which a button labelled "hide" does not lead one to expect.
  assert.match(
    source,
    /visible \? "Switch to diagram" : "Switch to plot"/,
    "the toggle names the view it switches to"
  );
  // And it is set while the block is built, not only on the click path: doing it
  // only there left the button blank until it had been pressed once.
  const apply = /private applyPlotVisibility\(\): void \{[\s\S]*?\n  \}/.exec(source);
  assert.ok(apply, "applyPlotVisibility is defined");
  assert.match(apply[0], /plotButton\) this\.plotButton\.setText/, "it sets the label");
  assert.doesNotMatch(
    /private setPlotVisible\([\s\S]*?\n  \}/.exec(source)[0],
    /setText/,
    "and the click path does not, so the two cannot disagree"
  );
  // Matched as a label assignment, not as any occurrence: the code explains why
  // the old wording was wrong, and that comment legitimately quotes it.
  assert.doesNotMatch(
    source,
    /setText\([^)]*"Hide plot"/,
    "the misleading label is no longer set on the button"
  );
  // The tooltip carries the full sentence, since the label stays short.
  assert.match(source, /setAttr\("title", hint\)/, "the tooltip states the action");
  assert.match(source, /openDiagram\?\.\(this\.source\)/, "and passes the model to it");

  // The plot is the default view, and the block simulates without being asked.
  const defaults = /const opts: EmbedOptions = \{([^}]*)\}/.exec(source);
  assert.ok(defaults, "defaults are declared");
  assert.match(defaults[1], /showPlot: true/, "the plot is shown by default");
  assert.match(defaults[1], /autoSimulate: true/, "and simulated on open");

  // The diagram is taken out of the layout while the plot is up, but only by
  // position and visibility. `display: none` or `height: 0` would measure 0x0,
  // leaving the editor unable to size itself for when the user switches back.
  assert.match(source, /canvas\.style\.visibility = this\.opts\.showPlot/, "hidden, not removed");
  assert.match(source, /canvas\.style\.position = this\.opts\.showPlot \? "absolute"/, "and out of flow");
  assert.doesNotMatch(
    source,
    /canvas\.style\.display = this\.opts\.showPlot/,
    "never display:none, which would measure nothing"
  );
  assert.doesNotMatch(
    source,
    /canvas\.style\.height = this\.opts\.showPlot \? "0"/,
    "and never a zero height"
  );
});

/* ------------------------------------------------------------------ */

test("writing a block back replaces only its body", () => {
  // The note is the user's document; only the lines between the fences may
  // change. Getting this wrong corrupts their file.
  const note = [
    "# Title",
    "",
    "```modelica",
    "model A",
    "end A;",
    "```",
    "",
    "Text after.",
  ].join("\n");

  const out = replaceFencedBlock(note, 2, 5, "model B\nend B;");
  assert.equal(
    out,
    ["# Title", "", "```modelica", "model B", "end B;", "```", "", "Text after."].join("\n"),
    "only the block body is replaced"
  );
});

test("a block can grow and shrink", () => {
  const note = ["```modelica", "model A", "end A;", "```", "tail"].join("\n");

  const longer = replaceFencedBlock(note, 0, 3, "model B\n  Real x;\nend B;");
  assert.equal(
    longer,
    ["```modelica", "model B", "  Real x;", "end B;", "```", "tail"].join("\n")
  );

  const shorter = replaceFencedBlock(note, 0, 3, "model C");
  assert.equal(shorter, ["```modelica", "model C", "```", "tail"].join("\n"));
});

test("an unusable line range leaves the note untouched", () => {
  // A bad report from the host must never delete content: returning the text
  // unchanged is always safe, and the alternative is losing the user's work.
  const note = ["```modelica", "model A", "end A;", "```"].join("\n");
  assert.equal(replaceFencedBlock(note, -1, 3, "x"), note);
  assert.equal(replaceFencedBlock(note, 3, 0, "x"), note);
  assert.equal(replaceFencedBlock(note, 0, 999, "x"), note, "an out-of-range end is refused");
});

test("the first of several blocks is replaced, not all of them", () => {
  // A note can hold many diagrams; an edit to one must not touch the others.
  const note = [
    "```modelica",
    "model A",
    "```",
    "middle",
    "```modelica",
    "model B",
    "```",
  ].join("\n");

  const out = replaceFencedBlock(note, 0, 2, "model A2");
  assert.equal(
    out,
    ["```modelica", "model A2", "```", "middle", "```modelica", "model B", "```"].join("\n")
  );

  const second = replaceFencedBlock(note, 4, 6, "model B2");
  assert.equal(
    second,
    ["```modelica", "model A", "```", "middle", "```modelica", "model B2", "```"].join("\n")
  );
});

test("a block follows the plot configuration the studio shares", () => {
  // The studio and the blocks in a note are two views of one result. Before
  // this they each kept their own traces and range, so adjusting the scale in
  // the studio changed nothing in the note.
  const embed = fs.readFileSync(path.join(repoRoot, "src/view/embed.ts"), "utf8");
  const studio = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  const main = fs.readFileSync(path.join(repoRoot, "src/main.ts"), "utf8");

  // The embed reads the shared configuration when it seeds and when told to.
  assert.match(embed, /applyChart\(\): void/, "the block can adopt the shared configuration");
  assert.match(
    embed,
    /this\.host\.chart\?\.\(this\.modelName\(\)/,
    "and reads the entry for its own model"
  );
  assert.match(embed, /showPlot/, "it still owns which pane it shows");

  // The x and y ranges come from it too, not just the traces.
  assert.match(embed, /xMin: this\.chartView\.xMin \?\? shared\?\.xMin/, "the x range is shared");
  assert.match(embed, /yMin: this\.chartView\.yMin \?\? shared\?\.yMin/, "and the y range");

  // The studio is the source of truth and pushes on every change.
  assert.match(studio, /private publishChart\(\): void/, "the studio publishes its configuration");
  const pushes = [...studio.matchAll(/this\.publishChart\(\)/g)].length;
  assert.ok(pushes >= 5, `every change publishes, found ${pushes} call sites`);

  // And the plugin fans it out to the live blocks.
  assert.match(main, /for \(const embed of this\.embeds\.values\(\)\) embed\.applyChart\(\)/);
});

test("the block runs with the studio's parameter values, and re-runs on a change", () => {
  // Sharing the traces alone left the block showing the right variable names for
  // the WRONG values: the parameters were never shared, so changing one in the
  // studio produced a different curve there and nothing here.
  const embed = fs.readFileSync(path.join(repoRoot, "src/view/embed.ts"), "utf8");
  const studio = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");

  // Substrings, not patterns: the expressions are long, and every bracket in a
  // regex is one more chance to assert something other than what was meant.
  assert.ok(
    studio.includes("parameters: collectParameters(this.plugin.model)"),
    "the studio publishes its parameter values"
  );
  assert.ok(
    embed.includes(
      "const effective = { ...collectParameters(model), ...(this.host.chart?.(this.modelName() ?? \"\")?.parameters ?? {}) }"
    ),
    "the block runs with the shared values, which win over its own reading"
  );
  assert.ok(embed.includes("this.lastParameters = effective"), "and records what it ran with");
  assert.ok(
    embed.includes("if (this.parametersDiffer(chart.parameters)) void this.simulate();"),
    "a changed value means running again, since it cannot be painted on"
  );
});

test("each model's plot configuration is stored separately", () => {
  // The studio shows ONE model while a note may hold blocks for several. A
  // single shared object meant configuring the model in the studio overwrote
  // every other block's traces, so each was left filtering a result whose
  // variable names it did not contain — and drew nothing.
  const settings = fs.readFileSync(path.join(repoRoot, "src/settings.ts"), "utf8");
  const studio = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  const embed = fs.readFileSync(path.join(repoRoot, "src/view/embed.ts"), "utf8");

  assert.ok(settings.includes("charts: Record<string, ChartState>"), "the state is keyed by model");
  assert.ok(
    studio.includes("this.plugin.settings.charts[this.plugin.model.name] = {"),
    "the studio writes only its own model's entry"
  );
  assert.ok(
    embed.includes('this.host.chart?.(this.modelName() ?? "")'),
    "a block reads the entry for its own model"
  );
  // Nothing may still read a single global entry.
  assert.ok(!/settings\.chart\b(?!s)/.test(studio), "no code reads a single global chart");
  assert.ok(!/settings\.chart\b(?!s)/.test(embed), "nor in the block");
});

test("options are read from a directive inside the block", () => {
  // Obsidian calls a code-block processor with three arguments and never passes
  // the fence's info string: registered as language "modelica", ` ```modelica
  // time=20 ` reaches the plugin as "modelica" with the option already dropped.
  // Verified at runtime (argc=3, no alt attribute). Options therefore live in a
  // directive comment inside the block, where they survive.
  const src = fs.readFileSync(path.join(repoRoot, "src/view/embed.ts"), "utf8");
  assert.ok(src.includes("export function parseDirective"), "the block parses its own directive");
  const main = fs.readFileSync(path.join(repoRoot, "src/main.ts"), "utf8");
  assert.ok(
    /registerMarkdownCodeBlockProcessor\(language, \(source, el, ctx\)/.test(main),
    "the processor takes the three arguments Obsidian actually passes"
  );
});

test("a directive survives being written back to the note", () => {
  // The block's `//@` line is parsed OUT of the source, so writing back only the
  // re-serialized Modelica DROPPED it. Editing a block in the studio silently
  // removed the line that set its simulation span, and the block then inherited
  // whatever the studio last used.
  const { formatDirective, withDirective } = langMod;

  assert.equal(formatDirective({ stopTime: 5 }), "//@ time=5");
  assert.equal(formatDirective({ stopTime: 5, height: 300 }), "//@ time=5 height=300");
  assert.equal(formatDirective({ stopTime: 2.5, showPlot: true }), "//@ time=2.5 result");
  assert.equal(formatDirective({ showPlot: false }), "//@ edit");
  assert.equal(formatDirective({ stopTime: 4, autoSimulate: false }), "//@ time=4 manual");
  // Nothing set means no line at all, not an empty marker.
  assert.equal(formatDirective({}), "");

  const body = 'model M "x"\n  Real y;\nend M;';
  const round = withDirective(body, { stopTime: 5 });
  assert.equal(round, `//@ time=5\n${body}`, "the directive goes back on the first line");
  // And the result parses back to the same body and span, which is the property
  // that matters: a note must survive being read and written repeatedly.
  const parsed = parseDirective(round);
  assert.equal(parsed.body, body, "the body is unchanged");
  assert.equal(parsed.opts.stopTime, 5, "and the span is still declared");
});

test("a body with no directive is written back with none", () => {
  const { withDirective } = langMod;
  const body = "model M\nend M;";
  assert.equal(withDirective(body, {}), body, "no directive is invented");
  assert.equal(withDirective(body, { stopTime: 0 }), body, "and zero is not a span");
});

test("a fractional span is written without floating-point noise", () => {
  const { formatDirective, withDirective } = langMod;
  // Heights and spans go through arithmetic, so `2.5000000000000004` reaches
  // here easily and would be written into the user's note.
  assert.equal(formatDirective({ stopTime: 2.5000000000000004 }), "//@ time=2.5");
  assert.equal(withDirective("model M\nend M;", { height: 300.6 }), "//@ height=301\nmodel M\nend M;");
});

test("a block keeps its span through a full read/write cycle", async () => {
  // The write-back dropped the directive entirely: `persist` handed the note
  // `serializeDiagram(model)` and the options were never re-attached, so the
  // first studio edit deleted the line and the block silently inherited the
  // studio's span. This walks the whole cycle, because the directive parsing and
  // the file replacement each work on their own — it was the join that failed.
  const { withDirective } = langMod;

  const note = [
    "# A note",
    "",
    "```modelica",
    "//@ time=6",
    'model FluidReservoir "Water draining"',
    "  inner Modelica.Fluid.System system;",
    "equation",
    "end FluidReservoir;",
    "```",
    "",
  ].join("\n");

  // 1. Read: the block declares its own span.
  const body = /```modelica\n([\s\S]*?)```/.exec(note)[1];
  const read = parseDirective(body);
  assert.equal(read.opts.stopTime, 6, "the span is read from the block");

  // 2. The studio edits the model and persists. `persist` writes the directive
  //    back onto the serialized source.
  const reserialized = read.body.replace("height=1", "height=2");
  const written = withDirective(reserialized, { stopTime: read.opts.stopTime });

  // 3. Write back into the note, using the same replacement the plugin uses.
  const updated = replaceFencedBlock(note, 2, 8, written);
  assert.match(updated, /^```modelica\n\/\/@ time=6\n/m, `the directive is still there:\n${updated}`);

  // 4. And it reads the same again on the next open, so a note survives being
  //    written and read repeatedly rather than eroding on each edit.
  const again = parseDirective(/```modelica\n([\s\S]*?)```/.exec(updated)[1]);
  assert.equal(again.opts.stopTime, 6, "the span survives the round trip");
  assert.ok(!again.body.includes("//@"), "and the directive is not left inside the Modelica");
  assert.match(again.body, /^model FluidReservoir/, "the model starts the block");
});
