# Modelica Studio

An Obsidian plugin for building Modelica models on a visual schematic canvas,
simulating them with a local OpenModelica installation, and plotting the results
— all inside a note.

**Status: beta.** Experimental software that has not been widely tested. It works,
and its examples are verified numerically against independent calculations, but
expect rough edges. See [Beta status](#beta-status).

What that verification actually cost — twelve expectations that turned out to be
wrong, the models that were abandoned rather than fixed, and how each
discrepancy was settled — is in
**[Testing findings](docs/testing-findings.md)**.

---

## New to Modelica?

Modelica describes a physical system by writing down its equations and letting
the tool work out how to solve them, rather than by writing the steps to solve
them. Two introductions by Michael Tiller:

- **[Why Would Anybody Care About Modelica?](https://www.youtube.com/watch?v=Hl1vjQWxvOA)**
  — what the language is for, and why equations are a different way to program.
- **[Modelica by Example](https://mbe.modelica.university/)** — a book readable
  online, building the language up from a first-order equation through events,
  arrays and functions to object-oriented modelling, with every chapter worked
  through and reviewed.

There is also a ten-minute introduction in this repository —
[`showcase/notes/00-modelica-intro.md`](showcase/notes/00-modelica-intro.md) —
written to be read before any of the examples.

---

## What it does

- **Schematic editor.** Drag components from a library tree onto a canvas, wire
  their pins together, edit parameters. The search box matches fuzzily, so
  `tank` finds `OpenTank`, and whole libraries can be left out of the palette,
  search and completion. Drawing follows the Modelica
  specification's graphical annotations, so library icons look as their authors
  drew them.
- **A diagram that explains itself.** Hovering a component shows what its
  parameters are set to, with the ones you have changed first — reading a
  diagram's settings otherwise means selecting each component in turn. A
  connector the class only declares conditionally, such as a heat port before
  `useHeatPort` is true, is dimmed and cannot be wired until the parameter is on.
  Label size is a setting, and the hover readout can be switched off.
- **Simulation.** Serializes the diagram to Modelica source, compiles and runs it
  with OpenModelica, and reads the results back.
- **Plots.** Time-series traces with automatic axis grouping, a resizable pane,
  and a full-screen view with a cursor readout.
- **Diagram and code modes.** The same model, either built by dragging or edited
  as Modelica source with syntax highlighting, completion from the library, and
  inline diagnostics. Long models scroll, and the caret keeps itself in view.
- **Models as files.** Create a model and save it as `.mo` source. Models go
  into a `Modelica/` folder at the vault root by default — they are source for a
  compiler, not notes, and a vault whose root mixes the two is unreadable. The
  folder is a setting, and is created on the first save.

  A saved model opens **four ways**: right-click it in the file explorer →
  *Open in Modelica Studio*; drag it onto the canvas or the code pane; run
  *Open the active .mo file in Modelica Studio* from the command palette; or
  click it and read the source as text. That last one is deliberately still the
  default — the file *is* source, and reading it in an editor is a reasonable
  thing to want. The plugin does not take the click away.
- **Optional AI assistance.** With your own API key, describe a model in words
  and have it written into the editor, or ask for a compile error to be fixed.
  The form follows the request: a circuit, a fluid network, a mechanism or a
  control loop comes back as **wired components you can see on the canvas**, and
  only a subject with no structure to draw — a projectile, a transfer function —
  comes back as equations.
- **Inline results in notes.** A fenced `modelica` block renders a live diagram
  and simulates when the note opens.
- **Worked examples.** 30 models across electrical, mechanical, fluid, thermal,
  aerospace, control and discrete domains, each with a derivation, the live
  model, and a table comparing an independent calculation against the
  simulation.
- **A worked case for learning.** `showcase/01-learning-with-a-simulator.md`
  demonstrates using the plugin to learn a new subject, worked through with two
  aerospace models.
- **A record of what went wrong.** [Testing findings](docs/testing-findings.md)
  lists every expectation that failed, which side was wrong, and the five models
  dropped for being unverifiable.

Diagrams are stored as **real Modelica source with graphical annotations**, so
files round-trip through OMEdit and other Modelica tools.

## Requirements

- Obsidian 1.5.0 or later, **desktop only** — it runs a compiler, and mobile is
  not supported.
- **OpenModelica**, installed separately. The plugin detects `omc` on your PATH
  and offers download guidance if it is missing. Developed against 1.27.
- A Modelica Standard Library, which ships with OpenModelica.

## Install

Not in the community plugin list yet. Two ways in.

### With BRAT, which keeps it updated

[BRAT](https://tfthacker.com/BRAT) installs a plugin straight from its GitHub
releases and updates it for you. This plugin is beta-only, so every release is a
pre-release and BRAT is the intended route.

1. Install **BRAT** from Settings → Community plugins → Browse.
2. In BRAT's settings, **Add Beta Plugin**.
3. Enter this repository: `AhmedAlfahdi/modelica-studio`
4. BRAT installs the latest release. Enable **Modelica Studio** in
   Settings → Community plugins.

To pin a version instead of tracking the latest, use BRAT's **frozen** option and
name the release, for example `0.2.0-beta.14`.

BRAT reports a mismatch if a release's tag, its name and the version inside the
released `manifest.json` disagree. They are kept identical here on purpose, so an
update is never held back by a version string.

### By hand

1. Take `main.js`, `manifest.json` and `styles.css` from a release, or build them
   (below).
2. Create `<your-vault>/.obsidian/plugins/modelica-studio/`.
3. Copy those three files into it.
4. **Reload Obsidian** — a plugin's `manifest.json` is read at startup, so
   copying one in while the app is running does not register it.
5. Enable **Modelica Studio** in Settings → Community plugins.

To try it without your own vault, `examples/vault/` is a ready-made one — see
[Testing](#testing).

## Build

```bash
npm install
npm run build          # typecheck, then bundle to main.js
npm run dev            # rebuild on change
npm test               # 590 tests, including a numerical audit of every example
```

`npm test` runs the real OpenModelica compiler, so it needs `omc` on your PATH
and takes a few minutes. Without it, the simulation-dependent tests skip.

## Use

- **Open the studio** from the ribbon icon or the command palette.
- **Examples** in the toolbar loads a built-in model. Start there.
- **Simulate** compiles the diagram and plots the result.
- The **Source** tab shows the Modelica the diagram serializes to. In a note, the
  block's text updates as you edit, so the diagram lives in the note.

### Inline blocks

````markdown
```modelica
//@ time=2
model Divider
  Modelica.Electrical.Analog.Sources.ConstantVoltage source(V=10);
  Modelica.Electrical.Analog.Basic.Resistor r1(R=100);
  Modelica.Electrical.Analog.Basic.Resistor r2(R=100);
  Modelica.Electrical.Analog.Basic.Ground ground;
equation
  connect(source.p, r1.p);
  connect(r1.n, r2.p);
  connect(r2.n, source.n);
  connect(source.n, ground.p);
end Divider;
```
````

To put one in a note, use the command palette: **Embed a simulation in the current
note** asks which model — the one open in the studio, a built-in example, or a saved
`.mo` file — and writes the block at the cursor with its options filled in (how long
to run for, how tall it is, and whether it opens on the plot or the diagram). The
span follows whichever model you pick. The same dialog will copy the block to the
clipboard instead, and **Embed the open model in the current note** skips the
question and uses the model in the studio.

The first line is an optional **directive**: `time` sets the simulation span,
`height` the height of the pane (the plot and the diagram are the same box, shown
one at a time), `result`/`edit` which of the two starts open, and
`noauto`/`manual` to keep the block from running itself at all. It lives inside
the block because Obsidian does not pass a fenced block's info string to a
plugin, so a fence reading `modelica time=2` never reaches the code.

**A block runs itself once**, when the note is opened. After that the **Simulate**
button is what starts a run — the plot has a `t_end` field beside it, and typing a
span there re-runs the block over it and records it in the directive. The reason is
that an edit made in a block's own diagram writes the note back, and a note that
re-renders rebuilds the block: without the rule, dragging one component ran four
simulations, which is the flicker you would see while moving something. A rebuilt
block repaints the result it already had; if the model has changed since that run,
the line above the plot says so rather than the stale curve passing itself off as
current.

Blocks follow the studio: change the plot scale, the visible traces or the
simulation span there and the blocks follow. Parameter values travel with it, and
a block re-simulates when a value it ran with changes.

A block answers the pointer the way the studio does. Resting on a component shows
what its parameters are set to — the ones the instance overrides first — which is
the **Show parameters when hovering a component** setting under
**Settings → Modelica Studio → Diagram labels**, and it applies to embedded
diagrams as well as the studio. Moving the pointer across the plot reads the time
and every visible trace's value at that point, with a crosshair on it.

## AI assistance

Optional, off until an API key is entered.

1. Settings → Modelica Studio → AI assistance.
2. **API key** opens Obsidian's keychain: pick an existing secret, or create one.
   Pick a provider preset, or set the base URL and model directly. Any
   OpenAI-compatible endpoint works, including a local Ollama or llama.cpp
   server.
3. **Test** confirms the provider answers, and says what it said if it does not.
4. **Refresh model list** asks the provider which models it currently offers.
   Model names are retired without notice — `deepseek-chat` became
   `deepseek-flash` — and a retired name fails with an error that reads like a
   bad key, so the plugin fetches the list rather than shipping a stale one.

In the studio, switch to **Code** and press **AI**. Describe the model you want
and it is written, compiled and **repaired until it builds** — without further
input:

1. The request goes to the provider with the brief above attached.
2. The reply is **compiled** with OpenModelica.
3. If it fails, the compiler's own output — with its line and column numbers —
   goes back to the provider as the next request.
4. Steps 2 and 3 repeat until it compiles.

**You choose the form and the effort.** Two settings under AI assistance:

- **Model style** — *Diagram first* builds from library components, so you get a
  schematic you can see and rewire. A schematic depends on component paths,
  parameters and every connection being right, so the ways to fail outnumber the
  ways to succeed; equations have far less to get wrong. So if the diagram has
  had two attempts and still will not compile, the run **falls back to equations**
  automatically and says so. *Equations* skips straight there.
- **Reasoning effort** — *Off* / *Low* / *High* / *Max*. Providers that default to
  thinking spend that time on every request, and it silently disables Temperature.
  Off is fastest and suits code; raise it when attempts keep failing.

The loop stops when the model compiles, when the model returns the same source
twice, when the same error comes back twice (compared after stripping build
paths and timings, which differ on every attempt), when a provider error
occurs, or at five attempts. A model that compiles but has nothing that changes
with time counts as a **failure**, because OpenModelica builds it and then
refuses to simulate it.

Each step is reported as it happens — the attempt number, and the fault being
repaired — and **Stop** ends the run after the current step. Nothing is written
to the editor until a model compiles, so a run that produces nothing leaves your
model as it was.

**The Run log** tab keeps every simulation of the session: the model, the
parameters and run settings used, the timings, and on failure OpenModelica's
**complete output**. **Send to AI** hands that to the model and asks for a fix,
so a repair request is built from the compiler's own words rather than a
paraphrase — the first line of an OpenModelica error is usually a file path or
`Internal error`, and the line naming the fault comes several lines later.
**Copy** puts the same text on the clipboard for a bug report.

Every request also carries a standing brief about this installation, so the model
writes for the machine it is actually on rather than a generic one: the
OpenModelica version and path, the indexed libraries and how many classes they
hold, the run settings a simulation will use (span, intervals, tolerance,
solver), the libraries you have excluded, and the failures already in the log.
It is told not to add an `experiment` annotation, because the plugin applies the
run settings itself and an annotation conflicts with them.

The key lives in **Obsidian's keychain**, not in this plugin's `data.json`. Only
the *name* of the secret is stored with the plugin, so the value stays out of
vault backups, sync services and version control, and any other plugin can reuse
the same secret. It is never written to the debug log, never attached to an error
message, and only ever sent to the endpoint configured here.

This needs **Obsidian 1.11.4 or later**, which is where the keychain API arrived;
the plugin declares that as its minimum. On an older build the AI section says so
rather than falling back to storing a key in plain text.

If you configured a key with an earlier version of this plugin, it is still in
`data.json` and the settings page offers to move it into the keychain and delete
the plaintext copy.

Generated code is **unverified**: it is a draft to simulate and check, not an
answer. The request includes the current source and a shortlist of library
classes relevant to your description, so the model composes real MSL classes
instead of inventing names.

## Recovering a lost model

A saved model has three places it can still be found after the vault copy is gone:

1. **The plugin's history** — every save keeps the version it replaced, in the
   plugin's own folder (`.obsidian/plugins/modelica-studio/history/`), one
   directory per model. Twenty revisions are kept; **Model list…** in the studio
   shows them with restore.
2. **OpenModelica's build cache** — `/tmp/modelica-studio/*/<Model>/<Model>.mo`
   holds the exact source that was last compiled.
3. **The desktop trash** — `~/.local/share/Trash/files/` on Linux.

Deleting from **Model list…** uses the vault's own trash and snapshots first, so
that route is reversible twice.

## Debugging

The plugin logs to Obsidian's **developer console** (Ctrl+Shift+I) as well as to
`.modelica-studio.log` in the vault. It also publishes a handle for inspecting its
state live:

```js
modelicaStudio.help()        // what you can inspect
modelicaStudio.state()       // model, span, save path, toolchain, run count
modelicaStudio.source()      // the model as Modelica
modelicaStudio.model         // the parsed diagram
modelicaStudio.settings      // stored settings
modelicaStudio.library       // the class index
modelicaStudio.runLog        // every simulation this session
modelicaStudio.setVerbose(true)   // print every diagnostic line
modelicaStudio.trace()            // what the plugin held, step by step
```

The **run log** (the Run log tab under the results) and the **AI prompt log**
(Show the AI prompt log in the command palette) each have a **Copy** button, which
puts exactly what the pane is showing on the clipboard — for a bug report, or for
pasting into a prompt. A copy that the platform refuses says so rather than
claiming success.

`trace()` is the one for a suspected loss. The file log records what the plugin
**did**; the trace records what it **held** at each moment that changed — which
model, how long its source is, whether that source is still current, and which
file it will be written to:

```
      0ms  open    AirplaneDrag   src=2869 current=true comps=8 eqs=0 file=Modelica/AirplaneDrag.mo mode=code
   4200ms  edit    AirplaneDrag   src=2869 current=false comps=8 eqs=0 file=Modelica/AirplaneDrag.mo mode=diagram
   5100ms  adopt   AirplaneDrag   src=2874 current=true  comps=8 eqs=0 file=Modelica/AirplaneDrag.mo mode=code
   9800ms  switch  AirplaneDrag   src=2874 current=true  comps=8 eqs=0 file=Modelica/AirplaneDrag.mo mode=code
```

A `current=false` with no following `save` is the shape of a loss: the plugin was
holding an edit it had not written.

The log file is opt-in (**Write diagnostic log** in settings) because it survives
a reload and can be read from outside the app. The console needs no setting:
errors and warnings always print there, because a failure nobody can see is the
one that gets reported as "nothing happened".

## What is known about the AI

One model has been measured, not assumed: see
[`docs/ai-baseline.md`](docs/ai-baseline.md) for the method, the results, and
what they do **not** establish. In short, for `deepseek-flash`:

- diagram-first works — 8/8 compiled, 7 as fully wired diagrams across electrical,
  mechanical, thermal, fluid, multibody and control;
- the equations fallback earned itself, on one run out of eight;
- a hard request can take several minutes, because the repair loop is additive.

**No OpenAI model has been tested.** If you run one, `modelicaStudio.bench()` in
the developer console measures it, and the result belongs in
`docs/ai-baseline.json` as a new entry.

## Beta status

Experimental, and it wants more testing. Specifically:

- **Requires Obsidian 1.11.4+**, for the keychain the AI feature stores its key
  in. Earlier builds are refused rather than downgraded to plain-text storage.
- **Tested against one OpenModelica build** (1.27.0) on one platform (Linux).
  Windows and macOS are untested, and so is every other OpenModelica version.
- **MSL 4.1.0 is what the examples use.** Other library versions have not been
  tried.
- **Not all of Modelica is supported.** Array-valued connectors, `redeclare
  model` refinements, and bitmap icons have known gaps. Conditional connectors
  are handled — they are dimmed and unwireable until their parameter is on —
  but an array port is not captured, so a class with one is reported rather than
  silently mis-drawn. Unsupported constructs surface as compiler errors rather
  than silently.
- **The audit covers the built-in examples, not your models.** A hand-built model
  may hit a parser or serializer limitation the examples do not.
- **No plugin-store review.** Nothing has been checked by anyone but its author.

If something fails, enabling **Debug log** in settings writes a diagnostic log to
`.modelica-studio.log` in the vault, and **Show coordinate diagnostics** overlays
the editor's geometry.

## Testing

`examples/vault/` is an Obsidian vault you can open directly: the 30 worked
examples, cross-linked, each with a live model and its verified numbers, plus an
introduction to the language and a demonstration of using it to learn a new
subject.

1. Copy `main.js`, `manifest.json` and `styles.css` into
   `examples/vault/.obsidian/plugins/modelica-studio/`.
2. Open `examples/vault/` as a vault in Obsidian.
3. Enable the plugin, then open `showcase/00-modelica-intro.md`.

Start with the introduction, then any example, and press **Simulate** in a block.

Reports of what breaks are the most useful contribution at this stage. Include
the Modelica source, the error, and your OpenModelica version.

## Verification

Every built-in example is checked numerically against a value derived
independently of the plugin — a closed-form solution, an independent integration
of the same ODE, or the Modelica Standard Library source. The audit runs on every
`npm test`.

Where a check was not possible it says so rather than asserting a number: the
double pendulum is chaotic, so its total energy is checked (drift under 1%,
non-growing) instead of its trajectory; pipe friction depends on an empirical
correlation, so a mass balance is checked rather than a pressure drop.

Twelve expectations were themselves wrong when first written, and every one was
corrected only after tracing the discrepancy to the expectation rather than the
simulation. Not once was the solver at fault. The full account — what was
expected, what came out, which side was wrong and how it was settled — is in
[`docs/testing-findings.md`](docs/testing-findings.md), along with the five models
that were built, found unverifiable, and abandoned.

## Performance

Measured on the development machine — **Ryzen 5 2600X, 12 threads, 15 GB, NVMe,
OpenModelica 1.27.0, Modelica 4.1.0** — for a small MSL circuit. Every number below
is a wall-clock measurement, not an estimate.

The one thing worth knowing: **the first launch after installing or upgrading the
library costs about 1.2 s, and nothing else is slow.** Editing and re-running is
milliseconds.

### Startup

| Stage | Measured | When |
|---|---|---|
| Parse the whole MSL into the class index | **1.2 s** | first launch after install/upgrade |
| Load the index from its cache | **~0.3 s** | every launch after that |
| Cache file | 25 MB | written beside the plugin's data |

5984 classes are parsed out of 2424 files — 13 MB of library source. Only the
newest release of each library is read: OpenModelica keeps every installed
version side by side, and indexing all of them put three releases of `Modelica`
into one table keyed by class name, where the definition that won depended on the
order the filesystem handed the files over. The palette is built while this
happens rather than before it, so the index cost is not a delay in opening the
studio — it is why the palette fills in a moment late on a cold start.

### Editing and running

| Action | Measured | Why |
|---|---|---|
| Simulate with the binary already built | **18–36 ms** | the compiled model is reused |
| Change a parameter and re-run | **~30 ms** | applied as a run-time override, not a rebuild |
| Building the identical source again | **0 ms** | the fingerprint matches and the binary is reused |
| First build, small equation model | **0.6 s** | translate, generate C, compile, link |
| First build, 4-component MSL circuit | **1.5–1.8 s** | library classes bring their own equations |

The 30 ms row is why parameters are applied as run-time overrides rather than by
regenerating code, and why editing a value and re-simulating is immediate. Only a
structural change — adding a component, rewiring, editing an equation — pays for a
rebuild. Details in [`docs/design.md`](docs/design.md).

An edit that only changes a value, a start attribute or a run setting stays on the
fast path. So does switching between models that have both been built once.

### What the settings are worth

**Parallel compile jobs** is the setting that matters, and it is worth measuring
rather than guessing. Same 4-component circuit, cold cache, on the 12-thread CPU:

| `jobs` | First build | Saving |
|---|---|---|
| 1 | 4.07 s | — |
| 2 | 2.47 s | 39% |
| 4 | 1.75 s | 57% |
| 8 | 1.43 s | **65%** |

Each measured with an empty build cache and a freshly constructed backend, and
reproduced twice — the first attempt at this table compared contaminated figures,
since a backend remembers what it has already built and answered in 0 ms.

The default is one less than the core count. Raising it past the physical core
count does little, because code generation is CPU-bound.

**Excluded libraries** does not affect the timings above — the whole library is
still parsed — but it decides how much the studio has to offer. Excluding four
sub-libraries that many models never touch:

| | Placeable classes |
|---|---|
| Everything indexed | 1365 |
| After excluding `Magnetic`, `Clocked`, `ComplexBlocks`, `StateGraph` | 1089 |

A shorter palette is easier to search, and a shorter list in the AI's brief is
less to choose wrongly from.

### Choosing a solver

Leave it on **OpenModelica default** unless you have a reason. The list is what
this runtime offers, read from the runtime itself:

| Solver | What it is | Use it when |
|---|---|---|
| `dassl` | BDF, implicit, adaptive order 1–5 | the default; right for stiff systems |
| `ida` | SUNDIALS BDF, implicit, sparse | large systems, where the sparse solver scales better |
| `cvode` | SUNDIALS BDF or Adams–Moulton, order 1–12 | you want accuracy — measured **1e-16** against 8e-8 for `dassl` on a stiff problem |
| `gbode` | a family of Runge–Kutta methods, order 1–14, implicit or explicit | you want to try a non-BDF method, or multi-rate integration |
| `euler` | explicit, fixed step, order 1 | teaching, and seeing what a bad solver looks like |
| `rungekutta` | classical explicit RK, fixed step, order 4 | smooth non-stiff models; unstable on stiff ones |
| `symSolver`, `qss` | symbolic inline; quantised-state | experimental — `symSolver` needs a compiler flag this plugin does not pass |

**A stiff system** is one where something changes far faster than the interval you
care about — a fast electrical transient next to a slow thermal one. Explicit
methods take tiny steps to stay stable there; implicit ones like `dassl` and
`cvode` do not.

One caution worth knowing: **an unrecognised solver name is not an error to
OpenModelica.** It warns, exits successfully, and writes a result file full of
NaN. The name is `rungekutta`, not `rungekutta4` — and this plugin recommended the
wrong one until it was measured. The plugin now reports an all-NaN result as a
failure naming the solver, rather than showing an empty plot.

### Measuring it yourself

`modelicaStudio.state()` reports the toolchain, the index size and the settings in
force. The AI timings in [`docs/ai-baseline.md`](docs/ai-baseline.md) are measured
the same way: by running the thing and writing down what happened.

A different machine will differ, most in the compile column — that stage is
CPU-bound and parallel, so core count moves it more than anything else. If a
simulation feels slow, check `jobs` first, then whether the model is rebuilding
when it should not be.

## Repository layout

```
src/
  main.ts              plugin entry, commands, settings, embeds
  ai/                  prompt construction and the OpenAI-compatible client
  modelica/            parser, serializer, library index, examples
  render/              canvas drawing of Modelica graphical primitives
  view/                schematic editor, studio view, plots, inline blocks
  omc/                 OpenModelica process, build cache, result reading
test/                  unit and integration tests, and the numerical audit
showcase/              generator for the example notes (math, explanations)
examples/vault/        the test vault, with the generated notes
docs/
  design.md            why it is built this way, and the measurements behind it
  testing-findings.md  every failed expectation and what it turned out to be
research/              background research kept from development
scripts/               bundle checks
```

## License

MIT. See [`LICENSE`](LICENSE).

Neither Modelica nor OpenModelica is bundled. OpenModelica is installed
separately and is subject to its own licence.
