# Discrete — a two-state machine on timers

> State machine: two states alternating on timers

**Domain:** <span class="modelica-studio-domain" data-domain="discrete">Discrete</span> · **Simulated span:** 6 s · **Example:** `StateMachine`

*New to Modelica? Read [Modelica in ten minutes](00-modelica-intro.md) first.*

---

## The model

```modelica
//@ time=6
model StateMachine "A two-state machine driven by timers"
  inner Modelica.StateGraph.StateGraphRoot root
    annotation(Placement(transformation(extent={{-90,60},{-70,80}})));
  Modelica.StateGraph.InitialStep start(nOut=1, nIn=1)
    annotation(Placement(transformation(extent={{-70,0},{-50,20}})));
  Modelica.StateGraph.Transition waitForStart(enableTimer=true, waitTime=1)
    annotation(Placement(transformation(extent={{-40,0},{-20,20}})));
  Modelica.StateGraph.StepWithSignal running(nIn=1, nOut=1)
    annotation(Placement(transformation(extent={{-10,0},{10,20}})));
  Modelica.StateGraph.Transition waitForStop(enableTimer=true, waitTime=2)
    annotation(Placement(transformation(extent={{20,0},{40,20}})));
  Modelica.StateGraph.StepWithSignal stopped(nIn=1, nOut=1)
    annotation(Placement(transformation(extent={{50,0},{70,20}})));
  Modelica.StateGraph.Transition restart(enableTimer=true, waitTime=1)
    annotation(Placement(transformation(extent={{78,0},{98,20}})));
equation
  connect(start.outPort[1], waitForStart.inPort);
  connect(waitForStart.outPort, running.inPort[1]);
  connect(running.outPort[1], waitForStop.inPort);
  connect(waitForStop.outPort, stopped.inPort[1]);
  connect(stopped.outPort[1], restart.inPort);
  connect(restart.outPort, start.inPort[1]);
end StateMachine;
```

---

## What this shows

A simple state machine: it starts, runs for 2 seconds, stops for 1, then starts again — repeating forever. No differential equations at all.

### Reading the equations

- `StateGraph.InitialStep` — where the machine begins.
- `StepWithSignal running` / `stopped` — the states, each with an `active` output that is 1 while it is the current state.
- `Transition waitForStart(waitTime=1)` — a change of state that fires after a delay.
- `inner StateGraphRoot` — the shared 'engine' every state machine needs; it manages which state is active.

### The point

This is the one example that is **discrete** — it has states rather than variables, and its behaviour is a timing table rather than a curve. So the natural check is a truth table: `running.active` is 0 before 1 s, 1 between 1 s and 3 s, 0 again by 4 s, and the cycle repeats every 4 seconds.


---

## The physics

$$\text{initial} \xrightarrow{1\,\text{s}} \text{running} \xrightarrow{2\,\text{s}} \text{stopped} \xrightarrow{1\,\text{s}} \text{initial}$$

$$\text{period} = 1 + 2 + 1 = 4\ \text{s}$$

This is the one example with no differential equations at all. `StateGraph` steps are discrete states with Boolean `active` outputs, and transitions fire on `waitTime`. The whole behaviour is a timing table, so the check is a truth table rather than a numeric tolerance.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| running.active at t = 0.5 s | `0` | `0` |
| running.active at t = 2 s | `1` | `1` |
| stopped.active at t = 4 s | `1` | `1` |
| running.active at t = 6 s (next cycle) | `1` | `1` |
| transition instants (timers 1 s, 2 s, 1 s) | `1 / 3 / 4 s` | `exact` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
