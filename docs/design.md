# Design notes

The long-form reasoning behind the implementation, kept from development.

## Why it is built this way

Everything here follows from one measurement: **translation dominates the cost of
an edit, and simulation is nearly free.**

Re-measured on the development machine (Ryzen 5 2600X, 12 threads, OpenModelica
1.27.0, Modelica 4.1.0) for a 4-component MSL circuit:

| Stage | Measured |
|---|---|
| Parse the Modelica Standard Library | 2.4 s cold, 0.3–0.5 s from cache |
| Compile a model (frontend → backend → C → link) | ~1.5 s with `-n=8` |
| The same compile with `-n=1` | ~3.9 s |
| Run the compiled model with changed parameters | ~30 ms |

The absolute figures have moved since the original measurement (`~1.9 s` with
`-n=8`, `~4.6 s` without, `~970 ms` library load) because both the build cache and
the library index have changed since. **What has not moved is the ratio**, which is
what the design rests on: parallel codegen is worth roughly 2.5–2.6×, and a
parameter change is three orders of magnitude cheaper than a rebuild.

So the plugin is built to **never recompile when only a parameter value changed**:

- Parameters are sent to the compiled model with OpenModelica's `-override`, so
  moving a value costs ~30 ms instead of ~1.5 s.
- A structural fingerprint of the model decides whether a rebuild is needed;
  identical source costs 0 ms.
- `-n` is always passed explicitly, because OpenModelica's default of 1 is
  ~2.5× slower than necessary and nothing in the UI would reveal that.
- The library index is written to a 28 MB cache, so the 2.4 s parse is paid once
  per library version rather than on every launch.

The current figures live in the [README](performance.md), measured with
the same method — run the thing and write down what happened.

## Install

1. Install OpenModelica (the plugin does not bundle it — Obsidian distributes
   only `manifest.json`, `main.js` and `styles.css`, so a native toolchain
   cannot ship inside a plugin):

   | Platform | Command |
   |---|---|
   | Arch / CachyOS | `yay -S openmodelica-bin` |
   | Debian / Ubuntu | see <https://openmodelica.org/download/download-linux> |
   | Fedora | `sudo dnf install openmodelica` |
   | macOS | <https://openmodelica.org/download/download-mac> |
   | Windows | <https://openmodelica.org/download/download-windows> |

2. Copy `main.js`, `manifest.json` and `styles.css` into
   `<vault>/.obsidian/plugins/modelica-studio/` and enable the plugin.

3. **If Obsidian is a Flatpak, the plugin cannot use a host OpenModelica.**
   This is a hard limitation, not a configuration problem: the host compiler
   links against the host's C library, while the Flatpak supplies its own, so
   the dynamic loader refuses to start it (`undefined symbol:
   __pointer_chk_guard, version GLIBC_PRIVATE`). Granting
   `--filesystem=host` makes the binary *visible* — under `/run/host` — but it
   still cannot run.

   Use a non-sandboxed Obsidian instead (the AppImage, a distribution package,
   or the `.deb`/`.rpm` from obsidian.md). The plugin detects this exact
   situation and explains it rather than reporting a bare "not found".

## Use

- **Open** via the ribbon icon or the command *Open Modelica Studio*.
- **Drag** components from the palette onto the canvas, or double-click to drop
  one in the centre.
- **Wire** by dragging from a connector pin. Modelica `connect()` is
  *acausal* — there is no input/output direction to obey, and loops are legal.
  Clicking anywhere on a component's symbol selects it; pins are grabbed only
  in a small radius right at the pin, so selecting never turns into an
  accidental wire.
- **Resize** a selected component with the eight handles around it. The
  opposite corner stays fixed, and sizes snap to the grid.
- **Load an example** from the toolbar's *Examples* button; one is also loaded
  automatically when the canvas is empty, so Simulate works immediately. Thirteen
  are included, grouped by physical domain in the picker:

  | Domain | Examples |
  |---|---|
  | Electrical | RC step, series RLC ringing, half-wave rectifier, sine drive into an RL load, step-down chopper, battery discharge, DC machine |
  | Mechanical | mass-spring-damper, torque step on a rotational spring-damper, two coupled masses, double pendulum |
  | Fluid | rising mass flow through a pipe, gravity drain from a tank, pumped loop with an orifice |
  | Thermal | body cooling through a conductor, two bodies equalising, heated mass losing heat to ambient |
  | State machines | a two-state machine alternating on timers |

  Each example names the variables it plots, so pressing Simulate shows two
  clearly changing traces rather than whatever the library happened to declare
  first.

  The palette is a **package tree**, as in OMEdit: expand a package to reveal its
  sub-packages and components. Every package the installed library provides is
  offered — 13 for this build of MSL — and branches are built when first opened,
  so the palette draws in well under a second. Typing in the search box searches
  the whole library rather than the visible branch, so a component is always
  reachable however deep it sits. *Palette packages* in settings restricts the
  list if you prefer it shorter.

  Each is checked to compile, simulate, and produce at least one variable that
  actually varies — a model can compile and run while sitting at a steady state,
  which plots as a flat line and reads as a failure.
- **Rotate** with `R` (`Shift+R` for the other way), **delete** with
  `Delete`, **select** with click / `Ctrl+click`, `Ctrl+A` for all.
- **Pan** with middle-drag or `Shift`+drag; **zoom** with the wheel; `Ctrl+0`
  fits the diagram.
- **Drag the divider** between the canvas and the right panel to resize it;
  double-click it to restore the default. *Expand* in the results panel gives
  the plot the whole column.
- **Simulate** with the Simulate button. Edit a parameter and the change is
  applied through the fast path.
- **Save** writes a `.mo` file into the vault; **Load model from active note**
  reads one back.

The Modelica source preview at the bottom is the authoritative representation —
what you see there is exactly what gets compiled and saved.

### Themes

The diagram and the plot are drawn with the 2D canvas API, which cannot read CSS
variables, so their palettes are supplied from `src/render/theme.ts` and resolved
from Obsidian's `theme-dark` marker. Switching theme redraws immediately.

MSL states most of its colours explicitly, and they are **semantic rather than
decorative** — blue outlines electrical and block diagrams, green mechanical, red
thermal. On the light theme every stated colour is drawn exactly as written.

On the dark theme a stated colour that would be illegible is lightened *along its
own hue* until it reaches roughly 3:1 against the canvas, so a navy block outline
reads without turning the diagram monochrome. Modelica's two implicit
conventions are handled separately: an unstated or black stroke means "ink" and
becomes the theme's text colour, while a white fill means "no fill" and becomes
the canvas surface. Dark neutrals are treated as shading and left alone, since
lightening them would make the shading brighter than the symbol it shades.

### Diagrams embedded in notes

A fenced block renders an editable diagram in place, with a Simulate button and
an inline plot:

````
```modelica
model Electrical "RC step response"
  ...
end Electrical;
```
````

Type the fence with nothing in it and a starter model is inserted. The block's
text **is** the document: dragging a component or rewiring rewrites the block, so
the diagram is stored as ordinary Modelica that can be diffed, copied and
committed, and the same editor and serializer serve both the note and the main
view.

The diagram is always visible; the plot sits beneath it and is hidden until
there is something to show. Options go on the info line:

| Fence | Effect |
|---|---|
| ` ```modelica ` | diagram, plot on demand |
| ` ```modelica result ` | diagram with the plot already open |
| ` ```modelica height=400 ` | canvas height, 120–2000 (default 320) |
| ` ```modelica auto ` | simulate as soon as the note opens |

`Show plot` / `Hide plot` in the block's toolbar toggles the traces without
disturbing the diagram.

Several blocks in one note are independent. Edits are written back through the
block's own line range, so a note with many diagrams is safe.

### Calculations in notes

A second fence solves an equation instead of drawing one:

````
```modelica-solve
//@ solve x
sqrt(x) + x^2 - 56 = 67
```
````

The block holds a **relationship**, not a number, and the answer is recomputed
when the note opens — which is the point of putting a calculation in a note
rather than typing its result into the prose, where it is wrong as soon as the
model changes.

There is no expression evaluator behind this and there should not be one.
OpenModelica must find values for every variable satisfying every equation
*before* it can take a step, and for a model with no states that initialisation
**is** the answer: asking for `stopTime = 0` turns the simulator into a solver.
Everything else follows from that one fact — no root-finding code, no algebra to
isolate the unknown, and a system of equations solved as a system.

The reading is the part that is ours, in `src/modelica/solve.ts`: the block is a
dialect smaller than a model (no class wrapper, no `equation` keyword, no
declaration for the unknown), and the module generates the class that makes it
legal Modelica. Two rules decide whether it works, and both are about not
misreading the text:

- **A statement with no `=` at depth zero is a declaration.** That is what keeps
  a `Modelica.Units.SI.Resistance R` declaration out of the equation list, and
  depth is what keeps `Real x(start = 1)` out of it too.
- **An identifier that is dotted or called is not an unknown.** `Modelica.Math.
  sin(1.0)` is one qualified function, not three symbols of which two are
  undefined.

Every undefined symbol becomes a variable, so several equations with several
unknowns work; `//@ solve x` selects which of them is reported. The starting
value is printed under the answer because it is not neutral — a solver returns
the root nearest where it began, and `x^2 = 2` has two right answers.

A block never writes to the note. The text is the question and the panel is the
answer, so there is no write-back path, no editor to mount and no possibility of
the loop the diagram embeds have to guard against.

### When selection or wires look wrong

The hardest faults in this editor have been **coordinate mismatches**: the
diagram drawn in one place and the region that answers a click computed in
another. The symptoms are easy to describe but hard to act on — *"I have to
click to the left of the shape"*, *"selection is offset, and worse further
right"*, *"the wires don't reach the components"* — and they look identical
whether the fault is in the drawing, the hit testing, the canvas size or the
zoom.

Settings → Modelica Studio → **Show coordinate diagnostics in the editor** turns
on an overlay that makes the disagreement visible:

| Overlay | Meaning |
|---|---|
| Orange dashed box | the region that **responds to a click** |
| Green solid box | the box the symbol is **drawn** in |
| Cyan dot + callout | each component's centre, with its extent |
| Red cross | where the last click **was interpreted** |
| Top-left readout | live viewport, canvas size and device pixel ratio |

If the orange box does not sit on the symbol, the clickable region and the
picture disagree, and the callout prints both positions in device pixels.

The same mode adds a **Geometry** button to the toolbar. It reports, as text:
the canvas and host rectangles, the device pixel ratio, the window size, the
viewport, and per component the drawn-versus-clickable centre in canvas, client
and device coordinates. That text is what to include in a bug report — it
identifies the failing layer without needing a screenshot.

Both are off by default and add nothing to the normal drawing path when
disabled.

## Architecture

```
src/
  modelica/
    lexer.ts        Modelica tokenizer (comments, strings, nesting)
    parser.ts       Recursive-descent parser -> diagram model + annotations
    serializer.ts   Diagram model -> valid Modelica text
    library.ts      MSL indexing, extends-chain resolution, palette
    types.ts        Diagram/annotation types mirroring MLS §18.6
  omc/
    locate.ts       OpenModelica discovery, version checks, sandbox detection
    backend.ts      SimulationBackend interface + spawned OpenModelica backend
  render/
    canvas.ts       Canvas2D renderer, one routine per Modelica primitive
  view/
    editor.ts       Interaction: pan/zoom/drag/wire/select
    plot.ts         Simulation result plotting
    studio-view.ts  Obsidian ItemView tying it together
  main.ts           Plugin entry point, commands, settings, persistence
  settings.ts       Settings tab
```

### Notes on correctness

These are the details that are easy to get wrong and expensive to debug; each
is implemented deliberately and covered by tests.

- **Transformation order** is extent (scale/flip) → rotation → origin
  (translate), per MLS §18.6.2. Rotation is about `{0,0}` in the local system,
  *not* the extent centre — the wording changed in Modelica 3.6, and following
  the older text misplaces every rotated component.
- **There are exactly six graphic primitives**: `Line`, `Polygon`,
  `Rectangle`, `Ellipse`, `Text`, `Bitmap`. `Arrow` is an *enumeration* (a
  parameter of `Line`), not a primitive; `Line` has `thickness`, while
  `lineThickness` belongs to filled shapes only.
- **Ports are inherited.** `Modelica.Electrical.Analog.Basic.Resistor` declares
  neither its pins nor its heat port — they arrive via `extends OnePort` and
  `extends ConditionalHeatPort`. Port and parameter resolution walks the
  `extends` chain, carrying each declaration's package so relative type names
  such as `PositivePin` resolve correctly.
- **Pin positions come from the connector's own `Placement`**, so wires meet
  pins exactly even on rotated and mirrored instances.
- **Programmatic graphics are expression-driven.** MSL uses
  `Line(visible=useHeatPort, ...)` and `Text(textString="R=%R")`. `%` macro
  substitution is implemented; unresolved macros stay visible rather than
  silently vanishing.

## Development

```
npm install
npm run build      # typecheck + production bundle
npm test           # 29 tests, including against real MSL and real OpenModelica
npm run check:bundle
npm run dev        # watch mode
```

`npm test` requires OpenModelica for the simulation tests; they skip
automatically when it is absent. The parser tests run against the real
Modelica Standard Library and assert that **all 2,552 classes** in it parse
without error.

`check:bundle` is a release gate, not a linter. Obsidian's installer fetches
exactly three files, so the check fails the build if the bundle contains a
relative `require()`, references a `.wasm`/`.node`/`.so` asset, carries an
inline sourcemap, or exceeds the size Obsidian Sync tolerates.

## Performance notes

### Why a custom canvas rather than a node-editor library

React Flow, AntV X6 and LogicFlow were all evaluated, and React Flow was
prototyped end-to-end and run inside Obsidian to compare it fairly (same model,
same pin positions, both panes live side by side). It rendered correctly and its
interaction model is solid — visible handles, box-select and undo come for free.

It was not adopted, for two measured reasons:

- **Bundle:** +288 KB (111 KB → 399 KB) together with React. This turned out to
  be a weak argument — measured, it costs **7.8 ms** of parse/compile at plugin
  load, once per session, against a ~1500 ms model compile.
- **Geometry, which is the real reason.** Modelica positions components by
  `Placement(transformation(extent=…))` in a canonical −100…100 space, and pins
  are derived from each connector's own `Placement`. Reproducing that faithfully
  in React Flow required custom `Handle` positioning and a coordinate adapter
  anyway, so the work would move rather than disappear — while replacing the
  interaction layer that is covered by 33 tests.

The canvas also mirrors how OMEdit renders diagrams: Qt `QGraphicsView` +
`QPainter`, one routine per Modelica primitive, no OpenGL.

The renderer is a single `<canvas>`, not hundreds of DOM/SVG nodes. This
mirrors OMEdit, which uses Qt's `QGraphicsView` + `QPainter` with one class per
Modelica primitive, and it means rendering cost does not scale with component
count the way per-node DOM does. Components below a few pixels are drawn as
flat chips (level of detail), and wires are drawn beneath components.

The bundle is ~87 KB, which matters because every user re-downloads `main.js`
on each update.

### Not enabled: in-process simulation

Prototyped and measured: linking the generated model as a shared library and
driving it over FFI makes re-simulation **~10× faster** (1.8–6.7 ms vs ~20 ms,
and parameter sweeps become essentially free). It is not shipped because
OpenModelica's Boehm garbage collector spawns marker threads that segfault
inside Electron's process.

The `SimulationBackend` interface exists so this can be enabled later without
touching the UI; the backend selector already reports it as unavailable with
the reason.

## Known limitations

- **Desktop only** (`isDesktopOnly: true`). The plugin spawns a compiler and
  uses Node filesystem APIs, neither of which exists on mobile.
- **Sandboxed Obsidian (Flatpak/Snap) cannot drive a host OpenModelica**, for
  the C-library reason above. Use the AppImage or a native package.
- **Structural edits cost ~1.5 s.** Adding or removing a component requires a real
  recompile; that is inherent to how OpenModelica works, and it is where the
  parallel-codegen setting earns its keep. Only an in-process path would change
  it.
- **An array-valued connector is shown as a single pin.** MSL declares fluid
  ports as `Interfaces.FluidPorts_b ports[nPorts]`; the editor places one pin
  rather than one per element, and cannot change `nPorts` in the inspector. A
  fluid source is therefore wired to `ports[1]`, which is what the shipped fluid
  examples do. Scalar-port components (pipes, fittings, sensors) are unaffected.
- **`conditional` connectors are always drawn.** A connector declared
  `if use_p_in` exists only when that parameter is true, but the pin is shown
  regardless, so a `Boundary_pT` displays four pins that may be inactive. Wiring
  one is harmless when its condition holds and rejected by the compiler when it
  does not.
- **Only the six graphical primitives are modelled.** Line, Polygon, Rectangle,
  Ellipse, Text and Bitmap, per MLS §18.6.5, which is the complete set — but
  `Bitmap` icons are outlined rather than loaded, since `modelica://` resources
  are not resolved.
- **A parameter used in a structural position still forces a rebuild.**
  Parameters appearing in `if` conditions, array dimensions or `connect`
  conditions are structural in Modelica. The plugin only treats literal values
  as runtime-overridable; anything else is left to the compiler.
- **Bitmap icons are not yet loaded** from `modelica://` URIs; the layout is
  outlined so it stays readable.
- **The coordinate diagnostics describe device pixels.** They are accurate, but
  the numbers are only meaningful against the canvas they came from; on a
  multi-monitor setup with different scale factors, re-run the report after
  moving the window.
- Impure/inverse function annotations and vendor-specific annotations are
  parsed but not re-emitted, so saving a model will not preserve annotations
  the editor does not model. Prefer the source view for such files.

## Licence

MIT.
