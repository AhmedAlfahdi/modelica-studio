# Electrical machines — permanent-magnet DC machine

> Electrical: a permanent-magnet DC machine accelerating a load

**Domain:** <span class="modelica-studio-domain" data-domain="electrical">Electrical</span> · **Simulated span:** 20 s · **Example:** `DCMotor`

*New to Modelica? Read [Modelica in ten minutes](../00-modelica-intro.md) first.*

---

## The model

```modelica
//@ time=20
model DCMotor "A permanent-magnet DC machine driving a load"
  Modelica.Electrical.Machines.BasicMachines.DCMachines.DC_PermanentMagnet motor(
    VaNominal=24, IaNominal=5, wNominal=300, useSupport=true, useThermalPort=false)
    annotation(Placement(transformation(extent={{-20,0},{0,20}})));
  Modelica.Mechanics.Rotational.Components.Inertia load(J=0.002)
    annotation(Placement(transformation(extent={{20,0},{40,20}})));
  Modelica.Mechanics.Rotational.Sources.QuadraticSpeedDependentTorque drag(
    tau_nominal=0.05, w_nominal=300)
    annotation(Placement(transformation(extent={{60,0},{80,20}})));
  Modelica.Mechanics.Rotational.Components.Fixed housing
    annotation(Placement(transformation(extent={{-20,-20},{0,0}})));
  Modelica.Electrical.Analog.Sources.RampVoltage supply(V=24, duration=0.5, startTime=0.1)
    annotation(Placement(transformation(extent={{-20,30},{0,50}})));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{-50,20},{-30,40}})));
equation
  connect(supply.p, motor.pin_ap);
  connect(supply.n, motor.pin_an);
  connect(supply.n, ground.p);
  connect(motor.support, housing.flange);
  connect(motor.flange, load.flange_a);
  connect(load.flange_b, drag.flange);
end DCMotor;
```

---

## What this shows

A permanent-magnet DC motor is switched on through a voltage ramp and spins up a small load. It starts with a large current because a stationary motor has no back-EMF to oppose the supply.

### Reading the equations

- `DC_PermanentMagnet motor(VaNominal=24, IaNominal=5, wNominal=300)` — a machine rated 24 V, 5 A, 300 rad/s. Modelica derives its torque constant from these.
- `Ra = 0.2 Ω` — the armature resistance. Set explicitly, and it is what limits the starting current.
- `Inertia load(J=0.002)` — a light load, but the machine's *own* rotor is 0.15 kg·m² — 75 times bigger.
- `QuadraticSpeedDependentTorque drag(tau_nominal=0.05, w_nominal=300)` — a fan-like load: torque grows with the square of speed, reaching 0.05 N·m at rated speed.

### The point

A motor at standstill generates no back-EMF, so at the first instant the full 24 V sits across 0.2 Ω — a 120 A inrush, 24 times the rated current. Real drives limit this, because the heat is enormous. Here it is left visible. The machine's own rotor inertia dominates the load, so it takes about 2.7 s to reach its operating point near 300 rad/s; a 1.5 s run would only catch the ramp.


---

## The physics

$$L_a\frac{di_a}{dt} = v_a - k\,\omega - R_a i_a, \qquad J\frac{d\omega}{dt} = k\,i_a - \tau_{load}$$

$$k = \frac{V_{a,nom} - R_a I_{a,nom}}{\omega_{nom}} = 0.0764\ \text{V·s/rad}$$

$$\text{stall current} = \frac{V_a}{R_a} = \frac{24}{0.2} = 120\ \text{A}$$

The machine's rotor inertia dominates (0.15 kg·m² against a 0.002 kg·m² load), so it accelerates over seconds, not milliseconds — a 1.5 s run shows only the ramp. The start-up inrush is genuine and unwelcome in reality: 24 V across 0.2 Ω is 120 A, which is why real drives limit current. Series resistance and a current limit are absent by design here so the transient is visible.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| speed at t = 20 s (rated 300) | `303.6 rad/s` | `303.566 rad/s` |
| armature current at t = 20 s | `≈0.65 A` | `0.6467 A` |
| free-running speed at 24 V | `≈313 rad/s` | `313.04 rad/s` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
