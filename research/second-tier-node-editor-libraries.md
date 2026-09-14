# "Second tier" node/graph editor & canvas libraries — technical research

**Research date: 2026-09-13.** All star counts, release dates and version numbers were
read from the GitHub REST API and the npm registry on that date. Bundle sizes were
**measured locally** by downloading each published npm tarball and gzipping the
library's own prebuilt dist file (`gzip -9`) — see [Bundle size methodology](#bundle-size-methodology).

Target context: an **Obsidian plugin** (Electron/Chromium, desktop + mobile). Therefore
**GPL / AGPL / commercial-only licences are hard blockers**, and licence text was read
from source rather than trusted from a badge.

---

## Executive summary

| # | Library | Rendering | Licence (verified) | min / gzip | Latest release | True editor? | Verdict for an Obsidian plugin |
|---|---|---|---|---|---|---|---|
| 1 | **Drawflow** | DOM nodes + SVG edges | **MIT** ✅ | 46 KB / **8.6 KB** | 0.0.60 — 2024-09-03 | ✅ yes | Smallest & permissive, but **stale ~23 months** |
| 2 | **Vue Flow** | DOM/HTML + SVG | **MIT** ✅ | 348 KB / **72.8 KB** | 1.48.2 — 2026-01-28 | ✅ yes | **Vue 3 only** — Obsidian is not Vue |
| 3 | **Svelte Flow** | DOM/HTML + SVG | **MIT** ✅ (+ attribution ask) | 164 KB / **57.8 KB** | 1.6.6 — 2026-09-01 | ✅ yes | **Svelte only** — Obsidian is not Svelte |
| 4 | **JointJS core** | SVG (HTML nodes are **Plus-only**) | **MPL-2.0** ⚠️ | 474 KB / **144 KB** | 4.3.3 — 2026-09-04 | ✅ yes | Strong, but file-level copyleft + key UX is paid |
| 5 | **GoJS** | **Canvas 2D** (+ opt-in SVG) | **Proprietary** ❌ | n/a (bundled) | 4.0.3 — 2026-07-17 | ✅ yes (best-in-class) | **HARD BLOCKER** — $3,995–$11,950 |
| 6 | **Cytoscape.js** | Canvas 2D + **WebGL preview mode** | **MIT** ✅ | 436 KB / **137 KB** | 3.34.3 — 2026-09-07 | ❌ **viz only** | Visualiser, not an editor |
| 7 | **AntV X6** | SVG + HTML (`foreignObject`) | **MIT** ✅ | 583 KB / **167 KB** | 3.1.8 — 2026-08-11 | ✅ yes | **Best licence-clean full editor** |
| 8 | **AntV G6 v5** | Canvas via `@antv/g` | **MIT** ✅ | 1.38 MB / **392 KB** | 5.1.1 — 2026-05-08 | ❌ viz engine | Visualiser; v5 has reported scale regressions |
| 9 | **LogicFlow** | **SVG nodes *and* edges** + HTML overlay | **Apache-2.0** ✅ | 420 KB / **121 KB** | 2.2.5 — 2026-07-30 | ✅ yes | Clean licence, EN docs complete, active; **no property panel** |
| 10 | **Butterfly** | **HTML DOM nodes + SVG edges** | **MIT** ✅ | 2.23 MB / 444 KB (unminified) | 5.1.0-**beta**.40 — 2024-05-20 | ✅ yes | **Unmaintained** (~28 months), 5.x in beta since 2022, **no TS at all** |
| 11 | **tldraw** | Canvas 2D + DOM/React | **Proprietary, source-available** ❌ | 1.76 MB / 524 KB | 5.4.2 — 2026-09-10 | Freeform canvas | **HARD BLOCKER** — no production use without a paid key |
| 12 | **Konva** | Canvas 2D, layered | **MIT** ✅ | 191 KB / **58.1 KB** | 10.5.0 — 2026-09-08 | ❌ primitives | Build the node editor yourself |
| 13 | **PixiJS** | WebGL2 / WebGPU (no canvas fallback in v8) | **MIT** ✅ | 819 KB / **232 KB** | 8.20.1 — 2026-08-26 | ❌ primitives | Wrong tool: no text input, no DOM |
| 14 | **Fabric.js** | Canvas 2D + object model | **MIT** ✅ | 299 KB / **92.3 KB** | 7.4.0 — 2026-05-18 | ❌ primitives | Freeform canvas objects, no graph model |

**Bottom line for the licence question:** only **GoJS** and **tldraw** are outright
blockers. Everything else is permissive (MIT / Apache-2.0) except **JointJS core**,
which is MPL-2.0 (file-level copyleft — fine to *link* from an MIT plugin, but any
modification to JointJS's own files must be published).

---

## 1. Drawflow — `github.com/jerosoler/Drawflow`

### Licence — investigated in depth, **no change was ever made**

This was flagged as a "license change controversy". **I could not find evidence that any
such change occurred, and I found positive evidence that it did not.** Three independent checks:

1. **Git history (definitive).** I cloned the repository and ran
   `git log --follow --format='%ad | %h | %s' -- LICENSE`. The result is a **single commit**:

   ```
   2020-04-28 | 0931e4d | Add license
   ```

   `git log --all --grep='licen' -i` also returns **only that one commit**. The LICENSE
   file has never been modified or removed since 2020-04-28. It is the standard MIT text
   ("Copyright (c) 2020 Jero Soler") ([LICENSE](https://raw.githubusercontent.com/jerosoler/Drawflow/master/LICENSE)).

2. **npm metadata across all 60 versions.** Querying the registry and printing the
   `license` field for every published version, it is `'MIT'` for **every single version
   from 0.0.1 (2020-04-28) through 0.0.60 (2024-09-03)** — no change point exists.

3. **The only licence "event"** is that the project's first commit (2020-04-21) contained
   only `README.md` — so it was published for ~7 days with no licence file at all (which
   legally means all-rights-reserved), before MIT was added on 2020-04-28. That is a
   7-day gap, not a relicense, and nothing was retracted.

> **Explicit finding:** I found **no MIT → X → MIT relicense event for Drawflow.** If the
> premise came from a specific issue or thread, it does not correspond to anything in the
> repository's history, the npm registry, or web search results. **Do not repeat the
> "license change controversy" claim without a primary source — it appears to be false.**

### Other attributes

| Attribute | Value |
|---|---|
| Rendering tech | **HTML/DOM nodes + SVG connections.** Verified from `dist/drawflow.min.js`: `createElementNS("http://www.w3.org/2000/svg", …)` for `svg`/`path`/`circle` (10 calls) and `document.createElement("div")` ×18 for nodes. No `foreignObject`, no canvas drawing. |
| Licence | **MIT** (verified in file + all 60 npm versions) |
| Bundle | `dist/drawflow.min.js` = **46,190 B raw / 8,649 B gzip** — by far the smallest here. Plus `drawflow.min.css`. |
| Latest release | **npm 0.0.60, 2024-09-03**; last repo push **2024-10-19** |
| Stars / forks | **6,118** / 887 |
| Open issues | **272** (a lot for the size — a staleness signal) |
| Maintenance | ⚠️ **Effectively stalled ~23 months.** No release or commit in ~11 months. |
| TypeScript | ❌ **Ships no types.** I extracted the published tarball: it contains only `dist/drawflow.min.js`, `drawflow.min.css`, `drawflow.style.js` — **zero `.d.ts` files**, and `package.json` has no `types` field. The community option is **`@types/drawflow`** on DefinitelyTyped: latest **0.0.12, published 2024-07-01**, 13 versions since 2021-02-18. |
| Performance @1000+ nodes | ⚠️ **No official benchmark exists.** A GitHub issue search for `performance` in titles returned exactly **1** issue: **#698 "Minimap simple suggestion / performance idea - how to" (2023-05-19, still open)** — not a benchmark. Because it is DOM-per-node, cost scales with live DOM nodes; there is no virtualisation, culling, or WebGL path. **Treat 1000+ nodes as unverified and likely poor.** |

**Editor or renderer?** ✅ **True editor.** Drag-to-connect, typed input/output ports,
per-node HTML content (so parameter UI is natural), zoom/pan, import/export JSON.

**Custom node rendering:** **very easy** — a node is a `<div>` with your own HTML, so
arbitrary domain-specific UI (sliders, dropdowns, Modelica parameter fields) is trivial
and needs no library API. This is its main strength.

**Obsidian fit:** technically the easiest to embed (DOM-based, 8.6 KB gzip, MIT), but the
stall + 272 open issues + zero first-party types are real risks. There are many forks
(e.g. `filchy/Drawflow`, `pronebel/fork-Drawflow`), which is itself a staleness signal.

---

## 2. Vue Flow — `@vue-flow/core`, `github.com/bcakmakoglu/vue-flow`

### Relationship to React Flow — **a port, NOT a shared codebase**

This is **confirmed by the maintainer's own README**, in the "Special Thanks" section:

> "**Vue flow is heavily based on webkid's ReactFlow.** I wholeheartedly thank them for
> their amazing work! Without VueFlow would not exist."
> — [README.md](https://raw.githubusercontent.com/bcakmakoglu/vue-flow/master/README.md)

The dependency graphs confirm they are **independent codebases**, not a shared core:

| Package | Runtime dependencies |
|---|---|
| `@xyflow/react` 12.11.6 | `zustand`, `classcat`, **`@xyflow/system`** |
| `@xyflow/svelte` 1.6.6 | `@svelte-put/shortcut`, **`@xyflow/system`** |
| `@vue-flow/core` 1.48.2 | `@vueuse/core`, **`d3-drag`, `d3-interpolate`, `d3-selection`, `d3-zoom`** |

React Flow and Svelte Flow share `@xyflow/system` (same vendor, `xyflow/xyflow`). Vue Flow
shares **nothing** with them — it is a from-scratch Vue 3 reimplementation that *borrowed
the design*, and it uses D3 for zoom/drag where xyflow uses its own system package. Vue
Flow predates `@xyflow/system`.

| Attribute | Value |
|---|---|
| Rendering tech | **DOM/HTML nodes + SVG edges** (Vue components rendered into the node DOM) |
| Licence | **MIT** ✅ — "Released under the MIT License" on [vueflow.dev](https://vueflow.dev/guide/); GitHub API SPDX = `MIT` |
| Bundle | `dist/vue-flow-core.js` = **347,959 B raw / 72,775 B gzip** (library's own prebuilt dist, not tree-shaken) |
| Latest release | **1.48.2, 2026-01-28**; last repo push **2026-07-14** |
| Stars / forks | **6,845** / 410 |
| Open issues | **19** (very healthy ratio — the lowest of any library here) |
| Maintenance | ✅ **Actively maintained** |
| TypeScript | ✅ **Written fully in TypeScript** ("Fully written in TypeScript", README); ships its own types |
| Framework lock-in | ⚠️ **Vue 3 only.** README: "**_This library doesn't work with Vue 2._** Vue Flow uses features that are exclusive to Vue 3." |
| Performance | ⚠️ **No numeric benchmark.** The only claim is qualitative: "Changes are tracked reactively by Vue Flow, ensuring that only the necessary elements are re-rendered." **1000+ node numbers are UNVERIFIED.** |
| Custom nodes | ✅ First-class: custom node/edge components, plus built-in `Background`, `MiniMap`, `Controls`, `NodeToolbar`, `NodeResizer`. |

**Editor or renderer?** ✅ True editor — dragging, zoom/pan, selection, connection handles
with `Handle` components, minimap.

**Obsidian fit:** ❌ **The blocker is Vue, not the licence.** An Obsidian plugin's UI is
plain DOM/TS (or Preact/React via community patterns). Mounting a Vue 3 runtime inside an
Obsidian ItemView is possible but adds a whole framework + reactivity runtime. Only
sensible if the plugin is already Vue-based.

---

## 3. Svelte Flow — `@xyflow/svelte` (same vendor as React Flow)

**Same vendor confirmed:** the monorepo is `xyflow/xyflow` (38,358 stars, MIT), which
publishes React Flow, Svelte Flow, and the shared `@xyflow/system`. README:
"React Flow | Svelte Flow - Powerful open source libraries for building node-based UIs."

### Licence: **MIT — but with an attribution request you must decide about**

- `packages/react/package.json` → `"license": "MIT"`; GitHub API SPDX = `MIT`.
- **xyflow's explicit public commitment** ([xyflow.com/open-source](https://xyflow.com/open-source)):
  > "We gave the React Flow library an MIT license as soon as we built it in 2019."
  > "**We'll keep our software MIT Licensed forever.**"
- Business model: "a **thin-crust open-core model**" — MIT covers "library, docs, github
  discussions, discord"; the paid part is "subscriber support, pro examples — these are
  handled by our Terms of Use instead of the MIT License."
- **The attribution nuance.** The library renders a "Svelte Flow" / "React Flow" link
  panel. From the actual component source
  ([`Attribution.svelte`](https://raw.githubusercontent.com/xyflow/xyflow/main/packages/svelte/src/lib/components/Attribution/Attribution.svelte)):

  ```svelte
  {#if !proOptions?.hideAttribution}
    <Panel class="svelte-flow__attribution"
      data-message={`Please only hide this attribution when you are subscribed to Svelte Flow Pro: ${link}`}>
  ```

  Behaviour: setting `proOptions={{ hideAttribution: true }}` **simply returns `null`** —
  there is no technical enforcement and **no licence term forbidding it**. It is a
  *request*, and in development mode the library logs an attribution warning via
  `handleAttributionWarning`. There *is* a community controversy about this: GitHub
  discussion **xyflow/xyflow#2015, titled "New attribution requirement and MIT license
  conflicts"** ([link](https://github.com/xyflow/xyflow/discussions/2015)). *(I could
  confirm the discussion title but the body is JS-rendered and I could not read it — I
  make no claim about its contents.)*

  **Practical read for an open-source plugin:** MIT legally permits hiding it; the polite
  and low-cost move is to leave it visible or ask xyflow (they offer "free access to our
  Pro examples to non-commercial open source projects").

| Attribute | Value |
|---|---|
| Rendering tech | **DOM/Svelte components + SVG edges** |
| Licence | **MIT** ✅ (with the attribution request above) |
| Bundle | Measured across all 129 files in `dist/lib/**`: **164,021 B raw / 57,766 B gzip total**. The ESM entry `dist/lib/index.js` alone is only 1,897 B — it is fully code-split, so the real cost is the sum of the chunks you touch. |
| Latest release | **1.6.6, 2026-09-01** |
| Stars | 38,358 (**shared** with React Flow in the monorepo — not Svelte-Flow-specific) |
| Maintenance | ✅ **Very active** (pushed 2026-09-10) |
| TypeScript | ✅ TypeScript-native; `dist/lib/index.d.ts` |
| Custom nodes | ✅ First-class (`/learn/customization/custom-nodes`), plus `Handle`, `NodeResizer`, `NodeToolbar`, `MiniMap`, `Background`, `ViewportPortal`, `<EdgeReconnectAnchor />`, `<EdgeToolbar />`, `ZIndexMode` |
| Framework lock-in | ⚠️ **Svelte only** |

**Obsidian fit:** ❌ Same blocker as Vue Flow — Obsidian is not a Svelte app. The licence
is fine; the framework is not.

---

## 4. JointJS — the core/Plus split is the whole story

### Licence: **core = MPL-2.0, Plus = commercial** (both verified)

| Package | Licence | Verified from |
|---|---|---|
| **`@joint/core`** (open source) | **MPL-2.0** | npm `license` field = `MPL-2.0`; GitHub API SPDX = `MPL-2.0` |
| **`@joint/plus`** (commercial) | Proprietary | Only distributed via private registry `https://npm.jointjs.com` or a customer-portal ZIP |
| legacy `jointjs` 3.7.7 (npm, superseded) | MPL-2.0 | npm `license` field |

The vendor's own licensing page states it plainly ([jointjs.com/license](https://www.jointjs.com/license)):

> "The JointJS library is licensed under the Open Source **Mozilla Public License Version
> 2.0**… The JointJS library does **not** include JointJS+."
> Tagline on the page: "**MPL 2.0 core, JointJS+ commercial**".

**I also checked for a JointJS licence change and found none.** Cloning `clientIO/joint`,
`git log -- LICENSE` returns exactly **one commit, 2013-07-19 ("first commit in version
0.6")**, and that file has been MPL-2.0 ever since. npm `license` is `MPL-2.0` for every
2.x and 3.x version I sampled (2.0.0 → 3.7.0).

### ⚠️ Backbone.js — **removed in v4.0.0 (this is the big 2025/2026 change)**

This was a specific question and the answer has changed:

| Package | Version | Dependencies |
|---|---|---|
| `jointjs` (legacy) | 3.7.7, 2023-11-07 | `dagre`, `jquery`, `lodash`, **`backbone ~1.4.1`**, `graphlib` |
| **`@joint/core`** | **4.3.3, 2026-09-04** | **`dependencies: null` — ZERO** |

Official confirmation, on the current docs page
([Third party dependencies](https://docs.jointjs.com/learn/help-center/third-party-dependencies/)):

> "**Since version 4.0.0, the main JointJS+ package (`@joint/plus`) has no dependencies
> apart from our own `@joint/core`** (MPL-2.0 license)"
> — `@joint/core`: "_No third party code_"; `@joint/plus`: "_No third party code_"

So the old "SVG via Backbone.js views + MVC" description is **obsolete for 2025+**. JointJS
4.x dropped Backbone, jQuery and Lodash entirely. It still keeps an `mvc` module internally
(`src/mvc/`, `mvc/Dom`) — but that is JointJS's **own** MVC layer, not Backbone.

### What the open-source core actually contains (verified by unpacking `@joint/core` 4.3.3)

`types/index.d.ts` exports exactly:
`config, env, setTheme, version, shapes, dia, elementTools, linkTools, anchors,
linkAnchors, highlighters, layout, connectionPoints, connectionStrategies, connectors,
routers, mvc, util, alg, V/Vectorizer/VElement, g (geometry)`.

The `src/` tree is: `alg, anchors, cellTools, config, connectionPoints,
connectionStrategies, connectors, core.mjs, dia, elementTools, env, g, highlighters,
layout, linkAnchors, linkTools, mvc, polyfills, routers, shapes, util, V`.

**Critically: there is no `ui/` directory and `src/shapes/` contains only `standard.mjs`.**
Grepping `dist/joint.js` for registered namespaces returns only
`joint.dia.Cell`, `joint.dia.Element`, `joint.dia.Link`, `joint.shapes.standard`.

**So the open-source core gives you:** the Graph/Paper model, `Element`/`Link`, SVG
rendering (`ElementView`/`LinkView`/`CellView`), standard shapes, ports (`dia/ports.mjs`),
labels, `elementTools`/`linkTools`/`cellTools`, highlighters, routers, connectors,
anchors, connection points/strategies, geometry + Vectorizer, layouts (incl.
`layout/ports`), `alg` (Dijkstra etc.), MVC, and **shipped TypeScript types**
(`"types": "./types/index.d.ts"`).

**What is gated behind the paid JointJS+** — the docs mark these with "JointJS+ provides…"
([docs.jointjs.com/learn/features](https://docs.jointjs.com/learn/features/)):

| Plus-only feature | Docs wording |
|---|---|
| **HTML Shapes** | Feature table lists "HTML Shapes — Shapes that contain HTML allowing for familiar and rich interactions" under the JointJS+ column |
| Element palette (**Stencil**) | "The plugin to implement a palette of JointJS Elements is called Stencil" |
| **Inspector** (property editor) | "creates a two way data binding between the Cell model and a generated HTML form" |
| **Halo**, **FreeTransform** (resize/rotate), **Toolbar** | "JointJS+ provides a Halo plugin…"; "JointJS+ provides a FreeTransform plugin…" |
| **PaperScroller** (zoom & scroll), **Navigator** (minimap) | "JointJS+ provides a Navigator plugin…" |
| **CommandManager** (undo/redo), **Clipboard**, **Keyboard** | "The plugin that keeps track of graph changes…" |
| **TextEditor** (inline rich-text editing), **Tooltip**, **Local** (localStorage), **Selection**, **Selection Region**, **Vector editor**, **Popups & Menus**, **Form controls** | all documented as Plus |
| Featured shapes (BPMN, VSM), extra layouts, Visio/BPMN import-export | Plus |
| `@joint/layout-directed-graph`, `@joint/router-avoid`, `@joint/format-*`, `@joint/shapes-vsm` | separate packages; note **`@joint/router-avoid` pulls `libavoid-js` which is LGPL-2.1-or-later** |

**Answer to the specific question:** yes — **"Kit"-style UI plugins and HTML node support
are commercial.** For an Obsidian plugin you would get SVG nodes + custom SVG markup for
free, and would have to **hand-build the inspector/parameter UI, undo/redo, minimap,
palette and inline text editing yourself** — which is precisely the work that makes a node
editor feel finished.

| Attribute | Value |
|---|---|
| Rendering tech | **SVG** (`ElementView`/`LinkView` produce SVG DOM). HTML nodes are Plus-only and internally use `foreignObject`. |
| Licence | **MPL-2.0** (core) / commercial (Plus). ⚠️ MPL-2.0 is **file-level copyleft**: you may link it from an MIT plugin, but modifications to JointJS's own files must be released under MPL-2.0. Not a blocker for *use*, but it is not "just MIT". |
| Bundle | `dist/joint.min.js` = **474,207 B raw / 144,327 B gzip** (+ separate `vectorizer.min.js` 93 KB / 26.8 KB and `geometry.min.js` 64 KB / 16.5 KB) |
| Latest release | **`@joint/core` 4.3.3, 2026-09-04** — cadence ~monthly through 2026 (4.2.0 Nov-2025 → 4.3.3 Sep-2026) |
| Stars / forks | **5,380** / 893 |
| Open issues | **49** |
| Maintenance | ✅ **Actively maintained** (pushed 2026-09-11); repo dates to 2009 |
| TypeScript | ✅ **Ships first-party types** (`types/index.d.ts`) |
| Performance @1000+ | ⚠️ **No benchmark.** JointJS's only "Performance" docs page covers **`SearchGraph` — "optimized for spatial queries" — and it is a JointJS+ feature.** SVG-per-node means 1000+ nodes is a lot of DOM; there is no virtualisation. **UNVERIFIED at scale.** |

**Editor or renderer?** ✅ True editor in core (drag, ports, link tools, routers) — but the
*UX layer* (property panels, undo/redo, palette, inline text edit) is paid.

---

## 5. GoJS — `nwoods.com` / `github.com/NorthwoodsSoftware/GoJS`

### ❌ Licence: proprietary — **hard blocker for an open-source plugin**

- npm `gojs@4.0.3` `license` field: **`"SEE LICENSE IN license.html"`**.
- The shipped `release/go.js` header (read directly from the published build):

  ```
  Copyright 1998-2026 by Northwoods Software Corporation.  All Rights Reserved.
  THIS SOFTWARE IS LICENSED.  THE LICENSE AGREEMENT IS AT: https://gojs.net/4.0.3/license.html.
  DO NOT MODIFY THIS FILE.  DO NOT DISTRIBUTE A MODIFIED COPY OF THE CONTENTS OF THIS FILE.
  ```

- The bundled `license.html` is the "Northwoods Software Software License Agreement":
  > "**The Software is licensed, not sold.** Northwoods retains all right, title, and
  > interest in and to the Software, including all trade secrets and intellectual property
  > rights. This Agreement does not grant Customer any rights to patents, trademarks, or
  > copyrights except as expressly set forth herein."

**Pricing is public** ([nwoods.com/sales](https://nwoods.com/sales)) — per-developer,
perpetual distribution rights, one year of support/updates:

| Tier | Developers | Price |
|---|---|---|
| Individual / sole proprietor | 1 | **$3,995** |
| Team | up to 3 | **$6,990** |
| Group | up to 20 | **$11,950** |
| Enterprise | unlimited | custom |

There are **no runtime fees or royalties**, and academic licences exist for non-commercial
use — but there is **no free/open-source tier**. For an MIT/Apache Obsidian plugin
distributed publicly, **this is a hard blocker**: you cannot ship GoJS to users who have
not each bought a licence, and the licence is per-developer (not per-app).

### Source availability — **NO. Only obfuscated builds.**

This is often misreported because the repo is public. The public repo
`NorthwoodsSoftware/GoJS` (8,475 stars) contains **builds, not source**:

| File | Size | Nature |
|---|---|---|
| `release/go.js` | 1,061,274 B | obfuscated/minified — `(function() {const root=…;class U{static yr=…` |
| `release/go-debug.js` | 1,109,976 B | **also obfuscated**, same structure, +debug assertions |
| `release/go.d.ts` | 1,644,900 B | full TypeScript typings |

`extensionsJSM/**/*.ts` are genuine TypeScript, but those are **optional extensions**, not
the core engine. **The core library source is not published.**

### Other attributes

| Attribute | Value |
|---|---|
| Rendering tech | **Canvas 2D by default**, with an optional SVG renderer. Official wording: "**By default, GoJS renders to an HTML Canvas. This is more performant, especially with larger graphs, and is the right choice for most users.**" SVG is opt-in via `Diagram.renderer = 'svg'` (and `Diagram.makeSvg` for export). |
| Latest release | **4.0.3, 2026-07-17**; "**June 2026: GoJS 4.0 released!**" |
| Stars | 8,475 (repo is builds + demos + issue tracker) |
| Dependencies | **zero** ("GoJS is a self-contained library with zero dependencies") |
| TypeScript | ✅ Excellent — ships `release/go.d.ts`; dedicated typings guide including `checkJs`/`allowJs` support for plain JS |
| Electron | ✅ Explicitly supported: "Drop it into React, Vue, Angular, Svelte, **Electron**, or vanilla JS" |

### Performance claims — from their official performance page

[gojs.net/latest/learn/performance](https://gojs.net/latest/learn/performance):

> "Getting good performance for your diagrams **does not require any effort on your part
> when the diagrams are limited to a few hundreds of nodes and links**… However when your
> app might deal with **thousands or tens of thousands** of nodes and links, you may need to
> adapt your implementation to avoid expensive features."

Documented optimisations at that scale: share geometries via fixed-size simple figures
(`"Rectangle"`, `"Circle"`, …); avoid `Link.routing = AvoidsNodes` ("can be slow in very
large graphs"); avoid `Curve.JumpOver`/`JumpGap`; `LayeredDigraphLayout` "can be very slow
on graphs with thousands of nodes and links"; `ForceDirectedLayout` "can also be slow on
large graphs"; and **virtualisation** — the **Virtualized Tree sample "contains 123,456
total nodes, yet is fairly quick to load and render"** because it only constructs
nodes/links intersecting the viewport.

**So the honest reading:** GoJS handles hundreds with no effort, thousands with tuning, and
100k+ only with viewport virtualisation that "does complicate the implementation."

**Editor or renderer?** ✅ **The most complete true editor here** — templates + data binding,
transactions/undo-redo, built-in drag/resize/link-draw tools, ports, groups/subgraphs,
automatic link routing, context menus, tooltips, palettes, layouts, image/SVG export.
Moot for this project because of the licence.

---

## 6. Cytoscape.js — a graph **theory/visualisation** library, not an editor

### Rendering tech — there IS an official WebGL renderer (I verified this carefully)

The common claim "Cytoscape.js is Canvas 2D only" is **out of date**. What I verified:

- **Official blog post, "WebGL Renderer Preview", 2025-01-13, by Mike Kucera**
  ([blog.js.cytoscape.org](https://blog.js.cytoscape.org/2025/01/13/webgl-preview/)):
  > "**Version 3.31 of Cytoscape.js contains a preview of a new WebGL renderer that uses
  > the GPU to improve rendering performance.** This is particularly noticeable for large
  > networks."
- **It is a mode of the canvas renderer, not a separate renderer**, per the same post:
  > "In reality the WebGL renderer isn't really a new renderer. It's **more like a new mode
  > for the Canvas renderer.**"
  Enabled with:
  ```js
  cytoscape({ renderer: { name: 'canvas', webgl: true, showFps: true, webglTexSize: 4096, … } })
  ```
- **It ships in the current release.** I unpacked `cytoscape@3.34.3`: `dist/cytoscape.min.js`
  contains **57** case-insensitive `webgl` matches, `dist/cytoscape.cjs.js` **104**, and the
  option names present are `webglBatchSize`, `webglBgColor`, `webglDebug`,
  `webglDebugShowAtlases`, `webglTexPerBatch`, `webglTexRows`, `webglTexRowsNodes`,
  `webglTexSize`. The source subtree
  `package/src/extensions/renderer/canvas/webgl/{atlas,drawing-elements-webgl,
  drawing-redraw-webgl,fxaa-upscaler,shader-sdf,webgl-util}.mjs` is shipped too.
- ⚠️ **Caveat: it is still "preview" and not in the public API reference.**
  `webgl` appears **0 times** in the main API documentation. Options "are provisional and
  may change."
- ❌ There is **no separate `cytoscape-webgl` package** — I checked the npm registry:
  `cytoscape-webgl`, `cytoscape-webgl-renderer`, `@cytoscape/webgl` are **all 404**.
  (`cytoscape-canvas` 3.0.1 exists but is unrelated — "drawing over and under a graph".)

**WebGL limitations (official, same post)** — relevant because they hit exactly what a
node editor needs: only straight / haystack / bezier edges (taxi & segmented fall back to
bezier); **dashed lines, overlays and underlays unsupported**; only one centre edge label
(no source/target labels); only triangle arrowheads; **no colour gradients**. Nodes and
labels are fully supported via a canvas-rendered sprite-sheet texture atlas.

### Performance — official numbers (M1 MacBook Pro, Chrome)

| Network | Canvas renderer | WebGL renderer |
|---|---|---|
| ~1,200 nodes / 16,000 edges (EnrichmentMap) | ~20 FPS | **>100 FPS** |
| ~3,200 nodes / 68,000 edges (NDEx) | **3 FPS** | **10 FPS** |

The author's own framing: "This type of testing is **subjective**… In other words: YMMV."
and "10 FPS is still not really smooth animation, but it is a significant improvement over
3 FPS which is borderline unusable."

### Why it is a poor fit as an **editor**

| Attribute | Value |
|---|---|
| Licence | **MIT** ✅ (repo LICENSE + GitHub API SPDX = `MIT`) |
| Bundle | `dist/cytoscape.min.js` = **435,503 B raw / 137,167 B gzip** (bundlephobia: 435,583 / 136,995 — matches) |
| Latest release | **3.34.3, 2026-09-07** |
| Stars / forks | **11,208** / 1,675 |
| Open issues | **20** |
| Maintenance | ✅ **Very active** (pushed 2026-09-13) |
| Dependencies | **zero** |
| Self-description | "**Graph theory (network) library for visualisation and analysis**" (repo description; README: "a fully featured graph theory library") |
| TypeScript | ✅ **Bundles its own types** — `cytoscape@3.34.3` has `"types": "index.d.ts"` at the package root. `@types/cytoscape` also exists on DefinitelyTyped (latest **3.31.0, 2025-10-10**) but **lags the library** (3.31.0 vs 3.34.3) — prefer the bundled ones. ⚠️ Whether `renderer.webgl` is typed in either `.d.ts` is **UNVERIFIED** (not inspected). |

**Editor verdict: ❌ renderer/visualiser only.**

- **No edge-creation gesture exists in the library.** The official
  [gestures list](https://js.cytoscape.org/#notation/gestures) is complete and contains:
  pan, pinch/wheel zoom, tap to select, tap/taphold background to unselect,
  modifier+click multi-select, box selection, and "**Grab and drag nodes**". You can drag
  the background (pan) and drag nodes to reposition — but there is **no drag-from-node-to-
  create-edge** gesture. Edges are added programmatically via `cy.add()`.
- **Interactive edge-drawing is a third-party extension.** `cytoscape-edgehandles` README:
  "**This extension allows for drawing edges between nodes**" — npm **4.0.1, last published
  2021-07-28** (~5 years stale; the registry `modified` timestamp of 2026-08-06 is metadata
  only, there has been no new version since 2021). Its existence is the evidence that
  drag-to-connect is not built in. *(Caveat: npm's `repository` field points at
  `github.com/cytoscape/edgehandles`, which 404s; the live repo is
  `github.com/cytoscape/cytoscape.js-edgehandles`.)*
- **No property/parameter editing UI at all**: zero matches for "property editor",
  "properties panel", "inspector panel" or "edit panel" in the official docs.
- **No editing model**: no port typing, no parameter dialogs, no node inspector, no
  undo/redo of graph edits, no notion of an editable document. It is a renderer over an
  element list with a rich style system and layout/analysis algorithms.
- Practically everything an editor needs — connection dragging, port semantics, parameter
  UI, validation, serialisation of an edited document — would be built on top.

⚠️ **Note on Cytoscape's own performance docs:** the official
[performance section](https://js.cytoscape.org/#performance) contains **no absolute
node-count/FPS figures**. Its only quantitative claim is comparative: "**Opaque edges with
arrows are more than twice as fast as semitransparent edges with arrows.**" It also warns
"**Edges are particularly expensive to render**" and recommends haystack edges and
`pixelRatio: 1` on retina. All the usable numbers are in the WebGL blog post above.

---

## 7. AntV X6 — `@antv/x6` — the strongest licence-clean full editor

**Official self-description** ([site/docs/tutorial/about.en.md](https://raw.githubusercontent.com/antvis/X6/master/site/docs/tutorial/about.en.md)):

> "**X6 is a graph editing engine based on HTML and SVG**, offering low-cost customization
> capabilities and out-of-the-box built-in extensions, making it easy for us to quickly
> build applications such as DAG diagrams, ER diagrams, flowcharts, and lineage graphs."

Features listed by the vendor: "Supports customizing node styles and interactions using
**SVG/HTML/React/Vue/Angular**"; "Comes with **10+ built-in graph editing extensions**,
such as selection, alignment lines, mini-map"; "**Data-Driven: Based on MVC architecture**";
"Event-Driven."

### X6 vs G6 — the vendor's own framing (confirmed)

| | **X6** | **G6** |
|---|---|---|
| Official words | "**graph editing engine**" | "**graph visualization engine**" |
| Source | X6 `about.en.md` | G6 `packages/g6/README.en-US.md`: "*G6 is a graph visualization engine, which provides a set of basic mechanisms, including rendering, layout, analysis, interaction, animation*" |
| Built for | DAG/ER/flowchart/lineage **editors** | relational-data **insight**, "graph visualization **analysis** applications" |

So the requested framing — **G6 = visualisation, X6 = editing** — is **confirmed verbatim
by AntV's own docs**. They are sibling products from AntV/Alibaba, not versions of each other.

### Rendering tech — SVG primary, HTML via `foreignObject`

X6's node docs are explicit:

> "X6 is based on an **`SVG` rendering engine**, which allows for rendering nodes and edges
> using different SVG elements, making it particularly suitable for scenarios where node
> content is relatively simple. For more complex nodes, there is a special `foreignObject`
> element in `SVG` that can embed any XHTML elements. This element can be used to render
> **HTML, React/Vue/Angular components**."

Vendor guidance: use SVG nodes for simple/fixed content, **framework components otherwise**.
Built-in `Shape.HTML` (`shape: 'html'`) uses `foreignObject`.

⚠️ **Documented caveat you must plan for** (same page):
> "The React/Vue/HTML rendering methods also have some limitations. Due to browser
> compatibility issues, there may occasionally be some abnormal rendering behaviors,
> primarily manifested as **incomplete node content display or flickering** of node content.
> This can be mitigated by avoiding the use of `position:absolute`, `position:relative`,
> `transform`, and `opacity` in the CSS styles of internal elements of the node."

For a Modelica node editor wanting rich parameter widgets in nodes, this is a real design
constraint (no `position:absolute`/`transform` inside node HTML). There is **no Canvas
rendering mode** for X6 — it is SVG/HTML by design.

### Performance at scale — **official virtual rendering, added in 3.0.0**

X6 3.0.0 (2025-11-21) added first-class virtualisation. From the
[CHANGELOG](https://raw.githubusercontent.com/antvis/X6/master/CHANGELOG.md):

> "**虚拟渲染能力：在大图场景可开启 `virtual: true`，仅渲染可视区域并自动加入缓冲边距以提升性能**"
> — *"Virtual rendering: in large-graph scenarios enable `virtual: true` to render only the
> visible region and automatically add a buffer margin to improve performance"*
> (source refs given as `src/graph/virtual-render.ts:94-106`)

3.1.0 (2025-12-01) extended it: "`virtual` supports an object config `VirtualOptions`, with
`enabled` and `margin` to finely control the virtual-render switch and buffer margin."
Throttling of scroll/pan/zoom events and a dynamic render margin (fixed 120px) are noted in
the 3.0.0 changelog.

**Official example is exactly at the 1000-node scale** — `site/examples/showcase/practices/demo/virtualRender.ts`
creates **`const count = 1000`** nodes and configures:

```ts
const graph = new Graph({ container: host, mousewheel: true, virtual: true, grid: true })
graph.use(new Scroller({ enabled: true, pannable: true }))
```

⚠️ **This is an example, not a benchmark** — X6 publishes **no FPS/timing numbers**. So:
1000 nodes with `virtual: true` is an officially supported, officially demonstrated
configuration; **quantitative performance is UNVERIFIED**.

Known caveat: [issue #3668](https://github.com/antvis/X6/issues/3668) reports that with
virtual rendering enabled, nodes/connectors hide when they leave the visible area (expected
behaviour, but a gotcha if you rely on off-screen measurement/export).

### TypeScript & custom node registration

| Attribute | Value |
|---|---|
| Licence | **MIT** ✅ (GitHub API SPDX `MIT`; MIT badge in README) |
| Bundle | `dist/x6.min.js` = **583,499 B raw / 167,109 B gzip**. Runtime deps: `dom-align`, `lodash-es`, `mousetrap`, `utility-types`. |
| Latest release | **3.1.8, 2026-08-11** |
| Stars / forks | **6,702** / 1,895 |
| Open issues | **148** |
| Maintenance | ✅ **Active**, Alibaba/AntV-backed (pushed 2026-08-11; 3.0.0 Nov-2025 → 3.1.8 Aug-2026) |
| TypeScript | ✅ **Written in TypeScript** (repo language = TypeScript; TS badge); ships `lib/**/*.d.ts` and `es/**/*.d.ts` (2,375 files in package) |
| ⚠️ v3 breaking change | **All `@antv/x6-plugin-*` sub-packages were merged into `@antv/x6`.** Remove `@antv/x6-plugin-selection`, `-transform`, `-scroller`, `-keyboard`, `-history`, `-clipboard`, `-snapline`, `-dnd`, `-minimap`, `-stencil`, `-export`, plus `@antv/x6-common` and `@antv/x6-geometry`. Import paths change; `graph.use(new Selection())` usage is unchanged. `transition` animation API replaced by `animate`. `panning` is now on by default. |

**Custom node registration — verified from the official example**
([`site/src/tutorial/basic/node/registry/index.tsx`](https://raw.githubusercontent.com/antvis/X6/master/site/src/tutorial/basic/node/registry/index.tsx)).
`markup` is "analogous to HTML" and `attrs` to "CSS":

```ts
Graph.registerNode('custom-node', {
  inherit: 'rect',
  width: 100, height: 40,
  markup: [
    { tagName: 'rect',  selector: 'body'  },
    { tagName: 'image', selector: 'img'   },
    { tagName: 'text',  selector: 'label' },
  ],
  attrs: {
    body: { stroke: '#8f8f8f', strokeWidth: 1, fill: '#fff', rx: 6, ry: 6 },
    img:  { 'xlink:href': '…antv.png', width: 16, height: 16, x: 12, y: 12 },
  },
}, true)   // third arg = overwrite

graph.addNode({ shape: 'custom-node', x: 40, y: 40, label: 'hello' })
```

So custom nodes are **declarative SVG markup + attribute objects**, registered once by name
and reused by `shape` — clean and very amenable to domain-specific node rendering. For rich
HTML/parameter UI you register an HTML/React/Vue node instead (`Shape.HTML` /
`@antv/x6-react-shape`), subject to the `foreignObject` caveats above.
Nodes are also mutable post-render via `node.prop(path, value)` and `node.attr(path, value)`.

**Editor or renderer?** ✅ **True editor.** Ships (now in the main package) `Selection`,
`Transform`, `Scroller`, `Keyboard`, `History`, `Clipboard`, `Snapline`, `Dnd`, `MiniMap`,
`Stencil`, `Export` — i.e. **undo/redo, selection, transform, palette/stencil, minimap,
keyboard shortcuts, clipboard and export are all included and MIT-licensed.** Ports,
connection points, routers, connectors, edge/node tools are core. This is the only library
in this report that gives a *complete editing UX* under a permissive licence.

---

## 8. AntV G6 v5 — `@antv/g6` — visualisation, not editing

| Attribute | Value |
|---|---|
| Nature | ❌ **Visualisation engine, not an editor.** Self-description: "**G6 is a graph visualization engine**, which provides a set of basic mechanisms, including rendering, layout, analysis, interaction, animation, and other auxiliary tools." "Developers are able to build graph visualization **analysis** applications or graph visualization **modeling** applications easily." |
| Rendering tech | **Canvas via `@antv/g`.** `@antv/g6` deps include `@antv/g` **and `@antv/g-canvas`**; grepping the shipped `lib/` finds `@antv/g-canvas` but **no `webgl` reference**. A WebGL backend exists in the ecosystem (`@antv/g-webgl` 2.1.1, MIT, 2025-12-24) but is **not** a G6 v5 default dependency, and I found no G6 v5 doc page documenting a `renderer: 'webgl'` graph option — **G6 v5 WebGL support: UNVERIFIED.** |
| Licence | **MIT** ✅ |
| Bundle | `dist/g6.min.js` = **1,383,347 B raw / 392,037 B gzip** — the largest JS bundle here (2.4× X6) |
| Latest release | ⚠️ **5.1.1, 2026-05-08.** Note: registry `time` also lists `5.2.1` and `5.3.1` (both 2026-05-19) but they are **absent from `versions` and return HTTP 404 "version not found"** — i.e. they were **unpublished**. `dist-tags.latest` = `5.1.1`. |
| Stars / forks | **12,291** / 1,643 |
| Open issues | **333** (highest of any library here) |
| Maintenance | ✅ Active-ish (pushed 2026-07-15) |
| TypeScript | ✅ TypeScript ("A Graph Visualization Framework in TypeScript") |

### Performance claims — and a significant caveat

G6 has an **official performance doc** in the repo
(`packages/site/docs/manual/FAQ/performance-opt.en.md`), plus **official performance demos**
at three data volumes: **"5k+ graphic shapes, almost 2w [20,000] graphic shapes and 5W+
[50,000] graphic shapes"** (`examples/performance/perf/`, demos `netscience.js`, `eva.js`,
`moreData.js`).

Key official statements:
> "G6 has two performance bottleneck: **rendering and computation**."
> "the performance is mainly affected by **the total number of shapes on the canvas**."
> "**the performance of SVG is much worse than Canvas.** If you have medium size or large
> size data to visualize, we strongly suggest you use Canvas instead of SVG."

⚠️ **Accuracy caveat: that performance doc is v4-era content retained in the master branch.**
It documents `renderer: 'svg'`, `group.addShape('dom', …)`, `graph.getGroup()`, and links to
`g6-v4.antv.vision` demos — APIs that changed in v5. I would not present it as a v5 benchmark.

⚠️ **Reported v5 scale regressions (user-filed issues, not official claims):**
- [G6 #7574](https://github.com/antvis/G6/issues/7574) — *"5.0 rendering large data is
  noticeably weaker than 4.0; **above two-to-three thousand it just fails to render**"*
- [G6 #7566](https://github.com/antvis/G6/issues/7566) — *"5.x with custom nodes rendering
  **10,000 nodes goes blank and reports out-of-memory**, whereas 4.x canvas rendering of the
  same data works"*
- [G6 #5994](https://github.com/antvis/G6/issues/5994) — "highlight node performance v4 vs v5"

**Editor or renderer?** ❌ Renderer/visualiser. It has 10+ interaction *behaviours* and
supports "modeling" apps, but it is a visualisation engine: no property/parameter UI, no
palette, no undo/redo editing model, no port typing.

---

## 9. LogicFlow — `github.com/didi/LogicFlow`

⚠️ **Correction to a common citation: `logicflow.site` is DEAD.** I tested it: `https://logicflow.site/`
returns **HTTP 000 (connection timeout)**. The current official docs are at
**<https://site.logic-flow.cn>** (HTTP 200; English at `/en/` also HTTP 200), and both the
repo README and `.dumirc.ts` point there. Do not cite `logicflow.site`.

| Attribute | Value |
|---|---|
| Licence | **Apache-2.0** ✅ (GitHub API SPDX = `Apache-2.0`; npm `license` = `Apache-2.0` for both `@logicflow/core` and `@logicflow/extension`) |
| Self-description | "A flow chart **editing** framework focus on **business customization**. 专注于业务自定义的流程图编辑框架" |
| Rendering tech | ⚠️ **Not "SVG nodes vs HTML edges" — both nodes and edges are SVG; HTML is a separate overlay layer.** Official architecture article: "**we choose to use HTML + Svg to complete the rendering of the diagram, Svg is responsible for the graphics, line part, HTML to achieve text, menu, background and other layers**." Node tutorial: "**LogicFlow is a flowchart editing framework based on SVG.** Therefore, our nodes and connections are basic SVG shapes." Source: node view root is `<g className="lf-node-content">`, edge `getShape()` returns an SVG `<path>`, and the **HTML node** is a `<rect>` + SVG **`<foreignObject>`** with user DOM injected via `setHtml(rootEl: SVGForeignObjectElement)`. Grid/background/overlays are Preact HTML components. Preact confirmed: "LogicFlow is developed based on `preact`". |
| Bundle | `@logicflow/core` `dist/index.min.js` = **419,881 B raw / 120,585 B gzip**; `@logicflow/extension` = **561,326 B / 159,724 B gzip** |
| Latest release | **`@logicflow/core` 2.2.5 and `@logicflow/extension` 2.3.1, both 2026-07-30** |
| Stars / forks | **11,691** / 1,384 |
| Open issues | **119** |
| Maintenance | ✅ **Active in 2026** — last master commit **2026-07-30**; `@logicflow/core` 2.2.3 (2026-05-12) → 2.2.4 (2026-07-06) → 2.2.5 (2026-07-30); extension/layout/react-node-registry all 2026-07-30. The dead `logicflow.site` is a **stale alias only**, not a sign of abandonment. |
| TypeScript | ✅ **Written in TypeScript and bundles its own types** — `"types": "lib/index.d.ts"`, **220 `.d.ts` files** ship in `@logicflow/core@2.2.5`. No `@types` package needed. |
| Docs language | ✅ **Chinese-first but the English translation is essentially complete.** `.dumirc.ts` sets `defaultLanguage: 'zh'` with `locales: ['zh','en']`. Measured on a full master clone: **73 `.zh.md` and 76 `.en.md` — zero Chinese-only pages** (3 pages are English-only). Chinese: <https://site.logic-flow.cn/> · English: <https://site.logic-flow.cn/en/>. |
| Dependencies | core: `lodash-es, classnames, mobx, mobx-preact, mobx-utils, mousetrap, preact, uuid` |

**Editor or renderer?** ✅ **True editor** — drag-to-connect, anchors
(`getDefaultAnchor(): AnchorConfig[]`), connection rules, edge adjustment, undo/redo
(`core/src/history/`), selection, resize, snaplines. Model/view separation is explicit:
"`model`: Data layer… `view`: View layer controlling the final rendering effects of nodes…
LogicFlow is based on the **MVVM** pattern."

**Custom node API — corrected:** it is **`lf.register(config)` / `lf.batchRegister(list)`**,
not `registerNode`; and there is **no `setSvg`**:
```ts
lf.register({ type: 'custom-rect', view: CustomRectNode, model: CustomRectModel })
// register(config: RegisterConfig): void ; batchRegister(configList: RegisterConfig[]): void
```
`view` extends `BaseNode`/`BaseEdge`, `model` extends `BaseNodeModel`/`BaseEdgeModel`. The SVG
view method is **`getShape()`** (16 implementations under `view/`), with SVG built via the
exposed `h(nodeName, attrs, [...children])`. **`setHtml(rootEl)` exists only on the
`HtmlNode` view** (injecting DOM into the `foreignObject`). Priority: "theme < custom node mod
< custom node view". ⚠️ Caveat from the docs: width/height must be set on the **model** or
"the anchor position and outline size will be incorrect."

⚠️ **Correction: neither LogicFlow core nor `@logicflow/extension` ships a property panel.**
The full extension UI surface is `Control, Menu, ContextMenu, DndPanel, MiniMap,
SelectionSelect, Highlight, Snapshot` — and **`DndPanel` is a drag-material palette, not an
inspector**. A property/parameter panel must be built yourself (the documented route is the
HTML component layer: "supports registering components on the HTML layer… such as the
right-click menu of the node, the control panel, etc.").

**Performance @1000+:** ⚠️ **No official benchmark exists — UNVERIFIED.** The only official
scale framing is an assumption in the architecture article: "In the flowchart scenario, there
is no need to render a large number of nodes (**up to thousands of elements**)." A `partial`
(local/partial rendering) option does ship ("Whether to enable partial rendering"). The
tens-of-thousands lag report is a **user-filed issue, not an official measurement**
([#1665](https://github.com/didi/LogicFlow/issues/1665), plus #1603, #1596 on minimap perf).

**Obsidian fit:** licence (Apache-2.0) and TS support are clean, and the English docs are
complete — better than commonly assumed. The Preact + MobX runtime is extra weight for a
plugin that likely already has a UI layer, and the missing property panel means you build the
parameter UI yourself (though LogicFlow's HTML overlay layer makes that straightforward).

---

## 10. Butterfly — `github.com/alibaba/butterfly` — ⚠️ unmaintained

> ⚠️ **Two widely-repeated claims about Butterfly are false and are corrected below:**
> it does **not** render the graph with Canvas (it is **HTML DOM nodes + SVG edges**), and
> its docs are **not** Chinese-only (they are **bilingual**).

| Attribute | Value |
|---|---|
| Licence | **MIT** ✅ — LICENSE file: "MIT License / Copyright (c) 2019 Alibaba Group Holding Limited and other contributors." MIT on all branches. |
| Rendering tech | ⚠️ **HTML DOM nodes + SVG edges. NOT Canvas.** Verified from source and official docs: node `draw(obj)` → "**@return {dom} - 返回渲染dom的根节点**" plus "节点的返回的dom必须设置 position: absolute"; edge `draw(obj)` → "**@return {dom} - 返回渲染svg dom的根节点**". The canvas root creates SVG via `document.createElementNS('http://www.w3.org/2000/svg','svg')` (class `butterfly-svg`) inside a `<div class="butterfly-wrapper">`; edges are `createElementNS(...,'path')`. Nodes are measured/interacted with as jQuery DOM. `getContext('2d')` appears in only **5 auxiliary files** — selection box, minimap, snapline (guideline) service and grid service. README: "利用DOM/REACT/VUE来定制元素". Arrows are registered as `{type:'svg', content: require('x.svg')}` or `{type:'pathString', content:'M5 0 L0 -2 …'}`. |
| ⚠️ React/Vue wrappers | **Officially unmaintained.** README: "[React butterfly组件支持] **不维护，推荐用原生小蝴蝶**" / "[React butterfly] **No maintenance, it is recommended to use native version**." |
| Latest **published** version | ⚠️ **`npm latest` = `5.1.0-beta.38` (2024-04-20), but the newest artifact is `5.1.0-beta.40` (2024-05-20)** under the **`beta`** dist-tag (beta.39 also 2024-05-20). Both are prereleases. |
| Last **stable** release | **4.3.29, 2024-03-10** |
| **5.x has never had a stable release** | ✅ Confirmed — a `^5\.\d+\.\d+$` match finds nothing. **5.x has been in beta since 2022-07-02** (5.0.0-beta.1) — **4+ years in beta**. |
| Staleness | ⚠️ **Last commit anywhere: 2024-05-20** on branch `dev/v5`; **last commit on `master`: 2023-08-04**. **Zero GitHub Releases** (0 entries). No npm publish since 2024-05-20. **~28 months stale** (master ~37 months). **Effectively abandoned.** |
| Docs site | ❌ **The hosted docs/demo site is DEAD (404)** — `butterfly-dag.gitee.io` and its `/demo/analysis` path both 404. Docs exist only as repo Markdown. |
| Stars / forks | **4,650** / 610 |
| Open issues | **171** (high, and unmanaged given no activity) |
| Bundle | `dist/index.js` = 2,233,366 B raw / **443,819 B gzip — and this file is NOT minified**, so the true minified cost is unknown, but the package ships a 2.2 MB unminified entry. Heavy dependencies: `@antv/hierarchy`, `@antv/matrix-util`, `d3-force`, `dagre`, `dom-to-image`, `eventemitter3`, `ml-matrix`. |
| TypeScript | ❌ **NONE AT ALL.** No `types`/`typings` key in `package.json` on any branch (`latest`, `dev/v5`, `dev/v4`, `master`); source is plain `.js` + Babel with no `.d.ts` and no `tsconfig.json`; **`@types/butterfly-dag` does not exist (HTTP 404)**. Consumers must author their own declarations. |
| Docs language | ✅ **Bilingual, not Chinese-only** — 15 files in `docs/zh-CN/` and 15 in `docs/en-US/` covering identical topics, plus `README.md` (zh) and `README.en-US.md`. Caveat: the *hosted* site is dead, so there is no browsable doc site. |

**Editor or renderer?** ✅ **True editor** — `linkable: true //节点可连接`,
`disLinkable: true`, `canvas.setLinkable/setDisLinkable`. **Ports are built in** as
`Endpoint` with types `source`/`target`/`undefined`/`onlyConnect` and attrs including
`orientation`, `pos`, `scope`, `disLinkable`, `expandArea` (hot zone), `limitNum`, and
`dom` (any child DOM as a port). Node API: `addEndpoint`/`removeEndpoint`/`getEndpoint`;
events `system.link.connect`, `system.link.reconnect`, `system.links.delete`,
`system.endpoint.limit`. Also undo/redo, box select, grid + snap, guidelines, minimap,
auto-layout, node groups, `save2img` (png/jpeg/svg). **No property panel.**

**Obsidian fit:** ❌ **Not recommended.** The MIT licence is fine, but: ~28 months without a
commit (master ~37), zero GitHub releases, 171 open issues, a 5.x line that has been in beta
since 2022 with no stable release, a **dead docs/demo site**, **no TypeScript types at all**,
officially unmaintained React/Vue wrappers, a 2.2 MB unminified entry bundle, and a heavy
dependency set (d3-force + dagre + ml-matrix + AntV) make it a poor foundation.

---

## 11. tldraw — `tldraw.dev` / `github.com/tldraw/tldraw` — ❌ **licence blocker**

### The licence question, answered definitively: **it is NOT MIT and NOT open source**

There is **no MIT licence**. Three independent confirmations:

1. **`LICENSE.md` in the repo** — read directly
   ([raw](https://raw.githubusercontent.com/tldraw/tldraw/main/LICENSE.md)). It is a custom
   proprietary licence, "**The tldraw license**", which states:

   > "This License from tldraw, Inc. ("tldraw") governs your use of the accompanying
   > Software."
   > **"Production Environment"** means any production deployment of the Software that
   > operates on servers, cloud platforms, web applications, or where the software is used
   > to provide functionality to end users, customers, or the public.
   > **Conditions** — you agree: "**Not to use the Software in Production Environments.**"
   > "Not to disable, change, or interfere with the Software's **License Key enforcement**."
   > "Not to remove any copyright or other notices from the Software."
   > **"Technical enforcement"** — "The Software includes technical measures to verify
   > License Key validity, **detect deployment environments**, enforce usage restrictions
   > based on license type, and **ensure proper watermark display**. The Software may
   > **collect and transmit usage data** to tldraw for license compliance purposes."

2. **npm metadata** — `tldraw@5.4.2` and `@tldraw/tldraw@5.4.2` both have
   `"license": "SEE LICENSE IN LICENSE.md"`. GitHub API license SPDX = **`NOASSERTION`** /
   name "Other" — i.e. GitHub's detector does not recognise it as an OSI licence.

3. **`tldraw.dev/pricing`** — "**Commercial license for production use**", "100-day free
   trial", "Talk to sales". The GitHub link is labelled "**Source available on GitHub**" —
   not "open source". Pricing is **value-based and not public**; there is a discretionary
   **hobby licence** for non-commercial projects.

### The licence-key reality (this is worse than a watermark question)

From the official [License key docs](https://tldraw.dev/sdk-features/license-key):

> "The tldraw SDK **requires a license key to work in production**. Without a valid key, the
> SDK runs in development mode only."
> "In production (HTTPS on a non-loopback domain with `NODE_ENV=production`), the SDK
> requires a valid license key. Without one, the SDK logs errors to the console and, **after
> five seconds, stops rendering the editor**."

| Licence type | Watermark | Duration | Purpose |
|---|---|---|---|
| Trial | **No** | 100 days | Evaluate before purchasing |
| Commercial | **No** | Annual | Production use in commercial apps — **paid** |
| Hobby | **Yes** ("made with tldraw") | Varies | Non-commercial projects — **discretionary, reviewed per request** |

Other enforcement: keys encode **allowed hostnames** ("If you deploy to a domain not covered
by your license, the SDK treats it as unlicensed"); 30-day grace period on annual/perpetual;
trial/hobby/unlicensed builds **phone home** ("License ID, license type, SDK version, and
page URL") — commercial sends none.

**❌ HARD BLOCKER for an open-source Obsidian plugin.** There is no path where you ship
tldraw inside a freely-distributed MIT/Apache plugin:
- A **hobby licence** keeps a watermark, is **non-commercial and discretionary**, and its
  **domain validation is incompatible with a desktop Electron app** (there is no meaningful
  public hostname to license).
- A **commercial licence** costs money and is annual.
- Removing or circumventing the key enforcement is explicitly forbidden, and the licence
  forbids making the software available "under a license that supersedes or negates the
  effect of this License" — which directly conflicts with redistributing it under MIT.

### Technical attributes (for completeness)

| Attribute | Value |
|---|---|
| Rendering tech | **Canvas 2D for shape drawing + React/DOM** for UI, text and shape components (`HTMLContainer`). Not WebGL. |
| Bundle | **min 1,763,499 B / gzip 523,890 B** (bundlephobia, `tldraw@5.4.2`). Confirmed independently: `tldraw` unpacks to **14.9 MB** with **16 runtime deps** incl. `@tiptap/*` (rich text), `radix-ui`, `idb`, `lz-string`. |
| Latest release | **5.4.2, 2026-09-10** |
| Stars / forks | **50,333** / 3,504 (the most-starred library here) |
| Open issues | **653** |
| Maintenance | ✅ **Extremely active** (pushed 2026-09-13) |
| TypeScript | ✅ TypeScript-native, excellent types |

### Performance — has a real, official performance page

[tldraw.dev/sdk-features/performance](https://tldraw.dev/sdk-features/performance):

> "The tldraw SDK uses several techniques to maintain smooth performance **even with
> thousands of shapes** on the canvas."
> "The editor maintains a **spatial index** that tracks which shapes are visible, and hides
> off-screen shapes by setting `display: none` on their DOM elements. This means **a canvas
> with 10,000 shapes might only render 50** if the rest are out of view."

Techniques: viewport culling, reactive **signals** (only the changed shape re-renders),
batched store updates, **debounced zoom**, geometry caching, and **level-of-detail**.
Documented options: `debouncedZoomThreshold` default **500**, **`maxShapesPerPage` default
4000**, `textShadowLod` default **0.35**. There is also a `PerformanceManager`
(`editor.performance`) emitting `fps` / `p95FrameTime` per interaction.

### Custom shape API — `ShapeUtil` (excellent, but the wrong data model)

Verified from [tldraw.dev/docs/shapes](https://tldraw.dev/docs/shapes). You declare a shape
type via TypeScript module augmentation, then implement required methods:

```ts
declare module 'tldraw' {
  export interface TLGlobalShapePropsMap { [CARD_TYPE]: { w: number; h: number } }
}

class CardShapeUtil extends ShapeUtil<CardShape> {
  static override type = CARD_TYPE
  static override props = { w: T.number, h: T.number }   // store validation
  getDefaultProps() { return { w: 100, h: 100 } }
  getGeometry(shape: CardShape) { return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true }) }
  component(shape: CardShape) { return <HTMLContainer>Hello</HTMLContainer> }
  getIndicatorPath(shape: CardShape) { const p = new Path2D(); p.rect(0, 0, shape.props.w, shape.props.h); return p }
}
// register:
<Tldraw shapeUtils={[CardShapeUtil]} />
```

### ❌ Suitability as a node editor — flagged

**tldraw is a freeform infinite canvas, not a node graph.** Although arrows can bind to
shapes (`Bindings`), the model is **spatial, not topological**: there is no node/port type
system, no typed input/output sockets, no edge validation, no DAG semantics. You would build
the entire graph layer yourself on top of a whiteboard SDK — while paying for a commercial
licence and shipping a 524 KB-gzip dependency tree. **Not a candidate.**

---

## 12. Konva.js — `konvajs/konva` — good primitives, no graph

| Attribute | Value |
|---|---|
| Rendering tech | **Canvas 2D with a layered scene graph.** Each `Konva.Layer` is a **separate HTML5 canvas**; every layer allocates **two** canvases — a scene canvas at device pixel ratio and a hit canvas at ratio 1. Official: "On a 1920×1080 stage on a retina screen that is roughly **33 MB plus 8 MB, so about 41 MB per layer** before you draw anything… Konva warns above five layers — at that point you are near 200 MB." |
| Licence | **MIT** ✅. Read directly from [LICENSE](https://raw.githubusercontent.com/konvajs/konva/master/LICENSE): standard MIT text with "Original work Copyright (C) 2011 - 2013 by Eric Rowell (KineticJS) / Modified work Copyright (C) 2014 - present by Anton Lavrenov (Konva)". *(Precision: the file uses `2011 - 2013` **with spaces** around the dash.)* ⚠️ **GitHub's API reports SPDX `NOASSERTION`/"Other" — that is a false negative** caused by the dual-copyright preamble; the file is unambiguously MIT, and npm `license` = `MIT`. |
| Bundle | `konva.min.js` = **191,414 B raw / 58,128 B gzip**; **zero dependencies** |
| Latest release | **10.5.0, 2026-09-08** |
| Stars / forks | **14,788** / 1,064 |
| Open issues | **0** (issue tracker is disabled/redirected — not a health signal) |
| Maintenance | ✅ **Active** (commits through 2026-09-08) |
| TypeScript | ✅ **Written in TypeScript and bundles its own types** — `package.json`: `"types": "./lib/index.d.ts"`, `"license": "MIT"`, `"test:types": "tsc -p test/types/tsconfig.json"`; `tsconfig.json` sets `"declaration": true`, `"strict": true`; the only source dir is `src/` and all files are `.ts` (`Node.ts`, `Layer.ts`, `Shape.ts`, …). **`@types/konva` → HTTP 404** (no shim needed). |

### Official performance material — real and detailed

Konva has a genuine performance documentation section
([konvajs.org/docs/performance/All_Performance_Tips.html](https://konvajs.org/docs/performance/All_Performance_Tips.html))
plus a **"Very large scenes"** section and a **"Performance tests"** group in the
[sandbox index](https://konvajs.org/docs/sandbox.html). Official stress demos, with their
documented shape counts:

| Demo | Count |
|---|---|
| 10,000 Shapes with Tooltips | **10,000** circles — "Stress test rendering 10,000 circles on canvas with interactive tooltips" |
| 20000 Nodes | **20,000** draggable circles, with event delegation |
| Drag and Drop Stress Test | **10,000** shapes, using a separate drag layer |
| Animation Stress Test | **300** rotating rectangles |
| Resizing Stress Test | "thousands of shapes at once" |
| Jumping Bunnies (Bunnymark) | "hundreds of bouncing bunny sprites" |

Key official guidance, verbatim:

- Layer management: "each Konva layer is a separate HTML5 canvas element… each layer has an
  incremental performance overhead so we should keep the number of layers to a minimum."
  ⚠️ **Official maximum: "Note: Do not create too many layers. Usually 3-5 is max."**
- **Per-layer cost:** "Every layer allocates two canvases: a scene canvas at the device pixel
  ratio, and a hit canvas always at ratio 1. On a 1920×1080 stage on a retina screen that is
  roughly **33 MB plus 8 MB, so about 41 MB per layer** before you draw anything. This is why
  Konva warns above five layers — at that point you are near 200 MB."
- `layer.listening(false)` / `shape.listening(false)` — hit-testing costs scale with shapes.
- **Shape caching** — "internally Konva makes an image of your shape… can increase
  performance impressively for complex shapes and groups."
- **`perfectDrawEnabled(false)`**, disabling stroke shadows, batching.
- **Cull off-screen nodes**: "Konva draws every node on a layer whether or not it lands
  inside the stage… `visible(false)` skips both drawing and hit testing."
  `getClientRect()` "is not free, so for **tens of thousands of nodes** keep your own index
  of positions and test against that."
- `Konva.hitOnDragEnabled` — "While a node is being dragged Konva does **not** run hit
  detection" (default false).
- ⚠️ Mobile Safari ceiling: "Past it you get `Total canvas memory use exceeds the maximum
  limit`, reported as **256 MB on some devices and 384 MB on others, and the canvas goes
  blank rather than degrading**."
- ⚠️ Trade-off warning: "A thousand nodes each with their own attributes, transform and hit
  region cost far more than one custom shape that draws a thousand things in a single
  `sceneFunc`. **You lose per-item events and dragging** — this is a trade, not a free win."

⚠️ **No official FPS/ms benchmark exists for Konva**, and there is **no "Konva vs others"
numeric comparison page**. Konva explicitly *disclaims* the popular third-party benchmark:
"[Canvas engines performance benchmark](https://benchmarks.slaylines.io/) — note it pins
**Konva 8.1.4 and PixiJS 6.1.3, both from September 2021**, so its numbers do not reflect
current versions of either."
([konvajs.org/docs/guides/best-canvas-library.html](https://konvajs.org/docs/guides/best-canvas-library.html)).
**Any fps figure for Konva is UNVERIFIED** — do not quote the slaylines numbers.

### What you'd build yourself for a node editor

Konva gives you: shapes, groups, layers, a scene graph, transforms, drag-and-drop, event
hit-testing, `Konva.Transformer` (resize/rotate handles), tweens, filters, serialisation
(`stage.toJSON()` / `Konva.Node.create(json)`). Konva does **not** give you:

- ❌ any graph/edge model, ports, anchors, or edge routing. `Konva.Arrow` is just a shape;
  Konva's only related sample is a hand-rolled "Connected Objects" flowchart demo.
- ❌ **connection dragging** (drag from a port to create an edge) — must be built
- ❌ **text editing** — `Konva.Text` is **display-only**. Official: "**Konva has not support for
  such case. We recommend to edit the user input outside of your canvas with native DOM
  elements such as `input` or `textarea`.**" The official editable-text demo absolutely
  positions a real `<textarea>` over the stage on `dblclick`. Rich text requires several
  `Konva.Text` instances, or a third-party library (`render-tag`).
- ❌ selection/marquee semantics for a graph, minimap, undo/redo, palette, validation
- ❌ **no documented accessibility story** — zero matches for `accessib|screen reader|aria-|
  wcag` across Konva's main docs, and `/docs/accessibility.html` returns **HTTP 404**. (A
  canvas is opaque to screen readers; nothing is advertised.)

Useful official positioning from Konva itself: "**Not a game engine** — Konva uses Canvas 2D,
not WebGL. For 2D games with thousands of animated sprites at 60fps, use PixiJS." and
"**Not an SVG library** — Konva renders to Canvas, not SVG… If you need SVG output, consider
Fabric.js or Paper.js."

**Obsidian fit:** licence and size are excellent (58 KB gzip, MIT, zero deps, TS). But it is
a **rendering substrate**, not a node editor — you would be writing the entire editor. Only
sensible if you specifically want canvas-level control (e.g. thousands of shapes with custom
drawing) and are prepared to build the interaction model.

---

## 13. PixiJS — `pixijs/pixijs` — WebGL renderer, wrong layer of the stack

| Attribute | Value |
|---|---|
| Rendering tech | **v8 = WebGL2 (default) + WebGPU (experimental). No Canvas 2D renderer.** The official v8 Renderers doc has an explicit status table:<br>`WebGLRenderer` — "Default renderer using WebGL/WebGL2. Well supported and stable." → **✅ Recommended**<br>`WebGPURenderer` — "Modern GPU renderer using WebGPU. More performant, still maturing." → **🚧 Experimental**<br>`CanvasRenderer` — "Fallback renderer using 2D canvas." → **❌ Coming-soon**<br>Doc intro: "PixiJS renderers are responsible for drawing your scene to a canvas using either **WebGL/WebGL2** or **WebGPU**." So the v7 Canvas 2D fallback is **not available in v8** — it is listed as not-yet-shipped. |
| Licence | **MIT** ✅ (GitHub API SPDX `MIT`; npm `license` = `MIT`) |
| Bundle | `dist/pixi.min.js` = **818,871 B raw / 231,689 B gzip**. (Note: the package is 74 MB unpacked because it ships every backend; the entry files are small and it is code-split.) |
| Latest release | **8.20.1, 2026-08-26** |
| Stars / forks | **48,151** / 5,068 |
| Open issues | **346** |
| Maintenance | ✅ **Very active** (pushed 2026-09-13) |
| TypeScript | ✅ **Written in TypeScript**; ships types; deps include `@webgpu/types` |
| Dependencies | `earcut, tiny-lru, gifuct-js, ismobilejs, @pixi/colord, @types/earcut, @webgpu/types, eventemitter3, @xmldom/xmldom, parse-svg-path` |

**Performance claims — PixiJS DOES publish hard numbers (correcting a common claim):**

- **v8 launch blog** ([pixijs.com/blog/pixi-v8-launches](https://pixijs.com/blog/pixi-v8-launches)),
  CPU/GPU time per frame on the Bunnymark test:

  | Bunny situation | V7 CPU | V8 CPU | V7 GPU | V8 GPU |
  |---|---|---|---|---|
  | 100k sprites, all moving | ~50 ms | ~15 ms | ~9 ms | ~2 ms |
  | 100k sprites, not moving | ~21 ms | ~0.12 ms | ~9 ms | ~0.5 ms |
  | 100k sprites, changing scene structure | ~50 ms | ~24 ms | ~9 ms | ~2 ms |

  ⚠️ The blog's percentage badges (233%, 17417%, …) are internally inconsistent with these
  ms pairs — quote the **ms** figures, not the badges.
- **ParticleContainer blog** ([pixijs.com/blog/particlecontainer-v8](https://pixijs.com/blog/particlecontainer-v8)):
  "**Sprites + Container: 200,000 at 60fps. Particles + ParticleContainer: 1,000,000 at
  60fps!**" (MacBook Pro M3), "faster than the v7 particle container by **over 3x**".
- Official docs: ParticleContainer — "**Render hundreds of thousands or even millions of
  particles with high FPS**"; BitmapText — "render **tens of thousands** of text objects with
  minimal overhead."
- ⚠️ **The figure "tens of thousands of sprites at 60 fps" is NOT a PixiJS claim** — the real
  official numbers are far larger. The homepage carries no numbers, only the superlative
  "the fastest 2D WebGPU/WebGL renderer", and the
  [Performance Tips page](https://pixijs.com/8.x/guides/concepts/performance-tips) has **no**
  fps/object-count benchmark, only relative guidance.
- **Official benchmark tooling:** the Playground (<https://pixijs.com/8.x/playground>) and the
  official Bunnymark linked by PixiJS's own v8 blog —
  <https://goodboydigital.github.io/pixi-bunnymark/dist/> (repo `GoodBoyDigital/pixi-bunnymark`).
  ⚠️ There is **no** `pixijs/pixi-benchmark` repo (404) — that name is **UNVERIFIED**.

**What you'd have to build yourself for a node editor** — the graph layer, but *not* the
input/accessibility layer (two assumptions in the brief were wrong):

- ✅ **Hit-testing and events DO exist.** From the official events doc: "PixiJS walks the
  display tree to find the **top-most interactive element** under the pointer", with
  `interactiveChildren`, a `hitArea` override ("If a hitArea is set, it overrides bounds-based
  hit testing") and `eventMode` ∈ `none | passive (default) | auto | static`. Custom hit areas
  work on "any scene object, including Sprite, Container, and Graphics".
- ✅ **Accessibility DOES exist** (opt-in). "PixiJS includes **built-in accessibility support
  through a DOM-based overlay system** that integrates with screen readers, keyboard
  navigation… It uses `<div>` overlays to describe visual elements to screen readers."
  Enabled with `import 'pixi.js/accessibility'`; properties `accessible`, `accessibleTitle`,
  `accessibleHint` (= `aria-label`), `accessibleText`, `accessibleType`, `tabIndex`.
- ❌ **No editable text.** All three text systems are display-only: `Text` "renders using the
  browser's native text engine, and then converts the result into a texture"; `BitmapText`
  "uses a pre-baked bitmap font image" and the docs say *avoid* it when "you change fonts or
  font sizes frequently" (bad for node labels); `HTMLText` is styled markup, not an input.
- ⚠️ **The official answer for editable text is an HTML overlay** — `DOMContainer`, whose docs
  say it "is especially useful for rendering standard DOM elements that handle user input,
  such as `<input>` or `<textarea>`. This is often simpler and more flexible than trying to
  implement text input directly in PixiJS." **`DOMContainer` is marked "EXPERIMENTAL".**
- ❌ **Genuinely absent:** any node/port/graph abstraction, edge routing, connection-dragging,
  graph serialisation, undo/redo, and the editor shell. PixiJS gives you a scene graph + GPU
  rendering + events/hit-testing + an a11y overlay + a DOM escape hatch for inputs — and
  nothing graph-specific.

**Obsidian fit:** ❌ **Wrong tool.** PixiJS is a game/renderer engine. It buys you GPU
throughput you don't need for a 1000-node diagram, and you would rebuild the whole graph
model on top of it. It also ships **no Canvas 2D renderer in v8** (only WebGL2, plus
experimental WebGPU), which is a portability risk on older Electron/Chromium.

---

## 14. Fabric.js — `fabricjs/fabric.js` — canvas object model, not a graph

| Attribute | Value |
|---|---|
| Rendering tech | ⚠️ **Canvas 2D for the scene — but NOT "WebGL-free".** Scene rendering is definitely Canvas 2D: `StaticCanvas.getContext(): CanvasRenderingContext2D` and `renderCanvas(ctx: CanvasRenderingContext2D, …)`; `CanvasDOMManager` creates both canvases with `getContext('2d')`. **However, `WebGLFilterBackend`** (`packages/core/src/filters/WebGLFilterBackend.ts`) owns a real `canvas.getContext('webgl')` used "to execute the operations for **filtering**", with a CPU `Canvas2dFilterBackend` fallback. **Correct framing: no WebGL *rendering* path; WebGL is an optional acceleration path for image filters only.** SVG parser/renderer exists for import/export (`loadSVGFromString`, `loadSVGFromURL`, `parseSVGDocument`). |
| Licence | **MIT** ✅ (GitHub API SPDX `MIT`; npm `license` = `MIT`) |
| Bundle | `dist/index.min.js` = **299,013 B raw / 92,333 B gzip**; `dist/index.mjs` = 792,526 / 192,311. **Zero runtime dependencies** (`engines: node >= 20`). |
| Latest release | **7.4.0, 2026-05-18** (npm publish 2026-05-18T18:36:25Z; GitHub release tag `v740` 2026-05-18T18:35:39Z) |
| Stars / forks | **31,437** / 3,620 |
| Open issues | **466** |
| Maintenance | ✅ **Actively maintained** — commits on `master` through **2026-09-13**. Release cadence: 6.8.0 (2025-11-08) → 6.9.0/6.9.1 (2025-11/12) → **7.0.0 (2025-12-22)** → 7.1.0 (2025-12-31) → 7.2.0 (2026-02-18) → 7.3.1 (2026-04-19) → **7.4.0 (2026-05-18)**. 7.4.0 release notes carry a "Security notice — Fixes CVE-2026-44311". ⚠️ **~4 months with no npm release** while the repo is mid-**monorepo restructure** (there is no top-level `src/` on `master` now — source moved to `packages/core/src/`, `packages/browser`, `packages/node`). |
| TypeScript | ✅ **First-party TypeScript.** `package.json` has `"types": "./dist/index.d.ts"`; `src/` contains **343 `.ts` files**; `typescript` is a devDependency; a `tsconfig` is present. Official v6 upgrade guide, section *Typescript*: "**Fabric.js is now written in Typescript.** Types will help you discover the api quickly… As a consequence of this change if you are using `@types/fabric` **you should remove it**." `@types/fabric` still exists (latest **5.3.11, 2026-01-10**, not marked deprecated) but is the shim for the **fabric 5.x** API only. |
| Version note | ⚠️ The current major is **v7**, not v6 — `fabric@7.4.0`. Official v7 guide: "**Fabric 7.0 is basically Fabric 6.0**, there is no large major change that should stop you from upgrading. The reason for the major version change was the will to move to canvas version 3 and higher, that required jsdom 26 and that required at least node 18, it was bumped to **20**." Supported: Node ≥20, Chrome ≥88, Safari ≥13, Firefox ≥85, Edge ≥88, Opera ≥73. ⚠️ **Breaking:** "**WARNING: Object.originX and object.originY now default to 'center'** … **This is the only real annoying breaking change.**" Also `fireMiddleClick`/`fireRightClick`/`stopContextMenu` now default `true`, gradient `ColorStop.opacity` removed, blur filter's CPU `drawImage` path dropped, and several deprecated methods removed. |

**Performance with thousands of objects:** ⚠️ **UNVERIFIED — fabric publishes no official benchmark or numeric scaling claim.** Evidence of absence: there is no performance/benchmark page in the docs source tree; `github.com/fabricjs/fabric.js/tree/master/benchmarks` → **404**; `github.com/fabricjs/fabric-benchmark` and `/fabricjs/benchmark` → **404**. Practically, Fabric is a **retained-mode canvas object model** — every object is re-rendered each frame and there is **no built-in virtualisation or culling**, so thousands of objects require manual culling and `objectCaching` tuning.

**Suitability as a node editor:** ❌ **Not a graph library.** Fabric gives you an object model
with selection, transforms, grouping, serialisation to JSON/SVG — the right shape for a
**freeform design/annotation canvas** (it is the engine behind many image editors). It does
**not** give you nodes, ports, edges, connection dragging, edge routing, or a graph document
model. Editable text *does* exist (`IText`/`Textbox` are editable on canvas), which is a real
advantage over Konva and PixiJS — but you would still build the entire graph layer.

---

## Cross-cutting: documented performance pages / benchmarks

| Library | Official performance page? | Quantitative numbers published? |
|---|---|---|
| **Cytoscape.js** | ✅ [blog.js.cytoscape.org/2025/01/13/webgl-preview](https://blog.js.cytoscape.org/2025/01/13/webgl-preview/) | ✅ **Yes** — FPS before/after WebGL at 1.2k and 3.2k nodes |
| **GoJS** | ✅ [gojs.net/latest/learn/performance](https://gojs.net/latest/learn/performance) | ✅ **Partly** — qualitative tiers + **123,456-node virtualised sample**; no FPS |
| **Konva** | ✅ [konvajs.org/docs/performance](https://konvajs.org/docs/performance/All_Performance_Tips.html) + "Performance tests" sandbox group | ✅ Tips + memory numbers (41 MB/layer; 3–5 layer max; 256–384 MB iOS ceiling) + **10,000 / 20,000-shape demos**; ⚠️ **no FPS table**, and Konva explicitly disclaims the third-party slaylines benchmark as stale |
| **tldraw** | ✅ [tldraw.dev/sdk-features/performance](https://tldraw.dev/sdk-features/performance) | ✅ Techniques + **10,000 shapes** example; `maxShapesPerPage` default 4000; no FPS table |
| **AntV G6** | ✅ `packages/site/docs/manual/FAQ/performance-opt.en.md` + 3 official perf demos | ✅ Demo data volumes (**5k+ / ~20k / 50k+ shapes**); ⚠️ **v4-era doc**; no FPS |
| **AntV X6** | ⚠️ Documented **virtual rendering** (`virtual: true`, 3.0.0+) + official **1000-node** example | ❌ **No FPS/timings** |
| **PixiJS** | ⚠️ No dedicated perf page; official **Bunnymark** + Playground | ✅ **Yes** — 100k-sprites CPU/GPU ms table (v8 blog); **200k sprites / 1M particles at 60 fps** (ParticleContainer blog) |
| **JointJS** | ⚠️ A "Performance" docs page exists but covers only Plus-gated `SearchGraph` | ❌ No |
| **Fabric.js** | ❌ No performance/benchmark page, dir or repo | ⚠️ **UNVERIFIED** — no official "N objects at X fps" figure exists |
| **Drawflow, Vue Flow, Svelte Flow, LogicFlow, Butterfly** | ❌ None | ❌ None — all qualitative only |

---

## Cross-cutting: true editor vs renderer

| Library | Drag-to-connect | Ports / typing | Parameter UI | Undo/redo | Palette | Minimap | Verdict |
|---|---|---|---|---|---|---|---|
| Drawflow | ✅ | ✅ typed in/out | ✅ (HTML nodes) | ❌ | ❌ | ❌ | **Editor** |
| Vue Flow | ✅ (`Handle`) | ✅ | ✅ (custom components) | ❌ (BYO) | ❌ | ✅ | **Editor** |
| Svelte Flow | ✅ (`Handle`) | ✅ | ✅ (custom components) | ❌ (BYO) | ❌ | ✅ | **Editor** |
| **JointJS core** | ✅ | ✅ (`dia/ports`) | ❌ **Plus-only** | ❌ **Plus-only** | ❌ **Plus-only** | ❌ **Plus-only** | **Editor skeleton; UX is paid** |
| GoJS | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (Overview) | **Full editor** (proprietary) |
| Cytoscape.js | ❌ **no edge-creation gesture in the official gesture list** | ❌ | ❌ | ❌ | ❌ | ❌ | **Visualiser** |
| **AntV X6** | ✅ | ✅ (+connection points/routers) | ⚠️ BYO UI, HTML nodes supported | ✅ `History` | ✅ `Stencil` | ✅ `MiniMap` | **Full editor, MIT** |
| AntV G6 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | **Visualiser** |
| LogicFlow | ✅ | ✅ (anchors) | ⚠️ **NOT provided** — no property panel in core *or* extension; `DndPanel` is a material palette | ✅ (core `history/`) | ✅ `DndPanel` (extension) | ✅ (extension) | **Full editor, Apache-2.0**; build the parameter UI |
| Butterfly | ✅ (`linkable`) | ✅ built-in `Endpoint` w/ types + hot zones | ❌ **NOT provided** | ✅ | ⚠️ | ✅ | Editor, but **abandoned** |
| tldraw | ❌ (bindings, not ports) | ❌ | ✅ | ✅ | ❌ | ❌ | **Freeform canvas** (proprietary) |
| Konva | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **Primitives** |
| PixiJS | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **Primitives** (but has hit-testing + opt-in a11y) |
| Fabric.js | ❌ | ❌ | ⚠️ (IText only) | ✅ (object-level) | ❌ | ❌ | **Primitives** |

---

## Licence-compliance summary for an Obsidian plugin

| Licence | Libraries | Status for a freely-distributed plugin |
|---|---|---|
| **MIT** | Drawflow, Vue Flow, Svelte Flow, Cytoscape.js, AntV X6, AntV G6, Butterfly, Konva, PixiJS, Fabric.js | ✅ **Clear.** Just retain the copyright notice. |
| **Apache-2.0** | LogicFlow (+ `@logicflow/extension`) | ✅ **Clear.** Permissive; include NOTICE if present. |
| **MPL-2.0** | JointJS **core** (`@joint/core`) | ⚠️ **Usable but not "just MIT".** File-level copyleft: linking from an MIT plugin is fine; **modifications to JointJS's own files must be published under MPL-2.0**. Also note `@joint/router-avoid` depends on **LGPL-2.1-or-later** (`libavoid-js`) — avoid that plugin, or keep the `.wasm` separately served as the docs instruct. |
| **Proprietary, paid, per-developer** | **GoJS** | ❌ **Hard blocker.** $3,995 (1 dev) / $6,990 (3) / $11,950 (20). No free/open tier. Cannot be redistributed to users who haven't licensed it. |
| **Proprietary, source-available, key-enforced** | **tldraw** | ❌ **Hard blocker.** Production use requires a paid (or discretionary, watermarked, non-commercial) licence key; the SDK **stops rendering after 5 seconds** in unlicensed production; licence-key enforcement must not be bypassed; domain validation is incompatible with a desktop Electron app. |

---

## Bundle size methodology

Sizes were obtained by downloading each package's published tarball from the npm registry,
extracting it, and gzipping the library's own prebuilt dist artefact with `gzip -9`
(zlib level 9) at the default compression window. Reported as `raw / gzip` bytes.

**Caveats — read these before quoting the numbers:**

1. These are the **library's own shipped bundles**, *not* a tree-shaken application bundle.
   For ESM/code-split packages the real cost of your app can be **lower** (Svelte Flow
   especially: its entry is 1.9 KB and the 164 KB total is spread over 129 lazily-imported
   chunks).
2. For packages with no minified dist (`@antv/x6`, `@antv/g6`, `@logicflow/*` ship
   `lib/`/`es/` ESM), I measured the **pre-built `dist/*.min.js` UMD bundle** they do ship —
   the closest thing to an apples-to-apples "minified" figure.
3. **Butterfly's `dist/index.js` is NOT minified**, so its 2,233,366 B raw figure
   overstates what a minifier would produce; the 443,819 B gzip figure is for that
   unminified file. Its true minified size is **unknown**.
4. **tldraw** could not be measured this way (the `tldraw` entry re-exports a code-split
   monorepo build); the figure quoted is **bundlephobia's** third-party measurement
   (`min 1,763,499` / `gzip 523,890`), which I flag as third-party rather than my own.
5. Where **bundlephobia** independently agreed with my measurement, that is noted inline as
   cross-validation (`@xyflow/react`: mine 59,727 vs bundlephobia 59,920 gzip; `cytoscape`:
   mine 137,167 vs 136,995). bundlephobia returned errors for most other packages at the time
   of research, so my own measurements are the primary source.

---

## Citations

**Drawflow**
- Repo, stars, licence, activity: https://github.com/jerosoler/Drawflow · https://api.github.com/repos/jerosoler/Drawflow
- MIT licence text: https://raw.githubusercontent.com/jerosoler/Drawflow/master/LICENSE
- npm package + all-version licence history: https://registry.npmjs.org/drawflow
- DefinitelyTyped types: https://www.npmjs.com/package/@types/drawflow · https://registry.npmjs.org/@types/drawflow
- Perf issue search (1 result, #698): https://github.com/jerosoler/Drawflow/issues/698

**Vue Flow**
- Repo: https://github.com/bcakmakoglu/vue-flow
- README "heavily based on webkid's ReactFlow" + TS + Vue 3 only: https://raw.githubusercontent.com/bcakmakoglu/vue-flow/master/README.md
- Docs, MIT statement, features: https://vueflow.dev/guide/
- npm: https://registry.npmjs.org/@vue-flow/core

**Svelte Flow / xyflow**
- Monorepo: https://github.com/xyflow/xyflow
- MIT commitment + open-core model: https://xyflow.com/open-source
- Attribution source code: https://raw.githubusercontent.com/xyflow/xyflow/main/packages/svelte/src/lib/components/Attribution/Attribution.svelte
- React Flow attribution source: https://raw.githubusercontent.com/xyflow/xyflow/main/packages/react/src/components/Attribution/index.tsx
- Attribution/MIT controversy discussion (title only): https://github.com/xyflow/xyflow/discussions/2015
- Remove-attribution page: https://svelteflow.dev/learn/troubleshooting/remove-attribution · https://reactflow.dev/remove-attribution
- Docs: https://svelteflow.dev/

**JointJS**
- Repo, MPL-2.0, stars: https://github.com/clientIO/joint
- Licensing page ("MPL 2.0 core, JointJS+ commercial"): https://www.jointjs.com/license
- Third-party dependencies — **Backbone removal in 4.0.0**: https://docs.jointjs.com/learn/help-center/third-party-dependencies/
- Features list (Plus-gated plugins): https://docs.jointjs.com/learn/features/
- Performance page (SearchGraph, Plus-only): https://docs.jointjs.com/learn/features/performance/
- What's in the JointJS+ package: https://docs.jointjs.com/learn/help-center/what-is-included/
- npm: https://registry.npmjs.org/@joint/core · https://registry.npmjs.org/jointjs

**GoJS**
- Pricing: https://nwoods.com/sales
- Performance considerations: https://gojs.net/latest/learn/performance
- SVG renderer ("By default, GoJS renders to an HTML Canvas"): https://gojs.net/latest/learn/SVGContext
- Typings: https://gojs.net/latest/learn/typings
- Features / interactivity: https://gojs.net/latest/learn/features
- Home (Electron support, zero deps, 4.0 June 2026): https://gojs.net/latest/
- Licensed build header + obfuscated source: https://raw.githubusercontent.com/NorthwoodsSoftware/GoJS/master/release/go.js
- Licence text: npm `gojs@4.0.3` → `license.html`
- npm: https://registry.npmjs.org/gojs

**Cytoscape.js**
- Repo: https://github.com/cytoscape/cytoscape.js
- **WebGL renderer preview blog post (FPS numbers, limitations, options)**: https://blog.js.cytoscape.org/2025/01/13/webgl-preview/
- WebGL design doc (Mike Kucera, March 2025): https://github.com/cytoscape/cytoscape.js/blob/master/documentation/webgl.md
- Official gestures list (**no edge-creation gesture**): https://js.cytoscape.org/#notation/gestures
- Official performance section (comparative claim only): https://js.cytoscape.org/#performance
- Third-party edge creation: https://www.npmjs.com/package/cytoscape-edgehandles · live repo https://github.com/cytoscape/cytoscape.js-edgehandles
- Bundled types + `types` field: https://registry.npmjs.org/cytoscape · DefinitelyTyped: https://registry.npmjs.org/@types/cytoscape
- (Verified absent from npm: `cytoscape-webgl`, `cytoscape-webgl-renderer`, `@cytoscape/webgl` — all 404)

**AntV X6**
- Repo: https://github.com/antvis/X6
- "graph editing engine" + features: https://raw.githubusercontent.com/antvis/X6/master/site/docs/tutorial/about.en.md
- Node rendering (SVG engine, foreignObject, caveats) + custom nodes: https://raw.githubusercontent.com/antvis/X6/master/site/docs/tutorial/basic/node.en.md
- `Graph.registerNode` example: https://raw.githubusercontent.com/antvis/X6/master/site/src/tutorial/basic/node/registry/index.tsx
- Virtual rendering (3.0.0/3.1.0) + plugin consolidation: https://raw.githubusercontent.com/antvis/X6/master/CHANGELOG.md
- 1000-node virtual render example: https://raw.githubusercontent.com/antvis/X6/master/site/examples/showcase/practices/demo/virtualRender.ts
- Upgrade guide 3.x: https://raw.githubusercontent.com/antvis/X6/master/site/docs/tutorial/update.en.md
- Virtual-render gotcha: https://github.com/antvis/X6/issues/3668
- npm: https://registry.npmjs.org/@antv/x6

**AntV G6**
- Repo: https://github.com/antvis/G6
- "G6 is a graph visualization engine": https://raw.githubusercontent.com/antvis/G6/master/packages/g6/README.en-US.md
- Official performance tips: https://raw.githubusercontent.com/antvis/G6/master/packages/site/docs/manual/FAQ/performance-opt.en.md
- Official perf demo data volumes (5k / 20k / 50k shapes): https://raw.githubusercontent.com/antvis/G6/master/packages/site/examples/performance/perf/index.en.md · https://raw.githubusercontent.com/antvis/G6/master/packages/site/examples/performance/perf/demo/meta.json
- Reported v5 scale regressions: https://github.com/antvis/G6/issues/7574 · https://github.com/antvis/G6/issues/7566 · https://github.com/antvis/G6/issues/5994
- npm: https://registry.npmjs.org/@antv/g6

**LogicFlow**
- Repo, Apache-2.0, stars: https://github.com/didi/LogicFlow
- **Architecture article (SVG for graphics/lines, HTML for text/menu/background layers)**: https://github.com/didi/LogicFlow/blob/master/sites/docs/docs/article/architecture-of-logicflow.en.md
- Node tutorial ("a flowchart editing framework based on SVG"): https://site.logic-flow.cn/tutorial/basic/node
- Custom node registration API: https://site.logic-flow.cn/api/logicflow-instance/register
- Source: https://github.com/didi/LogicFlow/blob/master/packages/core/src/view/node/BaseNode.tsx · .../view/node/HtmlNode.tsx · .../view/edge/BaseEdge.tsx
- Current docs site: https://site.logic-flow.cn/ · https://site.logic-flow.cn/en/ · (v1 legacy https://docs.logic-flow.cn)
- npm: https://registry.npmjs.org/@logicflow/core · https://registry.npmjs.org/@logicflow/extension
- Scale-report issue (user-filed, not official): https://github.com/didi/LogicFlow/issues/1665
- (Old site `logicflow.site` verified unreachable, HTTP 000 — stale alias only)

**Butterfly**
- Repo, MIT, branches: https://github.com/alibaba/butterfly
- **Node docs (`draw` returns DOM root)**: https://github.com/alibaba/butterfly/blob/master/docs/zh-CN/node.md
- **Edge docs (`draw` returns SVG DOM root)**: https://github.com/alibaba/butterfly/blob/master/docs/zh-CN/edge.md
- Endpoint/port docs: https://github.com/alibaba/butterfly/blob/master/docs/zh-CN/endpoint.md
- Source: https://github.com/alibaba/butterfly/blob/dev/v5/src/canvas/baseCanvas.js · .../src/node/baseNode.js · .../src/edge/baseEdge.js
- Bilingual docs: https://github.com/alibaba/butterfly/tree/master/docs/zh-CN · https://github.com/alibaba/butterfly/tree/master/docs/en-US
- npm dist-tags (`latest` 5.1.0-beta.38 / `beta` 5.1.0-beta.40; last stable 4.3.29; no `types`): https://registry.npmjs.org/butterfly-dag
- Releases (0 entries): https://github.com/alibaba/butterfly/releases
- (Hosted demo/docs site `butterfly-dag.gitee.io` → 404. `@types/butterfly-dag` → 404.)

**tldraw**
- **Licence text**: https://raw.githubusercontent.com/tldraw/tldraw/main/LICENSE.md
- Pricing / "Source available on GitHub": https://tldraw.dev/pricing
- **Licence key enforcement (5-second stop, watermark, domain validation, telemetry)**: https://tldraw.dev/sdk-features/license-key
- Performance (culling, 10,000 shapes, options): https://tldraw.dev/sdk-features/performance
- Custom shapes / `ShapeUtil`: https://tldraw.dev/docs/shapes
- Repo: https://github.com/tldraw/tldraw
- npm: https://registry.npmjs.org/tldraw

**Konva**
- MIT LICENSE (dual KineticJS/Konva copyright — GitHub SPDX false negative): https://raw.githubusercontent.com/konvajs/konva/master/LICENSE
- Performance tips (layers, memory, large scenes): https://konvajs.org/docs/performance/All_Performance_Tips.html
- **Layer Management (official max: "Usually 3-5 is max")**: https://konvajs.org/docs/performance/Layer_Management.html
- Performance-tests sandbox (10,000 / 20,000-shape demos): https://konvajs.org/docs/sandbox.html
- **Konva disclaiming the stale third-party slaylines benchmark**: https://konvajs.org/docs/guides/best-canvas-library.html
- Editable-text guidance (use a native `<textarea>` overlay): https://konvajs.org/docs/sandbox/Editable_Text.html
- TypeScript/build config: https://raw.githubusercontent.com/konvajs/konva/master/package.json · https://raw.githubusercontent.com/konvajs/konva/master/tsconfig.json
- Repo: https://github.com/konvajs/konva · npm: https://registry.npmjs.org/konva · (`@types/konva` → 404)

**PixiJS**
- Repo: https://github.com/pixijs/pixijs
- **v8 renderer status table (WebGL recommended / WebGPU experimental / CanvasRenderer "Coming-soon")**: https://pixijs.com/8.x/guides/components/renderers.md
- v8 migration guide (ParticleContainer rework, extension system, API changes): https://pixijs.com/8.x/guides/migrations/v8.md
- **v8 launch blog — 100k-sprite CPU/GPU ms table**: https://pixijs.com/blog/pixi-v8-launches
- **ParticleContainer blog — "200,000 at 60fps… 1,000,000 at 60fps"**: https://pixijs.com/blog/particlecontainer-v8
- Events / hit-testing (`hitArea`, `eventMode`): https://pixijs.com/8.x/guides/components/events
- Accessibility (DOM `<div>` overlay, `aria-label`, `tabIndex`): https://pixijs.com/8.x/guides/components/accessibility
- Text systems (all display-only): https://pixijs.com/8.x/guides/components/scene-objects/text
- `DOMContainer` (EXPERIMENTAL; official answer for `<input>`/`<textarea>`): https://pixijs.download/release/docs/scene.DOMContainer.html
- Performance tips (relative guidance only, no benchmark): https://pixijs.com/8.x/guides/concepts/performance-tips
- Official Bunnymark: https://goodboydigital.github.io/pixi-bunnymark/dist/ · repo https://github.com/GoodBoyDigital/pixi-bunnymark
- README ("WebGL & WebGPU Renderers"): https://raw.githubusercontent.com/pixijs/pixijs/dev/README.md
- npm: https://registry.npmjs.org/pixi.js
- `@antv/g-webgl` (for contrast with G6): https://registry.npmjs.org/@antv/g-webgl

**Fabric.js**
- Repo: https://github.com/fabricjs/fabric.js
- `package.json` — MIT, `"types": "./dist/index.d.ts"`, 343 `src/**/*.ts` files: https://raw.githubusercontent.com/fabricjs/fabric.js/master/package.json
- **v6 upgrade guide ("Fabric.js is now written in Typescript… if you are using `@types/fabric` you should remove it")**: https://www.fabricjs.com/docs/upgrading/upgrading-to-fabric-60/
- **v7 upgrade guide (originX/originY now default to 'center'; Node ≥20)**: https://www.fabricjs.com/docs/upgrading/upgrading-to-fabric-70/
- v7.4.0 release (incl. CVE-2026-44311 security notice): https://github.com/fabricjs/fabric.js/releases/tag/v740
- WebGL filter backend (WebGL is for **filters** only): https://github.com/fabricjs/fabric.js/blob/master/packages/core/src/filters/WebGLFilterBackend.ts
- Canvas 2D scene rendering: https://github.com/fabricjs/fabric.js/blob/master/packages/core/src/canvas/StaticCanvas.ts
- DefinitelyTyped types (fabric 5.x only, latest 5.3.11): https://registry.npmjs.org/@types/fabric
- npm: https://registry.npmjs.org/fabric
- (**No benchmark page/dir/repo exists** — `fabricjs/fabric-benchmark` → 404, `/benchmarks` dir → 404)

**Cross-check**
- bundlephobia: https://bundlephobia.com/api/size?package=@xyflow/react@12.11.6 · `cytoscape@3.34.3` · `tldraw@5.4.2`

---

## Appendix: corrections to commonly-repeated claims

These were checked specifically because they are widely repeated (including in the research
brief that prompted this report). Each is marked with what the primary sources actually show.

| Common claim | Verdict | What the sources show |
|---|---|---|
| "Drawflow changed its licence and reverted it" | ❌ **FALSE** | `git log --follow -- LICENSE` returns **one commit** (2020-04-28, MIT). All 60 npm versions declare MIT. See §1. |
| "JointJS changed its licence" | ❌ **FALSE** | `git log -- LICENSE` returns **one commit** (2013-07-19). MPL-2.0 throughout. See §4. |
| "JointJS depends on Backbone.js" | ❌ **OBSOLETE** | True for legacy `jointjs@3.7.7`; **`@joint/core` ≥4.0.0 has zero dependencies**. See §4. |
| "JointJS core includes the UI plugins / HTML nodes" | ❌ **FALSE** | HTML shapes, Inspector, Stencil, Halo, FreeTransform, PaperScroller, Navigator, CommandManager, Clipboard, Keyboard, TextEditor, Tooltip are **all JointJS+ (paid)**. Core has no `ui/` directory. See §4. |
| "Cytoscape.js is Canvas 2D only" | ❌ **OUT OF DATE** | An **official WebGL renderer** shipped in 3.31+ as a *mode* of the canvas renderer (`webgl: true`); present in 3.34.3. Still viz-only. See §6. |
| "Cytoscape.js has built-in edge creation" | ❌ **FALSE** | The official gesture list has **no** edge-creation gesture; `cytoscape-edgehandles` (last release 2021) exists precisely because it is missing. See §6. |
| "Butterfly supports Canvas and SVG rendering" | ❌ **FALSE** | It is **HTML DOM nodes + SVG edges**; Canvas 2D appears in only 5 auxiliary files. See §10. |
| "Butterfly docs are Chinese-only" | ❌ **FALSE** | **Bilingual** — 15 `docs/zh-CN` + 15 `docs/en-US`. The hosted site is dead, though. See §10. |
| "Butterfly is a viable MIT option" | ⚠️ **Not really** | Abandoned ~28 months, 0 releases, 5.x in beta since 2022, **no TS types at all**, dead docs site. See §10. |
| "LogicFlow custom nodes use `registerNode`/`setSvg`" | ❌ **FALSE** | It is **`lf.register({type, view, model})`** / `batchRegister`; SVG view method is **`getShape()`**; `setHtml()` exists **only** on `HtmlNode`. See §9. |
| "LogicFlow ships a property panel in the extension package" | ❌ **FALSE** | Neither core nor extension has one; `DndPanel` is a drag palette. See §9. |
| "logicflow.site is the LogicFlow docs" | ❌ **DEAD LINK** | `logicflow.site` is unreachable (HTTP 000). Use `site.logic-flow.cn`. See §9. |
| "tldraw is MIT / permissively licensed" | ❌ **FALSE** | Custom proprietary licence; **production use requires a licence key**; the SDK **stops rendering after 5 seconds** unlicensed. See §11. |
| "GoJS source is on GitHub" | ❌ **FALSE** | The repo ships **obfuscated builds**; `go-debug.js` is also obfuscated. See §5. |
| "PixiJS v8 has a Canvas 2D fallback" | ❌ **NO** | The v8 renderers table lists `CanvasRenderer` as **"Coming-soon"**. It is being built on `dev`, but is **not shipped**. See §13. |
| "PixiJS has no interaction or accessibility support" | ❌ **FALSE** | It has both: `hitArea`/`eventMode` hit-testing, and an opt-in **DOM `<div>` accessibility overlay** with `aria-label`/`tabIndex`. Editable text *is* absent. See §13. |
| "Fabric.js is WebGL-free" | ⚠️ **Imprecise** | Scene rendering is Canvas 2D, but **`WebGLFilterBackend`** uses WebGL for image **filters** (with a Canvas2D fallback). See §14. |
| "Fabric.js has a published performance benchmark" | ❌ **FALSE** | No benchmark page, directory or repo exists. **UNVERIFIED.** See §14. |
| "Konva has an official FPS benchmark" | ❌ **FALSE** | It has stress demos (10k/20k shapes) and memory numbers, but **no fps table**, and it **explicitly disclaims** the popular slaylines benchmark as stale (Konva 8.1.4 / PixiJS 6.1.3, Sept 2021). See §12. |
| "Konva layers are cheap" | ❌ **FALSE** | Official: **"Usually 3-5 is max"**, and each layer costs **~41 MB** at 1920×1080 on retina. See §12. |
