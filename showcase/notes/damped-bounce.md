# Mechanical — a ball bouncing until it stops

> Mechanical: a ball bouncing until it comes to rest

**Domain:** <span class="modelica-studio-domain" data-domain="mechanical">Mechanical</span> · **Simulated span:** 10 s · **Example:** `DampedBounce`

*New to Modelica? Read [Modelica in ten minutes](00-modelica-intro.md) first.*

---

## The model

```modelica
//@ time=10
model DampedBounce "A ball bouncing until it comes to rest"
  parameter Real e=0.8 "Coefficient of restitution";
  parameter Real v_min=0.5 "Impact speed below which the floor holds the ball";
  Real h(start=4, fixed=true) "Height above the floor";
  Real v "Vertical velocity";
  Boolean atRest(start=false, fixed=true) "Latches true once the ball has been caught";
equation
  der(h) = if atRest then 0 else v;
  // An ideal bouncing ball never stops: the bounces shrink but go on for ever.
  // A floor that can HOLD the ball needs one extra rule. atRest latches when an
  // impact arrives slower than v_min, and from then on the ball is pinned.
  der(v) = if atRest then 0 else -9.81;
  atRest = h <= 0 and abs(v) < v_min;
  // While the ball is still arriving fast, bounce it. reinit is the only way to
  // replace a state value at an event — setting the derivative to zero would stop
  // the acceleration but leave the ball sinking through the floor.
  when h <= 0 and abs(v) >= v_min then
    reinit(v, -e * v);
  end when;
  when atRest then
    reinit(v, 0);
  end when;
end DampedBounce;
```

---

## What this shows

The same ball, dropped from 4 m, but the floor now GIVES UP catching it once the impacts get gentle enough. It bounces 13 times, each one lower than the last, and then simply sits on the floor.

**No schematic again, and for the same reason.** The ball is two variables; the physics is in the equations. What is new here is a third declaration — a Boolean that remembers whether the ball has been caught.

### Reading the equations

- `Real h(start=4, fixed=true)` — the ball starts 4 m up. Higher than the other example, so there are more bounces to watch.
- `Real v` — the vertical speed, upwards positive.
- `Boolean atRest(start=false)` — a **memory**: false while the ball is bouncing, true once it has settled. A Boolean is a declaration just like `Real`, so it costs nothing on the canvas.
- `atRest = h <= 0 and abs(v) < v_min` — the ball counts as caught when it is on the floor *and* arriving gently.
- `der(v) = if atRest then 0 else -9.81` — gravity keeps pulling until the ball is caught. The `if` is how an equation is switched off without deleting it.
- `der(h) = if atRest then 0 else v` — and the height stops changing too — otherwise the ball would keep sinking through the floor at whatever speed it had.
- `when h <= 0 and abs(v) >= v_min then reinit(v, -e*v)` — still arriving fast: bounce, keeping 80% of the speed.
- `when atRest then reinit(v, 0)` — just been caught: throw the speed away. **`reinit` is the only way to replace a value at an event** — setting the acceleration to zero would stop it speeding up but leave it drifting downwards.

### The point

An ideal ball never stops — the bounces get smaller but there are infinitely many, all squeezed into a finite time. So a ball that *does* stop needs a rule saying when the floor wins. Here it is a speed threshold: the floor catches anything arriving slower than 0.5 m/s. That makes the number of bounces countable (13) and the stopping time predictable (7.63 s), and both match the simulation exactly.


---

## The physics

$$v_0 = \sqrt{2gh_0}, \qquad v_k = e^{k-1}\,v_0$$

$$\Delta t_k = \frac{2\,e^{k-1}v_0}{g}, \qquad t_{rest} = \frac{v_0}{g} + \sum_{k=1}^{n-2} \frac{2e^{k}v_0}{g}$$

$$h_{max,k} = e^{2k}h_0, \qquad \text{caught when } v_k < v_{min}$$

An **ideal** bouncing ball never stops: the bounces shrink geometrically but go on for ever, infinitely many of them in a finite time. A floor that can *hold* the ball therefore needs one extra rule. The model latches a Boolean the first time an impact arrives slower than `v_min`, and from then on the ball is pinned — which is what makes the rest time finite and computable.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| time to first impact sqrt(2h0/g) | `0.9030 s` | `0.9030 s` |
| impact speeds e^(k-1)v0 | `8.8589, 7.0871, 5.6697 …` | `8.8584, 7.0830, 5.6665 …` |
| peak heights e^2 h0 | `2.5600, 1.6384, 1.0486 m` | `2.5600, 1.6384, 1.0486 m` |
| number of rebounds | `13` | `13` |
| time the ball comes to rest | `7.6310 s` | `7.6310 s` |
| final height and speed | `0, 0` | `−1e−10, 0` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
