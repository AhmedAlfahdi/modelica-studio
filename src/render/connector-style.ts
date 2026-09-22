/**
 * How a connection to a connector of this class is drawn.
 *
 * This is MSL's own rule, not one invented here. `Modelica.Blocks`' UsersGuide
 * states it in the documentation of the bus example:
 *
 *   "the color and thickness of a connector line are taken from the first line
 *    element in the icon annotation of a connector class. … As a result, when
 *    connecting from an instance of this connector to another connector
 *    instance, the connecting line has the color of the "ControlBus" with double
 *    width (due to "thickness=0.5")."
 *
 * The scale that sentence implies is the language's: the Modelica specification
 * gives `Line.thickness` and `FilledShape.lineThickness` the default 0.25, so
 * 0.25 is one line, 0.5 is double, 1.0 is four times and 5.0 is twenty.
 *
 * Why the rule is shaped like that: a connection is drawn as a `Line` primitive,
 * and annotations "are only allowed directly in classes (e.g. not on components
 * or connections)" — so a `connect` clause cannot say how it looks, and the
 * connector's own icon is the only place a library can put it.
 *
 * Measured over MSL 4.1.0: of its 94 connectors, 80 declare no thickness (a
 * single line) and 14 declare 0.5 (double) — the signal and control buses, the
 * StateGraph inflow/outflow connectors, and the MultiBody frames.
 */

import type { Color, ComponentClass, Graphic } from "../modelica/types";
import { isGraphicVisible } from "./canvas";

export interface ConnectorWireStyle {
  /** The colour of the connector's own line, which the specification defaults to black. */
  color: Color;
  /** Stroke weight as a multiple of a single line: 0.5 in the source is 2. */
  widthRatio: number;
}

/**
 * The language's own default line colour, from `Line.color = Black` and
 * `FilledShape.lineColor = Black`.
 */
const DEFAULT_LINE_COLOR: Color = [0, 0, 0];

/** The language's default thickness, and therefore one line's width. */
export const LINE_THICKNESS_UNIT = 0.25;

/**
 * Cached per class definition.
 *
 * The rule is a property of the connector class, and `describe` hands back the
 * same object for the same class, so identity is enough — and a rebuilt library
 * produces new objects rather than a stale answer.
 */
const cache = new WeakMap<ComponentClass, ConnectorWireStyle | null>();

/**
 * The style MSL gives a connection to this connector class, or undefined when the
 * class draws nothing that could be a line.
 *
 * Graphics are walked in the order they are DRAWN, which is what "the first line
 * element" means: base-class contents first, then the class's own primitives —
 * the order `library.describe` collects them in. Invisible lines are passed over,
 * because `LinePattern.None` is how MSL hides a mark it still needs for layout
 * (1,018 graphics in the library ask for it).
 */
export function connectorWireStyle(
  classDef: ComponentClass | undefined
): ConnectorWireStyle | undefined {
  if (!classDef) return undefined;
  const cached = cache.get(classDef);
  if (cached !== undefined) return cached ?? undefined;

  const style = findStyle(classDef);
  cache.set(classDef, style ?? null);
  return style;
}

function findStyle(classDef: ComponentClass): ConnectorWireStyle | undefined {
  for (const g of classDef.icon ?? []) {
    // Text has no stroke, and a hidden graphic is not drawn at all.
    if (g.kind === "Text") continue;
    if (!isGraphicVisible(g)) continue;
    // An invisible line: `LinePattern.None` is "an invisible line", so it is not
    // the element a tool would read the appearance from.
    if ((g as { pattern?: string }).pattern === "None") continue;

    const shape = g as {
      lineColor?: Color;
      color?: Color;
      thickness?: number;
      lineThickness?: number;
      fillPattern?: string;
    };
    // `Line` names its stroke `color`; the filled shapes name it `lineColor`.
    //
    // The FILL is deliberately not a substitute, and the library is the reason:
    // `Flange_a` and `Flange_b` are both filled ellipses that name no line colour
    // — grey and WHITE respectively — so reading the fill would draw every
    // rotational connection in white, invisible on a light canvas. Where MSL wants
    // a colour it names one (the MultiBody frames ask for {95,95,95}, the signal
    // buses for {255,204,51}), and where it does not, the language's own default
    // is black.
    const color = shape.lineColor ?? shape.color ?? DEFAULT_LINE_COLOR;
    const thickness = shape.thickness ?? shape.lineThickness ?? LINE_THICKNESS_UNIT;
    return {
      color,
      widthRatio: Math.max(0, thickness / LINE_THICKNESS_UNIT),
    };
  }
  return undefined;
}
