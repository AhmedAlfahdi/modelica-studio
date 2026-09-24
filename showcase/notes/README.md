# Modelica Studio — worked examples

Each note derives the physics of one built-in example, embeds the model as a
live block, and shows the numbers an independent calculation predicts beside
the numbers the simulation produces.

The point is not that the plots look plausible. It is that every example has a
**closed-form answer**, computed without running the simulation, and the two
agree to the precision the solver offers. Where they could not agree — a
chaotic double pendulum, a correlation-limited pipe friction — the note says so
and checks an invariant instead.

**Start here:** [Modelica in ten minutes](00-modelica-intro.md) — what the language
is, how a model becomes a result, and how to read the notes.

**Then:** [Learning a subject with a simulator](01-learning-with-a-simulator.md) —
a worked demonstration of using this to learn something new, with two aerospace
models.

Notes are grouped into a folder per domain and numbered in the order the studio's
**Examples** picker lists them, so the two read the same way.

| Domain | Examples |
|---|---|
| <span class="modelica-studio-domain" data-domain="electrical">Electrical</span> | [01 · Electrical](01-Electrical/01-electrical.md) · [02 · RLC](01-Electrical/02-rlc.md) · [03 · Rectifier](01-Electrical/03-rectifier.md) · [04 · SineAC](01-Electrical/04-sine-ac.md) · [05 · BuckConverter](01-Electrical/05-buck-converter.md) · [06 · BatteryDischarge](01-Electrical/06-battery-discharge.md) · [07 · DCMotor](01-Electrical/07-dcmotor.md) · [08 · HalfWaveRectifier](01-Electrical/08-half-wave-rectifier.md) |
| <span class="modelica-studio-domain" data-domain="mechanical">Mechanical</span> | [09 · MassSpring](02-Mechanical/09-mass-spring.md) · [10 · RotationalPendulum](02-Mechanical/10-rotational-pendulum.md) · [11 · MassSpringDamper](02-Mechanical/11-mass-spring-damper.md) · [12 · DampedOscillator](02-Mechanical/12-damped-oscillator.md) · [13 · ForcedOscillator](02-Mechanical/13-forced-oscillator.md) · [14 · DampedBounce](02-Mechanical/14-damped-bounce.md) · [15 · GearTrain](02-Mechanical/15-gear-train.md) |
| <span class="modelica-studio-domain" data-domain="fluid">Fluid</span> | [16 · FluidPipe](03-Fluid/16-fluid-pipe.md) · [17 · FluidReservoir](03-Fluid/17-fluid-reservoir.md) · [18 · FluidLoop](03-Fluid/18-fluid-loop.md) · [19 · TankOrifice](03-Fluid/19-tank-orifice.md) · [20 · NonlinearOrifice](03-Fluid/20-nonlinear-orifice.md) · [21 · PipeFriction](03-Fluid/21-pipe-friction.md) |
| <span class="modelica-studio-domain" data-domain="thermal">Thermal</span> | [22 · Thermal](04-Thermal/22-thermal.md) · [23 · HeatConduction](04-Thermal/23-heat-conduction.md) · [24 · HeatExchanger](04-Thermal/24-heat-exchanger.md) |
| <span class="modelica-studio-domain" data-domain="other">State machine</span> | [25 · StateMachine](05-State-machine/25-state-machine.md) |
| <span class="modelica-studio-domain" data-domain="other">Mechanics</span> | [26 · DoublePendulum](06-Mechanics/26-double-pendulum.md) |
| <span class="modelica-studio-domain" data-domain="aerospace">Aerospace</span> | [27 · AirfoilLift](07-Aerospace/27-airfoil-lift.md) · [28 · Phugoid](07-Aerospace/28-phugoid.md) |
| <span class="modelica-studio-domain" data-domain="blocks">Control</span> | [29 · ControlLoop](08-Control/29-control-loop.md) |
| <span class="modelica-studio-domain" data-domain="multiphysics">Multiphysics</span> | [30 · ResistorSelfHeating](09-Multiphysics/30-resistor-self-heating.md) |

---

## Block options

A block's first line may be a directive. The time span matters most: without one
a block inherits whatever span the Studio last used, so a 1 s RC circuit and a
3000 s thermal model would share a window and one of them would plot a straight
line.

```modelica
//@ time=20 height=400
model T
end T;
```

`time` (or `t`) sets the span in seconds, `height` the canvas height, and
`result`/`edit` choose whether the plot starts open. The directive is read from
inside the block because Obsidian does not pass a fence's info string to a
code-block processor — ```modelica time=20 reaches the plugin as just
`modelica`.

---

## How the verification works

`test/audit.test.mjs` runs every example and asserts 97 numeric checks against
values derived independently of the plugin. Three of those expectations were
themselves wrong when first written, and were corrected only after the
discrepancy was traced to the expectation rather than the simulation — a series
RLC that rings despite ζ > 1, a thermal time constant computed with the wrong
capacitance, and a two-mass stretch that is not `F/c`. Those corrections are
recorded in the test file so the same rule is not misapplied again.
