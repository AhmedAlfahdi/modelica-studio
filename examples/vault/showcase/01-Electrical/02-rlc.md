# Electrical — series RLC step response

> Electrical: series RLC step response with ringing

**Domain:** <span class="modelica-studio-domain" data-domain="electrical">Electrical</span> · **Simulated span:** 0.05 s · **Example:** `RLC`

*New to Modelica? Read [Modelica in ten minutes](../00-modelica-intro.md) first.*

---

## The model

```modelica
//@ time=0.05
model RLC "Series RLC circuit: underdamped step response"
  Modelica.Electrical.Analog.Sources.StepVoltage source(V=10, startTime=0.001)
    annotation(Placement(transformation(extent={{-80,0},{-60,20}}, rotation=-90)));
  Modelica.Electrical.Analog.Basic.Resistor resistor(R=10)
    annotation(Placement(transformation(extent={{-40,20},{-20,40}})));
  Modelica.Electrical.Analog.Basic.Inductor inductor(L=0.1)
    annotation(Placement(transformation(extent={{0,20},{20,40}})));
  Modelica.Electrical.Analog.Basic.Capacitor capacitor(C=0.001)
    annotation(Placement(transformation(extent={{40,20},{60,40}})));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{50,-40},{70,-20}})));
equation
  connect(inductor.n, capacitor.p);
  connect(source.p, resistor.p) annotation(Line(points={{-70,10},{-70,30},{-55,30},{-40,30}}));
  connect(resistor.n, inductor.p);
  connect(capacitor.n, ground.p);
  connect(source.n, ground.p) annotation(Line(points={{-70,-10},{-70,-20},{-5,-20},{60,-20}}));
end RLC;
```

---

## What this shows

A resistor, an inductor and a capacitor in series, switched on. Energy sloshes back and forth between the capacitor's voltage and the inductor's current, while the resistor drains it away.

### Reading the equations

- `StepVoltage source(V=10, startTime=0.001)` — the supply switches on 1 ms into the run.
- `Inductor inductor(L=0.1)` — resists *changes* in current, and stores energy in a magnetic field.
- `Capacitor capacitor(C=0.001)` — resists changes in voltage, and stores energy in an electric field.
- `ζ = (R/2)·√(C/L) = 0.5` — the damping ratio — **below** 1, so the circuit is underdamped: the step overshoots by 16% and then rings down.

### The point

**The overshoot is the physics — and the numbers have to be right for that to mean anything.** ζ = 0.5 is what (R/2)·√(C/L) gives. An earlier version of this note printed 1.58 (a factor of ten out), called the circuit overdamped, and then invented a rule about series RLCs to explain why it rang anyway. No special rule is needed: ζ < 1 is enough. When a check disagrees with a note, re-derive the note's arithmetic before believing either.


---

## The physics

$$L\frac{di}{dt} + Ri + \frac{1}{C}\int i\,dt = V$$

$$\alpha = \frac{R}{2L} = 50\ \text{s}^{-1}, \qquad \omega_0 = \frac{1}{\sqrt{LC}} = 100\ \text{rad/s}$$

$$\omega_d = \sqrt{\omega_0^2 - \alpha^2} = 86.60\ \text{rad/s}, \qquad \zeta = \frac{\alpha}{\omega_0} = 0.5$$

$$v_C(t) = V\left[1 - e^{-\alpha t}\left(\cos\omega_d t + \frac{\alpha}{\omega_d}\sin\omega_d t\right)\right]$$

ζ = (R/2)·√(C/L) = 0.5 — **below** 1, so this is an ordinary underdamped second-order system and it overshoots by 16%, to 11.63 V, one 36 ms quarter-period after the step. The ringing decays with τ = 1/α = 20 ms. An earlier version of this note said ζ = 1.58 and explained the overshoot with a rule about series RLCs; the arithmetic was wrong by a factor of ten and the rule was invented to defend it. The closed form below is what the check uses — never a remembered rule.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| capacitor.v at t = 5 ms | `0.6941 V` | `0.6941 V` |
| capacitor.v at t = 20 ms | `8.0618 V` | `8.0618 V` |
| capacitor.v at t = 50 ms | `10.8344 V` | `10.8344 V` |
| ζ from R, L, C | `0.5` | `0.5` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
