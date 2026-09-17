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

## What it does

- **Schematic editor.** Drag components from a library tree onto a canvas, wire
  their pins together, edit parameters. The search box matches fuzzily, so
  `tank` finds `OpenTank`, and whole libraries can be left out of the palette,
  search and completion. Drawing follows the Modelica
  specification's graphical annotations, so library icons look as their authors
  drew them.
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

Not in the community plugin list. Install manually:

1. Take `main.js`, `manifest.json` and `styles.css` from a release, or build them
   (below).
2. Create `<your-vault>/.obsidian/plugins/modelica-studio/`.
3. Copy those three files into it.
4. Enable **Modelica Studio** in Settings → Community plugins.

To try it without your own vault, `examples/vault/` is a ready-made one — see
[Testing](#testing).

## Build

```bash
npm install
npm run build          # typecheck, then bundle to main.js
npm run dev            # rebuild on change
npm test               # 207 tests, including a numerical audit of every example
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

The first line is an optional **directive**: `time` sets the simulation span,
`height` the canvas height, `result`/`edit` whether the plot starts open. It lives
inside the block because Obsidian does not pass a fenced block's info string to a
plugin, so a fence reading `modelica time=2` never reaches the code.

Blocks follow the studio: change the plot scale, the visible traces or the
simulation span there and the blocks follow. Parameter values travel with it, and
a block re-simulates when a value it ran with changes.

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

## Beta status

Experimental, and it wants more testing. Specifically:

- **Requires Obsidian 1.11.4+**, for the keychain the AI feature stores its key
  in. Earlier builds are refused rather than downgraded to plain-text storage.
- **Tested against one OpenModelica build** (1.27.0) on one platform (Linux).
  Windows and macOS are untested, and so is every other OpenModelica version.
- **MSL 4.1.0 is what the examples use.** Other library versions have not been
  tried.
- **Not all of Modelica is supported.** Array-valued and `conditional`
  connectors, `redeclare model` refinements, and bitmap icons have known gaps.
  Unsupported constructs surface as compiler errors rather than silently.
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

Measured on a Ryzen 5 2600X with OpenModelica 1.27, for a small MSL circuit:

| Stage | Measured |
|---|---|
| Load the Modelica Standard Library | ~970 ms, once per session |
| Compile a model | ~1.9 s with `-n=8` parallel codegen, ~4.6 s without |
| Re-run with changed parameters | **~20 ms**, reusing the compiled binary |

The last row is why parameters are applied as run-time overrides rather than by
recompiling, and why an edit re-simulates immediately. Details in
[`docs/design.md`](docs/design.md).

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
