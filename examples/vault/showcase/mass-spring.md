# Mechanical — mass on a spring and damper

> Mechanical: a mass on a spring and damper

**Domain:** <span class="modelica-studio-domain" data-domain="mechanical">Mechanical</span> · **Simulated span:** 5 s · **Example:** `MassSpring`

*New to Modelica? Read [Modelica in ten minutes](00-modelica-intro.md) first.*

---

## The model

```modelica
//@ time=5
model MassSpring "Mass on a spring and damper, released from stretch"
  Modelica.Mechanics.Translational.Components.Fixed fixed
    annotation(Placement(transformation(extent={{-60,-10},{-40,10}})));
  Modelica.Mechanics.Translational.Components.Spring spring(c=100, s_rel0=0.5)
    annotation(Placement(transformation(extent={{-20,-10},{0,10}})));
  Modelica.Mechanics.Translational.Components.Mass mass(m=1)
    annotation(Placement(transformation(extent={{20,-10},{40,10}})));
  Modelica.Mechanics.Translational.Components.Damper damper(d=2)
    annotation(Placement(transformation(extent={{-20,-40},{0,-20}})));
equation
  connect(fixed.flange, spring.flange_a);
  connect(spring.flange_b, mass.flange_a);
  connect(damper.flange_a, spring.flange_a);
  connect(damper.flange_b, mass.flange_a);
end MassSpring;
```

---

## What this shows

A mass sits on a spring that is already squashed, with a damper to take energy out. Released from rest, it oscillates about the spring's resting position and slowly settles there.

### Reading the equations

- `Spring spring(c=100, s_rel0=0.5)` — `c` is stiffness in N/m; `s_rel0=0.5` is its **unstretched length**, so at the mass's starting position it is compressed by 0.5 m.
- `Mass mass(m=1)` — 1 kg. Its equation is simply `F = ma`.
- `Damper damper(d=2)` — takes energy out in proportion to speed, which is what makes the oscillation die away.
- `ωₙ = √(c/m) = 10 rad/s` — how fast it *would* oscillate with no damping at all.
- `ζ = d/(2√(cm)) = 0.1` — how much damping there is. Below 1 means it oscillates while decaying.

### The point

The mass starts at position 0 while the spring's natural length is 0.5 m, so the spring is **pre-loaded** and shoves the mass with 50 N from the very first instant. Its initial acceleration is 50 m/s², not zero — the oscillation is centred on 0.5 m, not on 0.


---

## The physics

$$m\ddot{s} = -c(s - s_{rel0}) - d\dot{s}$$

$$\omega_n = \sqrt{c/m} = 10\ \text{rad/s}, \qquad \zeta = \frac{d}{2\sqrt{cm}} = 0.1$$

$$s(t) = s_{rel0} - s_{rel0}\,e^{-\zeta\omega_n t}\left(\cos\omega_d t + \frac{\zeta}{\sqrt{1-\zeta^2}}\sin\omega_d t\right)$$

The mass starts at s = 0 while the spring's free length is 0.5 m, so the spring is **pre-compressed** and pushes with 50 N from rest — the initial acceleration is 50 m/s², not zero. The oscillation is centred on s = 0.5 m, not on zero.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| initial acceleration c·s_rel0/m | `50 m/s²` | `50 m/s²` |
| mass.s at t = 0.2 s | `0.629036 m` | `0.629036 m` |
| mass.s at t = 5 s | `0.4972369 m` | `0.4972 m` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
