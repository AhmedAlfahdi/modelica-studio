# High-Performance Node/Block Editor Libraries for a Modelica Diagram Editor in Obsidian

**Research date:** 2026-09-13 · **Target:** Obsidian plugin (Electron/Chromium), Modelica-style *acausal* physical system modeling
**Scope:** rendering tech, licensing, maintenance, TypeScript, bundle size, scale performance, custom domain node rendering, Obsidian Canvas internals, Modelica annotation correctness

> **Method note.** Every number in the "measured" tables was produced in this session — npm registry metadata pulled directly, package tarballs inspected, bundles built with esbuild 0.28.2 (`--bundle --minify --format=esm --target=es2020`, then `gzip -9`), and scale benchmarks run in real headless Chrome 152 via the DevTools Protocol. Claims I could not verify are explicitly flagged **[UNVERIFIED]**. Third-party/secondary claims are marked with their source.

---

## 0. Executive Summary

### The four findings that decide this project

**1. Obsidian's own Canvas cannot be the editor surface.** Its published type definitions (`canvas.d.ts`) are a *file-format schema only* — there is no runtime API. It has **no port model** (edges connect *node sides*: top/right/bottom/left) and **no custom node types** (only `file`, `text`, `link`, `group`). The word "canvas" appears **zero times** in Obsidian's 8,482-line main `obsidian.d.ts`. Community plugins reach in via `app.workspace.activeLeaf.view.canvas` typed as **`any`**. Canvas is at best a *launcher* for a custom view; it cannot host typed Modelica connectors. (§5)

**2. The performance question has a single decisive answer: viewport culling.** I measured React Flow in real Chrome:

| Nodes | Culling OFF — per-frame cost | Culling ON — per-frame cost |
|---|---|---|
| 1,000 | 5.1 ms | 1.3 ms |
| 2,000 | 10.1 ms | 2.6 ms |
| 4,000 | **20.6 ms (~30 fps)** | **2.4 ms (60 fps)** |

Without culling, cost is **linear at ~5 ms per 1,000 nodes** and collapses to ~30 fps at 4,000 nodes. With `onlyRenderVisibleElements`, the DOM node count stays **constant at 1,455** and the frame cost stays **flat at ~2 ms regardless of graph size — 60 fps at 4,000 nodes**. Any DOM/SVG library is viable *if and only if* it culls. **But culling alone is not enough:** zoomed out so the whole model is visible, the same library drops to **~10 fps at 4,000 nodes** (§7.2b), so **zoom-keyed LOD is mandatory**.

**3. Licensing eliminates the two most tempting shortcuts.** `rete-scopes-plugin` / `rete-structures` are **CC-BY-NC-SA-4.0 (non-commercial)** — subgraph nesting is unusable commercially. **tldraw is not MIT**: its license forbids production use without a key, *"after five seconds, stops rendering the editor"*, and enforces allowed hostnames — incompatible with a distributed Electron plugin. GoJS ($3,995+) and JointJS+ are also closed. Separately, **LiteGraph is now archived/deprecated** and its one-wire-per-input model contradicts Modelica connectors. (§3, §4)

**4. Modelica correctness has a spec-version trap that will silently misplace components.** `Transformation` rotation semantics **changed in MLS 3.6**: rotation moved from *about the `origin` attribute* (3.5) to *about `{0,0}`*, with operation order `extent → rotation → origin`. An editor implementing the 3.5 prose literally will misplace every rotated component — the OpenModelica bug #3333 *"Rotating a component drags it in a far position"* is the real-world symptom. Also: `Line` uses **`thickness`** (not `lineThickness`), `Arrow` is an enum not a primitive, and `Evaluate` has no `breakpoints`. (§1.3)

### Recommendation ranking

| Rank | Choice | Verdict |
|---|---|---|
| **1** | **Custom Canvas2D/WebGL renderer** (model layer separate from render layer) | **Best fit.** Only option that gives both the ~10k-node ceiling and exact Modelica annotation fidelity. Highest build cost. Mirrors OMEdit's own architecture. |
| **2** | **React Flow v12 + `onlyRenderVisibleElements`** | **Best library option.** MIT, actively released (12.11.6, 2026-09-01), measured 60 fps @ 4,000 nodes *with culling*, `ConnectionMode.Loose` supports the bidirectional ports acausal modeling needs. ~105 KB gzip incl. React. |
| **3** | **AntV X6 v3** | MIT, very active (3.1.8, 2026-08-11), SVG+HTML nodes, `virtual:true` culling, TS-native, all editor plugins now in-package. Best non-React alternative. |
| 4 | Konva.js / PixiJS + custom | Solid MIT Canvas2D/WebGL substrates (59 / 158 KB gzip) — but you build ports, edge gestures, hit-testing, LOD and dialogs yourself. |
| 5 | Vue Flow / Svelte Flow | Fine engines; only if already committed to that framework. |
| ⛔ | **LiteGraph.js** (was #3) | **Now rejected.** npm package **deprecated**, repo **archived**, **`MAX_NUMBER_OF_NODES = 1000` enforced by a thrown error**, and `inputs[i].link` is a **scalar** (single-link inputs, explicit self-connection rejection). Cannot represent N-ary acausal connectors *or* thousands of nodes. §4.3 |
| ⛔ | **Blockly, Drawflow, Cytoscape, tldraw, GoJS, JointJS core, Butterfly, Rete** | **Rejected** — see §4 for the specific reason each fails. |

**Recommended architecture:** Modelica semantic model ⟷ renderer, with the annotation layer as the single source of truth. Use React Flow *or* a custom Canvas2D renderer for the diagram, but keep the Modelica AST/annotation model entirely outside the graph library, because `connect()` is an **equation**, not an edge (§6).

---

## 1. Hard Constraints

### 1.1 Obsidian/Electron platform constraints

| Constraint | Detail |
|---|---|
| Runtime | Electron/Chromium — full modern web platform, no browser-compat compromises |
| Bundle | **Obsidian Sync limit ~5 MB** for a plugin ([obsidian-copilot PR #3008](https://github.com/logancyang/obsidian-copilot/pull/3008)); a 599 KB gzip library (tldraw) is a third of that |
| Framework | Not provided — plugin bundles its own React/Vue/Svelte. React+ReactDOM alone = **45.3 KB gzip** (measured) |
| Styling | Plugin must namespace CSS; global CSS resets are hazardous |

### 1.2 Modelica semantic constraints (the part most library comparisons miss)

These are verified against the [Modelica 3.6 Language Specification](https://specification.modelica.org/maint/3.6/) (chapter 18 §18.6, chapter 9) and the [Modelica Standard Library](https://github.com/modelica/ModelicaStandardLibrary) source.

**`connect()` is an equation, not an edge.** Spec §9.2 defines that for each connection set:
- non-flow (potential/across) variables: `a₁ = a₂ = … = aₙ` (shared potential)
- flow variables: `z₁ + z₂ + (−z₃) + … + zₙ = 𝟎` (**zero-sum conservation**), sign `+1` inside / `−1` outside connectors
- an unconnected flow variable is implicitly set to zero

Spec §9: *"Connectors and connect-equations are designed so that different components can be connected graphically with well-defined semantics. **However, the graphical part is optional** and found in chapter 18."*

> **Consequence:** there is no "source" and "target". Direction of computation is derived later by the tool's symbolic causalization (BLT partitioning, index reduction). Any engine that assumes one-way dataflow (Rete's dataflow preset, Cytoscape's directed edges, Simulink-style blocks) is semantically wrong for the physics. A graph library used here is a *drawing and gesture* layer only.

**Connections DO carry graphical annotations.** Verified in MSL `Modelica/Mechanics/Rotational/Examples/First.mo`:

```modelica
connect(inertia1.flange_b, idealGear.flange_a)
    annotation (Line(points={{-22,0},{-8,0}}));
connect(damper.flange_a, inertia2.flange_b)
    annotation (Line(points={{46,-14},{46,0},{38,0}}));   // multi-point routing
connect(sine.y, torque.tau)
    annotation (Line(points={{-81.2,0},{-69.6,0}}, color={0,0,127}));  // signal = blue
```

So a correct editor must persist **wire waypoints** and **per-connection colour**, and read them back. Spec §18.6.4: *"A connection is specified with an annotation containing a Line primitive and optionally a Text primitive."* The optional `Text` uses `%first` / `%second` for the connected connector names and an `index` referencing a point on the `Line`.

**Graphics are expression-evaluated, not static.** From the real MSL `Resistor.mo`:

```modelica
Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
    Rectangle(extent={{-70,30},{70,-30}}, lineColor={0,0,255},
              fillColor={255,255,255}, fillPattern=FillPattern.Solid),
    Line(points={{-90,0},{-70,0}}, color={0,0,255}),
    Line(points={{70,0},{90,0}}, color={0,0,255}),
    Text(extent={{-150,-40},{150,-80}}, textString="R=%R"),
    Line(visible=useHeatPort, points={{0,-100},{0,-30}},
         color={127,0,0}, pattern=LinePattern.Dot),
    Text(extent={{-150,90},{150,50}}, textString="%name", textColor={0,0,255})}));
```

Two things matter: `visible=useHeatPort` is a **boolean expression over the component's parameters** — the editor must evaluate it to decide what to draw; and `textString="R=%R"` requires **`%`-macro substitution** (§18.6.5.5: `%%`, `%name`, `%class`, `%par`, `%{par}`, with `displayUnit` formatting).

> Note: MSL draws a resistor as an **IEC rectangle**, not a zigzag. Domain-symbol fidelity means implementing the spec's primitive set faithfully, not drawing "nice" icons.

### 1.3 The Modelica annotation surface a web editor must implement

| Item | Spec § | Notes |
|---|---|---|
| `coordinateSystem(extent, preserveAspectRatio, initialScale=0.1, grid)` | 18.6.1.1 | Default extent `{{-100,-100},{100,100}}` |
| `DrawingUnit = Real(unit="mm")` | 18.6.1 | Natural (printer) size semantics |
| `GraphicItem(visible=true, origin={0,0}, rotation=0)` | 18.6.1 | Rotation CCW about `origin` |
| `Line(points, color, pattern, thickness=0.25, arrow[2], arrowSize=3, smooth)` | 18.6.5.1 | `Smooth.Bezier` = quadratic spline through midpoints (algorithm fully specified) |
| `Polygon(points, smooth)` + FilledShape | 18.6.5.2 | Auto-closed |
| `Rectangle(extent, radius=0, borderPattern)` + FilledShape | 18.6.5.3 | `radius` = rounded corners |
| `Ellipse(extent, startAngle, endAngle, closure)` + FilledShape | 18.6.5.4 | `EllipseClosure(None,Chord,Radial)` |
| `Text(extent, textString, fontSize=0, fontName, textStyle, textColor, horizontalAlignment)` | 18.6.5.5 | `fontSize=0` ⇒ scale to extent |
| `Bitmap(extent, fileName, imageSource)` | 18.6.5.6 | `imageSource` = inline base64; `x2<x1` flips horizontally, `y2<y1` vertically; order **scaling → flipping → rotation**; PNG/BMP/JPEG/SVG |
| `FilledShape(lineColor, fillColor, pattern, fillPattern, lineThickness=0.25)` | 18.6.1.2 | Border is half-inside/half-outside the extent |
| Enumerations | 18.6.1.2 | `LinePattern`, `FillPattern` (11 values incl. `HorizontalCylinder`/`Sphere` gradients), `BorderPattern`, `Smooth`, `EllipseClosure`, `Arrow(None,Open,Filled,Half)`, `TextStyle`, `TextAlignment` |
| `Placement(visible, transformation, iconVisible, iconTransformation)` | 18.6.2 | Applies to **components** |
| `Transformation(extent, rotation, origin)` | 18.6.2 | ⚠️ **SEMANTICS CHANGED IN MLS 3.6 — see the box below** |
| `IconMap` / `DiagramMap(extent, primitivesVisible)` | 18.6.3 | Controls inherited base-class rendering |
| `DynamicSelect(editValue, runtimeValue)` | 18.6.6 | The real name for animated graphics (**not** `dynamicDraw`) |
| `interaction = {OnMouseDownSetBoolean, OnMouseUpSetBoolean, OnMouseMoveXSetReal, OnMouseMoveYSetReal, OnMouseDownEditInteger/Real/String}` | 18.6.7 | Live simulation interaction handles |
| `Dialog(tab="General", group, enable, showStartAttribute, colorSelector, loadSelector, saveSelector, directorySelector, groupImage, connectorSizing)` + `Selector{filter,caption}` | §18.7 | Parameter dialog layout |
| `choices(...)` / `choicesAllMatching=true`; `checkBox=true` for Boolean | **§7.3.4** | Not in chapter 18 |
| `Evaluate` | §18.3 | **Symbolic processing** (use parameter value for pre-processing) — **not** diagram breakpoints |
| `preferredView`, `defaultComponentName`, `defaultComponentPrefixes`, `missingInnerMessage`, `obsolete`, `unassignedMessage` | 18.7 | Class-level UX annotations |

**Correction to a common misconception:** the prompt asked about `dynamicDraw` and `Evaluate`/`breakpoints`. The spec's mechanism for animated graphics is **`DynamicSelect`** (§18.6.6); `Evaluate` is a *symbolic-processing* hint (§18.3); and the string **`breakpoints` does not occur anywhere in the Modelica spec** (searched across MLS 2.2/3.0/3.1/3.2/3.3/3.6/3.7-dev, the MSL, and OMEdit). Treat "interactive breakpoints" as a tool-specific extension, not a standard. Also note the standard spells the dialog annotation `Dialog`, and `choicesAllMatching` lives in §7.3.4, not chapter 18.

**More field-name traps (each would produce a subtly wrong editor):**

| Trap | Correct fact |
|---|---|
| `Line(lineThickness=…)` | ❌ `Line` has **`thickness`** (single). `lineThickness` exists only on **`FilledShape`** (Rectangle/Polygon/Ellipse). |
| `Line(startArrowSize=…, endArrowSize=…)` | ❌ `Line` has a single **`arrowSize`**, plus **`arrow[2]`** written `{Arrow.None, Arrow.None}`. |
| "`Arrow` is a graphic primitive" | ❌ It's an **enumeration** (`None, Open, Filled, Half`) used as a `Line` parameter. The primitive set is closed at **six**: Line, Polygon, Rectangle, Ellipse, Text, Bitmap. |
| "Resistor has an `Icon` and a `Diagram` layer" | ❌ `Modelica.Electrical.Analog.Basic.Resistor` has **only `Icon`** (no `Diagram`). Same for `Inertia`. |
| "`Flange` draws a circle + fork" | ❌ `Mechanics.Rotational.Interfaces.Flange` has **no icon at all** (documented: *"It has no icon definition and is only used by inheritance"*). The circles are on **`Flange_a`** (filled grey `{95,95,95}`) and **`Flange_b`** (hollow white) — deliberate visual asymmetry, no semantic difference. |
| Connection `Text` uses `textString` | ❌ Connection `Text` uses **`string`** (not `textString`), adds **`index`**, supports `%first`/`%second`, and defaults `horizontalAlignment` to `Automatic`. |
| `Evaluate(breakpoints=…)` | ❌ `Evaluate` is a `/*literal*/ constant Boolean` — no fields. |

> **⚠️ CRITICAL — `Transformation` semantics changed in Modelica 3.6.**
> - **MLS 3.5:** *"rotation of the extent around the point defined by the **`origin` attribute**"*, applied in the order **scaling → flipping → rotation**. Record field order: `origin, extent, rotation`.
> - **MLS 3.6 / 3.7:** *"rotation … counter-clockwise around the origin (**that is `{0,0}`, not the `origin` attribute**)"*, applied **extent → rotation → origin**. Record field order: `extent, rotation, origin`.
> - Boundary bisected to commit `cbef87de` (2022-12-18, Henrik Tidefelt), contained in tags **v3.6/v3.7 only**.
> - So `p_parent = origin + R(rotation) · S(extent) · p_child`.
> - **Consequence for your rotate UI:** a rotation edit *moves* the component unless you compensate `origin` — your "rotate" command must solve for a new `origin`. Corroborating real bug: OpenModelica trac **#3333** *"in OMEdit, Rotating a component drags it in a far position."*
> - Also: `extent` flips on reversed corners (`x2<x1` ⇒ horizontal mirror); flipping **both** axes ≡ 180° rotation, so **do not implement "mirror" as `rotation += 180`**.
>
> **You must decide which spec version to target and say so in your UI.** MSL sources in the wild were authored under both.

> **§-numbering trap:** "Graphical Objects" is **§18.6 in MLS 3.6** but **§18.9 in MLS 3.7**; GUI is §18.7 → §18.10. **Always cite the spec version with the section number.**

---

## 2. Big Comparison Table

Bundle sizes are **minified + gzip, measured in this session** (esbuild 0.28.2; React/Vue/Svelte marked external as peers). "Editor?" = has drag-to-connect + editing model built in.

| Library | Version (date) | License | Render tech | Measured gzip | Runtime deps | Editor? | Maintained | TS | Scale ceiling (evidence) |
|---|---|---|---|---|---|---|---|---|---|
| **React Flow** `@xyflow/react` | 12.11.6 (2026-09-01) | **MIT** | HTML `<div>` nodes + `<svg>` edges; pan/zoom = CSS transform | **59.5 KB** (editor incl. custom node + MiniMap/Controls/Background) | 3 direct / 13 transitive (zustand, classcat, @xyflow/system, d3-zoom/drag/selection/interpolate) | ✅ | ✅ Very active | ✅ TS-first | **60 fps @ 4,000 nodes with culling**; ~30 fps unculled *(measured)* |
| React Flow v11 `reactflow` | 11.11.4 (2024-06-20) | MIT | same | 48.6 KB | 6 | ✅ | ❌ **EOL** | ✅ | superseded |
| **Svelte Flow** `@xyflow/svelte` | 1.6.6 (2026-09-01) | MIT | DOM+SVG | ~ (not measured) | 2 | ✅ | ✅ | ✅ | same engine as React Flow |
| **Vue Flow** `@vue-flow/core` | 1.48.2 (2026-01-28) | MIT | DOM+SVG | **50.8 KB** | 5 (d3-*) | ✅ | ⚠️ ~8 mo gap | ✅ | independent reimplementation |
| **Rete.js v2** core | 2.0.6 (**2025-06-30**) | MIT | HTML DOM + SVG paths | **5.9 KB** core | 1 | ✅ | ⚠️ **core frozen ~14 mo** | ✅ (≥4.7) | data model fine; rendering conceded bottleneck |
| Rete + area/connection/react | plugins 2026-07 / 2024-08 | MIT | DOM+SVG | **35.8 KB** (React) / **24.5 KB** (Vue) | 1–2 each | ✅ | ⚠️ mixed | ✅ | no published v2 benchmark |
| Rete `scopes-plugin`/`structures` | 2.1.1 / 2.0.3 | ⛔ **CC-BY-NC-SA-4.0** | — | — | — | subgraphs | — | ✅ | **non-commercial — blocker** |
| Rete `auto-arrange` | — | MIT | — | **442.6 KB** (pulls elkjs) | elkjs | layout | — | ✅ | avoid |
| **LiteGraph.js** (jagenjo) | 0.7.18 (**2024-01-08**) | MIT | **Canvas 2D** | **123.2 KB** | 0 | ✅ | ⛔ **dormant ~2.8 yr**, 128 open issues | ⚠️ 1 hand-written `.d.ts` (signatures wrong) | ⛔ **hard cap 1,000 nodes (throws)**; 1 link per input; no self-connection |
| **LiteGraph** (Comfy-Org fork) | 0.17.2 (2025-08-06) | MIT | **Canvas 2D** | **87.0 KB** | 0 | ✅ | ⛔ **npm deprecated, repo ARCHIVED**, no successor | ✅ 90 `.d.ts` | cap raised to 10,000; ComfyUI: ~12–35 FPS @ 541 visible nodes |
| **Blockly** | 13.3.0 (2026-09-10) | Apache-2.0 | **SVG** (canvas only for `measureText`; 0 WebGL) | **177.7 KB** core / **202.0 KB** full | 0 | ❌ tree only | ✅ very active | ✅ | not a graph editor |
| **Drawflow** | 0.0.60 (2024-09-03) | MIT | HTML div + SVG | **9.2 KB** | 0 | ✅ | ❌ **stalled ~23 mo**, 272 open issues | ❌ no `.d.ts` | no benchmark exists |
| **JointJS** `@joint/core` | 4.3.3 (2026-09-04) | **MPL-2.0** | SVG (+HTML) | **134.5 KB** | **0** (Backbone removed in 4.0) | ⚠️ core only | ✅ | ✅ | key features are JointJS+ (paid) |
| `jointjs` (legacy) | 3.7.7 (2023-11-07) | MPL-2.0 | SVG | — | 5 (Backbone…) | ⚠️ | ❌ | ✅ | superseded |
| **GoJS** | 4.0.3 (2026-07-17) | ⛔ **Proprietary** | Canvas 2D (opt-in SVG) | — | 0 | ✅ | ✅ | ✅ 1.6 MB `.d.ts` | 123,456-node sample; **$3,995–$11,950** |
| **Cytoscape.js** | 3.34.3 (2026-09-07) | MIT | Canvas 2D + **WebGL renderer** | **141.5 KB** | 0 | ❌ **viz only** | ✅ | ✅ | 3.2k nodes 3→10 fps (WebGL) |
| **AntV X6** | 3.1.8 (2026-08-11) | **MIT** | **SVG** + HTML nodes; `virtual:true` culling | **172.2 KB** | 4 | ✅ | ✅ very active | ✅ native | official 1,000-node virtual example |
| AntV G6 | 5.1.1 (2026-05-08) | MIT | Canvas/WebGL | — | 11 | ❌ viz | ✅ | ✅ | visualisation, not editing |
| **LogicFlow** `@logicflow/core` | 2.2.5 (2026-07-30) | **Apache-2.0** | SVG + `foreignObject` + HTML overlay | **101.4 KB** | 8 (Preact, MobX 5, …) | ✅ | ✅ | ✅ | Chinese-first docs |
| **Butterfly** `butterfly-dag` | 5.1.0-beta.38 (2024-04-20) | MIT | Canvas + SVG | **207.4 KB** | 7 | ✅ | ❌ **abandoned**, 5.x never left beta | ⚠️ | — |
| **tldraw** | 5.4.2 (2026-09-10) | ⛔ **Proprietary**, key-enforced | Canvas 2D | **599.2 KB** | 16 (TipTap, Radix, idb…) | ❌ freeform canvas | ✅ | ✅ | 10k shapes w/ spatial culling; `maxShapesPerPage` 4000 |
| **Konva.js** | 10.5.0 (2026-09-08) | MIT | **Canvas 2D** scene graph | **59.2 KB** | 0 | ❌ toolkit | ✅ | ✅ | official perf benchmarks |
| **PixiJS** | 8.20.1 (2026-08-26) | MIT | **WebGL2 / WebGPU** | **158.0 KB** | 10 | ❌ renderer | ✅ | ✅ | very high sprite counts |
| **Fabric.js** | 7.4.0 (2026-05-18) | MIT | Canvas 2D object model | **87.8 KB** | 0 | ❌ object editor | ✅ | ✅ v6+ TS | thousands of objects |
| *(baseline)* React + ReactDOM | 18 | MIT | — | **45.3 KB** | — | — | — | — | — |

⛔ = hard blocker for a distributed open-source Obsidian plugin.

---

## 3. Licensing: the disqualifiers

This project ships to users, so licence compatibility is not negotiable. Verified from npm registry `license` fields and vendored `LICENSE` files.

| Library | Status | Evidence |
|---|---|---|
| **tldraw** | ⛔ **Disqualified** | `LICENSE.md` = "The tldraw license". *"Not to use the Software in Production Environments"* — defined to include "web applications, or where the software is used to provide functionality to end users, customers, or the public". Also *"Not to disable… License Key enforcement"* and *"Technical enforcement… detect deployment environments… ensure proper watermark display… collect and transmit usage data."* Docs: without a key the SDK *"after five seconds, stops rendering the editor."* Keys encode **allowed hostnames** → incompatible with a distributed Electron plugin. ([LICENSE.md](https://github.com/tldraw/tldraw/blob/main/LICENSE.md)) |
| **GoJS** | ⛔ **Disqualified** | `gojs@4.0.3` npm license = `SEE LICENSE IN license.html`. Header: *"DO NOT MODIFY THIS FILE. DO NOT DISTRIBUTE A MODIFIED COPY."* Pricing: **$3,995** (1 dev) / **$6,990** (≤3) / **$11,950** (≤20) ([nwoods.com/sales](https://nwoods.com/sales)). GitHub repo ships **obfuscated builds only** — even `go-debug.js`. |
| **Rete scopes/structures** | ⛔ **Blocker for that feature** | `rete-scopes-plugin@2.1.1`, `rete-structures@2.0.3` = **CC-BY-NC-SA-4.0**. Docs: *"Commercial use is currently not permitted due to the absence of a dual licensing model."* ([retejs.org/docs/licensing](https://retejs.org/docs/licensing)) — subgraph/scope nesting unusable commercially. Everything else in Rete is MIT. |
| **JointJS** | ⚠️ **Split** | `@joint/core@4.3.3` = **MPL-2.0** (file-level copyleft — usable, but modifications to MPL files must be published). **JointJS+ is commercial**, and it gates exactly what an editor needs: HTML shapes, Inspector/property panel, undo/redo, Stencil, minimap, inline text editing. |
| **React Flow / xyflow** | ✅ **MIT** | `Copyright (c) 2019-2025 webkid GmbH`. Note React Flow renders a small attribution badge by default and sells a "Remove Attribution" flow via Pro — **but since it is MIT you may remove it yourself**; no code is licence-gated. |
| **Blockly** | ✅ Apache-2.0 | ⚠️ **No longer Google** — graduated to the **Raspberry Pi Foundation** (2025-11-10), Google.org-funded. Permissive + patent grant; trademark terms restrict the "Blockly" mark. |
| **LogicFlow** | ✅ Apache-2.0 | didi. |
| **LiteGraph / Comfy-Org fork** | ✅ MIT — but ⛔ **deprecated/archived** (§4.3) | Both repos MIT; the *licence* is fine, the *maintenance* is not. |
| **Konva / PixiJS / Fabric / Cytoscape / X6 / Drawflow / Vue Flow / Svelte Flow** | ✅ MIT | Registry-verified. |

> **Drawflow "license controversy" is FALSE.** I re-verified via the agent's `git log --follow -- LICENSE`: a single commit `0931e4d "Add license"` (2020-04-28) added MIT, and the file has never been modified. All 60 npm versions carry `license: "MIT"`. The only event is a ~7-day unlicensed window before that commit. Do not repeat the myth.

---

## 4. Per-candidate verdicts

### 4.1 React Flow / `@xyflow/react` v12 — **recommended library option**

**Rendering (verified by reading shipped source, not docs prose).** `dist/esm/index.js`:
- `react-flow__viewport` is a **`<div>`** with `style={{ transform: toTransformString(...) }}` — pan/zoom is a compositor-friendly CSS transform.
- Node wrappers are `<div class="react-flow__node">` (8 refs); handles are `<div class="react-flow__handle">`.
- Edges live in `<svg>` (`react-flow__edges`), each edge a `<path>`, arrowheads via `<marker>`.

So it is a **hybrid DOM + SVG** renderer. There is **no official canvas-only mode**; a canvas feature request was closed, and canvas appears in docs only inside user-authored overlays. The only built-in canvas usage is the reflow-forced `<canvas>`… **not present** — the `measureText`-style canvas hack is Blockly, not React Flow.

**Dependencies — a correction:** React Flow v12 does **not** have zero runtime deps. It has 3 direct (`zustand`, `classcat`, `@xyflow/system`) and **13 transitive**, because `@xyflow/system` pulls `d3-drag`, `d3-zoom`, `d3-selection`, `d3-interpolate` plus `@types/d3-*`.

**Official performance docs — what they actually claim.** The page ([reactflow.dev/learn/advanced-use/performance](https://reactflow.dev/learn/advanced-use/performance)) makes **no node-count claim and publishes no benchmark**. Its advice is: memoize components and callbacks; do not read the whole `nodes` array in components (use selectors); collapse large node trees via `hidden`; and *"If you've optimized performance in every other way, and you are still finding performance issues with large numbers of nodes, complex CSS styles, particularly those involving animations, shadows, or gradients, can significantly impact performance."* The former `/learn/troubleshooting/performance` URL now 404s. xyflow's own official "Stress" example instantiates only **625 nodes** (25×25). An open issue, [#3883](https://github.com/xyflow/xyflow/issues/3883) (since Feb 2024), tracks improving `onlyRenderVisibleElements`. **Treat "1000+ nodes works fine" as unclaimed by the vendor** — my measurements below settle it.

**Acausal fit — better than expected.** `ConnectionMode.Loose` is documented as *"Connections can be made between any handles, regardless of type"*, and a handle works for both incoming and outgoing ("typeless handles"). `Handle` takes both `isConnectableStart` and `isConnectableEnd` (both default `true`). Edges still store `source`/`target`, so undirected semantics are **your modelling choice layered on top**, not a library limitation. A first-class bidirectional handle type is still an open feature request ([#3477](https://github.com/xyflow/xyflow/issues/3477)) **[status not re-verified]**.

**Custom node rendering.** A custom node is just a React component registered in `nodeTypes` — so an SVG resistor symbol, an animated rotating-machinery icon (CSS transform or `<canvas>` inside the node), or a live value readout are all trivial. Custom edges are React components returning SVG paths. **This is React Flow's biggest advantage**: arbitrary DOM/CSS/SVG per node with zero framework fighting.

**Caveat on the measurement:** viewport culling means that *zooming out to see the whole model* renders everything — i.e. the **unculled numbers apply when the whole diagram is visible**. Plan a LOD scheme (simplified glyphs at low zoom), which is exactly what Obsidian's own Canvas does (§5).

### 4.2 Rete.js v2 — architecturally elegant, commercially blocked, perf-unproven

- **Plugin architecture is genuinely good:** `rete` (data/editor core) is fully decoupled from `rete-area-plugin` (viewport/zoom/pan), `rete-connection-plugin` (drag gestures), and a choice of `rete-react/vue/svelte/angular/lit-plugin` renderers. Bundle is the smallest of any real editor: **5.9 KB gzip core, 35.8 KB gzip for core+area+connection+React**.
- **No canvas renderer exists.** `rete-canvas-plugin`, `rete-canvas`, `rete-pixi-plugin`, `rete-webgl-plugin` all **404 on npm** (I verified `rete-canvas-plugin` → HTTP 404 myself). Render plugins emit HTML DOM nodes + inline SVG connections. The only canvas usage is a **LOD GPU example** (Pixi for zoomed-out simplified nodes) whose **source is Patreon-gated**.
- **"Rete Pro" is a Patreon sponsorship, not a licence tier** — but 9 examples are paywalled, including **Undirected** (the undirected-graph reference) and **LOD / LOD GPU** (the 1000+ node techniques). The two hardest things for this project sit behind the paywall.
- **"Dataflow" ≠ acausal.** Rete's dataflow engine is target-driven **pull** evaluation ("the target node requests data from incoming nodes… left to right"). There is no notion of effort/flow pairs, constraint assembly, or algebraic loops. The *core* is direction-agnostic (`NodeEditor.addConnection` does no structural validation), so an undirected model is *permitted* with a custom preset + your own engine — but *provided* nowhere. `BidirectFlow` is a connection **gesture** preset, not bidirectional semantics.
- **Maintenance is split, and the stale parts are the ones you'd extend:** core `rete` frozen at **2025-06-30**, `rete-connection-plugin` at **2024-08-30** (~24 months), `rete-engine` at **2024-12-27** — while the renderers are current (2026-07-10).
- **Performance is unproven.** The repo has a data-model-only perf test (5,000 node adds). Issue [#628](https://github.com/retejs/rete/issues/628) (closed) reported that **>150 nodes with custom node components** caused loading problems while the default renderer was fine — the most concerning data point, since rich custom node visuals are a hard requirement here. **No reproducible v2 rendering benchmark exists → treat "1000+ rich DOM nodes" as UNVERIFIED.**
- **Name correction:** the author is **Vitaliy Stoliarov** (`Ni55aN`), not "Potapov".

**Verdict:** the cleanest architecture and the smallest bundle, but blocked on scope/subgraph licensing, absent canvas path, stale core, and unproven scale rendering.

### 4.3 LiteGraph.js — great drawing API, but the ecosystem is now dead **and the data model is wrong for acausal modelling**

> **This section changed the ranking.** Two findings below (archival, and one-link-per-input) move LiteGraph from "recommended #3" to **"do not adopt as a dependency."**

**⛔ The ecosystem is effectively dead as a standalone dependency** (three independent facts):
- `jagenjo/litegraph.js`: last commit and last npm release both **2024-01-08** (`litegraph.js@0.7.18`) — dormant ~2y8m, 8.1k stars, **128 open issues**, and **no deprecation notice** in its README (still positively advertised).
- `@comfyorg/litegraph`: npm package is **DEPRECATED** — *"Package no longer supported."* Last version 0.17.2 (2025-08-06).
- The Comfy-Org repo is **ARCHIVED**: *"⛔ ARCHIVED — Comfy-Org/litegraph.js has been merged into ComfyUI Frontend… no longer maintained."* It was vendored into `ComfyUI_frontend/src/lib/litegraph` (PR #4667, ADR-0001, 2025-08-05) and its README warns it is *"largely incompatible with the original."*
- **Licensing wrinkle if you vendor the live lineage:** ComfyUI itself is **GPL-3.0**, unlike LiteGraph's MIT.

**⛔ The data model cannot express acausal conservation-law terminals.** Verified in `build/litegraph.js` v0.7.18:
- `LGraphNode.prototype.connect(slot, target_node, target_slot)` is strictly **source-output → target-input**.
- `inputs[i].link` is a **scalar** — connecting a second link to an occupied input **silently evicts the first**; only outputs are arrays (fan-out). A Modelica connector is an *N-ary* terminal where `connect()` merges connection sets and sums flows; single-link inputs are structurally wrong.
- There is an explicit self-connection rejection: `//avoid loopback: if (target_node == this) return null;` — but physical systems are full of legitimate loops (a rotational loop, a feedback circuit).
- Working around this means forking `connect`/`disconnectInput` — i.e. maintaining your own LiteGraph.

**⛔ HARD CAP: `MAX_NUMBER_OF_NODES = 1000`, enforced by a *thrown error*.** In `litegraph.js` 0.7.18 the constant is 1,000 and `LGraph.add()` **throws** when exceeded — so the "thousands of nodes" requirement is *literally unmeetable* on the standalone package. The Comfy-Org fork raises it to 10,000 (which is why my 2,000/4,000-node benchmarks ran on the fork). Combined with the archival above, this alone disqualifies it for this project.

**📉 The largest LiteGraph deployment on earth is migrating away from it.** ComfyUI (133k stars) announced **Nodes 2.0** (Dec 2025): *"This update transitions our node system from **LiteGraph.js Canvas rendering** to a **Vue-based architecture**… **Canvas2D + Litegraph have taken us incredibly far, but they're hitting real limits.**"* Their stated reason is **developer velocity**, not frame rate: *"The previous Canvas rendering system had become a development bottleneck. Even small UI changes often required deep modifications and could take days."* ⚠️ **Do not over-read this as "Vue is faster"** — ComfyUI's own known-issues table still says *"Still optimizing toward Canvas-level performance"*, and Canvas remains a toggle. Concrete production perf data from ComfyUI_frontend issue [#3180](https://github.com/Comfy-Org/ComfyUI_frontend/issues/3180) (a **541-node** workflow): **all 541 nodes in view → ~12–35 FPS**; **30 nodes in view → ~25–70 FPS**. FPS degrades steeply with the number of *visible* nodes — exactly the zoomed-out whole-circuit overview case. LiteGraph's own README claims only *"hundreds of nodes per graph"*, and ComfyUI's own "large graph" test fixture is **245 nodes**.

**✅ The one thing it does best — custom drawing.** `onDrawForeground(ctx, this, this.canvas)` is invoked inside `drawNode()` right after `drawNodeShape(...)`, and `onDrawBackground(...)` similarly. You get a raw Canvas2D context in node-local space, so **drawing a resistor symbol is ~15 lines** — the easiest of any option here (verified in source: `this.onDrawForeground?.(ctx, this.visible_area)` / `node2.onDrawForeground?.(ctx, this, this.canvas)`). Canvas 2D confirmed (`getContext("2d")` plus a `CanvasRenderingContext2D.prototype.roundRect` polyfill); two stacked canvases (bg/fg) with dirty flags and a rAF loop. Custom widgets exist too (`SliderWidget`, `KnobWidget`, `ComboWidget`, `CurveEditor`).

**Bundle:** `@comfyorg/litegraph` **85.7 KB gzip** (I measured 87.0 KB); `litegraph.js` 0.7.18 **120.6 KB gzip** (I measured 123.2 KB). **TS:** the original ships a hand-written 1,499-line `litegraph.d.ts` over a 34,573-line UMD build — a façade, not compiler-verified; the well-typed rewrite is the archived one.

**Verdict: do not adopt.** Its drawing API is the best in this survey and the architectural lesson (immediate-mode Canvas2D ≈ OMEdit's `drawAnnotation(QPainter*)`) is valuable — but adopting it means depending on an archived package whose input model contradicts Modelica's N-ary, loop-tolerant connectors.

**Scale:** it *does* cull — `computeVisibleNodes()` builds `visible_nodes`, and `drawFrontCanvas` iterates only those. But it recomputes the visible set every frame in `O(total nodes)` and rebuilds a `Set` of visible ids, so cost still grows with graph size. Measured (below): 20.7 ms/frame at 4,000 nodes vs React Flow's 2.4 ms *culled*.

**Verdict:** the right choice if you commit to a pure-canvas, framework-free editor and want to hand-draw all domain symbols. Weaker ecosystem, weaker docs, and it measured slower than culled React Flow at equal node counts.

### 4.4 Blockly — **wrong data model for acausal modelling**

- **Fundamentally a statement/expression tree**, not a general graph: connections are `previous`/`next` (statement chains) and `input`/`output` (expression nesting). There is no arbitrary-graph or typed-bidirectional-port model, and cycles are not expressible.
- **Rendering is SVG** — verified: 5 `http://www.w3.org/2000/svg` refs, `createSvgElement`, three SVG renderers (`geras` default, `thrasos`, `zelos`). **Zero WebGL**. The only canvas is a hidden `blocklyComputeCanvas` used for `measureText` text metrics.
- **Bundle:** 177.7 KB gzip (`blockly/core`) / 202.0 KB gzip (full with blocks + messages). Heavy for what you get.
- **Not even DAG-capable — fan-out is impossible.** `Connection.targetConnection` is a **scalar** (`Connection | null`). Empirically verified on Blockly 13.3.0: connecting one output to a second input **moves the wire** — the first input's `targetBlock()` becomes `null`. **FANOUT_SUPPORTED = false.** Reuse requires duplicating blocks, which is why the language is built on variable-getter blocks.
- **Undirected is impossible by construction.** `ConnectionType` = `INPUT_VALUE=1, OUTPUT_VALUE=2, NEXT_STATEMENT=3, PREVIOUS_STATEMENT=4` with strict `OPPOSITE_TYPE` pairing. Measured: input→input = false, output→output = false, output→input = true. A block is structurally **either** a statement **or** a value, never both.
- **Cycles are accepted by the API and then silently destroy the file.** The descendant guard lives only in `doDragChecks`, but public `Connection.connect()` calls `canConnect(..., isDragging=false)` — so it is **skipped** programmatically. Measured: a real 2-cycle is accepted, after which `getTopBlocks().length === 0` and `serialization.workspaces.save()` **succeeds but serialises 0 blocks — silent total data loss**; rendered, it throws `DOMException: HierarchyRequestError`.
- **Graph support has been an open request since 2020-07-05** — issue [#10364 "Blockly and Nodes/Graphs"](https://github.com/google/blockly/issues/10364), still open, explicitly asking for Blender-style ports. Zero "cycle" hits across 235 docs files and 328 core `.ts` files.
- **License Apache-2.0**, and the best-maintained project in this survey (13.3.0, 2026-09-10; ~78 commits/month; 94+ languages). Note the governance change above.
- Parameter dialogs: Blockly has field editors and **mutators**, but they are code-generation-oriented, not a Modelica `Dialog(tab, group, …)` model. It does have zoom/pan and custom block rendering via renderer drawers — but drawing a resistor inside a Blockly block means fighting the block-shape SVG pipeline.

**Verdict: reject.** It models syntax, not physics. `connect()` is an equation between equal-status connectors; Blockly's plug-and-socket metaphor is inherently one-way and hierarchical.

### 4.5 The rest, briefly

| Library | Verdict |
|---|---|
| **AntV X6 v3** | **Best "batteries-included" MIT fallback.** Officially *"a graph editing engine based on HTML and SVG"* — SVG engine + `foreignObject` for HTML nodes (verified `createElementNS` in `lib/common/dom/elem.js`; canvas only for watermark backgrounds/image export). **All editor plugins merged into the main package in 3.0.0**: History, Selection, Transform, Scroller, Keyboard, Clipboard, Snapline, Dnd, MiniMap, Stencil, Export — all MIT now. `virtual: true` culling added in 3.0 with an official **1,000-node** example. ⚠️ Docs warn of *"incomplete node content display or flickering"* with `foreignObject` and advise avoiding `position:absolute/relative/transform/opacity` inside node HTML. Very active (3.1.8, 2026-08-11), TS-native. 167.1–172.2 KB gzip. **No published FPS benchmark.** |
| **LogicFlow** | Apache-2.0, active (2.2.5, 2026-07-30, 11,691★). ⚠️ Two corrections: **both nodes AND edges are SVG** (HTML is a separate overlay layer), and the API is **`lf.register({type, view, model})` / `batchRegister`** — there is no `registerNode`. Stack: **Preact + MobX 5**. English docs are **complete** (76 `.en.md` vs 73 `.zh.md`, zero CN-only pages); note `logicflow.site` is **dead**, current docs at `site.logic-flow.cn`. Neither core nor extension ships a property panel (`DndPanel` is a drag palette). 120.6–101.4 KB gzip. |
| **JointJS core** | MPL-2.0 (⚠️ `@joint/router-avoid` pulls **LGPL-2.1-or-later** `libavoid-js` — avoid that plugin). Now **zero dependencies** in v4.3.3 (Backbone/jQuery/Lodash removed in 4.0.0). But **the whole UI layer is JointJS+ (paid)**: HTML shapes, Stencil, Inspector, Halo, FreeTransform, PaperScroller, Navigator (minimap), CommandManager (undo/redo), Clipboard, Keyboard, TextEditor, Tooltip, Selection, BPMN/VSM shapes. I unpacked the tarball: there is **no `ui/` directory** and `src/shapes/` contains only `standard.mjs`. 134.5–144.3 KB gzip. |
| **Cytoscape.js** | **Not an editor.** A graph *visualisation* library — its official gesture list contains **no edge-creation gesture**, which is why `cytoscape-edgehandles` exists (npm 4.0.1, last published **2021-07-28**). It *does* ship an official **WebGL renderer** as a mode (`renderer: {name:'canvas', webgl:true}`, 3.31+; 57 `webgl` hits in the 3.34.3 dist). Official FPS (M1 MBP/Chrome): ~1,200 nodes/16k edges **20 → 100+ FPS**; ~3,200 nodes/68k edges **3 → 10 FPS**. MIT, 137.2–141.5 KB gzip. Works in Obsidian (Juggl uses it) but gives you no editing layer. |
| **Drawflow** | Tiny (8.6–9.2 KB gzip — by far the smallest), MIT, **HTML div nodes + SVG edges**, a true editor — but **stalled ~23 months**, **272 open issues**, and **ships no `.d.ts`** (use DefinitelyTyped `@types/drawflow@0.0.12`). No perf benchmark exists. Risky foundation. |
| **Butterfly** | ⚠️ **Correction: it is HTML DOM nodes + SVG edges, not Canvas** (Canvas2D appears in only 5 auxiliary files: selection box, minimap, snapline, grid). Docs are bilingual, not CN-only. But it is **abandoned**: newest publish `5.1.0-beta.40` (**2024-05-20**, under the `beta` tag — not `latest`), 5.x in beta since 2022, last commit on `master` **2023-08-04**, **zero GitHub Releases**, hosted docs/demo **404**, and **no TypeScript at all**. Avoid. |
| **Konva.js** | Excellent MIT Canvas2D scene graph, 58.1–59.2 KB gzip, good TS. ⚠️ Official limits: **"Usually 3-5 [layers] is max"**, **~41 MB per layer** at 1920×1080 retina. **No official fps benchmark** — and Konva **explicitly disclaims** the popular slaylines benchmark as stale (Konva 8.1.4 / PixiJS 6.1.3, Sept 2021). A **drawing toolkit**: you build ports, connection gestures, hit-testing, edge routing, dialogs and LOD yourself. Good substrate for the custom option. |
| **PixiJS** | MIT, WebGL2/WebGPU, 158–232 KB gzip. ⚠️ **v8 has NO Canvas2D fallback** — the official renderers table lists `CanvasRenderer` as **"Coming-soon"** (WebGL2 recommended, WebGPU experimental). Real perf numbers exist: **200,000 sprites / 1,000,000 particles at 60 fps** (ParticleContainer blog, MBP M3). Has hit-testing (`hitArea`/`eventMode`) and an opt-in DOM `<div>` accessibility overlay; **editable text is absent** — the official answer is `DOMContainer` + native `<input>`, marked **EXPERIMENTAL**. Overkill unless you need >50k primitives. |
| **Fabric.js** | MIT, Canvas2D object model, 87.8–92.3 KB gzip, v7 current (7.4.0, 2026-05-18), v6 was the TS rewrite. ⚠️ Not "WebGL-free": **`WebGLFilterBackend` uses WebGL for image filters**. **No official benchmark exists.** `@types/fabric` stopped at 5.3.11. Same "build the graph editor yourself" caveat as Konva. |
| **Vue Flow / Svelte Flow** | ⚠️ **Vue Flow is a port, not a shared codebase** — its README says *"heavily based on webkid's ReactFlow"*, and it shares nothing with `@xyflow/system` (it depends on `d3-zoom/drag/selection/interpolate` + `@vueuse/core`). Vue Flow is **Vue 3 only**; Svelte Flow is **Svelte only**. The blocker for an Obsidian plugin is the framework, not the licence. |
| **GoJS / tldraw** | ⛔ See §3. |

---

## 5. Obsidian Canvas internals — can a plugin use or extend it?

**Short answer: no for the editor surface; yes as a launcher.**

### 5.1 There is no public Canvas API

I downloaded and inspected `obsidian@1.13.1` directly:

- The package ships **`canvas.d.ts`**, and it is **purely a JSON schema** — 97 lines of `interface`/`type`, **no classes, no methods, no runtime API**.
- The main `obsidian.d.ts` is 8,482 lines with 299 exports, and a **case-insensitive search for "canvas" returns ZERO matches**. There is no `Canvas` class, no `CanvasView` type, no node-manipulation method.
- Obsidian's own changelog calls `canvas.d.ts` the **"Canvas spec"** and links it as a *document* — describing it as a format, not an API.

### 5.2 The format itself is too weak for Modelica

```ts
export type AllCanvasNodeData = CanvasFileData | CanvasTextData | CanvasLinkData | CanvasGroupData;
export type NodeSide = 'top' | 'right' | 'bottom' | 'left';
export type EdgeEnd = 'none' | 'arrow';

export interface CanvasEdgeData {
    id: string;
    fromNode: string;  fromSide?: NodeSide;  fromEnd?: EdgeEnd;
    toNode: string;    toSide?: NodeSide;    toEnd?: EdgeEnd;
    color?: CanvasColor;  label?: string;
}
```

Consequences for a Modelica editor:
1. **Edges attach to a node *side*, not to a port.** There is no port/anchor identity — so `connect(resistor.p, ground.p)` cannot be represented; you cannot tell which of several connectors on a block a wire means.
2. **Node types are a closed set** (`file`, `text`, `link`, `group`). No `type: 'modelica/Resistor'`, no custom renderers.
3. **No domain metadata** — no parameters, no annotation layer, no icon transformation.
4. **No bidirectional semantics** — `fromEnd`/`toEnd` are arrowheads, purely decorative.

### 5.3 How community plugins actually do it

From [`obsidian-resize-card-plugin`](https://github.com/jasperyzh/obsidian-resize-card-plugin) (a real Canvas-manipulating plugin), the access pattern is:

```ts
private getCanvas(): any | null {
  const activeLeaf = this.app.workspace.activeLeaf;
  if (!activeLeaf || !activeLeaf.view || !("canvas" in activeLeaf.view)) return null;
  return activeLeaf.view.canvas;      // <-- typed `any`
}
```

Note `any`, the `"canvas" in view` duck-typing, and defensive `canvas.selection instanceof Set` checks. This is **entirely undocumented internal API** reached through monkey-patching. The community [`obsidian-typings`](https://obsidian-typings.github.io/obsidian-typings/catalyst/api/obsidian/internals/internal-plugins/canvas/CanvasPlugin/) project reverse-engineers `CanvasPlugin` internals precisely because none of it is official. Building a product on this is fragile across Obsidian updates.

### 5.4 Canvas is DOM-based, with a level-of-detail system — and it has had real perf bugs

From the [obsidian-canvas-performance-patch](https://github.com/Qbject/obsidian-canvas-performance-patch) README (a plugin written to patch Obsidian's own Canvas; the author notes the fixes were later merged upstream):

- Canvas nodes are **DOM elements** (`canvas-node-content`), not canvas-drawn.
- Canvas implements **LOD** — *"Most of the canvas node types are replaced with a lightweight preview when zoomed out."* The mechanism is `updateBreakpoint(closeEnough)` → `mountContent()` / `unmountContent()`.
- Two real perf bugs: media-embed nodes were **unmounted and remounted every frame** while panning zoomed-out; and CSS `backface-visibility: hidden` on `canvas-node-content` significantly increased layout cost.

**Why this matters for our design:** it independently validates both my architectural conclusions — (a) viewport LOD/culling is *mandatory* at scale, and (b) even a well-resourced DOM implementation hit serious frame-level perf bugs. It also shows the Obsidian team's own answer was culling + lighter previews, not "render everything".

Also relevant: Obsidian's Canvas is **monkey-patchable**, which means a plugin *could* extend it — but doing so inherits both the weak format (§5.2) and the maintenance risk (§5.3).

**Recommendation:** register a **custom `ItemView`** via `Plugin.registerView()` for the diagram editor, and optionally add a command that opens it from a `.canvas` file. Do not attempt to extend Canvas itself.

### 5.5 Known issues running these libraries inside Obsidian specifically

**Prior art: essentially none.** A check of all **7,599** community plugins found **no Obsidian plugin built on React Flow**; forum search for "xyflow" returns 0 topics and "reactflow" exactly 1. Existing Obsidian node editors use Obsidian's native Canvas, Cytoscape.js (Juggl), Mermaid, or Excalidraw's own canvas. The only React-Flow-in-Obsidian repo (`AlexW00/obsidian-flow`) is an explicitly-labelled **starter template**, not a shipped plugin. **You are the first — budget discovery time.**

Because there is no precedent, here are the concrete failure modes that *are* documented:

| # | Gotcha | Detail / mitigation |
|---|---|---|
| 1 | **Container collapses to zero height → renders nothing** | The most likely first failure. Obsidian's `ItemView.contentEl` frequently has no resolved height, and the library's own `error004` says *"The parent container needs a width and a height to render the graph."* A developer forum report: *"I had to set the width and height of the reactFlow component to an absolute value, then only it appear within the parent div."* **Fix:** explicit `width`/`height` or a hardened flex chain with `min-height: 0`. |
| 2 | **CSS bleed / no Shadow DOM isolation** | Plugin CSS is global. A developer who tried `attachShadow` + `createPortal` + `all: initial` reported it **did not work**. Note `<EdgeLabelRenderer/>` portals to document level, which makes Shadow DOM isolation structurally hard. **Plan namespaced CSS by convention, not isolation.** |
| 3 | **Dev-only warnings are silent in production** | React Flow's `nodeTypes`/`edgeTypes` memoization warning (`error002`) is gated behind `process.env.NODE_ENV === 'development'`. In a production Obsidian build it **will not fire** — so a performance-killing re-created `nodeTypes` object ships silently. Memoize at module scope from day one. |
| 4 | **Hiding a handle must not use `display: none`** | The library measures handle geometry; `display:none` reports 0×0 and breaks edge routing. Use `visibility: hidden` / `opacity: 0`. Directly relevant to conditional connector visibility (`visible=` expressions, §1.3). |
| 5 | **`<canvas>` inside nodes has inconsistent mouse events** | Documented in the library's troubleshooting. Matters if you plan a canvas-based rotating-machinery animation inside a node. |
| 6 | **React version vs Obsidian's Electron** | Obsidian ships no React; the plugin bundles it. Verify React 18/19 against Obsidian's Electron/Chromium early. |
| 7 | **Bundle budget at startup** | React + ReactDOM + React Flow ≈ **105 KB gzip** (+ ~3 KB gzip CSS) loaded at Obsidian startup. Under the ~5 MB Sync ceiling, but consider lazy-loading the editor view. |
| 8 | **Minimap is its own cost centre** | SVG-per-node; at thousands of nodes plan a custom canvas minimap. |

**Canvas-based libraries (Konva/PixiJS/custom):** the Excalidraw plugin has a relevant performance history — issue [#2342](https://github.com/zsviczian/obsidian-excalidraw-plugin/issues/2342) ("Don't block UI actions e.g. scrolling/zooming on canvas because of image loading") and [#2068](https://github.com/zsviczian/obsidian-excalidraw-plugin/issues/2068) (startup time). Both are *asset-loading* problems rather than renderer problems, but they show Obsidian-specific pressure: image/`Bitmap` annotation loading (Modelica uses `Bitmap` and base64 `imageSource` heavily) must be async and cached, never blocking the render loop.

**Cytoscape.js in Obsidian:** used by Juggl, so it demonstrably works — but it still gives you no editing layer (§4.5).

---

## 6. How the real Modelica/simulation tools are built

| Tool | Rendering tech | Notes |
|---|---|---|
| **OpenModelica OMEdit** | **Qt `QGraphicsView` / `QGraphicsScene` + `QPainter`** — a retained-mode **2D painter scene graph** | Verified in `OMEdit/OMEditLIB/Modeling/ModelWidgetContainer.h`: `class GraphicsScene : public QGraphicsScene`, `class GraphicsView : public QGraphicsView`, `drawBackground(QPainter*, QRectF&)`, and `setViewportUpdateMode(QGraphicsView::FullViewportUpdate)`. A grep for OpenGL in `ModelWidgetContainer.cpp` returns **zero hits** (the `.h` includes `<QOpenGLContext>`, but it is not the diagram renderer). |
| **OMEdit annotation classes** | one class **per Modelica primitive**: `LineAnnotation`, `PolygonAnnotation`, `RectangleAnnotation`, `EllipseAnnotation`, `TextAnnotation`, `BitmapAnnotation`, all with `drawAnnotation(QPainter*)`, `applyLinePattern(QPainter*)`, `applyFillPattern(QPainter*)`, `addPathStroker(QPainterPath&)` | This is the architectural template: **the spec's primitive list *is* the renderer's class list.** |
| **Simulink** | Causal block-diagram editor | **Causal**, not acausal — confirmed by MathWorks' own patent US7873500B1, which distinguishes signals *"represented by directed lines, such as arrows"* from physical modelling's *"non-directional physical connections."* Do not import Simulink UX (arrowheads as semantics, drag direction determining source/sink). |
| **20-sim** | Desktop | ⭐ **Best acausal UX precedent.** Draws connections with **no inherent direction** and derives direction afterwards via an explicit *"Analyze Causality"* command, overlaying causal strokes as a **derived, non-persisted layer**. **Copy this pattern.** |
| **Dymola, Wolfram System Modeler, MapleSim, PTC Mathcad** | Desktop, proprietary; internals not publicly documented | **[UNVERIFIED]** — no authoritative vendor source names their GUI toolkit. Reported as a clean negative rather than a guess. |
| **OMEdit connection routing** | `manhattanizeShape()` rewrites diagonals into L-bends (skipping `Smooth.Bezier`); `handleComponentMoved()` only re-anchors + Liang–Barsky clips | **There is no obstacle-avoiding autorouter in OMEdit.** Only Simulink has a real "smart signal routing" autorouter. ⚠️ MSL *does* contain diagonal connection segments, so silently orthogonalising **rewrites library geometry** — make it an explicit user command, not an automatic side effect. |

### 6.1 Web-based Modelica editors — the precedents that actually exist

This closes an open question from the original brief. All renderers found are **DOM or SVG**; one uses WebGL for 3-D only.

| Project | Status | Stack / renderer | Lesson |
|---|---|---|---|
| **Modelon Impact** | Commercial, live | Documented 2018 architecture (Modelon-authored WAMS paper, DOI [10.3384/ecp18148255](https://doi.org/10.3384/ecp18148255)): **React + TypeScript + three.js/WebGL + REST**. The **server holds the Modelica AST** and compiles with OCT→FMU, simulating via PyFMI. ⚠️ The *present-day 2D canvas* renderer is **UNVERIFIED** — no open frontend code. | The leading commercial web Modelica tool **delegates the AST to a server**. You have no server — see the round-trip warning below. |
| **OMWebEdit** | **Archived** (last commit 2020; `OpenModelica/OMWebEdit` 404s) | **React + TypeScript + `@projectstorm/react-diagrams` + dagre + paths-js ⇒ SVG** | A diagram editor over OMC, browser-based, proven — then abandoned. |
| **ModelScript** | Live | **`@svgdotjs/svg.js` ⇒ SVG** | SVG is viable for Modelica diagrams at real-world scale. |
| **Modiator** | **Live, ships browser simulation** | Modelica→JS + **SUNDIALS/CVODE compiled to WASM** (verified: `modiator.netlify.app/cvode.wasm` = 200, 146,200 bytes, `application/wasm`). Infinite canvas via **DOM + CSS `transform`** (not SVG/Canvas/WebGL), plus three.js + Plotly. | ⭐ **Browser Modelica simulation already works** — but it supports only **"a subset of Modelica."** |
| **Bodylight.js** | Live | Modelica→FMU→WASM via Emscripten; FMI 2.0 co-simulation | ⚠️ OpenModelica FMUs contain only the **Euler** solver. |
| **rumoca** | Active | Rust → WASM, Monaco playground | Emerging alternative. |
| **`modelica/fmi-ls-wasm`** | Official MA repo | FMI layered standard for WASM | ⚠️ README states explicitly **"not normative… not officially endorsed."** |

**On writing Modelica back to disk — the sharpest architectural warning in this brief.** Both reference implementations *dodge* the lossless round-trip problem: **OMEdit does not write Modelica text at all** — `LineAnnotation::updateConnectionAnnotation()` calls `OMCProxy::updateConnection(cls, …, "annotate=$annotation(Line(...))")`, letting OMC own the AST and pretty-printer; Modelon Impact does the same server-side. **A browser plugin has no OMC, so it owns this problem entirely.**

Corollary — a **normative obligation** your parser must satisfy (MLS §18.1): *"any tool shall save files with all vendor-specific annotations … intact."* Real-world example: Modelon's `DialogExtensions` (`hide`, `hideInEditingState`, `hideInNonEditingState`). A lossy "parse into my own shape classes" design will **corrupt every library it touches**. Preserve unknown `__vendor` annotations verbatim.

Also implement the missing-graphics rule: if a placed component's icon has **no primitives** (regardless of `visible`, excluding connectors), tools **shall** draw a *"tool-dependent rudimentary outline."*

> ⭐ **Free scoping document — read this before designing.** Modelon publishes [help.modelon.com/latest/reference/limitations](https://help.modelon.com/latest/reference/limitations/) — an honest list of which Modelica §18 features a mature commercial *browser* editor still does **not** implement: no connection `Text`; `preserveAspectRatio` ignored on resize; no `Raised`/`Sunken`/`Engraved`; partial `Line` arrows/patterns; no `Text.textStyle`/`fontName`/`fontSize`; `visible` unsupported in experiment mode; **no base64 `imageSource` at all** (bitmaps must live in `Resources/`); no `displayUnit`. It also states outright that *"the GUI does not support all UI interpretations proposed in the Modelica specification"* and repeatedly answers "use the code editor" — i.e. **ship a first-class text view alongside the diagram view.**

> ⭐ **Best immediate parsing win:** [`OpenModelica/tree-sitter-modelica`](https://github.com/OpenModelica/tree-sitter-modelica) — builds `tree-sitter-modelica.wasm` via Emscripten and documents **Web Tree-sitter usage from TypeScript**; OMEdit already ships `tree-sitter-modelica.wasm` + `web-tree-sitter.wasm`. ⚠️ It yields a **concrete syntax tree, not a resolved AST** — no `extends` flattening, modifier application, conditional-connector evaluation, or `%par` substitution. Those still need a real front end.

### 6.2 Diagram interchange — what the standards actually offer

The brief's premise ("Modelica annotation is the only option") is **false**, but the practical conclusion survives:

- **FMI 3.0 §2.4.9 "Terminals and Icons"** (verified in 3.0.1/3.0.2 and `schema/fmi3Terminal.xsd`) standardises FMU icons and **per-terminal icons** with `defaultConnectionColor` / `defaultConnectionStrokeSize` / `iconBaseName`, plus an acausal layer (`variableKind` = `signal` | `inflow`/`outflow` = Kirchhoff; `TerminalStreamMemberVariable` cites **MLS Appendix D**). ⚠️ **Images only — no vector primitives.** ⭐ Direct hook: the spec *suggests* that Modelica tools store the connector's annotation under the type **`org.modelica.Modelica4Annotation`**.
- **SSP 2.0 §5** standardises `ElementGeometry`, `ConnectorGeometry` (normalised, with inner/outer views), `ConnectionGeometry` (waypoints), `SystemGeometry` (canvas, nominal **1 mm**), `GraphicalElements`/`Note`. Design intent, verbatim: *"basic graphical information … while eschewing the complexities of full and exact graphical model exchange."* ⚠️ SSP is **not** purely causal — *"Acausal Modelica connector types are mapped to connectors of kind `unspecified`."*
- **No FMI or SSP layered standard for graphics exists** (`fmi-standard.org/layered-standards/` and `ssp-standard.org/layered-standards/` both 404). **No Modelica Association project for diagram interchange exists** either.
- **⇒ Conclusion: the interchange format for Modelica diagrams *is* the annotated Modelica source text.** §18.6 is the only standard that carries an icon's **actual vector geometry**.
- **SysML v2 has no diagram interchange** — zero hits for "diagram interchange" in the 691-page Language spec; graphical notation is BNF rules only.
- ⭐ **Best-documented argument against "just store an SVG blob in an annotation":** **SBML L3 Layout + Render** (both FINAL) state verbatim that *"Currently, there is no official way of encoding the graphical layout… Software tools wishing to share this kind of data must use SBML annotations to store it in proprietary forms"* — solved by promoting layout to a first-class `ListOfLayouts` child of `<model>`. It explicitly **rejected reusing SVG**.

> **Prior art worth knowing:** **ModelicaML** is real but dormant (Eclipse Juno 2012 / Papyrus MDT 0.9, SVN only). **"GraphicalModelica" could not be verified as a real project — do not cite it.** **MoDeSt is unrelated** (stochastic model checking; a same-acronym false friend). For richer rendering, the best precedent is *"3D Schematics of Modelica Models and Gamification"* (Elmqvist/Baldwin/Dahlberg, 11th Int. Modelica Conf 2015, prototyped as **Playmola**), which **derives 3-D geometry automatically from `annotation(Icon(...))`** — e.g. `fillPattern=FillPattern.HorizontalCylinder` ⇒ cylinder.

> **The headline architectural lesson:** the reference open-source Modelica diagram editor renders with an **immediate-mode 2D painter over a scene graph — not DOM, not SVG**. A Canvas2D/WebGL renderer is therefore not an exotic choice here; it is the *conventional* one for this domain. That said, every *web* Modelica editor found (§6.1) uses **DOM or SVG** — so both are defensible, and the renderer choice hinges on your node-count target rather than on domain convention.

---

## 7. Performance: my own measurements

**Method.** Headless **Chrome 152.0.7977.54**, driven over the DevTools Protocol, viewport 1600×900, software rasterisation (SwiftShader). Two metrics:
- **`syncMed`** — median cost of **one full pan frame** measured synchronously, uncapped by vsync: React Flow uses `flushSync(setViewport)` then forces layout; LiteGraph uses `ds.offset/scale` + full `draw(true,true)`. This is the metric that reveals the real ceiling, because rAF saturates at 60 fps.
- **`rAFmean` / `p95`** — wall-clock frame pacing over 40–60 rAF-paced pan steps (includes paint/composite).

Graph: grid of nodes, each with a custom symbol and typed in/out ports, wired in a chain.

> **Caveat (important):** headless Chrome here has **no GPU** — rasterisation is CPU/SwiftShader. Canvas-based libraries are therefore **penalised** relative to real hardware, while DOM/SVG results are less affected. Re-running with `--enable-gpu-rasterization` did not change the picture (SwiftShader is still software). Treat the *relative* DOM-vs-canvas magnitudes as indicative and the **DOM node counts and linear-vs-flat trends as the robust findings**.

### 7.1 React Flow, culling OFF (`onlyRenderVisibleElements={false}`)

| Nodes | Mount | syncMed | rAF mean | p95 | DOM elements |
|---|---|---|---|---|---|
| 500 | 319 ms | 3.0 ms | 19.3 ms | 32.0 ms | 5,437 |
| 1,000 | 393 ms | **5.1 ms** | 16.9 ms | 29.5 ms | 10,897 |
| 2,000 | 682 ms | **10.1 ms** | 20.3 ms | 31.6 ms | 21,845 |
| 4,000 | 1,525 ms | **20.6 ms** | 33.1 ms (~30 fps) | 40.1 ms | 43,773 |

**Per-frame cost is linear at ≈5 ms per 1,000 nodes.** Note **≈10.9 DOM elements per node** — 4,000 nodes = **43,773 DOM elements**.

### 7.2 React Flow, culling ON (`onlyRenderVisibleElements={true}`) — the decisive result

| Nodes | Mount | syncMed | rAF mean | p95 | DOM elements |
|---|---|---|---|---|---|
| 500 | 175 ms | 1.8 ms | 17.1 ms | 23.0 ms | 1,455 |
| 1,000 | 249 ms | 1.3 ms | 16.5 ms | 17.8 ms | **1,455** |
| 2,000 | 453 ms | 2.6 ms | 16.6 ms | 19.4 ms | **1,455** |
| 4,000 | 929 ms | **2.4 ms** | **16.6 ms (60 fps)** | 21.9 ms | **1,455** |

**DOM element count is constant and per-frame cost is flat: ~60 fps at 4,000 nodes.** Mount time still scales (929 ms at 4,000) but is one-time. This is the single most important benchmark in this report: **the DOM/SVG penalty is a culling problem, not a fundamental DOM problem.**

> **Note:** `onlyRenderVisibleElements` **defaults to `false`** in v12 (verified in shipped source). You must turn it on explicitly. A related open RFC, [#4239](https://github.com/xyflow/xyflow/issues/4239), describes the current implementation as *"a naïve axis aligned bounding box check"* and proposes a BVH; still unimplemented. [#3883](https://github.com/xyflow/xyflow/issues/3883) notes *"all nodes get rendered initially even if one uses onlyRenderVisibleElements"*.

### 7.2b The worst case — zoomed out with everything visible (the honest counterpoint)

Culling only helps while most of the graph is off-screen. I measured the case that defeats it: zoomed out to fit the whole model, with zoom oscillating so **every frame forces a re-cull and a re-render**:

| Nodes | Mount | rAF mean | p95 | **FPS** | DOM elements |
|---|---|---|---|---|---|
| 1,000 | 294 ms | 34.8 ms | 66.5 ms | **28.7** | 9,853 |
| 2,000 | 503 ms | 52.0 ms | 108.2 ms | **19.2** | 19,881 |
| 4,000 | 1,032 ms | **100.7 ms** | **225.8 ms** | **9.9** | 39,573 |

**~10 fps at 4,000 nodes when the whole model is on screen and the view is changing.** This is the real ceiling of the "just turn on culling" strategy, and it makes **LOD / semantic zoom mandatory rather than optional**: below some zoom threshold you must replace full node bodies with lightweight glyphs — precisely what Obsidian's own Canvas does with `updateBreakpoint(closeEnough)` mount/unmount LOD (§5.4). Corroborating third-party field report: [#5442](https://github.com/xyflow/xyflow/issues/5442) found that hiding node innards via a CSS class at low zoom *"did help a lot"*, while stripping HTML entirely *"the immense lag when re-generating the markup and layout was not worth it"*.

**Correct reading of §7.2 vs §7.2b:** culled React Flow is excellent while editing at working zoom (~60 fps @ 4k nodes), and must be paired with a simplified overview mode when zoomed out.

### 7.3 LiteGraph (Canvas2D, Comfy-Org fork)

| Nodes | Mount | syncMed | rAF mean | p95 | DOM elements |
|---|---|---|---|---|---|
| 500 | 165 ms | 10.9 ms | 24.6 ms | 28.2 ms | **9** |
| 1,000 | 266 ms | 11.5 ms | 26.2 ms | 32.8 ms | **9** |
| 2,000 | 823 ms | 15.1 ms | 28.5 ms | 34.9 ms | **9** |
| 4,000 | 4,651 ms | **20.7 ms** | 38.4 ms (~26 fps) | 53.3 ms | **9** |

Total DOM footprint is **9 elements regardless of graph size** — the entire diagram is one `<canvas>`. But per-frame cost *still grows*, because LiteGraph recomputes the visible-node set every frame in `O(total nodes)` (`computeVisibleNodes()` + a fresh `Set` of visible ids) and, with `force_canvas`, repaints everything visible. Mount cost at 4,000 nodes (4.65 s) is markedly worse than React Flow's.

**Interpretation.** LiteGraph's raw frame cost converges with *unculled* React Flow (~20 ms at 4,000) — under software rasterisation, drawing thousands of nodes with `ctx` calls is no cheaper than the browser's own layout+paint of 43k DOM elements. The winning configuration is **culling + a renderer that doesn't re-walk the whole graph each frame**. Note also that LiteGraph's ceiling is *fixable* by adding a spatial index — which is exactly what tldraw does (spatial-index culling, "a canvas with 10,000 shapes might only render 50") and what Obsidian Canvas does with its LOD breakpoints.

### 7.4 What this means for "thousands of nodes"

1. **Thousands of nodes is achievable** — but only with viewport culling plus level-of-detail. Budget for it explicitly.
2. **Zoomed-out "see the whole model" is the worst case**, because everything is visible. Plan simplified glyphs below a zoom threshold (Obsidian Canvas's own approach).
3. **Watch `hidden`/LOD bookkeeping in React Flow**: toggling `hidden` on many nodes still costs a React re-render.
4. **The compositor helps DOM**: React Flow's pan/zoom is one CSS transform on one div, which the browser can composite without re-rasterising each node. This is why culled React Flow beats full-redraw canvas under software raster.
5. **Re-benchmark on real hardware before committing** — I could not obtain a GPU-accelerated browser in this environment.

---

## 8. Custom domain-specific node rendering

The requirement: a **resistor symbol**, a **rotating machinery icon**, connector glyphs per domain (electrical/mechanical/thermal/fluid), plus `visible`-expression evaluation and `%`-macro text.

| Library | How you draw a custom symbol | Difficulty | Can you draw an *exact* MSL icon? |
|---|---|---|---|
| **React Flow** | React component in `nodeTypes`; inline `<svg>` for the symbol, CSS/SMIL/JS animation for rotation | **Easy** — it's just React | ✅ Yes — you can transcribe `Rectangle`/`Line`/`Text` from the annotation into SVG almost 1:1 |
| **LiteGraph (Comfy-Org)** | `class X extends LGraphNode { onDrawForeground(ctx) { … } }`, then `LiteGraph.registerNodeType(...)` | **Easy and direct** — raw Canvas2D, perfect for spec primitives + Bezier smoothing | ✅ Yes — closest to OMEdit's `drawAnnotation(QPainter*)` model |
| **AntV X6** | `Graph.registerNode(markup, {…})` with custom SVG markup, or `x6-react-shape` for HTML | Moderate | ✅ Yes (SVG markup) |
| **LogicFlow** | `register()` / `BaseNode` model + view (SVG) | Moderate; Chinese-first docs | ✅ Yes |
| **JointJS core** | Custom SVG markup in a shape definition | Moderate | ⚠️ HTML shapes are JointJS+ only |
| **Konva / PixiJS / Fabric** | `Konva.Shape` / custom `Graphics` / Fabric subclass — you also implement ports, edges, gestures | Hard (build the editor too) | ✅ Yes |
| **Blockly** | Custom renderer drawers / SVG hacking through the block-shape pipeline | **Hard** | ⚠️ Fighting the metaphor |
| **tldraw** | `ShapeUtil` (getDefaultProps / getGeometry / component / getIndicatorPath) — clean API | Easy — but ⛔ licence | — |

**Key design point.** Modelica's primitive set (`Line`, `Polygon`, `Rectangle`, `Ellipse`, `Text`, `Bitmap`) with `Smooth.Bezier` quadratic splines, `FillPattern` (including cylinder/sphere gradients), `BorderPattern`, and arrow geometry is **a small, fully-specified 2D vector language**. Whichever renderer you pick, implement **that** primitive set once as an intermediate representation, then emit to SVG (React Flow/X6) or Canvas2D (LiteGraph/custom). This mirrors OMEdit's one-class-per-primitive design and keeps the door open to swapping renderers.

Two spec details that will bite if ignored:
- **Transformation order** is `extent` (scale, and *flip* when the extent is inverted) → `rotation` (CCW about `{0,0}`, **not** about the component's `origin`) → `origin` (translate). §18.6.2.
- **Filled shapes**: `extent`/`points` describe the *zero-thickness* shape, and the rendered border is **half inside, half outside** it. §18.6.1.2.
- **Text**: `fontSize=0` means "scale to fit `extent`" — a very common MSL idiom; a zero-width extent has special meaning. §18.6.5.5.

---

## 9. Recommendation

### 9.1 Ranking with rationale

1. **Custom Canvas2D renderer with a separated semantic model** — best ceiling and best fidelity.
   Rationale: matches OMEdit's proven architecture (§6); Canvas2D maps 1:1 onto the Modelica primitive set including Bezier smoothing; you control culling exactly; no bundle-size tax from a framework; and it avoids the ~10.9-DOM-elements-per-node structural cost. Cost: you build ports, gestures, dialogs, and hit-testing. **Choose this if you need >5k nodes or pixel-exact MSL rendering.**

2. **React Flow v12 + `onlyRenderVisibleElements`** — best library, measured 60 fps @ 4,000 nodes.
   MIT, actively released, `ConnectionMode.Loose` handles bidirectional ports, custom nodes are trivial React components, ~59.5 KB gzip (+45 KB for React ≈ **105 KB gzip**). **Non-negotiable:** enable viewport culling, memoize `nodeTypes`/components, never read the whole `nodes` array in a component, and implement LOD for zoomed-out views.

3. ~~LiteGraph (Comfy-Org fork)~~ — **rejected.** It had the best custom-drawing API of any library (`onDrawForeground(ctx)`), but: the npm package is **deprecated**, the repo is **archived** (merged into GPL-3.0 ComfyUI_frontend), and critically its `inputs[i].link` is a **scalar**, so an input accepts exactly one wire and self-connections are rejected at the API level (`//avoid loopback: if (target_node == this) return null;`). Modelica connectors are N-ary and full of legitimate loops, so you would have to fork `connect`/`disconnectInput`. The largest LiteGraph deployment in existence (ComfyUI) is itself migrating to a Vue/DOM architecture, reporting ~12–35 FPS with 541 visible nodes. **Do not adopt as a dependency** — but do steal the architectural lesson.

4. **AntV X6 v3** — the strongest "batteries-included" MIT option (history, stencil, minimap, transform, snapping all in-package; `virtual: true` culling; TS-native). Pick this if you want React Flow's feature level without React.

5. **Konva.js / PixiJS** — if you go the custom route, use these as the substrate rather than writing a rasteriser. Konva gives you a retained scene graph, layers, hit-testing and `batchDraw()`; Pixi gives you WebGL2/WebGPU when Canvas2D saturates.

**Rejected:** Blockly (tree, not graph — §4.4), Rete (NC licence on scopes + no canvas + stale core + perf unproven — §4.2), tldraw & GoJS & JointJS+ (licence — §3), Cytoscape (visualiser, not editor), Butterfly (abandoned), Drawflow (stalled, 272 open issues, no types).

### 9.2 Recommended architecture

```
Modelica source (.mo)  ⇄  Annotation model  ⇄  Layout/render model  ⇄  Renderer
   text/AST              (spec §18.6)          (nodes, ports, wires)     (Canvas2D | SVG)
        │                                              │
        └────────── connect() = equations ─────────────┘
                    (NOT a dataflow graph)
```

- **Keep the graph library ignorant of physics.** Store `connect()` pairs and their `annotation(Line(...))` waypoints in your own model; the renderer draws an undirected wire between two *ports*. Do not encode direction.
- **Ports, not sides.** A connector needs stable identity (`resistor.p`), a domain type (`electrical`), and its `Icon` from the connector class. This is precisely what Obsidian Canvas cannot express (§5.2).
- **Evaluate `visible` expressions and `%`-macros in the model layer**, not the renderer, so both icon and diagram layers stay consistent.
- **Implement LOD** (full symbol → simplified glyph → box) keyed to zoom, like Obsidian Canvas and tldraw.
- **Persist everything round-trippable**: `Placement(transformation(extent, rotation, origin))`, connection `Line` points, `Dialog` layout, `choices`.

### 9.3 Open questions / recommended spikes

**Resolved during this research** (kept here so they are not re-opened):
- ~~Behaviour when the whole model is visible~~ → **measured**, §7.2b: ~10 fps @ 4,000 nodes. LOD is mandatory.
- ~~Can Modelica run in the browser?~~ → **yes** — Modiator ships Modelica→JS + CVODE/WASM today, but for **"a subset of Modelica"** (§6.1).
- ~~Modelon Impact's renderer~~ → 2018 architecture documented as **React + TypeScript + three.js/WebGL + REST**, with the **AST held server-side** (§6.1). Present-day 2D canvas still unknown.
- ~~What interchange format for diagrams?~~ → FMI 3.0 §2.4.9 + SSP 2.0 §5 exist but carry **images/extents only**; **annotated Modelica source text is the interchange format** (§6.2).
- ~~Why did "Rete canvas plugin" not appear?~~ → it does not exist (§4.2).

**Still open — recommended spikes:**

| # | Question | Why it matters |
|---|---|---|
| 1 | **Re-run the benchmarks on GPU-accelerated hardware, inside real Obsidian.** | All my numbers are software-rasterised (SwiftShader). The DOM-vs-canvas gap in particular may move; the DOM-element counts and the linear-vs-flat trend will not. |
| 2 | **Which Modelica spec version do you target — 3.5 or 3.6/3.7?** | `Transformation` rotation semantics **differ** (§1.3). You must pick, test against both, and label it in the UI. |
| 3 | **Lossless round-trip of *unknown* vendor annotations.** | §18.1 makes preserving `__vendor` annotations **normative**. A lossy shape-class model will corrupt every library it touches. Both reference implementations dodged this by owning no writer — you cannot. |
| 4 | **Do you own an OMC-equivalent AST writer, or do you ship a text view?** | Modelon's own limitations page concedes its GUI *"does not support all UI interpretations proposed in the Modelica specification"* and answers "use the code editor." Cheap escape hatch for v1. |
| 5 | **Parse with `tree-sitter-modelica`, then build a real front end.** | Tree-sitter gives a **CST, not a resolved AST** — no `extends` flattening, modifier application, conditional-connector evaluation, or `%par` substitution (§6.1). |
| 6 | **React Flow's `onlyRenderVisibleElements` + `hidden`/LOD interaction at 5–10k nodes**, and the status of issue #5765. | #3883/#4239 say the culling is a naïve AABB and improvable; #5765 reported a handle re-render cascade at ~10k nodes (closure reason unconfirmed). |
| 7 | **Your LOD swap strategy** — what replaces a full node body below the zoom threshold, and how to keep the swap cheap. | §7.2b shows the naive approach (re-render everything) costs ~100 ms/frame at 4k. Obsidian hides innards via a CSS class (cheap); issue #5442 found full HTML stripping *"not worth it."* |
| 8 | **Autorouting policy.** | OMEdit force-manhattanises and **silently rewrites MSL diagonals**; only Simulink has a real obstacle-avoiding router. Decide explicitly (§6). |

---

## 10. Unverified claims & corrections log

**Corrections to widely repeated claims (all caught in this session):**

| Claim | Reality |
|---|---|
| "@xyflow/react has zero dependencies" | **False.** 3 direct, **13 transitive** (d3-zoom/drag/selection/interpolate, zustand, classcat). |
| "React Flow's docs claim X nodes" | **They claim no node count at all**, and publish no benchmark. Their own Stress example is 625 nodes. |
| "Rete has a canvas render plugin" | **No.** `rete-canvas-plugin` → HTTP 404 on npm. |
| "Rete is fully MIT" | **False.** `rete-scopes-plugin` / `rete-structures` are **CC-BY-NC-SA-4.0**. |
| "Rete.js author is Vitaliy Potapov" | **Vitaliy Stoliarov** (`Ni55aN`). |
| "tldraw is MIT" | **False.** Proprietary, key-enforced licence; production use forbidden without a commercial licence, and the SDK **stops rendering after 5 seconds** without a key. |
| "Blockly can do graph / cyclic connections" | **No.** Statement/expression **tree** only. Worse: programmatic cycles are *accepted* by the API (the guard is drag-only) and then serialise to **zero blocks — silent data loss**. |
| "Blockly is Google-backed" | ⚠️ **Outdated.** Blockly **graduated to the Raspberry Pi Foundation** (2025-11-10), Google.org-funded; `google/blockly` redirects to `RaspberryPiFoundation/blockly`; docs moved to docs.blockly.com. |
| "A Blockly value output can feed multiple inputs" | **False** (empirically disproved on 13.3.0). `targetConnection` is a scalar — connecting a second input **moves the wire**. No fan-out. |
| "LiteGraph can handle thousands of nodes" | **False.** `MAX_NUMBER_OF_NODES = 1000`, enforced by a **thrown error** in `LGraph.add()`. The fork raises it to 10,000. |
| "LiteGraph has `onDrawn` / `onDrawWidget` hooks" | **They do not exist** — zero hits in source and in the fork's typings. Real hooks: `onDrawBackground`, `onDrawForeground`, `onDrawCollapsed`, `onDrawTitle*`, `onBounding`. |
| "LiteGraph's shipped `.d.ts` is reliable" | **No.** It declares `(ctx, canvas: HTMLCanvasElement)` but the runtime passes `(ctx, LGraphCanvas, HTMLCanvasElement, graph_mouse)` — **wrong signatures**; TS will not catch misuse. The fork also changed `onDrawBackground` to take **ctx only**, so 4-arg code breaks. |
| "LiteGraph is a safe dependency" | **No longer.** `@comfyorg/litegraph` npm = **DEPRECATED**, repo **ARCHIVED**; `litegraph.js` last release **2024-01-08**. Also `inputs[i].link` is a **scalar** (one wire per input, self-connection rejected). |
| "Canvas rendering is automatically faster at scale" | **Not what I measured.** LiteGraph (Canvas2D) at 4,000 nodes: syncMed **20.7 ms**, mount **4,651 ms** — no better than *unculled* React Flow, and its mount was ~5× slower. |
| "Drawflow relicensed / changed its license" | **False.** `git log --follow -- LICENSE` = **one commit** (`0931e4d "Add license"`, 2020-04-28, MIT); all 60 npm versions declare MIT. Only event: a ~7-day unlicensed window (first commit had only a README). |
| "JointJS changed its license" | **False.** One LICENSE commit (2013, MPL-2.0), unchanged since. |
| "JointJS core still needs Backbone" | **No longer.** `@joint/core@4.3.3` has **zero** runtime deps (Backbone/jQuery/Lodash removed in 4.0.0). |
| "Butterfly is a Canvas renderer" | **False.** It renders **HTML DOM nodes + SVG edges**; Canvas2D appears in only 5 auxiliary files (selection box, minimap, snapline, grid). |
| "Cytoscape.js has no WebGL" | **False.** Official WebGL renderer since 3.31 (`renderer:{name:'canvas', webgl:true}`). Still viz-only (no edge-creation gesture). |
| "PixiJS has a Canvas2D fallback" | **No.** v8's renderers table lists `CanvasRenderer` as **"Coming-soon."** |
| "Konva has official perf benchmarks" | **No.** No official fps benchmark; Konva **disclaims** the widely-cited slaylines benchmark as stale (Sept 2021 versions). |
| "Fabric.js is WebGL-free" | **Imprecise.** `WebGLFilterBackend` uses WebGL for image filters. |
| "Vue Flow shares React Flow's core" | **False.** It is a **port** with its own d3-based stack; it shares nothing with `@xyflow/system`. |
| "LogicFlow has a `registerNode` API" | **False.** It is `lf.register({type, view, model})` / `batchRegister`. |
| "LogicFlow docs are Chinese-only" | **False.** English docs are complete (76 `.en.md` vs 73 `.zh.md`). But `logicflow.site` is dead → use `site.logic-flow.cn`. |
| "Modelica uses `dynamicDraw` for animation" | The spec uses **`DynamicSelect`** (§18.6.6). |
| "`Evaluate` has `breakpoints` in Modelica" | **Zero `breakpoints` hits** across MLS 2.2/3.0/3.1/3.2/3.3/3.6/3.7-dev, MSL, and OMEdit. `Evaluate` is a symbolic-processing flag (§18.3). Interactive manipulation is the separate **`interaction`** annotation (§18.6.7) — which has **zero usage in MSL**. |
| "`Line` has `lineThickness` / `startArrowSize` / `endArrowSize`" | **False.** `Line` has **`thickness`** and a single **`arrowSize`** plus `arrow[2]`. `lineThickness` is on **`FilledShape`** only. Origin of the confusion: OMEdit's C++ member is named `mLineThickness` for *both*, then serialises them differently. |
| "`Arrow` is a graphic primitive" | **No** — it's an enumeration used by `Line`. The primitive set is closed at six. |
| "Resistor has an Icon *and* a Diagram layer" | **False.** `Resistor` has **only `Icon`**. |
| "`Flange` draws a circle + fork" | **False.** `Flange` has **no icon**; the circles are on `Flange_a` (grey) and `Flange_b` (white). |
| "`choicesAllMatching` is a chapter-18 annotation" | It's in **§7.3.4**. |
| "OMEdit uses OpenGL for the diagram" | **No** — zero OpenGL/QML/WebEngine references for the diagram; it is `QGraphicsView` + `QPainter`. (OSG/Quick3D is only the 3-D animation window.) Also `OmsGraphicsView`/`OMSGraphicsScene` **do not exist**. |
| "Modelica annotations are the only diagram-interchange option" | **False** — FMI 3.0 §2.4.9 and SSP 2.0 §5 standardise diagram graphics. But **images and extents only, never vector primitives**, so §18.6 remains the only standard carrying an icon's actual geometry. Practical conclusion survives. |
| "`GraphicalModelica` is a Modelica-related project" | **Could not be verified — do not cite.** Likely a conflation with **ModelicaML** (real but dormant). |
| "MoDeSt is Modelica tooling" | **Unrelated** — stochastic model checking; same-acronym false friend. |
| "OMG DI is dead" | **Overstated.** UMLDI 1.0 (2006) and DD 1.1 (2015) are both `formal`; UML 2.5.1 still ships a normative `UMLDI.xmi`. It simply ceased to be a UML 2.5 *compliance point* (issue UML25-591, "Closed – No Change"). |

**Explicitly unverified in this brief:**
- Dymola / Wolfram System Modeler / MapleSim / PTC Mathcad GUI toolkits — no authoritative vendor source names them. A **clean negative**, not a guess.
- **Modelon Impact's present-day 2D-canvas renderer** — the 2018 WAMS paper describes React + TypeScript + three.js/WebGL + REST, but no current frontend code is public. Cite as architecture, not present-day fact.
- **Modelica Association browser-simulation product** — `tshort/openmodelica-javascript` is dead since 2014; OpenModelica's live work is an internal Rust **`wasm-jit`** codegen target (`OMCompiler/Compiler/OpenModelica.rs`, crates `openmodelica_wasi`/`openmodelica_sim`/`openmodelica_modelica_utilities`, 26 CI tests) with **no documented browser API**.
- Whether any production-grade **full-language** OMC→WASM build exists. **Modiator proves browser Modelica simulation works, but only for "a subset of Modelica."**
- `fmi4wasm` — no repo at any plausible org.
- No **Modelica Association graphics standardization effort** exists.
- React Flow issue **#5765** (10k-node handle re-render cascade) — closure reason not confirmed (GitHub rate limit); likely fixed or stale-closed, but **the failure mode is plausible for a handle-rich Modelica editor and should be re-checked**.
- React Flow issue **#3477** (bidirectional handle) — closed *the same day* as a feature request, i.e. the maintainers deliberately declined it in favour of `ConnectionMode.Loose`.
- GPU-accelerated performance characteristics (my benchmarks are software-rasterised).
- Rete v2 rendering performance at 1,000+ rich custom nodes — only a closed issue (#628) reporting trouble past ~150 custom-component nodes.
- **X6 at 1,000+ nodes** — a vendor example exists (`virtual:true`), no published FPS; I did not run it.
- Performance at 1,000+ nodes is **UNVERIFIED** for Drawflow, Vue Flow, Svelte Flow, JointJS core, LogicFlow and Butterfly — none publishes a benchmark, and I did not estimate.
- G6 v5 scale regressions are reported in user issues (#7574 "above two-to-three thousand it just fails to render" vs v4; #7566 10,000 custom nodes → blank + OOM); G6 is a *visualisation* engine per its own README, so this is context, not a recommendation.
- MathWorks pages returned 403 to this host, so two Simulink citations came via a text-extraction proxy.

---

## Appendix A — Full measured bundle sizes

esbuild 0.28.2, `--bundle --minify --format=esm --target=es2020`, `gzip -9`. Framework peers (react, react-dom, vue) marked external.

**Cross-check:** an independent pass measured the libraries' own published `dist` bundles (also `gzip -9`) on the same day. Where comparable, the two agree closely, which is a useful sanity signal on both methods — e.g. `@xyflow/react` 59,727 vs my 59,485; `konva` 58,128 vs 59,166; `cytoscape` 137,167 vs 141,503; `@joint/core` 144,327 vs 134,505; `@logicflow/core` 120,585 vs 101,436; `@antv/x6` 167,109 vs 172,174. Differences come from tree-shaking of a realistic app entry (mine) versus the untree-shaken vendor bundle (theirs). Use these as ±10% bands, not exact figures.

| Entry | Raw (B) | **Gzip (B)** |
|---|---|---|
| `react-dom/client` (baseline) | 141,600 | **45,276** |
| React Flow v12 (editor + custom node + MiniMap/Controls/Background) | 180,367 | **59,485** |
| React Flow v11 (`reactflow`) | 146,255 | **48,581** |
| Rete core+area+connection+**React** render | 121,507 | **35,767** |
| Rete core+area+connection+**Vue** render | 96,958 | **24,540** |
| Vue Flow (`@vue-flow/core`) | 156,050 | **50,816** |
| LiteGraph (Comfy-Org) | 295,933 | **86,962** |
| LiteGraph.js (jagenjo) | 501,942 | **123,206** |
| Blockly `core` | 641,699 | **177,701** |
| Blockly (full) | 753,962 | **202,033** |
| AntV X6 | 596,064 | **172,174** |
| JointJS `@joint/core` | 442,431 | **134,505** |
| Cytoscape.js | 443,828 | **141,503** |
| LogicFlow `@logicflow/core` | 394,811 | **101,436** |
| Konva | 190,957 | **59,166** |
| PixiJS | 541,825 | **158,044** |
| Fabric.js | 281,734 | **87,769** |
| Drawflow | 46,541 | **9,179** |
| Butterfly | 716,907 | **207,398** |
| tldraw | 1,991,537 | **599,224** |

Also measured: React Flow CSS `style.css` 3.0 KB gzip + `base.css` 2.4 KB gzip. Rete `auto-arrange` pulls **elkjs**: 442.6 KB gzip alone.

## Appendix B — Registry facts (npm, verified 2026-09-13)

| Package | Latest | Date | Licence | Direct deps |
|---|---|---|---|---|
| `@xyflow/react` | 12.11.6 | 2026-09-01 | MIT | 3 |
| `@xyflow/svelte` | 1.6.6 | 2026-09-01 | MIT | 2 |
| `@vue-flow/core` | 1.48.2 | 2026-01-28 | MIT | 5 |
| `reactflow` | 11.11.4 | 2024-06-20 | MIT | 6 |
| `rete` | 2.0.6 | 2025-06-30 | MIT | 1 |
| `rete-area-plugin` | 2.3.2 | 2026-07-08 | MIT | 1 |
| `rete-react-plugin` | 2.1.2 | 2026-07-10 | MIT | 2 |
| `rete-connection-plugin` | 2.0.5 | **2024-08-30** | MIT | 1 |
| `rete-engine` | 2.1.1 | **2024-12-27** | MIT | 1 |
| `litegraph.js` | 0.7.18 | **2024-01-08** | MIT | 0 |
| `@comfyorg/litegraph` | 0.17.2 | 2025-08-06 | MIT | 0 |
| `blockly` | 13.3.0 | 2026-09-10 | Apache-2.0 | 0 |
| `drawflow` | 0.0.60 | 2024-09-03 | MIT | 0 |
| `@joint/core` | 4.3.3 | 2026-09-04 | MPL-2.0 | **0** |
| `jointjs` | 3.7.7 | 2023-11-07 | MPL-2.0 | 5 |
| `cytoscape` | 3.34.3 | 2026-09-07 | MIT | 0 |
| `@antv/x6` | 3.1.8 | 2026-08-11 | MIT | 4 |
| `@antv/g6` | 5.1.1 | 2026-05-08 | MIT | 11 |
| `@logicflow/core` | 2.2.5 | 2026-07-30 | Apache-2.0 | 8 |
| `butterfly-dag` | 5.1.0-beta.38 | 2024-04-20 | MIT | 7 |
| `tldraw` | 5.4.2 | 2026-09-10 | ⛔ SEE LICENSE | 16 |
| `konva` | 10.5.0 | 2026-09-08 | MIT | 0 |
| `pixi.js` | 8.20.1 | 2026-08-26 | MIT | 10 |
| `fabric` | 7.4.0 | 2026-05-18 | MIT | 0 |
| `gojs` | 4.0.3 | 2026-07-17 | ⛔ Proprietary | 0 |
| `obsidian` (typings) | 1.13.1 | 2026-06-09 | MIT | 2 |

## Appendix C — Key citations

**Obsidian:** [canvas.d.ts](https://github.com/obsidianmd/obsidian-api/blob/master/canvas.d.ts) · [CanvasPlugin internals (unofficial)](https://obsidian-typings.github.io/obsidian-typings/catalyst/api/obsidian/internals/internal-plugins/canvas/CanvasPlugin/) · [obsidian-resize-card-plugin](https://github.com/jasperyzh/obsidian-resize-card-plugin) · [obsidian-canvas-performance-patch](https://github.com/Qbject/obsidian-canvas-performance-patch) · [Sync 5 MB limit](https://github.com/logancyang/obsidian-copilot/pull/3008) · [Views API](https://docs.obsidian.md/Plugins/User+interface/Views)

**Modelica:** [Modelica 3.6 spec](https://specification.modelica.org/maint/3.6/) · [§18 Annotations](https://specification.modelica.org/maint/3.6/annotations.html) · [§9 Connectors and Connections](https://specification.modelica.org/maint/3.6/connectors-and-connections.html) · [§7.3.4 choices](https://specification.modelica.org/maint/3.6/inheritance-modification-and-redeclaration.html) · [MSL Resistor.mo](https://github.com/modelica/ModelicaStandardLibrary/blob/master/Modelica/Electrical/Analog/Basic/Resistor.mo) · [MSL First.mo (connection Line annotations)](https://github.com/modelica/ModelicaStandardLibrary/blob/master/Modelica/Mechanics/Rotational/Examples/First.mo) · [Modelica tools list](https://modelica.org/tools/)

**React Flow:** [Performance guide](https://reactflow.dev/learn/advanced-use/performance) · [LICENSE (MIT)](https://github.com/xyflow/xyflow/blob/main/LICENSE) · [issue #3883 (culling)](https://github.com/xyflow/xyflow/issues/3883)

**Others:** [Rete licensing](https://retejs.org/docs/licensing) · [Rete LOD GPU example](https://retejs.org/examples/lod-gpu) · [tldraw LICENSE](https://github.com/tldraw/tldraw/blob/main/LICENSE.md) · [GoJS pricing](https://nwoods.com/sales) · [Comfy-Org litegraph](https://github.com/Comfy-Org/litegraph.js)
