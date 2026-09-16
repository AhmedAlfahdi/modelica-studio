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
