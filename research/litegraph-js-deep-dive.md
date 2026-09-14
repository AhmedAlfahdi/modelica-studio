# LiteGraph.js deep dive — candidate core for an ACASUAL bidirectional node editor

**Research snapshot:** 2026-09-13 (UTC). All web/registry/repo data fetched on that date.
**Pinned revisions examined:**
- `jagenjo/litegraph.js` @ `0555a2f2a3df5d4657593c6d45eb192359888195` (= master HEAD per the commits Atom feed; identical to the `gitHead` of the published npm `litegraph.js@0.7.18`) — [src/litegraph.js](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js) is 14,424 lines.
- `Comfy-Org/litegraph.js` @ `ea0e1a85c612454540152aa56b0d1e104738e6dc` (README archive notice commit) — archived/frozen.
- `Comfy-Org/ComfyUI_frontend` @ `main` (fetched 2026-09-13) — the live lineage, at `src/lib/litegraph/`.
- npm tarballs actually installed: `litegraph.js@0.7.18`, `@comfyorg/litegraph@0.17.2`.

Everything below is either (a) quoted/derived from a source I fetched, or (b) explicitly marked **UNVERIFIED**. Line numbers refer to the pinned revisions above and are linked as `#L<n>`.

---

## 1. Rendering tech — Canvas 2D, and the exact draw cycle

**Confirmed: HTML5 Canvas 2D, not SVG/DOM/WebGL.** The library's own README states: *"Renders on Canvas2D (zoom in/out and panning, easy to render complex interfaces, can be used inside a WebGLTexture)"* ([README.md](https://github.com/jagenjo/litegraph.js/blob/master/README.md)). In the source the 2D contexts are obtained with `canvas.getContext("2d")` at three places: `setCanvas` ([L5666](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L5666)), the foreground context ([L7855](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L7855)) and the background context `this.bgctx = this.bgcanvas.getContext("2d")` ([L8362](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8362)).

### 1.1 Two-canvas composition
`draw()` is documented as: *"renders the whole canvas content, by rendering in two separated canvas, one containing the background grid and the connections, and one containing the nodes)"* ([L7811-L7813](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L7811)). The background canvas holds grid + links + groups; the front canvas holds nodes, and `drawFrontCanvas` blits the background with `ctx.drawImage(this.bgcanvas, 0, 0)` when they are distinct elements ([L7889-L7893](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L7889)).

### 1.2 The `requestAnimationFrame` loop
There is **no** `render_loop` function in the source (that name does not exist). The loop is `startRendering`:

```js
LGraphCanvas.prototype.startRendering = function() {
    if (this.is_rendering) return;
    this.is_rendering = true;
    renderFrame.call(this);
    function renderFrame() {
        if (!this.pause_rendering) { this.draw(); }
        var window = this.getCanvasWindow();
        if (this.is_rendering) { window.requestAnimationFrame(renderFrame.bind(this)); }
    }
};
```
([L5881-L5899](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L5881)). It is kicked off **automatically from the constructor** unless `options.skip_render` is set ([L5441-L5443](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L5441)). `stopRendering()` just sets `is_rendering = false` ([L5906](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L5906)). So: an unconditional rAF loop at display refresh rate, with per-layer dirty flags deciding how much work each frame actually does.

`draw(force_canvas, force_bgcanvas)` ([L7814](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L7814)) does, in order:
1. bail if the canvas has zero size;
2. compute `this.render_time` and `this.last_draw_time` and derive FPS at the end: `this.fps = this.render_time ? 1.0 / this.render_time : 0` ([L7820-L7822](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L7820), [L7843](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L7843));
3. `this.ds.computeVisibleArea(this.viewport)` — updates the visible rectangle used for culling ([L7825](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L7825));
4. `drawBackCanvas()` if `dirty_bgcanvas || force_bgcanvas || always_render_background || (graph._last_trigger_time && now - graph._last_trigger_time < 1000)` ([L7828-L7837](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L7828));
5. `drawFrontCanvas()` if `dirty_canvas || force_canvas` ([L7839-L7841](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L7839)).

Because step 4 forces a background redraw for 1 second after any node trigger, *executing* a graph forces background passes; this is exactly the kind of coupling ComfyUI later had to re-architect (see §4.4).

### 1.3 `drawFrontCanvas` — the per-node loop
([L7851-L7990](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L7851)) It clears `dirty_canvas`, optionally clips to `viewport`/`dirty_area`, clears, blits the bg canvas, then:
- `this.onRender(canvas, ctx)` — a canvas-level hook ([L7896-L7898](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L7896));
- `this.renderInfo(...)` if `show_info`;
- `ctx.save(); this.ds.toCanvasContext(ctx);` — applies pan/zoom ([L7907-L7908](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L7907));
- `var visible_nodes = this.computeVisibleNodes(null, this.visible_nodes);` ([L7912-L7915](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L7912));
- for each visible node: `ctx.save(); ctx.translate(node.pos[0], node.pos[1]); this.drawNode(node, ctx); ctx.restore();` ([L7917-L7930](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L7917)) — **this translate is why node-local drawing uses `(0,0)` = top-left of the content area**;
- optional `drawExecutionOrder`, then `drawConnections(ctx)` if `graph.config.links_ontop`, then the in-progress dragged link, then `this.onDrawForeground(ctx, this.visible_rect)` — the **canvas-level** foreground hook ([L8087-L8088](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8087)).

`drawBackCanvas` similarly calls `this.onDrawBackground(ctx, this.visible_area)` — the **canvas-level** background hook ([L8484-L8485](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8484)), and contains a legacy alias warning: *"WARNING! onBackgroundRender deprecated, now is named onDrawBackground"* ([L8490](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8490)).

### 1.4 `drawNode` → `drawNodeShape`
`LGraphCanvas.prototype.drawNode(node, ctx)` ([L8539](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8539)):
- resolves colors: `var color = node.color || node.constructor.color || LiteGraph.NODE_DEFAULT_COLOR; var bgcolor = node.bgcolor || node.constructor.bgcolor || LiteGraph.NODE_DEFAULT_BGCOLOR;` ([L8543-L8544](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8543));
- `low_quality = this.ds.scale < 0.6` — text/shadow suppressed when zoomed out ([L8551](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8551));
- **live mode**: only `node.onDrawForeground(ctx, this, this.canvas)` is called and the function returns ([L8554-L8562](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8554));
- optional `node.onDrawCollapsed(ctx, this)` early-return ([L8577-L8583](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8577));
- optional clip path from `node.clip_area` using the node shape ([L8605-L8623](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8605));
- `this.drawNodeShape(node, ctx, size, color, bgcolor, node.is_selected, node.mouseOver)` ([L8629-L8637](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8629));
- **`node.onDrawForeground(ctx, this, this.canvas)`** ([L8641-L8643](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8641));
- then slots (inputs then outputs) with `render_text = !low_quality`, widgets via `this.drawNodeWidgets(...)` ([L8874](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8874)), badges, etc.

`LGraphCanvas.prototype.drawNodeShape(node, ctx, size, fgcolor, bgcolor, selected, mouse_over)` ([L9030-L9038](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9030)):
1. `ctx.strokeStyle = fgcolor; ctx.fillStyle = bgcolor;` ([L9040-L9041](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9040));
2. picks the shape: `var shape = node._shape || node.constructor.shape || LiteGraph.ROUND_SHAPE;` ([L9047-L9048](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9047)) — note this default (ROUND) differs from `drawNode`'s clipping default (`node._shape || LiteGraph.BOX_SHAPE`, [L8586](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8586));
3. fills the body: `fillRect` for BOX or low quality, `roundRect` with `this.round_radius` for ROUND/CARD, `arc` for CIRCLE ([L9070-L9093](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9070));
4. draws the title/body separator line ([L9096-L9101](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9096));
5. **`node.onDrawBackground(ctx, this, this.canvas, this.graph_mouse)`** ([L9105-L9107](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9105)) — i.e. the node's custom body drawing happens *after* the body fill and *before* the title bar;
6. **title bar**: `node.onDrawTitleBar(ctx, title_height, size, this.ds.scale, fgcolor)` ([L9112-L9113](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9112)), else the default title bar filled with `node.constructor.title_color || fgcolor` (or a gradient if `this.use_gradients`) ([L9114-L9152](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9114));
7. **title box** (the little circle/square): `node.onDrawTitleBox(ctx, title_height, size, this.ds.scale)` ([L9166-L9167](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9166));
8. **title text**: `node.onDrawTitleText(ctx, title_height, size, this.ds.scale, this.title_text_font, selected)` ([L9222-L9223](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9222)), else default text in `node.constructor.title_text_color || this.node_title_color`, or `LiteGraph.NODE_SELECTED_TITLE_COLOR` when selected ([L9232-L9261](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9232));
9. subgraph expand button, then **`node.onDrawTitle(ctx)`** ([L9286-L9287](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9286));
10. selection marker, calling `node.onBounding(area)` first so nodes can enlarge their own bounding box ([L9292-L9295](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9292)).

### 1.5 ⚠️ `onDrawn` does not exist
I grepped case-insensitively for `ondrawn` across the full 14,424-line jagenjo source and across the whole published `@comfyorg/litegraph@0.17.2` `dist/` typings and source — **zero hits**. `onDrawn` is **not** a LiteGraph API in either lineage (**verified absent**; if a report says otherwise, it is wrong). The complete set of node draw hooks is: `onDrawBackground`, `onDrawForeground`, `onDrawCollapsed`, `onDrawTitle`, `onDrawTitleBar`, `onDrawTitleBox`, `onDrawTitleText`, `onBounding`. Canvas-level hooks are `onDrawBackground`, `onDrawForeground`, `onDrawOverlay`, `onRender`, `onDrawLinkTooltip`.

### 1.6 Wiki status
The wiki has only four content pages — `Home`, `First-Project`, `Creating-custom-Nodes`, `Node-types` ([wiki Home](https://github.com/jagenjo/litegraph.js/wiki/Home), [First-Project](https://github.com/jagenjo/litegraph.js/wiki/First-Project), [Node-types](https://github.com/jagenjo/litegraph.js/wiki/Node-types)). `https://github.com/jagenjo/litegraph.js/wiki/LGraphCanvas` **does not exist** (GitHub serves the "Create new page" page). The wiki contains **no** description of the rAF/`draw()` cycle; for that the only sources are the source itself and the jagenjo-generated YUIDoc API pages, e.g. [`doc/classes/LGraphCanvas.html`](https://github.com/jagenjo/litegraph.js/blob/master/doc/classes/LGraphCanvas.html) (45 documented members, including `draw`, `drawFrontCanvas`, `drawBackCanvas`, `drawNode`, `drawNodeShape`, `drawNodeWidgets`, `drawConnections`, `computeVisibleNodes`).

---

## 2. Custom node rendering — exact API

### 2.1 Registration
```js
LiteGraph.registerNodeType("category/name", MyNode)
```
Implementation: `registerNodeType: function(type, base_class)` ([L157-L253](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L157)). What it actually does (all verified in-source):
- rejects plain objects: `throw "Cannot register a simple object, it must be a class with a prototype"` ([L158-L160](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L158));
- sets `base_class.type = type` and derives `base_class.category` from the part before the last `/` ([L161](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L161), [L169-L170](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L169));
- **copies every `LGraphNode.prototype` member into your prototype if you didn't define it** ([L177-L181](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L177)) — so subclassing `LGraphNode` is optional; a bare `function` + `prototype` works;
- if your prototype has no own `shape` property, it installs a **string→constant `shape` accessor** accepting `"default" | "box" | "round" | "circle" | "card"` ([L187-L215](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L187));
- quirk worth knowing: the `supported_extensions` → `node_types_by_file_extension` registration is nested **inside** that same `if (!hasOwnProperty("shape"))` block ([L219-L226](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L219)), so drag-and-drop-by-extension silently does not register for classes that declare their own `shape`;
- warns if you define `onPropertyChange` instead of `onPropertyChanged` ([L241-L247](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L241));
- optionally instantiates the class once if `LiteGraph.auto_load_slot_types` is on ([L250-L252](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L250)).

### 2.2 The drawing hooks — runtime signatures and exact call sites
| Hook | Verified call site (jagenjo `src/litegraph.js`) | Arguments actually passed |
|---|---|---|
| `node.onDrawForeground` | [L8641-L8643](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8641) (inside `drawNode`) | `(ctx, this /* LGraphCanvas */, this.canvas /* HTMLCanvasElement */)` |
| `node.onDrawForeground` (live mode) | [L8557-L8559](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8557) | same 3 args |
| `node.onDrawBackground` | [L9105-L9107](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9105) (inside `drawNodeShape`) | `(ctx, this, this.canvas, this.graph_mouse)` — 4 args |
| `node.onDrawTitleBar` | [L9112-L9113](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9112) | `(ctx, title_height, size, ds.scale, fgcolor)` |
| `node.onDrawTitleBox` | [L9166-L9167](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9166) | `(ctx, title_height, size, ds.scale)` |
| `node.onDrawTitleText` | [L9222-L9230](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9222) | `(ctx, title_height, size, ds.scale, title_text_font, selected)` |
| `node.onDrawTitle` | [L9286-L9287](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9286) | `(ctx)` |
| `node.onDrawCollapsed` | [L8577-L8583](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8577) | `(ctx, this)`; **return `true` to skip the rest of the default draw** |
| `node.onBounding` | [L9293-L9294](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9293) | `(area /* [x,y,w,h] */)`, mutable |

The official guide documents the same two main hooks and the coordinate contract: *"Both functions receive the Canvas2D rendering context and the LGraphCanvas instance where the node is being rendered. You do not have to worry about the coordinates system, (0,0) is the top-left corner of the node content area (not the title)."* ([guides/README.md](https://github.com/jagenjo/litegraph.js/blob/master/guides/README.md), "Custom Node Appearance"). The wiki says only: *"onDrawForeground: render the inside widgets inside the node"* / *"onDrawBackground: render the background area inside the node (only in edit mode)"* ([wiki: Creating custom Nodes](https://github.com/jagenjo/litegraph.js/wiki/Creating-custom-Nodes)).

The documented difference between the two hooks: *"The only difference is that onDrawForeground gets called in Live Mode and onDrawBackground not."* ([guides/README.md](https://github.com/jagenjo/litegraph.js/blob/master/guides/README.md)) — confirmed by the live-mode early return at [L8554-L8562](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8554).

**Comfy fork differences (breaking):** in `ComfyUI_frontend/src/lib/litegraph/src/LGraphCanvas.ts`, `onDrawForeground` is still called with three args ([L5769](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/lib/litegraph/src/LGraphCanvas.ts#L5769), with the comment *"TODO: Legacy behaviour: onDrawForeground received ctx in this state"* at L5765), but **`onDrawBackground` is now called with `ctx` only**: `node.onDrawBackground?.(ctx)` ([L5936](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/lib/litegraph/src/LGraphCanvas.ts#L5936)). The typings in the deprecated npm package match this: `onDrawBackground?(this, ctx)` and `onDrawForeground?(this, ctx, canvas, canvasElement)` ([LGraphNode.d.ts L248/L270](https://unpkg.com/@comfyorg/litegraph@0.17.2/dist/LGraphNode.d.ts)). So code written against jagenjo's 4-arg `onDrawBackground` breaks on the fork.

### 2.3 `shape` options
jagenjo constants ([L51-L59](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L51)):
```js
VALID_SHAPES: ["default", "box", "round", "card"], //,"circle"
BOX_SHAPE: 1, ROUND_SHAPE: 2, CIRCLE_SHAPE: 3, CARD_SHAPE: 4, ARROW_SHAPE: 5, GRID_SHAPE: 6,
```
`CIRCLE_SHAPE` is deliberately commented out of `VALID_SHAPES` but is still accepted by the `shape` setter installed at registration ([L200-L202](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L200)) and is handled in `drawNodeShape` ([L9084-L9091](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9084)). `ARROW_SHAPE`/`GRID_SHAPE` are for slots (the guide calls GRID *"intended for slot arrays"*). In the Comfy fork these became the `RenderShape` enum (`BOX=1, ROUND=2, CIRCLE=3, CARD=4, ARROW=5, GRID=6, HollowCircle=7`) with a `NAMED_SHAPES` map that **does** include `circle` ([globalEnums.d.ts](https://unpkg.com/@comfyorg/litegraph@0.17.2/dist/types/globalEnums.d.ts); [LGraphNode.ts L328-L331](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/lib/litegraph/src/LGraphNode.ts#L328)).

Typical declaration: `MyNodeClass.shape = LiteGraph.ROUND_SHAPE;` ([guides/README.md](https://github.com/jagenjo/litegraph.js/blob/master/guides/README.md)).

### 2.4 Title/body colors
- **Body fill**: `node.bgcolor || node.constructor.bgcolor || LiteGraph.NODE_DEFAULT_BGCOLOR` ([L8544](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8544)) — i.e. set `MyNode.bgcolor = "#222"` or per-instance `node.bgcolor`.
- **Body outline / fallback title fill**: `node.color || node.constructor.color || LiteGraph.NODE_DEFAULT_COLOR` ([L8543](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8543)).
- **Title bar**: `node.constructor.title_color || fgcolor`, drawn only if `title_mode != TRANSPARENT_TITLE && (node.constructor.title_color || this.render_title_colored)` ([L9114-L9118](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9114)); the guide's example is `MyNodeClass.title_color = "#345";`.
- **Title text**: `node.constructor.title_text_color || this.node_title_color`, overridden by `LiteGraph.NODE_SELECTED_TITLE_COLOR` when selected ([L9237-L9241](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9237)).
- **Title box**: `node.boxcolor || colState || LiteGraph.NODE_DEFAULT_BOXCOLOR` ([L9186](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9186)).
- Defaults: `NODE_TITLE_COLOR "#999"`, `NODE_SELECTED_TITLE_COLOR "#FFF"`, `NODE_TEXT_COLOR "#AAA"`, `NODE_DEFAULT_COLOR "#333"`, `NODE_DEFAULT_BGCOLOR "#353535"`, `NODE_DEFAULT_BOXCOLOR "#666"` ([L27-L34](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L27)).

### 2.5 Widgets
- `LGraphNode.prototype.addWidget = function(type, name, value, callback, options)` — documented types `"number" | "string" | "combo" | ...`; `options` may be a property name; `"combo"` **throws** without `options.values` ([L3813-L3863](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L3813)).
- `LGraphNode.prototype.addCustomWidget = function(custom_widget)` ([L3865-L3871](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L3865)) — this is the extension point for arbitrary widget rendering.
- **There is no `onDrawWidget` hook** in either lineage (verified absent in both). Widgets are drawn by the canvas: the default path calls `w.draw(ctx, node, widget_width, y, H)` inside `LGraphCanvas.prototype.processNodeWidgets` at [L10074](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L10074); custom widgets must implement `draw(...)` themselves (see the `root.addWidget` example at [L12407](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L12407)).
- If you want a fully custom-drawn widget you either give it a `draw` function (`addCustomWidget`) or draw your own UI inside `onDrawForeground` and hit-test in `onMouseDown`.

### 2.6 Concrete example — a resistor drawn with `onDrawForeground`
This is ordinary application code using only the verified API above (I wrote it; it is not copied from the repo). It draws a zigzag between two slots, sized to `node.size`, and skips drawing when collapsed or tiny:

```js
function ResistorNode() {
  this.addInput("a", "*");     // verify permissive typing in §3.2
  this.addOutput("b", "*");
  this.properties = { resistance: 1000 };
  this.size = [160, 60];
}
ResistorNode.title = "Resistor";
ResistorNode.shape = LiteGraph.ROUND_SHAPE;   // guides/README.md
ResistorNode.color = "#333";                  // outline / fallback title
ResistorNode.bgcolor = "#2A2A2A";             // body fill
ResistorNode.title_color = "#345";            // title bar fill
ResistorNode.title_text_color = "#EEE";

ResistorNode.prototype.onDrawForeground = function (ctx, canvas) {
  if (this.flags.collapsed) return;           // same guard as the official guide
  const w = this.size[0], h = this.size[1];
  const y = h * 0.5;
  const x0 = w * 0.10, x1 = w * 0.90;
  const lead = (x1 - x0) * 0.18;
  const zx0 = x0 + lead, zx1 = x1 - lead, seg = (zx1 - zx0) / 6;
  const amp = h * 0.18;

  ctx.save();
  ctx.strokeStyle = "#DDD";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(zx0, y);
  for (let i = 0; i < 6; i++) {
    ctx.lineTo(zx0 + seg * (i + 1), y + (i % 2 ? amp : -amp));
  }
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.restore();
};

LiteGraph.registerNodeType("acasual/resistor", ResistorNode);
```
`canvas.ds.scale` (the current zoom) is reachable from the 2nd argument if you want constant screen-space line width ([L8551](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8551) shows `this.ds.scale`). A capacitor is the same pattern with two parallel plates; both hooks give you a raw `CanvasRenderingContext2D`, so **any** shape is possible. Note the ordering consequence: anything drawn in `onDrawBackground` is painted under the slots/widgets/title, anything in `onDrawForeground` over them — for a symbol you want visible above the node body but below the slots, prefer `onDrawBackground`; for an overlay, `onDrawForeground`.

---

## 3. Ports/slots model — and whether undirected connections are possible

### 3.1 Structure (verified)
- A node has two **separate** arrays: `node.inputs` and `node.outputs`; direction is structural, not a per-slot flag. `LiteGraph.INPUT = 1`, `LiteGraph.OUTPUT = 2` are used only as *which-side* arguments in callbacks ([L61-L63](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L61), e.g. `onConnectionsChange(LiteGraph.OUTPUT, slot, ...)` at [L4454-L4461](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L4454)).
- Input slot fields: `{ name, type, link }` where **`link` is a single link id or `null`** ([L3569](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L3569)). Output slot fields: `{ name, type, links }` where **`links` is an array or `null`** ([L3478](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L3478)).
- `extra_info` passed to `addInput`/`addOutput` is shallow-copied onto the slot ([L3570-L3574](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L3570), [L3479-L3483](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L3479)), so you can attach arbitrary per-terminal metadata (e.g. `{ role: "positive" }`). Signature: `addInput(name, type, extra_info)` / `addOutput(name, type, extra_info)` ([L3567](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L3567), [L3477](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L3477)).
- Graph-level store: `this.links = {}; //container with all the links` — an **object map id → LLink** ([L894](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L894)). `LLink = function(id, type, origin_id, origin_slot, target_id, target_slot)` ([L2376-L2386](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L2376)) — **every link is explicitly directed: origin → target**.
- Serialization of a link is a 6-tuple: `[id, origin_id, origin_slot, target_id, target_slot, type]` ([`LLink.prototype.serialize`](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L2406)).

### 3.2 Can a slot be both input and output? Is there an undirected connection?
**No, on both counts.** Verified:
- A slot is either an entry in `inputs` or in `outputs`; there is no slot record with both `link` and `links`, and no `isInput`/`both` flag.
- Case-insensitive grep for `undirected` and `bidirectional` over the whole jagenjo source: **zero hits**.
- `slot.dir` (documented as *"optional, could be `LiteGraph.UP`, `LiteGraph.RIGHT`, `LiteGraph.DOWN`, `LiteGraph.LEFT`"*, [guides/README.md](https://github.com/jagenjo/litegraph.js/blob/master/guides/README.md)) is a **rendering hint for link routing only** — used e.g. for the in-progress dragged link at [L7952-L7960](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L7952). It does not change semantics. In the fork it is typed as `LinkDirection` (`NONE/UP/DOWN/LEFT/RIGHT/CENTER`) with the doc *"The direction that a link point will flow towards — e.g. horizontal outputs are right by default"* ([globalEnums.d.ts](https://unpkg.com/@comfyorg/litegraph@0.17.2/dist/types/globalEnums.d.ts)).
- The Comfy fork adds `connectSlots(output, inputNode, input, afterRerouteId)` and `connectInputToOutput()` — but the latter is the *bypass* helper (*"Attempts to gracefully bypass this node in all of its connections by reconnecting all links"*, [LGraphNode.ts L4040-L4054](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/lib/litegraph/src/LGraphNode.ts#L4040)), not an undirected link model. `connectSlots` still requires an output slot on the source and an input slot on the target ([LGraphNode.ts L3143-L3160](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/lib/litegraph/src/LGraphNode.ts#L3143)).

**What *is* possible for ACASUAL/undirected semantics** (my analysis, clearly labelled as such): the *data model* is usable as an undirected graph, because each `LLink` stores **both** endpoints plus both slot indices, and `graph.links` is a plain map. A conservation-law solver can walk `graph.links` and treat each link as an unordered edge between `(origin_id, origin_slot)` and `(target_id, target_slot)` without ever calling `getInputData`/`runStep`. What you cannot do is express "this terminal is both an input and an output" as **one** slot: you must add a matched input+output pair (or a single input plus a single output with the same name/type) and let your own layer treat them as one terminal. Note also that litegraph's built-in execution engine is strictly directed and pull-based (`getInputData`/`setOutputData`, `LGraph.runStep`), and that the port-type checker is easy to make fully permissive — see below.

### 3.3 Type checking between slots
`LiteGraph.isValidConnection(type_a, type_b)` ([L684-L718](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L684)):
- `""` or `"*"` is normalized to `0` (generic);
- a falsy/generic type on **either** side matches anything;
- identical types match; `LiteGraph.EVENT (-1)` output matches `LiteGraph.ACTION (-1)` input;
- otherwise case-insensitive string comparison, with comma-separated multi-type lists checked by permutation.

So `this.addInput("a", "*")` / `this.addOutput("b", "*")` makes every terminal universally connectable — convenient for a conservation-law model where the "type" is really a domain (electrical, translational, …) that you validate yourself.

### 3.4 Multiple links per slot — exactly what happens
- **Outputs: unlimited fan-out.** `output.links.push(link_info.id)` with no cap ([L4445-L4448](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L4445)).
- **Inputs: exactly one link.** On connect, an existing link is destroyed first: `if (target_node.inputs[target_slot] && target_node.inputs[target_slot].link != null) { ... target_node.disconnectInput(target_slot, ...) }` ([L4405-L4410](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L4405)); then `target_node.inputs[target_slot].link = link_info.id` ([L4450](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L4450)).
- **The only setting is `LiteGraph.allow_multi_output_for_events`**, default `true`, and it applies **only** to slots of type `LiteGraph.EVENT`; with it `false`, connecting replaces the output's existing links ([L135](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L135), [L4411-L4423](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L4411)). There is no setting to allow multiple links on a normal input.
- The docs state the same rule twice: *"The main difference between inputs and outputs is that an input can only have one connection link while outputs could have several"* ([wiki: Creating custom Nodes](https://github.com/jagenjo/litegraph.js/wiki/Creating-custom-Nodes) and [guides/README.md](https://github.com/jagenjo/litegraph.js/blob/master/guides/README.md), "Node slots").
- The fork matches: `NodeInputSlot { link: LinkId | null }` vs `NodeOutputSlot { links: LinkId[] | null }` ([NodeInputSlot.d.ts](https://unpkg.com/@comfyorg/litegraph@0.17.2/dist/node/NodeInputSlot.d.ts), [NodeOutputSlot.d.ts](https://unpkg.com/@comfyorg/litegraph@0.17.2/dist/node/NodeOutputSlot.d.ts)).

**Consequence for a conservation-law editor:** there is no "net/junction" primitive. A net with *k* terminals is a node with *k* inputs (all single-link), and *k* links all originating from component outputs. If your model permits many components to share a node, you must size the net node's input list to the number of connections (or use `onGetInputs`, documented in the wiki as *"returns an array of possible inputs"*, to grow slots dynamically — [wiki](https://github.com/jagenjo/litegraph.js/wiki/Creating-custom-Nodes)). This is a real modelling constraint, not a blocker.

---

## 4. Performance — what is known to work, and where the ceiling is

### 4.1 The library's own stated target
`README.md` (both lineages): *"Optimized to support hundreds of nodes per graph (on editor but also on execution)"* ([jagenjo README](https://github.com/jagenjo/litegraph.js/blob/master/README.md); the same line is in the ComfyUI_frontend copy: [src/lib/litegraph/README.md](https://github.com/Comfy-Org/ComfyUI_frontend/tree/main/src/lib/litegraph)).

### 4.2 Hard ceiling
`MAX_NUMBER_OF_NODES: 1000, //avoid infinite loops` ([L49](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L49)), enforced in `LGraph.add`: `if (this._nodes.length >= LiteGraph.MAX_NUMBER_OF_NODES) throw "LiteGraph: max number of nodes in a graph reached";` ([L1497-L1499](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L1497)).
The Comfy fork **raises this to 10,000**: `MAX_NUMBER_OF_NODES = 10_000` ([LiteGraphGlobal.ts L103](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/lib/litegraph/src/LiteGraphGlobal.ts#L103)), still enforced at `LGraph.ts` L1364. So "thousands of nodes" is inside the fork's design envelope.

### 4.3 Viewport culling — verified in code
- **Nodes are culled.** `computeVisibleNodes(nodes, out)` iterates the graph's nodes and skips any node whose bounding box does not overlap `this.visible_area`: `if (!overlapBounding(this.visible_area, n.getBounding(temp, true))) { continue; } //out of the visible area` ([L7789-L7808](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L7789)). In the fork the same function uses a cached `node.renderArea` ([LGraphCanvas.ts L4975-L4989](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/lib/litegraph/src/LGraphCanvas.ts#L4975)).
- **Links are culled per-link, not per-graph-region.** `drawConnections` iterates **all** `graph._nodes` and all their inputs, then culls each link by a slightly inflated visible rect (`margin_area = visible_area ± 20/40`) at [L9430](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9430) (loop starts [L9360](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9360)). This is O(total nodes) per background frame regardless of zoom. The fork fixes this by *passing the visible node list in*: `drawConnections(ctx, nodesInFrameOrder, nodesGraph)` ([LGraphCanvas.ts L6044-L6072](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/lib/litegraph/src/LGraphCanvas.ts#L6044)).
- `low_quality` short-circuits: at `ds.scale < 0.6` shadows are skipped and text is not rendered ([L8551](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8551), [L8649](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8649)); `drawNodeShape` has its own `low_quality = this.ds.scale < 0.5` ([L9044](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9044)).

### 4.4 Measured, citable behaviour at scale
**A real 541-node workflow, with FPS numbers.** ComfyUI_frontend issue #3180, *"Larger workflows have substantially lower FPS on new comfyui frontends"* (author Kronos725, created 2025‑03‑21) reports a workflow *"which has 541 nodes"* and measures, dragging the canvas:

> "On the 2025-03-01 build: I get ~35 FPS while dragging to look around when I zoom out all the way (all 541 nodes are in view) / I get ~70 FPS while dragging to look around when I am zoomed in to video part of the workflow (30 nodes in view)"
> "On the 2025-03-20 build: I get ~12 FPS … (all 541 nodes are in view) / I get ~25 FPS … (30 nodes in view)"

([issue #3180](https://github.com/Comfy-Org/ComfyUI_frontend/issues/3180)). I downloaded the attached workflow myself and counted it: **541 nodes, 1,530 links, 50 groups, 663,644 bytes** (`https://github.com/user-attachments/files/19371284/HUN.ULTRA.1.4.json`). This is the single most useful data point in this report: culling clearly works (30 visible nodes ≈ 2–3× the FPS of 541 visible nodes), but ~540 simultaneously visible nodes is a 12–35 FPS regime even for ComfyUI.

**A second real workflow — and a claim I could not confirm.** In the same thread a ComfyUI maintainer wrote *"BTW, I cannot reproduce the performance issue with AP workflow which has 1000+ nodes. Browser profiling shows no much difference."* and attached `AP.Workflow.10.0.for.ComfyUI.json` ([issue #3180 comment](https://github.com/Comfy-Org/ComfyUI_frontend/issues/3180)). I downloaded that file and counted it: **662 nodes, 881 links, 64 groups, 132 distinct node types, 917,252 bytes** — *not* 1000+. **The "1000+ node workflow" claim is UNVERIFIED**; the file attached as evidence contains 662 nodes (note it does contain 183 `Reroute (rgthree)` and 107 `GetNode`/`SetNode` helper nodes, so node counts in ComfyUI are inflated by plumbing).

**ComfyUI_frontend's own definition of "large".** The repository's Playwright perf suite uses a synthetic fixture `browser_tests/assets/large-graph-workflow.json`, which I downloaded and counted: **245 nodes, 294 links** (49 × {CheckpointLoaderSimple, KSampler, EmptyLatentImage} + 98 CLIPTextEncode; 136,453 bytes). The test comments call this "scale":
> `// Let the large graph idle for 2 seconds — measures compositor and style recalculation cost at scale (245 nodes).`

([browser_tests/tests/performance.spec.ts](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/browser_tests/tests/performance.spec.ts) — fixture at [browser_tests/assets/large-graph-workflow.json](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/browser_tests/assets/large-graph-workflow.json)).

**Maintainer statement that large workflows are ~500+ nodes.** In frontend issue #15679 (auto-filed from review of PR #14569, requested by maintainer `christian-byrne`, created 2026‑08‑23): *"Large workflows can contain 500 or more nodes but few subgraph nodes. A WebSocket preview frame can cause O(total nodes) short-circuit evaluations."* ([issue #15679](https://github.com/Comfy-Org/ComfyUI_frontend/issues/15679)).

**A second, independent perf report:** issue #6601 (created 2025‑11‑05) *"Huge performance regression on Chrome 142"*: *"on my workflow with ~100 nodes, it becomes basically unbearable with <20 fps"* — with the caveat that the reporter measured *"a lot more frame drops in 142 than 141, even for the sample workflow with only 7 nodes"*, i.e. that one is a browser regression, not a node-count effect ([issue #6601](https://github.com/Comfy-Org/ComfyUI_frontend/issues/6601)).

### 4.5 Nodes 2.0 — what it says about the Canvas approach's limits
Official docs page (fetched 2026‑09‑13): [docs.comfy.org/interface/nodes-2](https://docs.comfy.org/interface/nodes-2) (clean markdown at `https://docs.comfy.org/interface/nodes-2.md`):
- *"Nodes 2.0 moves ComfyUI node rendering from LiteGraph Canvas to a Vue-based system for faster iteration: what changed and how to enable it."* (page description)
- *"This update transitions the node system from LiteGraph.js Canvas rendering to a Vue-based architecture, unlocking faster iteration and richer interactions."*
- *"The previous Canvas rendering system had become a development bottleneck. Even small UI changes often required deep modifications and could take days to implement. This slowed the ability to respond to community feedback and made node customization difficult for developers."*
- Known-issues table: *"**Performance** | Still optimizing toward Canvas-level performance. Certain scenarios may behave differently."* and *"**Edge cases** | At extreme zoom levels or within very large workflows, minor visual issues may appear."*
- *"The LiteGraph.js rendering system remains available, and you can toggle between systems at any time."* — i.e. **Nodes 2.0 did not delete the canvas renderer; it is a switchable alternative** ("Click on the **ComfyUI logo** to open the menu / Toggle **Nodes 2.0** to switch back").
- Page `dateModified` in its JSON-LD: **2026-08-26T12:57:46.093Z** (verified from the page HTML).

Implementation location (verified by directory listing): `src/renderer/extensions/vueNodes/` (components/, composables/, execution/, interactions/, layout/, preview/, widgets/) with the node component at `src/renderer/extensions/vueNodes/components/LGraphNode.vue`, alongside `src/renderer/core/canvas/` (`canvasStore.ts`, `pathRenderer.ts`, `litegraph/`, `canvasRedrawBudget.test.ts`) ([tree](https://github.com/Comfy-Org/ComfyUI_frontend/tree/main/src/renderer/extensions/vueNodes), [tree](https://github.com/Comfy-Org/ComfyUI_frontend/tree/main/src/renderer/core/canvas)).

The Vue renderer has its own measured bottleneck, in the same perf suite: *"Heaviest perf test: loads an 80-node subgraph and pays ~30s/repeat. The signal is dominated by N=80 mount cost"* and *"Entering the subgraph unmounts root nodes and mounts all 80 interior nodes synchronously — this is the bottleneck we're measuring."* ([performance.spec.ts](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/browser_tests/tests/performance.spec.ts)). The same file's DOM-node test asserts only **100** nodes are present in the DOM (`expect(nodeCount).toBe(100)`) — i.e. the Vue renderer virtualizes. **Honest summary: Vue bought developer velocity, not raw scale — the docs explicitly say they are still "optimizing toward Canvas-level performance".**

### 4.6 The canvas architecture's own documented ceilings (2026 ADRs)
Two ADRs in the frontend repo, both dated **2026‑08‑26**, status **Proposed**, are the clearest published statement of what hurts in `LGraphCanvas` at scale:
- **ADR-RENDERING-INVALIDATION-0021, "Classified, Frame-Coalesced Canvas Invalidation"**: *"`LGraphCanvas` has separate foreground and background dirty flags. … A background draw currently makes the foreground dirty as part of its legacy composition behavior, so requesting too broad a layer can multiply work."* It records that *"The execution-performance investigation found both failure patterns. An implicit reactive edge generated unintended background passes, while repeated progress updates scanned nodes, wrote equal values, and requested redraws even when no rendered ratio changed."* It requires future optimizations to *"demonstrate the eliminated writes, traversals, dirty requests, or complexity slope under representative graph sizes."*
- **ADR-RENDERING-ATOMICITY-0020, "Frame-Atomic Rendering"**: *"LiteGraph canvas drawing is an imperative traversal that reads a large and evolving graph surface: nodes, slots, links, geometry, settings, and extension-provided hooks."* … *"These views can synchronize geometry, derive connectivity, allocate arrays, sort links, or translate a mutation into store commands. They are necessary at extension boundaries, but repeatedly deriving them inside a node, slot, or link drawing loop turns a compatibility cost into a frame-size-dependent cost."*

([ADR index](https://github.com/Comfy-Org/ComfyUI_frontend/tree/main/docs/adr), [DEPS-LITEGRAPH-0001](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/docs/adr/DEPS-LITEGRAPH-0001-integrate-litegraph-into-the-frontend.md), [RENDERING-INVALIDATION-0021](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/docs/adr/RENDERING-INVALIDATION-0021-classified-frame-coalesced-canvas-invalidation.md), [RENDERING-ATOMICITY-0020](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/docs/adr/RENDERING-ATOMICITY-0020-frame-atomic-rendering.md).)

**Bottom line for §4:** hundreds of nodes is the proven, production regime (541 verified, 662 verified, 245 used as a "large graph" test fixture, ~500+ cited by a maintainer, hard caps 1,000 → 10,000). Thousands of nodes is *storable* and *cullable*, but the frame cost is driven by **visible** nodes: ~540 visible nodes ≈ 12–35 FPS; ~30 visible nodes ≈ 25–70 FPS.

---

## 5. Maintenance and the Comfy-Org split (rigorous)

### 5.1 `jagenjo/litegraph.js` — effectively unmaintained
| Fact | Value | Source |
|---|---|---|
| Last commit on `master` | **2024-01-08T12:51:56Z** | [commits Atom feed](https://github.com/jagenjo/litegraph.js/commits/master.atom) (HEAD = `0555a2f2a3df5d4657593c6d45eb192359888195`) |
| Commits since | none (atom feed's newest entry is the same commit) | same |
| Last npm publish | **`litegraph.js@0.7.18`, 2024-01-08T12:53:03.092Z** (`dist-tags.latest = 0.7.18`; a stale `next = 1.0.0-5` from 2017-12-29) | [registry.npmjs.org/litegraph.js](https://registry.npmjs.org/litegraph.js) |
| Stars / open issues / closed issues | **8,134** / **128 open** / 207 closed | [repo page payload](https://github.com/jagenjo/litegraph.js) `"stargazerCount":8134`; [shields](https://img.shields.io/github/issues/jagenjo/litegraph.js.json) |
| Repo archived? | **No** — `"isArchived":false`, no "Public archive" banner | [repo page](https://github.com/jagenjo/litegraph.js) |
| License | MIT | [LICENSE](https://github.com/jagenjo/litegraph.js/blob/master/LICENSE) |
| Open PR count | **UNVERIFIED** (repo page payload shows an unlabelled `18`; I did not confirm what it counts) | — |

Independently corroborated by ComfyUI's own ADR: *"No upstream contributions to consider (original litegraph.js is no longer maintained)"* ([DEPS-LITEGRAPH-0001](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/docs/adr/DEPS-LITEGRAPH-0001-integrate-litegraph-into-the-frontend.md), dated 2025-08-05).

**Correction to a lead in the brief:** the jagenjo README does **not** point to Comfy-Org. The current [README.md](https://github.com/jagenjo/litegraph.js/blob/master/README.md) mentions ComfyUI only under *"Projects using it"*. Commit [`1bdc6b8fb8fbc1a1a11275ad4e4a1b3633f9e924`](https://github.com/jagenjo/litegraph.js/commit/1bdc6b8fb8fbc1a1a11275ad4e4a1b3633f9e924) is from **2018‑06‑07**, titled "Update README.md", and its entire diff adds 12 lines to `guides/README.md` (the "Define your Graph Node" section). **It has nothing to do with Comfy-Org.** (Verified from the commit patch.)

### 5.2 `Comfy-Org/litegraph.js` — archived fork, merged into the frontend
| Fact | Value | Source |
|---|---|---|
| Repo created | **2024-07-05T15:36:18Z** | [repo page](https://github.com/Comfy-Org/litegraph.js) payload `"createdAt"` |
| Stars / open issues | 253 / **1** (the pinned archive notice) | [repo page](https://github.com/Comfy-Org/litegraph.js), [shields](https://img.shields.io/github/issues/Comfy-Org/litegraph.js.json) |
| Last commit | **2025-08-06T04:26:49Z** (`ea0e1a8…`, "docs: Add archive notice to README") | [commits Atom feed](https://github.com/Comfy-Org/litegraph.js/commits/master.atom) |
| README title | **"⛔ ARCHIVED - Comfy-Org/litegraph.js has been merged into ComfyUI Frontend"** — *"This repository is archived and no longer maintained. The code has been integrated directly into the ComfyUI Frontend repository."* / *"As of August 5, 2025, Comfy-Org/litegraph.js is now part of the ComfyUI Frontend monorepo"* | [README.md](https://github.com/Comfy-Org/litegraph.js/blob/master/README.md) |
| Rewritten in TypeScript? | **Yes.** README: *"A TypeScript library to create graphs in the browser similar to Unreal Blueprints."*; the npm build script is `"build": "tsc && vite build"` and it ships 90 `.d.ts` files. Note the fork predates the TS rewrite in part: *"It is a fork of the original litegraph.js. Some APIs may by unchanged, however it is largely incompatible with the original."* | [README.md](https://github.com/Comfy-Org/litegraph.js/blob/master/README.md), [registry.npmjs.org/@comfyorg/litegraph](https://registry.npmjs.org/@comfyorg/litegraph) |

**The exact notice you remembered — issue #1196** ([link](https://github.com/Comfy-Org/litegraph.js/issues/1196)), title verbatim:

> **"The Comfy-Org fork of litegraph.js has been merged into the ComfyUI Frontend repository and is no longer maintained here."**

Metadata I extracted from the page: author **christian-byrne**, created **2025-08-06T03:24:24Z**, `updatedAt` 2025-08-06T03:24:28Z, `state: OPEN`, pinned, label `announcement`. Body (verbatim excerpts):

> "The **Comfy-Org fork of litegraph.js** (@comfyorg/litegraph) has been merged into the ComfyUI Frontend repository and is no longer maintained here."
> "### Important Note — This archival only affects the **Comfy-Org/litegraph.js fork**. The original litegraph.js repository remains separate and unaffected by this change."
> "🏠 **New Home**: https://github.com/Comfy-Org/ComfyUI_frontend"
> "📁 **Source Location**: `src/lib/litegraph/` (subject to change)"
> "📖 **Integration Details**: ADR-0001 … 🔄 **Merge PR**: ComfyUI_frontend#4667"
> "### For developers using @comfyorg/litegraph — The npm package `@comfyorg/litegraph` is deprecated; This fork was specifically maintained for ComfyUI and had no other known users; All ComfyUI-specific enhancements and fixes are now in the ComfyUI Frontend repository; Import paths have changed from `@comfyorg/litegraph` to `@/lib/litegraph` within ComfyUI"
> "### Repository Status — ✅ All git history has been preserved via git subtree merge; ✅ All open issues have been transferred to ComfyUI Frontend; ✅ A final release (v0.8.7) has been published marking the deprecation; 🚫 No new commits, issues, or PRs will be accepted here; 🚫 Open PRs (20) will need to be manually transferred"

**⚠️ Two discrepancies I verified and must flag:**
1. The issue says the final deprecation release was **v0.8.7**, but the npm registry shows the last published `@comfyorg/litegraph` version is **0.17.2 (2025-08-06T03:32:44.679Z)** — published ~8 minutes *after* the issue was filed. `0.8.7` does exist on npm but is an earlier release. The issue text's version number is wrong (or refers to something else); **the actual final npm version is 0.17.2** ([registry](https://registry.npmjs.org/@comfyorg/litegraph)). I could not determine which, so the "v0.8.7" wording is **UNVERIFIED/likely erroneous**.
2. The issue and README say *"The repository is archived"*, but as of 2026‑09‑13 the GitHub repo page reports `"isArchived":false` and shows **no** "Public archive"/"read-only" banner. The functional outcome is the same (no commits since 2025‑08‑06; "No new commits, issues, or PRs will be accepted here"), but **whether GitHub's archive flag is actually set is UNVERIFIED — it appears not to be.**

### 5.3 The npm package IS deprecated — exact notice
`https://registry.npmjs.org/@comfyorg/litegraph` → version `0.17.2` carries:

> `"deprecated": "Package no longer supported. Contact Support at https://www.npmjs.com/support for more info."`

Every published version from `0.7.14` onward carries a deprecation notice (290 versions total; latest `0.17.2`, published **2025-08-06T03:32:44.679Z**). `npm install @comfyorg/litegraph` prints: `npm warn deprecated @comfyorg/litegraph@0.17.2: Package no longer supported. Contact Support at https://www.npmjs.com/support for more info.` Package fields: `"license": "MIT"`, `"type": "module"`, `"main": "./dist/litegraph.umd.js"`, `"module": "./dist/litegraph.es.js"`, `"types": "./dist/litegraph.d.ts"`, `"files": ["dist"]`, and **no `sideEffects` field** ([registry](https://registry.npmjs.org/@comfyorg/litegraph); verified against the installed tarball).

### 5.4 What is the successor? (precise)
- **The live litegraph lineage is `Comfy-Org/ComfyUI_frontend` at `src/lib/litegraph/`, integrated by git subtree, with no independent semver.** The merge ADR is explicit about the trade-off: *"**Loss of versioning**: No more semantic versioning for litegraph changes"* and *"The original litegraph repository will be archived after the merge. Future litegraph improvements will be made directly in the frontend repository."* ([DEPS-LITEGRAPH-0001](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/docs/adr/DEPS-LITEGRAPH-0001-integrate-litegraph-into-the-frontend.md), Date: 2025-08-05, Status: Accepted). The copy's own README says *"This library is included as a git subtree in the ComfyUI frontend project at src/lib/litegraph"* and *"It is a fork of the original litegraph.js. Some APIs may by unchanged, however it is largely incompatible with the original."* ([src/lib/litegraph README](https://raw.githubusercontent.com/Comfy-Org/ComfyUI_frontend/main/src/lib/litegraph/README.md)).
- **There is NO published npm successor for litegraph proper.** I checked: `@comfyorg/litegraph-frontend` → **404 not found**; `@comfyui-frontend` → registry responds **HTTP 405** (not a usable package); `@comfyorg/design-system` → exists (latest 1.1.0, created 2026‑07‑30, repo `Comfy-Org/ComfyUI_frontend`) but it is *"Shared design system for ComfyUI Frontend"*, i.e. UI components, **not** litegraph; `@comfyorg/comfyui-frontend-types` → exists (latest 1.55.7, 545 versions, repo `Comfy-Org/ComfyUI_frontend`) but it is *"TypeScript definitions for @comfyorg/comfyui-frontend"*, i.e. types for the app, **not** a litegraph build ([registry](https://registry.npmjs.org/@comfyorg/design-system), [registry](https://registry.npmjs.org/@comfyorg/comfyui-frontend-types)).
- **So for a NEW project in 2026 there are exactly three real options**, all with costs: (a) depend on `litegraph.js@0.7.18` from npm (frozen since 2024‑01, no TS-first source, UMD-only, wrong `.d.ts` in places — see §6) and expect to vendor/patch it; (b) copy `src/lib/litegraph/` out of `ComfyUI_frontend` (MIT) into your repo and own it (this is what ComfyUI itself does; you get TypeScript + the perf fixes, but you inherit a large, ComfyUI-coupled codebase whose compatibility surface is explicitly *"largely incompatible with the original"*); or (c) use a different graph engine. **I found no evidence of any maintained standalone npm drop-in replacement for litegraph in either lineage** (that absence is itself the finding).
- The frontend repo itself is very much alive: **2,008 stars**, last commit *"today"* per shields, created 2024‑06‑13 ([repo](https://github.com/Comfy-Org/ComfyUI_frontend), [shields last-commit](https://img.shields.io/github/last-commit/Comfy-Org/ComfyUI_frontend.json)). ComfyUI core is at 132,903 stars ([repo](https://github.com/comfyanonymous/ComfyUI)).

---

## 6. TypeScript types

### 6.1 Original `litegraph.js` — ships a hand-written `.d.ts`, useful but incomplete and partly wrong
- `package.json` declares `"types": "src/litegraph.d.ts"` and `"files": ["build", "css/litegraph.css", "src/litegraph.d.ts"]` — so the `.d.ts` **is** in the npm tarball ([registry](https://registry.npmjs.org/litegraph.js); verified in the installed package; the public file is readable at [unpkg](https://unpkg.com/litegraph.js@0.7.18/src/litegraph.d.ts)).
- It is a **single 1,499-line file** declaring ~199 methods, covering `LiteGraph`, `LGraph`, `LGraphNode`, `LGraphCanvas`, `LLink`, widgets, slot interfaces and `serializedLGraph`. `drawNode`, `drawNodeShape`, `computeVisibleNodes`, `drawFrontCanvas`, `drawBackCanvas`, `startRendering`, `stopRendering`, `drawNodeWidgets` are all declared (lines 1308–1417 of the file).
- **It is demonstrably wrong about the two hooks you care about most.** The `.d.ts` declares ([unpkg L917-L926](https://unpkg.com/litegraph.js@0.7.18/src/litegraph.d.ts)):
  ```ts
  onDrawBackground?(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void;
  onDrawForeground?(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void;
  ```
  but the runtime passes **three** arguments for `onDrawForeground` — `(ctx, LGraphCanvas, HTMLCanvasElement)` ([L8641-L8643](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8641)) — and **four** for `onDrawBackground` — `(ctx, LGraphCanvas, HTMLCanvasElement, graph_mouse)` ([L9105-L9107](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9105)). With `strict` TypeScript you will write handlers against the wrong parameter list; the second parameter is the **canvas controller**, not the DOM element.
- **Declared nowhere in the `.d.ts`** (verified by grep over the whole file): `onDrawTitle`, `onDrawTitleBar`, `onDrawTitleText`, `onDrawTitleBox`, `onDrawCollapsed`, `onBounding`, `onDrawn` (nonexistent anyway). Since the report's plan is custom title/symbol rendering, this matters: you will need module augmentation or `// @ts-expect-error` for several hooks.
- No `module`/`exports`/`sideEffects` fields in `package.json` — it is a UMD/CJS artifact only (`main: build/litegraph.js`), so modern bundlers cannot tree-shake it (§8).

### 6.2 Comfy-Org fork — genuinely TypeScript, but only as vendored source
- The source is TS: the package builds with `tsc && vite build`, and `ComfyUI_frontend/src/lib/litegraph/src/` contains `LGraphCanvas.ts` (9,107 lines), `LGraphNode.ts` (4,543), `LGraph.ts` (3,676), `LiteGraphGlobal.ts` (1,011), `interfaces.ts`, `CanvasPointer.ts`, `Reroute.ts`, `subgraph/`, `node/`, `types/`, `canvas/`, plus a large co-located test suite (`LGraphCanvas.invalidation.test.ts`, `LGraphCanvas.linkVisibility.test.ts`, `geometryApiContracts.test.ts`, …). The published tarball ships **90 `.d.ts` files** (e.g. `dist/LGraphCanvas.d.ts`, `dist/LGraphNode.d.ts`, `dist/node/NodeInputSlot.d.ts`, `dist/types/globalEnums.d.ts`).
- Typing quality is high (mapped types, generics like `addInput<TProperties extends Partial<INodeInputSlot>>`, documented `@link` references, runtime-checked enums such as `RenderShape`/`LinkDirection`/`NodeSlotType`).
- **But you cannot get this from npm as a supported dependency**: the npm package is deprecated, and the maintained copy is an internal subtree with no versioning. First-class TS is available only by vendoring `src/lib/litegraph/` from the frontend repo (or by writing your own `.d.ts` around the old build).

---

## 7. License

**MIT for both lineages** — verified from the actual LICENSE files, which are byte-for-byte the same MIT text beginning `Copyright (C) 2013 by Javi Agenjo`:
- [jagenjo/litegraph.js LICENSE](https://github.com/jagenjo/litegraph.js/blob/master/LICENSE) (19 lines, MIT).
- [Comfy-Org/litegraph.js LICENSE](https://github.com/Comfy-Org/litegraph.js/blob/master/LICENSE) — same text.
- npm metadata: `"license": "MIT"` for both `litegraph.js@0.7.18` and `@comfyorg/litegraph@0.17.2` ([registry](https://registry.npmjs.org/litegraph.js), [registry](https://registry.npmjs.org/@comfyorg/litegraph)); GitHub reports `spdxId: "MIT"` for the jagenjo repo.
- The vendored copy in the frontend carries its own `LICENSE` at `src/lib/litegraph/LICENSE` ([tree](https://github.com/Comfy-Org/ComfyUI_frontend/tree/main/src/lib/litegraph)).
- The ComfyUI_frontend **application** license is a separate question and is not covered here.

---

## 8. Bundle size, minified + gzip

**Method (measured by me on 2026-09-13, not copied from any published source).** In `/tmp/lgmeasure`: `npm init -y`, added `"allowScripts": {}`, then

```
env -u npm_config_allow_scripts npm install --no-audit --no-fund --ignore-scripts litegraph.js @comfyorg/litegraph esbuild
```

which installed `litegraph.js@0.7.18`, `@comfyorg/litegraph@0.17.2`, `esbuild@0.28.2` (Node v22.23.2, gzip 1.14). Entry files were `import * as LG from "<pkg>"; console.log(LG);` (namespace import so nothing is trivially dead-code-eliminated), bundled with:

```
./node_modules/.bin/esbuild entry.js --bundle --minify --format=esm --target=es2020 --legal-comments=none --outfile=out.js
gzip -9 -c out.js | wc -c
```

| Package / entry resolved | Minified (bytes) | **Minified + gzip ‑9 (bytes)** |
|---|---|---|
| `litegraph.js@0.7.18` → `build/litegraph.js` (UMD, 1,074,483 B source) | 501,813 | **123,129** |
| `@comfyorg/litegraph@0.17.2` → `dist/litegraph.es.js` (ESM, 619,240 B source) | 297,277 | **87,665** |

esbuild `--metafile` confirms exactly one library input per bundle (`build/litegraph.js` = 1,074,483 B; `dist/litegraph.es.js` = 619,240 B), so these are whole-library numbers, not partial.

Raw shipped artifacts for reference (same method, `gzip -9`):

| File | Raw (bytes) | gzip ‑9 (bytes) |
|---|---|---|
| `litegraph.js/build/litegraph.js` (UMD, unminified) | 1,074,483 | 197,345 |
| `litegraph.js/build/litegraph.min.js` | 491,365 | 122,399 |
| `litegraph.js/build/litegraph.core.js` (dependency-free subset) | 493,273 | 92,445 |
| `@comfyorg/litegraph/dist/litegraph.umd.js` | 402,538 | 97,617 |
| `@comfyorg/litegraph/dist/litegraph.es.js` | 619,240 | 137,719 |

**Caveats, stated honestly:** `litegraph.js` is CJS/UMD with no `module`/`exports`/`sideEffects`, so a bundler cannot shake it — 123 KB gzip is essentially the floor for that package. `@comfyorg/litegraph` has no `sideEffects` field either, so its 87.7 KB is what you get without hand-tuned shaking. **Published third-party numbers: UNVERIFIED** — bundlephobia returned `429 Too Many Requests` for both packages on 2026‑09‑13, so I have no independent published figure to compare against. Note the npm `unpackedSize` fields are *not* bundle sizes: 3,195,726 B for `litegraph.js@0.7.18` and 3,781,726 B for `@comfyorg/litegraph@0.17.2` ([registry](https://registry.npmjs.org/litegraph.js), [registry](https://registry.npmjs.org/@comfyorg/litegraph)).

---

## 9. Downsides and risks for a serious application

1. **Documentation is thin, partly stale, and partly wrong.** The wiki has four pages and **no** `LGraphCanvas` page at all. The API reference is generated YUIDoc HTML checked into `doc/` (45 documented `LGraphCanvas` members, [doc/classes/LGraphCanvas.html](https://github.com/jagenjo/litegraph.js/blob/master/doc/classes/LGraphCanvas.html)) and is not obviously regenerated against the current source. The richest prose doc is `guides/README.md` (344 lines) — and even it contains a real error: its `onDrawForeground` example sets `ctx.fillColor = "black"` (not a Canvas2D property; should be `fillStyle`), which silently draws nothing ([guides/README.md](https://github.com/jagenjo/litegraph.js/blob/master/guides/README.md)). The wiki also documents `extra_info` as containing `direction: "input"|"output"` ([wiki](https://github.com/jagenjo/litegraph.js/wiki/Creating-custom-Nodes)) — **that key is used nowhere in the source** (grep for `.direction` → 0 hits).
2. **API stability is a dead end, split two ways.** The original is frozen at `0.7.18` (2024‑01‑08, 128 open issues, no commits since). The maintained fork is *"largely incompatible with the original"* ([README](https://github.com/Comfy-Org/litegraph.js/blob/master/README.md)) — e.g. `onDrawBackground` lost three of its four arguments ([fork L5936](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/lib/litegraph/src/LGraphCanvas.ts#L5936) vs [original L9106](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9106)) — and it is *unversioned* by design: *"**Loss of versioning**: No more semantic versioning for litegraph changes"* ([ADR](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/docs/adr/DEPS-LITEGRAPH-0001-integrate-litegraph-into-the-frontend.md)). Choosing litegraph means choosing to own a fork.
3. **It is a self-contained canvas widget, not an editor framework.** `LGraphCanvas` spans **8,033 of the 14,424 lines (~56%)** with **88 prototype members** (vs 73 for `LGraphNode`, 54 for `LGraph`), and it owns hit-testing and input plumbing (`processMouseDown/Move/Up/Wheel`, `processKey`, `adjustMouseEvent`, `bindEvents`), context menus (`processContextMenu`, `showConnectionMenu`, `showShowNodePanel`), the search box (`showSearchBox`), clipboard (`copyToClipboard`/`pasteFromClipboard`), file drop (`processDrop`), subgraph navigation (`_graph_stack`, `openSubgraph`/`closeSubgraph`), widget interaction (`processNodeWidgets`) and the draw loop. There is **no undo/redo**: only hooks `LGraph.beforeChange` / `afterChange` that fire `onBeforeChange`/`onAfterChange` callbacks ([L2089-L2100](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L2089)) — the comment says *"used for undo, called before any change is made to the graph"*, i.e. undo is *your* problem (ComfyUI_frontend built its own). Expect to fight the controller rather than compose with it.
4. **Global singleton state everywhere.** `var LiteGraph = (global.LiteGraph = { ... })` — one mutable object holding `registered_node_types`, `Nodes`, `Globals`, `MAX_NUMBER_OF_NODES`, `allow_multi_output_for_events`, `use_uuids`, `auto_load_slot_types`, `debug`, etc. ([L14](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L14), [L49-L139](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L49)); the exported module is `exports.LiteGraph = this.LiteGraph` ([L14415](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L14415)). Node *types* are strings in a global registry, and class statics (`MyNode.color`, `title_color`, `shape`) are read at draw time. Multiple editors/document instances in one page (e.g. two Modelica models side by side) share one registry and one set of global flags; the fork keeps the same shape (`class LiteGraphGlobal` instantiated as a module-level singleton, [LiteGraphGlobal.ts L49](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/lib/litegraph/src/LiteGraphGlobal.ts#L49)).
5. **No formal plugin/extension system.** The nearest things are `LiteGraph.onNodeTypeRegistered` / `onNodeTypeReplaced` callbacks ([L233-L238](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L233)), monkey-patching `LGraphCanvas.prototype`, and (in ComfyUI) a *frontend-level* extension API that lives outside litegraph. The fork's ADR RENDERING-INVALIDATION-0021 explicitly notes that *"extensions depend on prompt redraws and may wrap or call existing `setDirty` methods"* and that the legacy `setDirty` surface must be preserved for them — i.e. extension compatibility is maintained by convention, not by contract.
6. **Serialization format.** Versioned JSON: `{ last_node_id, last_link_id, nodes: [...], links: [[id, origin_id, origin_slot, target_id, target_slot, type], ...], groups: [...], config, extra, version }` ([L2185-L2225](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L2185)); nodes carry `{id, type, pos, size, flags, order, mode, inputs, outputs, title?, properties?, widgets_values?, color?, bgcolor?}` ([L2625-L2680](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L2625)). Practical consequences: node *type* is a global-registry string, so renaming a node type breaks every saved file unless you migrate; widget values are a **positional array** (`widgets_values`), so reordering widgets corrupts saved data unless you version it; only `properties` is semantically typed. The fork extends this with `floatingLinks`, subgraph definitions and slot IDs ([types/serialisation.d.ts](https://unpkg.com/@comfyorg/litegraph@0.17.2/dist/types/serialisation.d.ts)) and is **not** wire-compatible with the original in general.
7. **A design mismatch worth naming for ACASUAL work:** the built-in runtime is a directed, pull-based, execute-in-order graph (`getInputData`/`setOutputData`, `runStep`, node `mode` = ALWAYS/ON_EVENT/NEVER/ON_TRIGGER, per-slot `EVENT`/`ACTION` typing at [L65-L73](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L65)). If you adopt litegraph for a conservation-law/bond-graph editor you will use it as a **diagram editor + link store** and write your own solver over `graph.links`; you get the editor for free and must treat the execution engine as unused baggage (which is also the bulk of the code you ship — see §8).

---

## Bottom line

- **Rendering (asks 1–2): fully workable.** Canvas 2D, a two-canvas rAF loop (`startRendering` → `draw()` → `drawFrontCanvas`/`drawBackCanvas`, [L5881](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L5881), [L7814](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L7814)), per-node `onDrawBackground`/`onDrawForeground` hooks with a documented `(0,0)`-at-content-origin contract ([L9105](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L9105), [L8641](https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js#L8641), [guides/README.md](https://github.com/jagenjo/litegraph.js/blob/master/guides/README.md)). Drawing an arbitrary resistor/capacitor symbol is straightforward and fully supported. **`onDrawn` does not exist** — do not design around it.
- **Ports (ask 3): the blocker is directional, not cosmetic.** Inputs hold exactly one link, outputs hold many, and there is no undirected slot or link concept anywhere in either lineage. A bidirectional terminal must be modelled as an input+output pair, and a "net" as an N-input junction node; the solver must run on `graph.links` (which *does* store both endpoints) rather than on litegraph's pull-based execution.
- **Performance (ask 4): ~500 visible nodes is the demonstrated ceiling in ComfyUI's own product** (541-node verified workflow: ~12–35 FPS zoomed out vs 25–70 FPS with 30 nodes visible, [issue #3180](https://github.com/Comfy-Org/ComfyUI_frontend/issues/3180)); culling is real and effective; the fork raised the hard cap to 10,000 nodes; and ComfyUI is actively rewriting node rendering in Vue precisely because the canvas approach became a bottleneck — while admitting it is *"still optimizing toward Canvas-level performance"* ([docs](https://docs.comfy.org/interface/nodes-2)).
- **Maintenance (ask 5): the single most important finding.** `jagenjo/litegraph.js` is unmaintained since 2024‑01‑08 (128 open issues, README does **not** point to Comfy-Org — the cited commit is unrelated). `Comfy-Org/litegraph.js` was created 2024‑07‑05, its README is titled "⛔ ARCHIVED", issue [#1196](https://github.com/Comfy-Org/litegraph.js/issues/1196) (2025‑08‑06) announces the merge into `ComfyUI_frontend` via git subtree and says no commits/issues/PRs will be accepted, the npm package `@comfyorg/litegraph` **is deprecated** (last version 0.17.2, 2025‑08‑06; every version from 0.7.14 has a deprecation notice), and **no successor npm package exists** — the code now lives unversioned at `ComfyUI_frontend/src/lib/litegraph/` (MIT, TypeScript).
- **Types/license/size (asks 6–8):** MIT for both; the original ships a `.d.ts` that is in the tarball but has **wrong signatures** for `onDrawBackground`/`onDrawForeground` and omits all title/bounding hooks; the fork is genuinely TypeScript but only obtainable by vendoring. Measured bundles: **123,129 B** gzip for `litegraph.js@0.7.18` (UMD, unshakeable) and **87,665 B** gzip for `@comfyorg/litegraph@0.17.2` (ESM); published bundlephobia figures UNVERIFIED (HTTP 429).
- **Practical recommendation (mine, not a source claim):** if you adopt litegraph in 2026, plan to **vendor** either `ComfyUI_frontend/src/lib/litegraph/` (TypeScript, active, ComfyUI-coupled, unversioned) or the frozen `litegraph.js@0.7.18` (MIT, tiny API surface, unmaintained, needs your own `.d.ts` patches). Do **not** plan on `@comfyorg/litegraph` from npm, and do **not** expect upstream fixes, semver, or an undirected link model.

---

## Citations

1. https://github.com/jagenjo/litegraph.js — repo page (8,134 stars, 128 open issues, not archived, MIT).
2. https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.js — pinned source, 14,424 lines (all `#L` citations above).
3. https://github.com/jagenjo/litegraph.js/blob/master/README.md — Canvas2D, "hundreds of nodes", install, ComfyUI listed under "Projects using it".
4. https://github.com/jagenjo/litegraph.js/blob/master/guides/README.md — node settings, slots (`link` vs `links`), Custom Node Appearance/`(0,0)` contract, `title_color`/`shape`, `ctx.fillColor` doc bug.
5. https://github.com/jagenjo/litegraph.js/wiki/Home
6. https://github.com/jagenjo/litegraph.js/wiki/First-Project
7. https://github.com/jagenjo/litegraph.js/wiki/Creating-custom-Nodes — `addInput`/`addOutput`, "an input can only have one connection link while outputs could have several", draw callbacks, `extra_info`.
8. https://github.com/jagenjo/litegraph.js/wiki/Node-types
9. https://github.com/jagenjo/litegraph.js/blob/master/doc/classes/LGraphCanvas.html — generated API docs (45 members).
10. https://github.com/jagenjo/litegraph.js/blob/master/src/litegraph.d.ts and https://unpkg.com/litegraph.js@0.7.18/src/litegraph.d.ts — shipped typings, 1,499 lines, wrong draw-hook signatures.
11. https://github.com/jagenjo/litegraph.js/blob/master/LICENSE — MIT.
12. https://github.com/jagenjo/litegraph.js/commit/1bdc6b8fb8fbc1a1a11275ad4e4a1b3633f9e924 (+ `.patch`) — 2018-06-07, edits only `guides/README.md`; unrelated to Comfy-Org.
13. https://github.com/jagenjo/litegraph.js/commits/master.atom — HEAD `0555a2f…`, last commit 2024-01-08T12:51:56Z.
14. https://registry.npmjs.org/litegraph.js — `latest = 0.7.18` (2024-01-08T12:53:03.092Z), `types: src/litegraph.d.ts`, `unpackedSize` 3,195,726, `files` list.
15. https://github.com/Comfy-Org/litegraph.js — repo page (created 2024-07-05T15:36:18Z, 253 stars, 1 open issue, `isArchived:false`, no archive banner).
16. https://github.com/Comfy-Org/litegraph.js/blob/master/README.md — "⛔ ARCHIVED…", new location, merge details, "largely incompatible with the original".
17. https://github.com/Comfy-Org/litegraph.js/blob/master/LICENSE — MIT (same text as jagenjo).
18. https://github.com/Comfy-Org/litegraph.js/commits/master.atom — HEAD `ea0e1a8…`, last commit 2025-08-06T04:26:49Z.
19. https://github.com/Comfy-Org/litegraph.js/issues/1196 — the archive/merge announcement (2025-08-06T03:24:24Z, christian-byrne), full body quoted in §5.2.
20. https://registry.npmjs.org/@comfyorg/litegraph — deprecation string, last version 0.17.2 (2025-08-06T03:32:44.679Z), 290 versions, package fields.
21. https://unpkg.com/@comfyorg/litegraph@0.17.2/dist/LGraphNode.d.ts — fork hook signatures.
22. https://unpkg.com/@comfyorg/litegraph@0.17.2/dist/node/NodeInputSlot.d.ts and https://unpkg.com/@comfyorg/litegraph@0.17.2/dist/node/NodeOutputSlot.d.ts — `link` vs `links`.
23. https://unpkg.com/@comfyorg/litegraph@0.17.2/dist/types/globalEnums.d.ts — `RenderShape`, `LinkDirection`, `NodeSlotType`.
24. https://unpkg.com/@comfyorg/litegraph@0.17.2/dist/types/serialisation.d.ts — `ISerialisedGraph`, `ExportedSubgraph`.
25. https://github.com/Comfy-Org/ComfyUI_frontend — live repo (2,008 stars, created 2024-06-13).
26. https://github.com/Comfy-Org/ComfyUI_frontend/tree/main/src/lib/litegraph — current home of the litegraph fork (git subtree).
27. https://raw.githubusercontent.com/Comfy-Org/ComfyUI_frontend/main/src/lib/litegraph/README.md — "included as a git subtree… largely incompatible with the original".
28. https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/lib/litegraph/src/LGraphCanvas.ts — fork draw loop, `computeVisibleNodes`, hook call sites, `drawConnections`.
29. https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/lib/litegraph/src/LGraphNode.ts — `connectSlots`, `connectInputToOutput`, shapes, hook declarations.
30. https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/lib/litegraph/src/LGraph.ts — node cap enforcement.
31. https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/lib/litegraph/src/LiteGraphGlobal.ts — `NODE_DEFAULT_COLOR`, `MAX_NUMBER_OF_NODES = 10_000`.
32. https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/lib/litegraph/API.md — CanvasPointer API note.
33. https://github.com/Comfy-Org/ComfyUI_frontend/tree/main/docs/adr — ADR index (incl. `DEPS-LITEGRAPH-0001`, `RENDERING-ATOMICITY-0020`, `RENDERING-INVALIDATION-0021`).
34. https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/docs/adr/DEPS-LITEGRAPH-0001-integrate-litegraph-into-the-frontend.md — Date 2025-08-05, Accepted; "original litegraph.js is no longer maintained"; "Loss of versioning".
35. https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/docs/adr/RENDERING-INVALIDATION-0021-classified-frame-coalesced-canvas-invalidation.md — Date 2026-08-26, Proposed; canvas dirty-flag problems.
36. https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/docs/adr/RENDERING-ATOMICITY-0020-frame-atomic-rendering.md — Date 2026-08-26, Proposed; imperative draw traversal costs.
37. https://github.com/Comfy-Org/ComfyUI_frontend/pull/4667 — "Merge ComfyUI_frontend and litegraph.js".
38. https://docs.comfy.org/interface/nodes-2 (+ machine-readable https://docs.comfy.org/interface/nodes-2.md) — Nodes 2.0: Canvas → Vue, "still optimizing toward Canvas-level performance", toggle back.
39. https://github.com/Comfy-Org/ComfyUI_frontend/issues/3180 — 541-node workflow, measured FPS at 541 vs 30 visible nodes; maintainer's "1000+ nodes" claim + attached 662-node file.
40. https://github.com/user-attachments/files/19371284/HUN.ULTRA.1.4.json — 541 nodes / 1,530 links / 50 groups / 663,644 B (counted by me).
41. https://github.com/user-attachments/files/19406336/AP.Workflow.10.0.for.ComfyUI.json — 662 nodes / 881 links / 132 types / 917,252 B (counted by me).
42. https://github.com/Comfy-Org/ComfyUI_frontend/issues/6601 — Chrome 142 regression, "~100 nodes … <20 fps".
43. https://github.com/Comfy-Org/ComfyUI_frontend/issues/15679 — "Large workflows can contain 500 or more nodes… O(total nodes)".
44. https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/browser_tests/assets/large-graph-workflow.json — 245 nodes / 294 links (counted by me).
45. https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/browser_tests/tests/performance.spec.ts — "at scale (245 nodes)", "80 interior nodes … this is the bottleneck we're measuring", DOM-node assertion of 100.
46. https://github.com/Comfy-Org/ComfyUI_frontend/tree/main/src/renderer/extensions/vueNodes and .../src/renderer/core/canvas — Nodes 2.0 implementation location.
47. https://registry.npmjs.org/@comfyorg/design-system — "Shared design system for ComfyUI Frontend" (not litegraph).
48. https://registry.npmjs.org/@comfyorg/comfyui-frontend-types — "TypeScript definitions for @comfyorg/comfyui-frontend" (not litegraph).
49. https://img.shields.io/github/stars/jagenjo/litegraph.js.json, .../issues/jagenjo/litegraph.js.json, .../issues-closed/jagenjo/litegraph.js.json, .../last-commit/jagenjo/litegraph.js.json, .../stars/Comfy-Org/litegraph.js.json, .../issues/Comfy-Org/litegraph.js.json, .../stars/Comfy-Org/ComfyUI_frontend.json, .../last-commit/Comfy-Org/ComfyUI_frontend.json — badge JSON used for counts.
50. https://github.com/comfyanonymous/ComfyUI — 132,903 stars (repo payload).
