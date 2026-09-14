# Mechanical — torque step on a rotational spring-damper

> Mechanical: a rotational spring-damper met by a torque step

**Domain:** Mechanical · **Simulated span:** 3 s · **Example:** `RotationalPendulum`

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
//@ time=3
model RotationalPendulum "Pendulum swinging on a revolute joint"
  Modelica.Mechanics.Rotational.Components.Inertia inertia(J=0.5)
    annotation(Placement(transformation(extent={{20,-10},{40,10}})));
  Modelica.Mechanics.Rotational.Components.SpringDamper spring(c=20, d=0.5)
    annotation(Placement(transformation(extent={{-20,-10},{0,10}})));
  Modelica.Mechanics.Rotational.Components.Fixed fixed
    annotation(Placement(transformation(extent={{-60,-10},{-40,10}})));
  Modelica.Mechanics.Rotational.Sources.TorqueStep torque(stepTorque=2, startTime=0.1)
    annotation(Placement(transformation(extent={{60,-10},{80,10}})));
equation
  connect(fixed.flange, spring.flange_a);
  connect(spring.flange_b, inertia.flange_a);
  connect(torque.flange, inertia.flange_b);
end RotationalPendulum;
```

---

## What this shows

A flywheel on a torsional spring, twisted by a torque that switches on at t = 0.1 s. It twists, springs back, and rings down to a stopped position.

### Reading the equations

- `Inertia inertia(J=0.5)` — the rotational equivalent of mass: harder to spin up.
- `SpringDamper spring(c=20, d=0.5)` — a torsional spring that also loses energy as it turns.
- `TorqueStep torque(stepTorque=2, startTime=0.1)` — nothing, then suddenly a steady 2 N·m twist.
- `φ(∞) = τ/c = 0.1 rad` — where it finally stops: the twist at which the spring pushes back exactly as hard as the torque pushes.

### The point

Despite the name there is **no gravity and no pendulum** here. Modelica's rotational library has no gravitational term, so this is a torsional oscillator — the rotational twin of a mass on a spring. The final angle is only 0.1 rad (about 6°), which surprises people who expect a big swing; torque and angle are different quantities and `τ/c` is what sets it.


---

## The physics

$$J\ddot{\varphi} = \tau - c\varphi - d\dot{\varphi}$$

$$\omega_n = \sqrt{c/J} = 6.325\ \text{rad/s}, \qquad \zeta = \frac{d}{2\sqrt{cJ}} = 0.0559$$

$$\varphi(\infty) = \frac{\tau}{c} = \frac{2}{20} = 0.1\ \text{rad}$$

Despite the name there is no gravity here — MSL's rotational library has no gravitational restoring term, so this is a torsional second-order system, the rotational twin of the mass-spring. It settles at τ/c = 0.1 rad, and the step at t = 0.1 s is a genuine discontinuity.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| inertia.phi at t = 60 s | `0.1 rad` | `0.100000 rad` |
| settling: ζ = d/(2√(cJ)) | `0.0559` | `0.0559` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
