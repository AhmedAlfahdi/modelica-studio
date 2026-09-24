# Mechanical — a motor driving a load through a gearbox

> Mechanical: a motor driving a load through a 5:1 gearbox

**Domain:** <span class="modelica-studio-domain" data-domain="mechanical">Mechanical</span> · **Simulated span:** 10 s · **Example:** `GearTrain`

*New to Modelica? Read [Modelica in ten minutes](../00-modelica-intro.md) first.*

---

## The model

```modelica
//@ time=10
model GearTrain "A motor driving a load through a gearbox"
  Modelica.Mechanics.Rotational.Sources.TorqueStep motor(stepTorque=10, startTime=0.2)
    annotation(Placement(transformation(extent={{-80,-10},{-60,10}})));
  Modelica.Mechanics.Rotational.Components.Inertia motorInertia(J=0.1)
    annotation(Placement(transformation(extent={{-50,-10},{-30,10}})));
  Modelica.Mechanics.Rotational.Components.IdealGear gear(ratio=5)
    annotation(Placement(transformation(extent={{-15,-10},{5,10}})));
  Modelica.Mechanics.Rotational.Components.Inertia loadInertia(J=2)
    annotation(Placement(transformation(extent={{20,-10},{40,10}})));
  Modelica.Mechanics.Rotational.Components.SpringDamper bearing(c=200, d=20)
    annotation(Placement(transformation(extent={{50,-10},{70,10}})));
  // The whole chain sits 10 units left of where it started: the frame used to reach
  // x = 110, outside the ±100 box a Modelica diagram is drawn in.
  Modelica.Mechanics.Rotational.Components.Fixed frame
    annotation(Placement(transformation(extent={{80,-10},{100,10}})));
equation
  connect(motor.flange, motorInertia.flange_a);
  connect(motorInertia.flange_b, gear.flange_a);
  connect(gear.flange_b, loadInertia.flange_a);
  connect(loadInertia.flange_b, bearing.flange_a);
  connect(bearing.flange_b, frame.flange);
end GearTrain;
```

---

## What this shows

A motor turns a heavy load through a 5:1 gearbox. The gearbox makes the load turn five times slower — and five times harder.

### Reading the equations

- `TorqueStep motor(stepTorque=10, startTime=0.2)` — 10 N·m of drive, switched on at t = 0.2 s.
- `IdealGear gear(ratio=5)` — the gearbox. Ideal means no losses: the power through it is unchanged.
- `Inertia loadInertia(J=2)` — a heavy load, 2 kg·m² — much heavier than the motor's own 0.1.
- `SpringDamper bearing(c=200, d=20)` — the stiffness and damping holding the load against its frame.
- `Fixed frame` — the ground the bearing reacts against.

### The point

The speed ratio is **exactly** 5 at every instant, and the load torque is exactly five times the motor torque — so 10 N·m of motor becomes 50 N·m of load, at one fifth the speed. That is the trade a gearbox makes, and it is why a small motor can move a heavy thing: it is not gaining torque for free, it is spending speed to buy it, and the power (torque × speed) is unchanged.


---

## The physics

$$\omega_a = \text{ratio} \times \omega_b, \qquad \tau_b = \text{ratio} \times \tau_a$$

$$J_a\dot\omega_a = \tau_{motor} - \tau_a, \qquad J_b\dot\omega_b = \tau_b - \tau_{bearing}$$

An ideal gearbox trades speed for torque, and it does so **exactly**: whatever the ratio does to one, it does the inverse to the other, so the power through it is unchanged. That is why a gearbox can let a small motor lift a heavy load — it is not creating torque, it is spending speed to buy it.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| speed ratio ω_motor / ω_load | `5` | `5.0000 at every t` |
| torque ratio τ_load / τ_motor | `5` | `50/10 = 5` |
| steady-state load torque | `50 N·m` | `−50.0000 N·m` |
| settles within the run | `0` | `load.w(10) = 0.00000` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
