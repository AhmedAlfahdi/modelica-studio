# Mechanical — driven oscillator near resonance

> Mechanical: a driven mass on a spring, near resonance

**Domain:** Mechanical · **Simulated span:** 20 s · **Example:** `ForcedOscillator`

*New to Modelica? Read [Modelica in ten minutes](00-modelica-intro.md) first.*

---

## The model

The block below is live. It renders as a diagram, and pressing **Simulate**
runs it through OpenModelica and plots the result — the same model this note
derives an answer for. Its first line is a directive giving the time span that
model is meant to run over, so the block does not depend on whatever span the
Studio last used. (Obsidian does not pass a fence's info string to a code-block
processor, so the option has to live inside the block.)

```modelica
//@ time=20
model ForcedOscillator "A driven mass on a spring, near resonance"
  Modelica.Mechanics.Translational.Components.Mass mass(m=1, s(fixed=true, start=0), v(fixed=true))
    annotation(Placement(transformation(extent={{0,-10},{20,10}})));
  Modelica.Mechanics.Translational.Components.Spring spring(c=100, s_rel0=0)
    annotation(Placement(transformation(extent={{-40,-10},{-20,10}})));
  Modelica.Mechanics.Translational.Components.Damper damper(d=1)
    annotation(Placement(transformation(extent={{-40,-40},{-20,-20}})));
  Modelica.Mechanics.Translational.Components.Fixed fixed
    annotation(Placement(transformation(extent={{-70,-10},{-50,10}})));
  Modelica.Mechanics.Translational.Sources.Force force
    annotation(Placement(transformation(extent={{-10,30},{10,50}})));
  Modelica.Blocks.Sources.Sine drive(amplitude=10, f=1.5)
    annotation(Placement(transformation(extent={{-70,30},{-50,50}})));
equation
  connect(fixed.flange, spring.flange_a);
  connect(spring.flange_b, mass.flange_a);
  connect(damper.flange_a, spring.flange_a);
  connect(damper.flange_b, mass.flange_a);
  connect(drive.y, force.f);
  connect(force.flange, mass.flange_a);
end ForcedOscillator;
```

---

## What this shows

The same mass and spring, but now something pushes it back and forth at a steady rhythm — and the rhythm is set close to the spring's own natural one. The response is far bigger than a slow push would give.

### Reading the equations

- `Sine drive(amplitude=10, f=1.5)` — a 10 N push, reversing 1.5 times a second.
- `ωₙ = 10 rad/s = 1.59 Hz` — the frequency the spring *wants* to oscillate at.
- `r = ω/ωₙ = 0.94` — the drive is running at 94% of the natural frequency — very close to resonance.
- `X = 0.684 m` — the steady swing. A *static* 10 N would only stretch this spring 0.1 m, so the rhythm multiplies the effect by **6.8×**.
- `φ = 40.15°` — the response lags the push. By the time the mass reaches its furthest point, the force has already turned around and is heading back.

### The point

Resonance is not a magical amplification — it is what happens when you push in time with the natural motion. The damper is the only thing limiting the size: in steady state it must remove exactly the energy the push supplies each cycle, and those two numbers balance to within 0.03%.


---

## The physics

$$mddot{s} + ddot{s} + cs = F_0sinomega t$$

$$X = rac{F_0/c}{sqrt{(1-r^2)^2 + (2zeta r)^2}}, qquad r = rac{omega}{omega_n}$$

$$	ext{phase lag} = arctanrac{2zeta r}{1-r^2}, qquad 	ext{dissipation per cycle} = pi F_0 X sinarphi$$

Driving at 1.5 Hz against a 1.59 Hz natural frequency puts r = 0.94, right beside resonance: the response is **6.84 times** the static deflection. In steady state the damper must remove exactly the energy the force supplies each cycle, which closes the energy balance without needing the full transient.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| magnification 1/sqrt((1−r²)²+(2ζr)²) | `6.8411` | `6.8430` |
| steady amplitude X | `0.68411 m` | `0.68430 m` |
| dissipation per cycle π·F0·X·sin φ | `13.857 J` | `13.861 J` |
| phase lag | `40.15°` | `40.15°` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
