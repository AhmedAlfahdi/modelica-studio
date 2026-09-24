/**
 * Port a diagram arrangement from your vault into the shipped example.
 *
 * You arrange a diagram — in a note's live block, or in a saved `.mo` opened in the
 * studio — and this takes the PLACEMENTS from your version and writes them into
 * `src/modelica/examples.ts`, leaving the model itself alone. The notes and the README's
 * screenshots are then regenerated from it.
 *
 *     node scripts/apply-arrangement.mjs ~/modelica-vault/Modelica/GearTrain.mo
 *     node scripts/apply-arrangement.mjs ~/modelica-vault/showcase/tank-orifice.md
 *     node scripts/apply-arrangement.mjs mine.mo --model GearTrain --dry-run
 *
 * It refuses rather than guesses. A component added, deleted or renamed, a parameter
 * changed, a type swapped — anything that is not a placement is reported and NOTHING is
 * written, because half-applying a model change would ship a model neither of us wrote,
 * with a note beside it whose numbers no longer describe it.
 *
 * The model is read by the plugin's own parser, so what it sees is what the plugin sees.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES_TS = path.join(ROOT, "src", "modelica", "examples.ts");

/** The plugin's parser, bundled once and imported. */
let parserPromise;
async function parser() {
  parserPromise ??= (async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-arrangement-"));
    execFileSync(
      "npx",
      [
        "esbuild",
        "src/modelica/parser.ts",
        "--bundle",
        "--format=esm",
        "--platform=node",
        `--outfile=${path.join(dir, "parser.mjs")}`,
        "--log-level=error",
      ],
      { cwd: ROOT, stdio: "pipe" }
    );
    const mod = await import(path.join(dir, "parser.mjs"));
    fs.rmSync(dir, { recursive: true, force: true });
    return mod.parseModelica;
  })();
  return parserPromise;
}

/** The Modelica source inside a note, or the whole file when it is a `.mo`. */
export function sourceFrom(file) {
  const text = fs.readFileSync(file, "utf8");
  if (!file.endsWith(".md")) return text;
  const block = /```modelica\n([\s\S]*?)```/.exec(text);
  if (!block) throw new Error(`${path.basename(file)} has no modelica block`);
  // The block's own directive is not Modelica.
  return block[1]
    .split("\n")
    .filter((line) => !line.trim().startsWith("//@"))
    .join("\n");
}

/** A comparable description of one component: everything except where it sits. */
function describe(c) {
  const params = Object.entries(c.modifiers ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join(", ");
  return `${c.type}${params ? `(${params})` : ""}`;
}

/**
 * A placement as one canonical string, so two spellings of the same box compare equal.
 *
 * The syntax matters: `extent={{-100,30},{-80,50}}`, two corners each in braces. The
 * first version of this wrote a flat `extent={-100,30,-80,50}`, which is not Modelica —
 * the parser ignored the annotation, the component silently lost its placement, and the
 * layout rules could not see it because a model where nothing is placed was skipped.
 */
function placementOf(c) {
  const p = c.placement;
  if (!p?.extent || p.extent.length !== 4) return undefined;
  const [x1, y1, x2, y2] = p.extent.map((n) => Math.round(n * 100) / 100);
  return `extent={{${x1},${y1}},{${x2},${y2}}}${p.rotation ? `, rotation=${p.rotation}` : ""}`;
}

/**
 * What would change, and what cannot be applied.
 *
 * Pure apart from the parser, so the CLI and the tests share one implementation of the
 * rules.
 */
export async function planArrangement(shipped, theirs, name) {
  const parse = await parser();
  const mine = parse(shipped)[0];
  const yours = parse(theirs)[0];
  const changes = [];
  const refusals = [];

  if (!mine) refusals.push(`${name}: the shipped source does not parse`);
  if (!yours) refusals.push(`${name}: your source does not parse`);
  if (!mine || !yours) return { changes, refusals };

  const mineByName = new Map(mine.components.map((c) => [c.name, c]));
  const yoursByName = new Map(yours.components.map((c) => [c.name, c]));

  for (const [component, a] of mineByName) {
    const b = yoursByName.get(component);
    if (!b) {
      refusals.push(`${name}.${component}: missing from your version — deleted or renamed?`);
      continue;
    }
    if (describe(a) !== describe(b)) {
      refusals.push(
        `${name}.${component}: not only moved\n      shipped: ${describe(a)}\n      yours:   ${describe(b)}`
      );
      continue;
    }
    const was = placementOf(a);
    const now = placementOf(b);
    if (!now) {
      refusals.push(`${name}.${component}: has no Placement in your version`);
      continue;
    }
    if (was !== now) changes.push({ component, from: was ?? "(none)", to: now });
  }
  for (const component of yoursByName.keys()) {
    if (!mineByName.has(component)) {
      refusals.push(
        `${name}.${component}: is in your version but not in the shipped example — adding a component is a model change, not an arrangement`
      );
    }
  }
  return { changes, refusals };
}

/**
 * Write one component's placement into the shipped source of ONE example.
 *
 * Scoped to that example's own text: run over the whole file, `\\bstep\\b` matched the
 * word "step" in another example's description and the next Placement annotation after
 * it — so the first attempt edited the RLC circuit while reporting that it had moved the
 * Step in MassSpringDamper.
 */
function applyOne(exampleSource, name, placement) {
  const re = new RegExp(
    `(\\b${name}\\b\\s*(?:\\([^)]*\\))?\\s*annotation\\s*\\(\\s*Placement\\s*\\(\\s*transformation\\s*\\()([^)]*?)(\\)\\s*\\)\\s*\\))`
  );
  const m = re.exec(exampleSource);
  if (!m) throw new Error(`cannot find the placement of ${name} in the shipped source`);
  return exampleSource.slice(0, m.index) + m[1] + placement + m[3] + exampleSource.slice(m.index + m[0].length);
}

/** The span of an example's source inside examples.ts, as `const NAME = \`…\`;`. */
function spanOf(constName, text) {
  const re = new RegExp("const " + constName + " = " + String.fromCharCode(96) + "([\\s\\S]*?)" + String.fromCharCode(96) + ";");
  const m = re.exec(text);
  if (!m) throw new Error(`cannot find ${constName} in examples.ts`);
  return { start: m.index, bodyStart: m.index + m[0].indexOf("`") + 1, bodyEnd: m.index + m[0].lastIndexOf("`") };
}

/** The const name an example's source lives in. */
function constNameOf(name) {
  const text = fs.readFileSync(EXAMPLES_TS, "utf8");
  for (const [, entryName, constName] of text.matchAll(/name: "([^"]+)",[\s\S]*?source: ([A-Z_]+),/g)) {
    if (entryName === name) return constName;
  }
  return undefined;
}

/** The shipped source of an example, by class name. */
function shippedSource(name) {
  const text = fs.readFileSync(EXAMPLES_TS, "utf8");
  const consts = new Map([...text.matchAll(/const ([A-Z_]+) = `([\s\S]*?)`;/g)].map((m) => [m[1], m[2]]));
  for (const [, entryName, constName] of text.matchAll(/name: "([^"]+)",[\s\S]*?source: ([A-Z_]+),/g)) {
    if (entryName === name) return consts.get(constName);
  }
  return undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const explicit = args.includes("--model") ? args[args.indexOf("--model") + 1] : undefined;
  if (!file) {
    console.error("usage: node scripts/apply-arrangement.mjs <file.mo|note.md> [--model Name] [--dry-run]");
    process.exit(2);
  }

  const full = file.replace(/^~/, process.env.HOME ?? "~");
  const theirs = sourceFrom(full);
  const parse = await parser();
  const name = explicit ?? parse(theirs)[0]?.name;
  const shipped = name ? shippedSource(name) : undefined;
  if (!shipped) {
    const names = [...fs.readFileSync(EXAMPLES_TS, "utf8").matchAll(/name: "([^"]+)",/g)].map((m) => m[1]);
    console.error(`${name ?? "?"} is not one of the shipped examples. Known names:\n  ${names.join(", ")}`);
    process.exit(2);
  }

  const { changes, refusals } = await planArrangement(shipped, theirs, name);
  console.log(
    `${name}: ${changes.length} placement${changes.length === 1 ? "" : "s"} differ, ${refusals.length} cannot be applied`
  );
  for (const c of changes) console.log(`  ${c.component}\n    was: ${c.from}\n    now: ${c.to}`);
  if (refusals.length > 0) {
    console.error("\nNothing was written. These are not arrangements:");
    for (const r of refusals) console.error(`  ${r}`);
    process.exit(1);
  }
  if (changes.length === 0) {
    console.log("nothing to do: the arrangements already match");
    return;
  }
  if (dryRun) {
    console.log("\n--dry-run: examples.ts was not touched");
    return;
  }

  // Everything is checked before anything is written. The edits are made inside this
  // example's own source and spliced back, so another example cannot be touched.
  const text = fs.readFileSync(EXAMPLES_TS, "utf8");
  const span = spanOf(constNameOf(name), text);
  let body = text.slice(span.bodyStart, span.bodyEnd);
  for (const c of changes) body = applyOne(body, c.component, c.to);
  const next = text.slice(0, span.bodyStart) + body + text.slice(span.bodyEnd);
  if (next === text) throw new Error("nothing changed");
  fs.writeFileSync(EXAMPLES_TS, next);
  // Verified by re-reading it through the same planner that planned the change.
  const after = await planArrangement(shippedSource(name), body, name);
  if (after.changes.length !== 0 || after.refusals.length !== 0) {
    fs.writeFileSync(EXAMPLES_TS, text);
    throw new Error(`the write did not take: ${JSON.stringify(after)}`);
  }
  console.log("\nwrote src/modelica/examples.ts");

  console.log("regenerating the notes…");
  for (const dir of [path.join(ROOT, "showcase", "notes"), path.join(ROOT, "examples", "vault", "showcase")]) {
    execFileSync(process.execPath, [path.join(ROOT, "showcase", "generate.mjs"), dir], { cwd: ROOT, stdio: "inherit" });
  }
  console.log("\nnext: node scripts/readme-images.mjs    if this model is in the README");
  console.log("      node --test \"test/*.test.mjs\"     the layout rules and the notes");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(String(err?.message ?? err));
    process.exit(1);
  });
}
