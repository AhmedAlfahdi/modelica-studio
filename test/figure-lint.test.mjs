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
const { sweepableParameters } = await import(
  path.join(buildLibs("figure-params", ["src/view/parameters.ts"]), "parameters.js")
);

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

test("the repair prompt says which problem it is", () => {
  // The two cases need different instructions, and the vault's own AI log is the
  // evidence: five exchanges came back rejected for loose wiring, each rejection
  // repeating the same sentence. Saying it once, up front, is cheaper than five
  // repairs discovering it.
  const compiling = lint.repairInstruction([]);
  assert.match(compiling, /does not compile/, "a model that will not compile is asked to be fixed");
  assert.doesNotMatch(compiling, /connect/, "and nothing is said about wiring");

  const loose = lint.repairInstruction([
    { kind: "wiring", message: "None of the 2 components are connected to each other: a, b." },
  ]);
  assert.match(loose, /compiles but does not work/, "a loose diagram says so, rather than claiming it will not compile");
  assert.match(loose, /None of the 2 components/, "the finding is quoted, not paraphrased");
  assert.match(loose, /connect\(\.\.\.\)/, "and the wiring requirement is stated up front");
  assert.match(loose, /schematic/, "with the reason: this is a schematic, not an equations answer");
});

test("a sweep offers only parameters that can be overridden", () => {
  // Measured on a bouncing-ball model: overriding `h.start` is silently ignored,
  // so the family came back as two identical curves. The list has to be the
  // parameters proper, not everything the model records a value for.
  assert.deepEqual(
    sweepableParameters({
      e: "0.9",
      v_min: "0.1",
      "h.start": "1",
      "h.fixed": "true",
      "atRest.start": "false",
      "r1.R": "100",
      "r1.T_ref": "293.15",
    }),
    ["e", "r1.R", "r1.T_ref", "v_min"],
    "attributes and Booleans are out; numbers are in"
  );

  // A parameter whose value is not a number cannot be swept by a numeric field.
  assert.deepEqual(sweepableParameters({ kind: "Modelica.Blocks.Types.Init.SteadyState" }), []);
  assert.deepEqual(sweepableParameters({}), [], "and a model with none offers none");
  // A bare `start` is treated as the attribute: a parameter that shares the name
  // is rarer than the attribute, and offering one that silently does nothing is
  // the failure being fixed here.
  assert.deepEqual(sweepableParameters({ start: "1", startup: "2" }), ["startup"]);
});

test("two figures saved in the same minute do not collide", async () => {
  // The name carries the model and the MINUTE, and `createBinary` refuses a path
  // that already exists -- so a second save inside the minute reported "the figure
  // could not be saved" and inserted no link. Comparing a plot with a sweep takes
  // seconds, which is exactly when this happened.
  const existing = new Set();
  const created = [];
  const app = {
    workspace: { getActiveFile: () => ({ parent: { path: "Figures" } }) },
    vault: {
      getAbstractFileByPath: (p) => (existing.has(p) ? { path: p } : null),
      createFolder: async () => {},
      createBinary: async (p, bytes) => {
        if (existing.has(p)) throw new Error("File already exists.");
        existing.add(p);
        created.push({ path: p, bytes: bytes.byteLength });
        return { path: p };
      },
    },
  };
  const canvas = {
    toBlob: (cb) => cb({ arrayBuffer: async () => new ArrayBuffer(8) }),
  };

  const first = await figure.saveCanvasImage(app, canvas, "Tank", "Figures");
  const second = await figure.saveCanvasImage(app, canvas, "Tank", "Figures");
  const third = await figure.saveCanvasImage(app, canvas, "Tank", "Figures");

  assert.ok(first, "the first save worked");
  assert.ok(second, "and so did the second, in the same minute");
  assert.ok(third, "and the third");
  assert.equal(new Set(created.map((c) => c.path)).size, 3, `three distinct paths: ${created.map((c) => c.path)}`);
  assert.match(second, /-2\.png$/, "the second is the minute's second figure");
  assert.match(third, /-3\.png$/, "and the third the third");
  assert.match(first, /^Figures\/Tank-\d{4}-\d{2}-\d{2}-\d{4}\.png$/, `named as before: ${first}`);
});
