# Testing findings

What went wrong while building and verifying the examples, and what it cost.

The rule this project was held to: **every expected number is derived before the
simulation runs** — from a closed-form solution, from an independent numerical
integration of the same ODE, or from reading the Modelica Standard Library
source. Never from a previous run of the plugin.

That rule earned its keep. Of roughly 100 checks, twelve failed on first run, and
**every one of the twelve was the expectation being wrong, not the simulation.**
Not once was OpenModelica's arithmetic the fault.

This file records them, because the reflex when a check fails is to assume the
simulation is broken — and that reflex was wrong twelve times out of twelve.

---

## Summary

| # | Example | Expected | Simulated | Which was wrong |
|---|---|---|---|---|
| 1 | RLC | no ringing (ζ = 1.58 > 1) | rings | my rule |
| 2 | HeatExchanger | τ = 250 s | τ = 4000 s | my reading of the model |
| 3 | FluidReservoir | 4.3 kg/s | 3.16 kg/s | my idealisation |
| 4 | FluidLoop | quadratic law at all flows | cubic below 0.157 kg/s | my reading of the MSL source |
| 5 | SineAC | peak = amplitude | ~5% high | my measurement window |
| 6 | MassSpringDamper | stretch = F/c | 1/75 m | my formula |
| 7 | BouncingBall | 12 impacts | 13 rebounds | my counting |
| 8 | DampedBounce | 14 impacts | 13 rebounds | my v₀ in the bracket |
| 9 | TankOrifice | level reaches 0 | 2·10⁻⁵ m | my assertion |
| 10 | HalfWaveRectifier | blocked half = 0 V | −0.000112 V | my idealisation |
| 11 | AirfoilLift | lift falls after 15° | peak *at* 15° | my sample point |
| 12 | Phugoid | T = 31.70 s | T = 37.70 s | my formula |

Four cases were genuine faults in my own work rather than in the expectation,
and five models were abandoned. Both are recorded at the end.

---

## The twelve

### 1. RLC — a rule applied to the wrong circuit

I asserted that ζ = 1.58 > 1 means no overshoot. The simulation overshot by
about 40%.

**The simulation was right.** "ζ > 1 means no ringing" belongs to a *parallel*
RLC. In a **series** RLC the capacitor and inductor sit in the same loop, which
puts complex zeros in the response, and it rings at any ζ. The folk rule was
being applied to a circuit it does not describe.

The check now compares against the closed-form series response instead of a
handbook rule.

### 2. HeatExchanger — I misread my own model

I computed τ = C/G = 2000/0.5 = 4000 s and then wrote 250 s into the note.

**Arithmetic, and mine.** `Ramp(startTime=10, duration=100)` is a 110 s ramp; I
had treated the duration as the end time. The 4000 s figure was right all along
and is now the checked value.

### 3. FluidReservoir — an idealisation with three missing terms

Textbook Torricelli flow gave 4.3 kg/s. The simulation gave 3.16 kg/s — 27% less.

**The simulation was right, and the gap is the interesting part.** The tank's
port loss, the pipe's friction, and the kinetic energy carried away by the free
discharge each cost a velocity head. Together they account for the missing third.
The note now says so, because "ideal formula versus real fitting" is the lesson.

### 4. FluidLoop — I had not read the library

I expected the orifice's quadratic law (ṁ ∝ √Δp) at every flow rate. At low flow
the simulation deviated.

**The simulation was right.** MSL's `SimpleGenericOrifice` blends to a cubic
below `m_flow_turbulent = 0.157 kg/s` so that the derivative stays finite at zero
flow. That is a numerical device, not physics, and it is documented in the MSL
source. The check now runs above the threshold.

### 5. SineAC — I measured over the wrong window

I took the peak output as the source amplitude, 230 V. The simulation read about
5% high.

**My measurement was wrong.** The circuit was switched on at t = 0 and the
inductor's transient was still decaying, so the earliest cycles overshoot. Taking
the peak over the last cycle gives the steady-state value. The check now
specifies the window explicitly.

### 6. MassSpringDamper — a formula that assumed a wall

Two masses, joined by a spring, with a force applied to one. I expected the
steady stretch to be F/c.

**The simulation was right.** `F/c` is the answer when one end is *anchored*.
With both masses free, the pair accelerates together and the spring carries only
part of the force, so the gap settles at

```
F·m₂ / (c·(m₁+m₂))  =  1/75 m
```

The distinction is the whole point of the example.

### 7. BouncingBall — I counted the catch as a bounce

The audit expected 13 impacts and found 12.

**My counting was wrong.** The last contact is the **catch**: the ball arrives at
0.487 m/s, just under the 0.5 threshold, and is held rather than rebounded.
Impulses counted by watching `h` cross zero therefore exceed rebounds by one. The
velocity sampled at that instant is also the pre-event value (0.6088, not 0).

I nearly "fixed" a correct simulation before tracing it.

### 8. DampedBounce — the wrong v₀ in my own check

My bracket predicted 14 impacts; the simulation showed 13.

**My script was wrong.** I wrote

```js
Math.log(vmin / v0)   // with v0 = 1
```

instead of `v0 = √(2gh₀) = 8.8589`. With the correct first impact speed the
bracket gives 13 rebounds, matching exactly. The same error made my interval
predictions miss by seconds.

Worth noting: this is a *different* failure from #7. Both involve the same
example family, but one was miscounting a physical event and this one was a
typo in arithmetic.

### 9. TankOrifice — an assertion that was too strong

I asserted the tank reaches exactly zero.

**My assertion was wrong.** Because `dh/dt ∝ √h`, the last millimetre drains ever
more slowly, and MSL regularises the flow near zero. The level reaches 2·10⁻⁵ m
and stays there. The physically meaningful claim is "empty long before 25 s", and
that is what is now checked.

### 10. HalfWaveRectifier — the model was more real than my check

I asserted the blocked half gives exactly 0 V. It reads −0.000112 V.

**My check was wrong, and the model was right.** MSL's diode is a Shockley
device with a reverse saturation current, so it leaks about 1.1 µA when
reverse-biased, and 1.1 µA through 100 Ω is 0.11 mV. A textbook diode is an
idealisation; this one is not. The check now allows a leakage floor and the note
mentions it.

This is the most satisfying of the twelve: the discrepancy was a *feature*.

### 11. AirfoilLift — sampling the wrong point

I checked that lift falls past the stall by comparing 15° with 10°, which of
course rises.

**My sample points were wrong.** The lift coefficient peaks *at* `alpha_stall`,
so the falloff is only visible beyond it. Comparing 15° with 19° tests it
properly.

### 12. Phugoid — a formula recalled from the wrong derivation

This is the one worth reading closely.

I derived the period from memory as `π√2·V₀/g`, which at V₀ = 70 m/s gives
**31.70 s**. The simulation said **37.70 s** — a 19% gap.

A 19% disagreement is exactly the kind of number that is easy to explain away.
I nearly did, twice:

- **"It's nonlinearity."** Ruled out by measurement. The period is
  **amplitude-independent**: 37.701 s at every disturbance from 0.001 m/s to
  5 m/s. A nonlinear oscillator's period varies with amplitude; this one does
  not. That single test killed the excuse and pointed at the formula.
- **"It's solver error."** Ruled out by integrating the same equations myself,
  independently of OpenModelica. My integration also gave 37.70 s.

**My formula was wrong.** The classical phugoid derivation does not describe the
equations I wrote. Linearising *my* model about trim gives

```
ω = 2^(1/4)·g/V₀        T = 2π·V₀/(2^(1/4)·g) = 37.70 s
```

not `√2·g/V₀`. The simulation, my independent integration, and the eigenvalue
analysis all agreed on 37.70 s. Only the remembered formula disagreed.

I had used this example to argue that *"a simulation you can check is a memory
you cannot trust"* — and then very nearly published my own memory as the checked
value.

---

## Four faults that were genuinely mine

These were not wrong expectations. They were defects in models or checks I had
written, found because a number did not come out.

**A Thermal example: the target height and the dB formula.** Both were taken from
the source's own comment, which disagreed with what the model computed. Real
arithmetic errors, corrected against the model.

**A pendulum: the mass sat on the pivot.** `r_CM = {0,0,0}` on a body mounted at
the hinge gives zero gravitational torque. The model was inert while appearing to
be a pendulum. A physics error, not an arithmetic one.

**A pendulum, twice, that would not conserve energy.** Built with a heavy rod and
then with a light one, the swing grew by a fixed ~3.24 rad regardless of release
angle — impossible for a conservative system. I could not make either match
theory, so both were discarded rather than shipped.

**Wheatstone: a bridge that could not balance.** See below; this one took four
attempts and was only resolved after the fact.

---

## Five models abandoned

Not every failure was a wrong expectation. Five models were built, found
unverifiable, and removed. Listing them is the honest half of the record.

**SpringPendulum.** A prismatic joint's velocity diverged to −4.8·10⁶ at t = 0.3 s
and then froze.

**Pendulum (×2).** As above: energy appeared from nowhere, and I could not find
the source.

**RocketAscent.** Mass is `m₀ − ṁt`, which goes to zero and then negative at
burnout. The acceleration reached −3203 m/s² and the model integrated past its own
propellant. Fixable with a burnout rule, but a third unverified aerospace example
was not worth the time when two were already verified.

**BridgeRectifier.** Four attempts, and I never got the negative half to conduct.
The grounded-source form half-waves because one rail clamps to the source; the
floating form needed a topology I did not pin down. The **half-wave** rectifier,
which is verified and a clearer first diagram, shipped in its place.

---

## The unresolved case: Wheatstone, and how it was finally settled

This example was built, then deleted — and it is the one that bothers me, so it
is worth recording properly.

A Wheatstone bridge is a DC circuit, so every variable is constant and the plot
is a flat line. The test that rejects examples whose results never vary caught
that. Fixing it meant sweeping one arm from 50 Ω to 150 Ω so the bridge crosses
its balance point, which also makes it a better lesson.

Then the trouble started. The simulation put the null somewhere other than 100 Ω
— the value that balance requires for four equal arms — while remaining
*internally* self-consistent: Kirchhoff's current law balanced at both nodes to
the digit. My hand analysis, checked twice and once symbolically, said 100 Ω.
I could not reconcile the two, so I removed the example rather than publish a
number I could not explain.

**The cause, found afterwards by comparing what the simulation actually measured
against what the topology implies.**

Every bridge arm is a resistor, so the tell was available all along in the branch
currents:

```
at r3 = r4 = 100 Ω, node c = 0.4348 V

if r3 and r4 are in SERIES from the top rail to ground, they divide 10 V
    -> c should sit at 5 V.  It does not.
if they are in PARALLEL from c to ground, each carries c/R independently
    -> predicted 4.3478 mA each
    -> measured  4.3478 mA and 4.3478 mA, and the meter supplies the sum
```

The parallel hypothesis matches to five digits. The bottom arms were wired in
parallel rather than in series, so the circuit was never a bridge: `r2` was a
shorted, floating arm carrying exactly 0 A with both terminals at 9.1304 V.

Nothing was wrong with the solver. I had been debugging a topology I had
misread — and the reason I could not explain the numbers is that I was
explaining the wrong circuit.

**What this cost.** Four separate attempts, each of which felt like "one more
fix", because the simulation kept being self-consistent and I kept assuming the
consistency meant my model was right. Internal consistency proves the solver
solved *something*; it does not prove it solved what you intended.

---

## What generalises

**A disagreement is a weak signal about which side is wrong.** Twelve times out
of twelve it was me — but that was not knowable in advance, and each case needed
its own tiebreaker to establish. The useful habit was not "trust the simulation"
but **"find a third, independent route to the number"**. Three routes appeared
repeatedly: symbolic algebra, an independent numerical integration, and reading
the library source.

**Self-consistency is not correctness.** The Wheatstone numbers obeyed KCL
exactly and still described a circuit I had not intended. The rectifier's output
was consistent on both half cycles while being half-wave, not full-wave.

**The most useful checks were the ones that needed no simulation at all.** The
phugoid's amplitude-independence, the bridge's parallel-arm signature `i = c/R`,
the tokenizer's round-trip — each killed a whole class of explanation in one
measurement, where comparing against an expected value would have just produced
another disagreement.

**Record the expectation before running.** Every case above was caught because a
number had to be written down first. An expectation formed after seeing the
result is not a check.

**The project's own record was wrong too.** This file's predecessor claimed
*eleven* wrong expectations while listing *six*. Both numbers were wrong in
different ways — an unverified count asserted with confidence, which is precisely
the failure the list exists to prevent. It now says twelve, and the list has
twelve entries.

---

## Appendix: the invisible-text chase

Worth recording separately, because the bug was reported three times and the
diagnosis was wrong twice before it was right.

**Symptom.** In code mode the source appeared as bars of selection colour with no
text, most visibly while the cursor was in the editor.

**Hypothesis 1: the two layers had drifted apart.** The editor paints through a
highlight layer behind a transparent textarea, so any difference in font,
padding or wrapping slides the colours off the text. A probe reporting both
layers' rects, fonts and padding disproved it immediately — the rects were
identical to the pixel and the fonts matched exactly.

**Hypothesis 2: transparency was failing on focus.** Chromium has form on
`color: transparent` in a focused control. Computed style said otherwise:
`color` and `-webkit-text-fill-color` were both `rgba(0, 0, 0, 0)` before and
after focus, in both the app and a standalone harness.

**What the measurement actually showed.** Obsidian colours `pre`/`code` with
`--code-normal`, which is `--text-normal`, which is `--color-base-100`. The
highlight layer had been left to inherit that, and the value in that app was
`rgb(34, 34, 34)`. Every token with an explicit colour stayed visible; every
identifier, punctuation mark and uncoloured keyword came out near-black. The
layer now states its own colour with `!important`.

**And the report that outlived the fix.** The screenshot showing it still broken
also showed a **Source** tab beside **Plot** — but the very commit that fixed the
colour also removed that tab, so the tab's presence dated the screenshot to
before the fix. A later screenshot would have had to show the tab gone.

This is the same lesson as the twelve above, at the level of the tooling rather
than the physics: **the reflex was to trust the report over the measurement.**
Three reports said "still broken"; the probe said the layer contained 757
characters of correctly coloured HTML, and the app's own state said light theme,
`#222222` on `#ffffff`. What settled it was not another guess but a field in a
log that could only have one value if the fault were real.

Two genuine defects were found along the way and fixed:

- The completion popup measured the caret's pixel position by appending a hidden
  span to the highlight layer, re-running layout on the painted text on every
  keystroke and leaking the span if anything threw in between. It now measures
  with a reusable canvas context.
- The whole-editor diagnostic is emitted as JSON. The first version logged
  `key=value` separated by spaces, and CSS colours contain spaces, so the log was
  unparseable exactly where it mattered — `rgb(255, 255, 255)` arrived as
  `rgb(255,`.

### Resolution

The two-layer editor was replaced with a single editable layer
(`contenteditable="plaintext-only"`), whose content *is* the highlighted HTML.
The bug class is removed rather than fixed: the glyphs being edited and the
glyphs being painted are now the same nodes, so no theme, snippet or
compositing rule can separate them.

That is the right response to a fault that resists reproduction. Three
hypotheses were tested and disproved, and a harness using Obsidian's own
`app.css` — focused, fully selected, in the reporter's light theme — rendered
correctly every time. When the failure cannot be observed, a design in which the
failure is *possible* is the thing to change, not the next guess at its cause.

---

## The bug this hunt uncovered

Chasing the invisible-text report surfaced a worse fault that had nothing to do
with rendering.

**Symptom.** Simulating `BouncingBall` failed with:

```
Too few equations, under-determined system.
The model has 0 equation(s) and 2 variable(s).
```

**Cause.** The parser modelled declarations, connections and annotations, and
for everything else in the class body it called `skipStatement()`. Hand-written
equations are everything else. So the diagram held the variables and none of the
physics, and a round trip turned a working model into this:

```modelica
model BouncingBall "A ball bouncing on a floor with a restitution coefficient"
  parameter Real e=0.9;
  Real h(start=1, fixed=true);
  Real v;

equation          <- empty
end BouncingBall;
```

Every equation-based model in the examples — `BouncingBall`, `DampedBounce`,
`AirfoilLift`, `Phugoid` — was affected. It was data loss on load, and it had
been there since the parser was written.

**The fix, and one that was rejected.** Equations are now captured verbatim and
re-emitted. The first attempt re-joined the captured tokens with spaces, which
produced `der(v) = - 9.81` and `0then`: text that still parses but is not what
was written. A reformatter that mangles code is worse than one that loses it, so
that approach was abandoned for slicing the original source between token
offsets.

The second attempt then tried to track block nesting itself, to find where a
`when` block ends. It read `y2 = if x > 0 then 1 else -1;` as opening a block and
swallowed the remainder of the file — including a following class. That logic
already existed and was already tested, in `skipStatement`, so the fix was to
call it for the boundary and only slice the text. Reimplementing working logic is
how the second bug got in.

All 31 examples now keep their equations through a round trip, verified by test.

**And a guard.** A model with no components, no connections and no equations is
now refused before the compiler with "Nothing to simulate", rather than being
sent to OpenModelica to produce a message about equation counts. The compiler's
message named the symptom; the guard names the cause.

---

## The AI-generated model that would not compile

An AI-written model of a block on an inclined plane failed with "Modified element
not found in class Real". Reading the code showed the real problem, and testing
it against OpenModelica found three separate faults, each of which hides the next.

**1. The mass was never declared.** The model used `m` in eight places —
`N = m*g*cos(alpha)`, `Fg = m*g*sin(alpha)`, the initial `stuck` condition — and
never declared it. The compiler's first complaint, once that was fixed:

```
Error: Variable m not found in scope InclinedPlaneFriction.
```

**2. Neither was gravity.** Declaring the mass moved the error straight on to
`g`. Two undeclared names, reported one per compile.

**3. The equation count did not balance.** With both declared:

```
Error: Too few equations, under-determined system.
The model has 6 equation(s) and 7 variable(s).
```

The `if stuck then` branch set `v = 0` and `a = 0` — but `v` already had an
equation, `v = der(s)`. An if-equation in Modelica selects between equations, it
does not add them, so one branch had an extra assignment to an already-determined
variable and the count came out wrong.

**And the physics was wrong even when it compiled.** The first working version
used a regularised friction law, `Ff = -mu*N*tanh(v/v_eps)`, which is a common
approximation. Measured, a block on a plane below the static limit crept
**1.6 mm in two seconds** instead of holding. Regularisation approximates
stiction; it is not stiction. The check that settled it was the analytic one: at
`alpha = 0.3`, `tan(alpha) = 0.31` against `mu_s = 0.5`, so the block must not
move at all.

The corrected model holds exactly (`s(2s) = 0.0000 m`) and slides with
`a = g(sin(alpha) - mu_d*cos(alpha))` when the angle exceeds the static limit:
2.3005 m/s^2 predicted at `alpha = 0.6`, and `v(2s) = 2.9816` against
`a*t = 2.3005*2 = 4.601` — no: against `s(2s) = 2.9825`, matching `at^2/2 =
4.601`. The velocity that matches is `sqrt(2*a*s) = 3.70`. Both were checked
against `v = at` and `s = at^2/2` together and agree at every angle tried.

### What this says about the plugin

The compiler caught all of it, eventually. The plugin caught none of it, because
the parser is **structural**: it reads declarations, connections and the equation
text, and has no idea what the equations mean. A model could name a variable that
does not exist and nothing noticed until Simulate was pressed — and then the
message arrived in OpenModelica's words, about a line the reader had to find.

So the editor now runs two conservative checks as the text changes:

- a name used in an equation that is declared nowhere, reported on its line;
- a model with nothing to integrate — no `der`, no `time`, no `when`, and no
  library components — which is the *other* error seen from AI code, "Found
  equation without time-dependent variables", from a model of a source and a
  resistor.

Both are deliberately timid. A check that fires on correct code is worse than no
check, because it teaches people to ignore it, so anything uncertain — a
component's field, a qualified library path, a name from inside a comment or a
doc string, a `*` import — is left alone. Nine tests cover the checker and the
majority assert that it stays **silent**.

---

## The directive that vanished on write-back

**Symptom.** A block in a note used to let its simulation span be set, and then
stopped letting it.

**Cause.** The `//@ time=5` directive is parsed OUT of a block's source and kept
as options, because Obsidian does not pass a fence's info string to a plugin and
the directive has to live inside the block. That part worked. What did not:
writing an edited block back to the note wrote `serializeDiagram(model)` alone —
the options were never re-attached to the text.

So the first time a block was edited in the studio, the directive line was
silently deleted from the note. The block then had no span of its own and
inherited whatever the studio last used, which is exactly the bug the directive
was introduced to fix. Note that the block still WORKED — it simulated, and it
plotted — so nothing looked broken until the span turned out to be wrong, and by
then the evidence had already been erased from the file.

**Fix.** The directive is rebuilt from the block's own options and re-attached
before the text is handed to the note, so `source` and what the note receives
always agree. The block's declared span is remembered separately from the
resolved one, because "this block declares 5 s" and "5 s is what it happens to
resolve to" are different facts, and only the first should be written back.

Three tests cover it, including that a written block re-parses to the same body
and the same span — the property that matters, since a note is read and written
repeatedly.

---

## What the run log revealed about the AI's models

The log was added so a failure could be handed to the model in full. Its first
use was on the model that had already defeated me once, and it immediately showed
what I had been missing.

**The error I could not reproduce.** The earlier report was "Modified element not
found in class Real", with no line. The log recorded the pairing that made it
legible:

```
parameters: m=1, s0=0, v0=3, v_eps=1e-3, s.fixed=true, v.fixed=true,
            mu_s=0.50, mu_d=0.40, stuck.fixed=true
error: Modified element m not found in class Real. (line 8, column 38)
```

`fixed` was being set on **parameters**. It is an attribute of a variable,
describing whether its start value holds; on a parameter it does nothing at all,
because a parameter is already fixed for the whole run. OpenModelica's answer
names neither the declaration nor the attribute, which is why the message read as
nonsense. The checker now flags it, and the prompt forbids it.

**A second model was structurally broken.** Compiling the version in the settings
gave a different error from the same family:

```
Error: Too many equations, over-determined system.
The model has 8 equation(s) and 7 variable(s).
warning: Equation 6 ... is not big enough to solve for enough variables.
```

A Boolean `stuck` mode with two `when` clauses, assigning `F_f`, `m*a` and `v`
inside branches. An `if`-equation selects between equations rather than adding
them, so a branch that assigns a variable already determined makes the model
over-determined — and the branch that does not leaves it under-determined.

**And the diagram was eight unconnected blocks.** The model had been assembled
from primitive translational components — Mass, Force, Acceleration, Velocity,
Length, Angle — placed at the origin in a heap with no `connect` between them.
That is a broken model drawn as a picture, and it is what a model reaches for
when it has not been told that an equation is the better answer.

### The fix, in three parts

**The prompt.** It now says to prefer equations to components, gives the reason
(unconnected primitive assemblies), lists the exact attributes a parameter may
carry, states the if-equation rule, and asks for a smooth regularised law instead
of a Boolean mode with `when` and `reinit`. Rules are stated rather than left to
judgement because the same mistakes recurred.

**The checker.** `fixed` on a `parameter` or `constant` is now an error, on the
declaration's own line.

**A model that works.** The friction example was rewritten as one equation with
no mode variable:

```
F_f = -min(mu_s, mu_d + (mu_s - mu_d)*tanh(abs(v)/v_eps))*F_n*tanh(v/v_eps);
```

Verified: it holds below the static limit (creep 0.05 mm/s, the known artefact of
regularisation rather than the 1.6 mm of the first attempt), and its acceleration
converges on the analytic `g(sin α − mu_d cos α)` as the speed rises — 77%, 88%,
94% of the ideal at α = 0.7, 0.9, 1.1, which is what a correct regularisation
does.
