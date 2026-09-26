# Performance
Measured on the development machine — Ryzen 5 2600X, 12 threads, 15 GB, NVMe, OpenModelica 1.27.0, Modelica 4.1.0. Every number is a wall-clock measurement, not an estimate.

Measured on the development machine — **Ryzen 5 2600X, 12 threads, 15 GB, NVMe,
OpenModelica 1.27.0, Modelica 4.1.0** — for a small MSL circuit. Every number below
is a wall-clock measurement, not an estimate.

The one thing worth knowing: **the first launch after installing or upgrading the
library costs about 1.2 s, and nothing else is slow.** Editing and re-running is
milliseconds.

## Startup

| Stage | Measured | When |
|---|---|---|
| Parse the whole MSL into the class index | **1.2 s** | first launch after install/upgrade |
| Load the index from its cache | **~0.3 s** | every launch after that |
| Cache file | 25 MB | written beside the plugin's data |

5984 classes are parsed out of 2424 files — 13 MB of library source. Only the
newest release of each library is read: OpenModelica keeps every installed
version side by side, and indexing all of them put three releases of `Modelica`
into one table keyed by class name, where the definition that won depended on the
order the filesystem handed the files over. The palette is built while this
happens rather than before it, so the index cost is not a delay in opening the
studio — it is why the palette fills in a moment late on a cold start.

## Editing and running

| Action | Measured | Why |
|---|---|---|
| Simulate with the binary already built | **18–36 ms** | the compiled model is reused |
| Change a parameter and re-run | **~30 ms** | applied as a run-time override, not a rebuild |
| Building the identical source again | **0 ms** | the fingerprint matches and the binary is reused |
| First build, small equation model | **0.6 s** | translate, generate C, compile, link |
| First build, 4-component MSL circuit | **1.5–1.8 s** | library classes bring their own equations |

The 30 ms row is why parameters are applied as run-time overrides rather than by
regenerating code, and why editing a value and re-simulating is immediate. Only a
structural change — adding a component, rewiring, editing an equation — pays for a
rebuild. Details in [`design.md`](design.md).

An edit that only changes a value, a start attribute or a run setting stays on the
fast path. So does switching between models that have both been built once.

## What the settings are worth

**Parallel compile jobs** is the setting that matters, and it is worth measuring
rather than guessing. Same 4-component circuit, cold cache, on the 12-thread CPU:

| `jobs` | First build | Saving |
|---|---|---|
| 1 | 4.07 s | — |
| 2 | 2.47 s | 39% |
| 4 | 1.75 s | 57% |
| 8 | 1.43 s | **65%** |

Each measured with an empty build cache and a freshly constructed backend, and
reproduced twice — the first attempt at this table compared contaminated figures,
since a backend remembers what it has already built and answered in 0 ms.

The default is one less than the core count. Raising it past the physical core
count does little, because code generation is CPU-bound.

**Excluded libraries** does not affect the timings above — the whole library is
still parsed — but it decides how much the studio has to offer. Excluding four
sub-libraries that many models never touch:

| | Placeable classes |
|---|---|
| Everything indexed | 1365 |
| After excluding `Magnetic`, `Clocked`, `ComplexBlocks`, `StateGraph` | 1089 |

A shorter palette is easier to search, and a shorter list in the AI's brief is
less to choose wrongly from.

## Choosing a solver

Leave it on **OpenModelica default** unless you have a reason. The list is what
this runtime offers, read from the runtime itself:

| Solver | What it is | Use it when |
|---|---|---|
| `dassl` | BDF, implicit, adaptive order 1–5 | the default; right for stiff systems |
| `ida` | SUNDIALS BDF, implicit, sparse | large systems, where the sparse solver scales better |
| `cvode` | SUNDIALS BDF or Adams–Moulton, order 1–12 | you want accuracy — measured **1e-16** against 8e-8 for `dassl` on a stiff problem |
| `gbode` | a family of Runge–Kutta methods, order 1–14, implicit or explicit | you want to try a non-BDF method, or multi-rate integration |
| `euler` | explicit, fixed step, order 1 | teaching, and seeing what a bad solver looks like |
| `rungekutta` | classical explicit RK, fixed step, order 4 | smooth non-stiff models; unstable on stiff ones |
| `symSolver`, `qss` | symbolic inline; quantised-state | experimental — `symSolver` needs a compiler flag this plugin does not pass |

**A stiff system** is one where something changes far faster than the interval you
care about — a fast electrical transient next to a slow thermal one. Explicit
methods take tiny steps to stay stable there; implicit ones like `dassl` and
`cvode` do not.

One caution worth knowing: **an unrecognised solver name is not an error to
OpenModelica.** It warns, exits successfully, and writes a result file full of
NaN. The name is `rungekutta`, not `rungekutta4` — and this plugin recommended the
wrong one until it was measured. The plugin now reports an all-NaN result as a
failure naming the solver, rather than showing an empty plot.

## Measuring it yourself

`modelicaStudio.state()` reports the toolchain, the index size and the settings in
force. The AI timings in [`ai-baseline.md`](ai-baseline.md) are measured
the same way: by running the thing and writing down what happened.

A different machine will differ, most in the compile column — that stage is
CPU-bound and parallel, so core count moves it more than anything else. If a
simulation feels slow, check `jobs` first, then whether the model is rebuilding
when it should not be.
