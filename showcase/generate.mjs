/**
 * Generate one note per built-in example.
 *
 * Each note carries the derivation, the runnable model in a `modelica` fence —
 * which the plugin renders as a live diagram with a result plot — and the
 * numbers the audit test checks. Opening the notes in Obsidian is therefore both
 * the documentation and the demonstration.
 *
 *   node showcase/generate.mjs [outputDir]
 */
import fs from "node:fs";
import path from "node:path";
import { buildLibs } from "../test/helpers/build.mjs";
import { NOTES } from "./math.mjs";
import { EXPLAIN } from "./explain.mjs";

const { EXAMPLES } = await import(
  path.join(buildLibs("showcase-ex", ["src/modelica/examples.ts"]), "examples.js")
);

const outDir = process.argv[2] ?? path.join(import.meta.dirname, "notes");
fs.mkdirSync(outDir, { recursive: true });

const slug = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** A markdown table of expected-versus-measured rows. */
function table(rows) {
  const lines = ["| Quantity | Expected (independent) | Simulated |", "|---|---|---|"];
  for (const [q, e, m] of rows) lines.push(`| ${q} | \`${e}\` | \`${m}\` |`);
  return lines.join("\n");
}

// The introduction. Its live example is the Electrical model, written out from
// the same EXAMPLES entry the notes use, so the block a reader experiments with
// is the model this note describes.
{
  const live = EXAMPLES.find((e) => e.name === "Electrical");
  if (!live) throw new Error("the Electrical example is missing");
  const intro = `# Modelica in ten minutes

> A short tour of what Modelica is, how the plugin runs it, and how to read the
> worked examples that follow.

**Next:** [Electrical — RC step response](electrical.md) · **All examples:** [index](README.md)

---

${fs.readFileSync(path.join(import.meta.dirname, "intro-body.md"), "utf8").trim()}

---

## Try the model this note keeps referring to

\`${live.source.trim().split("\n").length}\` lines, no ordering instructions anywhere in it — and
it produces an exponential curve. Press **Simulate** beneath the diagram.

\`\`\`modelica
//@ time=${live.stopTime}
${live.source.trim()}
\`\`\`

The derivation and the checked numbers for it are in
**[Electrical — RC step response](electrical.md)**.
`;
  fs.writeFileSync(path.join(outDir, "00-modelica-intro.md"), intro);
}

// Why the notes exist: a worked demonstration of using the plugin to learn a
// subject, using aerospace as the example.
{
  const learning = `# Learning a subject with a simulator

> Why these examples exist, and what a simulation gives you that a textbook
> cannot — worked through with two aerospace models.

**New to Modelica?** Read [Modelica in ten minutes](00-modelica-intro.md) first.
**All examples:** [index](README.md)

---

${fs.readFileSync(path.join(import.meta.dirname, "learning-body.md"), "utf8").trim()}
`;
  fs.writeFileSync(path.join(outDir, "01-learning-with-a-simulator.md"), learning);
}

let count = 0;
for (const ex of EXAMPLES) {
  const note = NOTES[ex.name];
  if (!note) throw new Error(`no derivation written for ${ex.name}`);
  const why = EXPLAIN[ex.name];
  if (!why) throw new Error(`no plain-language explanation written for ${ex.name}`);

  // The explanation comes before the mathematics: a reader should be able to
  // learn what the model does without following any algebra, and then see the
  // same thing proved. The section is omitted only if an example has neither.
  const plain = [
    "---",
    "",
    "## What this shows",
    "",
    why.idea,
    ...(why.schematic ? ["", why.schematic] : []),
    "",
    "### Reading the equations",
    "",
    ...why.reading.map(([code, text]) => `- ${code} — ${text}`),
    "",
    "### The point",
    "",
    why.takeaway,
    "",
  ].join("\n");

  const body = `# ${note.title}

> ${ex.description}

**Domain:** ${note.domain} · **Simulated span:** ${ex.stopTime} s · **Example:** \`${ex.name}\`

*New to Modelica? Read [Modelica in ten minutes](00-modelica-intro.md) first.*

---

## The model

The block below is live. It renders as a diagram, and pressing **Simulate**
runs it through OpenModelica and plots the result — the same model this note
derives an answer for. Its first line is a directive giving the time span that
model is meant to run over, so the block does not depend on whatever span the
Studio last used. (Obsidian does not pass a fence's info string to a code-block
processor, so the option has to live inside the block.)

\`\`\`modelica
//@ time=${ex.stopTime}
${ex.source.trim()}
\`\`\`

${plain}

---

## The physics

${note.equations.map((e) => `$$${e}$$`).join("\n\n")}

${note.insight}

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by \`test/audit.test.mjs\` on every test run, so
a stale number here fails the suite rather than misleading a reader.

${table(note.checks)}

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

\`\`\`bash
node --test test/audit.test.mjs
\`\`\`
`;

  fs.writeFileSync(path.join(outDir, `${slug(ex.name)}.md`), body);
  count++;
}

// An index so the set can be read in order.
const byDomain = new Map();
for (const ex of EXAMPLES) {
  const d = NOTES[ex.name].domain;
  if (!byDomain.has(d)) byDomain.set(d, []);
  byDomain.get(d).push(ex);
}
let index = `# Modelica Studio — worked examples

Each note derives the physics of one built-in example, embeds the model as a
live block, and shows the numbers an independent calculation predicts beside
the numbers the simulation produces.

The point is not that the plots look plausible. It is that every example has a
**closed-form answer**, computed without running the simulation, and the two
agree to the precision the solver offers. Where they could not agree — a
chaotic double pendulum, a correlation-limited pipe friction — the note says so
and checks an invariant instead.

**Start here:** [Modelica in ten minutes](00-modelica-intro.md) — what the language
is, how a model becomes a result, and how to read the notes.

**Then:** [Learning a subject with a simulator](01-learning-with-a-simulator.md) —
a worked demonstration of using this to learn something new, with two aerospace
models.

| Domain | Examples |
|---|---|
`;
for (const [domain, list] of byDomain) {
  const links = list.map((e) => `[${e.name}](${slug(e.name)}.md)`).join(", ");
  index += `| ${domain} | ${links} |\n`;
}
index += `
---

## Block options

A block's first line may be a directive. The time span matters most: without one
a block inherits whatever span the Studio last used, so a 1 s RC circuit and a
3000 s thermal model would share a window and one of them would plot a straight
line.

\`\`\`modelica
//@ time=20 height=400
model T
end T;
\`\`\`

\`time\` (or \`t\`) sets the span in seconds, \`height\` the canvas height, and
\`result\`/\`edit\` choose whether the plot starts open. The directive is read from
inside the block because Obsidian does not pass a fence's info string to a
code-block processor — \`\`\`modelica time=20 reaches the plugin as just
\`modelica\`.

---

## How the verification works

\`test/audit.test.mjs\` runs every example and asserts 42 numeric checks against
values derived independently of the plugin. Three of those expectations were
themselves wrong when first written, and were corrected only after the
discrepancy was traced to the expectation rather than the simulation — a series
RLC that rings despite ζ > 1, a thermal time constant computed with the wrong
capacitance, and a two-mass stretch that is not \`F/c\`. Those corrections are
recorded in the test file so the same rule is not misapplied again.
`;
fs.writeFileSync(path.join(outDir, "README.md"), index);

console.log(`wrote ${count} notes + index to ${outDir}`);
