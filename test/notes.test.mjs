/**
 * The worked examples are documents, and a document can be wrong in ways no compiler
 * notices: a formula that does not render, or a plot that traces the wrong thing.
 *
 * These checks are about the NOTES — the mathematics inside them, and whether each one
 * still describes the model it ships with. They are cheap, and they catch a class of
 * damage that reached the repository once already: the notes were generated from
 * strings where `\f`, `\v`, `\t` and `\r` became control characters and where a
 * backslash before a macro name vanished, so `\frac{\rho v^2}{2}` shipped as
 * `rac{<newline>ho v^2}{2}` — which Obsidian renders as literal text.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildLibs, repoRoot } from "./helpers/build.mjs";

const LIB = buildLibs("notes-lib", ["src/modelica/parser.ts", "src/modelica/examples.ts", "src/modelica/types.ts"]);
const { parseModelica } = await import(path.join(LIB, "parser.js"));
const { EXAMPLES } = await import(path.join(LIB, "examples.js"));

const NOTES_DIR = path.join(repoRoot, "examples", "vault");
const CACHE = new Map();
function notes() {
  if (CACHE.size === 0) {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".md")) CACHE.set(full, fs.readFileSync(full, "utf8"));
      }
    };
    walk(NOTES_DIR);
  }
  return [...CACHE].map(([file, text]) => ({ file: path.relative(NOTES_DIR, file), text }));
}

/** Every `$…$` and `$$…$$` span in a note, with its line number. */
function mathSpans(text) {
  const out = [];
  const re = /\$\$[\s\S]*?\$\$|\$[^$\n]*?\$/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ body: m[0], line: text.slice(0, m.index).split("\n").length });
  }
  return out;
}

/**
 * Macro names that are never legitimate without their backslash inside maths.
 *
 * `max`, `min`, `k`, `Re` and single letters are deliberately absent: `c_{l,max}` and
 * `e^{k-1}` are ordinary LaTeX that happens to contain them, and a check that flagged
 * those would be turned off within a week.
 */
const MACROS = [
  "sqrt", "frac", "ddot", "dot", "omega", "zeta", "theta", "varphi", "phi", "Delta",
  "infty", "cdot", "times", "approx", "leqslant", "geqslant", "left", "right", "qquad",
  "quad", "partial", "arctan", "epsilon", "lambda", "sigma", "Longrightarrow",
  "Rightarrow", "rho", "tau", "alpha", "beta", "gamma", "psi", "sum", "int",
];

test("the notes' mathematics is LaTeX that Obsidian can render", () => {
  const broken = [];
  for (const { file, text } of notes()) {
    for (const { body, line } of mathSpans(text)) {
      // 1. Control characters. These are what a stripped `\f`, `\v` or `\t` becomes,
      //    and no legitimate formula contains one.
      const control = body.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
      if (control) {
        broken.push(`${file}:${line}: control character 0x${control[0].charCodeAt(0).toString(16)} in ${JSON.stringify(body.slice(0, 50))}`);
      }
      // 2. A macro whose backslash was eaten.
      for (const macro of MACROS) {
        const bare = new RegExp(`(?<!\\\\)(?<![A-Za-z])${macro}(?![A-Za-z])`);
        if (bare.test(body)) {
          broken.push(`${file}:${line}: \\${macro} written without its backslash in ${JSON.stringify(body.slice(0, 50))}`);
        }
      }
      // 3. A macro name glued to the letter before it, which is how `Re\sqrt{f}` became
      //    `Resqrt{f}`: still readable to a human, still literal text to MathJax.
      for (const macro of ["sqrt", "frac"]) {
        const glued = new RegExp(`[A-Za-z0-9]${macro}\\{`);
        if (glued.test(body)) {
          broken.push(`${file}:${line}: ${macro}{ glued to the previous character in ${JSON.stringify(body.slice(0, 50))}`);
        }
      }
    }
    // 4. Dollars must pair up. An odd count is an unterminated span, which swallows the
    //    rest of the note into a formula.
    const dollars = (text.match(/\$\$/g) ?? []).length;
    if (dollars % 2 !== 0) broken.push(`${file}: ${dollars} "$$" markers -- one is unclosed`);
  }
  assert.deepEqual(broken, [], `${broken.length} pieces of mathematics would not render`);
});

test("every worked example still carries a live block for its own model", () => {
  // A note is the front page of its model: the block in it is what runs. If the block
  // names a different class than the note says it is about, or the directive's span
  // disagrees with the span the note claims, the reader sees one thing and runs another.
  const wrong = [];
  for (const { file, text } of notes()) {
    const named = /^\*\*Domain:\*\*.*?\*\*Example:\*\*\s*`([A-Za-z0-9_.]+)`/m.exec(text)?.[1];
    if (!named) continue; // the intro and index notes are not about one model
    const block = /```modelica\n([\s\S]*?)```/.exec(text)?.[1];
    if (!block) {
      wrong.push(`${file}: names ${named} but has no modelica block`);
      continue;
    }
    const declared = new RegExp(`\\b(model|block|class|package)\\s+${named}\\b`).test(block);
    if (!declared) {
      const actual = /\b(?:model|block|class)\s+([A-Za-z0-9_]+)/.exec(block)?.[1] ?? "?";
      wrong.push(`${file}: the block defines ${actual}, the note says it is about ${named}`);
    }
    const blockTime = /\/\/@[^\n]*\btime=([0-9.]+)/.exec(block)?.[1];
    const claimed = /\*\*Simulated span:\*\*\s*([0-9.]+)\s*s/.exec(text)?.[1];
    if (blockTime && claimed && blockTime !== claimed) {
      wrong.push(`${file}: runs for ${blockTime} s, the header says ${claimed} s`);
    }
    if (!blockTime) wrong.push(`${file}: the block has no //@ time= directive`);
  }
  assert.deepEqual(wrong, [], `${wrong.length} notes disagree with their own block`);
});

test("every example plots quantities its own model has", () => {
  // The default traces are what a reader sees first, and what an embedded block opens
  // with — so they have to be the quantities the example is about, and they have to
  // exist. `MassSpringDamper` traced `mass1.s` and `mass1.v` for a while: real
  // variables, and they missed the entire point of a model whose subject is the gap
  // between two free masses, which settles at F*m2/(c*(m1+m2)) rather than at F/c.
  const wrong = [];
  for (const example of EXAMPLES) {
    const parsed = parseModelica(example.source)[0];
    if (!parsed) {
      wrong.push(`${example.name}: its source does not parse`);
      continue;
    }
    const instances = new Set(parsed.components.map((c) => c.name));
    for (const trace of example.series) {
      const prefix = trace.split(".")[0];
      if (!instances.has(prefix)) {
        wrong.push(`${example.name}: traces "${trace}" but no component is named "${prefix}" (has: ${[...instances].join(", ")})`);
      }
    }
    if (example.series.length < 2) {
      wrong.push(`${example.name}: ${example.series.length} default trace -- a plot of one line answers nothing`);
    }
    // Whether the traces are the RIGHT quantities is a judgement, not a rule: a
    // voltage and its current, a position and its velocity, a flow and its pressure
    // drop are all a single component's pair and all correct. That judgement was made
    // by hand across the thirty examples and only one was wrong.
  }
  assert.deepEqual(wrong, [], `${wrong.length} examples trace something that is not there`);
});


test("a note's block is the example's own source, with only the directive added", () => {
  // The note's block is a COPY of the example the plugin ships, and a copy drifts: change
  // a placement in `src/modelica/examples.ts` and the note keeps showing the old diagram,
  // silently. Comparing them means a model change fails here and names the notes to update.
  const byName = new Map(EXAMPLES.map((e) => [e.name, e]));
  const drift = [];
  for (const { file, text } of notes()) {
    const named = /^\*\*Domain:\*\*.*?\*\*Example:\*\*\s*`([A-Za-z0-9_.]+)`/m.exec(text)?.[1];
    const example = named ? byName.get(named) : undefined;
    if (!example) continue;
    const block = /```modelica\n([\s\S]*?)```/.exec(text)?.[1];
    if (!block) continue;
    const withoutDirectives = block
      .split("\n")
      .filter((line) => !line.trim().startsWith("//@"))
      .join("\n")
      .trim();
    if (withoutDirectives !== example.source.trim()) {
      drift.push(`${file}: differs from ${named} in src/modelica/examples.ts`);
    }
  }
  assert.deepEqual(drift, [], `${drift.length} note blocks have drifted from their example`);
});

test("the mathematics SOURCE is escaped for JavaScript", async () => {
  // The notes are generated from `showcase/math.mjs`, and a formula written there with a
  // single backslash is eaten by JavaScript before it is ever a string: `"\f"` is a form
  // feed, `"\d"` is a `d`. Thirty notes shipped with `rac{<newline>ho v^2}{2}` that way,
  // and checking the OUTPUT alone would only have caught it after a regeneration. This
  // looks at the source, where the mistake is made.
  const { NOTES } = await import(path.join(repoRoot, "showcase", "math.mjs"));
  const MACROS = ["sqrt", "frac", "ddot", "dot", "omega", "zeta", "theta", "varphi", "Delta",
    "infty", "cdot", "left", "right", "qquad", "arctan", "epsilon", "rho", "tau", "pi", "sin", "cos", "log"];
  const bad = [];
  for (const [name, note] of Object.entries(NOTES)) {
    // Equations only: an insight or a check label is prose, and may legitimately contain
    // a word like "sin" or a formula written for a human reader.
    for (const equation of note.equations ?? []) {
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(equation)) {
        bad.push(`${name}: a control character in ${JSON.stringify(equation.slice(0, 40))} -- a backslash was eaten`);
      }
      for (const macro of MACROS) {
        if (new RegExp(`(?<!\\\\)(?<![A-Za-z])${macro}(?![A-Za-z])`).test(equation)) {
          bad.push(`${name}: \\${macro} written with one backslash in ${JSON.stringify(equation.slice(0, 40))}`);
        }
      }
    }
  }
  assert.deepEqual(bad, [], `${bad.length} formulas are escaped for the wrong language`);
});

test("the two copies of the notes are the same notes", () => {
  // `showcase/notes/` is what the generator writes and what the README links to;
  // `examples/vault/showcase/` is the same set inside the try-it-now vault. They are
  // generated from one source and must stay identical: when they drifted, one tree had
  // the repaired mathematics and the other still had `rac{<newline>ho v^2}{2}`.
  const a = path.join(repoRoot, "showcase", "notes");
  const b = path.join(repoRoot, "examples", "vault", "showcase");
  const list = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  assert.deepEqual(list(a), list(b), "the same file names in both trees");
  const differ = list(a).filter(
    (f) => fs.readFileSync(path.join(a, f), "utf8") !== fs.readFileSync(path.join(b, f), "utf8")
  );
  assert.deepEqual(differ, [], `${differ.length} notes differ between showcase/notes and examples/vault/showcase`);
});

test("the model checker is present and knows how to call omc", () => {
  // `scripts/check-models.mjs` is what a reader uses to work through a folder of their
  // own models. It is not part of the plugin, so nothing else would notice if it broke.
  const script = path.join(repoRoot, "scripts", "check-models.mjs");
  const text = fs.readFileSync(script, "utf8");
  assert.match(text, /checkModel\(/, "it checks models rather than only loading them");
  assert.match(text, /loadFile\(/, "and loads each file by path");
  assert.match(text, /completed successfully/, "and looks for the line omc prints on success");
  assert.match(text, /ONE AT A TIME|one at a time|mkdtempSync/, "one file per omc process");
});

test("the README's claim about verification matches the audit", () => {
  // A claim about verification is the one claim a reader cannot check without doing the
  // work again. Written as "every example" it stayed after four of them lost their audit
  // coverage; written as a count it can go stale the same way. Both forms are held to the
  // audit, and the "all" form is the stronger one: it fails if ANY example is uncovered.
  const audit = fs.readFileSync(path.join(repoRoot, "test", "audit.test.mjs"), "utf8");
  const verified = new Set([...audit.matchAll(/sim\("([A-Za-z0-9_]+)"/g)].map((m) => m[1]));
  const unverified = EXAMPLES.filter((e) => !verified.has(e.name)).map((e) => e.name);

  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8").replace(/\n\s*/g, " ");
  if (/Every table is re-checked/.test(readme)) {
    assert.deepEqual(unverified, [], `the README says every example is verified; ${unverified.join(", ")} are not`);
    return;
  }
  const claimed = /\*\*(\d+) of them also carry a table/.exec(readme)?.[1];
  assert.ok(claimed, "the README states how many examples are verified");
  assert.equal(
    Number(claimed),
    EXAMPLES.length - unverified.length,
    `the README claims ${claimed} verified; the audit covers ${EXAMPLES.length - unverified.length}`
  );
  for (const name of unverified) {
    assert.ok(readme.includes(`\`${name}\``), `${name} is not verified and must be named in the README`);
  }
});
