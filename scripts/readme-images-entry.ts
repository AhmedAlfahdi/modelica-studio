/**
 * The Node side of the README images: the example, a real simulation, and the class
 * definitions the page needs.
 *
 * Bundled by `readme-images.mjs`. Kept apart from the page entry because the page has
 * no filesystem and no way to spawn a compiler: the library is read, the model is
 * parsed and the simulation runs HERE, and the page is handed plain data.
 */

import { EXAMPLES, type ExampleModel } from "../src/modelica/examples";
import { OmcBackend } from "../src/omc/backend";
import { locateOmcSync } from "../src/omc/locate";
import { LibraryIndex, loadLibraryIndex } from "../src/modelica/library";
import { parseModelica, toDiagramModel } from "../src/modelica/parser";
import { buildSolveModel, parseSolveBlock, solveModelName } from "../src/modelica/solve";
import { modelicaToLatex } from "../src/modelica/latex";
import katex from "katex";
import type { ComponentClass, DiagramModel, SimResult } from "../src/modelica/types";

/** The example the README is written around. */
export const EXAMPLE: ExampleModel =
  EXAMPLES.find((e) => e.name === "MassSpringDamper") ?? EXAMPLES[0];

/**
 * Where the library lives on this machine.
 *
 * Passed in rather than discovered: `discoverLibraryRoots` exists in the plugin, but
 * it is asynchronous and the caller here already knows what is installed.
 */
export interface SceneOptions {
  roots: string[];
}

/** One solved block: what the note says, and what the compiler made of it. */
export interface SolvedBlock {
  source: string;
  series: Array<{ name: string; values: number[]; unit?: string }>;
  /**
   * The rendered equation, keyed by the LaTeX it was rendered from.
   *
   * Rendered HERE rather than in the page: the plugin draws its equation by calling Obsidian's
   * `renderMath`, and the page has only the test stub, which hands back the LaTeX as text — a
   * picture of `\sqrt{x}` where the app shows a radical. Obsidian's own MathJax bundle cannot
   * be loaded from a bare `file://` page either: it spawns a speech worker, and a worker cannot
   * `importScripts` across origins, so it hangs the render. KaTeX renders the same LaTeX to HTML
   * in Node, where nothing has to load, and the page only has to put it in place.
   */
  math: Record<string, string>;
}

export interface SceneData {
  example: ExampleModel;
  result: SimResult;
  /**
   * Real solve blocks, each run through the plugin's own path.
   *
   * `stopTime: 0` — the trick the block itself uses: OpenModelica must find values for every
   * variable that satisfy every equation before it can take a step, and that initialisation IS
   * the solve. Three of them, chosen to show what the feature is FOR rather than what it looks
   * like: an unknown that appears twice and is isolated by no algebra, a system, and an answer
   * with a unit the compiler resolved.
   */
  solves: SolvedBlock[];
  /** The same model over three values of the coupling stiffness, for the sweep. */
  family: Array<{ label: string; result: SimResult }>;
  /** Which of those the plot treats as the run on screen. */
  currentLabel: string;
  model: DiagramModel;
  /** Every class the diagram draws with, by qualified name. */
  defs: Record<string, ComponentClass>;
  /**
   * What the palette shows.
   *
   * The two packages the example draws on, as the library's OWN package trees, plus
   * the library's size and class names — so the studio screenshot lists real
   * packages and real classes rather than a handful of invented rows.
   */
  palette: {
    size: number;
    roots: string[];
    names: string[];
    trees: Record<string, unknown>;
  };
}

/**
 * Compile and run the example with the local OpenModelica, exactly as the plugin
 * does, and resolve the icons the diagram needs.
 *
 * No parameter is adjusted to make a nicer picture: the diagram, the numbers and the
 * plot are all the example's own.
 */
export async function buildSceneData(opts: SceneOptions): Promise<SceneData> {
  const located = locateOmcSync();
  if (located.status !== "found") throw new Error("no OpenModelica installation found");
  const backend = new OmcBackend({ omcPath: located.omcPath });

  const index = new LibraryIndex();
  for (const root of opts.roots) index.addDirectory(root);

  const run = (parameters?: Record<string, string>) =>
    backend.simulate({
      modelName: EXAMPLE.name,
      source: EXAMPLE.source,
      parameters,
      startTime: 0,
      stopTime: EXAMPLE.stopTime,
      numberOfIntervals: 500,
    });

  const result = await run();
  // A sweep, as the plugin's own sweep runs it: one simulation per value, of the SAME
  // compiled binary — the parameter is overridden at run time, which is the fast path
  // and the one a reader gets. The middle value is the run on screen.
  const family: Array<{ label: string; result: SimResult }> = [];
  for (const c of ["25", "100"]) {
    family.push({ label: `c=${c}`, result: await run({ "coupling.c": c }) });
  }
  family.splice(1, 0, { label: "c=50", result });

  const parsed = parseModelica(EXAMPLE.source)[0];
  const lookup = (n: string) => index.describe(n);
  const model = toDiagramModel(parsed, lookup);

  // Only the classes this diagram touches: the components, and each port's
  // connector (whose icon decides a wire's colour and weight).
  const defs: Record<string, ComponentClass> = {};
  const add = (className: string | undefined) => {
    if (!className || defs[className]) return;
    const def = lookup(className);
    if (!def) return;
    defs[className] = def;
    for (const port of def.ports) add(port.connectorClass);
  };
  for (const component of model.components) add(component.className);

  // The palette: real package rows, with the example's own packages expanded. Loading
  // every tree would serialize thousands of nodes into the page; these are the two the
  // picture needs, and the count tells the reader how big the rest is.
  const roots = ["Modelica.Mechanics.Translational", "Modelica.Blocks.Sources"];
  const palette = {
    size: index.size,
    roots,
    names: roots.flatMap((r) => index.packageTree(r).children.slice(0, 40).map((c) => c.full)),
    trees: Object.fromEntries(roots.map((r) => [r, index.packageTree(r)])),
  };

  // Three blocks, solved here exactly as the plugin solves one: the dialect is parsed, the
  // class that makes it legal Modelica is generated, and the backend is asked for the model's
  // INITIALISATION with `stopTime: 0`. Nothing is hand-written into the picture — if a block
  // stops solving, this stops producing an image.
  const blocks = [
    "//@ solve x\nsqrt(x) + x^2 - 56 = 67",
    "//@ solve x\n2*x + y = 7\nx - y = 2",
    // Verbatim from docs/solve-examples.md, where it was run against OpenModelica and printed
    // `R = 200 Ω`: the unit appears nowhere in the block, and only the compiler knows it.
    [
      "//@ solve R",
      "Modelica.Units.SI.Resistance R;",
      "Modelica.Units.SI.Voltage v;",
      "Modelica.Units.SI.Current i;",
      "v = 10;",
      "i = 0.05;",
      "R = v/i",
    ].join("\n"),
  ];
  const solves: SolvedBlock[] = [];
  for (const source of blocks) {
    const spec = parseSolveBlock(source);
    if (spec.problem || !spec.unknown) continue;
    const modelName = solveModelName(spec);
    const solved = await backend.simulate({
      modelName,
      source: buildSolveModel(spec, modelName),
      stopTime: 0,
    });
    // Every line the block will typeset, in the same form the block itself asks for: the same
    // `modelicaToLatex` on the same strings, so the picture and the app ask for one thing.
    const math: Record<string, string> = {};
    // Declarations too: the block typesets `Modelica.Units.SI.Resistance R` as mathematics like
    // anything else, and a picture where the declaration stayed as source and the equation did
    // not would show a difference the app does not have.
    for (const line of [...spec.declarations, `${spec.unknown}`, ...spec.equations]) {
      const latex = modelicaToLatex(line);
      if (!latex) continue;
      try {
        math[latex] = katex.renderToString(latex, { displayMode: true, throwOnError: false });
      } catch {
        /* an unrendered equation beats no picture */
      }
    }
    solves.push({
      source,
      series: solved.series.map((s) => ({ name: s.name, values: [s.values[0]], unit: s.unit })),
      math,
    });
  }

  return {
    example: EXAMPLE,
    result,
    family,
    currentLabel: "c=50",
    model,
    defs,
    palette,
    solves,
    // Flattened for the page: it replaces a stub maths element by looking up the LaTeX it was
    // given, and a map is easier to match on than a list of blocks.
    solvesMath: Object.assign({}, ...solves.map((s) => s.math)),
  };
}
