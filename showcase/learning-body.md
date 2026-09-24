## The problem with learning a new subject

Learning a new topic from a textbook has a specific failure mode, and it is not
laziness.

You read that lift grows with the angle of attack. You read that drag grows with
the square of the lift coefficient. You believe both. Then you meet a real
aircraft and cannot say **which term dominates**, because each fact was learned
in isolation and never had to compete with the others.

The missing step is the one textbooks cannot give you: **change something and see
what happens.** Turn the angle up. Does the aircraft climb faster, or just burn
more fuel? Where does the stall actually bite? Those are the questions that turn
facts into understanding, and answering them usually means writing a simulation.

That is what a tool like this is for.

## Why equations instead of code

Here is the entire model of a wing generating lift. It is about twenty lines, and
none of it is a procedure:

```text
cl = 2*pi*(alpha - alpha0);            // thin-airfoil theory
cd = 0.008 + cl*cl/(pi*AR*e);          // profile + induced drag
L  = 0.5*rho*V*V*S*cl;                 // lift
D  = 0.5*rho*V*V*S*cd;                 // drag
```

Four statements. No order. No loop. No solver.

If you have the physics, you have the model. There is no gap between "I
understand the equation" and "I can simulate it", which is exactly the gap that
stops people exploring.

And because each line is one physical fact, you can take one away and see what
it was doing. Delete the induced-drag term and drag stops rising with lift.
Change the aspect ratio and watch the same wing behave differently at the same
angle. The model is the physics, so **editing the model is editing your
understanding**.

## Worked example: three questions about a wing

Take the **[AirfoilLift](07-Aerospace/27-airfoil-lift.md)** model. It sweeps the angle of attack
from -5 to 25 degrees over 20 seconds. Press Simulate and the plot answers three
questions that a textbook presents as separate facts.

**1. How much lift does an angle buy me?**

Press Simulate and read two points off the curve. At 5 degrees the lift
coefficient is 0.768. At 10 degrees it is 1.316. Roughly double the angle,
roughly double the lift — because for a thin wing the relation is a straight
line at 2π per radian. You did not have to trust that; you looked.

**2. What does that cost in drag?**

Now read the drag curve at the same two points. At 5 degrees, `cd` is 0.040. At
10 degrees, 0.101 — **two and a half times the drag for double the lift**.

That is the induced-drag term, `cl²/(πARe)`, and this is where an equation
becomes a piece of engineering judgement. Lift grows linearly; the drag that pays
for it grows with its square. So the last few degrees of angle are expensive, and
you can now say *how* expensive rather than knowing vaguely that drag is bad.

**3. What limits all of this?**

Push past 15 degrees and the lift curve turns over. This is the stall: the flow
separates from the upper surface and lift collapses while drag keeps climbing.
The model encodes it as a different curve past `alpha_stall`, and you can see the
moment the trade stops working.

The model also computes the stall **speed**, 26.7 m/s — the slowest this aircraft
can fly straight and level. One line of arithmetic, and it is the number that
sets how long a runway has to be.

Three questions, three answers, one plot, twenty lines. That is the loop a
textbook cannot close.

## Worked example: a motion you can feel

The second model, **[Phugoid](07-Aerospace/28-phugoid.md)**, is stranger and more convincing.

Nudge an aircraft 5 m/s faster than its trim speed and something counter-intuitive
happens. It does not settle back. It pitches up, trades speed for height, slows,
pitches down, trades height back for speed — and repeats, slowly, for minutes.
Pilots call it porpoising. Engineers call it the phugoid.

Before simulating it you would probably guess the oscillation is a few seconds
long. It is **38 seconds**, and the surprising part is that the period grows with
speed, so a faster aircraft porpoises *more* slowly.

The model also contains an exact invariant. With no drag and no thrust, the
aircraft only exchanges kinetic and potential energy, so

```text
0.5*V^2 + 9.81*h  =  constant
```

must hold at every instant. It does, to within 0.01% — which is a much stronger
statement than "the plot looks smooth". From that one line you can predict the
whole shape without solving anything:

| Quantity | Value |
|---|---|
| Speed swing | 65 to 75 m/s |
| Height swing | 200 to 271 m |
| Check: `Δh = (V_max²−V_min²)/(2g)` | 71.355 m predicted, **71.354 m measured** |

Two of the most useful habits in engineering are visible here: **find the
invariant**, and **check the numbers against each other** rather than against how
plausible they look.

## A note on being misled

While writing this example I derived the phugoid period from memory as
`π√2·V₀/g` and got 31.7 s. The simulation said 37.7 s. That is a 19% discrepancy
— the kind of thing that is easy to explain away as "nonlinearity" or "solver
error".

It was neither. The period was amplitude-independent (37.701 s for every
disturbance from 0.001 to 5 m/s), which ruled out nonlinearity immediately, and
the correct linearisation gives `ω = 2^(1/4)·g/V₀`, not `√2·g/V₀`. My memory of
the formula was simply wrong.

This is worth stating plainly because it is the real value of simulating
something you are learning. **A simulation you can check is a memory you cannot
trust.** The audit for these examples records three separate cases where the
hand-derived expectation was wrong and the simulation was right — and each was
found only because a number had to be predicted *before* it was plotted.

## Try it yourself

Both models are live notes. Press **Simulate**, then change something:

- In **[AirfoilLift](07-Aerospace/27-airfoil-lift.md)**: change `AR` from 7 to 4 and watch induced
  drag rise — the same wing, more drag, no change in the lift curve. Then change
  `S` and see the stall speed move.
- In **[Phugoid](07-Aerospace/28-phugoid.md)**: change `V0` from 70 to 140 and see the period
  *double*. Then change the initial disturbance from 5 to 1 and confirm the
  period does **not** change — which is what "linear" means, and is much easier to
  believe once you have watched it happen.
