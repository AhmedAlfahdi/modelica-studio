/**
 * Parameter collection, shared by the main view and inline embeds.
 *
 * Lives in its own module because both need it and neither should own it: the
 * rule below is about what OpenModelica can accept at run time, which is a
 * property of the backend rather than of any one view.
 */

import type { DiagramModel } from "../modelica/types";

/**
 * Keys that name an initial value rather than a parameter.
 *
 * They are written into the model source and need a rebuild; passing one as a
 * run-time override makes OpenModelica warn "override variable name not found"
 * and silently keeps the old value.
 */
const START_KEY = /\.(start|fixed)$/;

/**
 * Parameters that can be overridden without recompiling.
 *
 * Only literal values are collected. An expression may reference another
 * parameter or a structural quantity, in which case changing it genuinely
 * requires a rebuild — passing it as an override would silently do nothing, or
 * produce a model that disagrees with the diagram.
 */
export function collectParameters(model: DiagramModel): Record<string, string> {
  const out: Record<string, string> = {};
  // Variables carry parameters too — `parameter Real e=0.9` is overridable even
  // though it is never drawn, and it is exactly the kind of value worth
  // changing between runs.
  const sources: Array<{ id: string; params: Record<string, string> }> = [
    ...model.components,
    ...(model.variables ?? []),
  ];
  for (const c of sources) {
    for (const [k, v] of Object.entries(c.params)) {
      if (v === undefined || v === null || v === "") continue;
      if (START_KEY.test(k)) continue;
      if (!/^[-+]?(\d+\.?\d*([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?|true|false)$/.test(v.trim())) {
        continue;
      }
      // A variable's own binding is recorded under its declared name, so
      // `parameter Real e=0.9` stores `params.e = "0.9"` and the override path
      // is `e`, not `e.e`. OpenModelica ignores an unknown override silently,
      // so the wrong path produces no error and no effect.
      const path = k === c.id ? k : `${c.id}.${k}`;
      out[path] = v.trim();
    }
  }
  return out;
}

/**
 * The parameters worth offering to a sweep.
 *
 * `collectParameters` answers a different question — "what values does this model
 * have?" — and its answer includes the initial-state entries (`h.start`,
 * `h.fixed`, `atRest.start`, …). Those cannot be swept: measured on a
 * bouncing-ball model, overriding `h.start` is silently ignored and the family
 * comes back as two identical curves, so the picture says "nothing changed"
 * about a value that never changed. `h.fixed` is a Boolean the values field
 * cannot even express.
 *
 * What is left is the parameters proper: a name that is not an attribute, with a
 * numeric value the run can be given.
 */
export function sweepableParameters(values: Record<string, string>): string[] {
  const attributes = /(\.|^)(start|fixed|nominal|min|max|unit|displayUnit|stateSelect)$/;
  return Object.keys(values)
    .filter((name) => !attributes.test(name))
    .filter((name) => Number.isFinite(Number(values[name])))
    .sort((a, b) => a.localeCompare(b));
}
