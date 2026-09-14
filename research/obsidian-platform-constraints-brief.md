# Obsidian Plugin Platform — Technical Constraints Brief

**Scope:** feasibility of an Obsidian community plugin that (a) drives an external simulation engine and (b) renders a high-performance interactive node/block editor.

**Evidence tiers used below:**
- **[PRIMARY]** — read out of the shipped Obsidian binary/bundle on this machine (Flatpak `md.obsidian.Obsidian`, app **1.13.7**), or from official docs/repos.
- **[EMPIRICAL]** — measured by running Electron locally with Obsidian's *verbatim* `webPreferences` + CSP.
- **[COMMUNITY]** — credible third-party report.
- **[UNVERIFIED]** — could not confirm from a primary source.

Date of research: 2026-09. Latest Obsidian desktop at time of writing: **1.14.1** (2026-09-08); locally inspected: **1.13.7**.

---

## TL;DR — the four decisions that matter

| # | Question | Answer |
|---|---|---|
| 1 | Spawn an external process? | **Yes on desktop.** No official API; use `require('child_process')`. Blocked on mobile. |
| 2 | Is the runtime capable? | **Yes, generously.** Electron 43.3.0 / Chromium 150 / Node 24.18.1, `nodeIntegration` on, SAB explicitly force-enabled. |
| 3 | Can I ship a `.wasm` / `.node` / exe? | **No — assets are not distributed.** Only `main.js` + `manifest.json` + `styles.css` are ever downloaded. **Inline WASM as base64/binary into `main.js`.** |
| 4 | Workers / CSP blocking? | **Nothing blocks.** The only CSP directive is `style-src`. Blob workers, `eval`, and WASM all work. |

---

## 1. Process spawning

**Verdict: works on desktop, no official API, impossible on mobile.**

- **No official Obsidian API for shelling out. [PRIMARY]** `obsidian.d.ts` (8498 lines) has no exec/spawn/shell/child_process method. The only `exec` is `Editor.exec(command: EditorCommandName)` — an editor-command dispatcher (undo/redo), unrelated to processes.
- **Official docs implicitly assume plugins spawn subprocesses. [PRIMARY]** The `MarkdownPostProcessor` doc comment in `obsidian.d.ts` reads: *"If your post processor requires lifecycle management, for example, to clear an interval, **kill a subprocess**, etc when this element is removed from the app, look into `MarkdownPostProcessorContext.addChild`."*
- **Official help doc concedes full capability. [PRIMARY]** `help.obsidian.md/plugin-security`: *"Due to technical limitations, Obsidian cannot reliably restrict plugins to specific permissions or access levels... Community plugins can access files on your computer. Community plugins can connect to internet. **Community plugins can install additional programs.**"*
- **Working, officially-listed examples:**
  - **Templater** v2.25.0 (in `community-plugins.json`) — `src/core/functions/user_functions/UserSystemFunctions.ts`: `const { exec } = require("child_process"); this.exec_promise = promisify(exec);` guarded by `Platform.isMobile` + `FileSystemAdapter` checks. `manifest.json` has `"isDesktopOnly": false`.
  - **Agent Client** v0.12.1 (in `community-plugins.json`) — `src/acp/terminal-handler.ts`: `import { spawn, ChildProcess, SpawnOptions } from "child_process"`, full spawn/kill/env/cwd handling. `manifest.json` has `"isDesktopOnly": true`.
- **Why `require` works at runtime: [PRIMARY]** The official sample plugin's `esbuild.config.mjs` lists `...builtinModules` in `external`, so Node built-ins are *not* bundled — they stay as runtime `require()` calls resolved by Electron.
- **Empirically confirmed [EMPIRICAL]:** in a renderer configured with Obsidian's exact `webPreferences`, `require('child_process').spawn` is a function; `fs`, `path`, `worker_threads`, `os` all load.
- **Mobile: [PRIMARY]** Official *Mobile development* doc: *"The Node.js API, and the Electron API aren't available on mobile devices. Any calls to these libraries made by your plugin or it's dependencies can cause your plugin to crash."* → A simulation-engine plugin is desktop-only in practice.

**Consensus:** the community treats `child_process` as legitimate and normal on desktop. It is not sandboxed, not gated, and not flagged by automated review — but per policy you **must** set `isDesktopOnly: true` (§3).

---

## 2. Node.js / Electron API access

**Obsidian's actual main-window `webPreferences`, verbatim from the shipped bundle: [PRIMARY]**

```js
webPreferences: {
  contextIsolation: !1,        // false
  nodeIntegration: !0,         // true
  nodeIntegrationInWorker: !0, // true  <-- notable
  spellcheck: !0,
  webviewTag: !0,
  affinity: "main-window",
  devTools: he.devTools
}
```

Consequences:
- Plugin code runs in the renderer with **`nodeIntegration: true` and `contextIsolation: false`** → unrestricted `require()` of Node built-ins: `fs`, `path`, `child_process`, `worker_threads`, `os`, `crypto`, etc.
- **`nodeIntegrationInWorker: true`** → Web Workers created by plugin code **also get `require()`**. Empirically confirmed: `require('child_process').spawn` is available *inside a blob worker*.
- (`<webview>` tags are separately locked down via `will-attach-webview` → `nodeIntegration=false`, `sandbox=true`; this does **not** apply to plugin code.)

**Runtime versions — two independent primary confirmations:**

| Component | Version |
|---|---|
| Electron | **43.3.0** |
| Chromium | **150.0.7871.212** |
| Node.js | **24.18.1** |
| V8 | 15.0.245.23 |

1. Strings in the shipped `obsidian` binary: `Electron/43.3.0`, `Chrome/150.0.7871.212`.
2. Official changelog, 1.13.6 Desktop → **Developers**: *"The installer has been updated to use **Electron v43.3.0**. To upgrade, install visit the Obsidian download page and reinstall Obsidian."* (1.13.4 had Electron v43.1.1.)
3. Cross-checked against `releases.electronjs.org/release/v43.3.0`: Electron 43.3.0 = Chromium 150.0.7871.212, Node 24.18.1, V8 15.0.245.23 — exact match.

> **Caveat:** Electron version tracks the **installer**, not the app update. A user on an older installer keeps an older Electron until they reinstall. Your `minAppVersion` does not pin Electron.

**Feature support on Chromium 150 / Obsidian 1.13.7:**

| Feature | Status | Evidence |
|---|---|---|
| WebAssembly (core) | **Yes** | [EMPIRICAL] instantiate OK |
| WebAssembly SIMD | **Yes** | [EMPIRICAL] `WebAssembly.validate`=true and an executed SIMD module returned the correct lane value (`f()=7`). Stable in Chromium since 91. |
| WebAssembly threads / shared memory | **Yes** | [EMPIRICAL] `new WebAssembly.Memory({initial:1,maximum:2,shared:true})` = OK |
| `SharedArrayBuffer` | **Yes — explicitly force-enabled by Obsidian** | See below |
| OffscreenCanvas | **Yes** | [EMPIRICAL] 2D context OK; Obsidian's own bundle references it 16× |
| WebGPU | **API present; adapter untested** | [EMPIRICAL] `navigator.gpu` present, but `requestAdapter()` returned `null` in this GPU-less VM. [UNVERIFIED] on real GPU hardware. |

**SharedArrayBuffer — the important detail [PRIMARY].** Obsidian does **not** rely on cross-origin isolation. At startup it runs:

```js
let A = ["SharedArrayBuffer"];
for (let o of process.argv)
  o.startsWith("--enable-features=") && (A = A.concat(o.substring(18).split(",").map(r => r.trim())));
l.app.commandLine.appendSwitch("enable-features", A.join(","));
```

Corroborated by Obsidian's own graph view, which feature-detects it in a worker with an ArrayBuffer-transfer fallback:

```js
if (self.SharedArrayBuffer) try { new SharedArrayBuffer(1); m = !0 } catch(A) {}
```

And empirically: `new SharedArrayBuffer(8)` succeeds in the renderer **while `self.crossOriginIsolated === false`**, and also succeeds inside a blob worker. So SAB-based zero-copy simulation state sharing between main thread and worker is viable.

---

## 3. Plugin packaging — hard rules

### `manifest.json` required fields [PRIMARY: official Manifest reference]

Common: `author`, `minAppVersion`, `name`, `version` (all **required**); optional `authorUrl`, `fundingUrl`.
Plugin-specific: `description`, `id`, `isDesktopOnly` (all **required**).

- `version` — Semantic Versioning, **`x.y.z` only**; must equal the GitHub release tag **and** release name.
- `id` — lowercase letters and hyphens only, **cannot end with `plugin`**, **cannot contain `obsidian`**, must be unique across all published plugins; for local dev it should equal the plugin folder name.
- `name` — unique; no punctuation beyond hyphen/plus/parenthesis; no emoji; may not contain "Obsidian", "Plugin", or core-plugin names ("Canvas", "Bases", "Live Preview").
- `description` — ≤ 250 chars, ends with `.`, no emoji, sentence case.
- `minAppVersion` — must be the true minimum; "if you don't know, use the latest stable build number."
- `isDesktopOnly` — **"If your plugin uses any of these APIs [Node.js/Electron], you must set `isDesktopOnly` to `true`."** When `true`, mobile shows an "unsupported" warning and the install button is blocked (`!rd.isDesktopApp && u.isDesktopOnly` in the shipped bundle).

> **Flag:** Templater uses `child_process` with `isDesktopOnly: false` — it guards at runtime instead. That is a grandfathered, extremely popular plugin, **not** a pattern to copy. Both newer plugins that shell out (Agent Client, Radial Timeline) correctly use `isDesktopOnly: true`.

### `main.js` — single CommonJS bundle

- The release asset is literally one file named `main.js`. Official sample esbuild config: `bundle: true`, `format: 'cjs'`, `outfile: 'main.js'`, `target: 'es2021'`.
- `target` must be ≥ `es2020` if any dependency uses `import.meta` (esbuild warns `"import.meta" is not available in the configured target environment`). Common workaround: `define: { 'import.meta.url': '"obsidian-plugin"' }`.
- Ship the **production** build — official guidance: minify, keep `onload` trivial, don't do heavy work in view constructors.
- No dynamic `require` of external files is prohibited *by the API*, but it is **fatal in practice** because those files never arrive (§4).

### Automated review [PRIMARY: Community directory FAQ + Manage your plugin]

- After each release the directory scans **manifest**, **release assets**, **source code**, and does **build verification** — it *"verifies that the build matches what's committed."*
- **The scanner runs the first command it finds among `build`, `build:plugin`, `compile`.** Make that your production build.
- Results are Error / Warning / Recommendation / Pass. Errors block installability; warnings don't block.
- Preview before release via **Review branch** (branch/tag/SHA) or run the official ESLint plugin locally: `github.com/obsidianmd/eslint-plugin`.
- Scanner ignore list includes `pkg`, `build`, `dist`, `scripts`, `docs`, `*.cjs`, `*.mjs`, `version-bump.mjs` — relevant if you generate WASM into `pkg/`.
- Private source repos are supported via the Obsidian Community directory GitHub App.

### Developer policies relevant to bundling [PRIMARY]

- **Not allowed:** obfuscating code; dynamic ads; client-side telemetry; **"Install or update themselves or their dependencies."**
- **Must disclose in README:** network use; **accessing files outside Obsidian vaults**; closed-source code (case-by-case); payment/account requirements.
- **Required:** a `LICENSE` file; comply with upstream licenses (attribution in README).
- No forks without permission.
- Note: the directory disclaimer *"This plugin has not been manually reviewed by Obsidian staff"* appears on **5,006 of 7,599** listed plugins — automated review is the norm.

---

## 4. Binary assets — **THE CRITICAL CONSTRAINT**

### Definitive answer: only three files are ever downloaded. Extra files are NOT distributed.

**[PRIMARY — read out of Obsidian's own shipped `installPlugin()`.]** The installer performs *exactly* three fetches, from `https://github.com/{repo}/releases/download/{version}/…`:

| Step | File | Constant |
|---|---|---|
| 1 | `manifest.json` | `eL` |
| 2 | `main.js` | `tL` |
| 3 | `styles.css` | `nL` |

Verbatim shape of the code: `zy(Py(e,t,eL)).text` → parse/validate `id`; then `zy(Py(e,t,tL)).text` → write `main.js`; then `zy(Py(e,t,nL)).text` → write `styles.css`. Each of `main.js`/`styles.css` is wrapped in its own try/catch that merely **logs** `"main.js not found"` and continues — so a missing asset yields a silently broken install, not an error.

URL helpers: `Dy(e,t,n)` = `https://raw.githubusercontent.com/{repo}/{ref}/{path}`; `Py(e,t,n)` = `https://github.com/{repo}/releases/download/{version}/{path}`.

**Corroboration — the complete recognised plugin-file set. [PRIMARY]** Obsidian Sync's own filter enumerates it exhaustively:

```js
e.prototype.isPluginFile = function (e) {
  return "manifest.json" === e || "main.js" === e || "styles.css" === e || "data.json" === e
}
```

`data.json` is the plugin's **own settings file** written by `saveData()` — not a distributable asset. There is **no fourth slot**, and extra files in the plugin folder are not synced by Obsidian Sync by default.

**Official docs agree. [PRIMARY]** `obsidian-releases/README.md`: *"Obsidian will download `manifest.json`, `main.js`, and `styles.css` (if available), and store them in the proper location inside the vault."* `Submit your plugin`: upload exactly `main.js`, `manifest.json`, `styles.css` (optional). The official release workflow's attestation step covers exactly those three paths.

**BRAT behaves identically. [PRIMARY]** BRAT downloads `manifest.json`, `main.js`, `styles.css` **from release assets only** — it adds version-resolution features, not extra files.

### Consequences

| Asset | Shippable via the community store? |
|---|---|
| `.wasm` | **No** as a release asset → must be **inlined into `main.js`** |
| `.node` native addon | **No** |
| Compiled executable / binary | **No** |
| Extra `.js` chunk | **No** |
| `styles.css`, `data.json` | Yes (the former) / generated locally (the latter) |

### The proven workaround — inline WASM into `main.js`

**Pattern A — esbuild binary loader** (`zkdavis/obsidian-smart-vault`):
```js
// esbuild.config.mjs
loader: { '.wasm': 'binary', '.workerjs': 'text' },
define: { 'import.meta.url': '"obsidian-plugin"' },
```
```ts
import wasmBinary from '../../pkg/obsidian_smart_vault_bg.wasm';
import * as wasmNamespace from '../../pkg/obsidian_smart_vault';
const wasmModule = await import('../../pkg/obsidian_smart_vault.js');
await wasmModule.default({ module_or_path: wasmBinary });  // pass bytes, never fetch
wasmModule.init();
```
Build order: `wasm-pack build --target web --out-dir pkg` → `esbuild` with `target: 'es2020'`.

**Pattern B — custom esbuild plugin** (**Templater**, officially listed, uses a Rust WASM engine `@silentvoid13/rusty_engine`):
```js
// esbuild.config.mjs — has both "embed" (loader: "binary") and "deferred" (loader: "file") modes
plugins: [ toml(), wasmPlugin({ mode: "embed" }), copyOutputPlugin, reloadObsidianPlugin ]
```
```ts
// src/core/parser/Parser.ts
// TODO: find a cleaner way to embed wasm
import { default as wasmbin } from "../../../node_modules/@silentvoid13/rusty_engine/rusty_engine_bg.wasm";
await init(wasmbin as InitInput);
```
Templater deliberately chooses `mode: "embed"` — the `"deferred"` (separate-file) mode would not survive store installation.

**Cost, measured. [COMMUNITY — but a precise, verifiable data point]** `radial-timeline` PR #36, *"fix(packaging): ship bundled Pandoc assets inside main.js"*: base64-embedding fonts + Pandoc assets grew `main.js` **3.78 MB → 5.77 MB**; assets are embedded at build time by `scripts/embed-plugin-assets.mjs` and written out at runtime with size verification. The PR states the root cause plainly: *"Obsidian's plugin installer downloads exactly `manifest.json`, `main.js` and `styles.css` from a release... so the bundled assets existed **only on a dev machine**."* Manifest-export had been broken for every Community-Plugins install since the feature landed. It also adds a build gate failing the build when any binary under `src/` is neither embedded in `main.js` nor inlined into `styles.css`.

> **Practical planning number: base64 inflates by ~33%** (binary loader avoids this by embedding raw bytes). A large simulation WASM will dominate `main.js` size and every user re-downloads it on each update. Code-splitting is not available. Consider compressing the engine (wasm-opt, `-Os`, or shipping a gzipped payload you inflate at runtime).
>
> **Community note [COMMUNITY]:** `wasm-pack --target web` + `import.meta` is the top-hit stumbling block for Obsidian+WASM; fixing the esbuild target to `es2020` and calling `initSync()` (rather than the async `init()`) is reported to resolve it.

### External engine: what is actually allowed

- **Ship the engine as WASM inside `main.js`** → clean, offline, single-artifact, store-compatible. **This is the recommended path.**
- **Shell out to a user-installed executable** (the Templater/Pandoc model) → requires the user to install it separately and configure the path. Fully viable on desktop; disclose it.
- **Download a native binary at runtime** → conflicts with the Developer policy *"Install or update themselves or their dependencies"*, and triggers the *network use* + *files outside vaults* disclosure requirements. Treat as high-risk for review. **[UNVERIFIED]** — no official document addresses *binaries specifically*; this is my reading of the policy text.

---

## 5. Views & rendering

**[PRIMARY: official Views guide + `obsidian.d.ts`]**

- **`ItemView`** — `abstract class ItemView extends View`. Key member: `contentEl: HTMLElement` (the container to build into). Constructor takes a `WorkspaceLeaf`. Also `addAction(icon, title, callback)`.
- Subclass contract: `getViewType()`, `getDisplayText()`, `onOpen()`, `onClose()`.
- **`registerView(type: string, viewCreator: ViewCreator)`** — second arg is a **factory**. Official warning: *"Never manage references to views in your plugin. Obsidian may call the view factory function multiple times."* Access instances via `workspace.getLeavesOfType(type)` + `instanceof` check.
- **`WorkspaceLeaf`** — `loadIfDeferred()` (since 1.7.2), `setViewState()`, `revealLeaf()`.
- **`MarkdownRenderChild`** — `class MarkdownRenderChild extends Component` with `containerEl: HTMLElement`. Lifecycle is bound to DOM attachment: when `containerEl` is detached (e.g. the user edited the source), the component unloads. Register via `MarkdownPostProcessorContext.addChild`. This is the correct vehicle for embedding a live widget in Reading view while keeping cleanup deterministic.

**Deferred views (Obsidian ≥ 1.7.2) — a real trap [PRIMARY]:** on load, all views are `DeferredView` instances and only materialise when their tab becomes visible. Always `instanceof`-check `leaf.view`. To force-load without revealing, `await leaf.loadIfDeferred()` — the docs carry an explicit **"Performance warning"**: doing so *"removes this performance optimization... Use this sparingly."*

**Known performance issues with large DOM/SVG node graphs:**

- Obsidian's own **Canvas** is SVG/HTML-node based, and gets visibly sluggish at on the order of **100–200 nodes**. Forum repro: 100 single-line cards → *"Every time some elements appear/disappear from the viewport there are noticeable freezes. But when all elements are present on the viewport, panning makes no freezes."* Reproduced on an M1 Max / 64 GB and on Ryzen 9 + RTX 3060. An Obsidian team member (WhiteNoise) replied *"This bug will be fixed in v1.7.2."*
- The dominant cost is **node insert/remove at the viewport boundary**, not steady-state panning.
- Community mitigations **[COMMUNITY]**: enlarge the wrapper so nodes aren't culled near edges, `will-change: transform`, CSS transition on the canvas element, and **`.canvas > svg * { shape-rendering: optimizeSpeed; }`**. Reported as dramatically smoother.
- Community-proposed better architectures: render nodes into a real `<canvas>` for GPU-accelerated draw passes; snapshot to a high-res bitmap during pan/zoom and swap back on idle; pre-cache node contents; **offload disk/content reads to a Web Worker so they don't block the render loop.**
- Official load-time guidance: keep `onload()` to registrations only; avoid expensive work in view constructors (saved views reopen at startup and directly impact launch time); defer startup work into `app.workspace.onLayoutReady()`; don't iterate all files to find one.

**Implication:** do **not** build the node editor as hundreds of DOM/SVG elements. Use a single `<canvas>` (2D or WebGPU) inside `ItemView.contentEl`, driven by the simulation state — this both avoids Obsidian's SVG ceiling and lets the engine run off the main thread.

---

## 6. Web Workers & Content-Security-Policy

### The CSP, verbatim from the shipped bundle [PRIMARY]

```html
<meta http-equiv="Content-Security-Policy" content="style-src 'unsafe-inline' 'self' https://fonts.googleapis.com">
```

**That is the entire policy.** There is only a `style-src` directive. There is **no `default-src`, no `script-src`, no `worker-src`, no `connect-src`, no `object-src`.**

Therefore:
- `eval()` / `new Function()` — **not restricted** (no `script-src`, so no `unsafe-eval` needed).
- WASM compilation — **not restricted**; **`wasm-unsafe-eval` is NOT required.**
- `new Worker(blobURL)` and file-URL workers — **not restricted**.
- `connect-src` absent → `fetch`/WebSocket to arbitrary origins is unrestricted (relevant if the engine is a sidecar HTTP service).

Also verified: **no CSP is injected by the Electron main process.** The only `webRequest.onHeadersReceived` handler *removes* `cross-origin-opener-policy` and strips `frame-ancestors` from remote responses — it never adds a CSP.

**Empirically confirmed [EMPIRICAL]** under this exact CSP:
- `new Function('return 1')()` → OK
- `WebAssembly.instantiate(...)` → OK (both core and SIMD)
- Blob-URL `new Worker(...)` → constructed OK; worker responded; `SharedArrayBuffer` available inside it; `require('child_process').spawn` available inside it
- `new SharedArrayBuffer(8)` → OK with `crossOriginIsolated === false`

### Worker patterns proven in shipping plugins

**Blob URL is the established idiom. [PRIMARY — source]**

*pomodoro-timer* inlines its worker at build time via a custom esbuild plugin:
```js
let blob = new Blob([${JSON.stringify(workerCode)}], { type: 'text/javascript' })
let url = URL.createObjectURL(blob)
let worker = new Worker(url)      // (or serviceWorker.register(url) for the service variant)
URL.revokeObjectURL(url)
```
*smart-vault* does the same for the PDF.js worker:
```js
// esbuild: loader: { '.workerjs': 'text' }
const blob = new Blob([pdfWorkerSource], { type: 'application/javascript' });
pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
```

Because the plugin folder cannot receive extra files (§4), **blob URLs (or an inlined `Worker` constructor string) are effectively the only portable way to create a worker.** A file-URL worker would have no file to point at after store installation.

### Gotchas

- **`import.meta` is unavailable** in the CJS bundle — esbuild emits the `empty-import-meta` warning and the value is empty. Emit `target: 'es2020'`+ and/or `define: { 'import.meta.url': '"obsidian-plugin"' }`.
- Prefer `wasmModule.initSync()` over the async `init()` for wasm-pack `--target web` output. **[COMMUNITY]**
- Node.js `worker_threads` is also reachable (it's a Node built-in and nodeIntegration is on) — an alternative to Web Workers if you want real OS threads for the simulation, at the cost of desktop-only and no DOM access.
- Terminate workers in `onunload()`/`onClose()` — plugins are required to release resources on unload.

---

## Recommended architecture (derived)

1. **Compile the simulation engine to WASM** (or a native exe for the desktop-only escape hatch).
2. **Inline the `.wasm` into `main.js`** via esbuild `loader: {'.wasm':'binary'}` (Pattern A) — never ship it as a release asset. Add a build gate that fails if any binary under `src/` isn't embedded, following `radial-timeline`.
3. **Run the engine in a Web Worker** created from a blob URL (or `worker_threads`), and share state with the renderer via **`SharedArrayBuffer`** — Obsidian force-enables it, so zero-copy is available.
4. **Render into one `<canvas>`** inside `ItemView.contentEl` (WebGPU, or 2D), *not* hundreds of SVG/DOM nodes — this sidesteps Obsidian's documented Canvas scaling ceiling. OffscreenCanvas is available if you want the render loop off the main thread too.
5. **Set `isDesktopOnly: true`**; `minAppVersion` ≥ the version you actually rely on; `main.js` must be a single production CJS bundle.
6. If you instead shell out to a user-installed executable: guard with `Platform.isMobile` + `FileSystemAdapter` (Templater's model), disclose it in the README, and keep the executable **out** of the release.

---

## Explicitly NOT verified

1. **WebGPU adapter acquisition inside real Obsidian on a GPU machine.** `navigator.gpu` is present in Chromium 150, but `requestAdapter()` returned `null` in this GPU-less VM. Linux WebGPU enablement also depends on driver/Vulkan state. Treat WebGPU as *likely available, needs a real-machine check*; have a 2D-canvas fallback.
2. **Empirical tests ran on Electron 39 (Chromium 142), not Obsidian's Electron 43 (Chromium 150)** — because Obsidian's own renderer can't be scripted headlessly. Every API tested has been stable since long before Chromium 142, and the *configuration* (webPreferences + CSP + SAB flag) was copied verbatim from Obsidian 1.13.7, but exact-version confirmation is inferential. Note also Electron 37/39 were used, so the local Obsidian is not what was measured.
3. **Obsidian 1.13.7 was inspected, not 1.14.1** (latest). The Electron version is tied to the *installer*, and both 1.13.4 and 1.13.6 changelogs announced Electron 43, so 1.14.1 is very likely identical.
4. **Whether review would reject a plugin that downloads a native binary at runtime.** No official document addresses binaries specifically. The policy text *"Install or update themselves or their dependencies"* plus the network/files-outside-vault disclosure rules make it risky, but this is interpretation, not a documented ruling.
5. **No official Obsidian statement about `child_process`** beyond the implicit "kill a subprocess" mention and the plugin-security concession. There is no blessed API and no documented prohibition.

---

## Sources

**Official docs / repos**
- https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/README.md — installer downloads only `manifest.json`, `main.js`, `styles.css`
- https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Plugins/Releasing/Submit%20your%20plugin.md — release assets; manifest at HEAD; version/tag/name match
- https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Community%20directory/Submission%20requirements%20for%20plugins.md — **isDesktopOnly must be true for Node/Electron APIs**; minAppVersion
- https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/Manifest.md — required manifest fields, `id` rules
- https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Community%20directory/Developer%20policies.md — no self-install/update of self or dependencies; disclosure rules
- https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Community%20directory/Frequently%20asked%20questions.md — scanner uses first of `build`/`build:plugin`/`compile`; ignore list; ESLint plugin
- https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Community%20directory/Manage%20your%20plugin%20or%20theme.md — build verification; Review branch
- https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Plugins/Getting%20started/Mobile%20development.md — Node/Electron unavailable on mobile; crash risk
- https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Plugins/User%20interface/Views.md — `ItemView`, `registerView`, factory warning
- https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Plugins/Guides/Defer%20views.md — DeferredView, `loadIfDeferred()` perf warning
- https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Plugins/Guides/Optimize%20plugin%20load%20time.md — onload weight, view constructors, `onLayoutReady`
- https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Plugins/Releasing/Plugin%20guidelines.md — review comments incl. security/innerHTML
- https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Plugins/Releasing/Release%20your%20plugin%20with%20GitHub%20Actions.md — official release workflow, 3 assets + attestation
- https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Extending%20Obsidian/Plugin%20security.md — "plugins can install additional programs"; no permission model
- https://raw.githubusercontent.com/obsidianmd/obsidian-sample-plugin/master/esbuild.config.mjs — `format:'cjs'`, `bundle:true`, `external: [...builtinModules]`
- https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts — no shell API; "kill a subprocess" doc comment; `ItemView`, `MarkdownRenderChild`, `registerView`
- https://github.com/TfTHacker/obsidian42-brat/blob/main/BRAT-DEVELOPER-GUIDE.md — BRAT downloads the same three files
- https://github.com/obsidianmd/eslint-plugin — local review checks
- https://obsidian.md/changelog/ — 1.13.6 "installer has been updated to use Electron v43.3.0"; 1.13.4 → v43.1.1

**Version cross-check**
- https://releases.electronjs.org/release/v43.3.0 — Electron 43.3.0 = Chromium 150.0.7871.212, Node 24.18.1
- https://endoflife.date/api/electron.json — Electron 43 ↔ Chrome M150

**Community / plugin evidence**
- https://github.com/SilentVoid13/Templater — `require("child_process")` + `promisify(exec)`; `@silentvoid13/rusty_engine` WASM; `wasmPlugin({mode:"embed"})`; `isDesktopOnly:false`
- https://github.com/RAIT-09/obsidian-agent-client — `spawn` from `child_process`; `isDesktopOnly:true`; listed in `community-plugins.json`
- https://github.com/EricRhysTaylor/radial-timeline/pull/36 — **definitive asset-packaging post-mortem**; base64 embed; 3.78→5.77 MB; build gate
- https://github.com/zkdavis/obsidian-smart-vault — esbuild `loader:{'.wasm':'binary'}`, `define import.meta.url`, blob-URL PDF worker
- https://github.com/eatgrass/obsidian-pomodoro-timer — inline-worker esbuild plugin, blob-URL worker
- https://forum.obsidian.md/t/wasm-in-obsidian-plugin/103577 — wasm-pack + `import.meta` pitfalls; `initSync()`
- https://forum.obsidian.md/t/canvas-sluggish-performance-issue-when-multiple-nodes-enter-exit-the-view/68609 — Canvas SVG scaling limits; `shape-rendering: optimizeSpeed`; worker offload
- https://forum.obsidian.md/t/plugins-web-worker-should-be-a-priority/111810 — worker throttling under memory pressure
- https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json — 7,599 listed plugins; 5,006 not manually reviewed

**Primary artifacts inspected locally (Flatpak `md.obsidian.Obsidian` 1.13.7)**
- `files/obsidian` binary → `Electron/43.3.0`, `Chrome/150.0.7871.212`
- `files/resources/obsidian.asar` → main-window `webPreferences`; `installPlugin()` three-fetch logic; `SharedArrayBuffer` enable-features switch; the sole CSP meta tag; `isPluginFile`; `appendSwitch` calls
- `files/resources/app.asar` → no CSP injection (main process)
