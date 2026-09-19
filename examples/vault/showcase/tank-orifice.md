# Fluid — a tank draining through an orifice

> Fluid: a tank draining through an orifice

**Domain:** <span class="modelica-studio-domain" data-domain="fluid">Fluid</span> · **Simulated span:** 25 s · **Example:** `TankOrifice`

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
//@ time=25
model TankOrifice "A tank draining through an orifice"
  inner Modelica.Fluid.System system
    annotation(Placement(transformation(extent={{-90,-80},{-70,-60}})));
  Modelica.Fluid.Vessels.OpenTank tank(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    crossArea=0.01, height=1, level_start=1, nPorts=1,
    use_T_start=true, T_start=293.15,
    portsData={Modelica.Fluid.Vessels.BaseClasses.VesselPortsData(diameter=0.02)})
    annotation(Placement(transformation(extent={{-40,0},{-20,20}})));
  Modelica.Fluid.Fittings.SimpleGenericOrifice orifice(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    diameter=0.02, zeta=0.5, use_zeta=true)
    annotation(Placement(transformation(extent={{0,-20},{20,0}})));
  Modelica.Fluid.Sources.Boundary_pT sink(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, p=101325, T=293.15, X={1})
    annotation(Placement(transformation(extent={{40,-20},{60,0}})));
equation
  connect(tank.ports[1], orifice.port_a);
  connect(orifice.port_b, sink.ports[1]);
end TankOrifice;
```

---

## What this shows

A narrow tank drains through a hole. This is the classic demonstration that a tank does **not** empty like a leaking battery: the level falls in a curve that reaches zero in a *finite* time.

### Reading the equations

- `OpenTank tank(crossArea=0.01, level_start=1)` — a narrow tank — 100 cm² — so the level moves visibly.
- `SimpleGenericOrifice orifice(zeta=0.5)` — a hole with a known resistance coefficient.
- `Δp = ρgh` — the pressure at the hole comes from the weight of water above it.
- `ṁ ∝ √h` — so the flow is proportional to the **square root** of the depth.

### The point

Because the flow goes as √h, the *square root* of the level falls in a straight line — and a straight line reaches zero. That is the difference between this and a capacitor discharging, which only ever approaches zero. You can see it directly: `√h` drops by 0.0492 every second, evenly, right to the end. The last millimetre takes a long time, but it does get there.


---

## The physics

$$dot m = C_d A sqrt{2ho,Delta p}, qquad Delta p = ho g h$$

$$A_{tank}rac{dh}{dt} = -rac{dot m}{ho} ;Rightarrow; rac{dh}{dt} = -ksqrt{h}$$

$$sqrt{h(t)} = sqrt{h_0} - rac{k}{2}t qquadLongrightarrowqquad t_{empty} = rac{2sqrt{h_0}}{k}$$

A **square-root** discharge law is the whole point: because Torricelli flow goes as √h, the level does not decay exponentially — it reaches **zero in finite time**, with √h falling linearly. That is the signature distinguishing a gravity drain from an RC circuit, and it is measurable directly from the slope of √h.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| √h falls linearly | `constant slope` | `0.04920 per second` |
| ṁ/√h constant | `const` | `0.97971 at every t` |
| predicted empty time | `finite` | `≈20.3 s` |
| level at t = 10 s | `—` | `0.25804 m` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
