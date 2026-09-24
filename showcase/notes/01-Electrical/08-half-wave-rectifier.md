# Electrical — a diode rectifier and its load

> Electrical: a diode rectifier and its load

**Domain:** <span class="modelica-studio-domain" data-domain="electrical">Electrical</span> · **Simulated span:** 0.06 s · **Example:** `HalfWaveRectifier`

*New to Modelica? Read [Modelica in ten minutes](../00-modelica-intro.md) first.*

---

## The model

```modelica
//@ time=0.06
model HalfWaveRectifier "One diode, one load, referenced to the source"
  Modelica.Electrical.Analog.Sources.SineVoltage source(V=12, f=50)
    annotation(Placement(transformation(extent={{-60,0},{-40,20}})));
  Modelica.Electrical.Analog.Semiconductors.Diode d
    annotation(Placement(transformation(extent={{-10,0},{10,20}})));
  Modelica.Electrical.Analog.Basic.Resistor load(R=100)
    annotation(Placement(transformation(extent={{30,0},{50,20}})));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{30,-40},{50,-20}})));
equation
  connect(source.p, d.p);
  connect(d.n, load.p);
  connect(load.n, ground.p);
  connect(source.n, ground.p);
end HalfWaveRectifier;
```

---

## What this shows

A diode, a resistor and an AC source — three components, and the simplest circuit that shows what a diode is for. On the positive half of the cycle the diode conducts and the load sees the supply; on the negative half it blocks, and the load sees nothing. Out comes a one-way pulse train.

### Reading the equations

- `SineVoltage source(V=12, f=50)` — 12 V amplitude at 50 Hz — one cycle every 20 ms. `V` is the peak, not the RMS.
- `Diode d` — the one-way valve. Its `p` pin is the anode, so current flows `p` to `n` only.
- `Resistor load(R=100)` — the useful output. It carries current only while the diode conducts.
- `Ground ground` — the reference. Both the source's return and the load's return tie to it, so the load voltage is measured against the same zero the source is.

### The point

The diode costs a **forward drop**: at 0.115 A it takes about 0.466 V, which is why the peak is 11.534 V rather than 12. It is also not perfect in reverse — Modelica's diode is a Shockley device with a saturation current, so the blocked half leaks about a microamp and the load sits 0.1 mV below zero rather than at exactly zero. Textbook diodes are idealisations; this one is not. That drop is a real design cost — it is a fixed tax on the voltage, so it hurts far more at 5 V than at 240 V. It is also why a bridge rectifier (four diodes) is used when you want to use both halves of the cycle: it doubles the output pulses but charges you two diode drops instead of one.


---

## The physics

$$V_{out} = V_{source} - V_{diode} \quad \text{when } V_{source} > V_{diode}$$

$$V_{out} = 0 \quad \text{otherwise (the diode blocks)}$$

This is the smallest circuit that shows what a diode is *for*. Positive half: the diode conducts and the load sees the source minus the diode's forward drop. Negative half: the diode blocks and the load sees nothing. One component turns an alternating supply into a one-way one.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| peak output at the +12 V peak | `12 − 0.466` | `11.5338 V` |
| output at the −12 V peak | `0 (blocked)` | `−0.0001 V` |
| diode forward drop at 0.115 A | `≈0.466 V` | `0.466 V` |
| conduction | `half the cycle` | `positive half only` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
