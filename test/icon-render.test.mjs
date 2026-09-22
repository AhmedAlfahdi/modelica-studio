/**
 * Systematic rendering checks over the WHOLE library.
 *
 * THE METHOD. Every fault this file has caught was first seen by a person looking
 * at one component that looked wrong, and was then true of hundreds. So each check
 * here is an invariant that must hold for EVERY class the palette offers, measured
 * from what the renderer actually does rather than from what the source says it
 * should do, and reported with the class name and the numbers.
 *
 * A sweep cannot judge whether a symbol is BEAUTIFUL. It can insist that every
 * declared mark is drawn, at the weight it declares, visibly in both themes, with
 * labels that fit and read as values rather than as annotations -- and each of
 * those has been a real bug, found by eye, that a sweep would have caught on the
 * day it was written:
 *
 *   - a graphic written `extent=DynamicSelect(...)` was DROPPED, so the tank drew
 *     empty and its level read `DynamicSelect(...)`;
 *   - every stroke was divided by the transform scale, so an outline came out 10px
 *     thick on a normally-placed component;
 *   - a label was drawn at the 1px floor, or wider than the symbol it labelled;
 *   - every fill pattern and line pattern was dropped by a name mismatch.
 *
 * TWO RULES FOR ADDING ONE, both learned the hard way here:
 *   1. Assert an EXACT property, or a named set -- never a count that tolerates
 *      offenders. The drop sweep below was a count with a budget of 46, and the
 *      tank lived inside it.
 *   2. CALIBRATE the measurement on a case with an independently known answer. The
 *      theme-visibility sweep read a CSS string as if it were a number, produced
 *      NaN for every class, and passed for its whole life -- including against a
 *      probe that drew every mark in the canvas colour. It now checks one known
 *      stroke against a contrast computed by hand.
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
  "src/render/connector-style.ts",
  "src/render/theme.ts",
  "src/modelica/library.ts",
  "src/modelica/parser.ts",
  "src/modelica/types.ts",
]);
const C = await import(path.join(LIB, "render/canvas.js"));
const { connectorWireStyle } = await import(path.join(LIB, "render/connector-style.js"));
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
          return () =>
            images.push({
              op: "stroke",
              style: t.strokeStyle,
              dash: [...t.lineDash],
              // The weight, which the looks-sweeps assert against the thickness the
              // graphic declares: a stroke drawn at the wrong weight is the fault
              // that made every symbol outline 10px thick.
              width: t.lineWidth,
            });
        case "fillRect":
          return () => images.push({ op: "rect", style: t.fillStyle });
        case "strokeRect":
          return () => images.push({ op: "rect", style: t.strokeStyle });
        case "fillText":
          return (text) =>
            images.push({
              op: "text",
              text: String(text),
              px: parseFloat(/([\d.]+)px/.exec(t.font)?.[1] ?? "0"),
              // A text-only icon (`Electrical.Digital.Basic.And` is an ampersand
              // and nothing else) has no stroke to judge its visibility by.
              style: t.fillStyle,
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
function renderInstance(index, className, { id = "i1", params = {}, scale = 11, theme } = {}) {
  const lookup = (n) => index.describe(n);
  const { ctx, images } = recorder();
  C.drawComponent(
    ctx,
    { id, className, placement: { extent: [-10, -10, 10, 10] }, params },
    lookup(className),
    { x: 0, y: 0, scale },
    1,
    { lookup, ...(theme ? { theme } : {}) }
  );
  return images;
}

/** Every `.mo` file of the standard library, minus the prose packages. */
function* msources() {
  const SKIP = new Set(["UsersGuide", "Resources"]);
  const walk = function* (dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) yield* walk(p);
      } else if (e.name.endsWith(".mo")) yield p;
    }
  };
  yield* walk(MSL);
}

/** Every class in a parse, nested ones included. */
function flattenClasses(ast) {
  const out = [];
  (function walk(list) {
    for (const c of list ?? []) {
      out.push(c);
      walk(c.nested);
    }
  })(ast.classes ?? ast);
  return out;
}

/** The on-screen widths of everything stroked. */
function paintWidths(images) {
  return images.filter((i) => i.op === "stroke" && typeof i.width === "number").map((i) => i.width);
}

/** The colour a paint operation used, as an [r,g,b] triple where it can be read. */
function paintColour(paint) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(paint?.style ?? ""));
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const hex = /#([0-9a-f]{6})/i.exec(String(paint?.style ?? ""));
  if (hex) {
    const h = hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  return undefined;
}

/**
 * A CSS colour string as an [r,g,b] triple.
 *
 * `theme.background` is a string (`"rgb(30,33,39)"`) while the other theme fields
 * are triples. Feeding the string to the luminance math produced NaN, every
 * comparison against it was false, and the visibility sweep passed for months of
 * runs without ever failing -- including with a probe that drew every mark in the
 * canvas colour. The sweep now asserts that some class is strongly visible, so a
 * vacuous pass cannot happen again.
 */
function cssColour(value) {
  if (Array.isArray(value)) return value;
  return paintColour({ style: value });
}

/** The strongest contrast any of a class's marks has against its canvas. */
function bestContrast(paints, theme) {
  const canvas = cssColour(theme.background);
  return Math.max(0, ...paints.map((p) => contrastAgainst(paintColour(p), canvas) || 0));
}

/** WCAG contrast between a painted colour and the canvas behind it. */
function contrastAgainst(colour, background) {
  if (!colour) return 0;
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const [a, b] = [L(colour), L(background)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
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
function renderAll(index, name, def, theme) {
  const out = [];
  for (const params of renderSettings(def)) out.push(...renderInstance(index, name, { params, theme }));
  return out;
}

test("no class silently drops a graphic it declares", { skip: !MSL && "no MSL installed" }, () => {
  // The detector for the whole family this file keeps meeting: a primitive whose
  // attribute could not be interpreted is DROPPED, and a dropped graphic is
  // invisible. `Modelica.Fluid.Vessels.OpenTank` declares its water rectangle with
  // `extent=DynamicSelect(...)`; the parser summarised the call as a string, the
  // rectangle failed to build, and the tank drew empty with nothing anywhere saying
  // why. The parser now records what it could not read, so the fault is a NAME
  // rather than a missing shape.
  //
  // Asserted exactly, not as a budget: one dropped graphic is one too many, and the
  // message says which class dropped which kind.
  const dropped = [];
  let classes = 0;
  for (const f of msources()) {
    let ast;
    try {
      ast = parserMod.parseModelica(fs.readFileSync(f, "utf8"));
    } catch {
      continue;
    }
    for (const c of flattenClasses(ast)) {
      classes++;
      if ((c.unparsedGraphics ?? []).length > 0) {
        dropped.push(`${c.qualifiedName}: dropped ${c.unparsedGraphics.join(", ")}`);
      }
    }
  }
  assert.ok(classes > 2000, `the sweep actually ran: ${classes} classes`);
  assert.deepEqual(
    dropped.slice(0, 8),
    [],
    `${dropped.length} of ${classes} classes could not build a graphic they declare`
  );
});

test("no graphic attribute is left as an expression nobody can read", { skip: !MSL && "no MSL installed" }, () => {
  // The other half of the same family. A summarised call does not always cost a
  // graphic: `textString=DynamicSelect("%level_start", String(level, …))` parsed to
  // the STRING "DynamicSelect(...)" and was painted as the tank's level -- the
  // annotation's own source, on screen, as a value.
  //
  // The shape of the summary is unmistakable (`name(...)` or `name(…)`), so it is
  // looked for in every attribute that decides what a component looks like.
  // The ellipsis is what makes it a SUMMARY: the parser writes exactly
  // `name(...)` when it cannot read a call. A label that merely LOOKS like a call
  // is a literal in the source -- MSL writes `textString="der()"` and `"change()"`
  // for blocks that compute one -- and must not be reported. No literal label in
  // MSL 4.1.0 contains an ellipsis, which is what makes the two distinguishable.
  const SUMMARY = /^[A-Za-z_][\w.]*\s*\(\s*(\.\.\.|…)\s*\)$/;
  const ATTRS = [
    "extent",
    "points",
    "radius",
    "center",
    "textString",
    "color",
    "lineColor",
    "fillColor",
    "textColor",
    "thickness",
    "lineThickness",
    "visible",
  ];
  const summarised = [];
  let graphics = 0;
  const index = new LibraryIndex();
  index.addDirectory(MSL);
  for (const c of index.listPlaceable()) {
    const def = index.describe(c.name);
    for (const g of def?.icon ?? []) {
      graphics++;
      for (const attr of ATTRS) {
        const v = g[attr];
        if (typeof v === "string" && SUMMARY.test(v.trim())) {
          summarised.push(`${c.name}: ${attr}="${v}"`);
        }
      }
    }
  }
  assert.ok(graphics > 5000, `the sweep actually ran: ${graphics} graphics`);
  assert.deepEqual(
    summarised.slice(0, 8),
    [],
    `${summarised.length} attributes are the source of an expression rather than a value`
  );
});

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
      // A label that is the SOURCE of an expression is the same fault wearing a
      // different hat: the tank's level read `DynamicSelect(...)`.
      if (/^[A-Za-z_][\w.]*\s*\(\s*(\.\.\.|…)\s*\)$/.test(shown.trim())) {
        painted.push(`${c.name}: "${raw}" -> "${shown}" (a call, not a value)`);
      }
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

/* ------------------------------------------------------------------ *
 * Looks.
 *
 * Every sweep below asks a question about what a component LOOKS like, over every
 * class the palette offers, and names the class and the numbers when the answer is
 * wrong. They exist because each fault found so far was noticed by a person
 * looking at one component, and was then true of hundreds:
 *
 *   - a graphic whose extent was written `DynamicSelect(...)` was DROPPED, so the
 *     tank drew empty and its level read the annotation's own source;
 *   - every stroke was divided by the transform scale, so an outline came out 10px
 *     thick on a normally-placed component;
 *   - a label was drawn at the 1px floor (`Logical.And`), or wider than the symbol
 *     it labelled (`ReceiveBoolean`);
 *   - every fill pattern and line pattern was dropped, because the parser kept the
 *     qualified name and the renderer compared against the short one.
 *
 * The lesson each time was the same: nothing was checking the picture, so the first
 * detector was a human eye. A sweep cannot say whether a symbol is BEAUTIFUL, but
 * it can say that every declared mark is drawn, at the weight it declares, visibly,
 * and with its labels inside their boxes -- and that is where all of the above
 * would have been caught on the day they were written.
 * ------------------------------------------------------------------ */

test("every declared mark is drawn, at the weight it declares", { skip: !MSL && "no MSL installed" }, () => {
  // The fault this exists for: every stroke was divided by the transform scale, so
  // a 0.5 outline on a +-10 component came out 10px thick against the 1px it should
  // have been. Both halves below fail on that:
  //
  //   BOUND    no stroke may exceed the cap the weight is clamped to. Measured at
  //            the default setting, where the cap is 6px: the fault drew 10.
  //   PRESENCE the width a declared thickness WORKS OUT TO must actually appear.
  //            With the division the widths were all 1/scale too big, so the
  //            expected 1px was simply never painted.
  //
  // Deliberately not asserted: that every painted width is a declared one. A filled
  // shape's hatching is drawn at its own texture weight (0.5px up to a fortieth of
  // the shape), and so are the port rings; both are legitimate and neither is a
  // stroke of a graphic.
  const index = new LibraryIndex();
  index.addDirectory(MSL);

  // `renderInstance` draws a +-10 instance at 11 px per unit: one canonical unit is
  // 1.1 px, so a graphic's declared thickness T should be drawn at 6.6*T px.
  const K = 11 * 0.1;
  const weightOf = (t) => 6 * t * K;
  const CAP = 6;
  const tooWide = [];
  const missing = [];
  let strokes = 0;
  let classes = 0;

  for (const c of index.listPlaceable()) {
    const def = index.describe(c.name);
    if (!def?.icon?.length) continue;
    classes++;
    const declared = [];
    for (const g of def.icon) {
      if (g.kind === "Text") continue;
      if (g.pattern === "None") continue;
      declared.push(g.thickness ?? g.lineThickness ?? 0.25);
    }
    const widths = paintWidths(renderAll(index, c.name, def));
    if (widths.length === 0 || declared.length === 0) continue;
    strokes += widths.length;

    const widest = Math.max(...widths);
    if (widest > CAP * 1.02) {
      tooWide.push(`${c.name}: widest stroke ${widest.toFixed(2)}px, cap is ${CAP}`);
    }

    for (const t of declared) {
      const want = Math.min(CAP, weightOf(t));
      // Only where neither clamp is in play: a clamped weight is a floor or a
      // ceiling and says nothing about proportionality.
      if (weightOf(t) <= 1.05 || weightOf(t) >= CAP * 0.98) continue;
      if (!widths.some((w) => Math.abs(w - want) < 0.06)) {
        missing.push(
          `${c.name}: thickness ${t} should be drawn at ${want.toFixed(2)}px; widths are ` +
            [...new Set(widths.map((w) => w.toFixed(2)))].slice(0, 6).join("/")
        );
      }
    }
  }

  assert.ok(classes > 500, `the sweep actually ran: ${classes} classes`);
  assert.ok(strokes > 2000, `and saw enough strokes to mean something: ${strokes}`);
  assert.deepEqual(tooWide.slice(0, 8), [], `${tooWide.length} classes draw a stroke wider than the cap`);
  assert.deepEqual(
    missing.slice(0, 8),
    [],
    `${missing.length} declared weights are not drawn at their weight`
  );
});

test("no icon disappears into the canvas, in either theme", { skip: !MSL && "no MSL installed" }, () => {
  // An icon drawn in one colour that matches its background is a component the user
  // cannot see -- and it can be true in one theme only, which is how the whole
  // HeatTransfer library looked on dark before the fills were adapted.
  const index = new LibraryIndex();
  index.addDirectory(MSL);
  const invisible = [];
  let checked = 0;
  let strongest = 0;

  for (const c of index.listPlaceable()) {
    const def = index.describe(c.name);
    if (!def?.icon?.length) continue;
    checked++;
    for (const [label, theme] of [
      ["light", T.LIGHT_THEME],
      ["dark", T.DARK_THEME],
    ]) {
      const paints = painted(renderAll(index, c.name, def, theme));
      if (paints.length === 0) continue; // nothing drawn is reported by its own sweep
      const best = bestContrast(paints, theme);
      strongest = Math.max(strongest, best);
      if (best < 3) {
        invisible.push(`${c.name} on ${label}: strongest mark is ${best.toFixed(2)}:1`);
      }
    }
  }

  assert.ok(checked > 500, `the sweep actually ran: ${checked} classes`);

  // A CONTROL, because this sweep once passed vacuously: `theme.background` is a CSS
  // string while the luminance math wanted a triple, so every contrast came out NaN,
  // `NaN < 3` was false, and nothing was ever reported -- including when a probe drew
  // every mark in the canvas colour. `Math.Add` draws #6a6bb4 on the dark canvas,
  // which is a known 3.4:1; the window is wide enough not to be fussy about the
  // exact figure and narrow enough to catch a measurement that has stopped working.
  const CONTROL = "Modelica.Blocks.Math.Add";
  const controlStrokes = painted(renderAll(index, CONTROL, index.describe(CONTROL), T.DARK_THEME)).filter(
    (p) => p.op === "stroke"
  );
  const controlBest = bestContrast(controlStrokes, T.DARK_THEME);
  // 3.36:1, computed independently from the two colours (#6a6bb4 on #1e2127) rather
  // than read back from this code. Narrow enough that a measurement returning the
  // canvas colour, or NaN, cannot pass.
  assert.ok(
    controlBest > 3.0 && controlBest < 3.8,
    `the measurement is calibrated on a known stroke: expected 3.36:1, measured ${controlBest.toFixed(2)}:1`
  );
  assert.ok(
    strongest > 8,
    `some class is strongly visible, so the numbers mean something (best was ${strongest})`
  );
  assert.deepEqual(
    invisible.slice(0, 8),
    [],
    `${invisible.length} of ${checked} classes have nothing visible against their canvas`
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

test("the Help table of connector colours matches the library", { skip: !MSL && "no MSL installed" }, async () => {
  // The Help window tells the reader what colour a wire will be, by domain, and
  // names the class each row is measured from. If a row and the library disagree,
  // the Help is worse than silent: it is where someone goes to check a rule they
  // have already been surprised by. The first version of that table left FLUID out
  // altogether -- the domain a course on tanks and pipes meets every day.
  // The table lives in the Help module, which imports Obsidian; importing it here
  // would need the stub. It is a plain data array, so it is read out of the source
  // instead -- which also means a row that stops being data fails this test.
  const src = fs.readFileSync(path.join(import.meta.dirname, "..", "src/view/help-modal.ts"), "utf8");
  const body = /export const CONNECTOR_ROWS[\s\S]*?= \[([\s\S]*?)\n\];/.exec(src);
  assert.ok(body, "the connector table is present as data");
  const rows = [];
  for (const m of body[1].matchAll(
    /sample: "([^"]+)",\s*color: \[(\d+), (\d+), (\d+)\],\s*double: (true|false)/g
  )) {
    rows.push({
      sample: m[1],
      color: [Number(m[2]), Number(m[3]), Number(m[4])],
      double: m[5] === "true",
    });
  }
  assert.ok(rows.length >= 8, `every row was read: ${rows.length}`);
  const CONNECTOR_ROWS = rows;
  assert.ok(CONNECTOR_ROWS.length >= 8, `the table covers the domains: ${CONNECTOR_ROWS.length} rows`);

  const index = new LibraryIndex();
  index.addDirectory(MSL);
  const wrong = [];
  for (const row of CONNECTOR_ROWS) {
    const def = index.component(row.sample);
    if (!def) {
      wrong.push(`${row.sample}: not in the library`);
      continue;
    }
    const style = connectorWireStyle(def);
    if (!style) {
      wrong.push(`${row.sample}: declares no line at all`);
      continue;
    }
    const want = { color: row.color, widthRatio: row.double ? 2 : 1 };
    if (JSON.stringify(style) !== JSON.stringify(want)) {
      wrong.push(
        `${row.sample}: library says {${style.color.join(",")}} x${style.widthRatio}, Help says ` +
          `{${want.color.join(",")}} x${want.widthRatio}`
      );
    }
  }
  assert.deepEqual(wrong, [], `${wrong.length} of ${CONNECTOR_ROWS.length} Help rows disagree with the library`);
});
