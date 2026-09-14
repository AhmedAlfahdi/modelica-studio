# Modelica + Obsidian: Empirical Research Findings

Measured on the target machine (CachyOS, AMD Ryzen 5 2600X 12 threads, 15 GiB RAM,
OpenModelica 1.27.0 installed as `local/openmodelica-bin 1.27.0-4`).

## 1. Installed Modelica toolchain (verified)

| Component | Path | Notes |
|---|---|---|
| `omc` CLI | `/usr/bin/omc` | OpenModelica 1.27.0 |
| Compiler lib | `/usr/lib/x86_64-linux-gnu/omc/libOpenModelicaCompiler.so` | 27 MB |
| Sim runtime C | `/usr/lib/x86_64-linux-gnu/omc/libSimulationRuntimeC.so` | 9.6 MB — exports `_main_SimulationRuntime`, `solver_main` |
| Runtime C | `/usr/lib/x86_64-linux-gnu/omc/libOpenModelicaRuntimeC.so` | 391 KB |
| GC | `/usr/lib/x86_64-linux-gnu/omc/libomcgc.so.1` | Boehm GC |
| C headers | `/usr/include/omc/c/` | `simulation_data.h`, `openmodelica_func.h`, … |
| MSL | auto-loaded | Modelica 4.1.0 + ModelicaServices 4.1.0 + Complex 4.1.0 |

## 2. Measured latency budget (the key numbers)

Test model: `RC.mo` — voltage source + resistor + capacitor + ground (MSL, 1 state).

| Stage | Time | Notes |
|---|---|---|
| MSL load (`loadModel(Modelica)`) | **~970 ms** | one-time per omc session |
| `buildModel` cold (frontend+backend+codegen+link) | **~1.6 s** | includes MSL load |
| `buildModel` after MSL loaded in same session | **~0.68 s** | |
| `omc -n=1` full build | 4.64 s | ❗ default `-n` is effectively 1 |
| `omc -n=8` full build | **1.95 s** | parallel codegen — 2.4× faster |
| **Spawned exe re-simulation** (`-override`, no recompile) | **~22 ms** | 5 sequential runs = 111 ms total |
| **In-process shim re-simulation** | **1.8–6.7 ms** | ~10× faster than spawning |

Note: an earlier "2.4 ms" reading was an artifact of `omcDllMain` skipping the write step
after the stack-local DATA was reused. The honest figures above are from a clean
standalone-runner benchmark (22 ms) versus the persistent-state shim build (1.8–6.7 ms).

### Consequences

- **Simulation is NOT the bottleneck. Compilation is (98%).**
- Parameter-only edits must **never** trigger a recompile → use `-override`.
- `-n` must be passed explicitly or builds are 2.4× slower for no reason.

## 3. `-override` works — verified numerically

`-override=r.R=100` vs `-override=r.R=1` produced genuinely different results
(R_actual = 100 vs 1, 503 rows each). No recompilation. This is the fast path
for interactive slider/parameter edits.

Caveat discovered: `stopTime` / `startTime` are **not** model variables — they live in
`DefaultExperiment` in `<Model>_init.xml`, and `-override=stopTime=…` emits
`override variable name not found in model: stopTime` and is silently ignored.
Use `-override=startTime=…,stopTime=…` only via the setup-XML path, or drive the
solver directly through the shim API.

## 4. In-process embedding — PROVEN

OMC's generated model is **plain C** with a documented embedding contract:

- `<Model>.c` is the main file and contains the equation functions.
- `<Model>_16dae.c` holds the variable metadata tables.
- Generated `RC.makefile` has an **`omc_dll_target`** that builds the model as a
  shared library (`RC.so`, 69 KB) by compiling `<Model>.c` with
  `-DOMC_DLL_MAIN_DEFINE`, which swaps `int main` for
  `OMC_EXPORT int omcDllMain(int argc, OMC_CHAR **argv)`.
- The DLL also exports the full runtime API: `RC_setupDataStruc`, `solver_main`,
  `initializeModel`, `_main_initRuntimeAndSimulation`, `_main_SimulationRuntime`.

Verified by building `RC.so` and `dlopen`-ing it from a C driver:
`dlopen+dlsym` 14–22 ms (once), then each `omcDllMain` call 2.4–7 ms.

**Critical limitation found in `omcDllMain`:** it declares `DATA data; MODEL_DATA
modelData; SIMULATION_INFO simInfo;` as **stack locals** and tears them down on
return. So it is NOT re-entrant for result extraction and result files are not
written reliably. It is a demo entry point, not an API.

### The fix (the actual architecture to build)

Write our own small `shim.c` that allocates `DATA`/`MODEL_DATA` **persistently**,
calls the generated `RC_setupDataStruc()`, then
`_main_initRuntimeAndSimulation()` + `_main_SimulationRuntime()`, and keeps the
`DATA*` alive to read `data->modelData->realVars[]` directly. Expose a tiny stable
C ABI to JS:

```
shim_load()            -> allocate + register model once
shim_set_real(name, v) -> write parameter slot directly
shim_simulate(t0,t1)   -> run solver, results stay in memory
shim_get_real(idx)     -> read any variable, no file I/O
shim_set_input(name,v) -> change input at runtime, continue
shim_free()
```

This removes *all* file I/O and process spawn from the interactive loop →
parameter sweeps become effectively free (µs–ms).

Note: `threadData` is a **global symbol supplied by the OMC runtime library**;
do not declare it in generated-code builds (OMC passes `-Wl,--no-undefined`).

## 5. Other verified facts

- `buildModelFMU(RC, version="2.0", fmuType="cs")` works → 1 MB FMU in 7.5 s.
  Useful for deployment/portability, but too slow for an interactive loop.
- OMC exposes a **ZMQ-based interactive API** (`libzmq.so.4.2.3`,
  `/usr/share/omc/omc_communication.idl`, `OpenModelicaScriptingAPI.h`) as an
  alternative to driving the CLI.
- `parallelCodegen` debug flag exists (on by default).
- `-d=nogen` suppresses code generation → caused confusing link errors; avoid it
  when you intend to link the result.

## 6. Open questions / risks

- `libSimulationRuntimeC.so` must be present at runtime. It ships with the
  OpenModelica package, so the plugin must locate an OMC install or bundle a
  runtime. Bundling a 9.6 MB `.so` per platform is a distribution concern.
- WASM is **not** currently viable for the *compiler* (no maintained
  OpenModelica→WASM build found). It may be viable for the *simulation* half only
  by compiling the generated C with Emscripten — needs a no-`fork`, no-`dlopen`
  runtime, which the generated code respects.
- Windows/macOS would need per-platform `.so`/`.dylib`/`.dll` and a different
  toolchain story.
