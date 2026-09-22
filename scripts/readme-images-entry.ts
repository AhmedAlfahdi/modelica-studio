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

export interface SceneData {
  example: ExampleModel;
  result: SimResult;
  model: DiagramModel;
  /** Every class the diagram draws with, by qualified name. */
  defs: Record<string, ComponentClass>;
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

  const result = await backend.simulate({
    modelName: EXAMPLE.name,
    source: EXAMPLE.source,
    startTime: 0,
    stopTime: EXAMPLE.stopTime,
    numberOfIntervals: 500,
  });

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

  return { example: EXAMPLE, result, model, defs };
}
