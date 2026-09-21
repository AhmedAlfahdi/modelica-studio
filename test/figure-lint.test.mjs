/**
 * Figures out of the app, and what is wrong with a drawing.
 *
 * Both are small, pure pieces that decide something a person sees: the name a
 * figure lands under, the markdown that points at it, and the difference between
 * "no problems" and a report. The parts that need a canvas or a compiler are
 * driven in the running app instead.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { buildLibs, repoRoot, testTmpDir } from "./helpers/build.mjs";

const staging = testTmpDir("mo-figure-");
execFileSync(
  "npx",
  [
    "esbuild",
    "src/view/figure.ts",
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
  "export class Notice { constructor(m) { this.message = m; } }\nexport class TFile {}\nexport class App {}\n"
);
const figure = await import(path.join(staging, "figure.js"));

const lintLib = buildLibs("figure-lint", ["src/modelica/lint.ts", "src/ai/generate.ts"]);
const lint = await import(path.join(lintLib, "modelica/lint.js"));

/* ------------------------------------------------------------------ */

test("a figure is named after the model and the minute", () => {
  // A folder of figures should say what each one is and which run it came from,
  // without opening any of them.
  const at = new Date(2026, 8, 20, 19, 30, 5);
  assert.equal(figure.figureFileName("Tank", at), "Tank-2026-09-20-1930.png");
  assert.equal(figure.figureFileName("", at), "model-2026-09-20-1930.png", "a model with no name still gets one");
  // A model name is a Modelica identifier, but a path separator or a colon from
  // anywhere else must not become part of a file name.
  assert.equal(figure.figureFileName("a/b:c", at), "a-b-c-2026-09-20-1930.png");
});

test("the markdown for a figure points at its file", () => {
  assert.equal(figure.figureLink("notes/Tank-2026-09-20-1930.png"), "![Tank-2026-09-20-1930](notes/Tank-2026-09-20-1930.png)");
  // A space in a path is the case that breaks a naive link.
  assert.equal(figure.figureLink("my notes/fig.png"), "![fig](my%20notes/fig.png)");
});

/* ------------------------------------------------------------------ */

test("a diagram with components wired to nothing is reported", () => {
  const loose = [
    "model M",
    "  Modelica.Blocks.Sources.Constant a;",
    "  Modelica.Blocks.Math.Gain b;",
    "end M;",
  ].join("\n");
  const findings = lint.lintModel(loose, {});
  assert.equal(findings.length, 1, "one finding");
  assert.equal(findings[0].kind, "wiring");
  // Nothing wired at all is its own message: the advice is different from "one
  // component is loose", and the AI log in this vault shows both.
  assert.match(findings[0].message, /None of the 2 components are connected to each other/, "and it says what is wrong");
  assert.match(findings[0].message, /a, b/, "naming the components");

  const wired = loose.replace("end M;", "equation\n  connect(a.y, b.u);\nend M;");
  assert.deepEqual(lint.lintModel(wired, {}), [], "wiring them clears it");

  // One loose component among wired ones is the other branch.
  const partial = [
    "model M",
    "  Modelica.Blocks.Sources.Constant a;",
    "  Modelica.Blocks.Math.Gain b;",
    "  Modelica.Blocks.Math.Gain c;",
    "equation",
    "  connect(a.y, b.u);",
    "end M;",
  ].join("\n");
  const partialFindings = lint.lintModel(partial, {});
  assert.equal(partialFindings.length, 1);
  assert.match(partialFindings[0].message, /connected to nothing: c/, "the loose one is named");
});

test("the report distinguishes nothing found from everything found", () => {
  // The two sentences a reader has to be able to tell apart.
  assert.match(
    lint.formatLint([], [], false),
    /^No problems found in the diagram/,
    "a clean diagram before asking the compiler"
  );
  assert.match(
    lint.formatLint([], [], true),
    /compiles/,
    "and a clean diagram the compiler agreed with"
  );

  const withFindings = lint.formatLint([{ kind: "wiring", message: "x is connected to nothing" }]);
  assert.match(withFindings, /x is connected to nothing/);

  const withDiagnostics = lint.formatLint(
    [],
    [
      { severity: "error", message: "Variable p does not exist", line: 7 },
      { severity: "warning", message: "unused", line: 9 },
    ],
    false
  );
  assert.match(withDiagnostics, /1 error and 1 warning from the compiler:/);
  assert.match(withDiagnostics, /line 7: Variable p does not exist/, "with the line it is on");
  assert.match(withDiagnostics, /line 9: unused/);

  // Both halves at once, because a loose diagram explains a compiler error about
  // a variable with no equation — reporting only the second sends the reader to
  // the wrong place.
  const both = lint.formatLint([{ kind: "wiring", message: "loose" }], [{ severity: "error", message: "boom" }]);
  assert.ok(both.indexOf("loose") < both.indexOf("boom"), "the drawing is reported before the compiler");

  assert.equal(lint.summariseLint([{ kind: "wiring", message: "one" }, { kind: "wiring", message: "two" }]), "one two");
});
