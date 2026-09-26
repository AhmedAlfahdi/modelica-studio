# Worked examples
Three models worked through end to end, with the numbers each one produces and where those numbers come from. Every built-in example is re-checked against an independent calculation on every test run — see [Verification](verification.md).

The picture at the top of the README is this model — one of the built-in examples, so
you can open it from **Examples** in the toolbar and run it yourself:

```modelica
//@ time=5
model MassSpringDamper "Two masses coupled by a spring and damper"
  Modelica.Mechanics.Translational.Sources.Force force
    annotation(Placement(transformation(extent={{-80,-10},{-60,10}})));
  Modelica.Mechanics.Translational.Components.Mass mass1(m=1)
    annotation(Placement(transformation(extent={{-40,-10},{-20,10}})));
  Modelica.Mechanics.Translational.Components.SpringDamper coupling(c=50, d=1)
    annotation(Placement(transformation(extent={{-10,-10},{10,10}})));
  Modelica.Mechanics.Translational.Components.Mass mass2(m=2)
    annotation(Placement(transformation(extent={{20,-10},{40,10}})));
  Modelica.Blocks.Sources.Step step(height=1, startTime=0.1)
    annotation(Placement(transformation(extent={{-80,30},{-60,50}})));
equation
  connect(step.y, force.f);
  connect(force.flange, mass1.flange_a);
  connect(mass1.flange_b, coupling.flange_a);
  connect(coupling.flange_b, mass2.flange_a);
end MassSpringDamper;
```

A 1 N force is switched on at 0.1 s and pushes `mass1`; `mass2` is joined to it by
nothing but a spring and damper. **Nothing is bolted down**, which is what makes it
worth reading: the two masses bob relative to each other *and* drift away together,
and the gap between them settles somewhere other than the value a bolted-down end
would give it.

**Reduced mass** — the effective inertia of the relative motion, always smaller than
either mass alone.

$$\mu = \frac{m_1 m_2}{m_1 + m_2} = \frac{2}{3}\ \text{kg}$$

**Centre of mass** — nothing external holds the pair back, so the whole pair drifts
while the gap between them settles.

$$\ddot{x}_{\text{cm}} = \frac{F}{m_1 + m_2} = \frac{1}{3}\ \text{m/s}^2$$

**Steady gap** — the trap, if you expect the spring to carry the whole force.

$$\Delta x = \frac{F\,m_2}{c\,(m_1 + m_2)} = \frac{1}{75}\ \text{m}$$

[`showcase/notes/02-Mechanical/11-mass-spring-damper.md`](../showcase/notes/02-Mechanical/11-mass-spring-damper.md)
works the whole thing through, including the equations and a table comparing them
with what the simulation returns.

---

## Two more examples

Every example below is built in — open it from **Examples** in the toolbar and press
**Simulate** — and every number is re-checked against a real OpenModelica run by
`npm test`, so a stale figure here fails the build rather than misleading a
reader. The closed forms are derived independently of the simulation.

### A series RLC circuit that rings

```modelica
//@ time=0.05
model RLC "Series RLC circuit: underdamped step response"
  Modelica.Electrical.Analog.Sources.StepVoltage source(V=10, startTime=0.001)
    annotation(Placement(transformation(extent={{-80,0},{-60,20}}, rotation=-90)));
  Modelica.Electrical.Analog.Basic.Resistor resistor(R=10)
    annotation(Placement(transformation(extent={{-40,20},{-20,40}})));
  Modelica.Electrical.Analog.Basic.Inductor inductor(L=0.1)
    annotation(Placement(transformation(extent={{0,20},{20,40}})));
  Modelica.Electrical.Analog.Basic.Capacitor capacitor(C=0.001)
    annotation(Placement(transformation(extent={{40,20},{60,40}})));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{50,-40},{70,-20}})));
equation
  connect(inductor.n, capacitor.p);
  connect(source.p, resistor.p);
  connect(resistor.n, inductor.p);
  connect(capacitor.n, ground.p);
  connect(source.n, ground.p);
end RLC;
```

A 10 V step is switched on 1 ms into a series loop of a 10 Ω resistor, a 0.1 H
inductor and a 1 mF capacitor. The damping ratio decides everything, and it is one
line of algebra:

$$\alpha = \frac{R}{2L} = 50\ \text{s}^{-1}, \qquad
\omega_0 = \frac{1}{\sqrt{LC}} = 100\ \text{rad/s}, \qquad
\zeta = \frac{\alpha}{\omega_0} = \frac{R}{2}\sqrt{\frac{C}{L}} = 0.5$$

The damping ratio is below 1, so the step overshoots — by 16.3%, to 11.63 V, one
quarter of a ringing period after the step — and then rings down:

$$\omega_d = \sqrt{\omega_0^2 - \alpha^2} = 86.6\ \text{rad/s}, \qquad
\tau = \frac{1}{\alpha} = 20\ \text{ms}, \qquad
t_{\text{peak}} = \frac{\pi}{\omega_d} = 37\ \text{ms}$$

which is what the plot is checked against, point by point:

$$v_C(t) = V\left[1 - e^{-\alpha t}\left(\cos\omega_d t + \frac{\alpha}{\omega_d}\sin\omega_d t\right)\right]$$

| Quantity | Closed form | OpenModelica |
|---|---|---|
| `capacitor.v` at 5 ms | 0.6941 V | 0.694128 V |
| `capacitor.v` at 20 ms | 8.0618 V | 8.06181 V |
| `capacitor.v` at 50 ms | 10.8344 V | 10.8344 V |
| ζ from R, L, C | 0.5 | 0.5 |

### A resistor heating itself

One model, two domains, joined at a single port — the electrical side is
instantaneous, the thermal side integrates, and the port between them is what makes
it a system rather than two circuits:

```modelica
//@ time=200
model ResistorSelfHeating "A resistor self-heating: electrical loss into a thermal mass"
  Modelica.Electrical.Analog.Sources.ConstantVoltage supply(V = 10)
    annotation(Placement(transformation(extent={{-70,10},{-50,30}}, rotation=-90)));
  Modelica.Electrical.Analog.Basic.Resistor resistor(R = 10, useHeatPort = true)
    annotation(Placement(transformation(extent={{-30,10},{-10,30}}, rotation=90)));
  Modelica.Electrical.Analog.Basic.Ground return_path
    annotation(Placement(transformation(extent={{-50,-10},{-30,10}})));
  Modelica.Thermal.HeatTransfer.Components.HeatCapacitor body(C = 5, T(start = 293.15, fixed = true))
    annotation(Placement(transformation(extent={{20,20},{40,40}})));
  Modelica.Thermal.HeatTransfer.Components.ThermalConductor toAmbient(G = 0.5)
    annotation(Placement(transformation(extent={{50,10},{70,30}})));
  Modelica.Thermal.HeatTransfer.Sources.FixedTemperature ambient(T = 293.15)
    annotation(Placement(transformation(extent={{100,10},{120,30}})));
equation
  connect(resistor.heatPort, body.port);
  connect(body.port, toAmbient.port_a);
  connect(toAmbient.port_b, ambient.port);
  connect(resistor.p, supply.n);
  connect(resistor.n, supply.p);
  connect(resistor.p, return_path.p);
end ResistorSelfHeating;
```

Ten volts across ten ohms is one amp and ten watts, and every watt of it goes into
the body's thermal mass — 5 joules per kelvin — which can shed heat to still air only
at half a watt per kelvin:

$$P = \frac{V^2}{R} = 10\ \text{W}, \qquad
\tau = \frac{C}{G} = 10\ \text{s}, \qquad
\Delta T_\infty = \frac{P}{G} = 20\ \text{K}, \qquad
T(t) = T_\infty + \Delta T_\infty\left(1 - e^{-t/\tau}\right)$$

| Quantity | Closed form | OpenModelica |
|---|---|---|
| `resistor.LossPower` at t = τ | 10 W | 10.0000 W |
| `body.T` at t = τ = 10 s | 305.792 K | 305.793 K |
| `body.T` at t = 2τ | 310.443 K | 310.444 K |
| `body.T` at t = 20τ (steady) | 313.150 K | 313.150 K |
| `resistor.LossPower` − `toAmbient.Q_flow` at t = 3τ | 10 W | 10.0000 W |

The last row is the one worth having: it needs no closed form at all — what the
current makes, less what the body sheds, is what warms it — and it fails if the heat
port is wired to the wrong thing. The 30 notes under
[`showcase/notes/`](../showcase/notes/) carry the same treatment for every example —
the algebra, then the numbers the simulation returns.

---
