# Control — a PID loop driving a first-order plant

> Control: a PID controller driving a first-order plant

**Domain:** <span class="modelica-studio-domain" data-domain="blocks">Control</span> · **Simulated span:** 8 s · **Example:** `ControlLoop`

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
//@ time=8
model ControlLoop "A PID controller driving a first-order plant"
  Modelica.Blocks.Sources.Step setpoint(height=1, startTime=1)
    annotation(Placement(transformation(extent={{-80,30},{-60,50}})));
  Modelica.Blocks.Math.Feedback error
    annotation(Placement(transformation(extent={{-30,30},{-10,50}})));
  Modelica.Blocks.Continuous.PID controller(k=2, Ti=0.5, Td=0.1)
    annotation(Placement(transformation(extent={{10,30},{30,50}})));
  Modelica.Blocks.Continuous.FirstOrder plant(k=1, T=1)
    annotation(Placement(transformation(extent={{50,30},{70,50}})));
  Modelica.Blocks.Continuous.FirstOrder sensor(k=1, T=0.05)
    annotation(Placement(transformation(extent={{50,-30},{30,-10}})));
equation
  connect(setpoint.y, error.u1);
  connect(error.y, controller.u);
  connect(controller.y, plant.u);
  connect(plant.y, sensor.u);
  // Negative feedback: the measured output returns to the subtractor.
  connect(sensor.y, error.u2);
end ControlLoop;
```

---

## What this shows

A setpoint is compared with the measured output, the difference drives a PID controller, and the controller drives the plant. The output comes back to be subtracted. This is the loop everyone draws on a whiteboard — here it is a running system you can watch converge.

### Reading the equations

- `Step setpoint(height=1, startTime=1)` — the command: nothing, then suddenly 1 at t = 1 s.
- `Feedback error` — the subtractor. `u1` is the setpoint, `u2` the measurement, and the output is the difference.
- `PID controller(k=2, Ti=0.5, Td=0.1)` — proportional, integral and derivative action in one block. `Ti` is the integral time, `Td` the derivative time.
- `FirstOrder plant(k=1, T=1)` — the thing being controlled: an ordinary lag with a 1 s time constant.
- `FirstOrder sensor(k=1, T=0.05)` — the measurement path, with its own small lag — real sensors are not instantaneous.
- `connect(sensor.y, error.u2)` — the feedback line. Without it this would be an open loop and the output would never reach the setpoint.

### The point

Follow the error in the table and you can watch each term work. Before the step it is zero. Right after, it is 0.25 — the proportional term pushes hard. By 2 s the output has overshot slightly, and by 8 s the error is **−0.0001**, essentially zero. That vanishing error is the integral term's doing: proportional control alone always leaves a steady offset, because it needs an error to produce any output at all. Tuning `k`, `Ti` and `Td` and re-running is the whole craft of control engineering, and here it takes one edit.


---

## The physics

$$e = r - y, \qquad u = k\left(e + \frac{1}{T_i}\int e\,dt + T_d\frac{de}{dt}\right)$$

$$T\frac{dy}{dt} + y = u \qquad (\text{first-order plant, } T = 1)$$

$$\text{steady state: } y \to r \text{ exactly, because the integral term removes the error}$$

This is the diagram everyone draws and few can point at in a running system. Three blocks and one feedback line: a **setpoint** feeds a subtractor, the error goes to a **PID**, its output drives a **plant**, and the measured output returns to be subtracted. The integral term is what makes the final error zero rather than merely small.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| output follows a step setpoint | `y to 1` | `0.7457 at 1.5 s, 1.0234 at 2 s` |
| steady-state error with integral action | `0` | `−1.03e−4` |
| overshoot for k=2, Ti=0.5, Td=0.1 | `finite` | `9.20%` |
| error before the step | `0` | `0.0000` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
