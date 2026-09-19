# Electrical — RC step response

> Electrical: a capacitor charging through a resistor

**Domain:** <span class="modelica-studio-domain" data-domain="electrical">Electrical</span> · **Simulated span:** 1 s · **Example:** `Electrical`

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
//@ time=1
model Electrical "RC step response: a capacitor charging through a resistor"
  Modelica.Electrical.Analog.Sources.ConstantVoltage source(V=10)
    annotation(Placement(transformation(extent={{-60,20},{-40,40}})));
  Modelica.Electrical.Analog.Basic.Resistor resistor(R=100)
    annotation(Placement(transformation(extent={{-20,20},{0,40}})));
  Modelica.Electrical.Analog.Basic.Capacitor capacitor(C=0.001)
    annotation(Placement(transformation(extent={{20,20},{40,40}})));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{20,-40},{40,-20}})));
equation
  connect(source.p, resistor.p);
  connect(resistor.n, capacitor.p);
  connect(capacitor.n, source.n);
  connect(source.n, ground.p);
end Electrical;
```

---

## What this shows

A 10 V battery charges a capacitor through a 100 Ω resistor. The capacitor starts empty, so current flows fast at first; as it fills, the current drops and the voltage rises, each approaching its final value but never quite arriving.

### Reading the equations

- `ConstantVoltage source(V=10)` — the battery. It holds 10 V no matter what.
- `Resistor resistor(R=100)` — how hard it is for current to flow: 10 V pushes 0.1 A through 100 Ω.
- `Capacitor capacitor(C=0.001)` — stores charge. Its rule is `i = C·der(v)` — current flows only while the voltage is *changing*.
- `connect(...)` — each `connect` does two things silently: it makes the voltages equal at the joined pins, and makes the currents balance (what flows out of one part flows into the next).
- `τ = RC = 0.1 s` — the **time constant** — the natural timescale of the circuit. After one τ it is 63% charged; after five τ, 99.3%.

### The point

A capacitor does not fill up at a steady rate. The fuller it gets, the less voltage is left across the resistor to push current in, so it slows down. That is why the curve is an exponential and not a straight line.


---

## The physics

$$C\,\frac{dv_C}{dt} = \frac{V - v_C}{R}$$

$$\tau = RC = 100 \times 10^{-3} = 0.1\ \text{s}$$

$$v_C(t) = V\left(1 - e^{-t/\tau}\right), \qquad i(t) = \frac{V}{R}e^{-t/\tau}$$

A capacitor integrates current, so a constant voltage through a resistor charges it exponentially — never linearly. After one time constant it reaches 63.2% of the supply; after five, 99.3%.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| capacitor.v at t = 0.1 s | `6.3212 V` | `6.3212 V` |
| capacitor.i at t = 0.1 s | `36.788 mA` | `36.788 mA` |
| capacitor.v at t = 1 s | `10 V` | `9.99955 V` |
| KVL: v_R + v_C | `10 V always` | `10.000 V` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
