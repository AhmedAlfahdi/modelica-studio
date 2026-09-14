# Thermal — two bodies equalising

> Thermal: two bodies equalising through a conducting wall

**Domain:** Thermal · **Simulated span:** 3000 s · **Example:** `HeatConduction`

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
//@ time=3000
model HeatConduction "Two bodies equalising through a conducting wall"
  Modelica.Thermal.HeatTransfer.Components.HeatCapacitor hot(C=2500, T(start=373.15, fixed=true))
    annotation(Placement(transformation(extent={{-40,20},{-20,40}})));
  Modelica.Thermal.HeatTransfer.Components.HeatCapacitor cold(C=2500, T(start=293.15, fixed=true))
    annotation(Placement(transformation(extent={{40,20},{60,40}})));
  Modelica.Thermal.HeatTransfer.Components.ThermalConductor wall(G=2)
    annotation(Placement(transformation(extent={{-10,-10},{10,10}})));
equation
  connect(hot.port, wall.port_a);
  connect(wall.port_b, cold.port);
end HeatConduction;
```

---

## What this shows

Two identical blocks, one hot and one cold, joined by a bar. Heat flows from the hot one to the cold one until they meet in the middle.

### Reading the equations

- `hot` / `cold` — identical: 2500 J/K each, starting at 100 °C and 20 °C.
- `ThermalConductor wall(G=2)` — the bar between them: 2 W per kelvin of difference.
- `τ = C/(2G) = 625 s` — how long the equalising takes.

### The point

Because the two blocks are **identical**, the sum of their temperatures can never change — energy only moves between them, and equal capacities mean equal temperature swings. So `hot.T + cold.T = 666.30 K` at every instant, not just at the end. That is a much sharper test than checking either temperature alone, and it holds to the last decimal. They settle at the average, 333.15 K.


---

## The physics

$$C\frac{dT_h}{dt} = G(T_c - T_h), \qquad C\frac{dT_c}{dt} = G(T_h - T_c)$$

$$T_h + T_c = \text{const} = 666.30\ \text{K} \qquad (\text{equal capacitances})$$

$$\tau = \frac{C}{2G} = 625\ \text{s}, \qquad T_h(t) = 333.15 + 40\,e^{-t/\tau}$$

With equal capacitances the sum of the temperatures is **exactly** conserved, which is a far sharper test than either temperature alone — it holds at every instant, not just at the end. The equilibrium is the arithmetic mean 333.15 K precisely because the capacitances match.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| T_h + T_c at every t | `666.30 K` | `666.300 K` |
| hot.T at t = 750 s | `345.19 K` | `345.198 K` |
| equilibrium | `333.15 K` | `333.48 / 332.82 K at t=3000` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
