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

| Domain | Examples |
|---|---|
| Electrical | [Electrical](electrical.md), [RLC](rlc.md), [Rectifier](rectifier.md), [SineAC](sine-ac.md), [BuckConverter](buck-converter.md), [BatteryDischarge](battery-discharge.md), [DCMotor](dcmotor.md), [HalfWaveRectifier](half-wave-rectifier.md) |
| Mechanical | [MassSpring](mass-spring.md), [RotationalPendulum](rotational-pendulum.md), [MassSpringDamper](mass-spring-damper.md), [DoublePendulum](double-pendulum.md), [DampedOscillator](damped-oscillator.md), [ForcedOscillator](forced-oscillator.md), [DampedBounce](damped-bounce.md), [GearTrain](gear-train.md) |
| Fluid | [FluidPipe](fluid-pipe.md), [FluidReservoir](fluid-reservoir.md), [FluidLoop](fluid-loop.md), [TankOrifice](tank-orifice.md), [NonlinearOrifice](nonlinear-orifice.md), [PipeFriction](pipe-friction.md) |
| Thermal | [Thermal](thermal.md), [HeatConduction](heat-conduction.md), [HeatExchanger](heat-exchanger.md) |
| Discrete | [StateMachine](state-machine.md) |
| Aerospace | [AirfoilLift](airfoil-lift.md), [Phugoid](phugoid.md) |
| Control | [ControlLoop](control-loop.md) |

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

`test/audit.test.mjs` runs every example and asserts 88 numeric checks against
values derived independently of the plugin. Three of those expectations were
themselves wrong when first written, and were corrected only after the
discrepancy was traced to the expectation rather than the simulation — a series
RLC that rings despite ζ > 1, a thermal time constant computed with the wrong
capacitance, and a two-mass stretch that is not `F/c`. Those corrections are
recorded in the test file so the same rule is not misapplied again.
