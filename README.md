# Modelica Studio

An Obsidian plugin for building Modelica models on a visual schematic canvas,
simulating them with a local OpenModelica installation, and plotting the results
— all inside a note.

**Status: beta.** Experimental software that has not been widely tested. It works,
and its examples are verified numerically against independent calculations, but
expect rough edges. See [Beta status](#beta-status).

---

## What it does

- **Schematic editor.** Drag components from a library tree onto a canvas, wire
  their pins together, edit parameters. Drawing follows the Modelica
  specification's graphical annotations, so library icons look as their authors
  drew them.
- **Simulation.** Serializes the diagram to Modelica source, compiles and runs it
  with OpenModelica, and reads the results back.
- **Plots.** Time-series traces with automatic axis grouping, a resizable pane,
  and a full-screen view with a cursor readout.
- **Inline results in notes.** A fenced `modelica` block renders a live diagram
  and simulates when the note opens.
- **Worked examples.** 27 models across electrical, mechanical, fluid, thermal,
  aerospace and discrete domains, each with a derivation, the live model, and a
  table comparing an independent calculation against the simulation.
- **A worked case for learning.** `showcase/01-learning-with-a-simulator.md`
  demonstrates using the plugin to learn a new subject, worked through with two
  aerospace models.

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
npm test               # 188 tests, including a numerical audit of every example
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

## Beta status

Experimental, and it wants more testing. Specifically:

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

`examples/vault/` is an Obsidian vault you can open directly: the 27 worked
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

Three expectations were themselves wrong when first written, and were corrected
only after tracing the discrepancy to the expectation rather than the simulation.
Those corrections are recorded in `test/audit.test.mjs`.

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
  modelica/            parser, serializer, library index, examples
  render/              canvas drawing of Modelica graphical primitives
  view/                schematic editor, studio view, plots, inline blocks
  omc/                 OpenModelica process, build cache, result reading
test/                  unit and integration tests, and the numerical audit
showcase/              generator for the example notes (math, explanations)
examples/vault/        the test vault, with the generated notes
docs/                  design notes
research/              background research kept from development
scripts/               bundle checks
```

## License

MIT. See [`LICENSE`](LICENSE).

Neither Modelica nor OpenModelica is bundled. OpenModelica is installed
separately and is subject to its own licence.
