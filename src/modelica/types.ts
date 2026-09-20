/**
 * Core diagram + component model.
 *
 * Deliberately mirrors the Modelica Language Specification §18.6 graphical
 * annotations one-to-one, so that a diagram can be serialised back to valid
 * Modelica `annotation(...)` text without loss.
 *
 * The primitive set is exactly: Line, Polygon, Rectangle, Ellipse, Text, Bitmap.
 * (There is NO `Arrow` primitive — arrow is an enum parameter of `Line`.)
 */

export type Color = [number, number, number];

/** Line.Arrow — MLS §18.6.5.1 */
export type ArrowKind = "None" | "Open" | "Filled" | "Half";

/** Line.Smooth — MLS §18.6.5.1 */
export type SmoothKind = "None" | "Bezier";

/** FillPattern — MLS §18.6.1.2 */
export type FillPattern =
  | "None"
  | "Solid"
  | "Horizontal"
  | "Vertical"
  | "Cross"
  | "Forward"
  | "Backward"
  | "CrossDiag"
  | "HorizontalCylinder"
  | "VerticalCylinder"
  | "Sphere";

/** BorderPattern — MLS §18.6.1.2 */
export type BorderPattern = "None" | "Raised" | "Sunken" | "Engraved";

/** LinePattern — MLS §18.6.1.2 */
export type LinePattern = "None" | "Solid" | "Dash" | "Dot" | "DashDot" | "DashDotDot";

/**
 * Common graphical properties shared by every primitive (GraphicalPrimitive).
 * MLS §18.6.1.
 */
export interface GraphicCommon {
  /**
   * Whether the graphic is drawn.
   *
   * Usually a literal boolean, but Modelica also allows an expression such as
   * `visible=useHeatPort`. Those are kept verbatim as a string; the renderer
   * draws only literal `true` (see `isGraphicVisible`), because these flags
   * almost always guard optional parts that libraries hide by default.
   */
  visible?: boolean | string;
  origin?: [number, number];
  rotation?: number;
  lineColor?: Color;
  pattern?: LinePattern;
  lineThickness?: number;
  smooth?: SmoothKind;
}

export interface ShapeCommon extends GraphicCommon {
  fillColor?: Color;
  fillPattern?: FillPattern;
  lineThickness?: number;
}

/** MLS §18.6.5.1 */
export interface LineGraphic extends GraphicCommon {
  kind: "Line";
  /** Flat list [x1,y1,x2,y2,...] — MLS uses `points={{x,y},...}` but flat is easier to manipulate. */
  points: number[];
  color?: Color;
  thickness?: number;
  arrow?: [ArrowKind, ArrowKind];
  arrowSize?: number;
}

/** MLS §18.6.5.2 */
export interface PolygonGraphic extends ShapeCommon {
  kind: "Polygon";
  points: number[];
  smooth?: SmoothKind;
}

/** MLS §18.6.5.3 */
export interface RectangleGraphic extends ShapeCommon {
  kind: "Rectangle";
  /** [x1,y1,x2,y2] */
  extent: [number, number, number, number];
  borderPattern?: BorderPattern;
  radius?: number;
}

/** MLS §18.6.5.4 */
export interface EllipseGraphic extends ShapeCommon {
  kind: "Ellipse";
  extent: [number, number, number, number];
  startAngle?: number;
  endAngle?: number;
  closure?: "Open" | "Chord" | "Arc";
}

/** MLS §18.6.5.5 */
export interface TextGraphic extends GraphicCommon {
  kind: "Text";
  extent: [number, number, number, number];
  textString?: string;
  fontSize?: number;
  textColor?: Color;
  textStyle?: number[];
  /** TextAlignment — expressed as {h, v} where each is -1 | 0 | 1 */
  horizontalAlignment?: -1 | 0 | 1;
  verticalAlignment?: -1 | 0 | 1;
}

/** MLS §18.6.5.6 */
export interface BitmapGraphic extends GraphicCommon {
  kind: "Bitmap";
  extent: [number, number, number, number];
  fileName?: string;
  imageSource?: string;
}

export type Graphic =
  | LineGraphic
  | PolygonGraphic
  | RectangleGraphic
  | EllipseGraphic
  | TextGraphic
  | BitmapGraphic;

/**
 * Placement of a component instance in a diagram.
 * MLS §18.6.2. Transformation order is: extent (scale/flip) -> rotation ->
 * origin (translate). This ordering is a common source of incorrect rendering.
 */
export interface Placement {
  /** [x1,y1,x2,y2] rectangle the component's coordinate system maps onto. */
  extent: [number, number, number, number];
  transformation?: "T" | "R" | "F";
  /** Rotation in degrees, CCW, about {0,0} — NOT about the extent centre. */
  rotation?: number;
  origin?: [number, number];
  visible?: boolean | string;
}

/** A connector (port) definition on a component class. */
export interface PortDef {
  name: string;
  /** Fully-qualified connector type, e.g. Modelica.Electrical.Analog.Interfaces.Pin */
  type: string;
  /** true if the connector class contains a `flow` variable. */
  isFlow: boolean;
  /** Primitive-typed scalar connectors carry a direction. */
  causality: "acausal" | "input" | "output";
  /**
   * The declaration's enabling condition, e.g. `useSupport` for
   * `Support support(...) if useSupport`.
   *
   * A conditional connector does not EXIST unless the condition holds, so a
   * wire drawn to one produces a model OpenModelica rejects. Carried here so the
   * inspector can grey the port out and the editor can refuse the wire, instead
   * of letting the mistake surface at compile time.
   */
  condition?: string;
}

/** A class taken from the Modelica Standard Library (or user source). */
export interface ComponentClass {
  /** Fully qualified name, e.g. Modelica.Electrical.Analog.Basic.Resistor */
  name: string;
  /** Short name, e.g. Resistor */
  shortName: string;
  comment?: string;
  /** Icon-layer graphics, already in the class's own coordinate system. */
  icon: Graphic[];
  /** Diagram-layer graphics, when the class defines them. */
  diagram: Graphic[];
  ports: PortDef[];
  /** Parameters exposed via the Dialog annotation, for auto-generated UI. */
  parameters: ParameterDef[];
  /**
   * Where each port sits in the class's canonical (-100..100) icon space,
   * derived from the connector instance's own `Placement`.
   *
   * This is what makes wires land exactly on pins, including for rotated and
   * mirrored instances. Ports absent from this map have no declared placement
   * and are drawn at the icon centre.
   */
  portPositions: Record<string, [number, number]>;
  /** True when the class has no `Icon` annotation (draw a placeholder). */
  hasIcon: boolean;
  /** Optional path to a bitmap icon (modelica:// URI resolved to disk). */
  iconBitmap?: string;
}

export interface ParameterDef {
  name: string;
  type: string;
  /** Literal default from the declaration, if it is a simple literal. */
  defaultValue?: string;
  unit?: string;
  comment?: string;
  min?: number;
  max?: number;
  /**
   * An initial value rather than a parameter: a `start` modifier on a state.
   *
   * The distinction matters because the two are set differently. A parameter
   * can be changed at run time with `-override`, which takes about 20 ms. A
   * `start` cannot — OpenModelica reports "override variable name not found" —
   * so editing one rewrites the model and recompiles.
   */
  isStart?: boolean;
}

/**
 * A declared variable: a `Real`, `Integer`, `Boolean` or similar.
 *
 * Kept apart from components because it is not drawn. It still has to survive a
 * round trip and its `parameter` values are still overridable, so it is part of
 * the model rather than discarded.
 */
export interface VariableInstance {
  id: string;
  type: string;
  params: Record<string, string>;
  prefixes?: string[];
  suffixDims?: string;
}

/** A component instance placed in the user's diagram. */
export interface ComponentInstance {
  /** Instance name, e.g. "r1" */
  id: string;
  /** Fully qualified class name. */
  className: string;
  placement: Placement;
  /** Parameter overrides written as Modelica expressions. */
  params: Record<string, string>;
  /**
   * Declaration prefixes that change what the instance IS, rather than how it is
   * configured: `inner`, `outer`, `flow`, `stream`, `replaceable`, `constant`.
   *
   * `inner` is load-bearing. Fluid and thermal components reference an `outer
   * system`, so dropping it from the instance that declares it makes the model
   * fail to compile with "an inner declaration for outer element 'system' could
   * not be found".
   *
   * `parameter` is deliberately NOT stored here: the inspector edits those as
   * ordinary fields, and re-emitting the prefix would move them out of the
   * editable set.
   */
  prefixes?: string[];
  /**
   * Dimensions written after the name, as source text, e.g. `[Medium.nX]`.
   * The expression need not be a literal, so it is kept verbatim.
   */
  suffixDims?: string;
  /**
   * Enabling condition of a conditional declaration, e.g. `use_p_in`.
   *
   * A conditional connector only exists when this holds. Dropping it produces a
   * declaration that references parameters it is not meant to, which does not
   * compile.
   */
  condition?: string;
}

/** A connection between two connector instances. */
export interface Connection {
  id: string;
  from: ConnectorRef;
  to: ConnectorRef;
  /** Routed waypoints in diagram coordinates, from the connect() Line annotation. */
  points: number[];
  /** Wire colour; MSL uses {0,0,127} for signal connections. */
  color?: Color;
}

export interface ConnectorRef {
  /** Component instance id. */
  component: string;
  /** Connector (port) name on that component. */
  port: string;
}

/** The whole user model. */
export interface DiagramModel {
  /** Model class name. */
  name: string;
  comment?: string;
  components: ComponentInstance[];
  /**
   * Declared variables: drawn nowhere, but part of the model.
   *
   * Optional so a model persisted before this field existed still loads; it is
   * re-parsed from source when absent.
   */
  variables?: VariableInstance[];
  /**
   * Hand-written equations, verbatim from the source.
   *
   * The diagram models components and wires; it has no representation for
   * `der(h) = v`. Keeping them as text is what makes the round trip lossless —
   * without it a model like `BouncingBall` serialized to declarations and an
   * empty `equation` section, which OpenModelica rejects as under-determined.
   */
  equations?: string[];
  connections: Connection[];
  /** Free-floating annotations/text placed in the diagram layer. */
  graphics: Graphic[];
}

export function emptyDiagram(name = "MyModel"): DiagramModel {
  return { name, components: [], connections: [], graphics: [] };
}

/** Viewport for pan/zoom, in diagram coordinates. */
export interface Viewport {
  x: number;
  y: number;
  scale: number;
}
