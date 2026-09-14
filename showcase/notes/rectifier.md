# Electrical — half-wave rectifier

> Electrical: half-wave rectifier charging a capacitor

**Domain:** Electrical · **Simulated span:** 0.2 s · **Example:** `Rectifier`

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
//@ time=0.2
model Rectifier "Half-wave rectifier: diode charging a capacitor"
  Modelica.Electrical.Analog.Sources.SineVoltage source(V=10, f=50)
    annotation(Placement(transformation(extent={{-80,20},{-60,40}})));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{-80,-40},{-60,-20}})));
  Modelica.Electrical.Analog.Semiconductors.Diode diode
    annotation(Placement(transformation(extent={{-30,20},{-10,40}})));
  Modelica.Electrical.Analog.Basic.Resistor resistor(R=100)
    annotation(Placement(transformation(extent={{40,20},{60,40}})));
  Modelica.Electrical.Analog.Basic.Capacitor capacitor(C=0.0001)
    annotation(Placement(transformation(extent={{10,-10},{30,10}})));
equation
  connect(source.p, diode.p);
  connect(diode.n, resistor.p);
  connect(resistor.n, source.n);
  connect(source.n, ground.p);
  connect(diode.n, capacitor.p);
  connect(capacitor.n, source.n);
end Rectifier;
```

---

## What this shows

A diode, a capacitor and a load. The diode lets current through in only one direction, so it passes the positive half of each AC cycle and blocks the negative half — roughly halving the sine wave. The capacitor then holds the voltage up between the peaks.

### Reading the equations

- `SineVoltage source(V=10, f=50)` — a 10 V amplitude sine at 50 Hz — one cycle every 20 ms.
- `Diode diode` — Modelica's diode is a **Shockley** device: the forward drop is logarithmic and depends on current. It is not the 0.7 V step most textbooks draw.
- `Capacitor capacitor(C=0.0001)` — holds charge through the gap between peaks.
- `Resistor load(R=1000)` — the only discharge path, so the capacitor empties with τ = R·C = 0.1 s.

### The point

The capacitor charges to the peak, then discharges through the load while the diode is off. With a 0.1 s time constant against a 20 ms cycle, it loses about three quarters of its charge between peaks — this is a *poorly* smoothed supply. Fitting a larger capacitor is exactly how a real one would be improved, and that is the design lesson here.


---

## The physics

$$i_D = I_s\left(e^{v_D/V_T} - 1\right) + \frac{v_D}{R_{sh}}$$

$$\tau_{discharge} = R_{load}C = 1000 \times 10^{-4} = 0.1\ \text{s}$$

MSL's `Diode` is a Shockley model: the forward drop is **logarithmic and current-dependent**, with no knee voltage. The capacitor charges to the peak less that small drop during conduction, then discharges through the load with τ = 0.1 s — so by 20 ms it has fallen to about 23% of its peak, which is the shape you see.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| capacitor.v at t = 5 ms (charging) | `9.54 V` | `9.5398 V` |
| capacitor.v at t = 10 ms | `6.14 V` | `6.1352 V` |
| discharge τ = R·C | `0.1 s` | `0.1 s` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
