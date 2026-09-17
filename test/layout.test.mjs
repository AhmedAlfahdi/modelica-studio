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
  // The handle renders on the pane's BOTTOM edge, which is the line between the
  // results and the editing area — so it comes AFTER the results pane in document
  // order. Before the pane it sat on the pane's top edge, above the tab strip.
  const resultsIdx = src.indexOf("const resultsCol = root.createDiv");
  const splitIdx = src.indexOf("const resultsSplitter = root.createDiv");
  const codeIdx = src.indexOf("this.buildCodePane(root)");
  assert.ok(resultsIdx < splitIdx, "the handle follows the pane it bounds");
  assert.ok(splitIdx < codeIdx, "and precedes the editing area it divides from");
});

test("the grip follows the pointer", () => {
  // Three faults lived here. The grip moved AWAY from the mouse -- dragging down
  // moved it up -- because the arithmetic shrank the pane above it. The pane that
  // received the drag depended on the mode, so one gesture moved different things.
  // And the code pane had a height of its own, so on a tall window it stopped
  // filling and left dead space below the editor.
  //
  // The rule: the grip follows the pointer, the results pane owns the height in
  // both modes, and the editing area takes the remainder. Which pane grows then
  // follows from where the grip is, and every handle in the view moves the same
  // way the mouse does.
  const src = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  const impl = /private installResultsResize[\s\S]*?\n  \}/.exec(src);
  assert.ok(impl, "the resize handler is present");

  // The boundary moves WITH the pointer: the delta is added, not subtracted.
  assert.match(impl[0], /apply\(startH \+ \(ev\.clientY - startY\)\)/, "down lowers the boundary");
  assert.ok(!/startH - \(ev\.clientY/.test(impl[0]), "and never moves against it");

  // No mode-dependent second formula.
  assert.ok(!/startH \* -1/.test(impl[0]), "one arithmetic for both modes");

  // The editing area is never given a height of its own.
  const mode = /private applyModeResultsHeight[\s\S]*?\n  \}/.exec(src);
  assert.ok(mode, "the mode handler is present");
  assert.match(mode[0], /codeHost\.style\.flex = ""/, "the editor is allowed to grow");
  assert.match(mode[0], /codeHost\.style\.height = ""/, "and carries no height of its own");
});

test("every handle in the view moves with the pointer", () => {
  // A handle that moves against the mouse is the bug being fixed, so no handle
  // may subtract an un-negated delta.
  const src = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  const splitters = [...src.matchAll(/private install\w*Splitter[\s\S]*?\n  \}/g)].map((m) => m[0]);
  splitters.push(/private installResultsResize[\s\S]*?\n  \}/.exec(src)[0]);
  assert.ok(splitters.length >= 2, `found ${splitters.length} handle implementations`);
  for (const impl of splitters) {
    // The inspector's is on the pane's left edge, so it subtracts an X delta:
    // dragging left must widen it. That is still "towards the pointer" in the
    // axis that pane grows along.
    const addY = /startH \+ \(ev\.clientY/.test(impl);
    const subX = /startW - \(ev\.clientX/.test(impl);
    assert.ok(addY || subX, "each handle moves consistently with its edge");
  }
});

