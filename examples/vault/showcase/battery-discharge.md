# Electrical — battery discharging into a load

> Electrical: a battery discharging into a load

**Domain:** Electrical · **Simulated span:** 1800 s · **Example:** `BatteryDischarge`

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
//@ time=1800
model BatteryDischarge "A battery powering a resistive load"
  parameter Modelica.Electrical.Batteries.ParameterRecords.CellData cellData(
    Qnom=3600, OCVmax=4.2, OCVmin=3.0, Ri=0.05)
    annotation(Placement(transformation(extent={{-90,60},{-70,80}})));
  Modelica.Electrical.Batteries.BatteryStacks.CellStack battery(
    Ns=3, Np=1, cellData=cellData, useHeatPort=false, SOC(fixed=true, start=1))
    annotation(Placement(transformation(extent={{-20,10},{0,30}})));
  Modelica.Electrical.Analog.Basic.Resistor load(R=15)
    annotation(Placement(transformation(extent={{40,10},{60,30}})));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{40,-20},{60,0}})));
equation
  connect(battery.p, load.p);
  connect(load.n, battery.n);
  connect(battery.n, ground.p);
end BatteryDischarge;
```

---

## What this shows

A three-cell battery powers a resistor. As it drains, its voltage falls, so it pushes less current — the discharge slows itself down.

### Reading the equations

- `CellStack battery(Ns=3, Np=1)` — 3 cells in series, 1 in parallel. Each stores 3600 coulombs.
- `CellData(Qnom=3600, OCVmax=4.2, OCVmin=3.0, Ri=0.05)` — the cell model: 4.2 V full, 3.0 V empty, 0.05 Ω internal resistance each.
- `Resistor load(R=15)` — a fixed resistance — this detail is what makes the discharge self-limiting.
- `SOC(fixed=true, start=1)` — starts fully charged.

### The point

A fixed **resistance** load draws less current as the voltage sags, so the discharge decays roughly exponentially and lasts a long time. A fixed **power** load does the opposite: it draws *more* current as the voltage falls, and the battery collapses suddenly at the end. Same battery, very different curve — the load decides.


---

## The physics

$$OCV(SOC) = OCV_{min} + (OCV_{max}-OCV_{min})\,SOC \quad \text{per cell}$$

$$v_{term} = N_s\,OCV - i\,R_{stack}, \qquad i = \frac{N_s OCV}{R_{stack} + R_{load}}$$

$$\frac{d\,SOC}{dt} = -\frac{i}{Q_{nom}} \quad\Longrightarrow\quad SOC(t) \approx e^{-t/\tau}, \quad \tau = \frac{(R_{stack}+R_{load})Q_{nom}}{OCV_0}$$

Because the load is a fixed **resistance**, the current falls as the open-circuit voltage falls, so the discharge is self-limiting and roughly exponential. A constant-**power** load would do the opposite and accelerate towards empty. The 15 Ω load is chosen so the pack lasts the full 1800 s window.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| terminal voltage at t = 0 | `12.4752 V` | `12.4752 V` |
| current at t = 0 | `−0.831683 A` | `−0.831683 A` |
| SOC at t = 1800 s | `0.608` | `0.608` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
