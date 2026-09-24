# Multiphysics — a resistor heating itself

> Multiphysics: electrical loss heating a thermal mass, one domain into another

**Domain:** <span class="modelica-studio-domain" data-domain="multiphysics">Multiphysics</span> · **Simulated span:** 100 s · **Example:** `ResistorSelfHeating`

*New to Modelica? Read [Modelica in ten minutes](../00-modelica-intro.md) first.*

---

## The model

```modelica
//@ time=100
model ResistorSelfHeating "A resistor self-heating: electrical loss into a thermal mass"
  Modelica.Electrical.Analog.Sources.ConstantVoltage supply(V = 10)
    "Constant 10 V across the resistor"
    annotation(Placement(transformation(extent={{-70,10},{-50,30}}, rotation=-90)));
  Modelica.Electrical.Analog.Basic.Resistor resistor(R = 10, useHeatPort = true)
    "10 ohm resistor; its electrical loss leaves through heatPort"
    annotation(Placement(transformation(extent={{-30,10},{-10,30}}, rotation=90)));
  Modelica.Electrical.Analog.Basic.Ground return_path
    "The return conductor, held at zero potential"
    annotation(Placement(transformation(extent={{-50,-10},{-30,10}})));
  Modelica.Thermal.HeatTransfer.Components.HeatCapacitor body(C = 5, T(start = 293.15, fixed = true))
    "The resistor body: 5 J/K of thermal mass"
    annotation(Placement(transformation(extent = {{20, 20}, {40, 40}})));
  Modelica.Thermal.HeatTransfer.Components.ThermalConductor toAmbient(G = 0.5)
    "0.5 W/K path from the body to the surrounding air"
    annotation(Placement(transformation(extent={{50,10},{70,30}})));
  Modelica.Thermal.HeatTransfer.Sources.FixedTemperature ambient(T = 293.15)
    "Still air at 20 degrees C"
    annotation(Placement(transformation(extent={{100,10},{120,30}})));
equation
  connect(resistor.heatPort, body.port);
  connect(body.port, toAmbient.port_a);
  connect(toAmbient.port_b, ambient.port);
  connect(resistor.p, supply.n);
  connect(resistor.n, supply.p);
  connect(resistor.p, return_path.p);
end ResistorSelfHeating;
```

---

## What this shows

A 10 V supply drives 1 A through a 10 ohm resistor, which turns that current into 10 W of heat. The heat has nowhere to go but into the resistor's own body, which warms up, and from the body into the surrounding air. The temperature rises until the body sheds heat exactly as fast as the current makes it.

**This one is genuinely two models joined.** On the left is an electrical circuit — a supply, a resistor, a return path — and on the right a thermal one: a heat capacity, a path to ambient, and a fixed ambient temperature. Nothing about the left side knows the right exists. They meet at one line, `connect(resistor.heatPort, body.port)`, which is the wire that carries watts instead of amps.

### Reading the equations

- `resistor(R=10, useHeatPort=true)` — 10 ohms, and `useHeatPort` is what gives it a heat port to lose its loss through. Without it the heat would simply vanish, which is the usual electrical-only idealisation.
- `body(C=5)` — how much heat it takes to raise the body's temperature: 5 joules per kelvin. A small part, so it warms quickly.
- `toAmbient(G=0.5)` — how fast heat escapes: 0.5 watts for every kelvin above ambient. Twice the gap, twice the flow.
- `supply(V=10)` and `return_path` — the 10 V source and the wire back to it, which is what makes the current 1 A.
- `P = V*I = 10 W` — the heat being made, every second, from the first instant.

### The point

The temperature climbs by **20 K and stops**, at 313.15 K (40 °C). It stops because 20 K is exactly the gap at which the body sheds `0.5 × 20 = 10 W` — the same 10 W coming in. Before that, more heat arrives than leaves and the surplus warms the body; the surplus shrinks as the gap opens, which is why the curve flattens rather than rising in a straight line.


---

## The physics

$$P_{in} = \frac{V^2}{R} = \frac{10^2}{10} = 10\ \text{W}$$

$$C\frac{dT}{dt} = P_{in} - G\,(T - T_{amb})$$

$$\tau = \frac{C}{G} = \frac{5}{0.5} = 10\ \text{s}, \qquad \Delta T_\infty = \frac{P_{in}}{G} = 20\ \text{K}$$

$$T(t) = T_{amb} + \Delta T_\infty\left(1 - e^{-t/\tau}\right)$$

Two domains, one equation each, joined by a single port. The **electrical** side is instantaneous — Ohm's law has no memory, so the loss is 10 W from the first microsecond. The **thermal** side integrates: that 10 W accumulates in 5 J/K of heat capacity until the body is hot enough to shed it to ambient as fast as it arrives. Nothing couples them but `connect(resistor.heatPort, body.port)`, and the two timescales are what make the model interesting: the current settles in microseconds, the temperature over tens of seconds.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| loss power V^2/R | `10 W` | `10.00 W` |
| time constant C/G | `10 s` | `10 s` |
| body.T at 1 tau | `305.79 K` | `305.79 K` |
| body.T at 2 tau | `310.44 K` | `310.44 K` |
| steady rise P/G | `20 K` | `20 K` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
