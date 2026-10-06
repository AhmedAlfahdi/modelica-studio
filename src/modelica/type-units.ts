/**
 * The unit a type declares, found by following short class definitions.
 *
 * A parameter's unit is usually nowhere in the model: `Modelica.Electrical.Analog.Sources.
 * StepVoltage` declares `Modelica.Units.SI.Voltage offset`, and "V" appears only in
 * `type Voltage = ElectricPotential`, which is `type ElectricPotential = Real(unit = "V")`.
 * The compiler resolves that chain and reports it in the model description — but the
 * description is written by a BUILD, so before the first simulation the inspector had nothing
 * and showed neither a unit nor a unit picker. A reader who had not run the model yet saw a
 * feature that was not there.
 *
 * This walks the same chain in the library the plugin already has on disk. It is a second
 * opinion, not the authority: where the description disagrees, the description wins, because
 * the compiler knows about `replaceable`, conditional declarations and `extends`-driven
 * redeclarations that this deliberately does not.
 *
 * Pure, and takes the lookup as an argument so it can be tested without a library. Never
 * throws: a missing class, an unresolvable name or a cycle costs the unit and nothing else.
 */

export interface TypeUnits {
  unit?: string;
  displayUnit?: string;
}

/** The little of a parsed class this needs. */
export interface TypeSource {
  aliasOf?: string;
  aliasModifiers?: Record<string, string>;
  qualifiedName?: string;
}

/** Modelica's own scalar types state no unit of their own. */
const BUILTIN = new Set([
  "Real",
  "Integer",
  "Boolean",
  "String",
  "Clock",
  "Time",
  "Complex",
]);

function unquote(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/** Follow `type A = B(unit=…)` until a unit is stated, or the chain runs out. */
export function unitsOfType(
  typeName: string,
  lookup: (name: string, fromPackage?: string) => TypeSource | undefined,
  fromPackage = "",
  depth = 0
): TypeUnits {
  const name = (typeName ?? "").trim();
  // Eight is deeper than MSL goes (`Voltage` → `ElectricPotential` → `Real`) and shallow enough
  // that a cycle in a hand-written library ends here rather than at the stack limit.
  if (!name || depth > 8 || BUILTIN.has(name)) return {};
  let cls: TypeSource | undefined;
  try {
    cls = lookup(name, fromPackage) ?? lookup(name);
  } catch {
    return {};
  }
  if (!cls) return {};

  const mods = cls.aliasModifiers ?? {};
  const unit = unquote(mods.unit);
  const displayUnit = unquote(mods.displayUnit);
  if (unit || displayUnit) {
    return { ...(unit ? { unit } : {}), ...(displayUnit ? { displayUnit } : {}) };
  }
  // `type Voltage = ElectricPotential` names a class in the same package, so the current class
  // is the context the next lookup resolves against.
  if (cls.aliasOf && cls.aliasOf !== name) {
    return unitsOfType(cls.aliasOf, lookup, cls.qualifiedName ?? name, depth + 1);
  }
  return {};
}
