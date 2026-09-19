# Electrical — series RLC step response

> Electrical: series RLC step response with ringing

**Domain:** <span class="modelica-studio-domain" data-domain="electrical">Electrical</span> · **Simulated span:** 0.05 s · **Example:** `RLC`

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
//@ time=0.05
model RLC "Series RLC circuit: underdamped step response"
  Modelica.Electrical.Analog.Sources.StepVoltage source(V=10, startTime=0.001)
    annotation(Placement(transformation(extent={{-80,20},{-60,40}})));
  Modelica.Electrical.Analog.Basic.Resistor resistor(R=10)
    annotation(Placement(transformation(extent={{-40,20},{-20,40}})));
  Modelica.Electrical.Analog.Basic.Inductor inductor(L=0.1)
    annotation(Placement(transformation(extent={{0,20},{20,40}})));
  Modelica.Electrical.Analog.Basic.Capacitor capacitor(C=0.0001)
    annotation(Placement(transformation(extent={{40,20},{60,40}})));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{40,-40},{60,-20}})));
equation
  connect(source.p, resistor.p);
  connect(resistor.n, inductor.p);
  connect(inductor.n, capacitor.p);
  connect(capacitor.n, source.n);
  connect(source.n, ground.p);
end RLC;
```

---

## What this shows

A resistor, an inductor and a capacitor in series, switched on. Energy sloshes back and forth between the capacitor's voltage and the inductor's current, while the resistor drains it away.

### Reading the equations

- `StepVoltage source(V=10, startTime=0.001)` — the supply switches on 1 ms into the run.
- `Inductor inductor(L=0.1)` — resists *changes* in current, and stores energy in a magnetic field.
- `Capacitor capacitor(C=0.0001)` — resists changes in voltage, and stores energy in an electric field.
- `ζ = (R/2)·√(C/L) = 1.58` — the damping ratio. It is greater than 1 — which usually means 'no ringing'.

### The point

**This circuit rings anyway, and that is not a bug.** The rule 'ζ > 1 means no overshoot' belongs to a *parallel* RLC or a second-order low-pass filter. In a **series** RLC the capacitor and inductor are in the same loop, so the response has complex zeros and oscillates whatever ζ is. The plot is right and the folk rule is being applied to the wrong circuit.


---

## The physics

$$L\frac{di}{dt} + Ri + \frac{1}{C}\int i\,dt = V$$

$$\alpha = \frac{R}{2L} = 50\ \text{s}^{-1}, \qquad \omega_0 = \frac{1}{\sqrt{LC}} = 316.2\ \text{rad/s}$$

$$\omega_d = \sqrt{\omega_0^2 - \alpha^2} = 312.25\ \text{rad/s}, \qquad \zeta = \frac{\alpha}{\omega_0} = 0.158$$

$$v_C(t) = V\left[1 - e^{-\alpha t}\left(\cos\omega_d t + \frac{\alpha}{\omega_d}\sin\omega_d t\right)\right]$$

A **series** RLC rings even when ζ > 1. The condition ζ < 1 for oscillation applies to a parallel RLC or a second-order low-pass; here the capacitor and inductor in series give the transfer function complex zeros, so a step overshoots regardless. This is the single most common mixed-up rule in the subject.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| capacitor.v at t = 5 ms | `6.1670 V` | `6.1670 V` |
| capacitor.v at t = 20 ms | `6.5804 V` | `6.5804 V` |
| capacitor.v at t = 50 ms | `10.7373 V` | `10.7373 V` |
| ζ from R, L, C | `0.158114` | `0.158114` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
