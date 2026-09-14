# React Flow / `@xyflow/react` v12 as an embedded node-editor core for an Obsidian plugin

**Research date:** 2026-09-13 · **Target version:** `@xyflow/react@12.11.6` (latest stable)
**Method:** bundlephobia API, npm registry API, GitHub REST API, the official docs corpus (`reactflow.dev/llms-full.txt`), and **direct inspection + local builds of the shipped npm tarball**. Sizes and dependency facts below were measured, not quoted from blog posts.

> **Verification legend**
> ✅ **Verified** — measured first-hand or read from a primary source in this session.
> ⚠️ **Unverified / could not check** — stated explicitly with what was attempted.
> 🕒 **Likely stale** — source is old relative to 2026-09-13.

---

## 1. Bundle size and runtime dependencies

### 1.1 Headline numbers (all ✅ verified, three independent methods agree)

| Measurement | Minified | Minified + gzip | Brotli |
|---|---|---|---|
| **bundlephobia API** (`@xyflow/react@12.11.6`) | **187,694 B** | **59,920 B** | — |
| **Shipped UMD** `dist/umd/index.js` (already minified) | **188,290 B** | **59,318 B** | — |
| **My esbuild build**, minimal `<ReactFlow>` (React external, tree-shaken) | **179,759 B** (175.5 KiB) | **59,566 B** (58.2 KiB) | 51,820 B |
| **My esbuild build**, + `<Background/> <Controls/> <MiniMap/>` | **183,409 B** | **61,290 B** | 53,152 B |

**Working figure for the library's own code: ~180–188 KB minified, ~59–61 KB gzip (~52 KB brotli).**

The three methods agree within ~4%, which is the level of difference you'd expect between esbuild and webpack/terser minification. This is a solid number.

### 1.2 CSS is separate and required

| Asset | Raw | gzip |
|---|---|---|
| `@xyflow/react/dist/style.css` | 18,596 B | **3,030 B** |
| `@xyflow/react/dist/base.css` | 13,585 B | **2,425 B** |

✅ Verified from the tarball. You must import one of these; the library ships `useStylesLoadedWarning()` which fires a dev warning if styles are missing.

### 1.3 The Obsidian-relevant number

An Obsidian plugin cannot rely on a host-provided React (Obsidian ships none — its [official React guide](https://docs.obsidian.md/Plugins/Getting+started/Use+React+in+your+plugin) tells you to `npm install react react-dom` yourself). So a React Flow plugin's `main.js` must contain React + ReactDOM + React Flow together. ✅ Measured with esbuild:

| Bundle contents | Minified | gzip | Brotli |
|---|---|---|---|
| React + ReactDOM + minimal ReactFlow | **324,696 B** (317 KiB) | **104,770 B** (102 KiB) | 90,989 B |
| React + ReactDOM + ReactFlow + Background/Controls/MiniMap | **328,467 B** (321 KiB) | **106,659 B** (104 KiB) | 92,357 B |

**≈ 320 KB minified / ≈ 105 KB gzip added to `main.js`, plus ~3 KB gzip CSS.** For scale reference, the community React starter template reports its production output at ~200 KB *before* any node-editor code.

### 1.4 ⚠️ It does **not** have zero runtime dependencies

This claim is **false for v12**. ✅ Verified via `npm ls --omit=dev --all` on a clean install of `@xyflow/react@12.11.6`:

**Direct dependencies (3):**
- `zustand` `^4.4.0` (resolved `4.5.7`)
- `classcat` `^5.0.3` (resolved `5.0.5`)
- `@xyflow/system` `0.0.82`

**`@xyflow/system@0.0.82` pulls 9 more:** `d3-drag`, `d3-zoom`, `d3-selection`, `d3-interpolate`, plus five `@types/d3-*` packages.

**Complete transitive runtime tree (20 packages):**

```
@xyflow/react, @xyflow/system, zustand, classcat, use-sync-external-store,
d3-selection, d3-transition, d3-zoom, d3-interpolate, d3-color, d3-drag,
d3-ease, d3-timer, d3-dispatch,
@types/d3-selection, @types/d3-transition, @types/d3-zoom, @types/d3-color,
@types/d3-drag, @types/d3-interpolate
```
(`use-sync-external-store@1.7.0` arrives via `zustand@4.5.7` — ✅ traced with `npm ls`.)

**Measured install size of that whole tree: 3,067,575 B ≈ 2.93 MiB** (including the type-only `@types` packages; excluding `@types` it is ≈ 2.71 MiB). npm also reports `@xyflow/react@12.11.6` `unpackedSize` = **1,216,002 B across 516 files**.

**One correction worth recording:** `@radix-ui/react-icons` shows up if you grep the bundle, but ✅ it appears **only inside a JSDoc comment** (`esm/index.mjs:4571`, the `ControlButton` usage example). It is *not* a dependency. Do not list it.

### 1.5 ⚠️ Could not verify

- **packagephobia**: ❌ blocked. `https://packagephobia.com/v2/api.json?p=@xyflow/react` and `/result?p=@xyflow/react` both returned a **Vercel "Security Checkpoint"** bot wall, then HTTP 429. I substituted a first-hand install-size measurement (§1.4), which is strictly more reliable than packagephobia's estimate anyway.
- **bundlephobia for the legacy packages** (`reactflow@11.11.4`, `react-flow-renderer@10.3.17`, `@xyflow/system`): ❌ HTTP 429 "Too Many Requests" on repeated attempts, even after cooldowns. So I **cannot** give you a verified v11-vs-v12 size comparison. The one bundlephobia call that did succeed was for `@xyflow/react`, and its response is reproduced in §1.1.
- Note bundlephobia reports `dependencyCount: 3` (direct only) — it does **not** mean 3 packages total.

---

## 2. Rendering technology

### 2.1 It is a **DOM + SVG hybrid**. There is no canvas renderer.

✅ Verified by reading the shipped source, not just the prose:

| Element | Technology | Evidence |
|---|---|---|
| **Node bodies** | **HTML DOM** | `jsx("div", { className: cc(['react-flow__node', ...]) })` |
| **Handles** | **HTML DOM** | `<div class="react-flow__handle ...">`. Docs confirm: *"Since the handle is a div, you can use CSS to style it"* |
| **Edges** | **SVG** | `jsx("svg", ...) > jsxs("g", {className: 'react-flow__edge'}) > <path>` |
| **Edge paths** | **SVG** | Docs: *"These paths are always SVG-based and are typically rendered using the `<BaseEdge />` component."* |
| **Edge arrow markers** | **SVG** | Separate `<svg class="react-flow__marker"><defs>` layer |
| **Connection line (while dragging)** | **SVG** | `<svg class="react-flow__connectionline">` |
| **Background grid** | **SVG** | `<svg class="react-flow__background">` |
| **MiniMap** | **SVG** | Docs: *"It renders each node as an SVG element"* |
| **Edge labels** | **HTML portal** | `<EdgeLabelRenderer/>` — *"Edges are SVG-based. If you want to render more complex labels you can use the `<EdgeLabelRenderer />` component to access a div based renderer."* |

**So:** node bodies and handles are DOM (borders are CSS on a `div`); edges, the grid, and the minimap are SVG. It is emphatically not a canvas renderer, and node bodies are not SVG either.

### 2.2 Is there an official canvas-only renderer or a "no-DOM" mode?

**No.** ✅ Verified two ways:
1. Searching the entire official docs corpus (`llms-full.txt`, 896 KB) for "canvas": every hit is either (a) the word "canvas" used metaphorically for the viewport, or (b) **user-authored** canvas used *inside* a custom node or as an overlay — e.g. a whiteboard eraser overlay, a drawing surface in a node body. There is no library-provided canvas node/edge renderer.
2. A feature request for exactly this was filed and **closed within one day**: [#5442 "Performance recommendation: use canvas renderer on low zoom for better performance on graphs with 100+ nodes"](https://github.com/xyflow/xyflow/issues/5442) (opened 2025-08-10, closed 2025-08-11) 🕒.

**No "no-DOM" mode exists.** Every node is a real DOM element with real layout. The closest thing to escaping DOM cost is that you can put a `<canvas>` *inside* a node body, or draw your own overlay canvas in the viewport (the docs' Whiteboard section demonstrates a canvas eraser overlay), or replace the minimap with your own canvas.

⚠️ Note a documented gotcha if you do put a canvas in a node: the docs' troubleshooting section covers *"Mouse events aren't working consistently when my nodes contain a `<canvas />` element"* — React Flow attaches listeners that assume DOM layout.

### 2.3 `onlyRenderVisibleElements`

✅ **It exists in v12 and still works.** Confirmed in the shipped runtime: `onlyRenderVisibleElements = false` is a defaulted prop of `ReactFlow` (`esm/index.mjs:3767`), threaded into both `EdgeRenderer` and `NodeRenderer`. It is listed in the official `<ReactFlow />` API reference under **Viewport props**.

**Default is `false`** — i.e. out of the box **every node is mounted into the DOM**, which is the single biggest scaling lever.

⚠️ It is thinly documented: in the docs corpus the prop appears in the API-reference props list and in the v11→v12 migration guide, but *not* on the performance page.

⚠️ **It is not free, and the maintainers know it:**
- [#3883 "check `onlyRenderVisibleElements` optimizations"](https://github.com/xyflow/xyflow/issues/3883) — **open since 2024-02-07**, body: *"Currently all nodes get rendered initially even if one uses `onlyRenderVisibleElements`. Would it be possible to improve this behavior somehow?"*
- [#4239 "RFC - Spatial Queries & Virtualisation in XYFlow"](https://github.com/xyflow/xyflow/issues/4239) — **open since 2024-05-02**, 21 comments. States the current approach is *"a naïve axis aligned bounding box check on each node & edge"* which *"still requires that all node and edge data is available to the renderer and does come with a performance overhead, especially for smaller graphs and when zoomed out."* Proposes BVH-based spatial indexing. Still unimplemented.
- [#5487](https://github.com/xyflow/xyflow/issues/5487) (open, 2025-08-29) — using `onlyRenderVisibleElements` causes node-internal state to be lost when a node scrolls out and back in, because nodes are unmounted.

### 2.4 `useStore` selector-based re-render optimization

✅ `useStore` is **re-exported from Zustand**, so it has Zustand's selector semantics (a selector re-renders only when its returned value changes by `Object.is`).

Official guidance, quoted from the API reference:
> *"This hook should only be used if there is no other way to access the internal state. For many of the common use cases, there are dedicated hooks available such as `useReactFlow`, `useViewport`, etc."*

And from the performance page — the single strongest warning there:
> *"One of the most common performance pitfalls in React Flow is directly accessing the `nodes` or `edges` in the components or the viewport. These objects change frequently during operations like dragging, panning, or zooming, which can cause unnecessary re-renders of components that depend on them."*

It shows a bad example (`useStore((state) => state.nodes)` then filtering) and the fix (store derived state like `selectedNodeIds` in a **separate** field so the selector returns a stable scalar). So: selector-based `useStore` is the intended escape hatch, but it is *not* a substitute for not subscribing to `nodes`.

### 2.5 `nodeTypes` memoization requirement

✅ **Required, and enforced by a dev-mode warning.** From the shipped source:

```js
function useNodeOrEdgeTypesWarning(nodeOrEdgeTypes = emptyTypes) {
  const typesRef = useRef(nodeOrEdgeTypes);
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      const usedKeys = new Set([...Object.keys(typesRef.current), ...Object.keys(nodeOrEdgeTypes)]);
      for (const key of usedKeys) {
        if (typesRef.current[key] !== nodeOrEdgeTypes[key]) {
          store.getState().onError?.('002', errorMessages['error002']());
```

`errorMessages['error002']` (from `@xyflow/system`) reads:

> **"It looks like you've created a new nodeTypes or edgeTypes object. If this wasn't on purpose please define the nodeTypes/edgeTypes outside of the component or memoize them."**

Note it is **`process.env.NODE_ENV === 'development'` only**, so it will not fire in a production Obsidian build — meaning a mistake here is silent in production. The docs reiterate this in the custom-nodes guide (*"We define the `nodeTypes` outside of the component to prevent re-renderings… you could also use useMemo inside the component"*).

The docs also warn for event handlers: *"It's important to remember to define any event handlers outside of your component or using React's `useCallback` hook. If you don't, this can cause React Flow to enter an infinite re-render loop!"*

### 2.6 ⚠️ The performance page has **no node-count claims at all**

You asked specifically what it claims about node counts and stated limits. Reading the current page (`/learn/advanced-use/performance`) in full, it contains:

- **No benchmark numbers.**
- **No stated node-count limit, ceiling, or recommendation.** Not "1000 nodes", not anything. The only quantitative-ish statement is qualitative: *"When dealing with a large number of nodes or complex components, managing performance can be challenging."*
- ✅ I also grepped the **entire 896 KB docs corpus** for numeric node guidance (`"1000 nodes"`, `"hundreds of nodes"`, `"thousands of nodes"`, `"large number of nodes"`). The only hits are that one qualitative sentence and unrelated code.

Its actual recommendations, in order, are: **(1)** memoize components/functions/objects, **(2)** don't read `nodes`/`edges` from the store inside components, **(3)** collapse large node trees via the `hidden` property, **(4)** simplify node/edge styles — *"complex CSS styles, particularly those involving animations, shadows, or gradients, can significantly impact performance"* — and then it links to three third-party articles.

⚠️ **Stale-URL note:** `https://reactflow.dev/learn/troubleshooting/performance` now returns **HTTP 404** — that page no longer exists in v12. If you have that URL in notes, it's dead. I could **not** retrieve the old v11 performance page to check whether *it* stated limits: the Wayback CDX API returned HTTP 429 on three attempts.

---

## 3. Licensing

### 3.1 The library: MIT, and it stays MIT

✅ **Verified.** `@xyflow/react@12.11.6` declares `"license": "MIT"` in the npm registry. The repository [`LICENSE`](https://github.com/xyflow/xyflow/blob/main/LICENSE) file is the standard MIT text with:

> `Copyright (c) 2019-2025 webkid GmbH`

🕒 Minor: the copyright year says **2025** even though the repo is active in 2026 (the site footer says 2026) — just an un-refreshed header, not a licensing change.

The marketing page states it unambiguously:
> *"React Flow is open-source MIT-licensed software, and it will be forever… With your subscription, you are ensuring the sustainable maintenance and development of the React Flow library. This is how we make sure React Flow stays MIT-licensed."*

### 3.2 Relationship to `react-flow-renderer` and `reactflow` — the rename chain

✅ **Verified from the npm registry:**

| Package | Latest | Published | License | Status |
|---|---|---|---|---|
| `react-flow-renderer` | `10.3.17` | 2022-09-14 | MIT | **Deprecated**: *"react-flow-renderer has been renamed to reactflow, please use this package from now on"* |
| `reactflow` | `11.11.4` | 2024-06-20 | MIT | Final v11. **Not** marked deprecated on npm. Deps are `@reactflow/*` sub-packages |
| `@xyflow/react` | `12.11.6` | 2026-09-01 | MIT | Current v12 line |

So the lineage is `react-flow-renderer` (≤v10) → `reactflow` (v11) → `@xyflow/react` (v12), all MIT, all the same project. `reactflow@11` was last published 2024-06-20, so **v11 has had no release in ~27 months** — treat v11 as maintenance-only.

🕒 Worth noting: `react-flow-renderer@10` *already* depended on `d3-drag`, `d3-selection`, `d3-zoom`, `zustand`, and `classcat`. **React Flow has never had zero runtime dependencies.**

### 3.3 The Pro offering and what it actually gates

✅ **Verified from [reactflow.dev/pro](https://reactflow.dev/pro) and [xyflow.com/pro-license](https://xyflow.com/pro-license):**

- **Starter $169/mo**, **Professional $289/mo**, **Enterprise** (quote-based).
- Listed benefits: access to **Pro Examples and Templates**, **prioritized GitHub issues**, team seats (1/5/10), an introduction call with the creators, and (Professional+) up to 1 hour of email support per month.

**Is any *code* license-gated? No — with one nuance.**

✅ I checked the **[xyflow Pro License v1.0](https://xyflow.com/pro-license)** (last updated 2026-08-24), which is the actual governing document. Its Grant of License covers:

> *"**Use** the **pro examples, templates, and related documentation** ("pro content") … **Modify** the pro content … **Integrate** the pro content into your applications, whether commercial or non-commercial … **Distribute** applications that incorporate the pro content"*

It grants rights to **pro examples/templates/docs only** — the library is not mentioned and remains under MIT. It adds that rights are perpetual for content obtained during a valid subscription, forbids redistributing pro content standalone or sharing access, and states the license *"does not entitle you to support, maintenance, or updates."*

✅ **No Pro npm package exists.** I probed the registry: `@xyflow/pro` → **404**, `@xyflow/react-ui` → **404**, `@xyflow/ui` → **404**, `reactflow-ui` → **404**. (`@xyflow/xy-ui` exists and is MIT, but it is xyflow's *own website* UI kit — deps are Radix/Heroicons/Tailwind — **not** the "React Flow UI" component library.)

✅ The only in-repo "gating" is a **placeholder string** in pro-example source files: `! THIS IS A PRO EXAMPLE. SUBSCRIBE TO https://reactflow.dev/pro TO ACCESS PRO EXAMPLES !` — you get the file; the real implementation is withheld. Not a license check.

**The one thing that is functionally gated: the attribution.** ✅ Verified in the shipped `Attribution` component:

```js
if (proOptions?.hideAttribution) { return null; }
return (jsx(Panel, { className: "react-flow__attribution",
  "data-message": `Please only hide this attribution when you are subscribed to React Flow Pro: ${link}`,
  children: jsx("a", { href: link, children: "React Flow" }) }));
```

And `handleAttributionWarning` in `@xyflow/system`:

```js
console.warn(`${framework}: It seems like you are hiding the attribution.
  Please only do this when you are subscribed to ${framework} Pro: …
  You can ignore this warning if you are subscribed.`)
```

**Precise conclusion:** `hideAttribution: true` is **not technically enforced** — it works with no license key, no network call, no verification. It is a **contractual/policy** condition, not a code gate. The [remove-attribution page](https://reactflow.dev/remove-attribution) says *"Subscribing to React Flow Pro permits you to remove the attribution from your flows."* So for an Obsidian plugin: the library code is unencumbered MIT; hiding the attribution is permitted only for Pro subscribers; the warning is dev-mode only and fires regardless.

---

## 4. Maintenance

All ✅ verified via the npm registry API and GitHub API on **2026-09-13**.

| Metric | Value |
|---|---|
| **Latest release** | **`12.11.6`, published 2026-09-01** (12 days before this research) |
| Stable 12.x releases | 56 (since `12.0.0`, 2024-01-03) |
| **Commits, last 6 months** | **261** (since 2026-03-14) |
| Latest commit | `0a1f9575` — 2026-09-01, a changeset release merge |
| **GitHub stars** | **38,358** |
| Forks / watchers | 2,531 / 138 |
| **Open issues** | **90** (issues only) |
| Open pull requests | 51 |
| Closed issues (all time) | 2,327 |
| Repo created | 2019-07-15 |
| License | MIT |

**Recent release cadence** (shows steady, not stagnant, shipping):

```
12.8.6   2025-09-26      12.10.1  2026-02-19      12.11.2  2026-07-06
12.9.0   2025-10-20      12.10.2  2026-03-27      12.11.3  2026-08-12
12.9.1   2025-10-28      12.11.0  2026-06-01      12.11.4  2026-08-25
12.9.2   2025-10-30      12.11.1  2026-06-22      12.11.5  2026-08-25
12.9.3   2025-11-13                              12.11.6  2026-09-01
12.10.0  2025-12-04
```

**Backed by a company: yes.** ✅ [xyflow.com/about](https://xyflow.com/about): the project is run by **webkid GmbH** (Berlin); the site footer reads *"Copyright © 2026 webkid GmbH"*. React Flow was created in 2019 at agency webkid while building Datablocks, open-sourced, and the team went **full-time on it in 2021**. The about page lists a **5-person core team working full-time from Berlin** (Christopher & Moritz, co-founders; Abbey, Peter, Hayleigh, engineers) plus named external collaborators (Vue Flow maintainer, a Discord moderator, the Nextra maintainer, a designer) and mentions they are hiring. `xyflow` is the brand umbrella for React Flow + Svelte Flow.

**Supply-chain hygiene (a positive signal):** ✅ every recent npm publish carries **SLSA provenance attestations** (`predicateType: https://slsa.dev/provenance/v1`), and publishes are signed.

⚠️ One caveat: the latest commit is 2026-09-01, ~12 days before this research. 261 commits/6mo is healthy but this is a small team, so release latency on non-critical issues is to be expected. Also relevant: 🕒 **v11 has not been released since 2024-06-20** — if you ever needed to fall back to `reactflow@11`, you'd be on an unmaintained line.

---

## 5. TypeScript support quality

**Written in TypeScript, and types are first-class.** ✅ The docs open the TypeScript guide with:

> *"React Flow is written in TypeScript because we value the additional safety barrier it provides. We export all the types you need for correctly typing data structures and functions you pass to the React Flow component."*

✅ Public surface is fully typed: `dist/esm/index.d.ts` plus per-module `.d.ts` files (516 files in the package). Shipped with `"types": "dist/esm/index.d.ts"` and conditional `exports` for `node`/`browser`. Optional peer `@types/react`/`@types/react-dom` (`>=17`).

**Key typing patterns (all ✅ from the official TypeScript guide):**

```ts
// Node data is parameterised by data shape and type string
type NumberNode = Node<{ number: number }, 'number'>;
export default function NumberNode({ data }: NodeProps<NumberNode>) { ... }

// Single component handling a union of node types
type AppNode = NumberNode | TextNode;
export default function CustomNode({ data }: NodeProps<AppNode>) { ... }

// Edges likewise
type CustomEdge = Edge<{ value: number }, 'custom'>;
export default function CustomEdge(props: EdgeProps<CustomEdge>) { ... }

// Built-ins join the union explicitly
import type { BuiltInNode, BuiltInEdge } from '@xyflow/react';
export type CustomNodeType = BuiltInNode | NumberNode | TextNode;
```

### Known typing pain points

1. 🕒 **`import type { Node }` collides with the DOM's global `Node`** and, in one report, wrecked editor responsiveness: [#3257 "Import Node type kills TypeScript performance"](https://github.com/xyflow/xyflow/issues/3257) (2023-07-25, closed 2023-07-26, 6 comments). Reporter: *"Doing `import type {Node} from "reactflow";` kills the TypeScript performance. Importing all other types looks fine. I feel like the conflict with the generic Node type may be the culprit."* **Flags:** this is **v11-era and 3 years old**; it was closed the next day so it was likely fixed or explained. I could not read the resolution comments (GitHub API rate limit exhausted — see §10). Still, the naming collision with the DOM `Node` is real and worth defensive aliasing (`import type { Node as RFNode }`).
2. ✅ **`type` is required, not `interface`**, for node data when declared separately. The docs call this out with a ⚠️: *"If you specify the node data separately, you need to use `type` (an `interface` would not work here)."* This is a genuine papercut — `interface` fails to satisfy the type constraint.
3. ✅ **Generic threading is verbose at scale.** You must propagate `NodeType`/`EdgeType` unions through the component, all hooks, and all callbacks (`OnNodesChange`, `OnEdgesChange`, `OnConnect`, `IsValidConnection`, …), which is boilerplate-heavy for a large node taxonomy. The docs devote a whole "Advanced usage / type unions" section to narrowing.
4. ⚠️ I did **not** find a systematic survey of TS pain points beyond the above; treat #3 as my assessment from reading the type surface, not a cited community consensus.

**Verdict:** strong, real, non-`any`-laden typing. The cost is generic ceremony, not missing types.

---

## 6. Performance at scale — what actually breaks first

### 6.1 ⚠️ There are **no rigorous published benchmarks**. State this plainly.

I found **no** credible, reproducible 1k/5k/10k-node benchmark of React Flow. What exists is: anecdotal issue reports, maintainer statements, and vendor marketing. Everything below is labelled accordingly.

### 6.2 The most telling fact: xyflow's own stress test uses **625 nodes**

✅ **Verified from source.** `examples/react/src/examples/Stress/index.tsx` does:

```js
const { nodes: initialNodes, edges: initialEdges } = getNodesAndEdges(25, 25);
```

and `getNodesAndEdges` generates an `xElements × yElements` grid — so **625 nodes / 624 edges** with deliberately trivial node bodies (`style: { width: 50, height: 30, fontSize: 11 }`, data is just a label). The example's actual purpose is frame-time recording (`FrameRecorder`), not large-scale stress. **The project's own "Stress" demo is roughly 1/16th of the way to 10,000 nodes, and its nodes are near-empty.**

That is an important calibration point when someone claims React Flow handles 10k nodes.

### 6.3 What breaks first — synthesised from the issues

**Ranked by evidence strength:**

**① Interaction triggers fleet-wide re-renders of handles/nodes.** This is the most damning recent report:
✅ [#5765 "Excessive Handle Component Re-renders Across All Nodes on Selection/Connection"](https://github.com/xyflow/xyflow/issues/5765) — opened **2026-04-30**, closed **2026-05-06**, 1 comment:
> *"When working with large graphs (e.g., ~10,000 nodes), selecting a single node or initiating a connection causes all Handle components across every node to re-render, even though only the source and target nodes are involved."*
Repro requires custom nodes wrapped in `React.memo` and 1–2 `Handle`s per node; the reporter observes the cascade via console logs / React DevTools Profiler. **⚠️ I could not verify how it was closed** — whether fixed in a release or closed as stale. GitHub's core API rate limit was exhausted (§10), and the issue HTML lazy-loads comments. **This is worth re-checking before relying on it**: if unfixed, it directly caps usable scale for a handle-rich node editor (which a Modelica/acausal editor is).

**② Pan/zoom with *complex custom* nodes, even at modest counts.**
✅ [#4711 "Performance issues with custom nodes (React)"](https://github.com/xyflow/xyflow/issues/4711) (2024-10-06, v12.3.1, closed 2024-10-07, 9 comments):
> *"I'm getting rather intense frame rate drops when dragging the background grid when using custom nodes. Interacting with individual nodes or changing their parameters performs very well as expected, however moving the background or zooming causes frame drops."*
Note the shape of this: **node-local interaction is fine; viewport transform is what hurts.** That is the signature of DOM layout/paint cost across all mounted nodes, since a viewport change repositions the whole node layer. It also warns that "the larger you make the preview window the worse the performance."

**③ The zoomed-out case defeats virtualization entirely.** This is the fundamental architectural limit. `onlyRenderVisibleElements` culls by viewport intersection — so when you zoom out to see the whole graph, **everything is in the viewport and nothing is culled.** The docs' own workaround is to hide nodes manually (§2.6, "collapse large node trees").

A commercial template vendor states this bluntly (⚠️ **vendor marketing — they sell a $100 template, treat as biased**): [VisualFlow, "Architecting for Massive Scale in React Flow"](https://www.visualflow.dev/blogs/scale-studio-pro), May 2026:
> *"By default, React Flow renders every single node into the DOM. While React is fast, the browser's paint engine is not designed to animate 10,000 highly-complex DOM elements simultaneously."*
> *"When a user zooms all the way out to see the entire 10,000 node map, every node becomes visible, bypassing the virtualization logic and instantly crashing the page."*
Their proposed fixes: `onlyRenderVisibleElements` + **semantic zoom / level-of-detail** (swap complex custom nodes for a bare `div` below ~0.5 zoom) + a **custom HTML5 canvas minimap** because *"A standard Minimap attempts to draw a tiny version of every node… For 10k nodes, this is fatal."* The LOD technique is sound and independently corroborated by [#5442](https://github.com/xyflow/xyflow/issues/5442) below (whose reporter found the same workaround helped); the numbers are unverified marketing.

**④ `onlyRenderVisibleElements` is necessary but insufficient.**
✅ [#5117 "Web is so laggy when showing more than 70k nodes"](https://github.com/xyflow/xyflow/issues/5117) (2025-03-26, v12.0.3, closed same day, 3 comments):
> *"Currently, I want to show about 70k nodes. **I already used onlyRenderVisibleElements props but the web is still stop UI**"*
Closed in a day, so likely dismissed as out of scope — but it documents that the prop alone does not rescue extreme counts.

**⑤ The maintainers acknowledge the virtualization design is improvable** — [#4239](https://github.com/xyflow/xyflow/issues/4239) (open 2+ years) and [#3883](https://github.com/xyflow/xyflow/issues/3883) (open 2.5+ years), both quoted in §2.3. The proposed BVH spatial index is **unimplemented**.

**⑥ A direct request for a canvas renderer, closed within a day.**
✅ [#5442](https://github.com/xyflow/xyflow/issues/5442) (2025-08-10 → closed 2025-08-11). The reporter's field report is the most useful single data point here because they describe their own mitigation attempts:
> *"the performance of HTML-based graph visualization is just pathetic once you do something relatively complicated with them"*
> *"With a visual programming language very similar to Unreal Engine's Blueprints, scripting becomes a challenge when the amount of nodes rises to 100."* — **100 nodes**, on a graph whose nodes are complex.
> They report they already tried: hiding node innards at low zoom via a CSS class (*"did help a lot"*), stripping HTML node contents entirely at low zoom (*"the immense lag when re-generating the markup and layout was not worth it"*), and disabling shadows/gradients (*"negligible impact"*).
> They also flag xyflow's own Svelte stress demo: *"Click the 'change pos' button, try zooming in and out, observe low FPS. This is not a prideful showcase."*

⚠️ **Read this one carefully and don't over-generalise:** that reporter's nodes are far heavier than typical, and the complaint is about *zoom/pan* cost, not node count per se. But "100 complex nodes is already painful" is a serious data point for a node editor with form-like node bodies.

**⑦ Older issues (🕒 v9/v10 era, likely stale — verify before citing):** [#967 "Performance drop when panning or zooming"](https://github.com/xyflow/xyflow/issues/967) (2021, 13 comments), [#1227](https://github.com/xyflow/xyflow/issues/1227) (2021, 12 comments), [#1437 "Slow performance on high-end mobile device with ~100 nodes"](https://github.com/xyflow/xyflow/issues/1437) (2021), [#2289 "Performance issues when running in development mode"](https://github.com/xyflow/xyflow/issues/2289) (2022), [#2073 "Performance drop when render big images on pane"](https://github.com/xyflow/xyflow/issues/2073) (2022).

### 6.4 Summary answer to "what breaks down first"

**Not** the node count in the abstract — **viewport manipulation (pan/zoom) and interactive state changes on graphs of *complex, DOM-heavy* custom nodes.** Concretely, in order:

1. **Zoom/pan frame rate** degrades first, because a viewport transform repositions every mounted DOM node; cost scales with *DOM complexity per node*, not just node count. Mitigations: LOD/semantic zoom, `visibility:hidden` / simplified node bodies below a zoom threshold, avoid shadows/gradients/animations.
2. **Selection and connection interactions** cause re-render cascades across unrelated nodes/handles at ~10k nodes ([#5765](https://github.com/xyflow/xyflow/issues/5765)) — memoizing custom nodes is necessary but apparently not sufficient.
3. **Zoomed-out views** bypass `onlyRenderVisibleElements` by definition — the pathological case, and unfixable without manual `hidden` management or LOD.
4. **The minimap** becomes a cost centre of its own at high node counts (SVG per node) — replaceable with a custom canvas.
5. **Edge count** is comparatively cheaper than node count (SVG paths are lighter than DOM subtrees), but edge *labels* and *animated* edges are expensive (the docs explicitly warn about animations).

**Practical implication:** the design should target **LOD from day one** (cheap placeholder rendering above/below a zoom threshold), treat `onlyRenderVisibleElements` as table stakes rather than a solution, keep node DOM shallow, and plan to write a **custom canvas minimap**. And note the biggest single lever is that `onlyRenderVisibleElements` **defaults to `false`**.

---

## 7. Custom node and custom edge rendering

### 7.1 Custom nodes

✅ **Verified (docs + shipped source).**

A custom node **is just a React component**. React Flow wraps it in its own interactive container and injects props (`id`, `data`, `selected`, `position`, `dragging`, …):

```jsx
export function TextUpdaterNode(props) {
  return (
    <div className="text-updater-node">
      <label htmlFor="text">Text:</label>
      <input id="text" name="text" className="nodrag" />
    </div>
  );
}
```

Registered via `nodeTypes`, which **must be defined outside the component or memoized** (§2.5), then selected with the node's `type` field:

```js
const nodeTypes = { textUpdater: TextUpdaterNode };   // module scope — NOT inline
const nodes = [{ id: 'node-1', type: 'textUpdater', position: { x: 0, y: 0 }, data: { value: 123 } }];
<ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} />
```

`Handle` components are placed **as children inside the node component**, and are plain `div`s:

```jsx
import { Handle, Position } from '@xyflow/react';
export function CustomNode() {
  return (
    <div className="custom-node">
      <div>Custom Node Content</div>
      <Handle type="source" position={Position.Top} />
      <Handle type="target" position={Position.Bottom} />
    </div>
  );
}
```

Useful specifics:
- **Multiple handles need unique `id`s**; wire edges with `sourceHandle` / `targetHandle`.
- **Custom handles**: wrap any component in `<Handle>`; set the inner element to `pointer-events: none`; hide the default visuals with `background: none; border: none`; size the `<Handle>` to match.
- **Dynamic handles**: if you change a handle's position or count programmatically, you must call `useUpdateNodeInternals()`.
- **Hiding a handle**: must use `visibility: hidden` or `opacity: 0` — **not `display: none`**, because React Flow measures handle dimensions and `display:none` reports 0×0. (Real gotcha for a Modelica editor that shows/hides connectors contextually.)
- **ResizeObserver** is used internally to track node size, which matters for Obsidian where panels resize.

### 7.2 Rendering into canvas from a custom node — **yes, but only as HTML content**

✅ Since the node body is a plain `<div>`, you can absolutely render `<canvas>` inside a custom node and drive it with `getContext('2d')` / WebGL. ✅ The official docs contain **user-authored canvas examples** confirming the pattern is supported: the Whiteboard section includes an **Eraser** component that is *"an overlay canvas for erasing nodes and edges"*, and there is a drawing-canvas-inside-a-node example.

**But note the boundaries:**
- The canvas lives **inside the DOM node**, so it does **not** remove the DOM node itself, its layout cost, or its transform cost — you still pay for a DOM element per node. It only lets you make the *contents* cheap.
- ⚠️ Documented caveat: the troubleshooting section has a dedicated entry, *"Mouse events aren't working consistently when my nodes contain a `<canvas />` element"*, because React Flow's listeners compute positions relative to DOM layout.
- You **cannot** render edges to canvas through any supported API. Edges are SVG; to draw edges on canvas you would have to bypass React Flow's edge layer entirely and draw your own overlay (losing built-in interaction, markers, and reconnection).

### 7.3 Custom edges

✅ **Verified.** Same pattern: a React component registered in `edgeTypes`. But the path itself **must be SVG**:

> *"An edge isn't much use to us if it doesn't render a path between two connected nodes. **These paths are always SVG-based** and are typically rendered using the `<BaseEdge />` component."*

```jsx
import { BaseEdge, getStraightPath } from '@xyflow/react';

export function CustomEdge({ id, sourceX, sourceY, targetX, targetY }) {
  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  return <BaseEdge id={id} path={edgePath} />;
}
const edgeTypes = { 'custom-edge': CustomEdge };
// then: { id: 'e1', source: 'n1', target: 'n2', type: 'custom-edge' }
```

Path helpers: `getBezierPath`, `getSimpleBezierPath`, `getSmoothStepPath`, `getStraightPath`. Typed as `EdgeProps<CustomEdge>`.

**Rendering HTML inside a custom edge** is possible but goes through a portal: `<EdgeLabelRenderer />` — *"Edges are SVG-based. If you want to render more complex labels you can use the `<EdgeLabelRenderer />` component to access a div based renderer. This component is a portal that renders the label in a `<div />` that is positioned on top of the edges."* So: SVG for geometry, DOM portal for rich content, plus manual `translate(${labelX}px, ${labelY}px)` positioning (and remember `nodrag nopan` classes). That portal indirection is worth knowing if you want e.g. interactive parameter annotations on connections.

---

## 8. Acausal / bidirectional suitability

**Short answer: nothing prevents modelling connections as undirected/bidirectional. The library supports it directly, and the maintainers' answer to "I want bidirectional handles" is `ConnectionMode="loose"`.**

### 8.1 Handles *are* typed, but the typing is not enforced

✅ `Handle`'s signature in the shipped source:

```js
function HandleComponent({
  type = 'source', position = Position.Top, isValidConnection,
  isConnectable = true,
  isConnectableStart = true,
  isConnectableEnd = true,
  ...
})
```

Note there are **two independent booleans** — `isConnectableStart` and `isConnectableEnd` — **both defaulting to `true`**. So a single handle can already act as both an origin and a destination, independent of its declared `type`.

### 8.2 `ConnectionMode.Loose` is the supported answer

✅ From the API reference:

```ts
enum ConnectionMode { Strict = 'strict', Loose = 'loose' }
```
> *"`Strict`: Connections can only be made starting from a source handle and ending on a target handle."*
> *"`Loose`: Connections can be made between any handles, regardless of type."*

`Strict` is the default. And the docs' Handles page has a section literally titled **"Typeless handles"**:

> *"If you want to create a handle that does not have a specific type (source or target), you can set `connectionMode` to `Loose` in the `<ReactFlow />` component. **This allows the handle to be used for both incoming and outgoing connections.**"*

The internal enum comment says the same: *"`Loose` mode allows source to source and target to target edges as well."*

### 8.3 The feature request for a first-class "bidirectional" handle type was **declined**

✅ [#3477 "Add support for 'bidirectional' Handle Type"](https://github.com/xyflow/xyflow/issues/3477) — opened **2023-10-05**, **closed the same day**, 5 comments, labelled `feature request`. The request was precisely your use case:

> *"A limitation of this system becomes apparent in the case where the desired design requires bidirectional Handles that allow for both source and target type connections… This helps a use case in a Process Flow where a common CustomNode component is using a single 'fallback' handle on the node that will originate from a node downstream in the flow sequence, and end up on the same 'fallback' handle of a separate CustomNode type earlier in the flow."*

It was closed same-day with 5 comments (⚠️ I could not read the comments — GitHub rate limit, §10), which in context almost certainly means "use `ConnectionMode.Loose` / `isConnectableStart` + `isConnectableEnd`" rather than adding a third handle type. **Treat the absence of a `"bidirectional"` handle type as a deliberate design decision, not an oversight.**

### 8.4 The one real modelling constraint: edges still carry `source` and `target`

**This is the crux for an acausal/Modelica-style editor.** Edges in the data model are directed by construction — an `Edge` has a `source` node/handle and a `target` node/handle, and the visual arrow markers and reconnect anchors follow that. With `ConnectionMode.Loose` you get **symmetric *connectability***, but you do **not** get an undirected *edge type*.

**Practical consequence — and this is entirely workable.** The recommended modelling is:

- Use `ConnectionMode="loose"` so any handle can connect to any handle.
- Give each connector **one** handle with a **stable id** (rather than pairing source/target), so a connection is symmetric in the UI.
- Store the **canonical** direction in your own data (e.g. `edge.data` or your Modelica AST), and treat React Flow's `source`/`target` as **arbitrary storage slots** chosen by a deterministic rule (lowest node id → `source`, say). On load and on connect, normalise.
- **Hide the arrow markers** (`markerEnd`/`markerStart`) if you want visually undirected edges — otherwise the UI implies causality you don't mean.
- Use `isValidConnection` to enforce your own acausality rules: reject same-node connections, enforce connector-type compatibility, and **canonicalise inside the callback** so the stored edge is always in your normal form.

**Verdict: suitable.** Nothing in React Flow blocks undirected semantics; you pay a small normalisation tax in your own data layer and must disable directional affordances. `ConnectionMode.Loose` + `isValidConnection` + marker suppression is the supported path.

---

## 9. Known issues running React Flow inside Obsidian

### 9.1 ⚠️ The honest headline: **there is essentially no prior art.**

I checked this hard, because "no results" is itself the most decision-relevant finding:

✅ **No plugin in Obsidian's official community plugin registry uses React Flow.** I downloaded [`community-plugins.json`](https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json) — **7,599 plugins** — and filtered for node/flow/canvas/graph editor plugins, then fetched the `package.json` of each plausible candidate and grepped its dependency list:

| Obsidian plugin | Backing technology | Uses React Flow? |
|---|---|---|
| `bragi-canvas` (node-based AI pipeline) | `fflate, monkey-around, pannellum, zod` | **No** |
| `obsidian-advanced-canvas` | `html-to-image, sass, tiny-jsonc` | **No** |
| `obsidian-mermaid-flow` | (none — native) | **No** |
| `obsidian-draw-a-mermaid` | (none — native) | **No** |
| `moredraw-obsidian` | (none — native) | **No** |
| `juggl` (graph viz) | **Cytoscape.js** | **No** |
| `obsidian-excalidraw-plugin` | Excalidraw's own canvas renderer | **No** |

Existing Obsidian node/canvas editors are built on **Obsidian's built-in Canvas API**, **Cytoscape.js**, **Mermaid**, or **Excalidraw** — not React Flow.

✅ **The Obsidian forum has ~zero React Flow discussion.** Forum search API: `"xyflow"` → **0 topics, 0 posts**; `"reactflow"` → **1 topic** (the thread below).

✅ **The one React Flow–related Obsidian repo is a *starter template*, not a shipped plugin**: [`AlexW00/obsidian-flow`](https://github.com/AlexW00/obsidian-flow) self-describes as *"A starter template for creating an Obsidian plugin with ReactJS."* It is **not** in the community plugin list. Its `package.json` is a useful compatibility data point though — it pairs React Flow with:
- `react@17.0.1`, `react-dom@17.0.1`, `@types/react@17.0.3`
- **both** `reactflow@^11.1.2` **and** `react-flow-renderer@^10.3.17`
- `zustand@^4.1.4`, `immer`, `rollup` + `@rollup/plugin-babel`
- and its README claims *"The production output of this sample plugin is ~200 KB"* — a useful sanity check that Obsidian's bundling target is a single `main.js`.

So: **React Flow in Obsidian is technically demonstrated but has no production precedent.** You would be an early adopter, and any integration problems will be yours to solve.

### 9.2 The one concrete, reported integration bug: sizing

✅ From the Obsidian forum thread [*"How can Obsidian be configured so that its default styles do not affect my own third-party libraries?"*](https://forum.obsidian.md/t/how-can-obsidian-be-configured-so-that-its-default-styles-do-not-affect-my-own-third-party-libraries/108081) (Nov 2025). A developer reports third-party React components losing their styling inside Obsidian, and a second developer replies with direct React Flow experience:

> *"I have too faced this issue in the past. For example, **I was using the reactFlow package. And when I imported it, I didnt saw anything.** Turn out, I had to **set the width and height of the reactFlow component to an absolute value**, then only it appear within the parent div properly."*

This is corroborated by React Flow's own built-in error `error004`: **"The parent container needs a width and a height to render the graph."** In Obsidian, an `ItemView`'s content element frequently has no resolved height, so a React Flow container will collapse to zero and render **nothing**. **This is the most likely first failure you will hit, and the fix is explicit `width`/`height` (or `flex:1` + `min-height:0` on a properly sized ancestor chain).**

Also from that thread: the developer **tried Shadow DOM to isolate Obsidian's global CSS and reported it did not work** (`attachShadow({mode:'open'})` + `createPortal` + `all: initial`). So plan on **CSS scoping by convention** (a wrapper class + `@layer`/specificity discipline) rather than Shadow DOM isolation. ⚠️ Since React Flow renders to `document`-level portals for some overlays (edge labels via `EdgeLabelRenderer`), Shadow DOM isolation would be structurally difficult anyway.

### 9.3 What I could **not** verify

⚠️ **No GitHub issue, Obsidian forum post, or Reddit thread describing a *production* React Flow Obsidian plugin's performance or bugs was found.** Specifically:
- Reddit: ❌ `reddit.com/search.json` and `old.reddit.com/search.json` were both blocked (empty/invalid responses), so **r/ObsidianMD is unverified**. I could not confirm or deny React Flow discussion there.
- No evidence either way on Electron-specific issues (GPU compositing, `backdrop-filter`, WebGL availability) inside Obsidian's Chromium. ⚠️ Inference only: Obsidian is Electron/Chromium and React Flow targets standard DOM/SVG, so there is no *structural* blocker — but this is reasoning, not a citation.
- Plugin-specific CSS conflicts with Obsidian's theme variables (`.theme-dark`/`.theme-light`) and its global resets are **likely** but only evidenced by the one thread above.

### 9.4 Practical Obsidian checklist derived from the above

1. **Set explicit width/height** on the React Flow container (or fix the ancestor flex/size chain). Expect this to be your first bug.
2. Turn on **`onlyRenderVisibleElements`** — it defaults to `false`.
3. **Memoize `nodeTypes`/`edgeTypes` at module scope** and `useCallback` all handlers — the dev-only warning will not fire in your production build, so a mistake here is silent.
4. Plan CSS isolation deliberately; **Shadow DOM is reported not to work**.
5. Budget **~320 KB minified / ~105 KB gzip** in `main.js` plus ~3 KB gzip CSS — and note Obsidian plugins are loaded on startup, so this is startup cost for every user.
6. Adopt **LOD/semantic zoom** and expect to write a **custom canvas minimap** if you scale past a few hundred nodes.
7. Verify **React 18/19 compatibility** with Obsidian's Electron version early; the template above used React 17, and React Flow's peer range is `>=17`.
8. Keep in mind there is **no community precedent to copy from** — budget discovery time.

---

## 10. Verification log — what I could not check

| Item | Status | What I tried |
|---|---|---|
| @xyflow/react bundle size | ✅ **Verified 3 ways** | bundlephobia API, shipped UMD measurement, own esbuild build |
| @xyflow/react dependency count | ✅ **Verified** | `npm ls --omit=dev --all` on clean install |
| packagephobia figure | ❌ **Blocked** | v2 API + result page → Vercel "Security Checkpoint" bot wall, then HTTP 429 |
| bundlephobia for `reactflow@11`, `react-flow-renderer@10`, `@xyflow/system` | ❌ **Blocked** | HTTP 429 on repeated attempts with cooldowns. **No verified v11-vs-v12 comparison available** |
| Old v11 performance docs (to check for now-removed node-count claims) | ❌ **Blocked** | Wayback CDX API → HTTP 429 ×3. `/learn/troubleshooting/performance` confirmed **404** today |
| Resolution of [#5765](https://github.com/xyflow/xyflow/issues/5765) (10k-node handle re-render cascade) | ⚠️ **Unverified** | GitHub core API rate limit hit 0; issue HTML lazy-loads comments; proxy returned 522. **Known: opened 2026-04-30, closed 2026-05-06. Unknown: fixed or stale-closed** |
| Comments on [#3477](https://github.com/xyflow/xyflow/issues/3477), [#3883](https://github.com/xyflow/xyflow/issues/3883) | ⚠️ **Unverified** | Same rate limit. Bodies and states obtained via the search API; comment text not |
| React Flow Pro FAQ answers | ⚠️ **Unverified** | FAQ is a client-rendered Radix accordion (`data-state="closed"`); answers absent from HTML. **Mitigated:** the authoritative [Pro License](https://xyflow.com/pro-license) was retrieved instead |
| r/ObsidianMD discussion | ❌ **Blocked** | reddit.com and old.reddit.com search JSON both blocked |
| Any published 1k/5k/10k benchmark | ❌ **Does not appear to exist** | Extensive search; only anecdotes + vendor marketing found |

**Known limitations of my own measurements:** the esbuild figures use esbuild's minifier, not terser, and tree-shake a minimal app; a real app importing more of the API will land somewhat higher than 179,759 B. The `npm ls` install-size figure includes type-only `@types` packages that add nothing to a runtime bundle. All GitHub metrics were captured at a single instant on 2026-09-13 and will drift.

---

## 11. Citations

**Primary package data**
- npm registry: `@xyflow/react` — https://registry.npmjs.org/@xyflow/react · package page https://www.npmjs.com/package/@xyflow/react
- npm registry: `@xyflow/system` — https://registry.npmjs.org/@xyflow/system
- npm registry: `reactflow` (v11) — https://registry.npmjs.org/reactflow
- npm registry: `react-flow-renderer` (v10, deprecated) — https://registry.npmjs.org/react-flow-renderer
- npm registry: `@xyflow/xy-ui` — https://registry.npmjs.org/@xyflow/xy-ui
- bundlephobia: `@xyflow/react` — https://bundlephobia.com/package/@xyflow/react (API: `https://bundlephobia.com/api/size?package=@xyflow/react@12`)
- packagephobia (⚠️ blocked) — https://packagephobia.com/result?p=@xyflow/react
- Package tarball inspected: `https://registry.npmjs.org/@xyflow/react/-/react-12.11.6.tgz`; system: `https://registry.npmjs.org/@xyflow/system/-/system-0.0.82.tgz`

**Official documentation**
- Performance — https://reactflow.dev/learn/advanced-use/performance
- Full docs corpus (used for exhaustive searching) — https://reactflow.dev/llms-full.txt · index https://reactflow.dev/llms.txt
- Custom Nodes — https://reactflow.dev/learn/customization/custom-nodes
- Custom Edges — https://reactflow.dev/learn/customization/custom-edges
- Handles (incl. "Typeless handles") — https://reactflow.dev/learn/customization/handles
- Usage with TypeScript — https://reactflow.dev/learn/advanced-use/typescript
- State Management — https://reactflow.dev/learn/advanced-use/state-management
- Common Errors (error002, error004) — https://reactflow.dev/learn/troubleshooting/common-errors
- `<ReactFlow />` API reference — https://reactflow.dev/api-reference/react-flow
- `ConnectionMode` type — https://reactflow.dev/api-reference/types/connection-mode
- `<Handle />` — https://reactflow.dev/api-reference/components/handle
- `<BaseEdge />` — https://reactflow.dev/api-reference/components/base-edge
- `<EdgeLabelRenderer />` — https://reactflow.dev/api-reference/components/edge-label-renderer
- `<MiniMap />` — https://reactflow.dev/api-reference/components/minimap
- `useStore()` — https://reactflow.dev/api-reference/hooks/use-store
- Migrate to v12 — https://reactflow.dev/learn/troubleshooting/migrate-to-v12
- ⚠️ Dead URL: https://reactflow.dev/learn/troubleshooting/performance → **404**

**Licensing**
- LICENSE (MIT, "Copyright (c) 2019-2025 webkid GmbH") — https://github.com/xyflow/xyflow/blob/main/LICENSE
- React Flow Pro — https://reactflow.dev/pro
- Remove Attribution — https://reactflow.dev/remove-attribution
- **xyflow Pro License v1.0** (updated 2026-08-24) — https://xyflow.com/pro-license
- About xyflow / webkid GmbH — https://xyflow.com/about · https://webkid.io/
- Terms of Use — https://xyflow.com/terms-of-use
- React Flow UI (shadcn/Tailwind registry, not an npm package) — https://reactflow.dev/ui

**Repository and maintenance**
- GitHub repo — https://github.com/xyflow/xyflow
- GitHub org — https://github.com/xyflow
- Official Stress example — https://github.com/xyflow/xyflow/blob/main/examples/react/src/examples/Stress/index.tsx and `.../Stress/utils.ts`
- npm registry API (version dates, SLSA provenance, `unpackedSize`) — https://registry.npmjs.org/@xyflow/react
- GitHub REST API (`/repos/xyflow/xyflow`, `/commits`, `/search/issues`) — https://api.github.com/repos/xyflow/xyflow

**GitHub issues referenced**
- [#3477 Add support for "bidirectional" Handle Type](https://github.com/xyflow/xyflow/issues/3477) — closed same day (2023-10-05)
- [#3883 check `onlyRenderVisibleElements` optimizations](https://github.com/xyflow/xyflow/issues/3883) — **open** since 2024-02-07
- [#4239 RFC - Spatial Queries & Virtualisation in XYFlow](https://github.com/xyflow/xyflow/issues/4239) — **open** since 2024-05-02, 21 comments
- [#4711 Performance issues with custom nodes (React)](https://github.com/xyflow/xyflow/issues/4711) — 2024-10-06
- [#5117 Web is so laggy when showing more than 70k nodes](https://github.com/xyflow/xyflow/issues/5117) — 2025-03-26
- [#5442 Performance recommendation: use canvas renderer on low zoom](https://github.com/xyflow/xyflow/issues/5442) — 2025-08-10 → closed 2025-08-11
- [#5487 onlyRenderVisibleElements but exclude some nodes](https://github.com/xyflow/xyflow/issues/5487) — **open**
- [#5751 predicate callback for box/lasso selection filtering](https://github.com/xyflow/xyflow/issues/5751) — **open**, 2026-04-13
- [#5765 Excessive Handle Component Re-renders Across All Nodes on Selection/Connection](https://github.com/xyflow/xyflow/issues/5765) — 2026-04-30 → closed 2026-05-06 ⚠️ resolution unverified
- [#3257 Import Node type kills TypeScript performance](https://github.com/xyflow/xyflow/issues/3257) — 2023-07-25 🕒 v11 era
- [#967 Performance drop when panning or zooming](https://github.com/xyflow/xyflow/issues/967) — 2021 🕒
- [#1227 Performance issues](https://github.com/xyflow/xyflow/issues/1227) — 2021 🕒
- [#1437 Slow performance on high-end mobile device with ~100 nodes](https://github.com/xyflow/xyflow/issues/1437) — 2021 🕒
- [#2289 Performance issues when running in development mode](https://github.com/xyflow/xyflow/issues/2289) — 2022 🕒
- [#2073 Performance drop when render big images on pane](https://github.com/xyflow/xyflow/issues/2073) — 2022 🕒
- [#4975 Discussion: improve performance with a large number of nodes and edges](https://github.com/xyflow/xyflow/discussions/4975) ⚠️ content not retrievable (bot wall)
- [#3033 Discussion: progressive loading for big diagrams](https://github.com/xyflow/xyflow/discussions/3033) ⚠️ content not retrievable

**Obsidian**
- Obsidian: Use React in your plugin — https://docs.obsidian.md/Plugins/Getting+started/Use+React+in+your+plugin · source https://github.com/obsidianmd/obsidian-developer-docs
- Obsidian community plugin registry (7,599 plugins) — https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json
- Obsidian forum: CSS interference + the React Flow width/height report — https://forum.obsidian.md/t/how-can-obsidian-be-configured-so-that-its-default-styles-do-not-affect-my-own-third-party-libraries/108081
- `AlexW00/obsidian-flow` (React plugin starter template, uses `reactflow@^11.1.2` + `react-flow-renderer@^10.3.17`) — https://github.com/AlexW00/obsidian-flow
- `HEmile/juggl` (Cytoscape.js, not React Flow) — https://github.com/HEmile/juggl
- `zsviczian/obsidian-excalidraw-plugin` (own canvas renderer) — https://github.com/zsviczian/obsidian-excalidraw-plugin
- Obsidian forum search API — https://forum.obsidian.md/search.json?q=reactflow
- ⚠️ r/ObsidianMD — could not query (blocked)

**Third-party (⚠️ assess bias)**
- VisualFlow, *"Architecting for Massive Scale in React Flow"*, May 2026 — https://www.visualflow.dev/blogs/scale-studio-pro — **commercial template vendor selling a $100 template; marketing content, numbers unverified**
- SynergyCodes, *Guide to Optimize React Flow Project Performance* — https://www.synergycodes.com/blog/guide-to-optimize-react-flow-project-performance
- *Tuning Edge Animations ReactFlow Optimal Performance* — https://liambx.com/blog/tuning-edge-animations-reactflow-optimal-performance
- *5 Ways to Optimize React Flow in 10 minutes* — https://www.youtube.com/watch?v=8M2qZ69iM20
