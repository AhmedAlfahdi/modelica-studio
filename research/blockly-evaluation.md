# Google Blockly as a core for an ACASUAL bidirectional physical-modeling editor

**Research date:** 2026-09-13 · **Target version:** `blockly@13.3.0` (latest stable, published 2026-09-10)
**Method:** primary sources only — official docs at `docs.blockly.com`, the `RaspberryPiFoundation/blockly` source tree (shallow sparse clone of `main`), the shipped npm tarball, the npm registry API, the GitHub **search** API (the `core` REST bucket was rate-limited from this host; `search/issues` has a separate bucket and worked), shields.io badge JSON, bundlephobia API, and **direct local builds + headless execution of Blockly 13.3.0**.

Everything below is cited. Anything I could not verify from a primary source is marked **UNVERIFIED**.

---

## ⚠️ Headline corrections to the evaluation brief

Three premises in the brief are factually wrong about Blockly. They are load-bearing, so they come first.

| Premise in the brief | Reality | Evidence |
|---|---|---|
| "a value output can feed **multiple** inputs, but each input accepts exactly ONE connection" | **False.** An output connects to **exactly one** input. Connecting it to a second input *moves* the connection. Blockly is not DAG-capable. | §1.4 — measured |
| Blockly is "Google Blockly", Google-backed | Blockly **graduated from Google to the Raspberry Pi Foundation** on 2025-11-10. Google is now a funder, not the steward. | §5 |
| "Google's docs at `developers.google.com/blockly`" | Docs moved to **`docs.blockly.com`**; the old URLs cross-origin-redirect and no longer resolve. | §5 |

---

## 1. Core data model — tree vs graph (most important section)

### 1.1 Blockly is documented as a syntactic block tree that generates code

The official "What is Blockly?" page frames the library in exactly two ways:

> "Blockly is a web library that lets you add a customizable blocks-based code editor to your app. The editor uses puzzle-piece like blocks to represent code concepts like variables, logical expressions, loops, and more."
> — [docs.blockly.com/guides/get-started/what-is-blockly](https://docs.blockly.com/guides/get-started/what-is-blockly/)

> "Breaking it down further, you can think of Blockly in two ways: 1. Like a fun puzzle-piece UI. 2. **Like a fancy string builder.** You define the string (usually code) that gets generated for each block, and then Blockly handles concatenating whole strings of blocks."
> — [same page](https://docs.blockly.com/guides/get-started/what-is-blockly/)

The architecture doc states the object model outright:

> "**The objects in a block form a tree-shaped object.** Understanding how the graphical representation of a block corresponds to this tree is helpful when you write code to manipulate blocks programmatically."
> — [`block-anatomy.mdx` L281-283](https://docs.blockly.com/guides/create-custom-blocks/define/block-anatomy/), source [`packages/docs/docs/guides/create-custom-blocks/define/block-anatomy.mdx`](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/docs/docs/guides/create-custom-blocks/define/block-anatomy.mdx)

The render pipeline also assumes tree structure and tree-order traversal:

> "**Rerender the set (as a tree).** When the `requestAnimationFrame` callback gets called, the render management system renders every block in the set **from leaf blocks to root blocks**. This makes sure that child blocks have accurate size information before their parent blocks are rendered so the parent blocks can stretch around their children."
> — [Render management](https://docs.blockly.com/guides/contribute/core/core-architecture/render-management/)

And the official attribution guidance explicitly forbids calling Blockly a language, because the product is a code-generation library:

> "**Don't** — Refer to Blockly as a language (for example, as a 'block-based programming language'). Blockly is not a language, it's a library that developers use to make a block-based visual programming interface."
> — [Attribute Blockly](https://docs.blockly.com/guides/app-integration/attribution/)

**Conclusion:** Blockly's stated purpose is *syntax-tree → text generation*, not *graph modeling*.

### 1.2 Connection types: four, strictly paired, directed

`ConnectionType` is a four-member enum with no bidirectional or undirected member:

```ts
export declare enum ConnectionType {
  INPUT_VALUE = 1,
  OUTPUT_VALUE = 2,
  NEXT_STATEMENT = 3,
  PREVIOUS_STATEMENT = 4
}
```
— [`core/connection_type.ts`](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/connection_type.ts), verified in the shipped tarball at `node_modules/blockly/core/connection_type.d.ts`

Compatibility is a **strict opposite-type pairing** via `OPPOSITE_TYPE`:

```ts
export const OPPOSITE_TYPE: number[] = [];
OPPOSITE_TYPE[ConnectionType.INPUT_VALUE] = ConnectionType.OUTPUT_VALUE;
OPPOSITE_TYPE[ConnectionType.OUTPUT_VALUE] = ConnectionType.INPUT_VALUE;
OPPOSITE_TYPE[ConnectionType.NEXT_STATEMENT] = ConnectionType.PREVIOUS_STATEMENT;
OPPOSITE_TYPE[ConnectionType.PREVIOUS_STATEMENT] = ConnectionType.NEXT_STATEMENT;
```
— [`core/internal_constants.ts` L23-28](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/internal_constants.ts)

`OPPOSITE_TYPE` is **publicly exported** (`blockly.ts` L349), so this pairing is part of the supported API surface.

### 1.3 The type rule is enforced in `doSafetyChecks`

```ts
doSafetyChecks(a: Connection | null, b: Connection | null): number {
  if (!a || !b) return Connection.REASON_TARGET_NULL;
  // ... determine superior/inferior by isSuperior() ...
  if (superiorBlock === inferiorBlock) {
    return Connection.REASON_SELF_CONNECTION;
  } else if (
    inferiorConnection.type !==
    internalConstants.OPPOSITE_TYPE[superiorConnection.type]
  ) {
    return Connection.REASON_WRONG_TYPE;
  } else if (superiorBlock.workspace !== inferiorBlock.workspace) {
    return Connection.REASON_DIFFERENT_WORKSPACES;
  }
  // ... shadow-parent and previous+output checks ...
  return Connection.CAN_CONNECT;
}
```
— [`core/connection_checker.ts`](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/connection_checker.ts), `doSafetyChecks`

Rejection reasons are a closed enum: `REASON_SELF_CONNECTION=1, REASON_WRONG_TYPE=2, REASON_TARGET_NULL=3, REASON_CHECKS_FAILED=4, REASON_DIFFERENT_WORKSPACES=5, REASON_SHADOW_PARENT=6, REASON_DRAG_CHECKS_FAILED=7, REASON_PREVIOUS_AND_OUTPUT=8` ([`core/connection.ts` L31-38](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/connection.ts)).

The `IConnectionChecker` interface documents this as a *basic assumption* of the library:

> "Check that connecting the given connections is safe, meaning that it would **not break any of Blockly's basic assumptions (e.g. no self connections)**."
> — [`core/interfaces/i_connection_checker.ts`](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/interfaces/i_connection_checker.ts)

Connection *checks* (`checkType` / `setCheck` / `doTypeChecks`) are a **separate, additive** string-matching layer on top of this, not a replacement:

> "Two connections can connect if: 1. They are **compatible types** (e.g. an output connecting to an input). 2. They have at least one string in their connection check in common."
> — [Connection checks](https://docs.blockly.com/guides/create-custom-blocks/inputs/connection-checks/)

So type compatibility is a *precondition*; check strings only further restrict which of the legal pairings are allowed.

### 1.4 A connection point accepts exactly ONE partner — measured

This is the crux, and it is provable three ways.

**(a) The data structure is a scalar, not a list.**
```ts
/** Connection this connection connects to.  Null if not connected. */
targetConnection: Connection | null = null;
```
— [`core/connection.ts` L43](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/connection.ts)

```ts
function connectReciprocally(first: Connection, second: Connection) {
  if (!first || !second) throw Error('Cannot connect null connections.');
  first.targetConnection = second;
  second.targetConnection = first;
}
```
— [`core/connection.ts` L743-749](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/connection.ts)

**(b) `connect_` actively disconnects any incumbent.** The routine frees both endpoints before attaching:
```ts
// Make sure the childConnection is available.
if (childConnection.isConnected()) childConnection.disconnectInternal(false);
// Make sure the parentConnection is available.
let orphan;
if (this.isConnected()) { /* stash shadow state; disconnect or dispose incumbent */ }
```
— [`core/connection.ts` L101-123](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/connection.ts)

**(c) Measured behaviour (Blockly 13.3.0, headless `new Blockly.Workspace()`):**
```
connect(num.outputConnection -> a1.getInput('A'))  => true
connect(num.outputConnection -> a1.getInput('B'))  => true
after: num.outputConnection.targetConnection is B   => true
after: num.outputConnection still connected to A    => FALSE
input A's targetBlock()                             => null
FANOUT_SUPPORTED = false
```
The second `connect()` **moved** the wire; it did not fan out. Each input also holds at most one child — the drag-time code comments this explicitly:

> "// Don't offer to connect an already connected left (male) value plug to an available right (female) value plug."
> — [`core/connection_checker.ts`](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/connection_checker.ts), `doDragChecks`, `case ConnectionType.OUTPUT_VALUE`

**(d) A `Block` has exactly one output slot** — but many inputs:
```ts
outputConnection: Connection | null = null;
nextConnection: Connection | null = null;
previousConnection: Connection | null = null;
inputList: Input[] = [];
```
— [`core/block.ts` L169-172](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/block.ts)

And the docs confirm:
> "A block **may have a single output connection**, represented as a male jigsaw connector on the leading edge."
> "Blocks with an output connector **cannot also have a previous statement notch**."
> — [Top-level connections](https://docs.blockly.com/guides/create-custom-blocks/define/top-level-connections/)

**Measured type-compatibility matrix (no drag):**
| Attempt | `connect()` result |
|---|---|
| output → input | `true` |
| input → input | **`false`** |
| output → output | **`false`** |

Direct answer to the parent's question: **two value inputs can never be connected to each other, and an output can never connect to an output.** Only `INPUT_VALUE↔OUTPUT_VALUE` and `NEXT_STATEMENT↔PREVIOUS_STATEMENT` pairings are legal.

### 1.5 A block has exactly ONE parent — the model is a forest

```ts
protected parentBlock_: this | null = null;
```
— [`core/block.ts` L179](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/block.ts)

`setParent` **throws** if the connection topology is inconsistent:
```ts
if (isConnected && newParent && targetBlock !== newParent) {
  throw Error('Block connected to superior one that is not new parent.');
} else if (!isConnected && newParent) {
  throw Error('Block not connected to new parent.');
} else if (isConnected && !newParent) {
  throw Error('Cannot set parent to null while block is still connected to superior block.');
}
```
— [`core/block.ts` L731-751](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/block.ts)

Combined with §1.4, this is a **strict rooted tree per connected component** (a forest over top-level blocks). It is not a DAG: there is no mechanism by which two parents can share a child or a value can be consumed twice.

### 1.6 Cycles: forbidden by the drag UI, *permitted* by the API, and they corrupt the workspace

This is the most important finding in the report, and it is measured, not inferred.

**The descendant/cycle guard exists in exactly two places, both inside `doDragChecks`:**
```ts
// (end of doDragChecks)
// Don't let blocks try to connect to themselves or ones they nest.
if (common.draggingConnections.includes(b)) {
  return false;
}
return true;
```
```ts
protected canConnectToPrevious_(a: Connection, b: Connection): boolean {
  if (a.targetConnection) {
    // This connection is already occupied.
    // A next connection will never disconnect itself mid-drag.
    return false;
  }
  // Don't let blocks try to connect to themselves or ones they nest.
  if (common.draggingConnections.includes(b)) {
    return false;
  }
  ...
}
```
— [`core/connection_checker.ts`](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/connection_checker.ts)

`draggingConnections` is populated from the dragged block **and all of its descendants**, because `setDragging` recurses:
```ts
setDragging(adding: boolean) {
  this.dragging = adding;
  if (adding) {
    this.translation = '';
    common.draggingConnections.push(...this.getConnections_(true));
    this.addClass('blocklyDragging');
  } else {
    common.draggingConnections.length = 0;
    ...
  }
  // Recurse through all blocks attached under this one.
  for (let i = 0; i < this.childBlocks_.length; i++) {
    (this.childBlocks_[i] as BlockSvg).setDragging(adding);
  }
}
```
— [`core/block_svg.ts` L752-766](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/block_svg.ts)

**But `doDragChecks` is skipped for programmatic connections.** `canConnectWithReason` only runs drag checks when `isDragging` is true:
```ts
if (isDragging && !this.doDragChecks(a, b, opt_distance || 0)) {
  return Connection.REASON_DRAG_CHECKS_FAILED;
}
```
— [`core/connection_checker.ts`](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/connection_checker.ts), `canConnectWithReason`

…and the public `Connection.connect()` passes **`false`**:
```ts
connect(otherConnection: Connection): boolean {
  ...
  if (checker.canConnect(this, otherConnection, false)) {   // <-- isDragging = false
```
— [`core/connection.ts` L247](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/connection.ts)

Every programmatic call site in core uses `false` (`connection.ts:247,401,730,770`; `block.ts:449,521`); only the drag-insertion paths use `true` (`block_drag_strategy.ts:442,1168,1288`; `connection_db.ts:277,290`).

**Measured consequence — headless (model only):**
```
connect(x.out -> y.A): true
connect(y.out -> x.A): true          <-- NOT rejected
x.parent === y ? true
y.parent === x ? true
>>> CYCLE_CREATED_HEADLESS = true
workspace.getTopBlocks().length = 0   <-- both blocks become unreachable
serialize OK, serialized top blocks = 0   <-- SILENT TOTAL DATA LOSS
```

**Measured consequence — rendered workspace (SVG):**
```
connect(x.out -> y.A): true
connect(y.out -> x.A): threw DOMException: HierarchyRequestError:
  "The operation would yield an incorrect node tree."
```
The SVG DOM physically cannot nest a group inside its own descendant, so the renderer crashes rather than erroring cleanly.

So a cycle is either (a) accepted into the model and then **silently dropped by serialization**, leaving `getTopBlocks()` empty, or (b) a hard `DOMException` in a rendered workspace. Either way it is not a supported state.

### 1.7 There is no "graph mode" — and general node/graph support has been an open request since 2020

* **Docs:** a full-text grep of the entire documentation corpus (`packages/docs/docs`, 235 `.mdx`/`.md` files) finds **zero** occurrences of "cycle" in the graph-theoretic sense, and **no** mention of a graph mode, node editor, or multi-connection port. The only "graph" hits are about *charts* (the "Graph" sample app) and *graph paper* (grid styling).
* **Source:** a grep of `packages/blockly/core` (328 `.ts` files) finds no cycle-detection utility, no adjacency structure, and no graph serialization path.
* **Issue tracker — the definitive citation:**
  > **#10364 "Blockly and Nodes/Graphs"** — opened **2020-07-05**, still **OPEN**, label `area: plugins`, 1 comment.
  > "**Today nodes/graphs become vitally important and Blockly at the moment doesn't support nodes**"
  > "We're thinking to nodes like Blender Nodes so is it possible to develop such nodes based on Blockly?"
  > "I think Blockly has the infrastructure to add nodes and its ports (as blocks)"
  > — [issue #10364](https://github.com/RaspberryPiFoundation/blockly/issues/10364)

  This is precisely the ACASUAL use case (Blender-style node editor with typed ports), filed **six years ago**, labelled as a *plugin* concern, and never implemented.
* Other searches: `repo:… "graph" in:title` → 4 results, only #10364 relevant. `webgl` → **0 results, ever**. `bidirectional` → 2 results, neither about ports.
* **No official "graph mode" exists**, and no community plugin providing general graph semantics was found. **UNVERIFIED:** there may be private/abandoned forks adding graph support; nothing in the official plugin index ([blockly-samples](https://raspberrypifoundation.github.io/blockly-samples/)) provides it.

### 1.8 Section conclusion

**Blockly is a tree editor, not a graph editor, and not DAG-capable.**

| Capability needed for ACASUAL modeling | Blockly |
|---|---|
| Arbitrary directed graph | ❌ Forest of rooted trees only |
| Cycles / algebraic loops | ❌ Drag-blocked; API-permitted but corrupts workspace |
| Fan-out (one source feeds N sinks) | ❌ Impossible; connecting again *moves* the wire |
| Fan-in (N sources into one port) | ⚠️ Only via N distinct typed *inputs* on one block, each single-occupancy |
| Undirected connections | ❌ Every connection is directed and male/female |
| Bidirectional effort/flow pair on one wire | ❌ No such concept; no single connection type carries two signals |
| Multi-connection port (bus) | ❌ `targetConnection` is a scalar |
| Typed ports | ✅ Excellent — `setCheck` + custom `IConnectionChecker` |
| Generic/parametric port types | ⚠️ Documented as a limitation: "This system does not, by itself, support defining generic types… There is no good work around for this case." ([connection checks](https://docs.blockly.com/guides/create-custom-blocks/inputs/connection-checks/)) |

The tree assumption is not a missing feature bolted on top — it is load-bearing across `parentBlock_`, the four-member `ConnectionType` enum, `OPPOSITE_TYPE`, SVG group nesting, serialization, and code generation. Removing it means rewriting Blockly.

---

## 2. Rendering

### 2.1 Blockly renders to SVG — confirmed

* `export const SVG_NS = 'http://www.w3.org/2000/svg';` and `createSvgElement()` using `document.createElementNS(SVG_NS, …)` — [`core/utils/dom.ts` L15, L54-59](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/utils/dom.ts)
* Each block owns an `SVGGElement`: `private svgGroup: SVGGElement;` … `this.svgGroup = dom.createSvgElement(Svg.G, {})` — [`core/block_svg.ts` L154, L198](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/block_svg.ts)
* Docs: "The [`Drawer`] builds **SVG paths** based on the renderer info and passes them to the path object." — [Drawer](https://docs.blockly.com/guides/create-custom-blocks/renderers/concepts/drawer/)
* Docs: "The [`PathObject`] contains the **SVG elements in the DOM** that make up the block." — [Path object](https://docs.blockly.com/guides/create-custom-blocks/renderers/concepts/path-object/)
* Blocks can contain an embedded `<foreignObject>` only in specific cases; the workspace itself is the SVG. **UNVERIFIED:** the exact proportion of DOM nodes that are SVG vs HTML in a typical workspace was not measured.

### 2.2 The three built-in renderers

| Renderer | Docs description | Registration |
|---|---|---|
| **Geras** | "The **default** renderer. It is the original renderer that Blockly was built with." | `blockRendering.register('geras', …)` |
| **Thrasos** | "The **recommended** renderer. It is a more modern take on the geras renderer, with more even spacing and solid borders." | `blockRendering.register('thrasos', …)` |
| **Zelos** | "A renderer based on **Scratch-3.0** block design." | `blockRendering.register('zelos', …)` |

— [Renderers](https://docs.blockly.com/guides/create-custom-blocks/renderers/overview/); registrations confirmed in source at `renderers/{geras,thrasos,zelos}/renderer.ts` (e.g. `blockRendering.register('zelos', Renderer)` — [`renderers/zelos/renderer.ts` L106](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/renderers/zelos/renderer.ts)).

**Note the doc inconsistency worth flagging:** the docs table calls Thrasos "recommended" while Geras is "default", and the code confirms the *actual* default is Geras:
```ts
this.options.renderer || 'geras',
```
— [`core/workspace_svg.ts` L437](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/workspace_svg.ts)

API reference: `Blockly.blockRendering.Renderer` and friends — [reference/namespaces/blockRendering](https://docs.blockly.com/reference/namespaces/blockRendering/classes/Renderer).

### 2.3 There is NO Canvas or WebGL renderer — and there is no evidence one was ever attempted

This is a clear negative finding.

* **Core source:** a grep for `webgl` across all 328 files in `packages/blockly/core` returns **zero** matches. The only `canvas` in core is a hidden offscreen element used purely for **text measurement**:
  ```ts
  if (!canvasContext) {
    // Inject the canvas element used for computing text widths.
    const computeCanvas = document.createElement('canvas');
    computeCanvas.className = 'blocklyComputeCanvas';
    document.body.appendChild(computeCanvas);
    canvasContext = computeCanvas.getContext('2d');
  }
  // Measure the text width using the helper canvas context.
  canvasContext.font = fontWeight + ' ' + fontSize + ' ' + fontFamily;
  width = Math.ceil(canvasContext.measureText(text).width);
  ```
  — [`core/utils/dom.ts` L296-313](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/utils/dom.ts)
* **Docs:** zero occurrences of "webgl" or "canvas renderer" in the documentation corpus.
* **Issue tracker:** `repo:RaspberryPiFoundation/blockly webgl` → **`total_count: 0`**. Searching `canvas renderer` returns only 2 unrelated issues that use "canvas" to mean the HTML *page area* (e.g. #9815 "[v13.0.0-beta.2] Block move causes container to shift on canvas").
* Performance work in the tracker is about the **SVG** pipeline instead — e.g. render batching ([#6978](https://github.com/RaspberryPiFoundation/blockly/issues/6978)), drag performance ([#3094](https://github.com/RaspberryPiFoundation/blockly/issues/3094)), load performance ([#7395](https://github.com/RaspberryPiFoundation/blockly/issues/7395)), and `getRelativeToSurfaceXY()` optimisation ([PR #10177](https://github.com/RaspberryPiFoundation/blockly/pull/10177)).

**Stated explicitly: there is no Canvas renderer, no WebGL renderer, no partially-landed experiment, and no open issue or roadmap item proposing one.** The renderer abstraction (`Renderer` → `ConstantProvider` / `RenderInfo` / `PathObject` / `Drawer`) is SVG-shaped end-to-end: `PathObject` is documented as owning "the SVG elements in the DOM" and `Drawer` as building "SVG paths". A Canvas/WebGL backend would require replacing the entire renderer layer, not just the leaf drawing calls.

**Practical implication for a large schematic:** a Blockly workspace with thousands of nodes pays the full SVG DOM cost — one `<g>` plus multiple `<path>` per block (Geras uses three paths per block: main/dark/light, per the Path object doc). **UNVERIFIED:** I did not benchmark a multi-thousand-block workspace; no official large-workspace performance figures were found.

---

## 3. Bundle size (minified + gzip) — measured

### 3.1 Method

```bash
mkdir -p /tmp/blmeasure && cd /tmp/blmeasure && npm init -y
env -u npm_config_allow_scripts npm install --no-audit --no-fund --ignore-scripts blockly esbuild
# entry_full.js:    export * as Blockly from 'blockly';
# entry_core.js:    export * as Blockly from 'blockly/core';
# entry_core_js.js: export * as Blockly from 'blockly/core'; export * as javascript from 'blockly/javascript';
./node_modules/.bin/esbuild entry_<x>.js --bundle --minify --format=esm \
    --target=es2020 --legal-comments=none --outfile=out_<x>.js
gzip -9 -c out_<x>.js | wc -c
```

Toolchain: `blockly@13.3.0`, `esbuild@0.28.2`, Node `v22.23.2`, npm `12.0.2`. Reproduced twice with identical results.

### 3.2 Results

| Entry point | Minified raw (bytes) | **Minified + gzip -9 (bytes)** | gzip ratio |
|---|---|---|---|
| `blockly` (core + all blocks + JS generator) | 753,783 | **201,894** | 26.8% |
| `blockly/core` only (all 3 renderers) | 641,673 | **177,681** | 27.7% |
| `blockly/core` + `blockly/javascript` only | 670,166 | **185,777** | 27.7% |

Tree-shaking gives only a modest saving: dropping all standard blocks and the JS generator saves **24,213 B gzip (~12%)** off the full build. The remaining 178 KB gzip is the core engine, which still ships **all three renderers**, the full accessibility/focus infrastructure, keyboard navigation, the toolbox/flyout system, zoom controls, comments, variables, and procedures.

### 3.3 Cross-check against bundlephobia

bundlephobia API for the same version ([`bundlephobia.com/api/size?package=blockly@13.3.0`](https://bundlephobia.com/package/blockly)):

| Source | Minified | gzip |
|---|---|---|
| bundlephobia | 746,656 | 200,311 |
| my esbuild measurement | 753,783 | 201,894 |
| **delta** | **+7,127 (+0.95%)** | **+1,583 (+0.79%)** |

**The two agree within 1%.** The small positive delta is expected and benign: bundlephobia's own toolchain (browserify + terser with its own defaults) differs slightly from esbuild 0.28.2 targeting ES2020, and gzip -9 stream framing differs marginally. Treat the size as **≈ 0.20 MB gzip (full) / ≈ 0.18 MB gzip (core only)**.

Other npm facts: **zero runtime dependencies** (`dependencies` is absent from `package.json`), `engines: { node: ">=22" }`, and the package tracks `blockly@13.3.0` npm downloads at **361,798/month** (2026-08-13 → 2026-09-11, [npm downloads API](https://api.npmjs.org/downloads/point/last-month/blockly)).

---

## 4. License

* **Apache-2.0.** Confirmed four ways:
  1. The `LICENSE` file in the repository is the verbatim Apache License 2.0 text ([`LICENSE`](https://github.com/RaspberryPiFoundation/blockly/blob/main/LICENSE)).
  2. `package.json` → `"license": "Apache-2.0"` (verified in the installed tarball).
  3. shields.io GitHub license badge → `Apache-2.0` ([shields JSON](https://img.shields.io/github/license/google/blockly.json)).
  4. The official FAQ: "**Yes. Blockly's core library is free and open source under the Apache 2.0 license.** The Raspberry Pi Foundation is committed to the long-term growth of Blockly's open code base and developer community." — [blockly.com FAQ](https://blockly.com/)
* All source files carry `SPDX-License-Identifier: Apache-2.0` headers (e.g. `core/connection.ts`, `core/internal_constants.ts`).
* **No `NOTICE` file** is shipped in the npm package. **UNVERIFIED:** whether the repository contains a separate `NOTICE`/`AUTHORS` file — my sparse checkout was limited to `packages/`, and the repo root listing showed no `NOTICE`.
* The Apache-2.0 `LICENSE` text contains only the unmodified boilerplate `Copyright [yyyy] [name of copyright owner]` placeholder — there is **no** project-specific copyright-holder line. So the license is Apache-2.0 with no added attribution requirement.

### Trademark / branding restrictions

These are **not** in the FAQ. They live in the attribution guide — the only place in the docs where "permission" and "brand" appear:

> "**Blockly's code is open source and free to use without attribution.** However, we do encourage developers who are using Blockly to reference the product in their website, app, or product."
> "**Do not use the Blockly mark or any variant of the Blockly mark in conjunction with the overall name of your application, product, service, or website without permission from the Blockly team** (please email support@blockly.com to request permission). Do not alter or use the Blockly mark in a way that may be confusing or misleading, and never use Blockly branding as the most prominent element on your page."
> "**Don't** — Refer to Blockly as a language…"
> — [Attribute Blockly](https://docs.blockly.com/guides/app-integration/attribution/)

Prescribed attribution wording for the editor's About/credits screen:
> "Blockly is an open-source developer library from the Raspberry Pi Foundation, originally developed at Google. It creates a visual programming interface that uses drag-and-drop blocks."
> …and for an app built on it, use the phrase **"Built with Blockly"**.
> — [same page](https://docs.blockly.com/guides/app-integration/attribution/)

**Bottom line for this project:** the *code* is Apache-2.0 with no attribution obligation and no copyleft. The *name and logo* are the constrained part: you may not put "Blockly" in the product name, and you must not call the product a "language". For a Modelica editor this is a non-issue unless someone wanted to brand it "Blockly for Modelica".

---

## 5. Maintenance, governance, backing, adopters

### 5.1 Governance change — the single most important maintenance fact

**Blockly is no longer a Google project.** It moved to the Raspberry Pi Foundation on **2025-11-10**.

> "From 10 November 2025, the Blockly open source library and assets, and key members of the Blockly team will transition from Google to the Raspberry Pi Foundation."
> "Finally, I want to say a huge thank you to Google for their support for Blockly over the years, and for enabling this transition with **generous grant funding**."
> — Philip Colligan, CEO, Raspberry Pi Foundation, [The new home for Blockly](https://www.raspberrypi.org/blog/new-home-for-blockly/), 2025-10-28

> "Today we're announcing that Blockly, Google's open source library for drag-and-drop programming, is moving to the stewardship of the Raspberry Pi Foundation on November 10, 2025."
> "**Blockly will continue to be free and open source, and existing projects do not need to change anything about how they use Blockly.**"
> — Rachel Fenichel, Blockly, [Google Open Source Blog](https://opensource.googleblog.com/2025/10/blockly-graduates-from-google.html), 2025-10-28

Current stewardship, verbatim from every docs page footer:
> "Blockly is an open source project of the Raspberry Pi Foundation, **a UK registered charity (1129409)**, **supported by Google**."

And from the site: "**Google.org supports Blockly's future**… This support reflects Google.org's commitment to building computational thinking in learners…" — [blockly.com](https://blockly.com/)

Corroborating hard evidence of the handover in package metadata: the npm `repository` field flipped from `google/blockly` to `RaspberryPiFoundation/blockly` at **v12.5.0 (2026-03-19)**, and `google/blockly` now HTTP-redirects to `RaspberryPiFoundation/blockly`. The docs site moved from `developers.google.com/blockly` to `docs.blockly.com` (the old URLs cross-origin-redirect and cannot be fetched directly).

**So: do not describe Blockly as "Google-backed".** Correct framing: *"an open-source project of the Raspberry Pi Foundation (UK charity 1129409), originally developed at Google, and supported by Google.org grant funding."*

### 5.2 Release activity

| Metric | Value | Source |
|---|---|---|
| Latest stable | **13.3.0**, published **2026-09-10** | [npm registry](https://registry.npmjs.org/blockly) |
| Total published versions | 180 (first: `2013-08-15`) | npm registry |
| Latest release notes | 13.3.0 — keyboard/toolbox nav shortcuts, TypeDoc API docs, ~14 bug fixes | [`CHANGELOG.md`](https://github.com/RaspberryPiFoundation/blockly/blob/main/CHANGELOG.md) |
| Stars | **14k** (shields); parent measured **13,557** via ungh.cc | [shields JSON](https://img.shields.io/github/stars/RaspberryPiFoundation/blockly.json) |
| Forks | 3.9k | shields |
| Contributors | 267 | [shields](https://img.shields.io/github/contributors/RaspberryPiFoundation/blockly.json) |
| Commit activity | **78/month**; **659/year** | [shields](https://img.shields.io/github/commit-activity/m/google/blockly.json) |
| Last commit | "last friday" (shields); parent verified `pushedAt` 2026-09-12, `main` tip 2026-09-11 via commit atom feed | shields / parent |
| Open issues | 406 | [shields](https://img.shields.io/github/issues/google/blockly.json) |
| npm downloads | 361,798/month | npm downloads API |
| Runtime dependencies | **0** | `package.json` |

**Release cadence:** roughly **monthly**, with beta pre-releases before majors. 2026 stable releases: `12.4.0` (02-18), `12.4.1` (02-18), `12.5.0` (03-19), `12.5.1` (03-20), `13.0.0` (06-15), `13.1.0` (06-29), `13.1.1` (07-06), `13.2.0` (07-27), `13.2.1` (08-04), `13.3.0` (09-10). Note the ~3-month gap between `12.5.1` and `13.0.0`, spanned by nine `13.0.0-beta.*` releases (05-04 → 06-10) — i.e. majors get a long public beta runway. Patch releases land within days to weeks of a minor.

**Assessment: actively and healthily maintained** — steady commits, predictable monthly releases, a paid core team, a public changelog, and a documented contribution process. There is no abandonment risk signal.

### 5.3 Notable adopters

From the official site and the transition announcements:

> "Blockly is the foundation for some of the largest block-based coding products, such as **Scratch** and **Code.org**, which serve tens of millions of students each year."
> — [blockly.com](https://blockly.com/)

> "Platforms like **Scratch, MakeCode, and MIT's App Inventor** are all built with Blockly. It's no exaggeration to say that hundreds of millions of young people have learnt the fundamentals of computer science using software that is built with Blockly."
> — [Raspberry Pi Foundation](https://www.raspberrypi.org/blog/new-home-for-blockly/)

> "Educational platforms such as Scratch, MakeCode, and **LEGO Education** use Blockly…"
> — [Google Open Source Blog](https://opensource.googleblog.com/2025/10/blockly-graduates-from-google.html)

The site's partner wall additionally lists **micro:bit, Ozoblockly, Open Roberta, Wonder Workshop, Piper, CodeBug, Blockly Games, Gamefroot, Varwin, QuantStack, CodeCraft Works, Scriptr, Koding Kılavuzu/KodeKlix, Unruly Splats**, and cites **100+ "Built with Blockly" partners**, **94+ languages supported**, and **12+ years of contributions** ([blockly.com](https://blockly.com/)).

**Relevance caveat:** these adopters are ~all **education/block-coding** products. Blockly's ecosystem, docs, codelabs, plugins, and roadmap are oriented to that domain. The Raspberry Pi Foundation announcement does note that "while its main use cases are in education, **Blockly is increasingly being used to build industrial and commercial applications**" — but I found **no** substantial engineering-simulation adopters. **UNVERIFIED:** no adopter in the CAD/CAE/physical-modeling space was identified.

---

## 6. Editor features relevant to an engineering editor

### 6.1 Zoom and pan — fully supported

Configuration ([Zoom option](https://docs.blockly.com/guides/configure/zoom/)):
```js
Blockly.inject('blocklyDiv', {
  zoom: {
    controls: true,     // zoom-centre / zoom-in / zoom-out buttons; default false
    wheel: true,        // mouse-wheel zoom; default false
    startScale: 1.0,    // default 1.0
    maxScale: 3,        // default 3
    minScale: 0.3,      // default 0.3
    scaleSpeed: 1.2,    // scale = scaleSpeed ^ steps; default 1.2
    pinch: true,        // default true if wheel or controls is true
  },
});
```

Programmatic API on `WorkspaceSvg` (verified in `core/workspace_svg.ts`): `zoom(x, y, amount)` L1897, `zoomCenter(type)` L1944, `setScale(newScale)` L2120, `getScale()` L2173, `scroll(x, y, shouldHidePopups?)` L2241, `scrollCenter()` L2034, `centerOnBlock(id, blockOnly?)` L2061, `beginCanvasTransition()` L2018.

There is a `Blockly.Component` component-manager system (`core/component_manager.ts`) that coordinates workspace UI components (zoom controls, trashcan, etc.) for position/visibility. **UNVERIFIED:** the brief asked specifically about `Blockly.Component`; I confirmed the module exists and is used by `zoom_controls.ts`, but did not enumerate its full public API.

**Verdict: zoom/pan is a solved, first-class, well-documented feature.** This is genuinely good for your use case.

### 6.2 Parameter dialogs — fields

**Important correction to the brief's premise:** `FieldColour` and `FieldAngle` are **no longer built-in**. They are separate plugin packages. Measured against the installed `blockly@13.3.0` public API:
```
FieldNumber: function | FieldTextInput: function | FieldDropdown: function
FieldVariable: function | FieldCheckbox: function | FieldLabel: function
Field: function
FieldAngle: undefined   (plugin only)
FieldColour: undefined  (plugin only)
```
The docs list the split explicitly ([Built-in fields](https://docs.blockly.com/guides/create-custom-blocks/fields/built-in-fields/overview/)):

* **Built-in (8):** Checkbox, Dropdown, Image, Label, Serializable label, Number, Text input, Variable.
* **Plugin fields:** Angle picker (`@blockly/field-angle`), Bitmap, Colour picker (`@blockly/field-colour`), Colour-HSV, Date, Dropdown grid, Dependent dropdown, Multiline input, Number slider (`@blockly/field-slider`).

I confirmed these plugin packages exist on npm and are versioned in lockstep with core — `@blockly/field-angle`, `@blockly/field-colour`, `@blockly/field-slider`, `@blockly/field-bitmap` are all at **v13.3.0, published 2026-09-10, Apache-2.0**. So they are first-party-quality but a **separate install**.

**The Field extension mechanism** ([Fields overview](https://docs.blockly.com/guides/create-custom-blocks/fields/overview/), [Create a custom field](https://docs.blockly.com/guides/create-custom-blocks/fields/customizing-fields/creating/)): subclass `Blockly.Field`, optionally register with `Blockly.fieldRegistry.register('field_generic', GenericField)` + a `fromJson`, override `doClassValidation_` / `doValueUpdate_` / `doValueInvalid_` / `render_` / `updateSize_` / `bindEvents_` / `dispose`, and configure via `EDITABLE` / `SERIALIZABLE` plus `saveState`/`loadState` (JSON) or `toXml`/`fromXml` (legacy XML). Validators provide per-field value coercion. This is a clean, well-documented extension point — **good for parameter dialogs** (unit-aware numbers, material property pickers, parameter-binding dropdowns).

### 6.3 Parameter dialogs — mutators (the "configure arity/shape" mechanism)

A mutator is Blockly's answer to "let the user change this block's parameter count/shape" ([Mutators](https://docs.blockly.com/guides/create-custom-blocks/mutators/)):

> "A mutator is a **mixin that adds extra serialization** (extra state that gets saved and loaded) to a block. For example, the built-in `controls_if` and `list_create_with` blocks need extra serialization so that they can save **how many inputs they have**. It may also add a UI so the user can change the block's shape."

Mechanism:
* **Serialization hooks:** `saveExtraState()` / `loadExtraState()` (JSON) or `mutationToDom()` / `domToMutation()` (XML).
* **UI hooks:** defining `compose` and `decompose` makes Blockly add a default mutator UI — "a clickable **gear icon** which opens the mutator UI in a **bubble**". `decompose` "explodes" the block into sub-blocks in a mini workspace; `compose` reads that configuration back and reshapes the main block. Optional `saveConnections` associates existing children with sub-blocks so they re-attach.
* **Registration:** `Blockly.Extensions.registerMutator(name, mixinObj, opt_helperFn, opt_blockList)` and `"mutator": "controls_if_mutator"` in the block's JSON. "each block type may only have one mutator."
* `MutatorIcon` manages the bubble; you can supply a fully custom UI (the [block-plus-minus plugin](https://github.com/RaspberryPiFoundation/blockly/tree/main/packages/plugins/block-plus-minus) does).

**This maps reasonably well onto "configure a component's parameter list"** — e.g. a resistor whose parameter set is R, or a connector whose arity is user-set. It's the closest thing Blockly has to a schematic symbol's property dialog, and it's a supported, documented path.

### 6.4 Custom block rendering — how to draw arbitrary symbols (the resistor question)

#### The supported layers, from high-level to low-level

**1. Custom renderer (subclass `Renderer`)** — changes how *all* blocks look. [`Create custom renderers`](https://docs.blockly.com/guides/create-custom-blocks/renderers/create-custom-renderers/basic-implementation/):
```js
class CustomRenderer extends Blockly.blockRendering.Renderer { constructor() { super(); } }
// or subclass a built-in:
class CustomRenderer extends Blockly.thrasos.Renderer { constructor() { super(); } }

Blockly.blockRendering.register('custom_renderer', CustomRenderer);
const workspace = Blockly.inject(blocklyDiv, { renderer: 'custom_renderer' });
```
Plus the four factory overrides: `makeConstants_`, `makeRenderInfo_`, `makePathObject` (no underscore), `makeDrawer_`.

**2. `ConstantProvider` — custom connection shapes.** This is the officially supported "custom path" hook, and it is precisely how you'd draw non-jigsaw connection geometry:
> "Basic shapes have a height, a width, and **two_ paths**. Each path draws the same shape, but from opposite ends! … You can override the `makeNotch` method for next and previous connections, and the `makePuzzleTab` method for input and output connections."
```js
class CustomConstantProvider extends Blockly.blockRendering.ConstantProvider {
  makePuzzleTab() {
    const width = this.TAB_WIDTH, height = this.TAB_HEIGHT;
    return {
      type: this.SHAPES.PUZZLE, width, height,
      pathUp: Blockly.utils.svgPaths.line([
        Blockly.utils.svgPaths.point(-width, -height / 2),
        Blockly.utils.svgPaths.point(width, -height / 2)]),
      pathDown: Blockly.utils.svgPaths.line([
        Blockly.utils.svgPaths.point(-width, height / 2),
        Blockly.utils.svgPaths.point(width, height / 2)]),
    };
  }
}
```
> "The `Blockly.utils.svgPaths` namespace is provided as a thin wrapper around these strings to make them more readable."
— [`Connection shapes`](https://docs.blockly.com/guides/create-custom-blocks/renderers/create-custom-renderers/connection-shapes/)

There is also `shapeFor(connection)`, which lets the connection shape vary by **connection check** — e.g. "strings could be represented by triangular connections, while booleans are represented by round connections." The full `Blockly.utils.svgPaths` API is public: `point`, `curve`, `moveTo`, `moveBy`, `lineTo`, `line`, `lineOnAxis`, `arc` ([`core/utils/svg_paths.ts`](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/utils/svg_paths.ts)).

**3. `Drawer` + `PathObject` — the block outline itself.** `Drawer` "builds SVG paths based on the renderer info and passes them to the path object"; `PathObject` "contains the SVG elements in the DOM that make up the block" and handles applying shapes, theme colours, and styling. Geras blocks get three paths (main/dark/light) for a 3-D effect; Thrasos gets a single stroked path. Custom *inputs* are supported by overriding `drawOutline_` / `drawInternals_` in a `Drawer` subclass.

**4. Low-level SVG: `block.svgGroup`.** The per-block `<g>` element (`private svgGroup: SVGGElement`, `core/block_svg.ts` L154/L198). There is no documented public API for appending arbitrary children to it, and nothing in the docs recommends doing so — this is the "unsupported DOM hacking" route. **UNVERIFIED:** I found no official example of appending custom SVG directly to `svgGroup`.

**5. Custom `Field` that draws its own SVG — this is the documented, supported way to put an arbitrary symbol inside a block.** From [`Create a custom field`](https://docs.blockly.com/guides/create-custom-blocks/fields/customizing-fields/creating/):

> "The default `initView` function creates a light coloured `rect` element and a `text` element. … Otherwise **you will need to override the `initView` function to create the DOM elements that you will need** during future rendering of your field."
> "**Creating DOM elements can either be done using the `Blockly.utils.dom.createSvgElement` method**, or using traditional DOM creation methods."
> "The requirements of a field's on-block display are: **All DOM elements must be children of the field's `fieldGroup_`.** … All DOM elements must stay inside the reported dimensions of the field."

And for symbols inside text: "If you want to add symbols to a field's text (such as the Angle field's degree symbol) you can append the symbol element (usually contained in a `<tspan>`) directly to the field's `textElement_`."

The docs even show SVG-pattern fills being applied in a field's `render_`:
```js
this.shellPattern_.setAttribute('fill', 'url(#polkadots)');
this.shellPattern_.setAttribute('fill', 'url(#stripes)');
this.shellPattern_.setAttribute('fill', 'url(#hexagons)');
```

I verified `Blockly.utils.dom.createSvgElement` is a **public** export of the shipped package:
```
has utils: true
utils.dom: true
utils.dom.createSvgElement: function
```
Its signature: `createSvgElement<T extends SVGElement>(name, attrs, opt_parent?)` ([`core/utils/dom.ts` L54-59](https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/utils/dom.ts)).

**6. Custom `Icon` — the other supported self-drawing hook.** Icons live on the block edge (comment/ mutator/warning). [`Create custom icons`](https://docs.blockly.com/guides/create-custom-blocks/icons/creating-custom-icons/basic-implementation/) shows the same pattern:
```js
initView(pointerdownListener) {
  if (this.svgRoot) return;
  super.initView(pointerdownListener);
  Blockly.utils.dom.createSvgElement(
    Blockly.utils.Svg.CIRCLE,
    { 'class': 'my-css-class', 'r': '8', 'cx': '8', 'cy': '8' },
    this.svgRoot);   // Append to the svgRoot
}
getSize() { /* so the renderer makes the block wide enough */ }
```
"New elements should be children of the `this.svgRoot` element so that they get automatically cleaned up when the icon is destroyed."

**7. `FieldImage` — probably not what you want.** It is the ready-made image field, but the docs specify **raster** input: "`src` — A string that points to a **raster image** file", with mandatory non-zero numeric `width`/`height`. It has a click handler (`opt_onClick` / `setOnClickHandler`) so images "can act like buttons that exist on blocks", and supports `opt_flipRtl`. There is no `viewBox`/scaling vector support documented. **UNVERIFIED:** whether an `.svg` file passed as `src` renders correctly in all browsers via the underlying `<image>` element — undocumented, so treat SVG-in-FieldImage as unsupported.

#### Concrete answer: how hard is a resistor (zigzag) or capacitor symbol?

**Drawing it: easy.** A `Field` subclass that overrides `initView` and appends an SVG `<path>` with the IEC/ANSI zigzag or two parallel plates, using the public `Blockly.utils.dom.createSvgElement` (or the `Blockly.utils.svgPaths` helpers to build the `d` attribute), then reporting size in `updateSize_`. Roughly:

```js
class FieldResistor extends Blockly.Field {
  constructor(value, validator) { super(value, validator); this.SERIALIZABLE = true; }
  initView() {
    super.initView();                      // gives borderRect_ + textElement_
    // Append an arbitrary SVG symbol to the field's own group.
    const d = 'M0 8 L4 0 L8 8 L12 0 L16 8';   // zigzag, via svgPaths in practice
    this.symbol_ = Blockly.utils.dom.createSvgElement(
      Blockly.utils.Svg.PATH,
      { d, stroke: 'currentColor', fill: 'none', 'stroke-width': '1.5' },
      this.fieldGroup_);
  }
  render_() { /* toggle symbol_ vs textElement_ as needed */ this.updateSize_(); }
  updateSize_() {
    const bbox = this.movableGroup_.getBBox();
    this.size_.width  = bbox.width;
    this.size_.height = bbox.height;
  }
}
Blockly.fieldRegistry.register('field_resistor', FieldResistor);
```
You could equivalently render the resistor as the **block outline itself** by overriding `ConstantProvider`/`Drawer` in a custom renderer, or as an **icon** via `IIcon.initView`.

**The real cost is everything around the drawing:**
* You must own layout/measuring (`size_`, `getBBox()`, and the docs warn "Calling `getBBox` during rendering can cause layout thrashing").
* Accessibility is your responsibility: "You are responsible for ensuring that your custom fields are WCAG compliant and correctly implement `IFocusableNode`… having an appropriate ARIA role."
* You cannot get *rotated* or *freely-placed leads*: a symbol drawn in a field is laid out inside the block's row/field flow. There is no supported concept of a symbol body with N leads at arbitrary angles, which is what a schematic actually needs.
* Symbols are **not nodes**. A Blockly block is a horizontal row of fields/inputs; it is not a free-form canvas object with a positionable body and pins on arbitrary sides.

**Honest assessment:** drawing a resistor glyph inside a Blockly block is **easy-to-moderate and officially supported** (a few dozen lines of a custom `Field`, no core patching). Building a *schematic* out of such glyphs is **hard to the point of being the wrong shape of problem**, because the surrounding model — one output, one parent, single-occupancy inputs, ordered statement rows, directed typed connectors — refuses to represent the circuit.

### 6.5 References to real examples

* **Custom Fields demo (draws custom SVG on a block):** [`pitch-field-demo`](https://raspberrypifoundation.github.io/blockly-samples/examples/pitch-field-demo/) — cited by the custom-field docs as the canonical worked example, and it draws a pitch staff, i.e. an arbitrary graphic on a block.
* **Custom renderer codelab:** [Custom renderers codelab](https://docs.blockly.com/codelabs/custom-renderer/codelab-overview/) and the [typed connection shapes](https://docs.blockly.com/codelabs/custom-renderer/typed-connection-shapes/) page — working end-to-end example of custom connection geometry.
* **`@blockly/field-bitmap`** — a first-party plugin field that renders a bit grid on a block; another proof that arbitrary SVG/on-block graphics are a supported pattern. `@blockly/field-slider`, `@blockly/field-colour` similarly.
* **`@blockly/block-plus-minus`** — custom mutator UI replacing the default bubble.
* **Engineering-symbol precedent: none found.** I found **no** blog post, demo, issue, or plugin drawing a resistor/capacitor/schematic symbol inside a Blockly block. **UNVERIFIED / not found** rather than confirmed-absent.

---

## 7. Verdict on suitability

### 7.1 The mismatch, stated precisely

The ACASUAL editor needs a **graph** with these invariants:

1. Arbitrary topology, including **cycles** (algebraic loops, e.g. a resistor loop with no state).
2. **Undirected** connections — a wire is a shared potential/flow relation, not a source→sink edge.
3. Each connection carries a **bidirectional effort/flow pair**; direction is assigned at solve time by the causalization/DAG-orientation pass, not at edit time.
4. A port may accept **multiple connections** (a node is a junction; conservation laws sum over all incident edges).

Blockly's model asserts the **opposite** of all four:

1. **Tree, not graph.** `parentBlock_` is a single pointer that throws on inconsistency; a value output has exactly one `targetConnection`; connecting again *moves* the wire. Measured: `FANOUT_SUPPORTED = false`.
2. **Directed by construction.** `ConnectionType` has no undirected member; `doSafetyChecks` requires exact `OPPOSITE_TYPE` pairing (input↔output, next↔previous). Measured: input→input `false`, output→output `false`.
3. **One signal, one direction, per connection.** A connection is a male/female jigsaw pairing of a single source to a single sink. There is no representation for a two-variable (effort, flow) interface on a wire.
4. **Single occupancy.** `targetConnection: Connection | null` is a scalar; `connect_` disconnects the incumbent. The only fan-in is N *distinct* named inputs on one block, each still single-occupancy.

**Cycles — the sharpest failure.** Blockly's cycle guard is a *drag affordance*, not a model invariant: it lives in `doDragChecks`, which the public `Connection.connect()` bypasses by passing `isDragging = false`. Measured consequences of a programmatic 2-cycle: headless, it is **accepted**, `getTopBlocks()` returns **0**, and `serialization.workspaces.save()` **silently serializes zero blocks — total data loss**. In a rendered workspace the same call throws `DOMException: HierarchyRequestError`. So Blockly neither supports cycles nor safely rejects them; it corrupts its own workspace. For an editor whose entire point is algebraic loops, that is disqualifying.

This is not a gap that a plugin fills. The tree assumption is threaded through the connection enum, the parent pointer, the SVG group nesting, the serializer, the render-order traversal ("render from leaf blocks to root blocks"), and code generation. Issue **#10364** has asked for exactly node/graph-with-ports support since **2020-07-05** and remains **open, unimplemented, labelled `area: plugins`**.

### 7.2 What Blockly is genuinely good at (and where it would fit)

Nothing above is a criticism of Blockly as a product. It is excellent, well-maintained, well-documented, and correctly designed for its purpose:

* **Statement/expression tree → code generation.** If the deliverable were "let users assemble a Modelica *equation or algorithm* by snapping blocks, then emit `.mo` text", Blockly would be a strong, arguably best-in-class choice.
* **Typed ports.** `setCheck` + a custom `IConnectionChecker` is a genuinely good, extensible type system — better than many graph editors offer.
* **Zoom/pan, toolbox, flyout, undo/redo, serialization, keyboard nav, screen-reader support** are all solved and documented. The accessibility work in v13 is a real asset.
* **Parameter dialogs** map well: fields for values, mutators for arity/shape.
* **Custom drawing is supported** — a resistor glyph is a few dozen lines of a custom `Field`.
* **Maintenance and licensing are low-risk**: Apache-2.0, no attribution obligation, zero runtime deps, monthly releases, 267 contributors, paid team at a UK charity, no abandonment signal.

**Legitimate narrower fits:**
* A **Blockly-based Modelica *code* authoring surface** beside a separate schematic canvas — i.e. use Blockly for the textual/algorithmic half and a real graph library for the diagram half. This is a defensible split.
* A **parameter/experiment configurator** where the structure is genuinely a tree.

### 7.3 Bottom line

**Blockly is not suitable as the core of an ACASUAL bidirectional physical-modeling editor.** It is a **tree editor** — not a graph editor, and not even DAG-capable. The three hard requirements of the target domain (undirected conservation-law connectors, multi-connection ports, and cyclic topology) are each individually impossible in Blockly's data model, and cyclic topology additionally corrupts the workspace when forced through the API.

The features it does well — zoom/pan, typed ports, parameter dialogs, custom SVG symbols, accessibility, maintenance, licensing — are **table stakes that a graph-native editor also provides**, so they do not offset the structural mismatch. The bundle is also heavy for an embedded plugin context: **≈ 202 KB gzip full / ≈ 178 KB gzip core-only**, and the core-only figure still drags in all three SVG renderers plus the full a11y/focus stack. There is no Canvas/WebGL renderer to fall back on for large schematics, and no such renderer has ever been proposed (zero `webgl` issues in the tracker's history).

**Recommended action:** evaluate Blockly only as a *complementary* code-authoring pane, and select a graph-native core for the schematic itself. If a code pane is not in scope, drop Blockly from the candidate set and record the reason as *"tree-only data model; no undirected/multi-connection ports; cycles unrepresentable and workspace-corrupting — see research/blockly-evaluation.md §1."*

---

## Citations

1. What is Blockly? — https://docs.blockly.com/guides/get-started/what-is-blockly/
2. Anatomy of a block (tree-shaped object model) — https://docs.blockly.com/guides/create-custom-blocks/define/block-anatomy/
3. Top-level connections (single output connection) — https://docs.blockly.com/guides/create-custom-blocks/define/top-level-connections/
4. Connection checks — https://docs.blockly.com/guides/create-custom-blocks/inputs/connection-checks/
5. Custom connection checkers — https://docs.blockly.com/guides/create-custom-blocks/inputs/connection_checker/
6. Render management ("rerender the set (as a tree)") — https://docs.blockly.com/guides/contribute/core/core-architecture/render-management/
7. Renderers (geras / thrasos / zelos) — https://docs.blockly.com/guides/create-custom-blocks/renderers/overview/
8. Renderer concept — https://docs.blockly.com/guides/create-custom-blocks/renderers/concepts/renderer/
9. Drawer concept (builds SVG paths) — https://docs.blockly.com/guides/create-custom-blocks/renderers/concepts/drawer/
10. Path object concept (SVG elements in the DOM) — https://docs.blockly.com/guides/create-custom-blocks/renderers/concepts/path-object/
11. Create custom renderers (`blockRendering.register`) — https://docs.blockly.com/guides/create-custom-blocks/renderers/create-custom-renderers/basic-implementation/
12. Connection shapes (`makeNotch`, `makePuzzleTab`, `shapeFor`, `Blockly.utils.svgPaths`) — https://docs.blockly.com/guides/create-custom-blocks/renderers/create-custom-renderers/connection-shapes/
13. Custom renderer codelab — https://docs.blockly.com/codelabs/custom-renderer/codelab-overview/
14. Typed connection shapes codelab — https://docs.blockly.com/codelabs/custom-renderer/typed-connection-shapes/
15. Fields overview — https://docs.blockly.com/guides/create-custom-blocks/fields/overview/
16. Built-in fields (built-in vs plugin split) — https://docs.blockly.com/guides/create-custom-blocks/fields/built-in-fields/overview/
17. Create a custom field (`initView`, `createSvgElement`, `fieldGroup_`, `render_`, `updateSize_`) — https://docs.blockly.com/guides/create-custom-blocks/fields/customizing-fields/creating/
18. Image fields (`FieldImage`, raster, click handler) — https://docs.blockly.com/guides/create-custom-blocks/fields/built-in-fields/image/
19. Mutators (`saveExtraState`/`loadExtraState`, `compose`/`decompose`, `registerMutator`) — https://docs.blockly.com/guides/create-custom-blocks/mutators/
20. Create custom icons (`IIcon`, `initView`, `svgRoot`) — https://docs.blockly.com/guides/create-custom-blocks/icons/creating-custom-icons/basic-implementation/
21. Zoom option — https://docs.blockly.com/guides/configure/zoom/
22. Attribute Blockly (trademark/branding restrictions) — https://docs.blockly.com/guides/app-integration/attribution/
23. Reference: `Renderer` class — https://docs.blockly.com/reference/namespaces/blockRendering/classes/Renderer
24. Source: `connection.ts` — https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/connection.ts
25. Source: `connection_type.ts` (ConnectionType enum) — https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/connection_type.ts
26. Source: `connection_checker.ts` (`doSafetyChecks`, `doDragChecks`, `canConnectToPrevious_`) — https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/connection_checker.ts
27. Source: `internal_constants.ts` (`OPPOSITE_TYPE`) — https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/internal_constants.ts
28. Source: `block.ts` (`parentBlock_`, `setParent`, singular connection slots) — https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/block.ts
29. Source: `block_svg.ts` (`svgGroup`, `setDragging`, `draggingConnections`) — https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/block_svg.ts
30. Source: `workspace_svg.ts` (default renderer `'geras'`, zoom/scroll API) — https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/workspace_svg.ts
31. Source: `utils/dom.ts` (`SVG_NS`, `createSvgElement`, the sole `canvas` text-measurement use) — https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/utils/dom.ts
32. Source: `utils/svg_paths.ts` (public SVG path helpers) — https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/utils/svg_paths.ts
33. Source: `interfaces/i_connection_checker.ts` ("no self connections") — https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/interfaces/i_connection_checker.ts
34. Source: `renderers/zelos/renderer.ts` (`blockRendering.register('zelos', …)`) — https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/blockly/core/renderers/zelos/renderer.ts
35. Source: `CHANGELOG.md` (13.3.0 release notes, 2026-09-10) — https://github.com/RaspberryPiFoundation/blockly/blob/main/CHANGELOG.md
36. Source: `LICENSE` (Apache License 2.0) — https://github.com/RaspberryPiFoundation/blockly/blob/main/LICENSE
37. Source: `block-anatomy.mdx` ("The objects in a block form a tree-shaped object") — https://github.com/RaspberryPiFoundation/blockly/blob/main/packages/docs/docs/guides/create-custom-blocks/define/block-anatomy.mdx
38. Issue #10364 "Blockly and Nodes/Graphs" (open since 2020-07-05) — https://github.com/RaspberryPiFoundation/blockly/issues/10364
39. Issue #6978 "Add promise based API to render queueing" — https://github.com/RaspberryPiFoundation/blockly/issues/6978
40. Issue #3094 "Workspace drag performance regression" — https://github.com/RaspberryPiFoundation/blockly/issues/3094
41. Issue #7395 "blockly load performance" — https://github.com/RaspberryPiFoundation/blockly/issues/7395
42. PR #10177 "Improve performance of `BlockSvg.getRelativeToSurfaceXY()`" — https://github.com/RaspberryPiFoundation/blockly/pull/10177
43. Raspberry Pi Foundation — "The new home for Blockly" (2025-10-28) — https://www.raspberrypi.org/blog/new-home-for-blockly/
44. Google Open Source Blog — "Building the future with Blockly at Raspberry Pi Foundation" (2025-10-28) — https://opensource.googleblog.com/2025/10/blockly-graduates-from-google.html
45. blockly.com (governance, FAQ, Apache-2.0 statement, adopters, Google.org funding) — https://blockly.com/
46. npm registry metadata for `blockly` (versions, dates, license, repository) — https://registry.npmjs.org/blockly
47. npm downloads API (`blockly`, last month) — https://api.npmjs.org/downloads/point/last-month/blockly
48. bundlephobia package page — https://bundlephobia.com/package/blockly
49. bundlephobia size API — https://bundlephobia.com/api/size?package=blockly@13.3.0
50. shields.io stars badge JSON — https://img.shields.io/github/stars/google/blockly.json
51. shields.io commit-activity/month badge JSON — https://img.shields.io/github/commit-activity/m/google/blockly.json
52. shields.io license badge JSON — https://img.shields.io/github/license/google/blockly.json
53. shields.io forks badge JSON — https://img.shields.io/github/forks/RaspberryPiFoundation/blockly.json
54. shields.io contributors badge JSON — https://img.shields.io/github/contributors/RaspberryPiFoundation/blockly.json
55. shields.io open-issues badge JSON — https://img.shields.io/github/issues/google/blockly.json
56. Blockly plugins & demos index (plugin fields, samples) — https://raspberrypifoundation.github.io/blockly-samples/
57. `@blockly/field-angle` on npm — https://www.npmjs.com/package/@blockly/field-angle
58. `@blockly/field-colour` on npm — https://www.npmjs.com/package/@blockly/field-colour
59. `@blockly/field-slider` on npm — https://www.npmjs.com/package/@blockly/field-slider
60. `@blockly/field-bitmap` on npm — https://www.npmjs.com/package/@blockly/field-bitmap
61. `@blockly/block-plus-minus` plugin (custom mutator UI) — https://github.com/RaspberryPiFoundation/blockly/tree/main/packages/plugins/block-plus-minus
62. Blockly community forum (Google Group) — https://groups.google.com/g/blockly

---

### Reproduction artifacts

All measurements in this report were produced in-session:

* Bundle measurement sandbox: `/tmp/blmeasure` (entry files `entry_full.js`, `entry_core.js`, `entry_core_js.js`; outputs `out_*.js`).
* Headless fan-out / cycle / type-compatibility probe: `/tmp/blmeasure/headless.mjs` (Blockly 13.3.0 + `Blockly.Workspace`, no DOM renderer).
* Rendered-workspace cycle probe (produced the `DOMException: HierarchyRequestError`): `/tmp/blmeasure/cycledemo.mjs` (jsdom).
* Sparse source clone used for all source greps: `/tmp/blrepo` (`packages/blockly/core`, `packages/docs/docs`).
