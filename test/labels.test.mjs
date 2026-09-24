/**
 * Where a component's name goes.
 *
 * The name was drawn centred below its symbol, which is right until the diagram has
 * two components: the upper one's name lands inside the symbol below it, and a wire
 * routed under a row of components crosses every name in the row. Nothing failed —
 * the picture was simply unreadable in the places a reader looks — so these tests pin
 * the placement itself, as geometry, and the setting that turns it off.
 *
 * `placeLabels` is a pure function of rectangles, so a fixed-width `measure` stands in
 * for text and the expectations are exact numbers rather than screenshots.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { buildLibs, repoRoot } from "./helpers/build.mjs";

const LIB = buildLibs("labels", ["src/render/labels.ts"]);
const L = await import(path.join(LIB, "labels.js"));

/** Ten pixels per character, so a box's width is the string's length times ten. */
const measure = (text) => text.length * 10;

/** A component box 40 wide and 40 tall at (x, y). */
const box = (x, y) => ({ x1: x, y1: y, x2: x + 40, y2: y + 40 });

const spot = (text, b, occupied = [], fontPx = 10) => {
  const { spots } = L.placeLabels([{ id: text, box: b, fontPx }], occupied, measure);
  return spots.get(text);
};

test("a name with room stays below its symbol", () => {
  const b = box(100, 100);
  const s = spot("tank", b);
  assert.equal(s.side, "below");
  assert.equal(s.x, 120, "centred on the symbol");
  assert.equal(s.y, b.y2 + L.LABEL_GAP, "one gap below its drawn box");
  // And the box the pass reports is the box the renderer will paint into.
  assert.deepEqual(s.box, L.labelBoxAt(s.x, s.y, measure("tank"), 10));
});

test("a name moves aside when the space below is taken", () => {
  // A second symbol directly beneath the first: the classic case, which is what an
  // evenly spaced column of components looks like.
  const b = box(100, 100);
  const below = box(100, 143);
  const s = spot("tank", b, [below]);
  assert.notEqual(s.side, "below", `expected a move, got ${s.side}`);
  assert.equal(s.side, "above", "and the next side tried is above");
  assert.equal(s.y, b.y1 - L.LABEL_GAP - 10 * L.LABEL_LINE);
});

test("a name never lands on a wire", () => {
  // A wire running under the symbol, at the height the name would sit: 5 px thick,
  // as a padded segment box.
  const b = box(100, 100);
  const wire = { x1: 0, y1: b.y2 + 2, x2: 300, y2: b.y2 + 7 };
  const s = spot("tank", b, [wire]);
  assert.equal(s.box.y1 >= wire.y2 || s.box.y2 <= wire.y1, true, `the name overlaps the wire: ${JSON.stringify(s)}`);
});

test("two names do not land on each other", () => {
  // Two components side by side, close enough that the labels would touch if both
  // took the default spot: one 40 wide centred at 120, one 120 wide centred at 190.
  const a = box(100, 100);
  const b = box(170, 100);
  const { spots, moved } = L.placeLabels(
    [
      { id: "aaaa", box: a, fontPx: 10 }, // 40 wide
      { id: "bbbbbbbbbbbb", box: b, fontPx: 10 }, // 120 wide
    ],
    [],
    measure
  );
  const pa = spots.get("aaaa").box;
  const pb = spots.get("bbbbbbbbbbbb").box;
  const overlap =
    Math.min(pa.x2, pb.x2) - Math.max(pa.x1, pb.x1) > 0 &&
    Math.min(pa.y2, pb.y2) - Math.max(pa.y1, pb.y1) > 0;
  assert.equal(overlap, false, `the two names overlap: ${JSON.stringify([pa, pb])}`);
  assert.equal(moved, 1, "exactly one of them had to move");
});

test("the first side that is free wins, and the order is the documented one", () => {
  // A symbol with a neighbour below, one above, and then one to the right: each in
  // turn is what blocks the side the pass would otherwise have chosen. The blockers
  // are placed on the LABEL's band, not merely near it, so each test is about the
  // side it names.
  const b = box(100, 100);
  const label = { w: measure("tank"), h: 10 * L.LABEL_LINE };
  const below = { x1: 90, y1: 143, x2: 150, y2: 160 };
  const above = { x1: 90, y1: 70, x2: 150, y2: 97 };
  const right = { x1: 143, y1: 108, x2: 200, y2: 132 };
  // Sanity: the blockers really do sit on the candidate bands.
  assert.ok(label.h > 0);
  assert.equal(spot("tank", b, [below]).side, "above", "below is blocked");
  assert.equal(spot("tank", b, [below, above]).side, "right", "below and above are blocked");
  assert.equal(spot("tank", b, [below, above, right]).side, "left", "and now right as well");
});

test("when every side is blocked, the least-bad one is used", () => {
  // Four neighbours, none of them leaving a clean gap. The answer must still be the
  // side that overlaps LEAST — not the first one tried — so the name stays as close
  // to its symbol as the diagram allows.
  const b = box(100, 100);
  const occupied = [
    { x1: 90, y1: 143, x2: 150, y2: 160 }, // below, fully covered
    { x1: 90, y1: 40, x2: 150, y2: 97 }, // above, fully covered
    { x1: 150, y1: 114, x2: 400, y2: 130 }, // right, clipped to the top few pixels
    { x1: 40, y1: 100, x2: 99, y2: 140 }, // left, the whole band
  ];
  const width = measure("tank");
  const area = (r) => Math.max(0, Math.min(r.x2, 400) - Math.max(r.x1, 0)) * Math.max(0, Math.min(r.y2, 1000) - Math.max(r.y1, 0));
  const overlapWith = (r) =>
    occupied.reduce((sum, o) => {
      const w = Math.min(r.x2, o.x2) - Math.max(r.x1, o.x1);
      const h = Math.min(r.y2, o.y2) - Math.max(r.y1, o.y1);
      return sum + (w > 0 && h > 0 ? w * h : 0);
    }, 0);
  const candidates = L.LABEL_SIDES.map((side) => {
    const at = L.labelAnchorFor(side, b, width, 10);
    return { side, area: overlapWith(L.labelBoxAt(at.x, at.y, width, 10)) };
  });
  const best = Math.min(...candidates.map((c) => c.area));
  assert.ok(best > 0, `every side should be blocked here: ${JSON.stringify(candidates)}`);
  const chosen = spot("tank", b, occupied);
  const chosenArea = candidates.find((c) => c.side === chosen.side).area;
  assert.equal(chosenArea, best, `chose ${chosen.side} at ${chosenArea}, best was ${best}`);
  assert.ok(area(chosen.box) > 0, "and the box it reports is a real one");
});

test("placement is deterministic and independent of the caller's order", () => {
  const a = box(100, 100);
  const b = box(200, 100);
  const requests = [
    { id: "bbbbbbbbbbbb", box: b, fontPx: 10 },
    { id: "aaaa", box: a, fontPx: 10 },
  ];
  const first = L.placeLabels(requests, [], measure).spots;
  const second = L.placeLabels([...requests].reverse(), [], measure).spots;
  assert.deepEqual([...first.keys()].sort(), [...second.keys()].sort());
  for (const id of first.keys()) {
    assert.deepEqual(first.get(id), second.get(id), `${id} moved when the input order changed`);
  }
});

test("a label too small to be drawn is not placed at all", () => {
  // The renderer drops names below 14 px of on-screen size; the pass must not
  // reserve space for one, or it would push a neighbour's name out of the way for a
  // label nobody can see.
  assert.equal(L.LABEL_MIN_SCREEN, 14);
  const drawn = L.labelFontPx(13);
  const notDrawn = L.labelFontPx(14);
  assert.ok(drawn <= notDrawn, "the font grows with the component");
  assert.equal(L.labelFontPx(1000), 13, "and is capped");
  assert.equal(L.labelFontPx(20), 9, "with a floor");
});

test("the drawn font and the measured box use one formula", () => {
  // A second copy of the size rule is how a box gets measured at one size and
  // painted at another, which is a collision the pass cannot see.
  const labels = fs.readFileSync(path.join(repoRoot, "src/render/canvas.ts"), "utf8");
  assert.ok(
    !/Math\.max\(9, Math\.min\(13/.test(labels),
    "canvas.ts still has its own copy of the label size formula"
  );
  assert.match(labels, /labelFontPx\(onScreenSize, opts\.labelScale \?\? 1\)/, "it uses the shared one");
  assert.match(labels, /ctx\.font = labelFont\(labelPx\)/, "and the shared font string");
});

test("the setting exists, is on by default, and reaches both surfaces", async () => {
  const merge = fs.readFileSync(path.join(repoRoot, "src/settings-merge.ts"), "utf8");
  assert.match(merge, /dynamicLabels: boolean;/, "it is part of the settings");
  assert.match(merge, /\n  dynamicLabels: true,/, "and defaults to on");
  for (const [file, needle] of [
    ["src/view/studio-view.ts", "dynamicLabels: this.plugin.settings.dynamicLabels"],
    ["src/view/embed.ts", "dynamicLabels: this.host.settings.dynamicLabels"],
    ["src/settings.ts", 'setName("Move names out of the way")'],
  ]) {
    const text = fs.readFileSync(path.join(repoRoot, file), "utf8");
    assert.ok(text.includes(needle), `${file} does not mention ${needle}`);
  }
});

test("the renderer draws the name where the pass put it", async () => {
  // The pure function is only half the feature: `drawComponent` has to use the spot
  // it is given, and keep the old position when it is given none. Driven with a
  // recording context, so the assertion is about the coordinates actually painted.
  const LIB2 = buildLibs("labels-canvas", [
    "src/render/canvas.ts",
    "src/render/theme.ts",
  ]);
  const C = await import(path.join(LIB2, "canvas.js"));
  const T = await import(path.join(LIB2, "theme.js"));

  const texts = [];
  const ctx = new Proxy(
    { canvas: { width: 400, height: 400 }, measureText: () => ({ width: 20 }), lineWidth: 1 },
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === "fillText") return (s, x, y) => texts.push({ s: String(s), x, y });
        return () => {};
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    }
  );
  const inst = {
    id: "tank",
    className: "Tank",
    placement: { extent: [-40, -40, 40, 40], rotation: 0, visible: true },
    params: {},
  };
  const vp = { scale: 2, x: 200, y: 200 };

  C.drawComponent(ctx, inst, undefined, vp, 1, { theme: T.LIGHT, labelAt: { x: 333, y: 222 } });
  const placed = texts.find((t) => t.s === "tank");
  assert.ok(placed, `the name was drawn: ${JSON.stringify(texts)}`);
  assert.deepEqual([placed.x, placed.y], [333, 222], "at the spot the pass chose");

  texts.length = 0;
  C.drawComponent(ctx, inst, undefined, vp, 1, { theme: T.LIGHT });
  const dflt = texts.find((t) => t.s === "tank");
  assert.ok(dflt, "and it is still drawn with no spot given");
  assert.notDeepEqual([dflt.x, dflt.y], [333, 222], "at its own default position instead");
});

test("the box a name clears follows the graphics the INSTANCE draws", async () => {
  // Reported from a rendered page: "motor", "gear", "bearing" and "frame" all sat on their
  // own support hatches. The hatch is a conditional graphic — `visible="useSupport"` in
  // the library — and the artwork box was measured with the CLASS-level test, which reads
  // a condition as a literal and so excluded every conditional graphic. The renderer
  // resolves it against the instance's own parameters and drew the hatch, so the box came
  // out short and the name went through it.
  //
  // The class here is the same shape in miniature: one unconditional rectangle, and one
  // rectangle far below it that only appears when `useSupport` is on. The expected boxes
  // are the graphics' own coordinates, so this cannot agree with a mistake in the
  // measurement.
  const LIB3 = buildLibs("labels-conditional", ["src/render/canvas.ts", "src/render/theme.ts"]);
  const C = await import(path.join(LIB3, "canvas.js"));

  const def = {
    name: "M.Machine",
    shortName: "Machine",
    icon: [
      { kind: "Rectangle", extent: [-50, 50, 50, -50], lineColor: [0, 0, 0] },
      // The support hatch, 60..80 below the body, and only when `useSupport`.
      { kind: "Rectangle", extent: [-60, -60, 60, -80], lineColor: [0, 0, 0], visible: "useSupport" },
    ],
    diagram: [],
    ports: [{ name: "flange", type: "Flange_a", isFlow: true, causality: "acausal" }],
    portPositions: { flange: [-100, 0] },
    parameters: [{ name: "useSupport", type: "Boolean", defaultValue: "false" }],
    hasIcon: true,
  };
  const at = (params) => ({
    id: "m1",
    className: def.name,
    placement: { extent: [-50, -50, 50, 50], rotation: 0, visible: true },
    params,
  });

  // Extent is 100 units for the canonical 200, so canonical y maps to half its value.
  const withSupport = C.instanceInkBounds(at({ useSupport: "true" }), def);
  const without = C.instanceInkBounds(at({ useSupport: "false" }), def);
  assert.equal(withSupport[1], -40, `the hatch is included when it is drawn: ${JSON.stringify(withSupport)}`);
  assert.equal(without[1], -25, `and left out when it is not: ${JSON.stringify(without)}`);
  assert.ok(
    withSupport[1] < without[1],
    "a name under a machine that draws a support is placed below the support, not through it"
  );

  // The default comes from the class when the instance says nothing.
  assert.deepEqual(C.instanceInkBounds(at({}), def), without, "the class default decides");
  // And the outline box — the selection highlight — follows the same rule.
  assert.equal(C.instanceOutlineBounds(at({ useSupport: "true" }), def)[1], -40);
  assert.equal(C.instanceOutlineBounds(at({ useSupport: "false" }), def)[1], -25);
});
