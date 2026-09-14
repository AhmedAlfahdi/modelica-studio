# Node/Graph Editor Libraries — Primary-Source Verification Report

Verification date: September 2026. Every claim below is cited to a primary source (official docs, repo source, npm registry, or registry tarball contents). Items that could not be verified from a primary source are marked **UNVERIFIED**.

Cross-cutting correction up front: the premise URLs `logicflow.site` (dead) and the "Cytoscape.js has no WebGL" assumption (false as of 3.31) are both wrong — see A.2 and C.1.

---

## A) LogicFlow (didi/LogicFlow)

### A.1 Rendering technology — nodes vs edges

LogicFlow is **not** "SVG nodes vs HTML edges". Both nodes **and** edges are SVG. HTML is a separate overlay layer for chrome (text, menus, background, grid, registered components), plus a special "HTML node" type that renders arbitrary DOM inside an SVG `<foreignObject>`.

**Primary source — official architecture article** (`sites/docs/docs/article/architecture-of-logicflow.en.md`), exact quote:

> "So finally we choose to **use HTML + Svg to complete the rendering of the diagram, Svg is responsible for the graphics, line part, HTML to achieve text, menu, background and other layers**."
> — https://github.com/didi/LogicFlow/blob/master/sites/docs/docs/article/architecture-of-logicflow.en.md (live: https://site.logic-flow.cn/article/architecture-of-logicflow)

Same article, rendering-approach trade-off study (HTML+CSS vs Canvas vs SVG):

> "In the flowchart scenario, there is no need to render a large number of nodes (up to thousands of elements), and there is not a high demand for animation. The DOM-based nature of Svg will be more suitable for us... However, the Svg tag does not support the insertion of other tags such as div, so it is necessary to combine other HTML tags when implementing certain functions."

Layer responsibilities (same article):

> "The uppermost layer is the Svg layer, where all graphs (nodes, edges, alignment lines, outLine, etc.) are rendered on the Svg and are also responsible for listening to various events on the graph. The lower layers of Svg are the Component layer, which is responsible for expanding UI components; the Grid layer, which is responsible for rendering the grid; and the Background layer, which adds custom backgrounds."

> "Extension components. LogicFlow provides an HTML layer and a series of coordinate transformation logic on top of the SVG layer, and supports registering components on the HTML layer."

**Primary source — official node tutorial**, exact quote:

> "LogicFlow is a flowchart editing framework based on SVG. Therefore, our nodes and connections are basic SVG shapes. Modifying the style of LogicFlow nodes is essentially modifying the SVG basic shapes."
> — https://github.com/didi/LogicFlow/blob/master/sites/docs/docs/tutorial/basic/node.en.md (live: https://site.logic-flow.cn/tutorial/basic/node)

Built-in node types listed there: `rect`, `circle`, `ellipse`, `polygon`, `diamond`, `text`, `html` (7 total).

**Source-level confirmation:**

| Part | Mechanism | Source |
|---|---|---|
| Node view contract | `abstract getShape(): h.JSX.Element \| null` — returns SVG elements | https://github.com/didi/LogicFlow/blob/master/packages/core/src/view/node/BaseNode.tsx |
| Node DOM root | `<g className="lf-node-content">` inside the SVG | same file |
| Edge view contract | `getShape()` returning SVG `<path>` | https://github.com/didi/LogicFlow/blob/master/packages/core/src/view/edge/BaseEdge.tsx |
| Node/edge/label layers | Preact components (`Graph.tsx` renders CanvasOverlay, ToolOverlay, BackgroundOverlay, Grid, SnaplineOverlay, OutlineOverlay, BezierAdjustOverlay, ModificationOverlay) | https://github.com/didi/LogicFlow/blob/master/packages/core/src/view/Graph.tsx |
| **HTML node** | `HtmlNode.getShape()` emits `<rect>` + SVG `<foreignObject ref={this.ref}>`; user DOM is injected by `setHtml(rootEl: SVGForeignObjectElement)` | https://github.com/didi/LogicFlow/blob/master/packages/core/src/view/node/HtmlNode.tsx |
| Text | Also SVG `<foreignObject>` | https://github.com/didi/LogicFlow/blob/master/packages/core/src/view/shape/Text.tsx |

**Preact confirmation (official docs, exact quote):**

> "LogicFlow is developed based on `preact`, when we customize the node view, we can get the data passed from the parent component through `this.props`."
> — https://github.com/didi/LogicFlow/blob/master/sites/docs/docs/tutorial/basic/node.en.md

Corroborated by `@logicflow/core@2.2.5` dependencies: `preact ^10.17.1`, `mobx-preact ^3.0.0`, `mobx ^5.15.7`, `mobx-utils ^5.6.1` (verified from the published tarball's `package.json`, https://registry.npmjs.org/@logicflow/core/-/core-2.2.5.tgz).

**Verdict:** rendering = SVG for all graph geometry (nodes, edges, anchors, snaplines, outline); HTML/DOM for the component/menu/grid/background overlay layers; HTML content inside nodes via SVG `<foreignObject>`; Preact + MobX drive it as MVVM with a virtual DOM.

### A.2 Documentation language and completeness

**Chinese-first, with a complete English translation.**

- Dumi config declares two locales with Chinese as default:
  ```ts
  locales: [ { id: 'zh', name: '中文' }, { id: 'en', name: 'English' } ],
  ...
  defaultLanguage: 'zh',
  ```
  — https://github.com/didi/LogicFlow/blob/master/sites/docs/.dumirc.ts
- Every doc page is authored as a `.zh.md` / `.en.md` pair.
- **Measured completeness (from a full clone of `master`):** 73 `.zh.md` files, 76 `.en.md` files, **0 pages that exist only in Chinese**, and 3 English-only pages (`tutorial/basic/grid`, `tutorial/basic/background`, `tutorial/advanced/snapline`). So the English translation has 100% coverage of the Chinese docs.
- Page-level parity is close to 1:1 in size, e.g. `tutorial/basic/node` = 318 zh lines / 358 en lines; `api/logicflow-instance/register` = 76 / 76; `tutorial/basic/edge` = 152 / 151.

**URLs:**

| | URL | Status |
|---|---|---|
| Chinese (default) | https://site.logic-flow.cn/ | HTTP 200 (verified) |
| English | https://site.logic-flow.cn/en/ | HTTP 200 (verified) |
| v1.x docs (legacy) | https://docs.logic-flow.cn | listed in `.dumirc.ts` `versions` |
| **`logicflow.site` (the URL in the research brief)** | https://logicflow.site/ and https://logicflow.site/en/ | **DEAD — HTTP 000, connection fails.** DNS resolves to 34.175.100.41 but the host does not respond (verified via curl, Sept 2026) |

The official README points to `https://site.logic-flow.cn`, not `logicflow.site`:
> `<a href="https://site.logic-flow.cn" target="_blank">` — https://github.com/didi/LogicFlow/blob/master/README.md

**Action for the report: replace every `logicflow.site` citation with `site.logic-flow.cn`.**

### A.3 Custom node registration — confirmed API surface

**Docs:**
- Tutorial (concepts + code shapes): https://site.logic-flow.cn/tutorial/basic/node (source: `sites/docs/docs/tutorial/basic/node.en.md`)
- API reference for registration: https://site.logic-flow.cn/api/logicflow-instance/register (source: `sites/docs/docs/api/logicflow-instance/register.en.md`)

**API is `lf.register` / `lf.batchRegister` — there is no `registerNode`.**

Exact signatures from the official API page:

```ts
register(config: RegisterConfig): void
batchRegister(configList: RegisterConfig[]): void
```

Exact documented example:

```ts
import { RectNode, RectNodeModel } from '@logicflow/core';

class CustomRectNode extends RectNode {}

class CustomRectModel extends RectNodeModel {
  setAttributes() {
    this.width = 200;
    this.height = 80;
    this.radius = 50;
  }
}

lf.register({
  type: 'custom-rect',
  view: CustomRectNode,
  model: CustomRectModel,
});
```

**Model/view separation: yes, explicitly.** Official docs, exact quote:

> "`model`: Data layer containing various styles (such as borders, colors), shapes (dimensions, vertex positions), and business properties of nodes.
> `view`: View layer controlling the final rendering effects of nodes. By modifying the `model`, custom nodes can be created, while more complex SVG elements can be customized on the `view`.
> LogicFlow is based on the MVVM pattern."

Both `BaseNode` model + view and `BaseEdge` model + view exist and are exported:

| Concept | Model | View |
|---|---|---|
| Node base | `model/node/BaseNodeModel.ts` | `view/node/BaseNode.tsx` |
| Edge base | `model/edge/BaseEdgeModel.ts` | `view/edge/BaseEdge.tsx` |
| Edge variants | `BezierEdgeModel`, `LineEdgeModel`, `PolylineEdgeModel` | `BezierEdge.tsx`, `LineEdge.tsx`, `PolylineEdge.tsx` |

**`setHtml` vs `setSvg` vs `shape` — corrected:**
- There **is** a `setHtml(rootEl)` method, but only on the **`HtmlNode` view** — it injects arbitrary DOM into the node's `<foreignObject>`. Source: https://github.com/didi/LogicFlow/blob/master/packages/core/src/view/node/HtmlNode.tsx
  > `setHtml(rootEl: SVGForeignObjectElement) { rootEl.appendChild(document.createElement('div')) }`
- **There is NO `setSvg` API.** Verified: `grep -rn "setSvg" packages/core/src/` returns nothing.
- The view method that defines rendered SVG geometry is **`getShape()`** (`abstract getShape(): h.JSX.Element | null` on `BaseNode`; defined by default on `BaseEdge`). 16 `getShape()` implementations exist across `packages/core/src/view/`.
- SVG is built with the exposed `h()` hyperscript function: `h(nodeName, attributes, [...children])`.

Style-resolution priority, exact quote from the docs:
> "LogicFlow defines the appearance of a node in three ways, namely **theme**, **custom node model**, **custom node view**. These three approaches are prioritized as `theme < custom node mod < custom node view`."

Documented caveat: shape attributes (`width`/`height`) must be set on the **model**, not the view, or "the anchor position and outline size will be incorrect."

### A.4 Is it a true editor? — Yes

| Capability | Confirmed | Source |
|---|---|---|
| Drag-to-connect | Yes | `Anchor.tsx`, `view/behavior/dnd.ts`, drag-creates-edge logic in core |
| Anchors / ports | Yes — `getDefaultAnchor(): AnchorConfig[]` on every node model; `view/Anchor.tsx` | https://github.com/didi/LogicFlow/blob/master/packages/core/src/model/node/BaseNodeModel.ts , `packages/core/src/view/Anchor.tsx` |
| Connection rules | Yes — `setConnectable`/`getConnectedSourceRules`, edge adjust, custom edge types | core model + `api/logicflow-instance/edge.en.md` |
| Undo/redo | Yes — `packages/core/src/history/` | repo tree |
| Node property panel | **NO built-in property panel**, and none in `@logicflow/extension` either | see below |

**Property panel — verified absence.** The complete `@logicflow/extension` public surface (`packages/extension/src/index.ts`) contains these UI components only:

`Control`, `Menu`, `ContextMenu`, `DndPanel`, `MiniMap`, `SelectionSelect`, `Highlight`
— plus non-UI tools (`Label`, `Snapshot`, `FlowPath`, `AutoLayout`, `ProximityConnect`), materials (`CurvedEdge`, `NodeSelection`), adapters (BPMN, Turbo), `Pool`, `DynamicGroup`, `InsertNodeInPolyline`, `RectLabelNode`.

The only "panel" is `DndPanel` (a drag-and-drop *material palette*, not a property editor). A repo-wide grep of the docs for "property panel"/"properties panel"/"属性面板" finds only one hit, and it occurs in a generic low-code discussion article, not as a LogicFlow feature:
> "...we need to add request and popup dialog related logic in the **properties panel of the table component**." — https://github.com/didi/LogicFlow/blob/master/sites/docs/docs/article/lowcode-with-logicflow.en.md

The official mechanism for building one is the documented HTML component layer:
> "LogicFlow provides an HTML layer ... and supports registering components on the HTML layer. Host R&D can develop components based on any View framework through the LogicFlow API, such as the right-click menu of the node, the control panel, etc."

**Verdict:** LogicFlow is a genuine diagram **editor** (drag-to-connect, anchors, ports, undo/redo, selection, resize, menus). It ships **no** property/inspector panel — that must be built by the host app.

### A.5 Performance at scale — no official benchmark

**No official LogicFlow benchmark with node-count/FPS numbers exists. Mark as UNVERIFIED.**

What can be cited:

- The only official quantitative framing is a scale *assumption*, not a measurement (architecture article):
  > "In the flowchart scenario, there is no need to render a large number of nodes (**up to thousands of elements**), and there is not a high demand for animation."
  > — https://github.com/didi/LogicFlow/blob/master/sites/docs/docs/article/architecture-of-logicflow.en.md
- A user-filed issue reports lag well beyond that scale:
  > "[Feature]: 虽然开启了局部渲染partial，但是数据过多还是会卡（上万个节点和上万条边）" ("even with partial rendering enabled, it still lags with too much data — tens of thousands of nodes and tens of thousands of edges")
  > — https://github.com/didi/LogicFlow/issues/1665
  This is a **user report, not an official benchmark or maintainer statement**; no official FPS/node-count figures were found in it or elsewhere.
- Related minimap performance issues exist (https://github.com/didi/LogicFlow/issues/1603, https://github.com/didi/LogicFlow/issues/1596), and a v2.0 article notes the minimap was reworked "in order to reduce the performance consumption of the canvas when moving" (https://github.com/didi/LogicFlow/blob/master/sites/docs/docs/article/release-v2.en.md).
- The docs describe `partial` as a shipped option: "`partial`: Whether to enable partial rendering" — https://github.com/didi/LogicFlow/blob/master/sites/docs/docs/api/type/MainTypes.en.md
- A third-party benchmark repo exists but is **not** official: https://github.com/yhlchao/LF-VS-Other (UNVERIFIED as to methodology/currency).

**No official LogicFlow statement about 1000+ node performance with numbers = UNVERIFIED.**

### A.6 TypeScript

**Written in TypeScript, types bundled.** Verified from the published npm tarball (`@logicflow/core@2.2.5`):

```json
"main":   "lib/index.js",
"module": "es/index.js",
"types":  "lib/index.d.ts",
"license": "Apache-2.0"
```
— https://registry.npmjs.org/@logicflow/core/-/core-2.2.5.tgz (`package/package.json`); also https://www.npmjs.com/package/@logicflow/core

The package ships **220 `.d.ts` files**. The repo source is `.ts`/`.tsx` throughout with `tsconfig.json` at the root, and `jest.config.ts` / `turbo.json` / changesets for release management (https://github.com/didi/LogicFlow). No `@types/logicflow` package is needed or used.

### A.7 Maintenance status — active in 2026

**Actively maintained.**

| Signal | Value | Source |
|---|---|---|
| Last commit on `master` | **2026-07-30T07:58:09Z** ("fix(release): validate prerelease worktree statuses") | https://github.com/didi/LogicFlow/commits/master.atom |
| `@logicflow/core@2.2.5` | published **2026-07-30** | https://registry.npmjs.org/@logicflow/core |
| `@logicflow/extension@2.3.1` | released 2026-07-30 | https://github.com/didi/LogicFlow/releases |
| `@logicflow/layout@2.1.5`, `@logicflow/react-node-registry@1.2.5`, `@logicflow/vue-node-registry@1.2.5` | released 2026-07-30 | https://github.com/didi/LogicFlow/releases |
| Release cadence in 2026 | `2.2.3` 2026-05-12 → `2.2.4` 2026-07-06 → `2.2.5` 2026-07-30 | https://registry.npmjs.org/@logicflow/core |
| npm dist-tags | `latest: 2.2.5`, `alpha: 2.2.5-alpha.0`, legacy `stable: 1.1.31`, `next: 1.2.5` | https://registry.npmjs.org/@logicflow/core |
| Official site | https://site.logic-flow.cn — HTTP 200, current, bilingual | verified Sept 2026 |
| Changelog | changesets-driven; per-release notes at https://github.com/didi/LogicFlow/releases and docs changelog at `sites/docs/CHANGELOG.md` | — |
| AI-agent docs | shipped in-package since `@logicflow/core@2.2.2`: "`@logicflow/core@2.2.2` 及以上版本会包含这些文档" (docs under `node_modules/@logicflow/core/dist/docs/`) | https://github.com/didi/LogicFlow/blob/master/README.md |

Note: the dead `logicflow.site` domain does **not** indicate abandonment — it is a stale/expired alias. The project moved to `site.logic-flow.cn`.

---

## B) Butterfly (alibaba/butterfly)

### B.1 Rendering technology — corrected: it is DOM + SVG, NOT Canvas

**The brief's premise ("a `draw` method returning canvas draw commands") is FALSE.** Butterfly does not render the graph with the Canvas API. It renders **HTML DOM nodes overlaid with an SVG edge layer**. Canvas 2D is used only for auxiliary layers.

**Documented `draw` contract (exact quotes):**

Node — returns a **DOM** node:
> ```
> /**
>   * node的渲染方法
>   * @param {obj} data - 节点基本信息 
>   * @return {dom} - 返回渲染dom的根节点
>   */
> draw(obj) {}
> ```
> — https://github.com/alibaba/butterfly/blob/master/docs/zh-CN/node.md

The node doc also states the mandatory CSS contract:
> "`* 节点的返回的dom必须设置position: absolute;`" ("the DOM returned by a node must have `position: absolute`")

Edge — returns an **SVG DOM** root:
> ```
> /**
>   * 线段的渲染方法
>   * @param {obj} data - 线段基本信息 
>   * @return {dom} - 返回渲染svg dom的根节点
>   */
> draw(obj) {}
> ```
> — https://github.com/alibaba/butterfly/blob/master/docs/zh-CN/edge.md

The same edge doc requires SVG path data for arrows, via `Arrow.registerArrow`:
```js
Arrow.registerArrow([{
  key: 'yourArrow1',
  type: 'svg',
  content: require('/your_fold/your_arrow.svg')
}, {
  key: 'yourArrow1',
  type: 'pathString',
  content: 'M5 0 L0 -2 Q 1.0 0 0 2 Z'   // path 的 d 属性
}]);
```

**Source-level confirmation (branch `dev/v5`, which carries the newest code):**

| Evidence | Source |
|---|---|
| Canvas root creates an SVG element: `document.createElementNS('http://www.w3.org/2000/svg', 'svg')` with `class="butterfly-svg"`, appended into a `<div class="butterfly-wrapper">` | https://github.com/alibaba/butterfly/blob/dev/v5/src/canvas/baseCanvas.js |
| Edges are SVG `<path>`: `document.createElementNS('http://www.w3.org/2000/svg', 'path')` | https://github.com/alibaba/butterfly/blob/dev/v5/src/edge/baseEdge.js |
| Arrows support `type === 'svg'` → SVG `<image>` / `<path>` | `src/edge/baseEdge.js`, `src/utils/arrow.js` |
| Node rendering: `this.dom = this.draw({...})`, then all interaction/measurement is jQuery DOM (`$(this.dom).css(...)`, `.outerWidth()`, `.outerHeight()`) | https://github.com/alibaba/butterfly/blob/dev/v5/src/node/baseNode.js |
| `getContext('2d')` appears in only **5 files, all auxiliary**: `utils/selectCanvas.js` (selection box), `utils/minimap.js` (minimap), `utils/guidelineService.js` (snaplines), `utils/gridService.js` (grid background) | `grep -rn getContext src/` on `dev/v5` |

**README feature claim (both locales):**
> "利用DOM/REACT/VUE来定制元素；灵活性，可塑性，拓展性优秀" / "Use DOM/REACT/VUE to customize elements: flexibility and excellent expandability"
> — https://github.com/alibaba/butterfly/blob/master/README.md ; https://github.com/alibaba/butterfly/blob/master/README.en-US.md

**React / Vue2 renderers — confirmed to exist, but officially deprecated by the project:**

Both READMEs list the integrations and explicitly mark them unmaintained:
> "[React butterfly组件支持](./docs/zh-CN/react.md) **[不维护，推荐用原生小蝴蝶]**"
> "[Vue2 butterfly组件支持](./docs/zh-CN/vue.md)"
> — https://github.com/alibaba/butterfly/blob/master/README.md

> "[React butterfly](./docs/en-US/react.md) **[No maintenance, it is recommended to use native version]**"
> — https://github.com/alibaba/butterfly/blob/master/README.en-US.md

So: **both Canvas and SVG rendering = FALSE.** Nodes = HTML DOM; edges = SVG; Canvas 2D = only grid/guidelines/selection/minimap. React/Vue2 node renderers exist but are explicitly unmaintained.

### B.2 Maintenance — effectively unmaintained

| Signal | Value | Source |
|---|---|---|
| **Last commit anywhere** | **2024-05-20T07:23:53Z** ("chore: upgrate version") on branch **`dev/v5`** | https://github.com/alibaba/butterfly/commits/dev/v5.atom |
| Last commit on **`master`** | **2023-08-04T03:51:27Z** ("docs: fix react") | https://github.com/alibaba/butterfly/commits/master.atom |
| Last commit on `dev/v4` | 2023-01-09 | https://github.com/alibaba/butterfly/commits/dev/v4.atom |
| **GitHub Releases** | **ZERO releases** — the releases feed has 0 entries | https://github.com/alibaba/butterfly/releases |
| Last npm publish | **5.1.0-beta.40, 2024-05-20T07:25:01Z** | https://registry.npmjs.org/butterfly-dag |
| npm `modified` | 2024-05-20T07:25:01.520Z — the registry record has not changed since | https://registry.npmjs.org/butterfly-dag |
| Official online demo | **DEAD — HTTP 404.** `https://butterfly-dag.gitee.io/butterfly-dag/demo/analysis`, `.../butterfly-dag/`, and the bare `https://butterfly-dag.gitee.io/` all 404 | README links; verified via curl Sept 2026 |
| Repo `pushed_at` (as given in brief) | 2024-05-20 — consistent | — |

**Staleness: ~28 months since the last commit and the last npm publish (May 2024 → September 2026).** The `master` branch is ~37 months stale. There have been no releases at all, only npm publishes.

**Critical correction to the brief on versions:** `npm install butterfly-dag` resolves to `latest` = **5.1.0-beta.38 (2024-04-20)**, which matches the brief — **but that is not the newest artifact**. The registry also contains:

| Version | Published | dist-tag |
|---|---|---|
| 5.1.0-beta.38 | 2024-04-20T06:03:02Z | **`latest`** |
| 5.1.0-beta.39 | 2024-05-20T05:59:12Z | — |
| **5.1.0-beta.40** | **2024-05-20T07:25:01Z** | **`beta`** ← newest artifact |
| 4.3.29 | 2024-03-10T03:06:34Z | (last stable 4.x) |

**5.x has never left beta.** There is no stable 5.x version on npm at all — a regex filter for `^5\.\d+\.\d+$` returns nothing. The 5.x beta line began with `5.0.0-beta.1` on **2022-07-02**, i.e. **5.x has been in beta for over 4 years** while the newest activity sits on the unmerged `dev/v5` branch. Repo `master`'s `package.json` still declares `"version": "4.3.28"` (https://github.com/alibaba/butterfly/blob/master/package.json), while `dev/v5` declares `5.1.0-beta.40`.

**Verdict: effectively unmaintained in 2026.** No commits, no publishes, no releases, and a dead demo site for ~28 months.

### B.3 Documentation language — genuinely bilingual (Chinese + English)

Both locales exist in-repo with equal file counts: **15 files in `docs/zh-CN/` and 15 in `docs/en-US/`**, covering the same topics:

`canvas.md`, `edge.md`, `endpoint.md`, `group.md`, `layout.md`, `minimap.md`, `node.md`, `plugins-arrows.md`, `plugins-hotkey.md`, `plugins-pannel.md`, `react.md`, `tooltip.md`, `vue.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`

- Chinese: https://github.com/alibaba/butterfly/tree/master/docs/zh-CN
- English: https://github.com/alibaba/butterfly/tree/master/docs/en-US
- Bilingual README: https://github.com/alibaba/butterfly/blob/master/README.md (zh) / https://github.com/alibaba/butterfly/blob/master/README.en-US.md (en)

So Butterfly is **not** Chinese-only. However, the docs live only as Markdown in the repo — the hosted doc/demo site that the READMEs link to is dead (404), so there is no browsable documentation site as of Sept 2026.

### B.4 TypeScript — no types at all

| Check | Result | Source |
|---|---|---|
| npm `latest` (`5.1.0-beta.38`) `types` / `typings` field | **absent** (no such key) | https://registry.npmjs.org/butterfly-dag/latest |
| `dev/v5` `package.json` (`5.1.0-beta.40`) | `types: None`, `typings: None` | https://github.com/alibaba/butterfly/blob/dev/v5/package.json |
| `master` `package.json` (`4.3.28`) | **no** `types`/`typings` key | https://github.com/alibaba/butterfly/blob/master/package.json |
| `dev/v4` `package.json` | `types: None` | https://github.com/alibaba/butterfly/blob/dev/v4/package.json |
| `@types/butterfly-dag` on npm | **HTTP 404 — does not exist** | https://registry.npmjs.org/@types/butterfly-dag |

**No TypeScript definitions ship with the package, and no DefinitelyTyped package exists.** The source is plain JavaScript (`.js`) with Babel; there is no `.d.ts` anywhere and no `tsconfig.json`. Consumers must write their own declarations.

(License in the same metadata: `"license": "MIT"` on every branch — see B.2 sources.)

### B.5 Suitability as an editor — yes, it is an editor

Confirmed from official canvas and endpoint docs:

- Drag-to-connect is a first-class canvas option:
  > `linkable: true,  //节点可连接(选填)` / `disLinkable: true,  //节点可取消连接(选填)`
  > — https://github.com/alibaba/butterfly/blob/master/docs/zh-CN/canvas.md
  Plus imperative toggles: `canvas.setLinkable(boolean)`, `canvas.setDisLinkable(boolean)`.
- **Ports/anchors (`Endpoint`) are built in**, with typed direction and connection semantics:
  > "`type`: source: 来源锚点。线段只出不入 / target: 目标锚点。线段只入不出 / undefined: ... 能入能出，但取决于第一根连线是入还是出 / onlyConnect: ..."
  > Endpoint attributes include `orientation`, `pos`, `scope`, `disLinkable`, `expandArea` (hover hot-zone), `limitNum` (max connections), `dom` (use any child DOM as a port).
  > — https://github.com/alibaba/butterfly/blob/master/docs/zh-CN/endpoint.md
- Node-level port API: `node.addEndpoint(obj)`, `node.removeEndpoint(id)`, `node.getEndpoint(id, type)`, `endpoint.hasConnection()` — https://github.com/alibaba/butterfly/blob/master/docs/zh-CN/node.md
- Connection lifecycle events: `system.link.connect`, `system.link.reconnect`, `system.links.delete`, `system.endpoint.limit` — https://github.com/alibaba/butterfly/blob/master/docs/zh-CN/canvas.md
- Also built in: undo/redo (`canvas.undo()`, `canvas.redo()`, `pushActionQueue`/`popActionQueue`), box selection (`setSelectMode`), grid with snapping (`setGridMode`), guidelines (`setGuideLine`), minimap (`setMinimap`), auto-layout (dagre/d3-force/@antv/hierarchy), node groups, and `canvas.save2img()` with `png/jpeg/svg` output.
- **No property panel** is documented — same gap as LogicFlow.

**Verdict:** yes, it is an editor with drag-connect and ports. But given B.2/B.4, adopting it in 2026 means taking on an unmaintained, untyped, still-in-beta dependency.

---

## C) Cytoscape.js

### C.1 Rendering technology — Canvas 2D default, but an OFFICIAL WebGL renderer exists (major correction)

**The brief's premise is wrong as of Cytoscape.js 3.31.** There **is** an official WebGL renderer, authored by the Cytoscape.js maintainers, shipped in the current npm package. It is a *mode* of the canvas renderer, not a separate `renderer.name`, and it remains a **preview** (provisional API), and it is **not documented in the main API reference**.

**Primary source — official blog post "WebGL Renderer Preview", Mike Kucera, 2025-01-13** (https://blog.js.cytoscape.org/2025/01/13/webgl-preview/), exact quotes:

> "Cytoscape.js is a Javascript library for interactive network visualization. Under the hood it uses the browser's Canvas API to draw, or 'render', networks to a canvas element in a web page."

> "**Version 3.31 of Cytoscape.js contains a preview of a new WebGL renderer that uses the GPU to improve rendering performance.**"

> "In reality the WebGL renderer isn't really a new renderer. It's more like a new mode for the Canvas renderer. All of the code in the Canvas renderer that draws nodes and labels is reused..."

> "The WebGL renderer is brand new and is available as a preview release in version 3.31. **Any options or API being introduced are provisional and may change.**"

Activation, exactly as documented:

```js
cy = cytoscape({
  container: document.getElementById('cy'),
  elements: [ /* … */ ],
  style: [ /* … */ ],

  renderer: {
    name: 'canvas',  // still uses the canvas renderer
    webgl: true,     // turns on WebGL mode
    showFps: true,   // (optional) shows the current FPS at the top-left
    webglDebug: true, // (optional) prints debug info to the browser console

    // additional options (provisional, may change in future releases)
    webglTexSize: 4096,
    webglTexRows: 24,
    webglBatchSize: 2048,
    webglTexPerBatch: 16,
  },
});
```

Documented WebGL limitations (same post):
> "Only straight-line, haystack and bezier edges are supported. Other less frequently used edge types such as taxi or segmented edges will show up as bezier edges."
> "Dashed lines, overlays and underlays are not supported."
> "Edges can only have one label in the centre. Source and target labels are not supported yet."
> "Only triangle shaped edge arrows are supported... Hollow arrows are not supported."
> "Only solid colours are supported, no colour gradients."

**Source + design doc:**
- `src/extensions/renderer/canvas/webgl/` on `master`: `atlas.mjs`, `drawing-elements-webgl.mjs`, `drawing-redraw-webgl.mjs`, `fxaa-upscaler.mjs`, `misc-upscaler.js`, `shader-sdf.mjs`, `webgl-util.mjs`
- Official design doc (Mike Kucera, March 2025): https://github.com/cytoscape/cytoscape.js/blob/master/documentation/webgl.md — calls it a mode, describes sprite-sheet texture atlases, instanced drawing, and using WebGL for hit-detection/"picking".
- `src/extensions/renderer/canvas/index.mjs`: `CRp.WEBGL = 3;` `CRp.CANVAS_TYPES = [ '2d', '2d', '2d', 'webgl2' ];` and `if( options.webgl ){ ... r.initWebgl(...) }`
- `src/core/renderer.mjs` defaults include `webgl: false`, `webglTexSize: 2048`, `webglBatchSize: 2048`, `webglTexPerBatch: 14`, `webglBgColor`.

**Ships in the published package — verified from the npm tarball** (`cytoscape@3.34.3`, https://registry.npmjs.org/cytoscape/-/cytoscape-3.34.3.tgz): `dist/cytoscape.cjs.js` contains **91** case-insensitive matches for `webgl`, including the defaults `webglTexSize: 2048` and `webglBatchSize`. So WebGL is in the production bundle, not a branch-only experiment.

**Documentation gap (important nuance):** the string `webgl` appears **0 times** in the main API docs (`documentation/index.html`, which builds https://js.cytoscape.org). WebGL is therefore shipped and officially authored, but **absent from the API reference** — it is documented only via the blog post and the repo design doc. Treat it as **official but preview-grade**.

**Related open work (evidence of continued investment, not abandonment):**
- Issue #3305 "Initial, experimental WebGL rendering support" — https://github.com/cytoscape/cytoscape.js/issues/3305
- Issue #3320 "display and selection problems with GPU support" — https://github.com/cytoscape/cytoscape.js/issues/3320
- PR #3448 "WebGL: apply compound opacity inheritance to child node bodies and borders" — https://github.com/cytoscape/cytoscape.js/pull/3448
- PR #3403 "Add webgl edge guard in texture getter" (by maintainer maxkfranz) — https://github.com/cytoscape/cytoscape.js/pull/3403

**On `cytoscape-webgl`:** re-verified against the npm registry in Sept 2026 — **`cytoscape-webgl` → 404, `cytoscape-webgl-renderer` → 404, `@cytoscape/webgl` → 404.** All three still do not exist, confirming the brief. The reason is not that WebGL is unsupported: WebGL is **built into core**, so no separate package is needed. (Contrast: `cytoscape-svg` and `cytoscape-canvas` DO exist → HTTP 200, and are third-party export extensions.)

**Do not confuse with desktop Cytoscape:** the brief's warning is correct. `cytoscape.org` is the separate Java desktop application; the JS library is `js.cytoscape.org` (https://github.com/cytoscape/cytoscape.js — "Graph theory (network) library for visualisation and analysis"). The desktop app's GPU/WebGL rendering is unrelated to this library.

**Verdict for 2026:** default renderer = HTML5 Canvas 2D. An **official, maintainer-authored WebGL mode exists and ships in the current release**, but is labelled a *preview* with a provisional API, has real feature gaps (no dashed edges, no overlays/underlays, triangle-only arrows, single centre edge label), and is not in the API docs.

### C.2 Performance — official numbers

**Official Cytoscape.js performance docs:** https://js.cytoscape.org/#performance (source: https://github.com/cytoscape/cytoscape.js/blob/master/documentation/index.html)

The performance section explains *why* performance degrades and lists optimisations. Its qualitative claims, exact quotes:

> "Performance is a function of graph size, so performance decreases as the number of elements increases."
> "The rich visual styles that Cytoscape.js supports can be expensive. Only drawing circles and straight lines is cheap, but drawing complex graphs is less so."
> "**Edges are particularly expensive to render.** Multigraphs become even more expensive with the need for bezier curve edges."
> "The performance of rendering a (bitmap) canvas is a function of the area that it needs to render. As such, an increased pixel ratio (as in high density displays, like on the iPad) can decrease rendering performance."

Its **only quantitative claim**:
> "**Opaque edges with arrows are more than twice as fast as semitransparent edges with arrows.**"

Documented optimisation levers include: use `cy.getElementById()` over selectors; batch via `cy.batch()`; avoid animations; avoid function style values (use `data()`/`mapData()`); minimise labels and set `min-zoomed-font-size`; set `curve-style: haystack` ("Haystack edges are straight lines, which are much less expensive to render than bezier edges. This is the default edge style."); use solid edges not dotted/dashed; set `pixelRatio: 1` on high-density displays; avoid compound nodes.

**The performance docs contain NO absolute node-count/FPS figures.** The concrete numbers live in the WebGL blog post (https://blog.js.cytoscape.org/2025/01/13/webgl-preview/), exact quote:

> "Here are some examples of preliminary tests run on an **M1 MacBook pro using Chrome**:
> - An **EnrichmentMap** network (network of gene-set enrichment results) with approximately **1200 nodes and 16000 edges** runs at about **20 FPS** with the canvas renderer but speeds up to **over 100 FPS** with the WebGL renderer.
> - A publicly available network from **NDExbio.org** with approximately **3200 nodes and 68000 edges** crawls at **3 FPS** with the canvas renderer but improves to **10 FPS** with the WebGL renderer. 10 FPS is still not really smooth animation, but it is a significant improvement over 3 FPS which is borderline unusable."

The post also offers a subjective FPS-quality scale and explicitly disclaims the methodology:
> "When the frame rate gets lower than about 15 FPS then the animation starts to look jerky. If it gets lower than 5 FPS then the network no longer feels responsive. If it gets lower than 1 FPS then it feels like the browser is freezing up..."
> "**This type of testing is subjective** as it depends on the visual styles used, the size of the network, the browser, and the user's hardware. In other words: YMMV."

**Useful implication for a report:** at ~1200 nodes the canvas renderer is already only ~20 FPS on an M1 MacBook Pro in Chrome for that (edge-dense, 16k edges) network — but that figure is edge-count-dominated and not transferable to sparse graphs. **No official Cytoscape.js FPS-vs-node-count curve exists = UNVERIFIED.**

### C.3 It is a graph theory/visualisation library, NOT an editor

**Cytoscape.js has no built-in interactive edge creation.** Three independent primary-source confirmations:

**(1) The official gestures list contains no edge-creation gesture.** Exact, complete list from the docs (https://js.cytoscape.org/#notation/gestures):

> "Cytoscape.js supports several gestures:
> - Grab and drag background to pan : touch & desktop
> - Pinch to zoom : touch & desktop (with supported trackpad)
> - Mouse wheel to zoom : desktop
> - Two finger trackpad up or down to zoom : desktop
> - Tap to select : touch & desktop
> - Tap background to unselect : desktop
> - Taphold background to unselect : desktop & touch
> - Multiple selection via modifier key (shift, command, control, alt) + tap : desktop
> - Box selection : touch (three finger swipe) & desktop (modifier key + mousedown then drag)
> - Grab and drag nodes : touch & desktop"

Note: you can drag *background* (pan) and *nodes* (reposition) — but **there is no drag-from-node-to-create-edge gesture**. Edges are added programmatically via `cy.add()`, documented as "Add elements to the graph and return them."

**(2) `cytoscape-edgehandles` exists precisely because edge creation is not built in.** Its own README, exact quote:

> "**This extension allows for drawing edges between nodes**"
> — https://github.com/cytoscape/cytoscape.js-edgehandles

npm metadata (verified):
| Field | Value |
|---|---|
| Latest version | **4.0.1** |
| Published | **2021-07-28T20:07:02.191Z** |
| Description | "**Edge creation UI extension for Cytoscape**" |
| License | MIT |
| Dependencies | `lodash.memoize ^4.1.2`, `lodash.throttle ^4.1.1` (i.e. it is not part of core and drags in its own deps) |
| Registry `modified` | 2026-08-06 (metadata touch only — **no new version since 2021**) |
| — | https://registry.npmjs.org/cytoscape-edgehandles ; https://www.npmjs.com/package/cytoscape-edgehandles |

Repo URL caveat: npm's `repository` field points at `git+https://github.com/cytoscape/edgehandles.git`, which **404s** — the live repository is https://github.com/cytoscape/cytoscape.js-edgehandles (verified HTTP 200). The moved-name URL is stale metadata. The library's own site links to it as a third-party extension: the showcase labels it "Edgehandles extension" → https://github.com/cytoscape/cytoscape.js-edgehandles.

**(3) There is no built-in property/parameter editing UI.** Verified: `grep -c -i "faq" documentation/index.html` → **0** (there is no FAQ section on js.cytoscape.org), and searches for "property editor", "properties panel", "inspector panel", "edit panel" return **no matches** in the official docs. The library documents styling via stylesheets and data via element `data`, with no inspector/panel component. Complex editing UI requires third-party extensions (e.g. `cytoscape-cxtmenu` for context menus, https://github.com/cytoscape/cytoscape.js-cxtmenu).

**Verdict:** Cytoscape.js is a graph-theory model + optional renderer for visualisation and analysis — the README describes it as "Graph theory (network) library for visualisation and analysis" and "a fully featured graph theory library". It supports interactive *manipulation* of an existing graph (select, drag, pan, zoom) and graph algorithms ("Includes graph theory algorithms, from BFS to PageRank"), but it is **not** a node/edge authoring editor: no drag-to-connect, no ports/anchors, no property panel. Edge authoring requires the third-party `cytoscape-edgehandles`, whose last release was 2021.

### C.4 License

**MIT — confirmed.** `package.json` on npm declares `"license": "MIT"` (verified from the published tarball of `cytoscape@3.34.3` and https://www.npmjs.com/package/cytoscape). The README badge states "License MIT".

Precise note on the LICENSE file: https://github.com/cytoscape/cytoscape.js/blob/master/LICENSE (18 lines) contains the **MIT license text** — "Permission is hereby granted, free of charge..." and "WITHOUT WARRANTY OF ANY KIND" — under the copyright line:

> "Copyright (c) 2016-2026, The Cytoscape Consortium."

The literal token "MIT" does **not** appear as a standalone license identifier in the LICENSE file itself (the only "MIT" substring match is inside the word "LIMITED"). The MIT designation comes from `package.json` and the README badge. `cytoscape-edgehandles` is likewise MIT per its npm metadata.

### C5. TypeScript — ships its own bundled types; `@types/cytoscape` also exists

**Cytoscape.js ships first-party type definitions.** Verified from `cytoscape@3.34.3`:

```json
"version": "3.34.3",
"types":   "index.d.ts",     // 1st-party bundled types
"typings": null,             // "typings" not used; "types" is
"license": "MIT",
"dependencies": null         // zero runtime dependencies
```
— https://registry.npmjs.org/cytoscape/latest ; tarball https://registry.npmjs.org/cytoscape/-/cytoscape-3.34.3.tgz (contains `index.d.ts` at package root)

**`@types/cytoscape` (DefinitelyTyped) also exists and is still maintained:**

| Field | Value |
|---|---|
| `latest` | **3.31.0** |
| Latest published | **2025-10-10T07:34:12.094Z** |
| Registry last modified | 2025-10-10T07:34:12.277Z |
| TypeScript-version-tagged releases | `ts6.0` → 3.21.9; `ts5.9` → 3.21.9; `ts4.7` → 3.21.4; `ts2.0`+ → 3.8.5 etc. |
| — | https://registry.npmjs.org/@types/cytoscape ; https://www.npmjs.com/package/@types/cytoscape |

**Practical guidance:** prefer the bundled `index.d.ts` (tracks the shipped version — currently `cytoscape@3.34.3`). `@types/cytoscape@3.31.0` lags the library (3.31.0 vs 3.34.3) and its last publish was Oct 2025 — ~11 months before this verification. Note the WebGL options are documented as "provisional and may change", so their presence/typing in either `.d.ts` should be checked before relying on it — **UNVERIFIED** whether `renderer.webgl` is typed in `index.d.ts` or in `@types/cytoscape@3.31.0` (not inspected in this pass).

---

## Summary comparison table

| | LogicFlow | Butterfly | Cytoscape.js |
|---|---|---|---|
| **Graph rendering** | SVG (nodes + edges + anchors) | **HTML DOM nodes + SVG edges** (Canvas 2D only for grid/snaplines/selection/minimap) | Canvas 2D default; **official WebGL preview mode** (3.31+) |
| **HTML overlay** | Yes (component/menu/grid/background layers; Preact) | Nodes *are* HTML DOM | No (canvas only) |
| **Type** | Flowchart **editor** | Flowchart **editor** | Graph-theory **vis library** (not an editor) |
| **Drag-to-connect** | Built in (+ anchors) | Built in (`linkable`, `Endpoint` ports) | **Not built in** → 3rd-party `cytoscape-edgehandles` (last release 2021) |
| **Property panel** | None in core or extension | None | None |
| **TypeScript** | Yes, bundled (`types: lib/index.d.ts`, 220 `.d.ts`) | **None** (`@types/butterfly-dag` = 404) | Yes, bundled `index.d.ts` (+ `@types/cytoscape@3.31.0`) |
| **License** | Apache-2.0 | MIT | MIT |
| **Last commit** | **2026-07-30** | **2024-05-20** (`dev/v5`); master 2023-08-04 | **2026-09-13** (given) / v3.34.3 released 2026-09-07 |
| **Last npm publish** | **2026-07-30** (`@logicflow/core@2.2.5`) | **2024-05-20** (`5.1.0-beta.40`, `beta` tag) | **2026-09-07** (`3.34.3`) |
| **Docs language** | Chinese-first + **100% English** | **Bilingual** zh-CN/en-US, 15 files each (repo only; hosted site dead) | English |
| **Official site** | https://site.logic-flow.cn (200) — **`logicflow.site` is DEAD** | demo site **404** | https://js.cytoscape.org (200) |
| **Official perf numbers at scale** | **UNVERIFIED** (none published) | **UNVERIFIED** (none published) | Yes — via WebGL blog post (1200n/16k e: 20→100+ FPS; 3200n/68k e: 3→10 FPS, M1 MBP/Chrome) |

## Corrections to the research brief

1. **`logicflow.site` is dead.** Official docs are at https://site.logic-flow.cn (zh) and https://site.logic-flow.cn/en/ (en). Replace all citations.
2. **Cytoscape.js does have an official WebGL renderer** (preview since 3.31, shipped in 3.34.3, `renderer: { name: 'canvas', webgl: true }`). The absence of `cytoscape-webgl` packages is because it is built into core, not because WebGL is unsupported.
3. **Butterfly versions:** the newest artifact is `5.1.0-beta.40` (2024-05-20, `beta` tag), not `5.1.0-beta.38` (`latest` tag, 2024-04-20). **5.x has never had a stable release** and has been in beta since 2022-07-02.
4. **Butterfly does not support Canvas rendering** of nodes/edges, and its `draw()` returns **DOM/SVG**, not canvas draw commands. React/Vue2 renderers exist but are **explicitly marked unmaintained** by the project.
5. **Butterfly's docs are bilingual**, not Chinese-only (15 zh-CN + 15 en-US files) — but the hosted doc/demo site is dead (404).
6. **LogicFlow has no `registerNode` and no `setSvg`.** Registration is `lf.register({type, view, model})` / `lf.batchRegister([...])`; the SVG view method is `getShape()`; `setHtml()` exists only on `HtmlNode`.
