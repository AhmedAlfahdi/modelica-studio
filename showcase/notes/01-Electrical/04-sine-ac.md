# Electrical — sine drive into an RL load

> Electrical: a sine drive through an RL load

**Domain:** <span class="modelica-studio-domain" data-domain="electrical">Electrical</span> · **Simulated span:** 0.1 s · **Example:** `SineAC`

*New to Modelica? Read [Modelica in ten minutes](../00-modelica-intro.md) first.*

---

## The model

```modelica
//@ time=0.1
model SineAC "AC circuit: a sine drive through an RL load"
  Modelica.Electrical.Analog.Sources.SineVoltage source(V=230, f=50)
    annotation(Placement(transformation(extent={{-70,20},{-50,40}})));
  Modelica.Electrical.Analog.Basic.Resistor resistor(R=20)
    annotation(Placement(transformation(extent={{-20,20},{0,40}})));
  Modelica.Electrical.Analog.Basic.Inductor inductor(L=0.05)
    annotation(Placement(transformation(extent={{20,20},{40,40}})));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{20,-40},{40,-20}})));
equation
  connect(source.p, resistor.p);
  connect(resistor.n, inductor.p);
  connect(inductor.n, source.n);
  connect(source.n, ground.p);
end SineAC;
```

---

## What this shows

A 50 Hz sine wave drives a resistor and an inductor in series. The inductor fights the current, so the current lags behind the voltage and the two components do not peak at the same moment.

### Reading the equations

- `SineVoltage source(V=230, f=50)` — `V` is the **amplitude**, not the RMS value — so this is 230 V peak, about 163 V RMS.
- `X_L = 2πfL = 15.71 Ω` — the inductor's 'resistance' to alternating current. It grows with frequency.
- `|Z| = √(R² + X_L²) = 25.43 Ω` — the total opposition, combining resistance and reactance — they add like the sides of a triangle, not like plain numbers.
- `φ = 38.15°` — how far the current lags the voltage. At the instant the supply peaks, the current has already started to fall.

### The point

Resistor voltage and inductor voltage are always 90° out of phase, so their peaks never coincide and they do **not** add up to the supply voltage at any instant. The supply's 230 V is split in a way that a simple sum would get wrong.


---

## The physics

$$X_L = 2\pi f L = 15.708\ \Omega, \qquad |Z| = \sqrt{R^2 + X_L^2} = 25.4311\ \Omega$$

$$\phi = \arctan\frac{X_L}{R} = 38.146^\circ, \qquad \hat{I} = \frac{\hat{V}}{|Z|} = 9.0441\ \text{A}$$

$$\hat{V}_R = \hat{I}R = 180.881\ \text{V}, \qquad \hat{V}_L = \hat{I}X_L = 142.064\ \text{V}$$

`SineVoltage`'s `V` parameter is the **amplitude**, not the RMS value — so 230 V here is 163 V RMS. The inductor voltage leads the resistor by 90°, and the two peaks cannot occur at the same instant.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| peak v_R = V·R/|Z| | `180.881 V` | `180.881 V` |
| peak v_L = V·X_L/|Z| | `142.064 V` | `142.063 V` |
| v_R at t = 0.1 s (source zero crossing) | `−111.724 V` | `−111.724 V` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
