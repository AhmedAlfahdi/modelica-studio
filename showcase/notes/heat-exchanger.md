# Thermal — heated mass losing heat to ambient

> Thermal: a heated mass losing heat to ambient

**Domain:** <span class="modelica-studio-domain" data-domain="thermal">Thermal</span> · **Simulated span:** 200 s · **Example:** `HeatExchanger`

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
//@ time=200
model HeatExchanger "A heated mass losing heat to ambient by convection"
  Modelica.Thermal.HeatTransfer.Sources.PrescribedHeatFlow heater
    annotation(Placement(transformation(extent={{-60,-10},{-40,10}})));
  Modelica.Thermal.HeatTransfer.Components.HeatCapacitor mass(C=2000, T(start=293.15, fixed=true))
    annotation(Placement(transformation(extent={{-10,10},{10,30}})));
  Modelica.Thermal.HeatTransfer.Components.ThermalConductor loss(G=0.5)
    annotation(Placement(transformation(extent={{-10,-30},{10,-10}})));
  Modelica.Thermal.HeatTransfer.Sources.FixedTemperature ambient(T=293.15)
    annotation(Placement(transformation(extent={{40,-30},{60,-10}})));
  Modelica.Blocks.Sources.Ramp ramp(height=500, duration=100, startTime=10)
    annotation(Placement(transformation(extent={{-90,20},{-70,40}})));
equation
  connect(ramp.y, heater.Q_flow);
  connect(heater.port, mass.port);
  connect(mass.port, loss.port_a);
  connect(loss.port_b, ambient.port);
end HeatExchanger;
```

---

## What this shows

A block of material is heated by a power supply that ramps up over 100 seconds, while a cooler surround steadily draws heat away. It warms, and keeps warming, because the heater outpaces the losses.

### Reading the equations

- `HeatCapacitor mass(C=2000)` — 2000 J/K — a substantial thermal mass.
- `Ramp ramp(height=500, duration=100, startTime=10)` — the heater: nothing for 10 s, then rising to 500 W by t = 110 s, then holding.
- `ThermalConductor loss(G=0.5)` — a poor path to the surroundings — only 0.5 W per kelvin.
- `τ = C/G = 4000 s` — the thermal timescale. It is **much** longer than the 200 s run.

### The point

The parameters decide the answer more than the shape of the formula does. With these values the block would eventually reach 543 K (270 °C), but the run ends after only 5% of one time constant, so it is nowhere near. That is why the curve looks almost straight here: an exponential approached over a short window always does.


---

## The physics

$$C\frac{dT}{dt} = Q(t) - G_c(T - T_{amb})$$

$$\tau = \frac{C}{G_c} = \frac{2000}{0.5} = 4000\ \text{s}$$

$$Q(t) = 5(t - 10)\ \text{W on } [10, 110]\ \text{s, then } 500\ \text{W}$$

The time constant here is 4000 s, not the 250 s you get from C = 500 — the parameters matter more than the formula. With only 2 W/K of cooling, 500 W drives the mass towards 543 K, so the run ends far from equilibrium: an exponential approach is slow precisely where it is most visible.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| τ = C/G_c | `4000 s` | `4000 s` |
| mass.T at t = 60 s | `296.26 K` | `296.2614 K` |
| mass.T at t = 200 s | `327.52 K` | `327.5193 K` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
