# Modelica in Obsidian — Options & Recommendation

All numbers below are **measured on your machine** (CachyOS, Ryzen 5 2600X, 12 threads,
15 GiB RAM, OpenModelica 1.27.0), not estimated. Raw evidence: `RESEARCH-FINDINGS.md`.

---

## 0. The one insight that decides the architecture

I benchmarked the whole pipeline instead of assuming. The result inverts the usual design:

| Stage | Measured | Share of interactive loop |
|---|---|---|
| Load Modelica Standard Library | **970 ms** | one-time per OMC session |
| Compile model (frontend→backend→C→link) | **680 ms** warm, 1.6 s cold | **98%** |
| Solve + write results | **17–22 ms** | 2% |

**Simulation is essentially free. Compilation is everything.** So a fast plugin is not
about a fast solver — it is about *never recompiling when the user only changed a value*.

Verified: `-override=r.R=100` produces genuinely different correct results with **zero
recompilation** (R_actual = 100 vs 1). That is the load-bearing primitive.

`-n=8` must be passed explicitly — OMC defaults to effectively `-n=1`, costing 2.4×
(4.64 s vs 1.95 s).

---

## 1. Engine options

### Option A — Spawn OMC + `-override` hot path `[PROVEN, PORTABLE]`

Install-time: locate `omc`, load MSL once into a persistent session.
Edit-time: if the user changed only parameter values → run the already-compiled
executable with `-override`, **17–22 ms**. Topology change → recompile, 680 ms.

- ✅ Works today, everything verified end-to-end
- ✅ Portable across Linux/macOS/Windows wherever OMC is installed
- ✅ Process isolation: a solver crash cannot take down Obsidian
- ⚠️ 680 ms on structural edits (adding/moving a block)
- ⚠️ Requires the user to have OpenModelica installed (or a bundled runtime)

### Option B — In-process FFI `[FASTEST IN THEORY, BLOCKED]`

OMC's generated model is plain C and its makefile contains an `omc_dll_target` that
builds a **shared library** (`-DOMC_DLL_MAIN_DEFINE`). I built it (73 KB `libshim.so`),
drove it from C, and got **1.8–6.7 ms per re-simulation — ~10× faster than spawning.**

Then I bridged it to Node with `koffi` and hit a hard wall:

```
Thread 13 "node" received signal SIGSEGV
#0 libomcgc.so.1   <- OMC's Boehm garbage collector
#1 libomcgc.so.1
#2 libomcgc.so.1
```

OMC's Boehm GC spawns its own marker threads at init and **crashes inside the Node
process**. Rebuilding with `-d=-parallelCodegen` did not remove it (the threads come
from the GC/runtime, not codegen). Escaping this needs
`GC_set_parallel(0)`/`GC_set_markers_count(1)` tuning or a process-per-sweep pool.

- ✅ 10× faster steady-state, true in-memory parameter sweeps
- ❌ Currently segfaults inside Node's process
- ❌ Bundling a 9.6 MB `libSimulationRuntimeC.so` + toolchain per platform
- ❌ Desktop-only, fragile against OMC version changes

### Option C — WASM / pure-JS `[NOT VIABLE FOR THE COMPILER TODAY]`

Research (verified, with caveats):

- **OpenModelica master has real WASM targets** (`--simCodeTarget=wasm-jit`,
  `buildModelFMU(..., platforms={"wasm"})`) — but `CodegenWasmJit.mo` states they are
  *"only implemented in the Rust omc build"*, and that Rust implementation is **not in
  the public repo and not on crates.io**. Not usable from stock 1.27.
- **`fmi-ls-wasm`** (official Modelica Association FMI 3.0 WASM layered standard) is a
  **working draft**, "unofficial and subject to change", and ships **no JavaScript/TS
  runner**. No npm FMI importer exists.
- **Rumoca** (`@cognipilot/rumoca`, npm, Apache-2.0) — Rust Modelica compiler with
  WASM bindings; a companion project runs compile+simulate fully client-side. The only
  genuinely working WASM Modelica path found.
- **ModelScript** (`@modelscript/*`) — web-native incremental compiler, FMI import/export,
  SUNDIALS solvers. **AGPL-3.0** (a licensing problem for a closed plugin); npm publishes
  are stale (2026-04) and simulation maturity unverified.
- ⚠️ Also corrected: `omc_communication.idl`/CORBA are **gone** from OMC master. The real
  interactive API is `omc --interactive=zmq` (ZMQ REP socket).

### Option D — Hybrid `[RECOMMENDED]`

Ship **A as the engine**, and design the seam so **B can be dropped in later**.
The plugin talks to a `SimulationBackend` interface; A is the default implementation,
B becomes an opt-in "turbo" backend once the GC-taming work is done. No rewrite.

---

## 2. What the interface actually is — this decides the UI

Worth stating plainly, because it changes the product: **Modelica is acausal, not a
block/dataflow language.** A resistor and a capacitor have two equivalent pins each;
there is no "input" and "output". Simulink-style block diagrams (and therefore
Blockly-style editors) model the *wrong* thing.

The correct target is an **OMEdit-shaped schematic editor**: typed connectors with
acausal semantics, and the diagram serialized to Modelica's own graphical annotations
(`annotation(Icon(...), Diagram(...), Line, Rectangle, Polygon, Text, Placement,
extent, transformation)`). Doing this buys round-trip compatibility — the plugin's
diagrams open in OMEdit and vice versa. That is a real feature, not a nicety.

Build the *initial* version on the **MSL** (`Modelica.Electrical.Analog.*`,
`Modelica.Mechanics.Rotational.*`, `Modelica.Blocks.*`), which is already installed —
so v1 has a genuine component palette with no authoring work.

---

## 3. Node editor options (performance-ranked)

| Library | Render | Scale | Fit for acausal Modelica |
|---|---|---|---|
| **React Flow / xyflow v12** | DOM+SVG | good to ~1–2 k nodes | ✅ best DX, custom node rendering, active |
| **LiteGraph.js** | Canvas2D | very good at scale | ⚠️ one-way dataflow assumptions; needs port-semantics work |
| **Rete.js v2** | pluggable | moderate | ⚠️ dataflow/control-flow oriented, not acausal |
| **Blockly** | SVG | good | ❌ statement/expression trees — wrong paradigm |
| **X6 / AntV** | SVG+Canvas | strong | ✅ capable, heavier, Chinese docs |
| **Custom Canvas2D/PixiJS** | Canvas/WebGL | best | ⚠️ total control, highest cost |
| **Obsidian Canvas** | built-in | n/a | ❌ no public API to extend it programmatically |

Given MSL sub-models are typically **10–100 blocks** (not thousands), the honest answer is
that raw rendering throughput is not the bottleneck — **compile latency is**. React Flow's
developer ergonomics win is worth more here than Canvas2D's ceiling. Reserve Canvas/WebGL
for a later "large model" mode if it ever matters.

---

## 4. Recommendation

**Option D: spawn-OMC engine + React Flow schematic UI + annotation round-trip.**

1. **Engine:** subprocess + `-override` hot path. Proven, portable, crash-isolated,
   17–22 ms per parameter change.
2. **Compile latency:** persistent OMC session (keeps MSL resident, saves 970 ms), `-n=8`
   always, and **structural debounce** — coalesce drag operations and only recompile on
   drop, never mid-drag.
3. **UI:** React Flow with custom node components that render MSL icons, typed acausal
   ports, zoom/pan.
4. **Round-trip:** serialize the diagram to `annotation(...)` so files stay valid Modelica
   and open in OMEdit.
5. **Seam for Option B:** one `SimulationBackend` interface so the 10× in-process path can
   land later without touching the UI.

### Honest risk list

- **Distribution is the biggest unsolved problem.** A plugin bundling a 9.6 MB runtime
  per platform is heavy; requiring an OMC install is friction. This needs a decision.
- Occasional 680 ms hitch on structural edits is inherent to OMC's architecture
  (Option B is the only real fix).
- Mobile is impossible (no child processes); must ship `isDesktopOnly: true`.

---

## 5. Open decisions for you

1. **OMC discovery model** — require a system OpenModelica install, or bundle a runtime?
2. **Scope of v1** — MSL palette only, or also a user-defined custom block authoring flow?
3. **Do you want me to keep pushing Option B** (tame the Boehm GC for the 10× win), or
   ship on A first and treat B as a later optimization?
