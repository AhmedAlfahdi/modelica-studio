# AI generation: measured baseline

What the generator actually does, measured rather than assumed. Two runs against
one model, recorded so a later change can be compared against them and so a claim
about "the AI" has something behind it.

Raw data: [`ai-baseline.json`](ai-baseline.json). Run the measurement with
`modelicaStudio.bench()` in Obsidian's developer console; the method is in
`src/ai/benchmark.ts`.

## Why this exists

The plugin shipped with a rule telling the AI to "prefer equations to
components", added to stop models arriving as unconnected blocks. It had the side
effect of making the AI avoid the visual form entirely — which is the main reason
to use Modelica. Reversing that rule then produced a run in which *visual* looked
unreliable: a hydraulic circuit timed out, and a drag model came back as eight
loose blocks.

Two explanations were available and they needed different fixes:

- the visual form is inherently fragile — more components, more connections, more
  places for one mistake to fail the whole compile;
- something in the plugin is broken.

The first was reasoned from mechanism and felt obviously right. **It was wrong**,
and only measurement settled it.

## Method

| | |
|---|---|
| Harness | `modelicaStudio.bench()`, run inside Obsidian so the API key stays in the keychain |
| Prompts | 8, spanning six domains (below) |
| Styles | `visual` (build a diagram) and `equations` |
| Samples | 1 per cell |
| Order | alternating per prompt, so neither style is measured only early or only late |

The prompts, chosen to span the families the question turned on:

| id | domain | prompt |
|---|---|---|
| divider | electrical | a resistor divider across a 12 V supply, two equal resistors |
| rc | electrical | an RC circuit charging from 5 V through a 1 kOhm resistor into a 1 uF capacitor |
| spring | mechanical | a 2 kg mass on a spring of stiffness 200 N/m with a damper of 5 Ns/m |
| heating | thermal | a thermal capacitance heated by a constant power source and losing heat to ambient |
| tank | fluid | a water tank draining through a pipe into a lower reservoir |
| valve | fluid | water flowing from a source through a valve into a tank |
| pendulum | multibody | a pendulum with a 1 kg bob half a metre from a revolute joint |
| control | control | a PID controller regulating a first order plant to a setpoint of 1 |

The first four have components with few pins and unambiguous wiring. The last
three carry requirements a class list cannot convey: a fluid model needs an
`inner Modelica.Fluid.System` and a `Medium`, a multibody model needs an
`inner World`, and neither is visible from the names.

## Baseline: DeepSeek V4.1 Flash (`deepseek-flash`), 2026-09-17

Settings for both runs: thinking **off**, style **visual**, temperature 0.2.

### Run A — before the equations fix

| | compiled | produced a diagram | fully wired | median attempts |
|---|---|---|---|---|
| visual | 6/8 | 6 | 6 | 1 |
| equations | 7/8 | **2** | 2 | 1.5 |

**Visual produced a fully wired diagram in 6 of 8 runs, in every domain** —
including fluid and multibody, the two predicted to fail. Both failures were
**timeouts with zero attempts**: the model never replied, and neither reached the
compiler.

**Equations produced a diagram twice.** Once badly enough to fail structurally:
four components, none wired, stopped by the no-progress rule after the same error
returned three times. The instruction said equations, the 1600-token class list in
the brief said components, and the list won.

Timings from this run are **not usable**: it ran every visual prompt before its
equations twin, and the early prompts were slow in *both* styles (divider 77 s and
212 s; spring and heating 7–26 s in both). The apparent 2.5× visual slowdown was
the provider drifting over the session, not the style.

### Run B — after the equations fix

| | compiled | produced a diagram | fully wired | median attempts |
|---|---|---|---|---|
| visual | **8/8** | 7 | 7 | 1 |
| equations | **8/8** | **0** | 0 | 1 |

Three changes between the runs, all recorded in `ai-baseline.json`:

1. **The class list is withheld from an equations request**, replaced with a note
   saying why there is none. This is what took equations from 2 diagrams to 0 —
   the instruction no longer competes with a catalogue.
2. **`describeStyleViolation`** sends back an answer that returns an assembly when
   equations were asked for (2+ components *and* 2+ connects; one
   `Modelica.Constants` reference is not an assembly).
3. **The deadline went from 220 s to 300 s.** Both run-A failures were deadlines,
   not fragilities: at 300 s both finished, `valve` at 278 s — just under the
   ceiling that used to kill it.

The fallback to equations fired once, on `tank / visual`: four attempts, ending as
equations, 582.9 s. That is the mechanism doing its job on the one genuinely hard
case.

## What this establishes

- **The visual form is not fragile.** 8/8 compiled, 7 as fully wired diagrams,
  across six domains including the three predicted to be difficult.
- **The defect was in the plugin, not the form.** An instruction contradicted by a
  catalogue is followed less often; removing the catalogue fixed it.
- **Diagram-first with an equations fallback is the right default**, which is what
  the plugin ships.
- **A domain-aware split is not justified.** It was the recommended fix before
  this measurement; the measurement refuted its premise.

## What this does not establish

- **Latency.** One sample per cell. Within a single style, per-request time ranged
  5 s to 278 s, which swamps any difference between styles. Ranking them on speed
  needs repeats of one prompt, not one of everything.
- **Behaviour on a retry.** Repairs are normal — `divider` needed 2 attempts,
  `rc` and `control` needed 2 — so a single sample understates the tail.
- **Anything about a different model.** See below.

## Known cost

A hard request can take **several minutes**. The fallback makes latency additive:
`tank / visual` was ~3 failed diagram attempts at 100–200 s each, then equations,
for 582.9 s total.

Tightening the fallback to switch after one attempt instead of two was considered
and **rejected**: repairs are normal, and one attempt gives the repair mechanism no
chance at all. Two is the balance between giving the diagram a fair try and not
paying three times for it.

## Untested

**Only `deepseek-flash` has been measured.** No OpenAI model has been tested, nor
OpenRouter, Groq, or any local model. The presets in `src/ai/prompts.ts` list
candidates; none of them has evidence behind it.

A new model is measured by switching the model in settings and running
`modelicaStudio.bench()`, then appending the result to `ai-baseline.json` with its
own id and `config`. **Append rather than overwrite** — the comparison between
entries is the point.

Expect the shape of the result to differ by model. The two findings most likely to
move are:

- whether a model obeys the form it was asked for without the class list being
  withheld (run B's fix may be unnecessary for a more instruction-following model,
  or insufficient for a less obedient one);
- per-request latency, which sets how often the deadline is the binding
  constraint.
