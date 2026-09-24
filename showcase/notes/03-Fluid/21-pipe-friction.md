# Fluid — pipe friction as the flow rises

> Fluid: pressure drop along a pipe as the flow rises

**Domain:** <span class="modelica-studio-domain" data-domain="fluid">Fluid</span> · **Simulated span:** 5 s · **Example:** `PipeFriction`

*New to Modelica? Read [Modelica in ten minutes](../00-modelica-intro.md) first.*

---

## The model

```modelica
//@ time=5
model PipeFriction "Pressure drop along a pipe as the flow rises"
  inner Modelica.Fluid.System system
    annotation(Placement(transformation(extent={{-90,-30},{-70,-10}})));
  Modelica.Fluid.Sources.MassFlowSource_T pump(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, use_m_flow_in=true)
    annotation(Placement(transformation(extent={{-60,0},{-40,20}})));
  Modelica.Blocks.Sources.Ramp flowRamp(height=2, duration=4, startTime=0)
    annotation(Placement(transformation(extent={{-90,40},{-70,60}})));
  Modelica.Fluid.Pipes.StaticPipe pipe(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    length=2, diameter=0.02, height_ab=0)
    annotation(Placement(transformation(extent={{-10,-10},{10,10}})));
  Modelica.Fluid.Sources.Boundary_pT sink(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, p=101325, T=293.15)
    annotation(Placement(transformation(extent={{40,0},{60,20}})));
equation
  connect(flowRamp.y, pump.m_flow_in);
  connect(pump.ports[1], pipe.port_a);
  connect(pipe.port_b, sink.ports[1]);
end PipeFriction;
```

---

## What this shows

The same pipe, with the flow ramped up to eight times its starting rate, to see how the pressure needed grows.

### Reading the equations

- `StaticPipe pipe(length=2, diameter=0.02)` — 2 m of 20 mm bore pipe.
- `Δp = f·(L/D)·(ρv²/2)` — the Darcy–Weisbach law: friction pressure grows with the **square** of velocity.
- `f`, the friction factor — how rough the flow is. This is the interesting part — it is *not* a constant.
- `Re = ρvD/μ` — the Reynolds number: the ratio of inertia to viscosity, which tells you whether the flow is smooth or churning.

### The point

Two effects stack. Pressure rises with velocity squared, so eight times the flow would give 64 times the pressure if `f` stayed put. But `f` **falls** as the flow becomes more turbulent — from 0.0297 down to 0.0226 — so the real rise is 49 times, not 64. Both numbers are in the table, and the gap between them is exactly this second effect.


---

## The physics

$$\Delta p = f\frac{L}{D}\,\frac{\rho v^2}{2}, \qquad v = \frac{\dot m}{\rho A}, \qquad Re = \frac{\rho v D}{\mu}$$

$$\frac{1}{\sqrt{f}} = -2\log_{10}\left(\frac{\epsilon/D}{3.7} + \frac{2.51}{Re\sqrt{f}}\right)$$

Friction is nonlinear for two reasons at once: Δp grows with the **square** of velocity, and the friction factor f itself **falls** as the flow becomes more turbulent. Both are visible as the ramp raises the flow — f drifts down from 0.0297 to 0.0226 while the pressure drop climbs by a factor of 49 for an eight-fold rise in flow.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| f falls with Reynolds number | `decreasing` | `0.0297 → 0.0226` |
| Reynolds at 1 kg/s | `—` | `63 662` |
| Δp ratio for 8x flow | `≈64 (v²)` | `45914/944 = 48.6` |
| Δp steady once flow is steady | `constant` | `45914.5 Pa at t = 4 and 5 s` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
