/**
 * Which way is up.
 *
 * A Modelica diagram's +y points UP; a canvas's +y points DOWN. Every drawing
 * therefore has to be mirrored vertically exactly once, and for a long time this
 * plugin never was: symbols appeared upside down, and the components that gave it
 * away were the ones whose shape is unambiguous -- a Ground with its bars above
 * its terminal, an arrow pointing the wrong way, a label above a symbol that
 * names it.
 *
 * The flip now lives in `viewportTransform` alone. That is easy to state and
 * easy to break again, because a missing sign is invisible in isolation: the
 * drawing is still a valid picture, just a mirror of the right one. These tests
 * pin the direction against the LIBRARY'S OWN SOURCE, so the expectation cannot
 * drift along with the code -- the coordinates are read out of the `.mo` file
 * with a regex and never touch the parser.
 *
 * The Ground symbol is the case to pin because its correct appearance is not a
 * matter of taste: every schematic ever drawn has the terminal on top, the bars
 * descending beneath it, and the name underneath those.
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

const LIB = buildLibs("orientation", [
  "src/render/canvas.ts",
  "src/render/theme.ts",
  "src/modelica/library.ts",
  "src/modelica/parser.ts",
  "src/modelica/types.ts",
]);
const C = await import(path.join(LIB, "render/canvas.js"));
const { LibraryIndex } = await import(path.join(LIB, "modelica/library.js"));
const parserMod = await import(path.join(LIB, "modelica/parser.js"));

const GROUND_FILE = MSL && path.join(MSL, "Electrical/Analog/Basic/Ground.mo");
const GROUND_CLASS = "Modelica.Electrical.Analog.Basic.Ground";

/** `"0,90"` -> `[0, 90]`. */
const pair = (s) => s.split(",").map((v) => Number(v.trim()));

/**
 * The icon geometry of a class, read straight out of the file.
 *
 * A regex rather than the parser on purpose: if the parser and the renderer
 * shared a mistaken idea of the coordinate system, a test built on the parser
 * would agree with the bug.
 */
function groundSource() {
  const src = fs.readFileSync(GROUND_FILE, "utf8");
  const lines = [...src.matchAll(/Line\(points=\{\{([^}]+)\},\{([^}]+)\}\}/g)].map((m) => [
    pair(m[1]),
    pair(m[2]),
  ]);
  const text = /Text\(\s*extent=\{\{([^}]+)\},\{([^}]+)\}\}/.exec(src);
  // The pin's own declared position: `Placement(transformation(origin={0,100}`.
  const pin = /Interfaces\.Pin\s+\w+[\s\S]{0,80}?origin=\{([^}]+)\}/.exec(src);
  return {
    lines,
    textExtent: text ? [pair(text[1]), pair(text[2])] : null,
    pinOrigin: pin ? pair(pin[1]) : null,
  };
}

/** A context that records the coordinates it is asked to paint. */
function tracingCtx() {
  const moves = [];
  const texts = [];
  const state = { font: "" };
  const ctx = new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      switch (k) {
        case "canvas":
          return { width: 2000, height: 2000 };
        case "measureText":
          return (s) => ({ width: String(s).length * 6 });
        case "moveTo":
          return (x, y) => moves.push([x, y]);
        case "lineTo":
          return (x, y) => moves.push([x, y]);
        case "fillText":
          return (s, x, y) => texts.push([String(s), x, y]);
        case "createLinearGradient":
        case "createPattern":
          return () => ({ addColorStop() {} });
        default:
          return () => {};
      }
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
  return { ctx, moves, texts };
}

/** Draw Ground at 1:1 and return the coordinates that reached the canvas. */
function renderGround(index) {
  const { ctx, moves, texts } = tracingCtx();
  // An identity placement: the class declares `extent={{-100,-100},{100,100}}`
  // and the component is placed into exactly that box, so a point of the icon is
  // the same number on the way in as it is inside `drawComponent`. One less
  // transform to account for when reading a failure.
  C.drawComponent(
    ctx,
    {
      id: "g1",
      className: GROUND_CLASS,
      placement: { extent: [-100, -100, 100, 100], rotation: 0, visible: true },
      params: {},
    },
    index.describe(GROUND_CLASS),
    { x: 0, y: 0, scale: 1 },
    1,
    { lookup: (n) => index.describe(n) }
  );
  return { moves, texts };
}

test("the library's own coordinates put the ground label below the symbol", { skip: !MSL && "no MSL installed" }, () => {
  // The premise the screen test rests on, asserted against the file rather than
  // assumed: in Modelica coordinates the drawing is at POSITIVE y and the name
  // label is at NEGATIVE y. So a picture with the label above the symbol is one
  // that has the axis backwards, and no amount of internal consistency helps.
  const { lines, textExtent } = groundSource();
  assert.equal(lines.length, 4, "Ground's icon is four lines");
  const ys = lines.flatMap(([a, b]) => [a[1], b[1]]);
  assert.ok(Math.max(...ys) > 0, `the drawing is at positive y: ${JSON.stringify(ys)}`);
  assert.ok(textExtent, "the label has an extent");
  assert.ok(
    Math.max(...textExtent.map((p) => p[1])) < Math.min(...ys),
    `the label is below every line in Modelica coordinates: label ${JSON.stringify(
      textExtent
    )} vs lines ${JSON.stringify(ys)}`
  );
});

test("a ground symbol is drawn upright: terminal on top, bars and label below", { skip: !MSL && "no MSL installed" }, () => {
  const index = new LibraryIndex();
  index.addDirectory(MSL);
  const { lines, textExtent, pinOrigin } = groundSource();
  assert.ok(pinOrigin, "the pin's declared origin was read from the file");
  const { moves, texts } = renderGround(index);

  assert.ok(moves.length >= 8, `the icon was painted: ${moves.length} points`);

  const vt = C.viewportTransform({ x: 0, y: 0, scale: 1 }, 1);
  const paintedYs = moves.map(([, y]) => y);

  // The terminal is the HIGHEST thing on the canvas. Its position is the pin's
  // declared origin -- `origin={0,100}` in the file -- and the lead runs from
  // there down to the top of the stem at y=90. Reading the extent centre instead
  // of the origin put this pin at {0,0}, below the bars.
  const [, pinScreen] = C.apply(vt, pinOrigin[0], pinOrigin[1]);
  assert.equal(
    Math.min(...paintedYs),
    pinScreen,
    `the highest thing drawn is the terminal: ${Math.min(...paintedYs)} vs ${pinScreen}`
  );
  assert.ok(pinScreen < 0, `and it is above the origin: ${pinScreen}`);
  assert.ok(
    Math.max(...lines.flatMap(([a, b]) => [a[1], b[1]])) < pinOrigin[1],
    "the stem starts below the pin, as the file says it does"
  );

  // The label sits under the bars, which is where the file puts it too.
  assert.ok(texts.length >= 1, `the name was painted: ${JSON.stringify(texts)}`);
  const lowest = Math.max(...paintedYs);
  assert.ok(textExtent, "the label has an extent");
  for (const [s, , y] of texts) {
    assert.ok(y > lowest, `"${s}" is painted below the bars: ${y} > ${lowest}`);
  }

  // And the whole icon is the source geometry with the sign of y turned over --
  // which is the entire claim, stated as arithmetic. Every y the file mentions
  // for this symbol has to appear, negated, and nothing else may.
  const sourceYs = [
    ...new Set([pinOrigin[1], ...lines.flatMap(([a, b]) => [a[1], b[1]])]),
  ].sort((a, b) => a - b);
  const screenYs = [...new Set(paintedYs)].sort((a, b) => a - b);
  assert.deepEqual(
    screenYs,
    sourceYs.map((y) => -y).sort((a, b) => a - b),
    "every painted y is a negated source y, and none is missing"
  );
});

test("a downward drag on the canvas is a decrease in diagram y", { skip: !MSL && "no MSL installed" }, () => {
  // The editing half of the same fact, and the one that reaches the file on
  // disk: dragging a symbol down the screen has to write a SMALLER y, or the
  // source no longer matches the picture the user arranged.
  const vt = C.viewportTransform({ x: 0, y: 0, scale: 1 }, 1);
  const [, up] = C.apply(vt, 0, 100);
  const [, down] = C.apply(vt, 0, -100);
  assert.ok(up < down, `diagram +y is drawn higher on the canvas: ${up} < ${down}`);
  assert.equal(up, -down, "and the flip is symmetric about the origin");
});

test("the placement transform does not put the flip back", { skip: !MSL && "no MSL installed" }, () => {
  // `drawComponent` composes the viewport with the component's own placement,
  // and a rotation is where a stray second negation would hide: rotating by 180
  // degrees maps (0, 90) to (0, -90), which in screen terms is the BOTTOM. If the
  // composition lost the flip, a rotated Ground would look upright again.
  const vt = C.viewportTransform({ x: 0, y: 0, scale: 1 }, 1);
  const t = C.mul(vt, C.placementTransform({
    id: "g1",
    className: GROUND_CLASS,
    placement: { extent: [-100, -100, 100, 100], rotation: 180, visible: true },
    params: {},
  }));
  const [, screenY] = C.apply(t, 0, 90);
  assert.ok(screenY > 0, `a half turn puts the terminal below the origin: ${screenY}`);
  assert.equal(screenY, 90, "and the magnitude is unchanged");
});

test("a pin placement's origin is applied, and an absent one is not", () => {
  // MLS 18.6.2 orders the transformation `extent`, `rotation`, `origin`: the icon
  // is mapped onto the extent rectangle, rotated about {0,0}, and shifted by
  // origin. The library uses both styles, and they must not be confused -- an
  // absolute extent already carries its position, a relative one carries it in
  // `origin`, and reading the extent centre alone silently pins the second style
  // to the middle of the symbol.
  const { placementCenter } = parserMod;
  // Relative: the extent is a size, the origin is the position.
  assert.deepEqual(
    placementCenter({ extent: [-20, -20, 20, 20], origin: [-120, 60] }),
    [-120, 60],
    "a symmetric extent plus an origin lands on the origin"
  );
  // Absolute: no origin, so the extent centre IS the position.
  assert.deepEqual(
    placementCenter({ extent: [-140, -20, -100, 20] }),
    [-120, 0],
    "an absolute extent is its own position"
  );
  // Ground's pin, which is the case that surfaced this.
  assert.deepEqual(
    placementCenter({ extent: [10, -10, -10, 10], origin: [0, 100] }),
    [0, 100],
    "Ground's pin is at the top of its stem, not at the icon origin"
  );
  // The origin is a SHIFT, so an off-centre extent keeps its offset.
  assert.deepEqual(
    placementCenter({ extent: [-40, -10, -20, 30], origin: [5, 7] }),
    [-25, 17],
    "the shift is added to the extent centre"
  );
  assert.equal(placementCenter(undefined), undefined, "no placement, no position");
});
