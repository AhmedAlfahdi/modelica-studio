# Fluid — water driven through a pipe

> Fluid: a rising mass flow driving water through a pipe

**Domain:** <span class="modelica-studio-domain" data-domain="fluid">Fluid</span> · **Simulated span:** 2 s · **Example:** `FluidPipe`

*New to Modelica? Read [Modelica in ten minutes](../00-modelica-intro.md) first.*

---

## The model

```modelica
//@ time=2
model FluidPipe "Water driven through a pipe by a rising mass flow"
  inner Modelica.Fluid.System system
    annotation(Placement(transformation(extent={{-90,-80},{-70,-60}})));
  Modelica.Blocks.Sources.Ramp ramp(height=1, duration=1, startTime=0.1)
    annotation(Placement(transformation(extent={{-90,20},{-70,40}})));
  Modelica.Fluid.Sources.MassFlowSource_T pump(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, use_m_flow_in=true, T=293.15, X={1})
    annotation(Placement(transformation(extent={{-60,-10},{-40,10}})));
  Modelica.Fluid.Pipes.StaticPipe pipe(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    length=2, diameter=0.03, height_ab=0.5)
    annotation(Placement(transformation(extent={{-10,-10},{10,10}})));
  Modelica.Fluid.Sources.Boundary_pT sink(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, p=101325, T=293.15, X={1})
    annotation(Placement(transformation(extent={{50,-10},{70,10}})));
equation
  connect(ramp.y, pump.m_flow_in);
  connect(pump.ports[1], pipe.port_a);
  connect(pipe.port_b, sink.ports[1]);
end FluidPipe;
```

---

## What this shows

Water is pushed through a 1 m pipe at a flow rate that ramps up from nothing to 1 kg/s. The faster it goes, the more pressure it takes to keep it going.

### Reading the equations

- `MassFlowSource_T pump` — imposes a *flow rate* rather than a pressure — it is the 'pump'.
- `Ramp ramp(height=1, duration=1, startTime=0.1)` — the flow rises smoothly from 0 to 1 kg/s between 0.1 s and 1.1 s.
- `Boundary_pT sink` — the far end, held at a fixed 1 atmosphere.
- `Re ≈ 42 000` — the flow is thoroughly **turbulent**, not smooth and layered.

### The point

The pressure drop depends on a *friction correlation*, not on a law of nature — different books give different formulas that disagree by a few percent. So the honest check here is not the pressure value but a **mass balance**: whatever flows in must flow out, exactly. That is true whatever the correlation says.


---

## The physics

$$\dot{m} = \rho A v, \qquad A = \frac{\pi D^2}{4} = 7.0686\times10^{-4}\ \text{m}^2$$

$$v = \frac{\dot m}{\rho A} = 1.421\ \text{m/s}, \qquad Re = \frac{\rho v D}{\mu} = 42\,441$$

$$\Delta p = f\frac{L}{D}\frac{\rho v^2}{2}, \qquad f \approx 0.0243\ (\text{Swamee–Jain})$$

`StaticPipe` is massless with steady-state momentum dynamics: it evaluates Δp as a function of flow, not the other way round. The friction factor is correlation-limited, so Δp carries a few percent of genuine uncertainty — it is the weakest number in the whole example set, which is why the check below is a mass balance rather than a friction value.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| flow in equals flow out | `m_a = -m_b` | `exact` |
| Reynolds number at 1 kg/s | `42 441 (turbulent)` | `42 441` |
| dp at 1 kg/s: rho g h + Colebrook friction | `6501.4 Pa` | `6499.6 Pa` |
| dp at 0.5 kg/s | `5340.6 Pa` | `5338.9 Pa` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
