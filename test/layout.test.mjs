/**
 * Bottom-pane geometry.
 *
 * The results splitter sits on the TOP edge of the pane it resizes, so the pane's
 * height is also where the grip appears. With a minimum but no maximum, the pane
 * could be dragged until it filled the window — which pushed the grip towards the
 * top of the screen, and the handle then read as being "at the top" rather than
 * at the bottom of the editing area.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { buildLibs, repoRoot } from "./helpers/build.mjs";

// The clamp is pure, but it lives in a module that imports Obsidian.
const mod = await import(
  path.join(buildLibs("layout-lib", ["src/view/panes.ts"]), "panes.js")
);
const { clampResultsHeight, clampInspectorWidth, MIN_RESULTS_H, DEFAULT_RESULTS_H } = mod;

test("the results pane cannot be dragged taller than the view allows", () => {
  const view = 900;
  // Dragging far past the top of the window.
  const huge = clampResultsHeight(5000, view);
  assert.ok(huge < view, `a pane taller than the view is refused, got ${huge}`);
  assert.ok(huge <= view * 0.8 + 1, `at most 80% of the view, got ${huge}`);
  // And chrome below it stays reachable.
  assert.ok(view - huge >= 40, `room left below the pane, got ${view - huge}`);
});

test("the minimum is still enforced", () => {
  assert.equal(clampResultsHeight(10, 900), MIN_RESULTS_H, "a tiny request is raised to the minimum");
  assert.equal(clampResultsHeight(-500, 900), MIN_RESULTS_H);
});

test("an ordinary height is left alone", () => {
  assert.equal(clampResultsHeight(300, 900), 300, "a height inside the range is not adjusted");
  assert.equal(clampResultsHeight(400, 900), 400);
});

test("a short window still yields a usable pane", () => {
  // The interesting case: where 80% is less than the minimum.
  const tiny = clampResultsHeight(300, 200);
  assert.ok(tiny >= MIN_RESULTS_H, `never below the minimum, got ${tiny}`);
  assert.ok(tiny <= 200, `and never taller than the view, got ${tiny}`);
});

test("nonsense input falls back rather than propagating NaN", () => {
  assert.equal(clampResultsHeight(Number.NaN, 900), DEFAULT_RESULTS_H, "a NaN height becomes the default");
  assert.equal(clampResultsHeight(300, 0), 300, "an unmeasurable view keeps the request, bounded below");
  assert.equal(clampResultsHeight(50, 0), MIN_RESULTS_H, "still not below the minimum");
});

test("the inspector keeps the canvas a usable width", () => {
  // The same missing-bound fault on the other splitter: the canvas needs a
  // minimum, or the inspector can be dragged until the diagram has nowhere.
  assert.equal(clampInspectorWidth(380, 1400), 380, "an ordinary width is left alone");
  assert.equal(clampInspectorWidth(5000, 1400), 1140, "a huge request leaves the canvas 260px");
  assert.ok(clampInspectorWidth(5000, 1400) <= 1400 - 260);
  assert.equal(clampInspectorWidth(10, 1400), 260, "never below the minimum");
  // A window narrower than the minimum plus the canvas cannot satisfy both; the
  // minimum wins, because a zero-width inspector is useless.
  assert.equal(clampInspectorWidth(400, 300), 260);
});

test("code mode asks for a shorter results pane than diagram mode", async () => {
  // The pane sits ABOVE the editing area, so its height comes straight out of
  // what is being edited. At the diagram default it took 38% of a 937px view and
  // left the code editor looking like mostly empty space above the text.
  const panes = await import(
    path.join(buildLibs("layout-lib2", ["src/view/panes.ts"]), "panes.js")
  );
  const view = 937;
  const diagram = panes.clampResultsHeight(panes.DEFAULT_RESULTS_H, view);
  const code = panes.clampResultsHeight(panes.CODE_RESULTS_H, view);
  assert.ok(code < diagram, `code mode leaves more room, got ${code} vs ${diagram}`);
  // And the editor gets the majority of a normal view.
  assert.ok(code / view < 0.3, `the pane takes well under a third, got ${code}/${view}`);
  assert.ok(diagram / view < 0.4, "and diagram mode still leaves the canvas most of it");
});

test("there is exactly one handle between the results and the code pane", () => {
  // The code pane is bounded by the results pane above it, so ONE handle divides
  // them. A second handle on the same boundary gave two grips dragging in
  // opposite directions, and neither was the one that mattered.
  const css = fs.readFileSync(path.join(repoRoot, "styles.css"), "utf8");
  const splitters = [...css.matchAll(/\.modelica-studio-([a-z-]*splitter)\s*\{/g)].map((m) => m[1]);
  assert.deepEqual(
    splitters.sort(),
    ["results-splitter", "splitter"],
    `one horizontal handle and one vertical, got ${JSON.stringify(splitters)}`
  );

  const src = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  const splitIdx = src.indexOf("const resultsSplitter = root.createDiv");
  const resultsIdx = src.indexOf("const resultsCol = root.createDiv");
  const codeIdx = src.indexOf("this.buildCodePane(root)");
  assert.ok(splitIdx < resultsIdx && resultsIdx < codeIdx, "handle, then results, then code");
});

test("the handle resizes the pane it appears to belong to", () => {
  // Diagram mode: the handle is at the canvas's bottom edge, so dragging down
  // takes space from the canvas. Code mode: it is at the editor's TOP edge, so
  // dragging up takes space from the plot and gives it to the editor. One
  // boundary, described from whichever side is on screen.
  const src = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  const impl = /private installResultsResize[\s\S]*?\n  \}/.exec(src);
  assert.ok(impl, "the resize handler is present");

  // Which pane receives the drag is decided by the mode...
  assert.match(impl[0], /const inCode = \(\) => this\.mode === "code"/);
  // ...the diagram pane subtracts the delta, the code pane adds its negative,
  // which is the same sign — so a downward drag always shrinks what is above the
  // boundary, and the two never fight.
  assert.match(impl[0], /startH - dy/, "the diagram pane subtracts");
  assert.match(impl[0], /startH \+ dy \* -1/, "the code editor adds the negated delta");
  // Double-click restores the default for the mode on screen.
  assert.match(impl[0], /inCode\(\) \? DEFAULT_CODE_H : DEFAULT_RESULTS_H/);
});

