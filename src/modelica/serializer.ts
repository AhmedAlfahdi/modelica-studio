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
  Placement,
  VariableInstance,
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
    if (v === undefined) return;
    // An attribute that was written as `DynamicSelect(editing, other)` is written
    // back as that call. The parsed value is the EDITING argument — see
    // `Graphic.dynamic` — so emitting it alone would turn an animated attribute
    // into a constant in the user's own source, which is a silent simplification
    // of their model rather than a formatting difference.
    const dyn = g.dynamic?.[k];
    parts.push(`${k}=${dyn ? `DynamicSelect(${dyn.editing}, ${dyn.other})` : v}`);
  };

  // Common properties come first, matching OMEdit's own ordering.
  if (g.visible === false) add("visible", "false");

  switch (g.kind) {
    case "Line": {
      const l = g;
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

  const prefix = model.partial ? "partial " : "";
  const header = model.comment
    ? `${prefix}model ${model.name} ${quote(model.comment)}`
    : `${prefix}model ${model.name}`;
  lines.push(header);

  // The base classes, verbatim. Without them the model is not the model: equations, parameters
  // and connectors all arrive through `extends`, and this line was never written.
  for (const clause of model.extends ?? []) {
    lines.push(`${ind}${clause}`);
  }

  // The class's own Icon, so it goes on looking like itself where it is used. Regenerated from
  // the parsed graphics — which are already in the class's coordinate system — rather than kept
  // as text, because an icon is graphics and this file owns how graphics are written.
  if ((model.icon ?? []).length) {
    lines.push(`${ind}annotation(Icon(graphics={`);
    for (const g of model.icon ?? []) lines.push(`${ind}${ind}${serializeGraphic(g)},`);
    // `}))`, not `))`: the opening brace of `graphics={` has to be closed. Written as `))` the
    // annotation is not valid Modelica, and the parser then reads the rest of the class as part
    // of an unbalanced expression — the model came back EMPTY after one save.
    lines.push(`${ind}}));`);
  }

  // Documentation is prose and is written back exactly as it was read.
  if (model.documentation) lines.push(`${ind}${model.documentation}`);
  if ((model.extends ?? []).length || (model.icon ?? []).length || model.documentation) {
    lines.push("");
  }

  // Declarations, public first and protected after, which is the order the grammar allows. A
  // `protected` section is part of the interface: writing its declarations back as public
  // publishes what the class was hiding.
  const publicVars = (model.variables ?? []).filter((v) => v.visibility !== "protected");
  const protectedVars = (model.variables ?? []).filter((v) => v.visibility === "protected");
  const publicComps = model.components.filter((c) => c.visibility !== "protected");
  const protectedComps = model.components.filter((c) => c.visibility === "protected");

  // Variable declarations. Emitted without a Placement: a variable has no
  // position, and giving it one is what put three stacked boxes on the canvas.
  for (const v of publicVars) {
    lines.push(serializeVariable(v, ind));
  }
  if (publicVars.length) lines.push("");

  // Component declarations
  if (publicComps.length) {
    lines.push(`${ind}// Components`);
    for (const c of publicComps) {
      lines.push(
        ind +
          serializeComponent(
            c.className,
            c.id,
            c.placement,
            c.params,
            c.prefixes,
            c.suffixDims,
            c.condition,
            c.comment
          )
      );
    }
    lines.push("");
  }

  if (protectedVars.length || protectedComps.length) {
    lines.push("protected");
    for (const v of protectedVars) lines.push(serializeVariable(v, ind));
    for (const c of protectedComps) {
      lines.push(
        ind +
          serializeComponent(
            c.className,
            c.id,
            c.placement,
            c.params,
            c.prefixes,
            c.suffixDims,
            c.condition,
            c.comment
          )
      );
    }
    lines.push("");
  }

  // Free graphics live in the model's own Diagram layer
  if (model.graphics.length) {
    lines.push(`${ind}annotation(Diagram(graphics={`);
    for (const g of model.graphics) {
      lines.push(`${ind}${ind}${serializeGraphic(g)},`);
    }
    // Same missing brace as the Icon above: `Diagram(graphics={…})`, not `Diagram(…)`.
    lines.push(`${ind}}));`);
    lines.push("");
  }

  // The sections, each under its own keyword. `initial equation` is not an `equation`: reading
  // it as one rewrote a state's initial condition as an ordinary equation, which is a different
  // model. An algorithm keeps its own keyword too, being order rather than equations.
  const writeSection = (keyword: string, statements: string[], always = false) => {
    if (statements.length === 0 && !always) return;
    lines.push(keyword);
    for (const statement of statements) {
      // Dedented by its common leading whitespace and re-indented as a unit, so a `when` or an
      // `if` body keeps its relative shape without drifting two spaces on every save.
      for (const line of dedent(statement.split("\n"))) {
        lines.push(line.length ? ind + line : line);
      }
    }
    lines.push("");
  };
  const connectionLines = model.connections.map(
    (cn) =>
      ind + serializeConnection(cn.from.component, cn.from.port, cn.to.component, cn.to.port, cn.points, cn.color)
  );
  writeSection("initial equation", model.initialEquations ?? []);
  writeSection("initial algorithm", model.initialAlgorithm ?? []);
  // Always written, even with nothing in it: a model that has no equations is still a class, and
  // the panel and the tests both read the section as the sign that the body was understood.
  writeSection("equation", [...connectionLines, ...(model.equations ?? [])], true);
  writeSection("algorithm", model.algorithm ?? []);

  lines.push(`end ${model.name};`);
  return lines.join("\n") + "\n";
}

/**
 * Emit one variable declaration.
 *
 * A variable is a declaration with no position, so it is written without a
 * Placement annotation: `parameter Real m = 1 "kg";`.
 *
 * A declaration binds its value with `=` — `parameter Real e=0.9`. Everything
 * else is a modifier list — `Real h(start=1, fixed=true)`.
 *
 * The parser records a declaration's binding under the declared name itself
 * (`modifiers["e"] = "0.9"`), which `toParameterDef` relies on for defaults.
 * Rather than change that key and ripple through the library reader, the
 * binding is recognised here: a parameter whose name matches its own
 * declaration. Writing it as a modifier produced `Real e(e=0.9)`, which is
 * not what the model said.
 */
/**
 * Turn modifier entries into the text inside the parentheses.
 *
 * `head.rest=value` becomes `head(rest=value)`, and members of the SAME head are gathered into
 * one set: `head(a=1, b=2)`. Both writers need this and only one had it, so a record variable
 * declared `Complex s(re(final unit="1"), im(final unit="1"))` — MSL's quasi-static switches,
 * and every machine in `Electrical.QuasiStatic` — came back as `s(re.final unit="1")`, which is
 * not Modelica: `final unit` is a modifier prefix and its member, not an identifier, so the
 * dotted form cannot express it while the parenthesised one is exactly what was written.
 *
 * A `head` that also has a plain value is ONE declaration with a binding —
 * `p_ambient(displayUnit="bar") = 101325` — because emitting them separately reads as two
 * modifiers, and the round trip lost the value.
 */
/**
 * Fold a valueless modifier into the member it prefixes.
 *
 * `parameter Integer m(final min=1) = 3` parses to `{final: "", min: "1", m: "3"}`: a modifier
 * prefix is written without a value, so the parser records it as a key with an empty one. Both
 * writers skipped empty values — reasonably, they are usually nothing — and every `final` in
 * the class went with them. MSL's machine models have seven in one class, and each is a
 * modification the author forbade.
 *
 * Only the known prefixes are folded. An empty value that is not one of these stays as it was:
 * a key with no value and no meaning is not something to invent one for.
 */
const MODIFIER_PREFIXES = new Set(["final", "each", "redeclare"]);
function mergeModifierPrefixes(entries: Array<[string, string]>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let pending = "";
  for (const [k, v] of entries) {
    if (v === "" && MODIFIER_PREFIXES.has(k)) {
      pending = pending ? `${pending} ${k}` : k;
      continue;
    }
    out.push([pending ? `${pending} ${k}` : k, v]);
    pending = "";
  }
  if (pending) out.push([pending, ""]);
  return out;
}

function renderModifiers(entries: Array<[string, string]>): string {
  const nested = new Map<string, string[]>();
  const plain: Array<[string, string]> = [];
  for (const [k, v] of mergeModifierPrefixes(entries)) {
    const dot = k.indexOf(".");
    if (dot < 0) {
      plain.push([k, v]);
      continue;
    }
    const head = k.slice(0, dot);
    const list = nested.get(head) ?? [];
    list.push(`${k.slice(dot + 1)}=${v}`);
    nested.set(head, list);
  }
  const parts: string[] = [];
  for (const [k, v] of plain) {
    const members = nested.get(k);
    if (members) {
      parts.push(`${k}(${members.join(", ")}) = ${v}`);
      nested.delete(k);
      continue;
    }
    parts.push(`${k}=${v}`);
  }
  for (const [head, members] of nested) parts.push(`${head}(${members.join(", ")})`);
  return parts.join(", ");
}

export function serializeVariable(v: VariableInstance, indent = ""): string {
  const entries = mergeModifierPrefixes(
    Object.entries(v.params).filter(([, value]) => value !== undefined && value !== null)
  ).filter(([, value]) => value !== "");
  const binding = entries.find(([k]) => k === "=" || k === v.id);
  const mods = entries.filter(([k]) => k !== "=" && k !== v.id);
  // BOTH, when a declaration has both: `parameter Real x(unit = "V") = 5` is a
  // modifier list AND a binding. Emitting only the binding silently dropped the
  // unit, which is a quiet loss rather than a loud one -- the model still
  // compiled, with the wrong declaration.
  const modList = mods.length ? `(${renderModifiers(mods)})` : "";
  const tail = binding ? `${modList}=${binding[1]}` : modList;
  const pre = v.prefixes?.length ? `${v.prefixes.join(" ")} ` : "";
  // The declaration's comment, which this never wrote: a rebuild stripped every one of them,
  // and the class comment above it was kept, so the loss was invisible until a file was read.
  const say = v.comment ? ` ${quote(v.comment)}` : "";
  return `${indent}${pre}${v.type} ${v.id}${v.suffixDims ?? ""}${tail}${say};`;
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
  condition = "",
  /** The declaration's own comment, written after the annotation-placement. */
  comment = ""
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
  // A parameter named after the declaration is the declaration's own BINDING, not
  // a modifier: `Real x = 1` is stored as `params.x = "1"`. Emitting it as a
  // modifier produces `x(x = 1)`, which says "set the member x of the type Real"
  // -- and Real has no member x, so OpenModelica answers "Modified element x not
  // found in class Real" and the model will not build.
  //
  // This was the whole shape of a reported loss: the serializer wrote the broken
  // form, the AI fixed the TEXT, and the diagram kept the broken parameter -- so
  // the next save and the next restore put the fault back.
  //
  // `"="` is the parser's mark for it, and the reason it exists: the id-keyed entry alone
  // cannot say which of the two shapes it is. `Real x = 0` records `x` as a binding;
  // `Inductor L(L=18)` records `L` as a modifier of the member `L` — and a component may not
  // have a binding at all (OpenModelica: "Component 'L' may not have a binding equation due to
  // class specialization 'model'"), so taking it for one wrote `Inductor L(...) = 18` and the
  // file stopped building. Guessing by type name is worse: it turns
  // `SI.Density air_density = 1.225` into `air_density(air_density=1.225)`, which is 3640
  // declarations in MSL. The parser states which it is, and this reads the statement.
  // Two signals, the parser's mark first and a declaration prefix second. The prefix is the
  // fallback for a diagram that was STORED before the mark existed: a snapshot holding
  // `{air_density: "1.225"}` with `prefixes: ["parameter"]` is a binding, because a parameter is
  // not a schematic symbol and cannot be one. What remains genuinely ambiguous — a prefix-less
  // dotted alias with a binding and no mark — can only come from such a snapshot, and the file
  // itself is re-read on the next open, which marks it.
  const declarationPrefix = (prefixes ?? []).some((pre) =>
    ["parameter", "constant", "discrete", "input", "output"].includes(pre)
  );
  const writesBinding =
    typeof params["="] === "string" ||
    (declarationPrefix && typeof params[id] === "string");
  const binding =
    typeof params["="] === "string" ? params["="] : writesBinding ? params[id] : "";

  const nested = new Map<string, string[]>();
  const plain: Array<[string, string]> = [];
  for (const [k, v] of mergeModifierPrefixes(Object.entries(params))) {
    if (v === undefined || v === null || v === "") continue;
    if (isRedeclarePackage && (k === "Medium" || k === "redeclare" || k === "package")) continue;
    // The mark itself, and the id-keyed copy of the SAME binding when there is one. With no
    // mark, an id-keyed entry is a member modifier: that is `Inductor L(L=18)`.
    if (k === "=" || (writesBinding && k === id)) continue;
    const dot = k.indexOf(".");
    if (dot < 0) {
      plain.push([k, v]);
      continue;
    }
    const head = k.slice(0, dot);
    const rest = k.slice(dot + 1);
    const list = nested.get(head) ?? [];
    list.push(`${rest}=${v}`);
    nested.set(head, list);
  }
  // A key that is BOTH a value and the head of nested members is ONE declaration with a
  // binding: `p_ambient(displayUnit="bar") = 101325`. Emitted separately they read as two
  // modifiers — `p_ambient=101325, p_ambient(displayUnit="bar")` — which is not the same
  // declaration, and the round trip lost the value. Every parameter in the inspector is this
  // shape as soon as it carries a member modifier, so `displayUnit` could not be recorded
  // without it.
  for (const [k, v] of plain) {
    const members = nested.get(k);
    if (members) {
      mods.push(`${k}(${members.join(", ")}) = ${v}`);
      nested.delete(k);
      continue;
    }
    mods.push(`${k}=${v}`);
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
  // The binding comes after the modifier list, which is where Modelica wants it:
  // `Real x(start = 1) = 5`.
  const bind = binding ? ` = ${binding}` : "";
  const say = comment ? ` ${quote(comment)}` : "";
  return `${pre}${className} ${id}${dims}${modStr}${cond}${bind}${say} ${ann};`;
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

/** Remove the common leading whitespace from a block of lines. */
function dedent(lines: string[]): string[] {
  // The FIRST line is skipped when the common indent is measured, and that is the whole point of
  // this function. A captured statement starts at its first token, so line one has no indent of
  // its own; including it makes the minimum zero, nothing is dedented, and every line but the
  // first gains `ind` on each save. Writing a `for` loop twice moved its body two spaces right
  // each time — the file churned forever and the diff grew without bound. Measured on the book's
  // `Rod_ForLoop`: `    end for;` came back as `      end for;`.
  const indents = lines
    .slice(1)
    .filter((l) => l.trim().length > 0)
    .map((l) => /^[ \t]*/.exec(l)![0].length);
  const common = indents.length ? Math.min(...indents) : 0;
  // Line one is left alone as well: it has no indent of its own, so slicing it removes its first
  // `common` CHARACTERS. That turned `for i in 2:(n-1) loop` into `r i in 2:(n-1) loop` and
  // `k[1]*C[1]*C[2]` into `[1]*C[1]*C[2]` — a corrupt file, not a cosmetic one.
  return common
    ? lines.map((l, i) => (i === 0 || l.length < common ? l : l.slice(common)))
    : lines;
}
