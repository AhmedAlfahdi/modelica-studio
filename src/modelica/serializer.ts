/**
 * Modelica serializer.
 *
 * Emits a valid Modelica model class from a DiagramModel, including the
 * graphical annotations (`Placement`, `Line`, `Rectangle`, ...) so that the
 * result opens correctly in OMEdit and other Modelica tools.
 *
 * Transformation is written back in the order MLS §18.6.2 expects, and
 * numbers are formatted compactly to keep diffs small and readable.
 */

import type {
  Color,
  ComponentClass,
  DiagramModel,
  Graphic,
  LineGraphic,
  Placement,
} from "./types";

/* ------------------------------------------------------------------ */
/* Number / value formatting                                           */
/* ------------------------------------------------------------------ */

/**
 * Format a number the way Modelica tools conventionally do: no exponent for
 * ordinary magnitudes, and no trailing `.0`.
 */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return String(n);
  // Trim floating point noise (e.g. 0.30000000000000004)
  const r = Number(n.toFixed(6));
  if (Number.isInteger(r)) return String(r);
  return String(r);
}

function color(c: Color | undefined, fallback?: Color): Color | undefined {
  if (!c) return fallback;
  return c;
}

function colorStr(c: Color | undefined, fallback: Color): string {
  const v = c ?? fallback;
  return `{${v[0]},${v[1]},${v[2]}}`;
}

function pointsStr(points: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    parts.push(`{${fmt(points[i])},${fmt(points[i + 1])}}`);
  }
  return `{${parts.join(",")}}`;
}

function extentStr(e: [number, number, number, number]): string {
  return `{{${fmt(e[0])},${fmt(e[1])}},{${fmt(e[2])},${fmt(e[3])}}}`;
}

/* ------------------------------------------------------------------ */
/* Graphic serialization                                               */
/* ------------------------------------------------------------------ */

/** Emit one graphical primitive as `Kind(prop=value, ...)`. */
export function serializeGraphic(g: Graphic): string {
  const parts: string[] = [];
  const add = (k: string, v: string | undefined) => {
    if (v !== undefined) parts.push(`${k}=${v}`);
  };

  // Common properties come first, matching OMEdit's own ordering.
  if (g.visible === false) add("visible", "false");

  switch (g.kind) {
    case "Line": {
      const l = g as LineGraphic;
      add("points", pointsStr(l.points));
      add("color", colorStr(l.color, [0, 0, 0]));
      if (l.pattern) add("pattern", enumStr(l.pattern));
      if (l.thickness !== undefined) add("thickness", fmt(l.thickness));
      if (l.arrow) {
        add("arrow", `{${enumStr(l.arrow[0])},${enumStr(l.arrow[1])}}`);
      }
      if (l.arrowSize !== undefined) add("arrowSize", fmt(l.arrowSize));
      if (l.smooth) add("smooth", enumStr(l.smooth));
      break;
    }
    case "Polygon":
      add("points", pointsStr(g.points));
      add("fillColor", colorStr(g.fillColor, [0, 0, 0]));
      add("fillPattern", enumStr(g.fillPattern ?? "None"));
      add("lineColor", colorStr(g.lineColor, [0, 0, 0]));
      if (g.lineThickness !== undefined) add("lineThickness", fmt(g.lineThickness));
      if (g.smooth) add("smooth", enumStr(g.smooth));
      break;
    case "Rectangle":
      add("extent", extentStr(g.extent));
      add("lineColor", colorStr(g.lineColor, [0, 0, 0]));
      add("fillColor", colorStr(g.fillColor, [0, 0, 0]));
      add("fillPattern", enumStr(g.fillPattern ?? "None"));
      if (g.borderPattern) add("borderPattern", enumStr(g.borderPattern));
      if (g.radius !== undefined) add("radius", fmt(g.radius));
      if (g.lineThickness !== undefined) add("lineThickness", fmt(g.lineThickness));
      break;
    case "Ellipse":
      add("extent", extentStr(g.extent));
      add("lineColor", colorStr(g.lineColor, [0, 0, 0]));
      add("fillColor", colorStr(g.fillColor, [0, 0, 0]));
      add("fillPattern", enumStr(g.fillPattern ?? "None"));
      if (g.startAngle !== undefined) add("startAngle", fmt(g.startAngle));
      if (g.endAngle !== undefined) add("endAngle", fmt(g.endAngle));
      if (g.closure) add("closure", enumStr(g.closure));
      if (g.lineThickness !== undefined) add("lineThickness", fmt(g.lineThickness));
      break;
    case "Text":
      add("extent", extentStr(g.extent));
      if (g.textString !== undefined) add("textString", quote(g.textString));
      if (g.fontSize !== undefined) add("fontSize", fmt(g.fontSize));
      add("textColor", colorStr(g.textColor, [0, 0, 0]));
      if (g.textStyle) add("textStyle", `{${g.textStyle.map((n) => fmt(n)).join(",")}}`);
      if (g.horizontalAlignment !== undefined)
        add("horizontalAlignment", String(g.horizontalAlignment));
      if (g.verticalAlignment !== undefined)
        add("verticalAlignment", String(g.verticalAlignment));
      break;
    case "Bitmap":
      add("extent", extentStr(g.extent));
      if (g.fileName) add("fileName", quote(g.fileName));
      if (g.imageSource !== undefined) add("imageSource", g.imageSource);
      break;
  }

  // origin / rotation apply to every primitive
  if (g.origin && (g.origin[0] !== 0 || g.origin[1] !== 0)) {
    add("origin", `{${fmt(g.origin[0])},${fmt(g.origin[1])}}`);
  }
  if (g.rotation !== undefined && g.rotation !== 0) {
    add("rotation", fmt(g.rotation));
  }

  return `${g.kind}(${parts.join(", ")})`;
}

/** Quote a Modelica string literal. */
export function quote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Enumeration literals are bare identifiers, not strings. */
function enumStr(v: string): string {
  return v;
}

/**
 * Serialize a Placement annotation.
 *
 * Modelica requires the geometry to sit inside a `transformation` object:
 *     annotation(Placement(transformation(extent={{-10,-10},{10,10}})))
 * Emitting `Placement(extent=...)` instead is not valid Modelica — it is the
 * shape of the internal Placement class, not of the language — and OpenModelica
 * rejects it.
 */
export function serializePlacement(p: Placement): string {
  const t: string[] = [`extent=${extentStr(p.extent)}`];
  if (p.rotation !== undefined && p.rotation !== 0) {
    t.push(`rotation=${fmt(p.rotation)}`);
  }
  if (p.origin && (p.origin[0] !== 0 || p.origin[1] !== 0)) {
    t.push(`origin={${fmt(p.origin[0])},${fmt(p.origin[1])}}`);
  }
  const parts: string[] = [`transformation(${t.join(", ")})`];
  if (p.visible === false) parts.push("visible=false");
  return `Placement(${parts.join(", ")})`;
}

/* ------------------------------------------------------------------ */
/* Model serialization                                                 */
/* ------------------------------------------------------------------ */

export interface SerializeOptions {
  /** Indent unit; defaults to two spaces. */
  indent?: string;
  /** Resolve a class name to its definition, for emitting `uses`/imports. */
  lookup?: (className: string) => ComponentClass | undefined;
}

/**
 * Serialize a DiagramModel to a complete Modelica `model` class.
 *
 * The output is deliberately conventional (component declarations with
 * Placement annotations, then connect statements with Line annotations) so it
 * round-trips cleanly through OMEdit.
 */
export function serializeDiagram(
  model: DiagramModel,
  opts: SerializeOptions = {}
): string {
  const ind = opts.indent ?? "  ";
  const lines: string[] = [];

  const header = model.comment
    ? `model ${model.name} ${quote(model.comment)}`
    : `model ${model.name}`;
  lines.push(header);

  // Variable declarations. Emitted without a Placement: a variable has no
  // position, and giving it one is what put three stacked boxes on the canvas.
  for (const v of model.variables ?? []) {
    const entries = Object.entries(v.params).filter(
      ([, value]) => value !== undefined && value !== null && value !== ""
    );
    // A declaration binds its value with `=` — `parameter Real e=0.9`. Everything
    // else is a modifier list — `Real h(start=1, fixed=true)`.
    //
    // The parser records a declaration's binding under the declared name itself
    // (`modifiers["e"] = "0.9"`), which `toParameterDef` relies on for defaults.
    // Rather than change that key and ripple through the library reader, the
    // binding is recognised here: a parameter whose name matches its own
    // declaration. Writing it as a modifier produced `Real e(e=0.9)`, which is
    // not what the model said.
    const binding = entries.find(([k]) => k === "=" || k === v.id);
    const mods = entries.filter(([k]) => k !== "=" && k !== v.id);
    const tail = binding
      ? `=${binding[1]}`
      : mods.length
        ? `(${mods.map(([k, value]) => `${k}=${value}`).join(", ")})`
        : "";
    const pre = v.prefixes?.length ? `${v.prefixes.join(" ")} ` : "";
    lines.push(`${ind}${pre}${v.type} ${v.id}${v.suffixDims ?? ""}${tail};`);
  }
  if ((model.variables ?? []).length) lines.push("");

  // Component declarations
  if (model.components.length) {
    lines.push(`${ind}// Components`);
    for (const c of model.components) {
      lines.push(
        ind +
          serializeComponent(
            c.className,
            c.id,
            c.placement,
            c.params,
            c.prefixes,
            c.suffixDims,
            c.condition
          )
      );
    }
    lines.push("");
  }

  // Free graphics live in the model's own Diagram layer
  if (model.graphics.length) {
    lines.push(`${ind}annotation(Diagram(`);
    for (const g of model.graphics) {
      lines.push(`${ind}${ind}${serializeGraphic(g)},`);
    }
    lines.push(`${ind}));`);
    lines.push("");
  }

  // Equations
  lines.push("equation");
  for (const cn of model.connections) {
    lines.push(ind + serializeConnection(cn.from.component, cn.from.port, cn.to.component, cn.to.port, cn.points, cn.color));
  }

  lines.push(`end ${model.name};`);
  return lines.join("\n") + "\n";
}

/** Emit one component declaration. */
export function serializeComponent(
  className: string,
  id: string,
  placement: Placement,
  params: Record<string, string> = {},
  prefixes: string[] = [],
  /** Dimensions written after the name, e.g. `[Medium.nX]`. */
  suffixDims = "",
  /** Enabling condition of a conditional declaration, e.g. `use_p_in`. */
  condition = ""
): string {
  // `redeclare package Medium = X` is stored as three separate entries, because
  // the parser records each modifier keyword on its own. Emitting only `Medium=X`
  // is invalid Modelica: OpenModelica reads it as an attempt to redefine a
  // partial class and reports "component X contains the definition of a partial
  // class Medium". The three are therefore rebuilt into one declaration here.
  //
  // This has to happen BEFORE the empty-value filter below, because the
  // `redeclare` and `package` parts carry no value of their own.
  const isRedeclarePackage = params.redeclare !== undefined && params.package !== undefined;

  const mods: string[] = [];
  if (isRedeclarePackage && typeof params.Medium === "string" && params.Medium) {
    mods.push(`redeclare package Medium=${params.Medium}`);
  }
  // Dotted keys name nested modifiers and must be regrouped: `T.start=373.15`
  // is not Modelica, `T(start=373.15)` is. Emitting the flat form produced a
  // model that would not even parse, while the diagram still looked right.
  const nested = new Map<string, string[]>();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (isRedeclarePackage && (k === "Medium" || k === "redeclare" || k === "package")) continue;
    const dot = k.indexOf(".");
    if (dot < 0) {
      mods.push(`${k}=${v}`);
      continue;
    }
    const head = k.slice(0, dot);
    const rest = k.slice(dot + 1);
    const list = nested.get(head) ?? [];
    list.push(`${rest}=${v}`);
    nested.set(head, list);
  }
  for (const [head, parts] of nested) mods.push(`${head}(${parts.join(", ")})`);
  const modStr = mods.length ? `(${mods.join(", ")})` : "";
  const ann = `annotation(Placement(${stripPlacementWrapper(serializePlacement(placement))}))`;
  // Declaration prefixes come before the type: `inner Modelica.Fluid.System system`.
  const pre = prefixes.length ? `${prefixes.join(" ")} ` : "";
  // Dimensions belong after the name and before the modifier list, and a
  // conditional declaration ends with `if <expr>`. Both are load-bearing: a
  // conditional connector without its `if` clause does not compile, because the
  // declaration then references parameters it is not meant to.
  const dims = suffixDims ? suffixDims : "";
  const cond = condition ? ` if ${condition}` : "";
  return `${pre}${className} ${id}${dims}${modStr}${cond} ${ann};`;
}

/** serializePlacement already returns `Placement(...)`; avoid double wrapping. */
function stripPlacementWrapper(s: string): string {
  const m = /^Placement\((.*)\)$/s.exec(s);
  return m ? m[1] : s;
}

/** Emit one connect statement, including any routed waypoints. */
export function serializeConnection(
  fromComp: string,
  fromPort: string,
  toComp: string,
  toPort: string,
  points: number[],
  color?: Color
): string {
  const a = fromComp ? `${fromComp}.${fromPort}` : fromPort;
  const b = toComp ? `${toComp}.${toPort}` : toPort;
  let ann = "";
  if (points.length >= 4) {
    const p: string[] = [];
    p.push(`points=${pointsStr(points)}`);
    // MSL marks signal connections with color={0,0,127}
    if (color && !(color[0] === 0 && color[1] === 0 && color[2] === 0)) {
      p.push(`color=${colorStr(color, [0, 0, 0])}`);
    }
    ann = ` annotation(Line(${p.join(", ")}))`;
  }
  return `connect(${a}, ${b})${ann};`;
}
