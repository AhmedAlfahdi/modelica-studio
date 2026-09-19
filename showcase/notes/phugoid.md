# Aerospace — the phugoid oscillation

> Aerospace: the slow speed-and-height exchange of an aircraft

**Domain:** <span class="modelica-studio-domain" data-domain="aerospace">Aerospace</span> · **Simulated span:** 200 s · **Example:** `Phugoid`

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
//@ time=200
model Phugoid "The slow speed-and-height exchange of an aircraft"
  parameter Real g=9.81 "Gravity";
  parameter Real V0=70 "Trim speed";
  Real V(start=V0+5, fixed=true) "Airspeed, disturbed from trim";
  Real gamma(start=0, fixed=true) "Flight path angle, radians";
  Real h(start=200, fixed=true) "Altitude";
  Real energy "Kinetic plus potential, per unit mass";
equation
  // The classical phugoid approximation. A speed disturbance tilts the flight
  // path, and the tilt trades speed for height. The restoring term carries
  // sqrt(2), which is what sets the famously slow period pi*sqrt(2)*V0/g:
  // without it the oscillation is sqrt(2) times slower again.
  der(V) = -g*sin(gamma);
  der(gamma) = sqrt(2)*g/V0*(V/V0 - 1);
  der(h) = V*sin(gamma);
  // No drag and no thrust: the aircraft exchanges kinetic and potential energy
  // and nothing else, so this must stay constant.
  energy = 0.5*V*V + g*h;
end Phugoid;
```

---

## What this shows

Nudge an aircraft off its trim speed and it does not simply settle back. It trades speed for height, then height for speed, oscillating slowly for minutes. Pilots call it porpoising; engineers call it the phugoid.

### Reading the equations

- `der(V) = -g*sin(gamma)` — climbing at angle gamma costs speed, exactly as a ball thrown upward slows.
- `der(gamma) = sqrt(2)*g/V0*(V/V0 - 1)` — flying faster than trim makes lift exceed weight, so the aircraft curves upward. This is the restoring term, and the `sqrt(2)` is what sets the slow period.
- `der(h) = V*sin(gamma)` — climb rate is speed times flight-path angle.
- `energy = 0.5*V*V + g*h` — kinetic plus potential, per kilogram. Nothing else is in the model, so this must not change.
- `V(start=V0+5, fixed=true)` — the disturbance: 5 m/s fast, straight and level.

### The point

Two things make this worth studying. First, the period is **long** — about 38 seconds here, and it grows with speed, which is why it feels like a slow porpoise rather than a vibration. Second, it is one of the few motions in flight dynamics with an exact invariant: with no drag and no thrust, total energy cannot change, and the simulation holds it to 0.0001%. The speed swings 65 to 75 m/s while the altitude swings 200 to 271 m, and those two numbers are locked together by energy conservation.


---

## The physics

$$\dot V = -g\sin\gamma, \qquad \dot\gamma = \frac{\sqrt2\,g}{V_0}\left(\frac{V}{V_0}-1\right)$$

$$\omega = \left(g\,\frac{\sqrt2\,g}{V_0^2}\right)^{1/2} = \frac{2^{1/4}g}{V_0}$$

$$T = \frac{2\pi V_0}{2^{1/4}g}, \qquad E = \tfrac12 V^2 + gh = \text{const}$$

A disturbed aircraft trades speed for height and back again, slowly enough that a pilot feels it as a gentle porpoising. With no drag and no thrust, **energy is the only thing that must be conserved** — kinetic and potential exchange, and nothing else. That makes this a rare case where a chaotic-looking motion has an exact invariant and an exact period.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| period 2*pi*V0/(2^(1/4)*g) at V0 = 70 | `37.7009 s` | `37.719 s` |
| energy 0.5*V^2 + g*h constant | `const` | `drift 0.0001%` |
| speed range about the trim point | `65 to 75 m/s` | `65.00 to 75.00` |
| amplitude independence of the period | `same at every amplitude` | `37.701 s at 0.001 to 5 m/s` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
