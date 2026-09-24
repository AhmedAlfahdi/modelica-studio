# Thermal — body cooling to a fixed ambient

> Thermal: a warm body cooling through a conductor

**Domain:** <span class="modelica-studio-domain" data-domain="thermal">Thermal</span> · **Simulated span:** 2000 s · **Example:** `Thermal`

*New to Modelica? Read [Modelica in ten minutes](00-modelica-intro.md) first.*

---

## The model

```modelica
//@ time=2000
model Thermal "A warm body cooling towards ambient through a conductor"
  Modelica.Thermal.HeatTransfer.Components.HeatCapacitor body(C=1000, T(start=350, fixed=true))
    annotation(Placement(transformation(extent={{-10,20},{10,40}})));
  Modelica.Thermal.HeatTransfer.Components.ThermalConductor conductor(G=2)
    annotation(Placement(transformation(extent={{-10,-10},{10,10}})));
  Modelica.Thermal.HeatTransfer.Sources.FixedTemperature ambient(T=293.15)
    annotation(Placement(transformation(extent={{-50,-10},{-30,10}})));
equation
  connect(body.port, conductor.port_a);
  connect(conductor.port_b, ambient.port);
end Thermal;
```

---

## What this shows

A warm block cools towards a large room held at a fixed temperature. The bigger the temperature gap, the faster it cools; as the gap closes, cooling slows.

### Reading the equations

- `HeatCapacitor body(C=1000, T(start=350))` — the block: 1000 J/K of heat capacity, starting at 350 K (77 °C).
- `ThermalConductor conductor(G=2)` — how easily heat gets out: 2 W per kelvin of difference.
- `FixedTemperature ambient(T=293.15)` — the room, held at 20 °C and unaffected by the block.
- `τ = C/G = 500 s` — the cooling timescale. After 500 s the gap to room temperature has shrunk to 37% of what it was.

### The point

Newton's law of cooling is *linear in the temperature difference*, which is why this produces one clean exponential. At the first instant the gap is 56.85 K, so heat leaves at `2 × 56.85 = 113.7 W` — the largest it will ever be, and easy to check by hand.


---

## The physics

$$C\frac{dT}{dt} = G\,(T_{amb} - T)$$

$$\tau = \frac{C}{G} = \frac{1000}{2} = 500\ \text{s}$$

$$T(t) = T_{amb} + (T_0 - T_{amb})e^{-t/\tau}$$

A single capacitor against a **fixed** temperature gives one clean exponential — unlike two capacitors sharing a conductor, where the equilibrium is an energy-weighted mean. Newton's law of cooling is itself a linearisation; it holds when radiation and convection coefficients are roughly constant.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| time constant C/G | `500 s` | `500 s` |
| body.T at t = 500 s (one tau) | `314.064 K` | `314.064 K` |
| body.T at t = 1000 s (two tau) | `300.843 K` | `300.844 K` |
| body.T at t = 2000 s (four tau) | `294.191 K` | `294.191 K` |
| heat flow at t = 0, G (T0 - Tamb) | `113.70 W` | `113.70 W` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
