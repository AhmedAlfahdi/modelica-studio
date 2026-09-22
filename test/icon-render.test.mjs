/**
 * Systematic rendering checks over the WHOLE library.
 *
 * The bugs this file exists for were each found by a person noticing one
 * component that looked wrong:
 *
 *   - `Logical.And` rendered as an empty box, because its icon is a rectangle
 *     plus a label and the label was being drawn at the 1px floor. That was true
 *     of all 1116 in-box labels in the library.
 *   - Every fill pattern, dash pattern, Bezier curve and border pattern was
 *     silently dropped, because the parser stored `FillPattern.Backward` and the
 *     renderer compared it against `Backward`.
 *   - `ReceiveBoolean` drew "receive" wider than the symbol it labels, because
 *     the label was sized from the extent's height alone.
 *
 * Each was one instance of a fault that held for hundreds of classes. Spotting
 * them one screenshot at a time is not a method, so these tests make the
 * assertions over every class the palette can offer, and the failing case is
 * reported with the class name and the numbers.
 *
 * Run with:  node --test test/
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";

const MSL_CANDIDATES = [
  "/home/para/.openmodelica/libraries/Modelica 4.1.0+maint.om",
  "/home/para/.openmodelica/libraries/Modelica 3.2.3+maint.om",
];
const MSL = MSL_CANDIDATES.find((c) => fs.existsSync(c)) ?? null;

// One bundle holding both trees, so the output nests under `render/` and
// `modelica/` rather than at the top.
const LIB = buildLibs("icon-render", [
  "src/render/canvas.ts",
  "src/render/theme.ts",
  "src/modelica/library.ts",
  "src/modelica/parser.ts",
  "src/modelica/types.ts",
]);
const C = await import(path.join(LIB, "render/canvas.js"));
const T = await import(path.join(LIB, "render/theme.js"));
const { LibraryIndex } = await import(path.join(LIB, "modelica/library.js"));
const parserMod = await import(path.join(LIB, "modelica/parser.js"));

/**
 * Advance width per character, as a fraction of the font size.
 *
 * A real font's metric is not available to `node:test`, so this stands in for
 * it. It is what makes "does this label fit its box" a question with an answer:
 * the renderer asks `measureText` for the width, and this is the answer it gets.
 * 0.55em is a fair average for a sans-serif lower-case string, and it is the
 * same figure the browser produces for the labels involved to within a few
 * percent.
 */
const ADVANCE = 0.55;

/** A canvas context that records what was painted instead of painting it. */
function recorder() {
  const images = [];
  const state = { font: "", fillStyle: "", strokeStyle: "", lineDash: [] };
  const ctx = new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      switch (k) {
        case "canvas":
          return { width: 2000, height: 2000 };
        case "measureText":
          return (s) => ({
            width: String(s).length * ADVANCE * (/([\d.]+)px/.exec(t.font)?.[1] ?? 10),
          });
        case "createLinearGradient":
        case "createPattern":
          return () => ({ addColorStop() {} });
        case "setLineDash":
          // Recorded AND applied: `stroke` reads the current dash, so a recorder
          // that only logged the call would report every line as solid.
          return (v) => {
            t.lineDash = [...v];
            images.push({ op: "dash", dash: [...v] });
          };
        case "fill":
          return () => images.push({ op: "fill", style: t.fillStyle });
        case "stroke":
          return () => images.push({ op: "stroke", style: t.strokeStyle, dash: [...t.lineDash] });
        case "fillRect":
        case "strokeRect":
          return () => images.push({ op: "rect" });
        case "fillText":
          return (text) =>
            images.push({
              op: "text",
              text: String(text),
              px: parseFloat(/([\d.]+)px/.exec(t.font)?.[1] ?? "0"),
            });
        case "drawImage":
          return () => images.push({ op: "image" });
        default:
          return () => {};
      }
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
  return { ctx, images };
}

/** Draw one placed component and return everything it painted. */
function renderInstance(index, className, { id = "i1", params = {}, scale = 11 } = {}) {
  const lookup = (n) => index.describe(n);
  const { ctx, images } = recorder();
  C.drawComponent(
    ctx,
    { id, className, placement: { extent: [-10, -10, 10, 10] }, params },
    lookup(className),
    { x: 0, y: 0, scale },
    1,
    { lookup }
  );
  return images;
}

/** The paint operations, without the bookkeeping ones. */
const PAINTS = new Set(["fill", "stroke", "rect", "text", "image"]);
const painted = (images) => images.filter((i) => PAINTS.has(i.op));

/* ------------------------------------------------------------------ */

test("a label is sized to its extent, in both dimensions", () => {
  // MLS: "If the fontSize attribute is 0 the text is scaled to fit its extent."
  // Sizing from the height alone gave `ReceiveBoolean` a "receive" 254 units wide
  // in a 200-unit box.
  const def = {
    name: "T",
    shortName: "T",
    icon: [
      { kind: "Rectangle", extent: [-100, 100, 100, -100] },
      { kind: "Text", extent: [-100, 40, 100, -40], textString: "receive" },
    ],
    diagram: [],
    ports: [],
    portPositions: {},
    hasIcon: true,
    parameters: [],
  };
  const { ctx, images } = recorder();
  C.drawComponent(
    ctx,
    { id: "i1", className: "T", placement: { extent: [-10, -10, 10, 10] }, params: {} },
    def,
    { x: 0, y: 0, scale: 11 },
    1,
    { lookup: () => def }
  );
  const label = images.find((i) => i.op === "text" && i.text === "receive");
  assert.ok(label, "the label is drawn");
  // 200 canonical units across = 220px at this zoom, and it must fit inside.
  const width = "receive".length * ADVANCE * label.px;
  assert.ok(
    width <= 220 + 1,
    `the label fits its 200-unit box: ${width.toFixed(0)}px wide at ${label.px.toFixed(0)}px`
  );
  assert.ok(label.px > 20, `and is not shrunk to nothing: ${label.px.toFixed(1)}px`);

  // A zero-width box is the documented exception: MLS says use the height and do
  // not truncate. `Magnetic.FluxTubes` labels sit in boxes like {{40,0},{40,-30}}.
  const tall = {
    ...def,
    icon: [{ kind: "Text", extent: [40, 0, 40, -30], textString: "PE" }],
  };
  const second = recorder();
  C.drawComponent(
    second.ctx,
    { id: "i1", className: "T", placement: { extent: [-10, -10, 10, 10] }, params: {} },
    tall,
    { x: 0, y: 0, scale: 11 },
    1,
    { lookup: () => tall }
  );
  const pe = second.images.find((i) => i.op === "text" && i.text === "PE");
  assert.ok(pe, "a zero-width box still draws its label");
  assert.ok(
    Math.abs(pe.px - 33) < 2,
    `sized from the 30-unit height, not clipped to a zero width: got ${pe.px.toFixed(1)}px`
  );
});

test("every line pattern reaches the canvas", () => {
  // The renderer switches on the bare member name. A stored `LinePattern.Dash`
  // matched nothing, so 201 dashed lines drew solid and `LinePattern.None` --
  // "an invisible line" -- put an outline on 1018 graphics that ask for none.
  const theme = T.currentTheme();
  const draw = (pattern) => {
    const { ctx, images } = recorder();
    C.drawGraphic(
      ctx,
      { kind: "Line", points: [0, 0, 10, 10], color: [0, 0, 0], pattern },
      C.IDENTITY,
      1,
      theme
    );
    return images;
  };

  assert.equal(draw("None").filter((i) => i.op === "stroke").length, 0, "None draws no line");
  const solid = draw("Solid").filter((i) => i.op === "stroke");
  assert.equal(solid.length, 1, "Solid draws");
  assert.deepEqual(solid[0].dash, [], "and is not dashed");

  for (const pattern of ["Dash", "Dot", "DashDot", "DashDotDot"]) {
    const strokes = draw(pattern).filter((i) => i.op === "stroke");
    assert.equal(strokes.length, 1, `${pattern} draws`);
    assert.ok(strokes[0].dash.length > 0, `${pattern} sets a dash pattern, got ${strokes[0].dash}`);
  }
  // An absent pattern is Solid, not None.
  assert.equal(draw(undefined).filter((i) => i.op === "stroke").length, 1, "absent means Solid");
});

test("every fill pattern reaches the canvas", () => {
  const theme = T.currentTheme();
  const draw = (fillPattern) => {
    const { ctx, images } = recorder();
    C.drawGraphic(
      ctx,
      {
        kind: "Rectangle",
        extent: [-50, 50, 50, -50],
        lineColor: [0, 0, 0],
        fillColor: [192, 192, 192],
        fillPattern,
      },
      C.IDENTITY,
      1,
      theme
    );
    return images;
  };

  assert.equal(draw("None").filter((i) => i.op === "fill").length, 0, "None is not filled");
  const solid = draw("Solid");
  assert.equal(solid.filter((i) => i.op === "fill").length, 1, "Solid is filled");
  assert.equal(solid.filter((i) => i.op === "stroke").length, 1, "and has only its border");

  for (const pattern of ["Horizontal", "Vertical", "Cross", "Forward", "Backward", "CrossDiag"]) {
    const images = draw(pattern);
    assert.equal(images.filter((i) => i.op === "fill").length, 1, `${pattern} fills`);
    const hatch = images.filter((i) => i.op === "stroke").length;
    assert.ok(hatch > 2, `${pattern} draws its hatch, got ${hatch} strokes`);
    // MLS: the pattern is "drawn with the line color over the fill color", and it
    // has to differ from the fill or it is invisible either way.
    const hatchStyle = images.find((i) => i.op === "stroke").style;
    assert.notEqual(hatchStyle, "rgb(192,192,192)", `${pattern} hatches in the line colour`);
  }
});

test("no parsed graphic keeps a qualified enumeration name", { skip: !MSL && "no MSL installed" }, () => {
  // The link between the two tests above and the library itself. The renderer
  // switches on the bare member name, and the fault was on the PARSING side: it
  // stored `"FillPattern.Backward"`, which matched no case and fell through to
  // the default. Testing the renderer with bare names cannot catch that, so the
  // stored values are checked here, over every graphic the library declares.
  const index = new LibraryIndex();
  index.addDirectory(MSL);
  const FIELDS = ["pattern", "fillPattern", "smooth", "closure", "borderPattern"];
  const bad = [];
  let seen = 0;
  for (const [, cls] of index.classes) {
    for (const g of [...(cls.icon ?? []), ...(cls.diagram ?? [])]) {
      for (const f of FIELDS) {
        const v = g[f];
        if (typeof v !== "string") continue;
        seen++;
        if (v.includes(".")) bad.push(`${cls.qualifiedName}: ${g.kind}.${f}="${v}"`);
      }
      for (const a of g.arrow ?? []) {
        if (typeof a === "string" && a.includes(".")) {
          bad.push(`${cls.qualifiedName}: ${g.kind}.arrow="${a}"`);
        }
      }
    }
  }
  assert.ok(seen > 100, `the sweep actually ran: ${seen} enumeration values`);
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} enumeration values kept their type prefix`);
});

test("a `visible` condition survives parsing whatever form it takes", { skip: !MSL && "no MSL installed" }, () => {
  // `visible=(use_pder and use_pder2)` is a parenthesised EXPRESSION, and it was
  // read as a modifier list -- `{"use_pder": "and use_pder2"}` -- which is
  // neither `true` nor a string, so the graphic was hidden for good. The form
  // the library actually uses is asserted here rather than assumed.
  const index = new LibraryIndex();
  index.addDirectory(MSL);
  const bad = [];
  let conditional = 0;
  for (const [, cls] of index.classes) {
    for (const g of cls.icon ?? []) {
      const v = g.visible;
      if (v === undefined) continue;
      conditional++;
      if (typeof v !== "boolean" && typeof v !== "string") {
        bad.push(`${cls.qualifiedName}: ${g.kind}.visible=${JSON.stringify(v)}`);
      }
    }
  }
  assert.ok(conditional > 100, `the sweep actually ran: ${conditional} conditional graphics`);
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} conditions parsed into a non-boolean shape`);
});

test("a conditional graphic is decided from the instance's parameters", () => {
  const value = (map) => (n) => map[n];
  const line = { kind: "Line", points: [0, 0, 1, 1], visible: "useSupport" };

  assert.equal(C.isGraphicVisibleFor(line, value({ useSupport: "false" })), false);
  assert.equal(C.isGraphicVisibleFor(line, value({ useSupport: "true" })), true);
  // Unknown stays hidden: showing a graphic the model did not ask for is worse
  // than leaving one out, and `useHeatPort` is off in most models.
  assert.equal(C.isGraphicVisibleFor(line, value({})), false);

  const negated = { ...line, visible: "not useSupport" };
  assert.equal(C.isGraphicVisibleFor(negated, value({ useSupport: "false" })), true);
  assert.equal(C.isGraphicVisibleFor(negated, value({ useSupport: "true" })), false);

  // A literal, and no condition at all.
  assert.equal(C.isGraphicVisibleFor({ ...line, visible: true }, value({})), true);
  assert.equal(C.isGraphicVisibleFor({ ...line, visible: false }, value({})), false);
  assert.equal(C.isGraphicVisibleFor({ ...line, visible: undefined }, value({})), true);

  // The operators MSL actually writes, including the parenthesised form --
  // `visible=(use_pder and use_pder2)` is how the Analog adaptors gate their
  // derivative labels.
  const both = { ...line, visible: "(use_pder and use_pder2)" };
  assert.equal(C.isGraphicVisibleFor(both, value({ use_pder: "true", use_pder2: "true" })), true);
  assert.equal(C.isGraphicVisibleFor(both, value({ use_pder: "true", use_pder2: "false" })), false);
  assert.equal(C.isGraphicVisibleFor(both, value({ use_pder: "true" })), false, "unknown is not true");
  const either = { ...line, visible: "a or b" };
  assert.equal(C.isGraphicVisibleFor(either, value({ a: "false", b: "true" })), true);
  // `false and unknown` is decided by the false; `true and unknown` is not.
  assert.equal(C.isGraphicVisibleFor({ ...line, visible: "a and b" }, value({ a: "false" })), false);
  assert.equal(C.isGraphicVisibleFor({ ...line, visible: "not (a and b)" }, value({ a: "true", b: "true" })), false);
  assert.equal(C.isGraphicVisibleFor({ ...line, visible: "not a" }, value({ a: "false" })), true);

  // Anything that is not a boolean combination of parameters is refused rather
  // than half-understood: `allowFlowReversal = system.allowFlowReversal` cannot
  // be decided from the class alone, and a comparison must not be guessed at.
  assert.equal(C.isGraphicVisibleFor({ ...line, visible: "a > b" }, value({ a: "2", b: "1" })), false);
  assert.equal(C.isGraphicVisibleFor({ ...line, visible: "abs(x) > 0" }, value({})), false);
  assert.equal(C.isGraphicVisibleFor({ ...line, visible: "system.allowFlowReversal" }, value({})), false);
  assert.equal(C.isGraphicVisibleFor({ ...line, visible: "a and" }, value({ a: "true" })), false);
});

/**
 * Graphics declared inside a class's own `Icon(...)`, counted from its SOURCE.
 *
 * The parser is the only thing that reads annotations, so comparing its output
 * against the text it was given is the one check that does not assume the
 * parser is right. Everything else in this file tests the renderer.
 */
const GRAPHIC_CTOR = /\b(Line|Polygon|Rectangle|Ellipse|Text|Bitmap)\s*\(/g;

function iconGroupText(slice) {
  const m = /(^|[^\w.])Icon\s*\(/.exec(slice);
  if (!m) return "";
  const start = slice.indexOf("(", m.index);
  let depth = 0;
  for (let i = start; i < slice.length; i++) {
    if (slice[i] === "(") depth++;
    else if (slice[i] === ")") {
      depth--;
      if (depth === 0) return slice.slice(start, i + 1);
    }
  }
  return "";
}

/**
 * How many classes still parse fewer icon graphics than their source declares.
 *
 * Not zero, and the remainder is honest debt rather than something to hide: the
 * causes found so far were a multi-line `if`-expression, an `else if` inside a
 * `when` block, and an `if` reached mid-statement in an `algorithm` section,
 * each of which started a hunt for an `end if` that did not exist and swallowed
 * the annotation. 129 classes were in that state; 50 remain, and the biggest is
 * `Clocked.*.TickBasedSources.Step`, which declares 28 and parses 12.
 *
 * The number is a RATCHET. It fails if it grows, so a new fault of this kind
 * cannot slip in unnoticed, and it is expected to fall as the rest are fixed.
 */
/**
 * Icon labels that name a parameter the class cannot supply a value for.
 *
 * They render as `?`, which is the truth: MSL declares such parameters without a
 * default (`parameter SI.Time T(start=1)`) and expects the instance to set them.
 * Measured over Modelica 4.1.0: 531 icon labels use a macro other than `%name`,
 * 325 of them name a parameter with no value at class level, and none is left
 * painting a macro. The number is pinned so a change that makes a resolvable
 * parameter unresolvable is noticed rather than absorbed.
 */
/**
 * Labels whose macro names something the CLASS cannot supply, so they show `?`.
 *
 * Raised from 325 to 326 when `DynamicSelect` started being read as its editing
 * argument: `OpenTank` labels its level `DynamicSelect("%level_start", String(level,
 * …))`, and that label was previously painted as the source text
 * `"DynamicSelect(...)"` — which contains no macro, so this sweep never looked at
 * it. Now it is a `%level_start` label like any other, and it is honestly unknown,
 * because the class declares `level_start` with the expression `0.5*height` rather
 * than a literal. An INSTANCE that sets it (the example sets 2.5) renders the
 * value; the sweep has no instance.
 */
const UNKNOWN_PARAM_BASELINE = 326;

const UNDER_PARSED_BASELINE = 46;

/**
 * Classes read from the library, as a ratchet in the other direction.
 *
 * The icon check above cannot see a class that was never parsed at all, and that
 * is how a real regression slipped through once: a change to where an `if` may
 * open a block desynchronised the scan inside `Blocks/Continuous.mo` and the
 * file yielded 128 classes instead of 160, dropping `Continuous.Filter`
 * entirely. Nothing failed -- fewer classes means fewer icons to compare.
 */
const CLASS_COUNT_BASELINE = 15600;

test("every class's own Icon annotation is read completely", { skip: !MSL && "no MSL installed" }, () => {
  // The check that would have caught, on the day it was written, every bug this
  // file exists for -- and the one that does not need to know what a symbol
  // SHOULD look like, only that what was written arrived.
  const { parseModelica } = parserMod;
  const files = [];
  const SKIP = new Set(["UsersGuide", "Resources"]);
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(p);
      } else if (e.name.endsWith(".mo")) files.push(p);
    }
  })(MSL);

  const under = [];
  const fixed = new Map();
  let withIconBody = 0;
  let totalClasses = 0;
  for (const f of files) {
    let src, ast;
    try {
      src = fs.readFileSync(f, "utf8");
      ast = parseModelica(src);
    } catch {
      continue;
    }
    const classes = [];
    (function w(l) {
      for (const c of l ?? []) {
        classes.push(c);
        w(c.nested);
      }
    })(ast.classes ?? ast);
    for (const c of classes) {
      totalClasses++;
      // A nested class's own Icon is counted with the nested class; a SHORT
      // definition (`connector RealInput = input Real "..."`) is a different
      // form with no body to read.
      if (c.nestedClassNames.length > 0) continue;
      if (!["model", "block", "connector"].includes(c.kind)) continue;
      const slice = src.slice(c.startOffset, c.endOffset);
      if (/^\s*(model|block|connector|record|type|class)\s+\w+\s*(\([^)]*\))?\s*=/.test(slice)) continue;
      const group = iconGroupText(slice);
      if (!group) continue;
      const written = (group.match(GRAPHIC_CTOR) ?? []).length;
      if (written === 0) continue;
      withIconBody++;
      if (c.icon.length < written) under.push(`${c.qualifiedName}: ${c.icon.length} of ${written}`);
      fixed.set(c.qualifiedName, `${c.icon.length} of ${written}`);
    }
  }

  assert.ok(withIconBody > 1000, `the sweep actually ran: ${withIconBody} classes with an Icon body`);
  assert.ok(
    totalClasses >= CLASS_COUNT_BASELINE,
    `the library still parses as many classes as it used to: ${totalClasses} < ${CLASS_COUNT_BASELINE}` +
      " -- a file was probably truncated mid-parse"
  );

  // Named classes this work fixed, asserted directly: if the ratchet is ever
  // raised to accommodate a regression, these still fail.
  for (const [name, why] of [
    ["Modelica.Blocks.Sources.LogFrequencySweep", "a multi-line `if` expression before the annotation"],
    ["Modelica.Blocks.Logical.TriggeredTrapezoid", "an `else if` inside a `when` block"],
    ["Modelica.Electrical.Digital.Delay.InertialDelaySensitive", "an `if` reached mid-statement in an `algorithm` section"],
    ["Modelica.Blocks.Math.Feedback", "`annotation (Dialog)` discarding the rest of a file"],
  ]) {
    const got = fixed.get(name);
    assert.ok(got, `${name} was reached by the sweep`);
    const m = /^(\d+) of (\d+)$/.exec(got);
    assert.ok(m && m[1] === m[2], `${name} parses its icon completely (${why}), got ${got}`);
  }

  const summary = under.slice(0, 8).join("; ");
  assert.ok(
    under.length <= UNDER_PARSED_BASELINE,
    `${under.length} classes parse fewer icon graphics than they declare ` +
      `(allowed ${UNDER_PARSED_BASELINE}): ${summary}`
  );
});

/* ---- the sweep over the whole library ---------------------------- */

/**
 * The parameter settings a class is rendered under during the sweep.
 *
 * A graphic may be conditional on a parameter -- `Integrator`'s reset label sits
 * behind `use_reset`, and the fluid fittings draw everything under
 * `allowFlowReversal`. Testing the default alone would report each of those as
 * "not drawn at all", which is a fact about the parameters rather than a fault.
 * Both polarities are rendered, so a conditional graphic is judged on whichever
 * setting shows it.
 */
function renderSettings(def) {
  const names = new Set();
  for (const g of def?.icon ?? []) {
    const v = g.visible;
    if (typeof v !== "string") continue;
    const inner = (/^not\s+(.+)$/.exec(v.trim())?.[1] ?? v).trim();
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(inner)) names.add(inner);
  }
  const on = {};
  const off = {};
  for (const n of names) {
    on[n] = "true";
    off[n] = "false";
  }
  return [{}, on, off];
}

/** Everything painted for a class, under any of its parameter settings. */
function renderAll(index, name, def) {
  const out = [];
  for (const params of renderSettings(def)) out.push(...renderInstance(index, name, { params }));
  return out;
}

test("no icon label paints a macro as written", { skip: !MSL && "no MSL installed" }, () => {
  // `textString="%C"` means the value of the parameter, and a macro with nothing
  // to resolve it was painted exactly as written: `HeatCapacitor` showed `%C` on
  // every instance until the embed was given a resolver, and the palette
  // thumbnails had no resolver at all. This is the whole-library half of that --
  // what a renderer with the class's own values can and cannot resolve.
  //
  // It cannot resolve everything: MSL labels a parameter with `%T` where `T` is
  // declared without a default (`parameter SI.Time T(start=1)`), and there is no
  // value to show until an instance sets one. Those become `?` -- "not set yet" --
  // and the count is ratcheted so it cannot quietly grow.
  const index = new LibraryIndex();
  index.addDirectory(MSL);
  const painted = [];
  let labels = 0;
  let unknown = 0;
  for (const c of index.listPlaceable()) {
    const def = index.describe(c.name);
    if (!def) continue;
    for (const g of def.icon ?? []) {
      if (g.kind !== "Text") continue;
      const raw = g.textString ?? "";
      // `%name` is the instance's, and is not drawn from the class at all.
      if (!raw.includes("%") || raw.includes("%name")) continue;
      labels++;
      const shown = C.substituteMacros(raw, g, (n) =>
        n === "class" ? def.shortName : def.parameters.find((p) => p.name === n)?.defaultValue
      );
      if (/%[A-Za-z_{]/.test(shown)) painted.push(`${c.name}: "${raw}" -> "${shown}"`);
      if (shown.includes("?")) unknown++;
    }
  }
  assert.ok(labels > 400, `the sweep actually ran: ${labels} labels`);
  assert.deepEqual(
    painted.slice(0, 5),
    [],
    `${painted.length} of ${labels} icon labels still paint a macro instead of a value`
  );
  assert.ok(
    unknown <= UNKNOWN_PARAM_BASELINE,
    `${unknown} labels have no value to show, up from ${UNKNOWN_PARAM_BASELINE}: a parameter ` +
      "that used to be resolvable is not any more"
  );
});

test("every component the palette offers draws something", { skip: !MSL && "no MSL installed" }, () => {
  // A class whose icon draws nothing is a component the user cannot see, cannot
  // find by looking, and cannot click. `Logical.And` was one for a while.
  const index = new LibraryIndex();
  index.addDirectory(MSL);
  const offenders = [];
  let checked = 0;

  for (const c of index.listPlaceable()) {
    const def = index.describe(c.name);
    if (!def?.icon?.length) continue;
    checked++;
    if (painted(renderAll(index, c.name, def)).length === 0) offenders.push(c.name);
  }

  assert.ok(checked > 500, `the sweep actually ran: ${checked} classes`);
  assert.deepEqual(
    offenders.slice(0, 10),
    [],
    `${offenders.length} of ${checked} offered components draw nothing`
  );
});

test("every icon label is legible and stays inside its box", { skip: !MSL && "no MSL installed" }, () => {
  // The two faults behind `Logical.And` (a label at the 1px floor) and
  // `ReceiveBoolean` (a label wider than its symbol) were each true of hundreds
  // of classes. Both are measured here for every one of them.
  const index = new LibraryIndex();
  index.addDirectory(MSL);
  const tiny = [];
  const overflow = [];
  let labels = 0;

  for (const c of index.listPlaceable()) {
    const def = index.describe(c.name);
    if (!def?.icon?.length) continue;
    // 20 diagram units across a canonical +-100 box at scale 11, so one canonical
    // unit is 1.1px and an extent's own numbers convert directly.
    const PX_PER_UNIT = 1.1;
    for (const g of def.icon) {
      if (g.kind !== "Text" || !g.extent) continue;
      const [x1, y1, x2, y2] = g.extent;
      const inBox =
        Math.min(x1, x2) >= -100 &&
        Math.max(x1, x2) <= 100 &&
        Math.min(y1, y2) >= -100 &&
        Math.max(y1, y2) <= 100;
      if (!inBox) continue;
      if ((g.textString ?? "").includes("%name")) continue; // left to the instance label

      // What the renderer actually puts on screen: `%y_off` and `%Name_pder2` are
      // macros, and the string drawn is the substituted value, not the source.
      // Compared through the renderer's own substitution so the two cannot drift.
      const shown = C.substituteMacros(g.textString ?? "", g);
      const drawn = painted(renderAll(index, c.name, def)).find(
        (i) => i.op === "text" && i.text === shown
      );
      if (!drawn) {
        // A conditional label may legitimately be off under every setting tried:
        // `enableNoise and not useAutomaticSeed` needs one parameter true and
        // another false, and no fixed combination covers every class. What is
        // being checked here is the SIZE, which depends only on the extent, and
        // an unconditional label exercises exactly the same code.
        const conditional = g.visible !== undefined && g.visible !== true;
        if (!conditional) tiny.push(`${c.name}: "${g.textString}" -> "${shown}" not drawn at all`);
        continue;
      }
      labels++;
      if (drawn.px < 6) tiny.push(`${c.name}: "${shown}" at ${drawn.px.toFixed(1)}px`);
      const width = shown.length * ADVANCE * drawn.px;
      const boxWidth = Math.abs(x1 - x2) * PX_PER_UNIT;
      // A zero-width box is the documented exception: MLS says use the height and
      // do not truncate, which is what `Magnetic.FluxTubes` relies on.
      if (boxWidth > 0 && width > boxWidth + 1) {
        overflow.push(
          `${c.name}: "${g.textString}" ${width.toFixed(0)}px in a ${boxWidth.toFixed(0)}px box`
        );
      }
    }
  }

  assert.ok(labels > 500, `the sweep actually ran: ${labels} labels`);
  assert.deepEqual(tiny.slice(0, 10), [], `${tiny.length} labels are illegible or missing`);
  assert.deepEqual(overflow.slice(0, 10), [], `${overflow.length} labels overflow their box`);
});

test("the tank's level shows the parameter it names", () => {
  // The end of the same thread, and the question that started it: the tank's
  // second line used to read "DynamicSelect(...)" — the annotation's own source.
  // With the editing argument kept, `%level_start` resolves through the ordinary
  // macro path, so the user's own `level_start = 2.5` is what appears.
  const src = `model Tank
  annotation (Icon(graphics={
    Text(extent={{-95,-24},{95,-44}},
         textString=DynamicSelect("%level_start", String(level, significantDigits=2)))}));
end Tank;`;
  const cls = parserMod.parseModelica(src).find((c) => c.name === "Tank");
  const def = { name: "Tank", shortName: "Tank", icon: cls.icon, ports: [], parameters: [], hasIcon: true };
  const texts = [];
  const ctx = new Proxy(
    { canvas: { width: 400, height: 400 }, measureText: () => ({ width: 20 }), lineWidth: 1 },
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === "fillText") return (s) => texts.push(String(s));
        return () => {};
      },
      set(t, k, v) { t[k] = v; return true; },
    }
  );
  const { drawComponent } = C;
  drawComponent(
    ctx,
    { id: "tank", className: "Tank", placement: { extent: [-100, -100, 100, 100], rotation: 0, visible: true }, params: {} },
    def,
    { scale: 1, x: 200, y: 200 },
    1,
    { lookup: () => undefined, theme: T.LIGHT, resolveParam: (_i, n) => (n === "level_start" ? "2.5" : undefined) }
  );
  assert.ok(texts.includes("2.5"), `the level reads 2.5, got ${JSON.stringify(texts)}`);
  assert.ok(
    !texts.some((t) => t.includes("DynamicSelect")),
    `and the annotation is never drawn as text (${JSON.stringify(texts)})`
  );
});
