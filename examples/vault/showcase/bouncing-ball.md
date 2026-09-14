# Mechanical — a bouncing ball

> Mechanical: a ball bouncing with a coefficient of restitution

**Domain:** Mechanical · **Simulated span:** 3 s · **Example:** `BouncingBall`

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
//@ time=3
model BouncingBall "A ball bouncing on a floor with a restitution coefficient"
  parameter Real e=0.9 "Coefficient of restitution";
  Real h(start=1, fixed=true) "Height above the floor";
  Real v "Vertical velocity";
equation
  der(h) = v;
  der(v) = -9.81;
  when h <= 0 then
    reinit(v, -e*pre(v));
  end when;
end BouncingBall;
```

---

## What this shows

A ball is dropped from 1 m. Each time it hits the floor it rebounds at 90% of the speed it arrived with, so every bounce is lower than the last. Nothing pushes the ball — the whole model is gravity plus one rule about the floor.

**This model has no schematic, and that is correct.** There are no library components in it: no spring, no motor, no mass block. The ball is just two variables — a height and a speed — and the physics is written directly as equations. Other examples (like `MassSpring` or `Electrical`) are built from parts, so they *do* have a diagram. This one is a sentence about a ball.

### Reading the equations

- `Real h(start=1)` — how high the ball is. `start=1` means it begins 1 metre up.
- `Real v` — how fast it is moving, upwards being positive.
- `der(h) = v` — the height changes at exactly the speed. If it moves at 2 m/s, the height grows by 2 each second.
- `der(v) = -9.81` — the speed changes by −9.81 every second, because gravity pulls down. This is the only force.
- `when h <= 0 then` — below this is not an equation — it is an **event**. It fires the instant the ball reaches the floor.
- `reinit(v, -e*pre(v))` — at that instant, set the speed to −0.9 × whatever it was. `pre(v)` means 'the value just before the bounce', which is how you read the old speed while replacing it.

### The point

Because the ball loses 10% of its speed each bounce, it loses 19% of its *height* (0.9² = 0.81). The bounce times get closer and closer together, and in the ideal maths the ball makes infinitely many bounces before coming to rest — which is why the plot's bounces bunch up at the end.


---

## The physics

$$ddot{h} = -g qquad (h > 0)$$

$$h = 0 ;Rightarrow; v mapsto -e,v qquad (	ext{state event})$$

$$t_1 = sqrt{2h_0/g}, qquad h_{n} = e^{2n} h_0, qquad Delta t_{n} = 2e^{n-1}sqrt{2h_0/g}$$

This is a **hybrid** system, not a smooth one: between bounces it is ordinary free fall, but at h = 0 a state event flips the velocity and a `when` clause reinitialises it. The periods form a geometric sequence with ratio e, and the ball comes to rest in **finite time** — infinitely many bounces in a finite interval, the Zeno behaviour of an ideal inelastic impact.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| time to first impact sqrt(2h0/g) | `0.4515 s` | `0.4515 s` |
| rebound height e^2 h0 | `0.8100 m` | `0.8100 m` |
| second rebound e^4 h0 | `0.6561 m` | `0.6561 m` |
| speed just before/after first bounce | `4.43 / 3.99 m/s` | `ratio 0.9` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
