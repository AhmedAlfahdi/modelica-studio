# Power electronics — step-down chopper

> Electrical: a step-down chopper feeding an RC load

**Domain:** Electrical · **Simulated span:** 0.03 s · **Example:** `BuckConverter`

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
//@ time=0.03
model BuckConverter "A step-down chopper feeding an RC load"
  Modelica.Electrical.PowerConverters.DCDC.ChopperStepDown chopper
    annotation(Placement(transformation(extent={{-20,20},{0,40}})));
  Modelica.Electrical.Analog.Sources.ConstantVoltage supply(V=24)
    annotation(Placement(transformation(extent={{-70,20},{-50,40}})));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{-70,-30},{-50,-10}})));
  Modelica.Electrical.Analog.Basic.Inductor inductor(L=0.002)
    annotation(Placement(transformation(extent={{15,20},{35,40}})));
  Modelica.Electrical.Analog.Basic.Capacitor capacitor(C=0.0005)
    annotation(Placement(transformation(extent={{50,0},{70,20}})));
  Modelica.Electrical.Analog.Basic.Resistor load(R=5)
    annotation(Placement(transformation(extent={{50,-30},{70,-10}})));
  Modelica.Blocks.Sources.Ramp duty(height=0.6, duration=0.001, startTime=0.0005)
    annotation(Placement(transformation(extent={{-70,60},{-50,80}})));
  Modelica.Electrical.PowerConverters.DCDC.Control.SignalPWM pwm(f=20000, useConstantDutyCycle=false)
    annotation(Placement(transformation(extent={{-30,60},{-10,80}})));
equation
  connect(supply.p, chopper.dc_p1);
  connect(supply.n, chopper.dc_n1);
  connect(supply.n, ground.p);
  connect(duty.y, pwm.dutyCycle);
  connect(pwm.fire, chopper.fire_p);
  connect(chopper.dc_p2, inductor.p);
  connect(inductor.n, capacitor.p);
  connect(capacitor.n, supply.n);
  connect(inductor.n, load.p);
  connect(load.n, supply.n);
end BuckConverter;
```

---

## What this shows

A 24 V supply is switched on and off 20,000 times a second. On for 60% of each cycle, off for 40% — so the load sees an *average* of about 14.4 V, which is how a chopper makes a lower voltage without wasting the difference as heat.

### Reading the equations

- `ChopperStepDown chopper` — a switch and a freewheeling diode. The switch connects the supply; the diode takes over the current when it opens.
- `SignalPWM pwm(f=20000)` — turns the switch on and off 20,000 times per second.
- `Ramp duty(height=0.6, duration=0.001)` — the on-fraction, ramping from 0 to 0.6 in the first millisecond.
- `Inductor inductor(L=0.002)` — smooths the on/off pulses into a steady current.
- `V_out = D × V_in = 0.6 × 24 = 14.4 V` — the average, which is what the filter passes through.

### The point

At t = 4 ms the output reads **21 V** — well above the 14.4 V 'answer'. That is not a bug: the LC filter has almost no damping (ζ ≈ 0.06) and is still ringing, and a short run catches it on the way up. Extend to 30 ms and it settles at 14.44 V, exactly the prediction. The example's time span was extended for this reason.


---

## The physics

$$\bar{V}_{out} = D \cdot V_{in} = 0.6 \times 24 = 14.4\ \text{V}$$

$$f_{LC} = \frac{1}{2\pi\sqrt{LC}} = 159\ \text{Hz}, \qquad \zeta_{LC} = \frac{1}{2R}\sqrt{\frac{L}{C}} = 0.063$$

$$\tau_{RC} = RC = 2.5\ \text{ms}$$

The averaged model predicts 14.4 V and the simulation reaches 14.40 V — but only after the LC filter has rung down. The ringing is severe (ζ ≈ 0.06, no feedback loop), so a short run shows the output **above** the input-scaled value and looks like a boost. Settling takes roughly 20 ms at these component values.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| output at t = 4 ms (still ringing) | `—` | `21.44 V` |
| output at t = 20 ms | `14.4 V` | `14.118 V` |
| output at t = 30 ms | `14.4 V` | `14.443 V` |
| energy: source = C + L + load | `balanced` | `0.243 = 0.115 + 0.026 + 0.100 J` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
