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

test("the code editor is bounded at both ends too", async () => {
  const panes = await import(
    path.join(buildLibs("layout-lib3", ["src/view/panes.ts"]), "panes.js")
  );
  const view = 937;
  // The editor is bottom-anchored with its grip on its own top edge, so its
  // height is what the handle controls — and it must never take the whole view,
  // or there would be no results pane left and no way to drag the handle back.
  const huge = panes.clampCodeHeight(5000, view);
  assert.ok(huge < view, `never the whole view, got ${huge}`);
  assert.ok(view - huge >= 160, `room left for the results pane, got ${view - huge}`);
  assert.equal(panes.clampCodeHeight(10, view), panes.MIN_CODE_H, "never below the minimum");
  assert.equal(panes.clampCodeHeight(420, view), 420, "an ordinary height is untouched");
  assert.equal(panes.clampCodeHeight(Number.NaN, view), panes.DEFAULT_CODE_H);
});

test("each handle is on the edge its pane hangs from", () => {
  // Three resizable panes, two hanging from their top edge and one from its
  // side, and the drag direction has to match the edge or the grip moves the
  // wrong thing. This is what went wrong: a handle at the BOTTOM of the results
  // pane looked like it belonged to the code editor, and dragging it resized the
  // plot instead.
  const css = fs.readFileSync(path.join(repoRoot, "styles.css"), "utf8");
  const code = /(?:^|\n)\.modelica-studio-code-splitter\s*\{[^}]*\}/.exec(css);
  assert.ok(code, "the code editor has a handle of its own");
  assert.match(code[0], /row-resize/, "it resizes vertically");
  assert.ok(!/col-resize/.test(code[0]), "and not horizontally");

  const src = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  // The code handle must be built before the pane it controls, so it sits above
  // it in document order, and it must drive the code host rather than the results.
  const buildIdx = src.indexOf("this.codeSplitter = root.createDiv");
  const hostIdx = src.indexOf("const host = root.createDiv({ cls: \"modelica-studio-code\" })");
  assert.ok(buildIdx > 0 && hostIdx > buildIdx, "the handle comes before the code pane");
  assert.match(src, /installCodeResize\(this\.codeSplitter, host\)/, "and resizes the code pane");
  // Opposite directions: the results pane hangs from its top edge, the code pane
  // is bottom-anchored.
  assert.match(src, /startH - \(ev\.clientY - startY\)/, "the results handle subtracts");
  assert.match(src, /startH \+ \(startY - ev\.clientY\)/, "the code handle adds");
});
