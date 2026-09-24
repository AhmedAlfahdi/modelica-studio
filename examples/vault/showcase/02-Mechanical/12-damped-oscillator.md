# Mechanical — damped harmonic oscillator

> Mechanical: a mass on a spring with viscous damping

**Domain:** <span class="modelica-studio-domain" data-domain="mechanical">Mechanical</span> · **Simulated span:** 4 s · **Example:** `DampedOscillator`

*New to Modelica? Read [Modelica in ten minutes](../00-modelica-intro.md) first.*

---

## The model

```modelica
//@ time=4
model DampedOscillator "A mass on a spring with viscous damping"
  Modelica.Mechanics.Translational.Components.Mass mass(m=1, s(fixed=true, start=0.1), v(fixed=true))
    annotation(Placement(transformation(extent={{0,-10},{20,10}})));
  Modelica.Mechanics.Translational.Components.Spring spring(c=100, s_rel0=0)
    annotation(Placement(transformation(extent={{-40,-10},{-20,10}})));
  Modelica.Mechanics.Translational.Components.Damper damper(d=2)
    annotation(Placement(transformation(extent={{-40,-40},{-20,-20}})));
  Modelica.Mechanics.Translational.Components.Fixed fixed
    annotation(Placement(transformation(extent={{-70,-10},{-50,10}})));
equation
  connect(fixed.flange, spring.flange_a);
  connect(spring.flange_b, mass.flange_a);
  connect(damper.flange_a, spring.flange_a);
  connect(damper.flange_b, mass.flange_a);
end DampedOscillator;
```

---

## What this shows

A 1 kg mass on a 100 N/m spring, with a damper. Pulled aside by 10 cm and let go, it wobbles, each swing smaller than the last.

### Reading the equations

- `Mass mass(m=1, s(fixed=true, start=0.1))` — `s` is position; `fixed=true` means 'start exactly here', not 'let the solver choose'.
- `Spring spring(c=100)` — a stiff spring. On its own it would oscillate at 10 rad/s, about 1.6 Hz.
- `Damper damper(d=2)` — force proportional to speed — the classic 'viscous' damping.
- `ζ = d/(2√(cm)) = 0.1` — lightly damped. Each full cycle keeps 53% of the amplitude.

### The point

The first instant tells you a lot: the mass is moving at zero speed, so the damper does nothing yet, and the only force is the spring. That gives an initial acceleration of exactly `−c·s₀/m = −10 m/s²`. One measurement pins down the spring and the mass together before any oscillation is looked at.


---

## The physics

$$m\ddot{s} + d\dot{s} + c\,s = 0$$

$$\omega_n = \sqrt{c/m} = 10\ \text{rad/s}, \qquad \zeta = \frac{d}{2\sqrt{cm}} = 0.1$$

$$\omega_d = \omega_n\sqrt{1-\zeta^2} = 9.9499\ \text{rad/s}, \qquad s(t) = s_0 e^{-\zeta\omega_n t}\cos(\omega_d t + \varphi)$$

$$\text{decay per cycle} = e^{-2\pi\zeta/\sqrt{1-\zeta^2}}$$

Released from rest at s = 0.1 m the mass starts with acceleration **−c·s₀/m = −10 m/s²** — the spring's force and nothing else, since the damper does no work at zero velocity. That single value pins the model's stiffness and mass together before any oscillation is examined.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| initial acceleration −c·s0/m | `−10.0000 m/s²` | `−10.0000 m/s²` |
| decay of amplitude per cycle | `0.53180` | `0.53160` |
| damped period 2π/ω_d | `0.63148 s` | `0.63144 s (two half-cycles)` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
