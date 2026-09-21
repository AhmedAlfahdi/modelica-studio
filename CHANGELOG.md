# Changelog

Notable changes to Modelica Studio. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html). While the major
version is 0, a minor bump may include changes that are not backward compatible.

## [0.2.0-beta.24] — 2026-10-11

### Fixed

- **The Δ button sat outside the group it belongs to.** The button was created into
  the results row before the group that holds the sweep controls was built, so it
  floated between the scale group and the comparison group — reported from a
  screenshot: "the delta button seems to be outside the group". It is now the first
  control inside the comparison group, where it reads as part of the thing it
  switches.

- **Visible dividers between the groups.** A box outline alone left the three groups
  reading as one long strip, so a full-height rule now stands between them, and the
  group fill is softer than the row around it — a heavy fill beside a heavy rule
  reads as two competing edges.

## [0.2.0-beta.23] — 2026-10-10

### Changed

- **The results bar is grouped.** Nine buttons in one row said nothing about which
  belonged together — the Δ toggle, the sweep parameter, the values field, Sweep and
  Keep as before were a flat run of controls beside the scale buttons and the figure
  buttons. They are now three boxed groups: how the plot is scaled, what is being
  compared, and the plot as a picture — each with its own `aria-label`, so the
  grouping is stated rather than only implied by a border.

- **One control height across the row.** The Δ button was a small square beside
  full-height buttons, which made it read as a different kind of control rather than
  the toggle it is.

## [0.2.0-beta.22] — 2026-10-09

### Fixed

- **The Scale panel reopened itself.** Whether it was open was read back off the
  element's own `display`, and the pane's layout pass set that to visible whenever
  the panel had content — so closing it and then changing a trace (which re-renders
  the pane) brought it back. Reported as "the scale button is buggy, it keeps
  appearing if I change traces".

  Being open is now a decision held in the view, and the layout respects it: the
  panel is hidden while the log is showing, hidden when it has been closed, and
  closed again when a new result arrives with a new range.

## [0.2.0-beta.21] — 2026-10-08

### Fixed

- **The deltas never appeared.** Naming the run on screen — which beta.18 did so the
  legend could say `resistor.R=20` — left EVERY row of the readout with a label, and
  the delta was measured against "the row with no label". On a swept plot there was
  therefore no reference: six curves listed, no difference printed, and a toggle
  that had nothing to switch. The reference is now the run on screen BY NAME, which
  is what the caller already knows.

  Reported with a screenshot of a three-value `resistor.R` sweep, while the status
  line said "differences shown" — the toggle was on and working; it was hiding a
  comparison that could not be computed.

### Added

- The same switch in **Settings → Diagram labels**: *Show differences in the plot
  readout*. It is on by default — that was already true, and the defect above is why
  it looked otherwise — and the Δ button in the results bar still toggles it while
  you are looking at the plot.

## [0.2.0-beta.20] — 2026-10-07

### Fixed

- **The delta button did nothing you could see.** It toggled the setting and
  repainted, but it had no visible on/off state — a plain button among plain
  buttons — and its effect lives in the hover readout, which only exists while the
  cursor is over the plot AND there is a family to compare against. Pressing it on
  a single run therefore changed exactly nothing on screen. Reported as "when
  pressing the delta button nothing happens".

  It now carries `is-active` while on (accent border and background) and
  `is-idle` while there is nothing to compare, with a tooltip that says so. The
  status line names where to look — "differences shown — rest the cursor on the
  plot" — or says plainly that there is nothing to compare yet and what to do
  about it.

## [0.2.0-beta.19] — 2026-10-06

### Added

- **The cursor readout shows deltas.** With a family on screen, resting the cursor
  on the plot now says how far each swept curve is from the run on screen at that
  instant — `Δ capacitor.v vs source.V=10 = +0.626` — signed, because the direction
  is the answer as often as the size. On by default, with a **Δ** button in the
  results bar to turn it off and on; the choice is remembered. It is empty unless
  there is a family to compare against.

- **The Help window is tabbed** — Overview, Diagrams, Results, About — instead of
  one column. Seven subjects in a single scroll meant finding out how a sweep works
  required scrolling past the domain colours and the keyboard shortcuts. Nothing is
  lost by tabbing: every panel is built and only hidden.

- **Help has a "Sweeps and families" section**, which is where the questions this
  week's conversation raised are answered in the app: what a sweep is, why only
  parameters can be swept and a `start` value cannot (with the two-line change that
  makes an initial height sweepable), what Keep as before is for, what Clear family
  does, and what the Δ toggle and the figure buttons do.

## [0.2.0-beta.18] — 2026-10-05

### Fixed

- **A swept plot did not say which curve was which.** The legend named the family
  after its value (`capacitor.v · source.V=10`) and said nothing at all about the
  run on screen, so telling 10 V from 15 V meant remembering that the last value
  of a sweep becomes the current run. Every curve in a family now carries its own
  number — `capacitor.v · source.V=15` for the solid one, `· source.V=10` for the
  dashed. Reported from a screenshot of an RLC sweep.

- **The sweep field emptied itself after every run**, taking with it the only
  record of what had been asked for — while the curves it produced were still on
  screen. The parameter and the values are now remembered and restored when the
  results row is rebuilt after a run.

## [0.2.0-beta.17] — 2026-10-04

### Fixed

- **The legend drew every swatch solid, including the dashed family.** The dash is
  what tells a kept run (`h · e=0.7`) from the run on screen (`h`), and the legend
  is where that is read — but the dash was reset before the legend was drawn, so a
  legend naming ten traces distinguished none of them. Each swatch now carries the
  series' own line style. Reported from a screenshot of a swept plot.

## [0.2.0-beta.16] — 2026-10-03

### Fixed

- **The sweep offered parameters that cannot be swept.** `collectParameters`
  answers "what values does this model have?", which includes the initial-state
  entries — `h.start`, `h.fixed`, `atRest.start`. Overriding one of those is
  silently ignored, so a sweep of `h.start` came back as two identical curves: the
  picture said "nothing changed" about a value that never changed. The list is now
  the parameters proper — a name that is not an attribute, with a numeric value —
  which for a bouncing ball is `e` and `v_min`.

- **A sweep did not say which model it was sweeping.** Its status line and the
  notice when it stops now name the model: `Sweeping DampedBounce: e=0.6 (1 of
  3)…`, and `the sweep of DampedBounce stopped — …`. A run of the wrong model is
  the failure that reads as a physics problem, because the error quotes components
  the user did not draw; naming the model is what makes that visible in one line
  rather than three exchanges.

## [0.2.0-beta.15] — 2026-10-02

### Added

- **Check can now hand the report to the AI.** The report has an *Ask the AI to
  fix it* button, which sends the model and the findings through the repair path
  that already existed — the result lands in the editor for review, never over the
  model.

  The gap it closes is not the button, it is that the repair path was unreachable
  for this fault: *Send to AI* lives in the run log and is offered when a run
  **fails**, and a diagram with isolated blocks usually does not fail. It
  compiles, integrates, and draws a flat line — which is the whole reason the
  check exists. The one case that needed the repair could not reach it.

- **The repair prompt says which problem it is.** "The model below does not
  compile" was wrong for a loose diagram, and it invites a rewrite of the physics
  when the fault is that two blocks are not joined. It now reads *"compiles but
  does not work: <the finding> … join the components with connect(...) statements
  — this is a schematic, so the wiring is the model"*. The wiring requirement is
  stated up front because it is what the caller checks: this vault's own AI log
  has five exchanges rejected for loose wiring, each rejection repeating the same
  sentence. Saying it once is cheaper than five repairs discovering it.

- The findings are carried into **every** repair, including one started from a
  failed run: a model can both fail to compile and have two blocks wired to
  nothing, and the second explains the first ("variable p does not have any
  remaining equation to be solved in").

## [0.2.0-beta.14] — 2026-10-01

### Added

- **Figures.** A plot and a diagram are canvases, and until now nothing could
  leave the app: a result could be seen, hovered and measured, and not shown to
  anybody who was not sitting in front of Obsidian — which is the whole of a
  written course, a slide and a bug report. The results bar has **Copy image** and
  **Save image**; the command palette has the same two for the diagram; and a
  block in a note has a camera button for whichever pane it is showing. A saved
  figure lands beside the note that asked for it, named for the model and the
  minute, and its link is put at the cursor — so the picture ends up where the
  words about it are. Copying asks for the PNG rather than a screenshot, so what
  arrives is the plot and not the theme, the sidebars and the scroll position.

- **Check the model without running it.** *Check the current model*, or the
  **Check** button in the code toolbar: the connectivity check that was written to
  validate AI output ("4 components are connected to nothing: height,
  downward_velocity, …" — five of the exchanges in this vault's own log) now runs
  on a model a person drew, and the compiler is asked about everything else — a
  parameter with no value, a variable with no equation. Compiling is not
  simulating, so it is nearly free and the built model is kept for the next run.
  The connectivity half is also shown above the run log whenever it applies: the
  failure it catches is silent, because a loose diagram compiles and the flat line
  that comes out reads as a fact about the physics.

  A "parameter has no value" guess is deliberately NOT part of the static half:
  the parser cannot tell a declaration with no default (`parameter SI.Time
  T(start=1)`) from one whose default is an expression (`parameter Real x = 2*k`),
  so a check built on it would cry wolf on half the library. The compiler knows,
  and its answer is the one that decides whether the model runs.

- **Families of curves.** A sweep — a parameter, the values to try (`100, 200,
  400`, or `100:50:400`), one button — and **Keep as before**, which draws the run
  on screen dashed behind the next one. The point of most of the models in a
  course is what happens when a number changes, and one run at a time answers that
  with a sequence of screenshots. The plot takes one result, so the family is
  folded into it: each trace is named after the run it came from (`mass.s ·
  R=100`), resampled onto the current time grid if the two differ, and drawn
  dashed so it reads as the past rather than as another measurement.

## [0.2.0-beta.13] — 2026-09-30

### Fixed

- **A block could write its model into the wrong lines of a note.** The write-back
  replaced the lines recorded when the block was RENDERED, checked only against the
  length of the current file — so a note that had moved since (the user typing
  above the block, another window, a sync client) got the body spliced into
  whatever now occupied those lines. Reproduced before the fix: writing through a
  range shifted by two lines deleted the block's opening fence and left the model
  in the middle of it. The paragraph above survived that time by luck; a different
  offset eats text.

  The range must now still be the block: a fence of the right language above, a
  closing fence below, and — the half that needs the block's own state — the same
  body in between. A block that has written once advances what it expects to find,
  so the second edit of a burst is not refused as a conflict with the first, and
  an empty block expects an empty note rather than the starter model it renders.
  A refusal is reported instead of dropping the edit quietly: the diagram on
  screen has moved and the note has not, and only the user can decide which is
  right. Line endings are compared loosely, or a note saved with CRLF would refuse
  every write.

- **The palette painted `%T` and `%name` in its thumbnails.** A thumbnail drew the
  class's graphics directly, with no resolver, so every macro was drawn as written
  — `HeatCapacitor` read `%C`, and any labelled block had `%name` in its corner.
  It now substitutes the class's own values and leaves out `%name`, which is the
  instance's and has nothing to name in a palette.

- **A macro with no value is shown as `?`, not as itself.** MSL labels icons with
  the value of a parameter that has no default at class level
  (`parameter SI.Time T(start=1)`, label `T=%T`), and there is nothing to show
  until an instance sets one. `T=%T` reads as a broken renderer; `T=?` reads as
  "not set yet", which is what is true. Measured over Modelica 4.1.0: 531 icon
  labels use a macro other than `%name`, **none** is left painting a macro, and
  **325** have no value to show — a number now pinned by a test so a parameter
  that stops being resolvable is noticed.

### Added

Tests for three areas that had none, from a review of what the suite does not
reach: the write-back guard (its own cases, plus what a block tells the writer and
when), the plot's axis planning — which decides whether two traces share an axis,
caps the split at two, groups the remainder and drops unusable series, none of
which was tested before — and the library-wide macro sweep above.

## [0.2.0-beta.12] — 2026-09-29

### Fixed

- **The palette's search count read as a component count.** `Matches (200 of 434)`
  invited, reasonably, *"how come out of 434? how many components are there?"*. The
  number in the parentheses is how many NAMES the query matched, and a fuzzy match
  lets the query's letters land anywhere in a qualified path — which is what makes
  `cvs` find `ConstantVoltage` and also what makes a five-letter query match
  hundreds of unrelated paths. Measured over the index this installation holds:

  | | |
  |---|---|
  | Classes in the index | 6,127 |
  | `Icons`/`Examples` scaffolding (1,046) and partial classes (472), never offered | −1,407 |
  | Names the search looks at | 4,720 |
  | Components the palette can place | **1,365** |
  | Paths `force` matches | 434 |
  | …of those, with `force` anywhere in the path | 55 |
  | …of those, with `force` in the class name | 38 |

  The label now says `Showing 200 of 434 matches` — the same fact with the noun
  attached — and `434 matches` when nothing is held back. The figure for what the
  palette offers was already in the README's exclusion table as "placeable
  classes"; it is unchanged.

  *Corrected the same day:* this entry first carried 544 / 81 / 64, measured over
  every name in the index rather than over the 4,720 the search actually looks at.
  The count the palette reports — 434 — is the one in the table now, checked
  against the running app as well as offline.

## [0.2.0-beta.11] — 2026-09-28

### Added

- **A Copy button on the logs.** The AI prompt log is a read-only dialog, and
  getting its text out meant selecting it by hand from a scrolling block — which
  is the part people get wrong when they want to paste a failure into a prompt or
  a bug report. The same dialog shows a saved revision of a model, so one button
  serves both. The run log in the results pane already had one.

  All three now go through one helper, which is also a fix: the run log's button
  wrote to the clipboard and announced "Run log copied." unconditionally.
  `navigator.clipboard.writeText` rejects for reasons that have nothing to do with
  the plugin — an unfocused window, a platform that wants a gesture — and a button
  that claims a copy that did not happen is worse than one that fails loudly,
  because the paste lands somewhere else, or nowhere. A refusal now says why, and
  an empty log says there is nothing to copy instead of copying an empty string.

## [0.2.0-beta.10] — 2026-09-27

### Fixed

- **Highlighting a model in the embed picker did not stay highlighted.** Every
  hover rebuilt the list, so the row the pointer was resting on was replaced —
  the highlight blinked — and the scroll that came with the rebuild could reflow
  the dialog and leave a *different* row under the pointer, which then
  highlighted in turn. Measured in the test: hovering the twenty-ninth of thirty
  rows scrolled the list from 66 to 1038 pixels, and the row element was a new
  one each time.

  The list is now painted once per search and the highlight is moved by toggling a
  class on the existing rows, so the element under the pointer is never replaced.
  A hover never scrolls at all — the row under the pointer is by definition
  visible — and the keyboard, which can walk to a row that is out of view, moves
  the list's own scroll offset rather than calling `scrollIntoView`, which also
  scrolls the dialog the list sits in.

## [0.2.0-beta.9] — 2026-09-26

### Added

- **Commands that put a simulation into a note.** *Embed a simulation in the
  current note* asks which model — the one open in the studio, one of the built-in
  examples, or a saved `.mo` file, in one searchable list — and writes the block at
  the cursor. *Embed the open model in the current note* skips the question. The
  same dialog copies the block to the clipboard instead, for pasting anywhere.

  The dialog exists because of the directive. A block's options live on its first
  line — `//@ time=20 height=400 edit` — because Obsidian does not pass a code
  block's info string to a plugin, so they cannot live in the fence. That makes
  them the one part of embedding a model that has to be remembered, and the part
  where being wrong is invisible: a block that runs for a twentieth of the time its
  model needs draws a plausible, useless line. So the dialog writes them: the span
  follows the model you pick, and the height and the pane it opens on are fields
  rather than syntax. The chosen span is written into the block, so a later change
  to the plugin's own default cannot re-scale a note written against a
  3000-second thermal model.

  A vault file is offered by path and read only when it is chosen, and a model
  whose recorded file is missing is left out rather than offered as a row that
  produces nothing.

- The Help window explains the two commands, and the README's block section says
  how to get a block into a note.

### Fixed

- **A test of the save rule had anchored itself on the first mention of a method's
  name** rather than its definition, so adding a caller earlier in the file made it
  read the wrong text. It now anchors on the definition.
- The reshape test pins the diagram's viewport instead of leaving it to an
  automatic fit. It reasons about where a wire is on the canvas, and a fit landing
  between that reasoning and the pointer events would invalidate it; the test is
  about the undo history, not the framing.

## [0.2.0-beta.8] — 2026-09-25

### Fixed

- **A test fixture, and nothing else.** `0.2.0-beta.7` could not run the three
  suites that drive a browser, because this machine's Wayland session had stopped
  accepting new Electron clients part-way through that session. On a machine where
  Electron starts, one of those suites then failed — on the fixture, not the code:
  adding the `%C` case replaced the class's `R` parameter with `C`, so the test
  that reads a hover readout back off the canvas was looking for `R = 250` in a
  class that no longer declared `R`. Both parameters are now declared, and the
  assertion holds.

  The full suite passes: **562 tests, including the browser-driven `ui-render`,
  `wires` and `domains`**. No behaviour changed, which is why this release's
  `main.js` is byte-for-byte the same as the previous one — only `manifest.json`
  carries the new version.

## [0.2.0-beta.7] — 2026-09-24

### Fixed

- **A long status line squeezed the block's controls.** The samples/varying note
  shares a row with the buttons and the `t_end` field, and `from the previous run,
  press Simulate` took enough of it to crush the field's label until it wrapped
  one letter per line. The status is now short (`· previous run`), the explanation
  moved into its tooltip, the warning carries a colour, and the row is laid out so
  the controls cannot be squeezed at all — the status gives way and truncates,
  which is what `min-width: 0` on a flex item is for, and past that the row wraps.
  Reported with a screenshot: "the messages break the embed (too-long sentences)".

- **A `%C` was painted into every `HeatCapacitor`.** An icon's `textString="%C"`
  means the value of the parameter, and the renderer substitutes the bare form —
  but only if the editor is given a resolver to ask, and a block's editor was not
  given one. The same symbol read `2500` in the Studio and `%C` in a note. A block
  now resolves parameters the way the Studio does, and the composition is covered
  by a test that runs without a browser.

- **Copying and pasting inside a block's diagram did nothing.** The clipboard
  callbacks were passed to the Studio's editor and not to a block's, so the
  shortcuts were wired to nothing there.

### Note

Verification of the browser-driven suites was not possible while this was written:
the machine's Wayland session stopped accepting new Electron clients part-way
through the session, so a fresh `electron43` never reaches `whenReady` and every
`runInDom` page reports "tests did not finish". The 33 suites that do not need a
browser pass (522 tests); the three that do — `ui-render`, `wires`, `domains` —
have to be run on a machine where Electron starts. The tests for these fixes are
in place and were falsified against the previous build.

## [0.2.0-beta.6] — 2026-09-23

### Fixed

- **Moving a component in a block ran a simulation, four times over.** An edit
  made in a block's own diagram is written back into the note, and a note that
  re-renders rebuilds the block from scratch — and every rebuild simulated itself
  again. Measured in the vault: one drag mounted the block four times and ran four
  simulations, which is the flicker while dragging. A block now runs itself once,
  when the note is opened; after that **Simulate** is the only thing that starts a
  run.

- **A rebuilt block repaints the result it already had**, so "never run twice"
  does not mean the plot empties on every edit. Each model's last result is kept,
  together with the source it came from — and when the model has changed since
  that run, the status line says `from the previous run, press Simulate` rather
  than letting a stale curve pass itself off as current.

- **`height=` did nothing in the plot view.** The directive's height was applied
  to the diagram's canvas and ignored by the plot, which sized itself to 42% of
  the pane's width instead — and the plot is the pane that shows by default, so
  the directive looked inert. Both panes now use it, which is what "height" means
  for a box that shows one at a time.

- **The status line stuck on "Simulating…"** after a run finished, because the
  samples/varying report had been moved into the shared helper that a rebuilt
  block uses and was no longer called on the fresh-run path.

### Added

- **A `t_end` field on an embedded block**, the same control the Studio keeps in
  its results row. A block's span was reachable only by editing the directive
  text. The field shows the span the block actually runs — its own directive if it
  has one, otherwise the model's — and typing a new one re-runs the block over it
  and writes it into the directive, so it survives a reload the way a moved
  component does. A value that is not a span is refused and the field goes back to
  what the block is running.

## [0.2.0-beta.5] — 2026-09-22

### Added

- **Embedded diagrams show a component's parameters on hover.** This is the
  Studio's readout, on the surface most people actually read a diagram from. The
  setting already existed and said it applied to hovering a component, but the
  editor was only ever handed it by the Studio: a block fell back to the editor's
  own default of no readout at all, so the setting was invisible in every note.
  The label size was ignored in notes for the same reason. Both now reach the
  embed, and changing either repaints the blocks already on screen rather than
  waiting for something else to redraw them.

- **Embedded plots read the values off a crosshair.** Moving the pointer across a
  block's plot now shows the time under it and each visible trace's value at that
  moment, the same readout the Studio's plots have had. The margin beside the axes
  reports nothing rather than extrapolating, and the readout clears when the
  pointer leaves.

### Fixed

- **A Studio plot's crosshair did not agree with its own axis.** The pointer was
  mapped to a time with a second, hand-kept copy of the plot's margins — left 62
  against the renderer's 56, a different legend allowance, different top and
  bottom — so the value under the crosshair belonged to a slightly different pixel
  than the one being pointed at, and by more the narrower the pane. Both surfaces
  now invert the mapping the renderer actually drew with, from one shared
  function, and the readout lists as many traces as its box has room for instead
  of a fixed six.

## [0.2.0-beta.4] — 2026-09-21

### Fixed

- **Every symbol was drawn upside down.** A Modelica diagram's `+y` points up and
  a canvas's `+y` points down, and nothing flipped between the two: the picture
  was a vertical mirror of the model. It is not subtle once seen — a Ground had
  its bars above its terminal, and a voltage source's arrow pointed the wrong way
  — and it was wrong for all 30 examples and every icon in the library.

  The flip now happens in exactly one place, `viewportTransform`, which every
  drawing already went through, so the symbols, the wires, the pins, the labels
  and the hit-testing all agree by construction. The model keeps Modelica
  coordinates throughout, so the source on disk, the serializer, an OMEdit
  round-trip and the AI context all still mean the same thing.

  One consequence is deliberate and visible: dragging a component **down** now
  writes a **smaller** `y` in the source, because that is what "down" is in a
  diagram. Before, the source and the picture disagreed about it.

- **The marquee was painted below the gesture that made it.** The selection band's
  rect was anchored at the smaller diagram `y`, which is the bottom edge once the
  viewport negates `y` — and a canvas rect grows downward from the corner it is
  given, so the band hung at twice the drag's distance below the pointer.

- **A connector pin could be drawn in the middle of its own symbol.** A
  placement's `origin` was being dropped. MLS §18.6.2 applies the transformation
  in the order `extent`, `rotation`, `origin`: the icon is mapped onto the extent
  rectangle, rotated about `{0,0}`, and then shifted by `origin`, so the pin's
  position is the extent's centre **plus** the origin. Every one of the 393 MSL pin
  placements that gives an origin writes a symmetric extent, so every one of them
  collapsed to the icon's centre; 284 landed strictly inside the artwork they
  belong on the edge of. `Ground`'s pin resolved to the icon origin instead of the
  top of its stem, and wires met it there. OpenModelica's own
  `getComponentAnnotations` was used to check the reading.

- **The resize handles were named for a y-down reading**, so `nw` and `se` pointed
  at the wrong diagonals and dragging a corner resized the opposite edge. Cursors
  and the resize itself now follow the corner that is actually drawn.

- **A block's pane kept switching back on its own.** An embedded diagram is
  rebuilt every time its note re-renders — a keystroke, a metadata change, a theme
  switch — and each rebuild constructed a fresh block whose directive default is
  "plot open", so a switch to the diagram lasted only until the next re-render.
  And because a block simulates on open, a result arriving seconds later re-opened
  the plot over a user who had just closed it. A pane the user chose is now
  remembered by model name, and a finished simulation reveals its result only when
  nobody has said otherwise.

### Added

- **`test/orientation.test.mjs`** pins which way is up against the library's own
  source rather than against the code: the coordinates are read out of `Ground.mo`
  with a regex and never touch the parser, so the expectation cannot drift along
  with the bug. It asserts the terminal is the highest thing painted, the bars and
  the name label descend beneath it, and that every painted `y` is a negated
  source `y` and none is missing. Reverting the flip fails three of its five
  tests; dropping the `origin` again fails the fourth.

## [0.2.0-beta.3] — 2026-09-20

### Added

- **Hovering a component shows what its parameters are set to.** The values that
  differ from the class default come first, so what makes one component different
  from the next is visible without selecting each in turn. Every parameter is
  listed however many there are — the largest class in MSL has 49 — and a long
  list fills columns rather than being cut off at the canvas edge. The readout is
  placed clear of the symbol it describes: below it, above it, or beside it,
  rather than over it, because painted pixels are not a hit region and a panel
  lying on a component leaves the component clickable through it.
- **A label-size setting** (Settings → Diagram labels). A multiplier rather than a
  pixel size, because the label is already sized from the component's on-screen
  size; a fixed size would stop it shrinking with the zoom and start labels
  overlapping on a large model.
- **A source-versus-parsed icon sweep** over the whole library: every class's own
  `Icon(...)` is counted in the source it was written in and compared against what
  the parser produced. It reports 46 classes still short, and fails if that number
  grows.

### Fixed

- **145 classes were drawn as empty boxes.** The indexer skipped every directory
  named `Icons`, so a class that inherits its whole picture from one — every
  voltage and current source, the battery stacks, the rotational clutches, the
  flux-tube shapes — resolved to no graphics at all. `ConstantVoltage`, whose own
  annotation is a single text label, drew nothing. `Icons` is now indexed and kept
  out of the palette instead. The same over-broad rule was dropping whole
  `Examples` and `Utilities` packages that models reference.

- **No fill or line pattern rendered, anywhere.** Modelica writes these as
  qualified enumerations and the renderer switched on the bare member name, so
  every case fell through to the default and nothing failed loudly: hatched fills
  drew solid, dashed lines drew solid, Bézier curves drew as straight polylines,
  and `LinePattern.None` — defined as an invisible line — put an outline on 1018
  graphics that ask for none.

- **Icon labels were drawn at one pixel.** `fontSize` is absent from every in-box
  label in MSL, and absent was read as zero and clamped to the 1px floor, so a
  block whose icon is a rectangle plus the word "and" rendered as an empty box.
  The size now comes from the extent — in both dimensions, since a label wider
  than its box (`receive`, at 254 units in a 200-unit box) is as wrong as one too
  small.

- **Two classes of annotation were mis-parsed, and both discarded the rest of the
  file.** `annotation (Dialog)` made the parser ask for the value of `)`, and the
  recovery scan then ran to the next `)` in the file — `Blocks/Math.mo` yielded 7
  nested classes instead of 59, losing `Math.Feedback` and `Math.Add`. And
  `visible=(use_pder and use_pder2)` was read as a modifier list, producing an
  object that is neither `true` nor a string, which hid the graphic for good.

- **An `if` expression spanning a line break swallowed the annotation that
  followed it**, and so did an `else if` inside a `when` block, and an `if`
  reached mid-statement in an `algorithm` section. Each started a hunt for an
  `end if` that does not exist; `LogFrequencySweep` parsed 0 of its 12 graphics.

- **The library index held three releases of Modelica at once.** OpenModelica
  keeps every installed version side by side and the indexer read the directory
  that contains them, so a class's definition depended on the order the
  filesystem handed the files over — and a 5,000-file cap then dropped 280 files,
  losing `ModelicaServices`, `ModelicaReference` and `ObsoleteModelica4`
  entirely. Only the newest release of each library is indexed now, the cap is a
  guard that reports rather than a limit that discards, and the first launch got
  twice as fast as a side effect.

- **The inspector showed nothing for any component**, after a visit to code mode.
  The code validator adopted a freshly parsed model into the plugin while the
  editor kept the previous one, and the inspector looked the selection up in the
  wrong object. The two are now kept identical, the inspector reads the model
  being drawn, and an edit made after a drift can no longer land in a copy that
  never reaches the file.

- **A conditional connector could be wired although it does not exist.**
  `Support support(...) if useSupport` is not an optional connector: with the
  parameter false the element is absent and a `connect` to it is a model
  OpenModelica rejects. It is now dimmed in the inspector with the parameter that
  enables it, and its pin is neither drawn nor grabbable.

- **Light fills glared on the dark theme.** The thermal components fill with
  `{192,192,192}` and `FixedTemperature` with `{159,159,223}` — values chosen for
  a white page, which on a dark canvas rendered as opaque pale slabs. They keep
  the library's hue at a lightness that suits the surface, blended by a fixed
  fraction so shapes that differ only in lightness keep their shading.

- **The Help window overstated the library by 143 classes**, reporting the whole
  index under the Modelica library's name.

### Changed

- The Help window's domain-colour legend is split in two: the codes the library
  itself specifies, with the package each comes from, and the groupings this
  plugin adds.

## [0.2.0-beta.2] — 2026-09-19

### Fixed

- **The domain colours did not appear on the palette's group headings**, which is
  the one place they were asked for. Obsidian's element helpers read a fixed set of
  keys from their options — `cls`, `text`, `attr`, `title`, `value`, `type`,
  `placeholder`, `href` — and ignore everything else, so a bare `"data-domain"` key
  was dropped and the selector matched nothing. The attribute goes under `attr`.
  The test that was supposed to cover this asserted that the value was spread at
  the call site, that the CSS parsed, and that both hex values cleared AA: all of
  which passed while every heading rendered in the ordinary colour. It now renders a
  heading in a real engine, loads the shipped stylesheet, and asks the browser what
  colour came out.

- **Stop did nothing until the request finished on its own.** The button set a
  flag that is only read BETWEEN attempts, and one attempt is one HTTP call that
  can legitimately run for the whole timeout. The client had accepted an
  `AbortSignal` all along; the view never passed one. Stop now aborts the call, so
  it takes effect in a fraction of a second — and a stopped run says it was
  stopped rather than reporting that the provider could not be reached.

### Changed

- **The domain colour code now follows the library's own.** MSL publishes a colour
  per physical domain in `Modelica.UsersGuide.Conventions.Icons` — electrical
  `{0,0,255}`, thermal `{191,0,0}`, fluid `{0,127,255}`, magnetic `{255,127,0}`,
  blocks `{0,0,127}`, mechanics `{95,95,95}`, StateGraph `{0,0,0}` — and the Help
  window now shows that table beside this plugin's colours, with a link to it. The
  previous palette was chosen by eye and disagreed with the library in three
  places, most visibly magnetic: the library says orange, and it was violet.

  The library's values are icon FILL colours, so each domain keeps the hue and
  takes a lightness that reads as text — `{85,170,255}` measures 1.9:1 on a pale
  background. Where the library's value already clears AA it is used UNCHANGED:
  electrical is exactly `rgb(0,0,255)`, thermal `rgb(191,0,0)`, blocks
  `rgb(0,0,127)`. Media joins the uncoloured bucket, as the library leaves it.

### Added

- **A domain colour code**, in the palette's package headings, the Examples menu's
  domain headings, and the generated notes. One definition in `styles.css` serves
  all three, so a domain is the same colour wherever it appears: electrical is
  blue, thermal red, fluid teal, magnetic violet, mechanical slate, and so on.

  The colours are TEXT colours and every pair is measured, not chosen by eye:
  `test/domains.test.mjs` computes the WCAG contrast ratio against both theme
  backgrounds and requires at least 4.5:1 on each. Obsidian's own `--color-*`
  variables were the obvious choice and could not be used — measured as text every
  one of them fails on the light background, `--color-yellow` at 1.88:1 and
  `--color-green` at 2.35:1, because they are meant for accents and icons rather
  than for words. The test also rejects a domain with no colour, a colour for a
  domain that does not exist, and two domains sharing one.

- **`ResistorSelfHeating`, the first multi-domain example.** A 10 V supply drives
  1 A through a 10 ohm resistor, and the 10 W of loss goes into the resistor's own
  body — 5 J/K of heat capacity with a 0.5 W/K path to ambient — instead of
  vanishing as it does in an electrical-only idealisation. The two domains meet at
  one line, `connect(resistor.heatPort, body.port)`, which is the whole point of
  the example: the electrical side is instantaneous and the thermal side
  integrates, so the current settles in microseconds while the temperature takes
  tens of seconds.

  Ten new checks, all against values derived from the physics rather than read off
  the simulation: the loss is `V^2/R`, the rise is `P/G = 20 K`, the time constant
  is `C/G = 10 s`, and the closed form is matched at one and two time constants.
  Two of them need no closed form at all — the instantaneous balance
  `P_in - Q_out = C dT/dt`, and `Q_out = G(T - T_amb)` — which is what would catch
  a port wired to the wrong side. The audit is now 97 checks.

### Removed

- **The BouncingBall example**, from the built-in catalogue, the example vault and
  its showcase note. The hybrid-impact ground it covered is still checked:
  `DampedBounce` reinitialises velocity on contact and is audited numerically.

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

- **The domain colours did not appear on the palette's group headings**, which is
  the one place they were asked for. Obsidian's element helpers read a fixed set of
  keys from their options — `cls`, `text`, `attr`, `title`, `value`, `type`,
  `placeholder`, `href` — and ignore everything else, so a bare `"data-domain"` key
  was dropped and the selector matched nothing. The attribute goes under `attr`.
  The test that was supposed to cover this asserted that the value was spread at
  the call site, that the CSS parsed, and that both hex values cleared AA: all of
  which passed while every heading rendered in the ordinary colour. It now renders a
  heading in a real engine, loads the shipped stylesheet, and asks the browser what
  colour came out.

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

### Changed

- **The domain colour code now follows the library's own.** MSL publishes a colour
  per physical domain in `Modelica.UsersGuide.Conventions.Icons` — electrical
  `{0,0,255}`, thermal `{191,0,0}`, fluid `{0,127,255}`, magnetic `{255,127,0}`,
  blocks `{0,0,127}`, mechanics `{95,95,95}`, StateGraph `{0,0,0}` — and the Help
  window now shows that table beside this plugin's colours, with a link to it. The
  previous palette was chosen by eye and disagreed with the library in three
  places, most visibly magnetic: the library says orange, and it was violet.

  The library's values are icon FILL colours, so each domain keeps the hue and
  takes a lightness that reads as text — `{85,170,255}` measures 1.9:1 on a pale
  background. Where the library's value already clears AA it is used UNCHANGED:
  electrical is exactly `rgb(0,0,255)`, thermal `rgb(191,0,0)`, blocks
  `rgb(0,0,127)`. Media joins the uncoloured bucket, as the library leaves it.

### Added

- **A domain colour code**, in the palette's package headings, the Examples menu's
  domain headings, and the generated notes. One definition in `styles.css` serves
  all three, so a domain is the same colour wherever it appears: electrical is
  blue, thermal red, fluid teal, magnetic violet, mechanical slate, and so on.

  The colours are TEXT colours and every pair is measured, not chosen by eye:
  `test/domains.test.mjs` computes the WCAG contrast ratio against both theme
  backgrounds and requires at least 4.5:1 on each. Obsidian's own `--color-*`
  variables were the obvious choice and could not be used — measured as text every
  one of them fails on the light background, `--color-yellow` at 1.88:1 and
  `--color-green` at 2.35:1, because they are meant for accents and icons rather
  than for words. The test also rejects a domain with no colour, a colour for a
  domain that does not exist, and two domains sharing one.

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

- **The domain colours did not appear on the palette's group headings**, which is
  the one place they were asked for. Obsidian's element helpers read a fixed set of
  keys from their options — `cls`, `text`, `attr`, `title`, `value`, `type`,
  `placeholder`, `href` — and ignore everything else, so a bare `"data-domain"` key
  was dropped and the selector matched nothing. The attribute goes under `attr`.
  The test that was supposed to cover this asserted that the value was spread at
  the call site, that the CSS parsed, and that both hex values cleared AA: all of
  which passed while every heading rendered in the ordinary colour. It now renders a
  heading in a real engine, loads the shipped stylesheet, and asks the browser what
  colour came out.

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
