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
  clampPaletteWidth,
  clampResultsHeight,
  CODE_RESULTS_H,
  DEFAULT_PALETTE_W,
  DEFAULT_RESULTS_H,
  MIN_PALETTE_W,
  MIN_RESULTS_H,
  sizeFromDividerDrag,
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
  // The same missing-bound fault on the other divider: the canvas needs a minimum,
  // or the inspector can be dragged until the diagram has nowhere.
  assert.equal(clampInspectorWidth(380, 1400), 380, "an ordinary width is left alone");
  // The ceiling now also reserves the palette and two dividers, so the canvas gets
  // its 260 rather than having the palette's width quietly taken out of it.
  assert.equal(
    clampInspectorWidth(5000, 1400, 0),
    1400 - 260 - 0 - 18,
    "a huge request leaves the canvas its minimum"
  );
  assert.equal(
    clampInspectorWidth(5000, 1400, 210),
    1400 - 260 - 210 - 18,
    "and leaves the palette its width as well"
  );
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
  // Every divider is the same class, so there is one style to keep consistent and
  // a test can find them all without knowing three names. Two different styles was
  // the state this replaced.
  const css = fs.readFileSync(path.join(repoRoot, "styles.css"), "utf8");
  const stale = [...css.matchAll(/\.modelica-studio-[a-z-]*splitter\s*\{/g)].map((m) => m[0]);
  assert.deepEqual(stale, [], `no divider keeps the old per-pane style, got ${JSON.stringify(stale)}`);
  assert.match(css, /\.modelica-studio-divider\.is-col/, "the column variant exists");
  assert.match(css, /\.modelica-studio-divider\.is-row/, "and the row variant");

  const src = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  // Three panes, three dividers, all built by the one helper.
  const made = [...src.matchAll(/this\.makeDivider\((\w+), "([xy])", "([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(
    made.sort(),
    ["body", "body", "root"],
    `one divider per resizable pane, got ${JSON.stringify(made)}`
  );
  // The handle renders on the pane's TOP edge, which is the boundary between the
  // diagram above and the results below -- so it comes BEFORE the results pane in
  // document order, and after the editing area.
  //
  // It used to come after the pane, putting it on the pane's bottom edge. That is
  // still attached to the pane, but it sits against the status bar at the far end
  // of the window: nowhere near the diagram it divides, and reported as "there is
  // no handle for the plot section" by someone looking straight at it.
  const splitIdx = src.indexOf('const resultsSplitter = this.makeDivider(root, "y", "Results")');
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
  const impl = /private installDivider\(opts: \{[\s\S]*?\n  \}\n/.exec(src);
  assert.ok(impl, "the divider installer is present");

  // The boundary moves WITH the pointer. The sign depends on which side the pane
  // lies from its divider, so the installer reads the side rather than hard-coding
  // one -- and the arithmetic lives in `sizeFromDividerDrag`, where it is tested as
  // geometry instead of pattern-matched out of the source.
  assert.match(impl[0], /sizeFromDividerDrag\(\{ startSize, delta, side: opts\.side\(\) \}\)/, "one rule, told the side");
  // Each caller declares its side, which is what makes the sign follow.
  assert.match(src, /side: \(\) => "after"/, "a pane after its divider");
  assert.match(src, /side: \(\) => "before"/, "and the palette before its own");
  // The results read theirs from the mode, because the divider moves between the
  // plot's two edges.
  assert.match(src, /side: \(\) => \(this\.mode === "code" \? "before" : "after"\)/, "the plot reads the mode");
  // No hand-rolled sign anywhere: a second local formula is how the two old
  // installers came to disagree.
  assert.ok(!/apply\(startH/.test(impl[0]), "and no second, local formula");
  assert.ok(!/startH \* -1/.test(impl[0]), "one arithmetic for both modes");

  // The editing area is never given a height of its own.
  const mode = /private applyModeResultsHeight[\s\S]*?\n  \}/.exec(src);
  assert.ok(mode, "the mode handler is present");
  assert.match(
    mode[0],
    /codeHost\.setCssStyles\(\{ flex: "", height: "" \}\)/,
    "the editor is allowed to grow"
  );
  // `setCssStyles` clears both in one call, so the assertion above covers the flex and
  // the height; what matters is that neither is ever SET to a measurement here.
  assert.ok(!/codeHost\.style\.height\s*=/.test(mode[0]), "and carries no height of its own");
});

test("every handle in the view moves with the pointer", () => {
  // A handle that moves against the mouse is the bug being fixed, so there is now
  // ONE installer: three copies of the drag arithmetic is how two of them came to
  // behave differently from the third.
  const src = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  const perPane = [...src.matchAll(/private install\w*[Ss]plitter[\s\S]*?\n  \}/g)].map((m) => m[0]);
  assert.deepEqual(perPane, [], "no per-pane installers are left");

  const impl = /private installDivider\(opts: \{[\s\S]*?\n  \}\n/.exec(src);
  assert.ok(impl, "the shared installer is present");
  // It reads the axis and the side instead of hard-coding a sign, so all three
  // panes move with the pointer by construction rather than by three correct
  // guesses.
  assert.match(
    impl[0],
    /const delta = opts\.axis === "x" \? ev\.clientX - startPos : ev\.clientY - startPos/,
    "the axis is read from the pane it sizes"
  );
  assert.match(
    impl[0],
    /sizeFromDividerDrag\(\{ startSize, delta, side: opts\.side\(\) \}\)/,
    "and the side decides the sign"
  );
  // Three dividers, one builder, so they cannot drift apart in appearance either.
  const made = [...src.matchAll(/this\.makeDivider\(/g)].length;
  assert.equal(made, 3, `one divider per resizable pane, got ${made}`);
});


test("every divider moves its boundary with the pointer", () => {
  // The invariant, stated as geometry rather than as a sign: the divider IS the
  // pane's edge, so whatever the arithmetic the edge must end up exactly where the
  // pointer went. A divider that moves against the pointer is unusable, and that
  // is invisible in a screenshot -- which is why it is geometry here and not a
  // comment.
  //
  // Both arrangements are the same rule with the sign flipped: the results pane
  // and the inspector lie AFTER their divider, the palette BEFORE its.
  const AFTER_BOTTOM = 900; // results: pinned to the bottom, divider on top
  const edge = (h) => AFTER_BOTTOM - h;
  for (const delta of [-120, -1, 0, 1, 120]) {
    const next = sizeFromDividerDrag({ startSize: 300, delta, side: "after" });
    assert.equal(edge(next), edge(300) + delta, `a pane after its divider moves by ${delta}`);
  }
  // The inspector: after its divider, and dragging LEFT (negative) widens it.
  assert.equal(
    sizeFromDividerDrag({ startSize: 380, delta: -40, side: "after" }),
    420,
    "dragging the inspector's divider left widens it"
  );
  // The palette: BEFORE its divider, so dragging RIGHT widens it.
  assert.equal(
    sizeFromDividerDrag({ startSize: 210, delta: 40, side: "before" }),
    250,
    "dragging the palette's divider right widens it"
  );
  // Spelled out for the row case, because the two directions are the whole point.
  assert.equal(sizeFromDividerDrag({ startSize: 300, delta: 50, side: "after" }), 250, "down shrinks the results");
  assert.equal(sizeFromDividerDrag({ startSize: 300, delta: -50, side: "after" }), 350, "up grows them");
  // A no-op drag must not move anything, whichever side.
  assert.equal(sizeFromDividerDrag({ startSize: 300, delta: 0, side: "after" }), 300, "no movement, no change");
  assert.equal(sizeFromDividerDrag({ startSize: 300, delta: 0, side: "before" }), 300, "either side");
});

test("the palette is clamped so the diagram always has room", () => {
  // The palette had no clamp because it had no divider. Now that all three share
  // the width, each reserves the canvas minimum AND the current width of the
  // other panel, so widening one cannot squeeze the diagram to nothing.
  assert.equal(clampPaletteWidth(210, 1400, 380), 210, "a sensible width is left alone");
  assert.ok(clampPaletteWidth(900, 1400, 380) < 900, "a greedy one is pulled back");
  // And the canvas keeps its floor: 1400 - 260 canvas - 380 inspector - 18 dividers.
  assert.equal(clampPaletteWidth(9999, 1400, 380), 742, "the ceiling accounts for the inspector");
  assert.equal(clampPaletteWidth(10, 1400, 380), MIN_PALETTE_W, "the floor holds");
  assert.equal(clampPaletteWidth(NaN, 1400, 380), DEFAULT_PALETTE_W, "nonsense falls back");
  // Nothing measurable to clamp against: honour the request, never below the floor.
  assert.equal(clampPaletteWidth(300, 0, 0), 300, "an unmeasured view honours the request");

  // The inspector's ceiling accounts for the palette the same way.
  const wide = clampInspectorWidth(9999, 1400, 300);
  assert.ok(wide <= 1400 - 260 - 300 - 18, `the inspector leaves the palette and canvas room, got ${wide}`);
  // And a wide palette must not be able to Evict the canvas through the inspector.
  assert.ok(clampInspectorWidth(9999, 900, 400) >= 260, "the inspector keeps its own floor");
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
  const reclamp = /private installPaneReclamp\(\): void \{[\s\S]*?\n  \}/.exec(src);
  assert.ok(reclamp, "the re-clamp exists");
  assert.match(reclamp[0], /new ResizeObserver/, "it watches the real size");
  assert.match(reclamp[0], /this\.applyResultsHeight\(/, "and re-applies the height in use");
  // Every pane, not just the results: a width chosen on a wide monitor is the same
  // fault as a height, and nothing re-clamped the widths at all before.
  assert.match(reclamp[0], /this\.applyPaletteWidth\(/, "the palette too");
  assert.match(reclamp[0], /this\.applyInspectorWidth\(/, "and the inspector");
  // Guarded against feedback: the observer must not act on an unchanged size.
  assert.match(reclamp[0], /w === lastW && h === lastH/, "it ignores an unchanged measurement");
  // Installed where the panes are built, not inside its own body.
  assert.match(src, /this\.installDivider\([\s\S]{0,700}?\n\s*this\.installPaneReclamp\(\)/, "and is installed");

  // An observer left attached after the view closes is a leak.
  const close = /async onClose\(\): Promise<void> \{[\s\S]*?\n  \}/.exec(src);
  assert.ok(close, "onClose is present");
  assert.match(close[0], /this\.resultsReclamp\?\.disconnect\(\)/, "the observer is disconnected");
});

test("the re-clamp renders without remembering its own result", () => {
  // The re-clamp runs whenever the view changes size, so writing its result back
  // turned a moment of narrowness into the user's permanent choice. Found live:
  // the palette came back 194px wide -- a number nobody ever asked for -- because
  // some earlier layout had been narrower and the clamped value had been saved.
  const src = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  const reclamp = /private installPaneReclamp\(\): void \{[\s\S]*?\n  \}\n/.exec(src);
  assert.ok(reclamp, "the re-clamp is present");
  // Every apply in the re-clamp must omit `remember`, so none of them persists.
  const calls = [...reclamp[0].matchAll(/this\.apply\w+\(([^;]*)\)/g)].map((m) => m[1]);
  assert.ok(calls.length >= 3, `all three panes are re-applied, got ${calls.length}`);
  for (const args of calls) {
    assert.ok(
      !/true/.test(args),
      `the re-clamp must not remember its result, got apply(${args.slice(0, 60)})`
    );
  }

  // A gesture DOES persist, and only once it has finished.
  const install = /private installDivider\(opts: \{[\s\S]*?\n  \}\n/.exec(src);
  assert.ok(install, "the installer is present");
  assert.match(install[0], /opts\.apply\(lastSize, true\)/, "the finished drag is remembered");
  assert.match(install[0], /opts\.apply\(opts\.reset\(\), true\)/, "and so is a double-click reset");
  // During the drag it renders only -- an interrupted drag must not leave the
  // intermediate sizes saved.
  const move = /const onMove = \(ev: PointerEvent\) => \{[\s\S]*?\n    \};/.exec(install[0]);
  assert.ok(move, "the move handler is present");
  assert.ok(!/, true\)/.test(move[0]), "and intermediate sizes are not remembered");

  // The appliers default to NOT remembering, so a new call site is safe by default.
  for (const name of ["applyResultsHeight", "applyInspectorWidth", "applyPaletteWidth"]) {
    assert.match(
      src,
      new RegExp(`private ${name}\\(\\w+: number, remember = false\\)`),
      `${name} must default to not remembering`
    );
  }
});

test("the results divider sits on the boundary that is on screen", () => {
  // In diagram mode the plot is below the canvas, so its top edge is the boundary
  // the reader looks for. In code mode the editor is below the plot, so the
  // boundary is the plot's BOTTOM edge -- and the divider was left above the plot,
  // directly under the toolbar, attached to the pane but nowhere near the boundary
  // it controls. Reported as "add a resizing handle for this too" while looking
  // straight at the plot/editor split.
  const src = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  const pos = /private positionResultsDivider\(\): void \{[\s\S]*?\n  \}\n/.exec(src);
  assert.ok(pos, "the repositioning exists");
  // Diagram mode puts it BEFORE the pane, code mode AFTER.
  assert.match(pos[0], /const wantAfter = this\.mode === "code"/, "the mode decides");
  assert.match(pos[0], /insertAdjacentElement\("afterend", splitter\)/, "code mode: after the plot");
  assert.match(pos[0], /insertAdjacentElement\("beforebegin", splitter\)/, "diagram mode: before it");
  // Moving a node that is already in place would fight the DOM, so it checks.
  assert.match(pos[0], /results\.nextElementSibling === splitter/, "and does nothing when already right");

  // The SIGN has to follow the move, or the divider drags against the pointer in
  // one of the two modes.
  assert.match(
    src,
    /side: \(\) => \(this\.mode === "code" \? "before" : "after"\)/,
    "and the side is read from the mode at drag time"
  );
  // Re-positioned on every mode switch.
  const mode = /private setMode\(mode: "diagram" \| "code"\): void \{[\s\S]*?\n  \}\n/.exec(src);
  assert.ok(mode, "setMode is present");
  assert.match(mode[0], /this\.positionResultsDivider\(\)/, "the divider is moved on a mode switch");
  assert.ok(
    mode[0].indexOf("this.positionResultsDivider()") < mode[0].indexOf("this.applyModeResultsHeight("),
    "before the height is applied, since the side is read from the mode"
  );

  // Still ONE divider: a second handle on the same boundary was tried before and
  // gave two grips dragging in opposite directions.
  assert.match(src, /this\.installDivider\(\{[\s\S]*?pane: resultsCol/, "one results divider");
  assert.equal([...src.matchAll(/pane: resultsCol/g)].length, 1, "and only one");
});
