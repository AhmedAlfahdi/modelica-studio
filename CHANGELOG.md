# Changelog

Notable changes to Modelica Studio. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html). While the major
version is 0, a minor bump may include changes that are not backward compatible.

## [0.3.18] — 2026-10-15

### Fixed

- **A diagram edit no longer deletes what the diagram cannot express.** Saving after any
  drag rebuilt the class from the parsed diagram, and that projection has no field for a
  nested `package Medium = ...`, an `extends`, an `import`, an `algorithm` section, a
  `protected` marker, a model annotation, a description string or a comment. The plugin's
  own history folder holds the result: a 4227-byte `TwoOutletTank` became 1888 bytes with
  no declaration of `Medium` at all, and every later run of that file failed with
  `Base class Medium not found in scope TwoOutletTank`.

  A diagram edit now writes its changes into the file's own text, touching only the
  declarations the diagram owns (components, variables, connect statements and the model's
  Diagram annotation), and verifies the result by re-parsing it before returning it. A
  declaration that did not change is never re-emitted, so a drag keeps its comment, its
  formatting and its description string.

- **Simulate and Sweep compile what Save and Check compile.** They used the same lossy
  rebuild, so Check could report that a model compiled while Simulate failed on a
  declaration the rebuild had dropped.

- **Revert, and "Reload from disk", no longer write the studio's copy over the file on
  the way in.** Both exist to put the file back; the flush they performed first destroyed
  the newer external write they were meant to protect.

- **A restart keeps a model that was never saved.** The layout-ready handler re-parsed the
  snapshot's source over the restored diagram — for an un-saved model, the bare
  `model X end X;` skeleton it was built over — which emptied it. `modelOutdated` is now
  persisted, so a diagram that is newer than its source survives, and the next save writes
  its edits into that text.

- **Replacing the model saves the one being replaced.** The Examples picker, a note
  block's "Open diagram" and restoring a revision replaced the model with no flush and no
  prompt, while opening a file flushed and New asked.

- **A finished run is not adopted by a model that replaced the one that ran.** A compile
  takes seconds; the result, its log line and its chart are now dropped when the model
  changed in the meantime.

- **Twenty-four more defects from the same audit**, each with a test that fails without
  the fix. The ones a user meets:

  - **A sweep no longer leaks into the next model.** A `FamilyRun` holds another model's
    result and every run was drawn unconditionally, so opening B after sweeping A showed
    A's curves inside B's plot, in one shared colour. A model change now clears the
    family — and a sweep is recorded in the Run log, with its failure output, like any
    other run.
  - **Two runs of one model no longer share a work directory and a result file.** A note
    block and the studio running the same model at once compiled into one directory and
    ran with one `-r=`, so each read whichever CSV finished last. Runs of one model are
    serialised, and each writes its own file (removed after it is read).
  - **Reset no longer deletes a legacy plaintext API key** — the only copy there is when
    Obsidian has no keychain — and a first session can no longer edit the defaults
    through the settings object it was handed.
  - **The toolchain and library rows apply what they save**: the OpenModelica path
    re-probes, a library path rebuilds the index, and jobs or extra options recreate the
    backend, instead of waiting for a restart.
  - **An excluded library leaves the palette tree**, not only search.
  - **The Examples menu closes through one path**, so it cannot leave a keydown handler
    on `document` that turns a later Enter into "load a different example".
  - **`start >= stop` says the window is empty** instead of drawing a blank canvas and
    reporting success, and a zero-length result still draws a finite axis.
  - **The cursor readout matches the drawn axis** after a zoom; **"Clear traces" and the
    zoom reset reach the note's copy** of the chart; **two figures in one minute get
    distinct names**.
  - **The toolbar's tooltips appear again** (`--no-tooltip` inherits, so silencing a
    group silenced its buttons); **the mode buttons are marked active on open**; the
    palette's arrow keys follow the order the rows are drawn in.
  - **Stop aborts the first AI request**, not only the second; the DeepSeek thinking
    switch is no longer sent to other providers; the model list has a deadline.
  - **A check and a run share the busy pane** without clearing each other's indicator.
  - The embed picker scrolls its highlight into view, keeps a typed run span, writes a
    height the block honours, and activates a row from the keyboard. "Stop time" in
    Settings is split into the model's span and the default for new models, the second of
    which could not be set from anywhere.

### Added

- `docs/audit-2026-09-24.md`: the full audit behind these fixes — 28 findings with the
  evidence for each, produced with four parallel audits of the largest untested modules.

## [0.3.17] — 2026-10-14

### Changed

- **Four examples are laid out the way their author arranged them**, in the plugin itself
  so every reader sees the same diagrams: `DCMotor`, `BuckConverter`, `BatteryDischarge`
  and `HeatExchanger`. The changes are moves and rotations only — no component was added,
  removed, renamed or reparameterised — so the notes' verified numbers still describe them.

  The path from an arrangement to a release was the problem, not the arrangements:

  - the porter matched a component by the first mention of its NAME, and `HeatExchanger`'s
    class comment — *"A heated mass losing heat to ambient"* — contains "mass". Three
    placements were written onto the wrong components. It now anchors on the declaration.
  - the porter's verification re-read the file it had just written and compared the result
    with itself, so it passed whatever it had done. It compares against the source the
    arrangement came from now.
  - and the rebuilt bundle was never deployed, so the arrangements existed in the source and
    nowhere the app could see them. Proven by grep before rebuilding: one occurrence in
    `src/modelica/examples.ts`, zero in the running `main.js`.

- **The header could disagree with the canvas.** Loading an example writes a status line and
  nothing else, so the tab could read `DCMotor`, the header `Modelica/HeatExchanger.mo` and
  the canvas an RLC circuit. The header is refreshed by the status line itself now, which
  every action already writes.

- Two layout rules gained a bounded, named exception rather than a wider threshold:
  `HeatExchanger`'s `ramp` may reach x = −120 (it sits at −110), and nothing else may. A
  wider box would have stopped catching the next part that drifts.

## [0.3.16] — 2026-10-14

### Fixed

- **The header's file name did not update.** Reported: "the file's name didn't update".
  It was drawn once when the view opened and never again — the refresh was wired to a
  method that nothing called. It is now refreshed from the three places that change it:
  an edit (which changes the state), loading another model (name, file and state all
  change), and a save (which gives the model a path it may not have had). The tab is
  refreshed with them, through `getDisplayText` and Obsidian's own header update.

  Caught by a test that MOUNTS the studio: it opens the view, loads a second model, and
  reads the header back. Removing the hook fails it with the first model's name — the
  reported bug, reproduced.

- **An infinite recursion in the editor's fit**, reachable whenever the canvas is
  measured while degenerate: `zoomToFit -> resize -> resolveFit -> zoomToFit`, until the
  stack overflowed. Found by mounting the view in the test harness, which is the only way
  it was reachable — `Maximum call stack size exceeded`. A fit can no longer re-enter
  itself; removing the guard makes the mount test fail with exactly that message.

- **A caret restore that threw on a detached node** — `addRange(): The given range isn't
  in document` — on every re-render of a large model, because `innerHTML` rewrites replace
  the nodes a saved range points at. Both caret paths now check the editor is still in the
  document.

### Changed (test infrastructure)

- The DOM harness records which page tests had **not settled** when the page said it was
  finished. Making it await them is the correct semantics and it surfaced the two defects
  above, but it also changes timing that ten pages depend on, so it is a migration rather
  than a one-line change; until then the runner reports what it is trusting without
  evidence instead of staying quiet about it.
- `DOM_PREAMBLE` is parsed when the module loads, so a stray backtick in a comment — which
  ends the template literal early and surfaces as "esbuild failed" in whichever test runs
  next — fails immediately with a message that says so. It caught one within a minute of
  being written.

## [0.3.15] — 2026-10-14

### Added

- **The studio says which model is open, and which file it is in.** It said neither: the
  tab read "Modelica Studio" and the toolbar is all buttons, so with several models open
  there was nothing on screen naming the one being edited — nor whether the edits had
  reached the file. A line above the toolbar now shows the model's name, its vault-relative
  path, and the save state as a chip: quiet when saved, amber when modified, red when the
  file is not there or has moved on. The tab (and anything else Obsidian labels) shows the
  model's name too.

### Changed

- **"unsaved changes" is now "modified".** Reported twice. The old wording described the
  FILE when the state is about the MODEL, and it read as a warning that work was about to
  be lost rather than as "there are edits the file does not have yet". The four states now
  read: `saved` · `modified` · `file changed on disk` · `not saved to a file`, and they are
  defined once (`SAVE_STATE_WORDS`) so the status line and the header cannot disagree.

  The status line also re-reads the state each time it draws, instead of keeping whatever
  label was current when the last message arrived.

## [0.3.14] — 2026-10-14

### Changed

- **The worked-example notes are grouped into a folder per domain and numbered in the
  order the studio's Examples picker lists them.** Asked for by a reader working through
  them: the picker groups by domain *before* it lists, so the numbers follow that order
  and not the flat array's — numbering the array put `16`, `17` and `27` inside
  `01-Electrical`, which reads as nonsense beside the list it is meant to match.

  ```
  showcase/notes/
    00-modelica-intro.md            01-Electrical/01-electrical.md … 08-half-wave-rectifier.md
    01-learning-with-a-simulator.md 02-Mechanical/09-mass-spring.md  … 15-gear-train.md
    README.md                       03-Fluid/16-fluid-pipe.md        … 21-pipe-friction.md
                                    04-Thermal/22-thermal.md         … 24-heat-exchanger.md
                                    05-State-machine/25-state-machine.md
                                    06-Mechanics/26-double-pendulum.md
                                    07-Aerospace/27-airfoil-lift.md  · 28-phugoid.md
                                    08-Control/29-control-loop.md
                                    09-Multiphysics/30-resistor-self-heating.md
  ```

  Numbers run **across** the folders rather than restarting, so a folder listing and the
  picker read in the same order, and a note's number says where it sits in the whole set.
  Folder names carry no spaces, because a Markdown link destination with one is not a link
  unless it is wrapped or percent-encoded — the index had `05-State machine/25-….md`.

  Two labels disagreed with the picker and were corrected: `StateMachine` said *Discrete*
  where the picker groups it under *State machine*, and `DoublePendulum` said *Mechanical*
  where the picker says *Mechanics*. The index grouped by the note's own label, so it
  listed the double pendulum inside the Mechanical row.

  The layout now has **one definition** — `showcase/placement.mjs`, a pure function of the
  examples — used by the generator that writes the notes and by the four tests that read
  them. A layout computed in two places is a layout that disagrees with itself, and the
  tests would have been reduced to guessing paths. A new test holds the arrangement to the
  picker: numbers `01..30` in its order with no gaps, one folder per domain in the order it
  meets them, every note inside its own domain's folder, and the index rows in that order.
  Falsified by numbering the flat array instead: *"the numbers run 01..30 in the picker's
  order"* fails.

## [0.3.13] — 2026-10-14

### Added

- **All 30 examples are now verified.** `Rectifier`, `FluidPipe`, `Thermal` and
  `StateMachine` had no coverage in the numerical audit, and their notes carried three
  numbers that were simply wrong. Eighteen new checks, each derived independently of the
  simulation:

  | example | checked against | expected | simulated |
  |---|---|---|---|
  | `Thermal` | `C dT/dt = −G(T − T_amb)`, so `T(t) = T_amb + 56.85 e^{−t/τ}`, `τ = C/G = 500 s` | 314.064 K at t = τ | 314.064 K |
  | | at four time constants | 294.191 K | 294.191 K |
  | | heat flow at t = 0, `G(T₀ − T_amb)` | 113.700 W | 113.700 W |
  | `Rectifier` | the capacitor peak is the source peak minus the Shockley drop, `V_t ln(v/(R I_s) + 1)` | 9.54136 V | 9.54057 V |
  | | discharge between peaks over 10 ms, `e^{−Δt/RC}` with `RC = 10 ms` | 0.367879 | 0.367868 |
  | | the ripple repeats at the source's period | 20 ms | 20 ms |
  | `FluidPipe` | Darcy-Weisbach with Colebrook's `f` plus `ρgh` over the 0.5 m rise | 6501.4 Pa | 6499.6 Pa |
  | | the same at half flow | 5340.6 Pa | 5338.9 Pa |
  | | mass in equals mass out, and the ramp is the flow | exact | exact |
  | `StateMachine` | three timers in a ring; transitions are events, so they land on the timer | 1 / 3 / 4 s | exact |

  The audit now runs **115 checks over all 30 examples**.

### Fixed

- **Three wrong numbers in the four notes**, found while deriving the checks: the
  Rectifier's discharge time constant said 0.1 s (`R·C` is 10 ms), the Thermal note gave
  300.93 K at t = 1000 s (the closed form is 300.843 K), and the FluidPipe note predicted
  a pressure drop of ≈810 Pa where the model's is 6500 Pa — it had left out the 0.5 m of
  elevation, which is three quarters of the total.

- The README said "a numerical audit of every example" while four had none. It now says
  it because it is true, and the test that holds the claim to the audit accepts either
  form — a count, or "every" — failing if a single example loses its coverage.

## [0.3.12] — 2026-10-14

### Fixed

- **`Ctrl`/`Cmd`+`S` did not work in the studio.** Reported after 0.3.10 shipped it.
  0.3.10 bound it with a capture-phase DOM listener on the view's root, which sounds
  right and is not: Obsidian's own `editor:save-file` command claims Mod+S at the
  **application** level and consumes the keystroke before any handler in the page sees
  it. The listener never fired; pressing the key did nothing at all.

  It is now registered in the **view's scope** (`Scope.register(["Mod"], "s", …)`), which
  is the API for exactly this — a scope's bindings take precedence while its view is in
  focus, and the handler returns `false` so the core command does not also run. Obsidian's
  own editor owns the same key the same way. The DOM listener stays as the fallback for a
  host where the page does see the key.

  The wiring is now a free function, `wireSaveShortcut(view, root, save)`, because a view
  needs a whole application to exist and the wiring is the part that was wrong: it is
  tested by handing it a scope and an element.

### Added (test infrastructure)

- **The test stub has a faithful `Scope`, and the DOM harness awaits asynchronous tests.**
  Both gaps are why this bug shipped:

  - The stub had no `Scope`, so a view's keymap binding was invisible to the suite.
    `Scope` now records its bindings and can `trigger` them the way the application does,
    with `Mod` satisfied by either Ctrl or Meta.
  - `window.test` was synchronous: an `async` test callback resolved to a Promise and was
    recorded as **passing**, with the detail `[object Promise]` — an assertion that ran
    after being scored. It now awaits each test, and the runner polls for `finish()`.

## [0.3.11] — 2026-10-14

### Fixed

- **Save could silently overwrite a file that had changed on disk.** The studio holds its
  own copy of a model from the moment it loads it, so a repair made outside Obsidian — by
  another editor, by a script, by anyone — was invisible to it, and Save wrote the older
  copy straight back over it without a word. Found the hard way: a repaired model was
  overwritten **three seconds** before the simulation that failed on the old text.

  The status line did say "unsaved changes", and that is the trap: it reads as *"you have
  edits you have not written"* rather than *"the file is not what you think it is"* — two
  states that need opposite answers. They are now told apart:

  | | |
  |---|---|
  | the file matches the studio | `saved` |
  | the studio has edits, the file is as we left it | `unsaved changes` |
  | **the file itself changed since we read it** | **`file changed on disk`** |

  The plugin records what it last read or wrote for each path, on load and after every
  save, so its own edits and somebody else's write are not confused. Save then **asks**,
  with three answers rather than two: reloading and overwriting are each destructive in
  one direction, so a yes/no dialog would have to make one of them the default — and the
  default is what a stray Enter gets. The safe answer, **Reload from disk**, takes the
  focus. Both save paths go through it: the toolbar button and `Ctrl`/`Cmd`+`S`.

## [0.3.10] — 2026-10-14

### Added

- **`Ctrl`/`Cmd`+`S` saves the model.** It saved nothing before: the keystroke reached
  Obsidian, which saved the active **note** — so a reader who had just arranged a diagram
  and pressed the reflex got a silent write to the wrong thing while the model stayed
  unsaved, and the only way to save was the toolbar button or a command-palette search.
  Reported while working through a vault of twenty-one models.

  Bound in the **capture** phase on the view's root, because the code pane is a
  CodeMirror instance whose handlers would otherwise see the key first, and listed in the
  Help window in both diagram and code mode — a shortcut nobody can find is not one. The
  decision is a plain exported function, `isSaveShortcut`, so it is tested without
  building a view: Ctrl+S and Cmd+S save, a bare `s` is a key rather than a command, and
  Ctrl+Alt+S is somebody else's shortcut on Windows.

### Fixed

- **A page error in a DOM test now says which file and line it came from.** One test in
  this suite — "a reshape is one undoable step" — fails about once in ten full runs under
  parallel load, with an error message nobody can place; it did not reproduce in eleven
  further runs while being chased, so the next occurrence will at least say where to look.
  The harness collects the console message's source and line alongside its text.

### Added (scripts)

- **`scripts/check-models.mjs`** compiles every `.mo` in a folder, one file per `omc`
  process — loading them together lets two models that share a class name shadow each
  other and the error lands on the wrong file — and prints the error line for each
  failure, because fixing one error in a file usually reveals the next. Written while
  working through a vault of twenty-one models, of which two did not compile: one
  referenced six parameters it never declared, and one assigned to a sub-component's
  variable, which Modelica does not allow.

## [0.3.9] — 2026-10-14

### Fixed

- **Thirty worked-example notes had LaTeX that Obsidian rendered as literal text.**
  `\frac{\rho v^2}{2}` had shipped as `rac{<newline>ho v^2}{2}`, `\sqrt` as `sqrt`,
  `\qquad` as `qquad` — and in `TankOrifice`, where the damage was worst, the draining
  law read `A_{tank}rac{dh}{dt} = -rac{dot m}{ho}`.

  The cause was in the SOURCE, not the output: `showcase/math.mjs` writes the
  mathematics as JavaScript strings, and `"m\ddot{s} + d\dot{s} + cs = 0"` has its
  backslashes eaten by the language before it is ever a string — `\d` is a `d`, `\f` is
  a form feed, `\r` a carriage return. A hundred and twelve backslashes were escaped for
  the wrong language. The notes are all regenerated from `showcase/generate.mjs`, so the
  fix is in one file rather than thirty.

  Three tests now stand where none did: the notes' mathematics must not contain a
  control character, a macro without its backslash, or a macro glued to the letter
  before it; **`math.mjs` itself** is checked the same way, because an output-only check
  would not have caught this until a regeneration; and the two copies of the notes
  (`showcase/notes/` and `examples/vault/showcase/`) must be identical, since they had
  drifted into one repaired tree and one broken one.

### Changed

- **`MassSpringDamper` opens on the quantities the model is about.** Its default traces
  were `mass1.s` and `mass1.v` — real variables, and between them they said nothing about
  a model whose subject is the *gap* between two free masses. They are now `mass1.s` (the
  drift) and `coupling.s_rel` (the gap, which settles at `F·m₂/(c(m₁+m₂)) = 1/75 m`
  rather than at `F/c`). The README's plot shows the same pair, so the picture, the note
  and the plugin agree.

- **The example diagrams are held to four layout rules**, checked over all thirty:
  no two symbols overlap; every connection runs along one axis rather than diagonally;
  no part is stranded more than 60 units from what it connects to; and nothing is drawn
  outside the ±100 box a Modelica diagram is drawn in. A fifth rule resolves each
  component's ports through the installed library and requires connected pins to share an
  x or a y, so a wire is a straight run. Only one symbol in thirty examples broke a rule —
  `GearTrain`'s frame reached x = 110 — and the chain moved ten units left.

- **The paragraph explaining what a live block does is written once**, in the
  introduction, instead of appearing verbatim at the top of all thirty notes. It is
  generated from `showcase/intro-body.md` now, so a note is about its model.

## [0.3.8] — 2026-10-14

### Fixed

- **The two embed screenshots showed the wrong panes.** Reported as "wrong pic here",
  against the pair that documents a block in a note: the image captioned *opened on its
  diagram* was the plot, and the one captioned *switched to its plot* was the diagram.

  Not a swap of the files — a real behaviour of the block that the scene had not
  accounted for. A block **simulates when the note opens and reveals the plot when the
  run finishes**, so a scene that let it auto-simulate could not photograph the diagram
  without clicking back; and which pane is open is not only the block's own setting,
  because the reader's last choice is remembered per model so that a note does not
  reopen the plot on every re-render.

  Both scenes now settle on the pane they document, and settle on it rather than click
  once: the reveal arrives on its own schedule *after* the run, so a single click can be
  undone a moment later. The tooltip is what decides it — the label says what a click
  will DO, so the pane that is showing is the one whose label offers the other, and the
  first version of this loop had that exactly backwards and produced two diagrams.

  The captions are unchanged and now describe what is in the pictures: the diagram pane
  with a finished run's statistics in the toolbar, and the plot a note opens on with
  `//@ result`.

## [0.3.7] — 2026-10-14

### Added

- **Screenshots of the embedded block, in both of its modes**, and of two features that
  needed more than a sentence:

  - `embed-light/dark` — a `modelica` block in a note, opened on its diagram, with its
    own toolbar: **Simulate**, the span, **Open diagram**, **Fit**, and the switch
    between panes.
  - `embedPlot-light/dark` — the same block on its plot, which is what `//@ result`
    opens on.
  - `hover-light/dark` — the parameter popup over a component: `c=50, d=1` on the
    coupling, the two values that instance sets, with the library's defaults for the
    rest.
  - `sweep-light/dark` — a real parameter sweep: three simulations of the coupling
    stiffness, the run on screen solid and the family dashed, with each member's
    distance from it read at the cursor.

  These are RENDERED, not photographed: `scripts/readme-images.mjs` mounts the real
  `EmbeddedDiagram`, dispatches a real `pointermove` over a component, and runs the
  sweep through the backend's parameter-override path — one simulation per value of the
  same compiled binary, which is what makes a sweep seconds rather than minutes.

### Fixed

- The image generator had accumulated three faults, each of which produced a wrong
  image rather than an error: the embed's plot pane was empty because a block with
  `autoSimulate: false` has no result to draw; the second embed inherited the first
  one's remembered pane choice; and `capturePage` ignores the rect it is given in this
  Electron version, returning the whole window — so the requested framing is now
  cropped out of the result by the ratio the image actually came back at. Two
  blank-image guards stay in place: a capture under 12 KB is reported, not written.

## [0.3.6] — 2026-10-14

### Changed

- **Every screenshot is now a light/dark pair, side by side.** The plugin is used in
  both themes and the difference is not cosmetic: on a dark canvas a wire that would
  vanish into the background is lifted until it clears 3:1 against it, and the Help
  window's domain colours are lifted the same way. One theme's picture could not show
  that. `scripts/readme-images.mjs` renders each scene twice — the editor and the plot
  read the theme from the page, so switching the body class is what switches the
  drawing — and the README shows the two in a table with a caption per column.

- **The in-note example is the same `MassSpringDamper` as the worked example**, at
  `//@ time=5`, replacing the RC divider. A reader now meets one model three times —
  as a diagram, as a plot, and as the block they would paste into a note — instead of
  a new circuit appearing in the middle of the page to demonstrate syntax. The block's
  text is byte-for-byte the file the studio opens from **Examples**, so the note and
  the studio cannot disagree.

## [0.3.5] — 2026-10-14

### Fixed

- **The Help screenshot shipped blank.** 0.3.4's `docs/images/help.png` was 4 KB of
  empty background: the panel was extracted from the Help modal inside the app page,
  where Obsidian's modal CSS and the tab strip keep an inactive panel unpainted even
  after its class and inline `display` are forced. It is now rendered in a page of
  its own, from the panel's markup, with the same stylesheets — and the generator
  **refuses to write an image under 12 KB**, because a blank capture is a failure
  rather than a screenshot. That guard is what caught this one.

  Two other generator faults were fixed on the way: a CSS `zoom` used to sharpen DOM
  captures (it moved the box out from under `capturePage`, capturing 980x848 of
  nothing), and the order of the scenes (loading the Help page navigates away from
  the app page, so the canvas scenes must run first).

- **The plot screenshot now shows both masses' positions** rather than the example's
  default position-and-velocity. The README's point about this model is that the pair
  drifts while the *gap* between them settles — which is only visible with `mass1.s`
  and `mass2.s` both on the plot. The caption says which traces are shown.

## [0.3.4] — 2026-10-14

### Changed

- **The README was rewritten around what the plugin does, with screenshots.** The
  old one opened with a paragraph and then buried its capabilities in a list; it now
  opens with a picture of a real model and a sentence, and each capability has the
  image that goes with it — the editor, a plotted result, the Help window — followed
  by a worked example, then the reference material.

  The in-block example is now `MassSpringDamper`, "two masses coupled by a spring and
  damper": a force step on one mass with nothing anchored, so the pair drifts while
  the spring-damper between them rings and settles. It replaces an RC divider that
  demonstrated the syntax and nothing else. The new one has a physical point worth
  stating — the gap settles at `F·m₂/(c(m₁+m₂))`, not at `F/c`, because both ends are
  free — and it is one of the plugin's own built-in examples, so a reader can open it
  and run it.

- **`scripts/readme-images.mjs` renders every screenshot from the plugin's own
  code**, at 2x, with a real simulation behind the plot:

  - `diagram.png` — the editor drawing `MassSpringDamper` with the library's own
    icons; the signal wire is Blocks blue and the mechanical wires translational
    green, because those come from MSL's annotations.
  - `plot.png` — the numbers OpenModelica returned for that model, drawn by the same
    plot renderer the studio and an embedded block use.
  - `help.png` — the Help window's connection rules and domain colour table.

  Nothing is mocked up in an image editor, so a screenshot cannot show a capability
  the plugin does not have. The simulation is real: `omc` compiles and runs the
  example, and the plot shows what came back — including the ripple in the first
  second that the coupling produces.

  A test checks the README's images in both directions: every image it references
  must exist, and every rendered image must be referenced somewhere. Falsified three
  ways — a missing file, an orphan image, and an image dropped from the text.

## [0.3.3] — 2026-10-14

### Fixed

- **The About panel's links looked like form controls.** Reported from a screenshot:
  boxed buttons — "the full text", "open", "how" — sitting inline with a line of
  monospace text, reading as fields to fill in rather than places to follow. They are
  now what they are:

  | row | was | now |
  |---|---|---|
  | Licence | `GPL-3.0-or-later` **[the full text]** | **GPL-3.0-or-later** — use it, change it, keep it free |
  | Source | `AhmedAlfahdi/modelica-studio` **[open]** | **AhmedAlfahdi/modelica-studio** |
  | Cite it | `Please cite it in published work` **[how]** | Please cite it in published work: **CITATION.cff** |

  The linked words are the value itself, accent-coloured, with a small external-link
  mark beside them; they underline on hover rather than permanently, and take the
  focus ring. Still a `<button>` under the styling, because a plain anchor navigates
  the Obsidian window away from the app — the reason the inspector's documentation
  link already redirects through `openInBrowser`.

- `setIcon` writes into the element it is given and removes its **first child**, which
  is the text node when the element already has a label. Writing the mark straight
  into the link erased all three labels and left three anonymous icons; the mark now
  has its own span. A UI test caught it in the same run that introduced it.

  The appearance is asserted where it can be: the harness that renders the panel for
  the styling test loads the plugin's real `styles.css` **and** the theme variables
  it reads, and the assertion reads the computed style — no border, no fill, no
  shadow, no padding, accent colour, pointer cursor, mark present, underline only on
  hover. The first version of that assertion lived in a page with no stylesheet at
  all, so it measured the browser's default button and passed; it is now falsified by
  restyling the link as a box.

## [0.3.2] — 2026-10-14

### Fixed

- **A component dropped from the palette landed at the mirrored height.** Reported
  as "it doesn't drop where my mouse is — there is a y offset", and the cause was a
  second copy of the client-to-diagram arithmetic: the studio computed
  `(py - vp.y) / vp.scale` where the canvas uses `(py - t.y) / t.yScale`, and
  `yScale` is NEGATIVE because Modelica's +y is up. A drop therefore landed off by
  **twice its distance from the viewport origin** — 100px on screen for a drop 100px
  above centre at 100% zoom, and upside down. The studio's copy also ignored the
  canvas's CSS-to-internal scale, a second source of offset when the pane is not the
  canvas's own size.

  The mapping is now public on the canvas (`toDiagram`, and `viewCentre` for callers
  with no pointer event), and **all three** studio copies are gone: the drop, the
  palette's Enter, and the palette's double-click. Those last two place at the centre
  of the view, where the error is nearly zero — which is why only the drag was ever
  reported, and why the same fault had been sitting in the other two unnoticed.

  `sceneTransform`'s own comment had named this failure mode before it happened: *"a
  sign that lived in two places is exactly how the drawing and the clicking came
  apart before."*

  The test measures the mapping as one thing — a known canvas box, a CSS box half its
  size, and a viewport — and requires a point above the origin to come out POSITIVE,
  then adds a component through the same call the studio makes and checks it lands on
  the pointer within one grid step. Reverting the y flip fails it. A contract test
  keeps a fourth copy from appearing: the studio must call `toDiagram`/`viewCentre`
  and must contain no `- vp.y) / vp.scale` arithmetic.

## [0.3.1] — 2026-10-14

### Changed

- **The About panel in the Help window now says who made this, what it may be used
  under, and how to cite it.** It showed the version and the word "beta" and nothing
  else — thin for the one place in the application where a reader can find out their
  obligations without opening the repository.

  It now states the author (read from `manifest.json`, so the store listing, the
  panel and the copyright notice cannot disagree), the licence with a link to its
  full text, the source repository, and how to cite — followed by one paragraph on
  what the licence gives and asks: use it for anything, a version you distribute
  stays free and keeps the notices, and citing is a favour rather than a condition.

  The wording is "pre-1.0, and experimental" rather than "beta", which stopped being
  true at 0.3.0 — the first release not tagged beta — and the README had already
  been changed to say the same.

  `PLUGIN_LICENSE` is stated once in the Help module and held equal to
  `package.json` by a test, because the panel is where a reader reads their terms and
  a panel that describes terms the release does not carry is worse than a blank one.
  The panel's three claims are each falsified: claiming MIT, typing an author into
  the panel instead of reading the manifest, and writing "you must cite".

## [0.3.0] — 2026-10-14

The first release that is not tagged beta. **The code is beta.58's** — no drawing,
parsing or simulation behaviour changed — so this entry is what 0.3.0 contains
rather than what it fixes; the per-change detail is in the beta entries below.

### What it is

- **A visual Modelica editor for Obsidian**: drag components from the palette, wire
  them, set parameters in the inspector, and simulate with the OpenModelica already
  installed on the machine. Results plot beside the diagram, in the note or in the
  studio.
- **Drawn the way the library says.** Symbol outlines, wires, port colours and line
  weights all come from the annotations MSL itself declares — including
  `DynamicSelect`, so an animated icon (a tank's level) draws its editing state
  rather than the source of its annotation.
- **Settings for the things a reader adjusts**: label size, wire and component line
  thickness (with a link that keeps the library's ratio), parameter-popup and
  readout sizes, cursor snapping, and a reset that keeps the record of your work.
- **Help in the application**, with a colour legend, the connection rules quoted
  from the library, and the keyboard shortcuts read from the code that implements
  them.

### Licence

**GPL-3.0-or-later**, copyright (C) 2026 Ahmed N. Alfahdi. It was MIT; that permits
a fork to take the plugin closed, which is the one thing the licence is meant to
prevent. Everything from this version on must stay open and stay attributed, and
modified versions must say they are modified.

Citation is *asked for* rather than required — see `CITATION.cff` and the README's
Citing section. A citation requirement cannot be part of an open-source licence:
the [GNU FAQ](https://www.gnu.org/licenses/gpl-faq.html#RequireCitation) says it goes
beyond section 7(b), and Debian [patched exactly such a notice out of GNU
`parallel`](https://bugs.debian.org/905674).

Releases up to `0.2.0-beta.57` were MIT and stay MIT: a licence grant cannot be
withdrawn from a copy already distributed.

## [0.2.0-beta.58] — 2026-10-14

### Changed

- **Licensed under the GNU General Public License, version 3 or later.** It was
  MIT, which permits a fork to take the plugin closed — the one thing the licence
  was asked to prevent. GPL-3.0-or-later keeps it open and keeps it attributed:
  anyone who distributes this code or a modified version must pass on the same
  freedoms and keep the notices, and modified versions have to say they are
  modified, so a fork cannot present itself as the original work. Copyright
  (C) 2026 Ahmed N. Alfahdi, who is now named in `LICENSE`, `package.json` and
  `manifest.json` (the name the community store displays).

  **Why not a citation requirement as well:** it cannot be one. The
  [GNU FAQ](https://www.gnu.org/licenses/gpl-faq.html#RequireCitation) is explicit
  that requiring citation "in research papers which use the GPL-covered software"
  is not permitted — it goes beyond what section 7(b) allows and is an additional
  restriction — and copyright law does not let a licence place conditions on the
  output of software. Debian [patched exactly such a notice out of GNU
  `parallel`](https://bugs.debian.org/905674) for the same reason. So citation is
  asked for as a favour, in [`CITATION.cff`](CITATION.cff) (which GitHub renders as
  "Cite this repository") and in a **Citing** section of the README, and the
  licence covers what is enforceable: staying open and staying attributed.

  **Compatibility was measured, not assumed.** `main.js` imports only Node builtins
  and `obsidian`, so no third-party code is bundled and nothing constrains the
  choice; the Modelica Standard Library is 3-Clause BSD and is parsed from the
  user's own copy rather than redistributed; OpenModelica is invoked as a separate
  program. All three are recorded in the README's third-party notices.

- `CITATION.cff`, with the version a test holds in step with `manifest.json` — a
  citation that names a version that no longer exists is worse than one that names
  none. The same test checks the licence identifiers agree across `LICENSE`,
  `package.json`, `manifest.json` and the citation file, that the `LICENSE` is the
  verbatim GPL-3 text applied as "or later" rather than "only", and that the README
  asks for citation rather than imposing it. Each check is falsified: naming a
  retired version, shipping GPL-3.0-only, and writing "you must cite" all fail it.

  Also added: an SPDX header in `src/main.ts`, and the repository/author fields npm
  and GitHub read.

## [0.2.0-beta.57] — 2026-10-14

### Added

- **The Help window lists a wire colour for every domain, not a sample of four.**
  Asked whether fluid components have that blue for their connectors — they do,
  `{0,127,255}` from `Modelica.Fluid.Interfaces.FluidPort_a` — and the table had left
  the whole Fluid library out, which is the domain a course on tanks and pipes meets
  every day. It now covers electrical, fluid, thermal, signal, translational,
  rotational (and magnetic, which names no colour of its own), plus the two
  double-width cases.

  The rows are DATA, with the connector class each is measured from, and a test
  resolves every row through the installed library and requires the colour and weight
  to match — a wrong colour fails with `1 of 8 Help rows disagree with the library`,
  and deleting a row (as fluid's absence was) fails with `every row was read: 7`.

  Measured, domain by domain: electrical `{0,0,255}`, fluid `{0,127,255}`, thermal
  `{191,0,0}` (FluidHeatFlow `{255,0,0}`), translational `{0,127,0}`, rotational and
  magnetic black-to-ink, MultiBody `{95,95,95}` at double width, buses
  `{255,204,51}` at double width, StateGraph ink at double width.

### Fixed

- **A connector declared as a SHORT class definition lost its icon**, so the colour
  and weight the library states for it were unreadable. `Modelica.Blocks.Interfaces.RealInput`
  is written

  ```
  connector RealInput = input Real "..." annotation (Icon(graphics={Polygon(
    lineColor={0,0,127}, fillColor={0,0,127}, fillPattern=Solid)}));
  ```

  and the parser skipped from `=` to the `;`, annotation and all. Every signal wire
  in a diagram therefore fell back to the theme's own colour instead of the library's:
  `{0,0,127}` for a Real and `{255,0,255}` for a Boolean, the colours that also say
  the TYPE — a wire between two types that do not match is a model that will not
  compile, which is exactly what those colours are for.

## [0.2.0-beta.56] — 2026-10-14

### Fixed

- **A graphic written positionally inside a layer could still be dropped without a
  trace.** `Icon(Rectangle(...))` — a primitive as an argument rather than inside
  `graphics={...}` — is legal Modelica and a second place `buildGraphic` can fail.
  The record added in beta.55 covered the two list forms and missed this one, so the
  sweep that reads it would have passed while the picture was missing a shape. Both
  the record and the `DynamicSelect` capture now cover it, and a test drives all
  three forms: a drop in the list, a drop in the other layer, and a drop in the
  positional form. Removing the record fails it with `got []`.

### Added

- **The plot's margins are a property, not a case.** Ten pane widths from 300px to
  1200px, with and without a second value axis: the legend's rows must start after
  the axis values end, no value or legend row may pass the edge of the canvas, and a
  legend must be drawn whenever 100px of strip was free for it. The two margin bugs
  shipped in a row were single cases found by eye; reverting either half of the fix
  now fails 7 and 9 of the 20 combinations.
- **The cache round-trips what the parser learned** — the field-level half of the
  guard for the beta.53 mistake, where a parser fix shipped without a version bump
  and every existing index kept the old parse (`DynamicSelect` extents, `dynamic`
  argument pairs, and the drop record all survive `JSON.parse(JSON.stringify(...))`).
- **`test/component-render.test.mjs`: real canvas, both pixel ratios.** The
  library-wide sweeps draw into a recorder, which is fast and blind to anything that
  happens in the rasteriser rather than in the calls. Twenty classes from every area
  of MSL are now drawn on a real canvas at dpr 1 and 2 and measured: every one leaves
  ink, none of it lands off the surface, and doubling the ratio doubles the drawing's
  size. Writing it proved it can see that ratio — a fixture that scaled by `dpr` as
  well as passing it reported **x3.99** across all twenty.

  The app's own startup log was checked too, and is clean.

## [0.2.0-beta.55] — 2026-10-14

### Added

- **Four library-wide sweeps that catch a component which "looks wrong"**, rather
  than waiting for someone to notice one. Each asserts an exact property over every
  class the palette offers and names the class and the numbers when it fails:

  | sweep | the fault it catches | falsified by |
  |---|---|---|
  | no class silently drops a graphic | the tank's `extent=DynamicSelect(...)` rectangle, and any attribute the parser cannot read | restoring the summariser: **19 of 15625 classes** |
  | no attribute is left as an unreadable expression | a label or shape whose value is `name(...)` — the annotation's own source | keeping the call as text: **11 attributes** |
  | every declared weight is drawn at its weight | the stroke divided by the transform scale — a 10px outline where 1px was due | restoring the division: **9027 weights** |
  | no icon disappears into the canvas, in either theme | a component nothing can be seen of, in light or dark | drawing every mark in the canvas colour: the control reads **1.00:1** against 3.36 |

  The parser now RECORDS what it could not interpret (`ParsedClass.unparsedGraphics`)
  instead of dropping a primitive in silence — a dropped graphic is invisible, and
  "the picture is missing something" is not a bug report anyone can act on.

- The sweeps' method is written at the top of `test/icon-render.test.mjs`, including
  the two rules learned from the faults found while writing them:

  1. **Assert an exact property or a named set, never a tolerated count.** The
     existing drop check allowed 46 under-parsed classes; the tank was one of them,
     which is why nothing went red when its picture lost a rectangle.
  2. **Calibrate the measurement on a case with an independently known answer.** The
     theme-visibility sweep read `theme.background` — a CSS string — as if it were a
     number, so every contrast came out `NaN`, `NaN < 3` was false, and the sweep
     passed for its whole life, including against a probe that drew every mark in
     the canvas colour. It now checks one known stroke against a contrast of 3.36:1
     computed by hand from the two colours.

  Two harness gaps were found by the same process and fixed: the recorder did not
  carry stroke widths or the colour of text, so a text-only icon (`Electrical.Digital.Basic.And`
  is an ampersand) looked invisible and a weight could not be judged at all.

## [0.2.0-beta.54] — 2026-10-14

### Fixed

- **The `DynamicSelect` fix in beta.53 reached nobody who had opened the plugin
  before**, which is why the tank still drew empty and still labelled itself
  `DynamicSelect(...)`. The library index is cached in `library-index.json` and the
  cache version had not been bumped, so the app read the PREVIOUS parser's output:
  `"DynamicSelect(...)"` where a graphic's extent belongs. The parser was right and
  the screen was wrong.

  `INDEX_CACHE_VERSION` is now 7, and the test that guards it says so. The first
  launch after this update re-parses the library — about a second longer than a
  cached start — and every launch after that is cached again.

  The lesson is in the code comment: the cache holds the PARSED classes, so any
  change to what the parser produces needs a bump, while a change to a value derived
  on the way out (`describe`, a pin's position from its placement's origin) does
  not. This one changed the parsed shape and should have come with the bump.

## [0.2.0-beta.53] — 2026-10-14

### Fixed

- **`DynamicSelect` is now read, so animated icons draw.** Asked whether the tank
  showed the right level, and it showed neither a level nor a tank:

  - `Modelica.Fluid.Vessels.OpenTank`'s **water rectangle is declared with**
    `extent=DynamicSelect(...)`. The parser summarises any function call in an
    annotation as `name(...)`, which is right for the calls that are only read as
    text — but here a numeric extent is required, so the graphic was **dropped**
    and the tank drew empty.
  - Its **level text** is `textString=DynamicSelect("%level_start", String(level,
    …))`, and the summary was drawn as the text, so the label read
    `DynamicSelect(...)` — the annotation's own source.

  MLS §18.6.4 defines the call: the **first** argument is the value for the
  **editing state** and must be a literal, the second is what a tool shows while a
  simulation runs. A diagram in an editor *is* the editing state, so the first
  argument is the value. The tank now draws its water band and reads
  **`level = 2.5`** — the user's own `level_start`.

  **Saving keeps the animation.** The parsed value is the editing argument, so a
  round trip would have written a constant where the `DynamicSelect` was — the
  user's source quietly simplified. Both arguments are captured as they were
  written and the serializer emits the call again, verbatim.

  106 annotations in MSL 4.1.0 are written this way — the tank's level, valve
  bodies, the DrumBoiler's fill, the AST batch-plant vessels — and all of them were
  affected in one of those two ways.

  The live value during a simulation (the second argument) is **not** shown: the
  plugin draws the editing state and does not animate icons. One library-wide
  ratchet moved by one as a result — the tank's label is now a `%level_start`
  macro where it used to be text containing no macro, and it is honestly unknown
  for the class alone, whose default is the expression `0.5*height` rather than a
  literal. An instance that sets it, as the example does, shows the number.

## [0.2.0-beta.52] — 2026-10-14

### Fixed

- **Rotating with R repaints immediately.** Reported as a rotation that "lags so
  much (more than a second)": the model turned at once and the PICTURE did not.
  Rotation was the one edit that neither moved the selection nor asked for a
  frame — and `setSelection` is what had been requesting one, so paste, delete,
  add, nudge and a parameter change all repainted *by accident*, through a
  selection change that happened to accompany them. Rotating changes no selection,
  so nothing repainted until the pointer moved over the canvas: the rotation
  appeared with the next hover, which is the second the report was measuring.

  The request is now in `commitEdit`, where every edit lands, rather than at each
  call site: a committed change that is not painted is a change the user cannot
  see, and that belongs to the edit machinery rather than to rotation. The guard
  in `requestDraw` already coalesces a burst into one frame, so the call sites that
  also ask for one cost nothing extra.

  The test asserts the general property over every edit entry point — rotate,
  nudge, re-select, set a parameter, rename, delete, undo, redo — and that five
  rotations in one frame coalesce to a single repaint. Removing the request fails
  it with four of the eight edits unrepainted.

## [0.2.0-beta.51] — 2026-10-14

### Fixed

- **The thickness link no longer rebuilds the tab, so nothing can move it.**
  beta.50 tried to put the scroll offset back after the rebuild; the jump
  remained, which means the offset was being reset somewhere that restoring it did
  not reach. The rebuild was the wrong tool: all three rows — the shared slider and
  the two separate ones — now exist, and the link switches which of them are
  **shown**. Hiding a row changes no scroll offset at all, so the jump is
  impossible rather than compensated for, and the toggle is instant.

  The test asserts the stronger property directly: toggling the link calls
  `empty()` on the tab **zero times**. Putting the rebuild back fails it with
  `rebuilds=1`, so this cannot creep back in.

  The scroll restoration added in beta.50 stays for the four settings that still
  have to rebuild the tab (the AI provider preset, the model list, the AI model
  choice and the key migration).

## [0.2.0-beta.50] — 2026-10-14

### Fixed

- **Toggling a setting that rebuilds the tab no longer throws you back to the
  top.** Reported for the thickness link, which by design rebuilds the rows below
  it: the pane scrolls inside Obsidian's own container, and rebuilding empties it,
  so the browser clamps the scroll offset to zero before the new rows go in — you
  land at the top of Settings and have to find your place again.

  The offset is now read before the rebuild and restored after it. The offset
  rather than an anchor element's position, because the rebuild destroys the
  element: a control above the rows that change does not move on the page, so the
  offset IS the reader's place there. The browser still clamps when the rebuilt
  tab is genuinely shorter, which is correct.

  Five rebuilds went through `this.display()` directly — the thickness link, the
  AI provider preset, the model list, the AI model choice, and the key migration —
  and all five now keep the place.

  The test reproduces the jump rather than assuming it: a browser only clamps the
  scroll when it LAYS OUT the emptied container (any read of a scroll property
  forces that, and Obsidian reads them), so the harness makes that layout happen
  and asserts the offset really did drop to zero. Removing the fix then fails with
  `after=0`, which is the reported symptom.

## [0.2.0-beta.49] — 2026-10-14

### Added

- **Show component names**, a switch at the top of Settings → Diagram: off, the
  diagram is the symbols alone, which is what a screenshot in a course note
  usually wants. On by default, because the names are how a diagram is read while
  it is being built.

  It hides the name **beside** a symbol and nothing else. The library's own text
  *inside* a symbol — a valve's state, a machine's rating — is part of the drawing
  rather than a label on it, and a component with no icon keeps the name inside
  its placeholder box, because that is the only thing identifying it. Both are
  asserted, not assumed: falsifying them in either direction fails the test.

  With the names off, **Label size** greys out and says why: a control that looks
  live but is read by nothing is how a setting appears to do nothing. The greying
  happens on the first render too, not only when the switch moves — a stored "off"
  must not come up looking live.

## [0.2.0-beta.48] — 2026-10-14

### Added

- **Reset settings to defaults**, at the bottom of Settings → Modelica Studio. It
  asks first, naming what goes and what stays, and then puts every appearance,
  simulation and behaviour setting back — the solver, the panel widths, the line
  weights, the library exclusions (which are reapplied, so the palette and
  completion follow), and the AI configuration.

  **What it keeps is the point.** These settings also hold the record of your
  work, and a reset that took them would be a data loss wearing a preference's
  clothes:

  - the saved-model registry — which file each model lives in;
  - each model's stop time and chart setup (which traces, which window);
  - the models added to the AI picker;
  - the **name** of the secret holding the API key. That is a pointer into
    Obsidian's secret storage: resetting it to a default name would point the
    assistant at a secret that does not exist, which reads as a lost key.

  No file in the vault is touched, and the notice says how many settings were
  reset and what was kept.

- The confirmation dialog is now one shared helper (`src/view/confirm.ts`) used by
  both destructive actions — deleting a model and resetting the settings — so the
  guard cannot be present in one and missing in the other. It marks the button
  that goes ahead and focuses Cancel, so a stray Enter cancels.

## [0.2.0-beta.47] — 2026-10-14

### Changed

- **The thickness sliders start at 90% (wires) and 190% (components)** — a taste,
  chosen by looking at diagrams rather than derived from anything, and now the
  default. Measured through the drawing code at 100% zoom:

  | | at the old default (100%) | at the new default |
  |---|---|---|
  | a pin wire (0.25) | 1.50 px | **1.35 px** |
  | a bus wire (0.5) | 3.00 px | **2.70 px** |
  | a ±10 component's outline (0.5) | 1.00 px | **1.90 px** |
  | a reference-size symbol's outline (0.5) | 3.00 px | **5.70 px** |

  So the wires are a touch lighter than the library draws them and the symbols
  noticeably heavier. **100% stays what the percentages are measured against** —
  the library's own weight — and both sliders still cover 50–400%; the default is
  simply where they start. A stored value always wins, so no existing diagram
  moves: this changes what a fresh install (or a reset) begins with.

## [0.2.0-beta.46] — 2026-10-14

### Fixed

- **A second value axis had its tick labels painted over by the legend.** Reported
  from a screenshot: the values down the right-hand edge (`1.1e+5`) sat behind the
  legend's translucent surface. Both live in the margin right of the frame, and
  the legend did not know the labels were there — measured at a 700px pane, the
  values ended at x=611 and the legend began at x=597, a 14px overlap. The right
  margin now RESERVES the axis label column, the legend starts after it, and its
  surface is painted from the legend's own edge rather than from a width that only
  happened to reach the canvas edge.
- **In a pane too narrow for a legend, the axis values were cut off at the edge.**
  Found while fixing the above: with no legend the right margin was 14px, so a
  380px pane drew `0.011` ending at x=403 — off the canvas. The reservation is
  part of `plotLayout` now, so the pointer-to-time mapping uses the same geometry
  as the pixels; that is the pair that had already drifted once.
- Legend names are shortened to the width that is actually left, measured rather
  than counted in characters, keeping the tail (`…port_a.m_flow`), because a
  character count that fits one font overflows another. Beside an axis a shortened
  legend is drawn rather than dropped — the alternative is reaching for the series
  toggles above the plot, which cover the whole pane.

Each claim is falsified in the tests: reverting the legend's placement reproduces
the overlap numerically, reverting the margin reservation reproduces the clipping,
and moving the legend's surface back over the labels fails the surface assertion.

## [0.2.0-beta.45] — 2026-10-14

### Changed

- **The wire slider now offers the same 50–400% the component slider does.** The
  1000% ceiling was asked for when the numbers had no standard behind them — a
  wire was drawn 1.47x a symbol line declaring the same thickness, so ten times it
  looked reasonable. With MSL's scale 100% IS the library's weight, and 400% is
  the point past which a wire is heavier than the pin it lands on: a single line
  at 6 px against a pin ring 3.5–6 px across. All three sliders — wires,
  components, and the linked one — now cover the same band, from the same two
  constants.
- A stored value outside that band is brought into it when the settings are
  loaded, so the slider and the drawing cannot disagree: a saved 1000% becomes
  400% rather than drawing ten times the weight behind a slider that says 400%.

## [0.2.0-beta.44] — 2026-10-14

### Fixed

- **Component lines were drawn up to ten times too heavy.** Asked for while
  recalibrating the thickness settings, and it turned out to be the same fault as
  the wires, still present on the symbol path: `drawComponent` sets the canvas to
  IDENTITY and maps every coordinate to device pixels itself, so a `lineWidth` is
  already an on-screen width — and the symbol path was dividing it by the
  transform scale anyway. The smaller a component's placement scale, the fatter
  its outline, which is how MSL places nearly everything:

  | zoom | the same symbol at a ±10 extent | at its ±100 canonical size |
  |---|---|---|
  | 0.5 | **30 px** | 2 px |
  | 1 | **10 px** | 2 px |
  | 2 | 4 px | 2 px |

  Both declare `thickness = 0.5`. Resizing a component changed its line weight,
  which is why diagrams looked heavy and inconsistent. The dash pattern was
  divided the same way, so a dashed outline had dashes four times too long.

### Changed

- **One scale for wires and component lines.** MSL's `thickness` is a single
  scale — a connector asking for 0.5 draws a DOUBLE line, and a graphic asking for
  0.5 draws a line of the same weight — but the two had separate curves, and a
  wire came out 1.47x the weight of a symbol line declaring exactly the same
  thing. Both now go through `strokePxFor`, so 100% means the library's own
  weight on both sliders: a single line is 1.5 px and a double one 3 px at 100%
  zoom, and the ratio between them survives at any setting.
- **Link wire and component thickness**, a new switch in Settings → Diagram: one
  slider for both, so the library's ratio cannot be broken by accident. It is
  **off** by default — an added setting should not move an existing diagram — and
  while it is on the wires follow the component weight. The editor applies the
  link itself, so the Studio and an embedded diagram cannot disagree about what
  the settings mean.
- Both sliders now say what they mean in pixels, since the numbers are the
  library's rather than arbitrary: the shared one spans 50–400% (as heavy as a
  symbol takes before it turns into a blob), the wire slider keeps its 50–1000%.

## [0.2.0-beta.43] — 2026-10-14

### Fixed

- **A wire's colour is now legible on the canvas it is drawn on.** Taking the
  colour from the library, as MSL says to, meant drawing wires in values the
  library chose to FILL a white icon. Measured against the canvas, five of the
  eight MSL wire colours were unreadable as lines on the dark canvas and two were
  unreadable on the pale one:

  | connector colour | light canvas | dark canvas |
  |---|---|---|
  | black (no colour named) | 20.3:1 | **1.30:1** |
  | blocks `{0,0,127}` | 15.5:1 | **1.00:1** |
  | electrical `{0,0,255}` | 8.3:1 | **1.88:1** |
  | thermal `{191,0,0}` | 6.3:1 | **2.47:1** |
  | multibody `{95,95,95}` | 6.2:1 | **2.53:1** |
  | bus `{255,204,51}` | **1.46:1** | 10.7:1 |
  | magnetic `{255,127,0}` | **2.45:1** | 6.4:1 |

  A wire is the line a diagram is read through, so it is lifted towards the
  theme's ink — in the smallest steps that clear 3:1, the WCAG threshold for a
  graphical object — and **only** wires: an icon's greys are shading, and they are
  left exactly as the library asked. In practice a shaft stays ink, a multibody
  frame's grey is lifted until it can be followed, and the bus is the library's
  yellow on a dark canvas and a darker yellow on a pale one.

- The Help legend's swatches use the same function as the canvas, so the two
  cannot drift apart in either theme.

## [0.2.0-beta.42] — 2026-10-14

### Added

- **The rule for how a connection is drawn is now explained in Help**, in the
  Diagrams tab, under "How a connection is drawn". Nothing on a diagram says why
  one wire is blue and another is yellow at double width, and the answer is a
  library convention rather than anything visible.

  The section shows the four cases that cover MSL as short bars — an electrical
  pin in the library's blue at a single line, a rotational flange in ink at a
  single line, a signal or control bus in yellow at **double** width, and a
  multibody frame in grey at double width — each coloured by the same function the
  canvas draws with, so the legend cannot drift from what is on screen, in either
  theme. It also states the measurement it rests on: of the library's 94
  connectors, 80 ask for a single line and 14 for double.

### Fixed

- The Help text still pointed at "Settings → Modelica Studio → **Diagram labels**",
  the section's name before it was renamed to "Diagram" in beta.37. A test now
  fails if the old name comes back.

## [0.2.0-beta.41] — 2026-10-14

### Changed

- **A connection is now drawn the way MSL 4.1.0 says it should be.** The rule is
  stated once in the library, in the UsersGuide of `Modelica.Blocks`:

  > "the color and thickness of a connector line are taken from the first line
  > element in the icon annotation of a connector class … the connecting line has
  > the color of the "ControlBus" with double width (due to "thickness=0.5")."

  The scale that sentence implies is the language's: the specification gives
  `Line.thickness` and `FilledShape.lineThickness` the default 0.25, so 0.25 is one
  line, 0.5 is double, 1.0 four times and 5.0 twenty. Measured over MSL 4.1.0: of
  its 94 connectors, **80 declare nothing** (a single line) and **14 declare 0.5**
  (double) — the signal and control buses, the StateGraph inflow/outflow
  connectors, and the MultiBody frames.

  So an electrical wire is now the domain's blue, a shaft is the ink colour, a
  MultiBody frame is grey at double width and a bus is `{255,204,51}` at double
  width. An explicit `Line` annotation written on the connect clause still wins —
  that is what a tool records when a route is edited by hand — and the wire
  thickness setting multiplies on top, so a bus stays double whatever weight you
  prefer.

  One decision worth recording: the rule says the **line** colour, and a mark that
  names only a fill does not supply one. `Flange_a` and `Flange_b` are both filled
  ellipses with no `lineColor` — grey and **white** — so reading the fill would
  have drawn every rotational connection in white, invisible on a light canvas.
  The specification's own default, black, is used instead, and the theme turns a
  black stroke into ink so it stays visible on a dark canvas too.

- Each port now carries the connector class its type resolved to, fully qualified,
  so a relative declaration (`Pin`, `Flange_a`) can be looked up by something that
  does not know which package it sat in.

## [0.2.0-beta.40] — 2026-10-14

### Added

- **Component line thickness**, in Settings → Modelica Studio → Diagram: 50% to
  400% of the standard weight of the lines a symbol is drawn with. Studied first,
  as asked: every stroke a symbol makes resolves its weight in one function, so
  this is a multiplier on that whole curve — the clamps included, which is the
  part that matters:

  MSL 4.1.0 asks for `thickness=0.5` in 1,163 graphics, `1.0` in about 100 and
  `5.0` in six, and the weight is
  `clamp(thickness x 6 x zoom, 1px, 6px)`. From **200% zoom upward every graphic
  already sits at the 6px ceiling**, so a flange the library draws heavy is drawn
  identically to a hairline body outline, at the zoom where a symbol is being
  read. Scaling the ceiling with the setting is what keeps those differences:

  | zoom | 0.5 outline | 1.0 detail | 5.0 heaviest |
  |---|---|---|---|
  | 1 | 3px | 6px | 6px |
  | 2 | 6px | 6px | 6px |

  A component's **pins follow** the setting — a 12px outline with a hairline pin
  ring would look like two different drawings. Text inside symbols, fills, the
  selection and hover outlines, and the palette thumbnails are unaffected, and the
  wires keep their own separate setting. Figures and embedded blocks follow
  automatically, since they draw through the same code.

## [0.2.0-beta.39] — 2026-10-14

### Fixed

- **Zooming out made the wires overlap the symbols.** Reported from two
  screenshots — "when zooming out the lines start to overlap" — and it was the
  stroke width being divided by the zoom *after* its clamps were applied:
  `clamp(2.2 x zoom, 1.2, 8) / zoom` is inversely proportional to the zoom, so the
  further out you went the FATTER every wire got on screen. Measured:

  | zoom | before | after |
  |---|---|---|
  | 0.05 | 24.0px | 1.2px |
  | 0.1 | 12.0px | 1.2px |
  | 0.5 | 2.4px | 1.2px |
  | 1 | 2.2px | 2.2px |
  | 2 | 2.2px | 4.4px |
  | 4 | 2.0px | 8.0px |
  | 8 | 1.0px | 8.0px |

  The points are placed in device pixels and the context transform is identity, so
  the clamped width already *is* the on-screen width; the division was undoing the
  proportionality the rest of the function sets up. Wires now follow the symbols
  down to a 1.2px floor and up to an 8px cap, as the constants have always
  documented, and never move the other way. At 100% zoom nothing changes, so the
  wire-thickness setting keeps the weight it was given.

## [0.2.0-beta.38] — 2026-10-14

### Changed

- **Wire thickness now goes up to 1000%**, from 300%: ten times the standard
  weight, as asked for. The weight is multiplied after the standard's own clamps,
  so ten times really is ten times rather than a clamped 8px — which is what the
  wider range is for. The area a wire can be clicked in follows it, so a very
  heavy wire is grabbable across its face; components and pins still take a click
  before a wire does.

## [0.2.0-beta.37] — 2026-10-14

### Added

- **Wire thickness**, in Settings → Modelica Studio → Diagram: 50% to 300% of the
  standard. The standard is a fixed fraction of a symbol's on-screen size, so
  wires and symbols keep their relationship at every zoom and this moves that
  whole curve. The area a wire can be clicked in follows the setting — a wire
  drawn three times as heavy has to be grabbable across its face, or it looks
  right and feels wrong. Symbols and the grid are untouched.
- **Parameter popup size**, in the same section: the text of the panel that
  appears while hovering a component, 50% to 250%. It has its own setting rather
  than following the label size, which it used to: the name under a symbol is read
  at a glance and the popup is read deliberately, so wanting one larger says
  nothing about the other. The panel grows with its text, so nothing is cut off —
  the old code clamped the font to 9–13px, against which a setting of 200% came
  out as 13px.
- **Readout size**, in Settings → Modelica Studio → Results plot: the cursor
  readout drawn on a result plot, 50% to 250%, separate from the diagram's popup
  because a plot is read on its own. The box, its leading and its padding scale
  with the text, so a large readout does not overflow the panel it sits in. The
  axis ticks, the legend and the trace names are not affected.

  All three apply to the Studio and to blocks embedded in notes.

### Changed

- The settings section "Diagram labels" is now **"Diagram"**: it holds the label
  size, the wire thickness, the hover toggle and the popup size, and only the
  first of those is about labels.

## [0.2.0-beta.36] — 2026-10-14

### Fixed

- **A button that had been busy lost its label and kept both icons.** Reported as
  "the simulation word is missing and shows a static loading wheel", and as a
  duplicated copy icon on the Check button — one fault, mine, from the busy
  indication added in beta.33.

  `setIcon` removes the element's FIRST child and appends the new SVG. A button is
  built as `[icon, label]`, so the first swap left `[label, loader]`, and the swap
  back then removed the **label** and appended the original icon: `[loader, icon]`.
  Two icons and no word, on every button that had been through it — Simulate,
  Check, Generate and Fix. The label is now put back last on every swap, so the
  order is always `[icon, label]`.

- **The test double for `setIcon` was one line — "set `data-icon` and stop" — and
  that is why nothing caught this.** It never touched the element's children, so a
  swap could delete a label in the app and pass every test here. It now does what
  the app does: removes the first child and appends an SVG. With that, the existing
  busy test reports `label: ""`, `icons: 2` when the fix is reverted.

## [0.2.0-beta.35] — 2026-10-14

### Fixed

- **"Fit to view" framed a small diagram tiny in the middle of the pane.**
  Reported from a screenshot of `DCMotor`: 150x60 diagram units drawn 120px tall
  in a 330px pane, with most of the canvas empty. Two causes, both in the fit:
  - `diagramBounds` padded its box by **40 diagram units**, which is 40px at scale
    1 and 200px at scale 5 — most of a large pane. The box is tight now, and the
    margin is in **screen pixels**, which is the space the eye actually sees.
  - The fitted scale was **capped at 2**, so a compact model could not be enlarged
    to fill the pane no matter what the margin was. It goes up to `MAX_ZOOM` now,
    the same limit the zoom buttons use.

  Measured for the reported model in a 1300x330 pane: **120px of drawing before,
  260px after**, centred and fully inside, with the margin reserved under the
  drawing for the component names — which are painted below their symbols and
  belong to no extent, so a fit that fills the height exactly clips the bottom row.
  At the default label size that room is invisible; at the 250% the setting allows
  it is what keeps the names readable.

### Changed

- Three editor tests computed the vertical box by *adding* the viewport offset
  where the canvas is mirrored in y, so they only ever checked one edge. They
  check both now, and the fit test asserts the label room as a measured gap.

## [0.2.0-beta.34] — 2026-10-14

### Added

- **Filter presets for the list of traces** — asked for as "like showing only the
  active traces". A result holds every variable in the model, a hundred and
  seventy for a small motor, and the question asked of that list is nearly always
  one of four:
  - **All** — every variable.
  - **Active** — exactly the traces being drawn, which is how you check what you
    have chosen without hunting through the list.
  - **Varying** — only the variables whose value moves over the run, so the
    constants (an `R_s`, a `p`, a `T`) stop filling the list.
  - **Derivatives** — only `der(…)`, which for a mechanical model is where the
    speeds and accelerations are.

  A preset is a named predicate rather than a filter string — "Active" is not a
  substring of anything — and it **combines with what you type**: pick Varying,
  then type `phi`. The pills sit above the list, one click each, and say which is
  showing with `aria-pressed` as well as colour. An empty preset explains itself
  and names the way out ("No trace is being drawn yet — choose All to pick some"),
  because an empty list has no checkboxes to click.

### Fixed

- **The embed's "N varying" count could throw on a large output resolution.** It
  used `Math.max(...values)`, which overflows the argument stack once a result has
  enough samples — and the number of intervals is a setting. Both it and the new
  preset now go through `summarizeSeries`, which walks the samples in a loop.

## [0.2.0-beta.33] — 2026-10-14

### Added

- **A busy indication wherever the plugin is working.** Asked for as "whenever
  doing something, show that it is busy", and built so it cannot disturb the
  layout: the bar is the app's own `.is-loading` — an absolutely positioned 3px
  accent strip along the top edge of whatever carries it, which Obsidian uses for
  its search results and PDF view — so nothing here creates an element, resizes
  anything, or starts a timer.
  - **Simulating and checking**: the results pane carries an indeterminate bar,
    and the button that started it turns its icon (a fixed 14px box, so the
    button cannot change size).
  - **A sweep** is *determinate*: the width is the progress, so 2 of 5 values
    fills to 40% rather than sweeping forever, and it eases to each step.
  - **Waiting for the AI**: the request row carries the bar, and Generate or Fix
    — whichever was pressed — turns its icon. Cleared in a `finally`, so a
    stopped, failed or timed-out request leaves nothing running.
  - **The library index on first launch**, when the palette is empty for a second
    or two with nothing saying why.
  - **A simulation block embedded in a note**: the bar goes on the block's own
    toolbar, so a note of five blocks animates exactly the one that is working.
- Every one of them also sets `aria-busy`, because a sliding bar is decoration
  and that is what says "being computed" to a screen reader.

### Accessibility

- Under `prefers-reduced-motion: reduce` a sliding bar is motion, so the bar
  becomes one that is simply THERE, and the determinate one keeps its width —
  that is information rather than movement. The turning icons stop turning.

## [0.2.0-beta.32] — 2026-10-14

### Fixed

- **The list of traces stopped short of the bottom of the panel.** It had a fixed
  190px cap, so in a tall pane it floated with a hand's width of empty space
  below it — reported as "the list box is not all the way to the end". The pane is
  a column for that tab now and the list takes the height left below the heading,
  the filter and the count, with the rows scrolling inside it. A floor of about
  six rows keeps a short pane from turning it into a slit, and the Selection tab
  is untouched: pinning its body to the pane would leave the lower half of a long
  form unreachable.
- **Two things were stealing size from that box.** The filter was `width: 100%`
  *plus* 6px of side margins, so it was wider than the panel it sits in: the
  inspector grew a horizontal scrollbar, and that bar took a row's worth of height
  off the list below it. And a variable name could not shrink — a flex item's
  automatic minimum size is its whole unbreakable word — so a long name stretched
  the row past the box and was cut off with no ellipsis, as
  `der(motor.airGapDC.vai…` shows. The filter's margins are part of its width now,
  and the name has `min-width: 0`, which is what makes an ellipsis possible at all.

### Changed

- The DOM harness's theme now carries app.css's global `* { box-sizing: border-box }`.
  Without it every box in a test was measured content-box, which hid the overflow
  above: the harness was wrong, not the plugin.

## [0.2.0-beta.31] — 2026-10-14

### Fixed

- **The tooltip that appeared behind the open parameter list.** Obsidian attaches
  tooltips by delegation on `[aria-label]`, and it reads its opt-out from the
  COMPUTED style — `getComputedStyle(el).getPropertyValue("--no-tooltip")`, read
  out of the app bundle — so the flag inherits to every child. The results bar's
  groups carried labels, so a group's name popped up whenever the pointer crossed
  anything inside it; a native list popup is drawn above everything in the page,
  so the tooltip was left peeking out from behind it. The groups are unnamed now
  (a name on a plain `div` is not exposed by screen readers anyway, and each
  control inside carries its own), and the parameter list itself is silenced while
  keeping its name. The controls whose tooltips are worth having — the values
  field, Sweep, Keep as before, Δ vs — still show theirs.

### Changed

- **A sweep now tells you it needs at least two values.** One value used to run:
  the single run became the result on screen and the family came out empty, so a
  "sweep" of one number looked like the plot simply changing, with nothing saying
  why there was nothing to compare with. It is refused now, with a notice that
  states the requirement and both forms — `100, 200, 400` or `0:0.5:2` — the
  Sweep button's tooltip says it as well, and the Help window's sweep section
  spells it out: one value is a single run with a parameter set, which is what the
  inspector is for.

## [0.2.0-beta.30] — 2026-10-14

### Fixed

- **"Why is there a box hiding the list of traces?"** Nothing was covering it. The
  list is a 190px window onto up to forty rows, so it is scrolled constantly, and a
  freshly scrolled row is cut off at the list's top edge — which was 4px below the
  filter box, with nothing to mark where the list began. Measured from the
  screenshot, the cut is 4px *below* the box's border: that is the list's own top
  edge, and the row was simply scrolled out of it. The list now has its own
  bordered, inset surface and a real gap from the filter, so the boundary is
  visible and a cut row reads as a scrolled list rather than as something the box
  is doing.
- **How much of the list is off screen is now stated above it** — "Showing the
  first 40 of 173 — type to narrow the list" — instead of at the foot of the
  scroll area, where it could only be found by scrolling to the end of the set the
  reader is trying to search.

### Changed

- **Checking a trace no longer throws the list back to the top.** The list is
  rebuilt on every check and a fresh element starts at the first row, so ticking
  the thirtieth trace meant finding the thirty-first all over again. The reader's
  offset is kept across a rebuild, and dropped when the filter or the result
  changes, because then the list is of something else.

## [0.2.0-beta.29] — 2026-10-14

### Fixed

- **The sweep dropdown had no arrow.** I removed Obsidian's `dropdown` class in
  beta.27 to stop its padding fighting a fixed height — and the chevron is drawn
  on that class alone: `app.css` sets `appearance: none` on every `select` and
  puts the arrow on `.dropdown`. The class is back, and only the properties that
  actually fought are overridden, so hover, focus and disabled come from the theme
  again.
- **The parameter box and the values box were drawn by two stylesheets.** A lone
  class loses to Obsidian's `input[type='text']`, so the select was drawn by the
  plugin's rule and the input by the theme's: two fills and two paddings, side by
  side. One rule governs both now, at a specificity that wins.

### Changed

- **The results bar has been rebuilt**, as agreed from the mockup:
  - `Sweep` is the one accented action in the row;
  - `Scale` / `Full screen` / `Auto scale` share one segmented box;
  - `Δ` became **Δ vs**, filled rather than ringed, and sits inside the group it
    belongs to — it used to be a bare button between two groups, which a wrap left
    stranded at the end of a line;
  - `Copy image` and `Save image` are one **⋯** menu at the end of the row, which
    keeps the row on one line in a narrow pane (at 900px it wrapped to two before,
    and is one line now);
  - the rules between the groups are gone. The boxes and the spacing group them,
    and the rule class was the one that inherited the pane grip's `::before`;
  - the `100, 200, 400` hint is greyed, and `t_end` is sized to its number.
- The row now lives in `src/view/plot-actions.ts` behind a host interface rather
  than as 140 lines of closures inside the 4,400-line view. That is what lets
  `test/plot-actions.test.mjs` render it in a real DOM with the real `styles.css`
  and assert what the browser computes — the two cascade bugs above look perfectly
  correct in the source and are only visible in a computed style.

## [0.2.0-beta.28] — 2026-10-14

### Added

- **The crossing snap is now a setting, in two parts** — Settings → Modelica
  Studio → Results plot. One switch turns it off, and one slider sets how close,
  **in pixels on screen**, the pointer has to come to a crossing before it takes
  it. Pixels rather than seconds on purpose: a distance in seconds is a different
  magnet at every zoom level, while seven pixels is seven pixels. The slider is
  greyed and says so while the switch is off, rather than looking live and doing
  nothing. Both apply to the Studio's plot and to a simulated block embedded in a
  note, which share the readout. The default is unchanged: on, at 7 px, which is
  what the snap always used.

### Changed

- The pointer-readout settings moved under their own **Results plot** heading.
  They were filed under "Diagram labels", which had nothing to do with them.
- The snap's reach is clamped to a usable range (1–40 px) wherever it is read, so
  a hand-edited `data.json` cannot switch the snap off by accident or widen it
  until the cursor jumps across the plot.

## [0.2.0-beta.27] — 2026-10-14

### Fixed

- **The sweep's parameter dropdown overlapped its neighbours.** Three causes, all
  of them mine: it borrowed Obsidian's `.dropdown` class, whose own padding and
  background arrow fight a fixed height and put the arrow over the text; the groups
  had no `flex: 0 0 auto`, so a narrow pane squeezed them until their contents
  overlapped; and the row could not wrap. The select is now styled here rather than
  by Obsidian's class, every group refuses to shrink, and the row wraps when it runs
  out of width instead of crushing what is in it.

## [0.2.0-beta.26] — 2026-10-13

### Fixed

- **The cursor snap did nothing on a plot with two y-axes.** The snap searched for
  two curves whose VALUES are equal, and the curves it was written for —
  `capacitor.v` on 0…15 and `inductor.i` on −0.1…0.1 — are two magnitudes that get
  two axes, so their values are never equal while the lines cross plainly on screen.
  It searched for an equality that could not happen. The search now runs in the
  space the lines are DRAWN in, through the same per-series scaling the renderer
  uses, so "the lines cross" means what the reader sees.

  Reported as "the cursor snaps to crossings is not working", on the RLC plot the
  feature was written for.

## [0.2.0-beta.25] — 2026-10-12

### Added

- **The cursor snaps to the instant two curves cross.** That instant is what a plot
  like an RLC response is read for — where the capacitor's voltage meets the
  inductor's current — and placing it by eye gives a time that is nearly right. A
  crossing is a sign change between two samples, and the instant is interpolated
  between them, since the samples are a fixed grid and the crossing is almost never
  on one. The magnet acts within a hundredth of the visible span — about seven
  pixels — so the cursor is unchanged everywhere else, and the readout says
  `(crossing)` when it has snapped.

### Fixed

- **The resize grip appeared at the far left of the results bar.** The rules added
  between the button groups were given the class `modelica-studio-divider`, which is
  the PANE divider — so each rule inherited that divider's centred `::before` grip
  and drew a stray bar. Reported as "the resizing handle is now not centred, it is
  on the far left for some reason". The rules have their own class now.

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
