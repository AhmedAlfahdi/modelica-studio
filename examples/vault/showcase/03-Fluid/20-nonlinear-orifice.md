# Fluid — orifice flow under a ramped pressure

> Fluid: orifice flow under a ramped pressure

**Domain:** <span class="modelica-studio-domain" data-domain="fluid">Fluid</span> · **Simulated span:** 12 s · **Example:** `NonlinearOrifice`

*New to Modelica? Read [Modelica in ten minutes](../00-modelica-intro.md) first.*

---

## The model

```modelica
//@ time=12
model NonlinearOrifice "Flow through an orifice under a ramped pressure"
  inner Modelica.Fluid.System system
    annotation(Placement(transformation(extent={{-90,-80},{-70,-60}})));
  Modelica.Fluid.Sources.Boundary_pT supply(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, use_p_in=true, T=293.15)
    annotation(Placement(transformation(extent={{-60,0},{-40,20}})));
  Modelica.Blocks.Sources.Ramp pressure(height=500000, duration=10, offset=101325)
    annotation(Placement(transformation(extent={{-90,40},{-70,60}})));
  Modelica.Fluid.Fittings.SimpleGenericOrifice orifice(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    diameter=0.02, zeta=2.5, use_zeta=true)
    annotation(Placement(transformation(extent={{-10,-10},{10,10}})));
  Modelica.Fluid.Sources.Boundary_pT sink(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, p=101325, T=293.15)
    annotation(Placement(transformation(extent={{40,0},{60,20}})));
equation
  connect(pressure.y, supply.p_in);
  connect(supply.ports[1], orifice.port_a);
  connect(orifice.port_b, sink.ports[1]);
end NonlinearOrifice;
```

---

## What this shows

Water is pushed through a small hole while the supply pressure is steadily raised from 1 to 6 atmospheres. The flow rises too — but nowhere near as fast as the pressure does.

### Reading the equations

- `Ramp pressure(height=500000, offset=101325)` — the supply climbs from 1 bar to 6 bar over 10 s.
- `SimpleGenericOrifice orifice(zeta=2.5, diameter=0.02)` — a 20 mm hole with a resistance coefficient.
- `Boundary_pT sink(p=101325)` — the outlet stays at 1 bar, so the *difference* across the hole is what drives the flow.
- `ṁ ∝ √Δp` — the square-root law of a sharp-edged orifice.

### The point

Five times the pressure gives only √5 ≈ 2.24 times the flow. This is **the** nonlinearity of fluid systems: doubling the effort does not double the result. It is also why doubling a pump's pressure does not double a system's throughput, and why flow meters can infer flow from a pressure measurement using a square root.


---

## The physics

$$\dot m = \frac{A}{\sqrt{\zeta/2}}\sqrt{\rho\,\Delta p}$$

$$\Delta p = \frac{\zeta}{2\rho}\left(\frac{\dot m}{A}\right)^2 \qquad (\text{quadratic in flow})$$

The orifice law is genuinely **nonlinear**: flow goes as √Δp, not Δp. Raising the differential pressure five-fold multiplies the flow by only √5 ≈ 2.24. Equivalently Δp/ṁ² is a constant set by the geometry, which is the convenient form for checking a simulation because it needs no pressure signal at all.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| ṁ/√Δp constant across a 5x range | `const` | `0.008866` |
| Δp/ṁ² constant | `const` | `12721.3 Pa/(kg/s)²` |
| flow ratio for 5x pressure | `√5 = 2.236` | `6.269/2.804 = 2.236` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
