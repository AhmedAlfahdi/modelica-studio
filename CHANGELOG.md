# Changelog

Notable changes to Modelica Studio. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html). While the major
version is 0, a minor bump may include changes that are not backward compatible.

## [0.2.0-beta.2] — 2026-09-19

### Fixed

- **Stop did nothing until the request finished on its own.** The button set a
  flag that is only read BETWEEN attempts, and one attempt is one HTTP call that
  can legitimately run for the whole timeout. The client had accepted an
  `AbortSignal` all along; the view never passed one. Stop now aborts the call, so
  it takes effect in a fraction of a second — and a stopped run says it was
  stopped rather than reporting that the provider could not be reached.

### Changed

- **The AI is told to write equations rather than unwired blocks.** A model of
  loose blocks compiles, simulates, and is worth nothing. The rule now outranks
  the rest, with the test to apply — walk your own component list and ask which
  pin of which other component each one joins — and equations are named as a GOOD
  answer when the structure cannot be wired, because the diagram instruction
  otherwise pushes hard with no way out.
- **Documentation is required, not encouraged.** A comment on every declaration
  with its unit, each group of equations labelled with what it establishes, and a
  comment on any line whose purpose is not obvious. These models are read by people
  learning the subject, and a model without them is unfinished even when it
  compiles.

### Fixed

- **A documented answer was rejected for documenting.** `describeStyleViolation`
  counted components and connections in the raw source, so an equations answer that
  illustrated the diagram it had considered — in comments — was rejected for
  containing it: the more thoroughly it explained itself, the more certainly that
  happened. It strips comments now, like the other two checks.

- **New left the previous model on the canvas.** `newModel` replaced the diagram
  and left `modelSource` pointing at the model being replaced, so the editor was
  filled from that stale text — and the editor's own change handler parsed it
  straight back into the plugin. The canvas then repainted the model the user had
  just asked to replace. It was the only one of five model-replacing paths that
  missed the source; all five now go through one method that sets the diagram and
  its source together, so a new path cannot repeat it.
- **An AI request could sit for the whole timeout and answer nothing.** The
  `Thinking` setting was on `High`, which asks the provider to reason at length
  before answering — the client's own note calls it "the difference between
  seconds and minutes", and on its own it can exceed the five-minute timeout. Its
  label described it as "the provider's own default", which reads as the safe
  choice. The hints now state what each level costs, a running request names the
  level beside its clock, and a timeout names the level as the likely cause
  instead of sending the reader to check the provider.
- A missing optional field in the installation brief threw before the request was
  sent, which from outside looks like the AI doing nothing at all.

## [0.2.0-beta.1] — 2026-09-18

The first beta was a proof that the idea worked. This one is the editor you can
actually keep a model in: wires can be edited, every pane can be sized, and the
several ways a saved model could quietly revert have been closed.

### Added

- **Wire editing.** Click a wire to select it, drag a corner to re-route it,
  double-click to restore the automatic route, and Delete to remove it. Wires can
  be swept up by the marquee and selected with Select all alongside components.
- **Resizable panes.** The component palette, the inspector and the plot/log pane
  all resize from a divider on their own edge, with double-click to reset. A
  palette with no divider could only ever be its default width.
- **Save state, and a save offer.** The status line says `not saved` or
  `unsaved changes` rather than only `Ready`, and a model the AI produced is
  offered for saving once it compiles and runs. Nothing previously distinguished
  "it worked" from "it was kept".
- **Diagnostics you can read back.** `modelicaStudio.trace()` prints what the
  plugin HELD at each step — the model, the length of its source, whether that
  source was current, and the file it would be written to. The log recorded what
  the plugin did, which is no help afterwards.
- **Revert.** A button in the Model group reloads the model from its file,
  discarding everything since the last save.
- **Palette keyboard access.** Arrow keys move, Home and End jump, Enter places.
  The palette had no keyboard path at all.
- **Model history.** Every save keeps a revision, capped at 20, and deleting a
  model is reversible.
- **Help inside the studio**, with the keyboard shortcuts, the installation facts
  and links to the Modelica and OpenModelica documentation.
- **Saved models as a list**, showing which recorded files exist and which do not,
  with a repair for paths that point at nothing.
- **AI generation with a compile-and-repair loop**, a deadline, and a choice of
  effort and form. `visual` asks for a schematic, `equations` for a model of only
  variables.
- **A recorded AI baseline** (`docs/ai-baseline.md`), including what it does not
  prove.

### Fixed

These are the ones that mattered. Each let a change appear to be saved when it
was not, and each was silent at the time.

- **A declaration's binding was written as a modifier of itself.**
  `parameter Real x = 1` was serialised as `x(x = 1)`, which says "set the member
  `x` of the type `Real`". OpenModelica answers *"Modified element x not found in
  class Real"* and the model will not build. It was hard to see because the damage
  was symmetric: the text on disk was correct, the parsed diagram held the fault,
  and re-serialising produced it again — so an AI repair of the text changed
  nothing that lasted.
- **A restart loaded the plugin's own copy, not the file.** `data.json` held the
  source, saving never updated it, and startup never read the file. A model saved
  correctly came back as whatever the snapshot happened to hold.
- **Saving wrote a rebuild of the diagram.** Comments and formatting were
  normalised away, so a fix made in the editor appeared to vanish. The source is
  now what is saved, wherever it is current.
- **Opening another model cancelled the pending save**, so a repair made just
  before switching was never written. The outgoing model is flushed first.
- **A save in the last 600 ms was lost on unload.** The debounce timer was still
  pending when the plugin went away.
- **The code editor consumed its own layout newline**, so a model gained a blank
  line every time it was saved and reopened.
- **A resize re-clamp saved its own clamped result**, so a moment of narrowness
  became the user's permanent pane width — the palette came back at 194px, a
  number nobody asked for.
- **Selected wires could not be deleted** by the key, the toolbar button or the
  menu; all three counted only components.
- **Undo left a stale wire selected**, so the inspector reported connections that
  were not there.
- **Compile errors appeared in the Selection tab**, which is about the selected
  component. They now go to the Run log, whose tab is marked until a run succeeds.
- **Delete was one mis-click from destroying a model**, sitting beside the history
  button on every row. It is behind a menu.
- **The results divider was on the wrong edge** — the pane's bottom, against the
  status bar, rather than the boundary it moves. It now follows the mode: the
  canvas/plot boundary in diagram mode, the plot/editor boundary in code mode.
- **An unknown solver produced all-NaN results.** `rungekutta4` does not exist;
  the misspelling warned, exited 0, and wrote NaNs. Results are rejected now, and
  the solver list comes from the runtime.

### Changed

- **The Source tab is gone** from the results strip. It was not a view of the
  results — it was a shortcut into code mode, and the toolbar already has a Code
  tab. With it gone the strip no longer depends on the editor mode at all.
- **One divider style** across all three panes, and one implementation of the
  drag, so they cannot behave differently.
- **The responsive rules no longer override a width you dragged** on a narrow
  window.
- Tooltips come from one mechanism. Several controls had two, and showed both.
- The performance section is a table grouped by when each cost is paid, rather
  than a paragraph of numbers that disagreed with each other.

### Testing

- **The UI is tested by rendering it.** The tests built the real classes in a real
  engine and inspected the result: the settings tab, the dialogs, the palette, the
  plot, and the code editor. What they replaced grepped the source, which proves a
  line exists and nothing about whether anything renders.
- **Gestures are driven with real pointer events**, which is what proves a click
  stores no route, one undo restores it, and the ends of a wire stay on their pins.
- 475 tests across 29 files, up from 68.
- The parameter round trip is tested on five declaration shapes, each of which has
  to survive a parse and a re-serialise unchanged.

## [0.1.0-beta.1] — 2026-09-14

First beta. A visual schematic editor, OpenModelica behind it, AI generation with
a repair loop, and a 33-document example vault whose models are checked against
values derived independently of the plugin.
