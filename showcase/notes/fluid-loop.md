# Fluid — pumped loop with an orifice

> Fluid: a pumped loop through a pipe and an orifice

**Domain:** <span class="modelica-studio-domain" data-domain="fluid">Fluid</span> · **Simulated span:** 3 s · **Example:** `FluidLoop`

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
model FluidLoop "A pump-driven loop with a rising flow rate"
  inner Modelica.Fluid.System system
    annotation(Placement(transformation(extent={{-90,-80},{-70,-60}})));
  Modelica.Blocks.Sources.Ramp ramp(height=1.5, duration=2, startTime=0.2)
    annotation(Placement(transformation(extent={{-90,20},{-70,40}})));
  Modelica.Fluid.Sources.MassFlowSource_T pump(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, use_m_flow_in=true, T=303.15, X={1})
    annotation(Placement(transformation(extent={{-60,-10},{-40,10}})));
  Modelica.Fluid.Pipes.StaticPipe supply(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    length=3, diameter=0.025, height_ab=1)
    annotation(Placement(transformation(extent={{-10,-10},{10,10}})));
  Modelica.Fluid.Fittings.SimpleGenericOrifice orifice(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    diameter=0.02, zeta=2)
    annotation(Placement(transformation(extent={{25,-10},{45,10}})));
  Modelica.Fluid.Sources.Boundary_pT return_(redeclare package Medium =
        Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, p=101325, T=303.15, X={1})
    annotation(Placement(transformation(extent={{65,-10},{85,10}})));
equation
  connect(ramp.y, pump.m_flow_in);
  connect(pump.ports[1], supply.port_a);
  connect(supply.port_b, orifice.port_a);
  connect(orifice.port_b, return_.ports[1]);
end FluidLoop;
```

---

## What this shows

A pump drives water round a loop through a small orifice. The flow is ramped up to 1.5 kg/s, and the pressure needed across the orifice climbs much faster than the flow does.

### Reading the equations

- `ControlledPump pump` — imposes a flow rate rather than a pressure — think of it as a positive-displacement pump.
- `Ramp ramp(height=1.5, duration=2, startTime=0.2)` — flow rises from 0 to 1.5 kg/s over two seconds.
- `SimpleGenericOrifice orifice(zeta=2.5, diameter=0.02)` — the restriction: a 20 mm hole with a known loss coefficient.
- `Boundary_pT reservoir` / `sink` — both at 1 atmosphere, so only the orifice creates any pressure difference.

### The point

The orifice follows a strict square law — `Δp` divided by flow squared is the same number at every flow rate, 10 177 in SI units. Below about 0.157 kg/s Modelica blends the curve cubically so the maths stays well-behaved near zero flow; that is a numerical device, not physics, and it is why the very lowest points sit slightly off the square law.


---

## The physics

$$\Delta p = \frac{\zeta\rho v^2}{2} = \frac{\zeta}{2\rho}\left(\frac{\dot m}{A}\right)^2 = C\,\dot m^2$$

$$C = 10177\ \text{Pa/(kg/s)}^2 \quad (\text{measured, constant})$$

$$\dot m_{turb} = \frac{\pi}{8}D\mu\times10^4 = 0.157\ \text{kg/s}$$

The orifice law is strictly quadratic in mass flow — measured C is constant to four digits across the whole range (10177 Pa/(kg/s)²). Below ṁ = 0.157 kg/s MSL blends it cubically to keep the derivative finite at zero flow, which is a numerical device, not physics.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| dp ∝ ṁ² across the range | `C = 10177 constant` | `10177 at every point` |
| dp at ṁ = 1.5 kg/s | `22 898 Pa` | `22 898.3 Pa` |
| dp at ṁ = 0.975 kg/s | `9 674 Pa` | `9 674.6 Pa` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
