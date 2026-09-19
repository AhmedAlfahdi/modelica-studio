# Fluid — tank draining under gravity

> Fluid: water draining from a tank under gravity

**Domain:** <span class="modelica-studio-domain" data-domain="fluid">Fluid</span> · **Simulated span:** 20 s · **Example:** `FluidReservoir`

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
//@ time=20
model FluidReservoir "Water draining from a tank under gravity"
  inner Modelica.Fluid.System system
    annotation(Placement(transformation(extent={{-90,-80},{-70,-60}})));
  Modelica.Fluid.Vessels.OpenTank tank(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    crossArea=0.2, height=1, level_start=0.9, nPorts=1,
    use_T_start=true, T_start=293.15,
    portsData={Modelica.Fluid.Vessels.BaseClasses.VesselPortsData(diameter=0.03)})
    annotation(Placement(transformation(extent={{-30,-10},{-10,10}})));
  Modelica.Fluid.Pipes.StaticPipe pipe(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    length=0.5, diameter=0.03, height_ab=-1)
    annotation(Placement(transformation(extent={{10,-10},{30,10}})));
  Modelica.Fluid.Sources.Boundary_pT drain(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, p=101325, T=293.15, X={1})
    annotation(Placement(transformation(extent={{50,-10},{70,10}})));
equation
  connect(tank.ports[1], pipe.port_a);
  connect(pipe.port_b, drain.ports[1]);
end FluidReservoir;
```

---

## What this shows

A wide tank of water drains through a small pipe at its bottom. The level falls faster at first and more slowly as the water gets shallower — because the shallower it is, the less pressure pushes it out.

### Reading the equations

- `OpenTank tank(crossArea=0.2, level_start=0.9)` — 0.2 m² of surface area and 0.9 m of water to start with — about 180 kg.
- `StaticPipe pipe(height_ab=-1)` — the pipe drops 1 m below the tank's outlet.
- `portsData={...diameter=0.03}` — the outlet is 30 mm across.
- `Boundary_pT drain` — open air at the far end, 1 atmosphere.

### The point

Ideal textbook Torricelli flow would give 4.3 kg/s. Add the losses a real fitting has — the tank's outlet, the pipe's friction, and the water spraying out of the end — and you get 3.16 kg/s. A third of the flow is lost to effects the ideal formula ignores, which is why the measured number is the one to trust.


---

## The physics

$$\rho A_{tank}\frac{dh}{dt} = -\dot m, \qquad \dot m = \rho A_{port}\sqrt{\frac{2gH}{2 + fL/D}}$$

$$H = h + 1.0\ \text{m (pipe drop)}, \qquad (\zeta_{out} + \zeta_{exit}) = 0.5 + 1 = 1.5\ \text{velocity heads}$$

$$m(0) = \rho A_{tank} h_0 = 995.586 \times 0.2 \times 0.9 = 179.205\ \text{kg}$$

Ideal Torricelli flow would give 4.30 kg/s; the tank port, the exit and pipe friction cost 35%, leaving 3.16 kg/s. Because the tank is wide (0.2 m²) the level falls only 34% in 20 s, so the flow rate itself changes little — the level curve is convex, decelerating as the head drops.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| initial mass ρ·A·h₀ | `179.205 kg` | `179.205 kg` |
| mass drained = ρ·A·Δh | `60.513 kg` | `60.513 kg` |
| initial flow rate | `≈3.16 kg/s` | `3.1586 kg/s` |
| level at t = 20 s | `0.596 m` | `0.5961 m` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
