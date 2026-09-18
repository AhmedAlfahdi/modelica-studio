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
import {
  clampInspectorWidth,
  clampResultsHeight,
  CODE_RESULTS_H,
  DEFAULT_RESULTS_H,
  heightFromTopEdgeDrag,
  MIN_RESULTS_H,
} from "../src/view/panes.ts";
import { repoRoot } from "./helpers/build.mjs";

// Imported directly rather than through a bundle: `panes.ts` is kept free of any
// Obsidian import precisely so its numbers can be tested as they are.

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
  const view = 937;
  const diagram = clampResultsHeight(DEFAULT_RESULTS_H, view);
  const code = clampResultsHeight(CODE_RESULTS_H, view);
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
  // The handle renders on the pane's TOP edge, which is the boundary between the
  // diagram above and the results below -- so it comes BEFORE the results pane in
  // document order, and after the editing area.
  //
  // It used to come after the pane, putting it on the pane's bottom edge. That is
  // still attached to the pane, but it sits against the status bar at the far end
  // of the window: nowhere near the diagram it divides, and reported as "there is
  // no handle for the plot section" by someone looking straight at it.
  const splitIdx = src.indexOf("const resultsSplitter = root.createDiv");
  const resultsIdx = src.indexOf("const resultsCol = root.createDiv");
  const bodyIdx = src.indexOf('const body = root.createDiv({ cls: "modelica-studio-body" })');
  // Each anchor must EXIST before it is compared: `indexOf` answers -1 for a
  // rename, and -1 is less than everything, so a missing anchor would make the
  // ordering assertion pass while proving nothing. That happened here.
  assert.ok(bodyIdx >= 0, "the editing area anchor was found");
  assert.ok(splitIdx >= 0, "the handle anchor was found");
  assert.ok(resultsIdx >= 0, "the results pane anchor was found");
  assert.ok(splitIdx < resultsIdx, "the handle draws the pane's top edge, so it precedes it");
  assert.ok(bodyIdx < splitIdx, "and follows the editing area it divides from");
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

  // The boundary moves WITH the pointer. The grip draws the pane's TOP edge and
  // the pane is anchored at the bottom, so dragging down makes the pane SHORTER --
  // the sign is the opposite of the one a bottom-edge grip needs, and the invariant
  // is the same either way. The arithmetic lives in `heightFromTopEdgeDrag` so the
  // sign can be tested directly instead of pattern-matched out of the source.
  assert.match(impl[0], /heightFromTopEdgeDrag\(startH, ev\.clientY - startY\)/, "top-edge rule");
  assert.ok(!/apply\(startH \+/.test(impl[0]), "and not the bottom-edge sign, which would invert the drag");

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
    // A pane that grows downward takes `+deltaY`; one anchored at the bottom and
    // grown from its top edge takes `-deltaY`; the inspector grows leftward from
    // its left edge and takes `-deltaX`. Each is "towards the pointer" in the axis
    // that pane grows along.
    const addY = /startH \+ \(ev\.clientY/.test(impl);
    const topEdgeY = /heightFromTopEdgeDrag\(startH, ev\.clientY/.test(impl);
    const subX = /startW - \(ev\.clientX/.test(impl);
    assert.ok(addY || topEdgeY || subX, "each handle moves consistently with its edge");
  }
});


test("the results grip moves the boundary with the pointer", () => {
  // The invariant, stated as geometry rather than as a sign: the pane is pinned to
  // the bottom of the window, and the grip draws its top edge. Whatever the
  // arithmetic, the top edge must end up exactly where the pointer went -- a grip
  // that moves against the pointer is unusable, and a screenshot cannot show it.
  const BOTTOM = 900; // the pane's bottom edge, where the status bar starts
  const START_H = 300;
  const topEdge = (h) => BOTTOM - h;

  for (const deltaY of [-120, -40, -1, 0, 1, 40, 120]) {
    const next = heightFromTopEdgeDrag(START_H, deltaY);
    assert.equal(
      topEdge(next),
      topEdge(START_H) + deltaY,
      `dragging by ${deltaY} moves the boundary by ${deltaY}`
    );
  }

  // Spelled out, because the two directions are the whole point.
  assert.equal(heightFromTopEdgeDrag(300, 50), 250, "dragging DOWN shrinks the pane");
  assert.equal(heightFromTopEdgeDrag(300, -50), 350, "dragging UP grows it");
  // A no-op drag must not move anything.
  assert.equal(heightFromTopEdgeDrag(300, 0), 300, "a click without movement changes nothing");
});

test("the restored height is not clamped against an unlaid-out view", () => {
  // The pane came back the wrong size on every launch. The height restored at
  // construction was run through the window-dependent clamp, but the view has not
  // been laid out at that point, so `contentEl.clientHeight` is not the window's
  // height: a stored 309px became 274. The mode switch that would have corrected it
  // only runs when the mode CHANGES, so the wrong number stuck.
  const src = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  const restore = /const storedH = this\.storedResultsHeight\(\);[\s\S]{0,200}?\n    \}/.exec(src);
  assert.ok(restore, "the restore block is present");
  assert.match(restore[0], /Math\.max\(MIN_RESULTS_H, storedH\)/, "it applies the floor only");
  assert.ok(
    !/clampResultsHeight\(this\.storedResultsHeight\(\)\)/.test(src),
    "and never the window-dependent ceiling, which the view cannot answer yet"
  );

  // The ceiling is applied as soon as there is a real height, and re-applied when
  // the window changes -- otherwise a pane sized on a large monitor would push its
  // own grip off the top of a small one.
  const reclamp = /private installResultsReclamp\(\): void \{[\s\S]*?\n  \}/.exec(src);
  assert.ok(reclamp, "the re-clamp exists");
  assert.match(reclamp[0], /new ResizeObserver/, "it watches the real size");
  assert.match(reclamp[0], /clampResultsHeight\(current\)/, "and clamps the height in use");
  // Guarded against feedback: the observer must not act on an unchanged size.
  assert.match(reclamp[0], /h === measured/, "it ignores an unchanged measurement");
  // Installed where the pane is built, not inside its own body.
  assert.match(src, /this\.installResultsResize\([^)]*\);\s*\n\s*this\.installResultsReclamp\(\)/, "and is installed");

  // An observer left attached after the view closes is a leak.
  const close = /async onClose\(\): Promise<void> \{[\s\S]*?\n  \}/.exec(src);
  assert.ok(close, "onClose is present");
  assert.match(close[0], /this\.resultsReclamp\?\.disconnect\(\)/, "the observer is disconnected");
});
