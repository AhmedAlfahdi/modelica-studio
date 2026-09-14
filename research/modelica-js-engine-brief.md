# Running Modelica from a JS/TS app (Obsidian/Electron) — engine research brief

Researched 2026-09-13. Star counts / dates from the GitHub REST API and commit-atom feeds.
Latency figures marked **[measured]** were produced in this session on this machine; figures
marked **[OM docs]** are from OpenModelica's own published `SimulationResult` output;
**[yours]** refers to `RESEARCH-FINDINGS.md` in this workspace.

---

## 0. Correction to my own interim message

I told you the Rust omc wasm implementation was *"not in the public repo"*. **That was wrong.**
It is public at `OMCompiler/Compiler/OpenModelica.rs/` in `OpenModelica/OpenModelica` — I
re-fetched `README.md` (17,654 B) from master to confirm. It is a ~80-crate Rust workspace
including `openmodelica_codegen_wasm_jit`, `openmodelica_codegen_wasm_jit_runtime`,
`openmodelica_fmi3_wasm`, `openmodelica_fmi_ls_wasm_aot`, `openmodelica_fmi_ls_wasm_to_native`,
`openmodelica_fmi_web`, `openmodelica_animation_wasm`, `omshell_{wgpu,dioxus,egui}`.

So the accurate statement is: **the wasm targets are real, public, buildable from source, and
shipped in no released binary.**

---

## 1. OpenModelica `omc` — what actually exists

### 1.1 The classic batch workflow (works today, OM 1.27.x)

```
loadFile("Model.mo")  ->  checkModel(M)  ->  buildModel(M, ...)  ->  ./M  ->  M_res.mat
```
`buildModel` returns `String[2]` = {executable, init file}. `simulate()` does all of it and
returns a `SimulationResult` record whose timing fields are the useful benchmark primitive:
`timeFrontend, timeBackend, timeSimCode, timeTemplates, timeCompile, timeSimulation, timeTotal`.

**[OM docs]** real numbers for a 2-equation model — `timeCompile 0.20–0.26 s`,
`timeSimulation 0.0065–0.028 s`, `timeTotal 0.21–0.29 s`. Compile dominates by 10–40×.
This independently reproduces your **[yours]** finding that compile is ~98% of the loop.

### 1.2 `buildModel` vs `buildModelFMU` vs `translateModel`

| Call | Produces | Runtime needed | Speed |
|---|---|---|---|
| `buildModel` | native simulation executable | none (self-contained) | fast |
| `simulate` | exe + runs it + result file | none | fast |
| `buildModelFMU` | `.fmu` (FMI 1.0/2.0/**3.0**) | an FMI importer | **[yours]** 7.5 s for a 1 MB FMU |
| `translateModel` | in-memory translation for interactive use | same omc session | — |

`buildModelFMU` signature (current): `version` ∈ {1.0, 2.0, 3.0}; `fmuType` ∈
{`me`, `cs`, `me_cs`, `se`} (SE = FMI 3.0 Scheduled Execution); `platforms` ∈
{`static`, `dynamic`, host-triple, docker crossbuild, **`wasm`**}.

### 1.3 `-override` — the load-bearing primitive (confirmed at primary source)

Exact documentation text:

> **`-override=value`** — *"Override the variables in the XML setup file. For example:
> `var1=start1,var2=start2,par3=start3`"*
> **`-overrideFile=value`** — *"Will override the variables in the XML setup file with the
> values from the file. Note that: `-overrideFile` CANNOT be used with `-override`. Use when
> variables for `-override` are too many."* File format: lines of `var=start`.

Also relevant: `-r=<file>` (result filename), `-outputFormat=` (set at **compile** time via
`buildModel/simulate`, not a runtime flag), `-outputPath=`, `-iif=` (external init file),
`-inputPath=`, `-csvInput=`, `-noemit`, `-port=` (simulation status), `-logFormat=xmltcp`.

**The critical limitation — structural parameters.** A parameter used in an `if`-equation
condition, an array dimension, or a `connect` condition is a *structural* parameter and
**cannot** be changed by `-override`; it needs a recompile. Confirmed by a real user case on
the OpenModelica forum ([thread 2782](https://openmodelica.org/forum/default-topic/2782-integer-parameters-not-changeable-when-re-simulating));
the accepted fix is to make it an `input`. OMC ships a debug flag specifically for this
workflow — `-d=veryStrict` tearing, documented as *"Use this if you aim at overriding
parameters after compilation with values equal to or close to zero."*

**[yours]** `-override=r.R=100` verified numerically to produce different correct results with
zero recompilation; `stopTime`/`startTime` are **not** overridable this way (they live in
`DefaultExperiment` in `<Model>_init.xml`).

### 1.4 The interactive API — this is the real story

**`omc --interactive=zmq`** is the supported persistent-session API. Verified from
`OMCompiler/Compiler/runtime/zeromqimpl.c` and `Flags.mo`:

- `--interactive` ∈ {`none` (default), `tcp`, `zmq`}; `-d=interactive` is the older TCP socket variant.
- Binds a **ZMQ REP** socket: `tcp://127.0.0.1:*`, or `tcp://*:*` with
  `-d=zmqDangerousAcceptConnectionsFromAnywhere`.
- `--interactivePort=<n>` pins the port.
- Writes the chosen port to `$TMPDIR/openmodelica.<user>.port<suffix>` (`-z<suffix>` to vary it);
  on Windows `$TMPDIR/openmodelica.port<suffix>`.
- **Protocol: plain strings.** Send a scripting command, receive the Modelica-value string
  back. Errors are a *second* round trip via `getMessagesStringInternal()`. Confirmed by
  reading OMPython's `sendExpression` (`om_session_omc.py`).
- `--interactiveDumpFormat` ∈ {`default`, `json`} — *"json: JSON, for programmatic consumers
  such as the web clients."* A deliberate nod to JS consumers.

This means: **a Node plugin can drive a persistent omc over ZMQ directly** with the `zeromq`
npm package — no Python. This is exactly what the dead `SHIXUNXUN/OMNodeJS` (1★, npm
`omnodejs` v1.0.4, 2022-02-18) did. Nothing about it is hard; nobody has maintained a JS client.

**CORBA is a different story.** `omc_communication.idl` and `Corba_omc.cpp` **exist in every
release through v1.27.1** but **have been deleted from master** (404 at v1.27.0…v1.27.1 and
master respectively — I checked all four). So: present today, gone in 1.28+. Also **`-iomc`
does not exist** — that flag name in the original brief is a red herring.

### 1.5 The C API — exists, but is a dead end for Node

- `libOpenModelicaCompiler.so` (27 MB in your install) does export `omc_OpenModelicaScriptingAPI_*`.
- The header **`OpenModelicaScriptingAPI.h` is generated at build time**, not committed — which
  is why it 404s in git but exists in your install. Verified in `boot/Makefile.common`:
  `cp -a $(GEN_DIR)OpenModelicaScriptingAPI.h $(OMHOME)/include/omc/scripting-API`.
- Requires a `threadData_t`; **there is no supported embedding API and no maintained example**.
  The historical example (`OMCompiler/Compiler/runtime/omcCAPI`) is gone (404 at v1.27.0).
- **Practical blocker:** **[yours]** — OMC's Boehm GC (`libomcgc.so.1`) spawns marker threads and
  **segfaults inside the Node process**. This matches the general design intent: OMC's own
  internal use goes through ZMQ, not the C API.

---

## 2. OpenModelica in WebAssembly — real, public, unshipped

### 2.1 The official path (master only, opt-in)

Verified in the top-level `CMakeLists.txt` and the Rust README:

- `omc_option(OM_OMC_WASM "Build only the WebAssembly (browser/Node) omc bundle." OFF)` — **default OFF**.
- Rust toolchain: nightly-2026-05-31, target `wasm32-unknown-unknown`, cranelift, binaryen.
- Builds a browser bundle to `install_cmake/share/omc/web`, with pages
  `omc-terminal`, `simulator`, `fmi-simulator`, `omplot`, `anim`. **Must be served with
  COOP/COEP headers** or SharedArrayBuffer features die silently.
- With `OM_OMC_WASM`, OMSimulator and all Qt clients are **force-disabled**
  (`cmake_dependent_option(OM_ENABLE_OMSIMULATOR ... "NOT OM_OMC_WASM" OFF)`) and
  libraries/testsuite are skipped.
- Three code paths:
  - **`--simCodeTarget=wasm-jit`** — lowers model *and functions* to WASM, JITs via wasmtime
    **in-process**; replaces "generate C → build `.so` → `dlopen`". Selected with `-d=gen`
    for functions, or plain `simulate()` to skip codegen entirely.
  - **`--simCodeTarget=wasm`** — standalone WASI command module, run via a wasmtime subprocess.
  - **WASM FMU export** — `buildModelFMU(..., platforms={"wasm"})`, and CLI
    `--export-fmu --fmuPlatforms=wasm`. Emits `binaries/wasm32-wasip2/<id>.wasm`, FMI 2.0/3.0,
    ME / CS / ME_CS. Source comment: *"Host-free, so it also works in the browser omc."*
    Also `--fmuDirectory` writes an unzipped FMU (explicitly to avoid zip cost "for a wasm FMU
    carrying a precompiled artifact"). Requires `FMUVersion <> "1.0"`.

**Limitations, verbatim from the Rust README:** *"The JIT compilation is limited at the moment
(no external `"C"` functions yet although that could possibly be done via FFI or Emscripten),
and the simulation target has only 1 dense linear solver, a Newton non-linear solver
(numerical Jacobian), Euler, and dassl."* `TODO.md` records an open correctness bug — an
unguarded bouncing-ball `when`/`reinit` tunnels through the floor (~55 vs 40 bounces).
**Forward Euler only** on the wasm-jit sim path is the practical limit.

**Status:** OpenModelica 1.27.0 release notes say verbatim — *"We are also actively
experimenting the option of running OMEdit in the browser, using local hardware resources
through Wasm technology. A mature enough version should become available when 1.28.0 is
released."* Latest stable is **1.27.1** (2026-09-08). **There is no downloadable wasm bundle** —
`build.openmodelica.org/omc/builds/{wasm,web}/` both 404. The official user guide still
documents only the dead Emscripten route.

### 2.2 The one real in-browser FMI runtime (also OMC master)

`OMCompiler/Compiler/OpenModelica.rs/wasm/fmi-simulator/` — I verified `index.html` (49 KB),
`session.js`, `README.md` all exist. It is an in-browser master for **FMI-LS-WASM** FMUs driving
**both ME and CS**, running jco's transpiler *in-browser* (Component Model binaries can't go
through `WebAssembly.instantiate`). Documented gaps: **FMI 1.0/2.0 FMUs are read and displayed
but not simulated**, no Scheduled Execution, no `fmi3Get/SetFMUState` (no rollback), samples only
at run end, **ZIP64 rejected**.

### 2.3 The standard: `fmi-ls-wasm` — a draft, not a standard yet

[github.com/modelica/fmi-ls-wasm](https://github.com/modelica/fmi-ls-wasm) — "WebAssembly WIT
mapping of FMI 3.0 API". **6★**, created 2026-06-05, last commit 2026-07-07, code BSD-2-Clause.
Maps the FMI 3.0 C API to the WebAssembly **Component Model** WIT; covers ME + CS + SE; archive
layout `binaries/wasm32-wasip2/<modelIdentifier>.wasm`. Ships Rust/C/WAT example FMUs.

It is MA-org-hosted and listed in `fmi-standard`'s README as "under development", **but the repo
says of itself:** *"This is currently not normative, nor is this document to be considered
officially endorsed by the Modelica Association or other involved organisations prior to
official adoption."* It has **no fmi-standard.org news item** (unlike FMI-LS-XCP v1.0.0, -BUS
v1.0, -STRUCT, -REF, -DAE). **FMI 3.0 core has no wasm variant**; wasm enters only via this
layered standard. Exactly **two host runners** exist in-repo (Rust, C). **No JS/TS runner.**

### 2.4 Everything else — status

| Project | URL | ★ | Last commit | Verdict |
|---|---|---|---|---|
| `tshort/openmodelica-javascript` | [link](https://github.com/tshort/openmodelica-javascript) | 72 | **2014-02-21** | **DEAD** — asm.js era; still linked from live OM docs |
| `EthanJamesLew/omc-web` | [link](https://github.com/EthanJamesLew/omc-web) | 0 | 2026-05-26 | Real Emscripten omc port; demo live (HTTP 200); Euler+RK only; memory-hungry; bus factor 1 |
| `creative-connections/Bodylight.js-FMU-Compiler` | [link](https://github.com/creative-connections/Bodylight.js-FMU-Compiler) | 24 | 2026-01-13 | Emscripten FMU→JS+WASM. **FMI 2.0 co-simulation only** — no ME, no FMI 3.0. GPL-3.0 |
| OMWeb (2011 paper) | — | — | 2011 | **DEAD**; was a server-side remote lab, never WASM |
| `OpenModelica/OMSimulator` | [link](https://github.com/OpenModelica/OMSimulator) | 95 | 2026-09-09 | **No WASM.** Zero wasm/emscripten hits in CMakeLists or BUILD.md; force-disabled for wasm builds |
| Julia → WASM (for Modia.jl) | [`WasmTarget.jl`](https://github.com/GroupTherapyOrg/WasmTarget.jl) | 33 | 2026-07-23 | **Not viable.** Author: SciML support will land "one small library at a time", no ETA |

**npm has no FMI importer at all.** `fmi` is an empty 0.0.0 package; `fmi-js` is *Finnish
Meteorological Institute weather data*; `fmu` is "fast module utilities";
`@modelica/fmi-data` (2018) is cross-check test tooling. GitHub search `fmu wasm` returns
**total_count = 1**, a 0★ stub.

---

## 3. Alternative engines

| Engine | URL | ★ | Last commit | Lang | License | Verdict for an Electron plugin |
|---|---|---|---|---|---|---|
| **Rumoca** | [CogniPilot/rumoca](https://github.com/CogniPilot/rumoca) | **125** | 2026-09-10 | Rust | **Apache-2.0** | ✅ **Best in-process option.** npm WASM bindings, verified running (see §4) |
| **ModelScript** | [modelscript/modelscript](https://github.com/modelscript/modelscript) | 14 | 2026-09-13 | TS | **AGPL-3.0-or-later** | ⚠️ Genuine TS DAE engine but **AGPL** + solver pkgs not on npm |
| OpenModelica | [OpenModelica/OpenModelica](https://github.com/OpenModelica/OpenModelica) | **1401** | 2026-09-13 | MetaModelica/Rust | OSMC-PL/AGPL | ✅ Batch + ZMQ; C API blocked by Boehm GC |
| OMSimulator | [OMSimulator](https://github.com/OpenModelica/OMSimulator) | 95 | 2026-09-09 | C++ | OSMC-PL | ✅ For precompiled FMU co-sim; C API + CLI, no JS binding, no WASM |
| JModelica.org | [JModelica/JModelica](https://github.com/JModelica/JModelica) | 79 | **2026-09-08** | Modelica | NOASSERTION | ⚠️ **NOT dead** — "Modernized" fork (Py3, JDK 17, CMake/Gradle). But OCT *product* discontinued and Python bindings "pending" → **reviving, not usable** |
| Modia.jl | [ModiaSim/Modia.jl](https://github.com/ModiaSim/Modia.jl) | 333 | 2026-02-16 | Julia | MIT | ❌ Julia→WASM not viable; `TinyModia.jl` archived; energy moved to Dyad |
| Dyad | [DyadLang/dyad-lang](https://github.com/DyadLang/dyad-lang) | 59 | 2025-06-18 | TS | other | ❌ Engine is Julia ([`DAECompiler.jl`](https://github.com/JuliaComputing/DAECompiler.jl), 9★, 2025-12-09). **No JS engine, no WASM.** Commercial |
| `omuses/moijs` | [link](https://github.com/omuses/moijs) | 16 | **2020-11-29** | JS | — | ❌ **DEAD** |
| Modelon Impact | [impact-client-js](https://github.com/modelon-community/impact-client-js) | 3 | 2024-09-20 | TS | BSD-3 | ⚠️ Only commercial tool with a documented REST API **and** a JS client (npm `@modelon/impact-client-js` v4.1.0, 2024-05-28) — but dormant ~2 yrs, license server |
| Dymola / MapleSim / SimulationX / System Modeler | — | — | — | — | proprietary | ❌ Not embeddable. All license-server/licence-gated, all need subprocess spawn of a proprietary binary. System Modeler is the only one with a credible headless story (`wolframscript`); Modelon the only one with an HTTP API |

**OpenModelica's own JS-ecosystem packages** (relevant for editor UX, not simulation):
`@openmodelica/modelica-language-server` (v0.3.3, npm 2026-09-03 — LSP, ALIVE),
`OpenModelica/OMFrontend.js` (2024-04-18), `prettier-plugin-modelica` (npm 2026-09-11),
`lbl-srg/modelica-json` (39★, Modelica→JSON).

---

## 4. Latency comparison — the decision table

All figures for a **small** model. Sources labelled.

| Option | Parameter change | Structural edit | Notes |
|---|---|---|---|
| **(a) spawn `omc` per sim (recompile each time)** | **1.95–4.64 s** [yours] | same | `-n=8` mandatory; default `-n` is effectively 1 (2.4× penalty) |
| **(b) persistent `omc` + ZMQ + `-override`** | **17–22 ms** [yours] (exe spawn) | **~680 ms** warm [yours] | MSL load 970 ms once per session. Matches **[OM docs]** 0.21–0.29 s total for a tiny model |
| **(c) prebuilt exe, invoked repeatedly with `-override`** | **17–22 ms** [yours] | n/a (needs recompile) | Identical to (b)'s hot path; (b) just also owns the compiler |
| **(b′) in-process C shim (custom `shim.c`)** | **1.8–6.7 ms** [yours] | n/a | ~10× faster, **but segfaults in Node** (Boehm GC marker threads). Desktop-only, ABI-fragile |
| **(d) FMU + JS/WASM runtime in-process** | — | — | **No JS FMI importer exists.** WASM FMUs need `fmi-ls-wasm` (draft) + a Component Model runtime |
| **(e) pure WASM OMC** | — | — | Real but **no shipped build**; `OM_OMC_WASM` default OFF; Euler-only sim; external `"C"` unsupported |
| **(f) Rumoca WASM in-process** ⭐ | **9.6 ms** [measured] (1-state) / **84 ms** [measured] (2-state, 10 s @ dt=1 ms) | recompile from source, still in-process | Zero install, zero subprocess, Apache-2.0 |

### Rumoca — measured in this session, in Node v22.23.2

| Measurement | Result |
|---|---|
| WASM module init (`initSync`) | **36 ms** |
| Cold `simulate_model`, 1-state decay | **250 ms** |
| **Warm `simulate_model` × 20, parameter override** | **9.64 ms** avg |
| Cold, 2-state mass-spring-damper, 10 s @ dt=1 ms | 326 ms |
| **Warm sweep × 20, same** | **82 ms** avg |
| `WasmSimulationSession` per integration step | **0.009–0.017 ms** |
| 1000 `step()` calls | 8.6–16.9 ms |
| Package size unpacked | **27.6 MB** (16 MB main wasm; diffsol 1.5 MB; galec 9.1 MB) |

**Correctness — verified, not assumed.** I compiled an **acausal** electrical library (custom
`connector Pin` with `flow Real i`, `connect()` equations, V-source + R + C + ground — i.e. a
real DAE with algebraic constraints) and swept `r.R` via hierarchical override:

| R | τ = RC | Expected v_C(1 s) = 5(1−e^(−1/τ)) | Rumoca |
|---|---|---|---|
| 50 | 0.05 | 4.9999995 | **5.00000** |
| 100 | 0.10 | 4.9997727 | **4.99977** |
| 200 | 0.20 | 4.9663100 | **4.96631** |
| 400 | 0.40 | 4.5895791 | **4.58958** |

All four match theory to 5 decimals. **Rumoca handles acausal connectors, `flow` variables and
parameter override correctly.** Cold compile 535 ms; sweep of 4 points 1075 ms (each call
re-lowers from source — the session API is the way to avoid that).

### Rumoca API surface (`rumoca_bind_wasm.d.ts`)

`WasmSimulationSession` — `new(source, model)`, `.withOptions(source, model, t_end, dt, solver, atol, rtol)`,
`step(dt)`, `advance_to(t)`, `get(name)`, `set_input(name, v)`, `state_json()`, `reset()`,
`input_names()`, `variable_names()`, `time()`, `end_time()`. Docstring: *"an interactive session
that can be driven from JavaScript via `requestAnimationFrame`."*

Also: `simulate_model(...)`, `compile`, `compile_to_json`, `lower_model_to_solve_json`,
`model_parameter_metadata` (for building a parameter UI), `load_source_roots` (MSL is **not**
bundled — manifest is `{"archives":[]}`), `prepare_gpu_simulation`, plus a full **in-WASM Modelica
LSP** (`lsp_diagnostics`, `lsp_completion`, `lsp_hover`, `lsp_definition`, `lsp_code_actions`).
Separate `./diffsol` (implicit/BDF) and `./galec` backends.

**Gotcha:** the default `init()` does a `fetch()` that fails in Node
(`TypeError: fetch failed`). Use `initSync({ module: readFileSync('...wasm') })`.

---

## 5. Recommendation

**Keep Option A/B/D as your architecture — the subprocess `-override` path is still the right
default for MSL coverage and correctness — but Rumoca changes the calculus for a second backend.**

1. **Your current recommendation stands.** `-override` at 17–22 ms with full MSL support and
   process isolation beats everything else for a plugin that must render MSL schematics. Nothing
   found here invalidates it.
2. **Add Rumoca as the "no-install" backend.** Its 9.6–84 ms in-process sweep, zero-install
   story and Apache-2.0 licence directly solve your *"distribution is the biggest unsolved
   problem"* risk. A user without OpenModelica installed gets a working simulator.
3. **Do not build on the OMC C API / in-process shim.** The Boehm GC crash is a runtime-level
   problem, not a codegen one, and the wasm-jit future path is the official replacement for
   exactly that embedding use case.
4. **Do not wait for OMC WASM.** Real and public, but opt-in, Euler-only, no shipped build,
   officially targeted at 1.28.0 (end of 2026). Worth tracking; not a v1 dependency.
5. **Avoid for licensing:** ModelScript (`@modelscript/*`) is **AGPL-3.0-or-later** — do not link
   `@modelscript/core` into a proprietary plugin; use its `msc` CLI or REST API out-of-process
   if at all.

### Unverified / open risks I could not close

- **Rumoca's MSL coverage is untested.** MSL is not bundled; I tested a custom acausal library
  only. Whether `Modelica.Electrical.Analog.*` / `Mechanical.*` flatten correctly is the single
  biggest unknown before committing.
- Rumoca self-describes as *"in early development… expect bugs and rough edges."*
- Whether public CI ever builds the OM browser bundle (no `web` stage found in the Jenkinsfile;
  comments imply it exists).
- ModelScript's simulation maturity — its `runtime`/`exchange` packages **404 on npm**; only
  `core`/`cli`/`tree-sitter-modelica` are published.
- Whether OM issue #11791 (Bodylight FMU `fmi2ExitInit` failure) is fixed.
- Commercial pricing for Dymola/MapleSim/SimulationX/System Modeler/Modelon — deliberately not guessed.
