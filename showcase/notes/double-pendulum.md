# Mechanical — double pendulum (chaotic)

> Mechanics: a double pendulum swinging under gravity

**Domain:** <span class="modelica-studio-domain" data-domain="mechanical">Mechanical</span> · **Simulated span:** 6 s · **Example:** `DoublePendulum`

*New to Modelica? Read [Modelica in ten minutes](00-modelica-intro.md) first.*

---

## The model

```modelica
//@ time=6
model DoublePendulum "Two linked rods swinging under gravity"
  inner Modelica.Mechanics.MultiBody.World world
    annotation(Placement(transformation(extent={{-80,-10},{-60,10}})));
  Modelica.Mechanics.MultiBody.Joints.Revolute upper(
    phi(fixed=true, start=1.2), w(fixed=true))
    annotation(Placement(transformation(extent={{-40,-10},{-20,10}})));
  Modelica.Mechanics.MultiBody.Parts.BodyBox rod1(r={0.5,0,0}, width=0.05)
    annotation(Placement(transformation(extent={{-10,-10},{10,10}})));
  Modelica.Mechanics.MultiBody.Joints.Revolute lower(
    phi(fixed=true, start=0.5), w(fixed=true))
    annotation(Placement(transformation(extent={{20,-10},{40,10}})));
  Modelica.Mechanics.MultiBody.Parts.BodyBox rod2(r={0.5,0,0}, width=0.05)
    annotation(Placement(transformation(extent={{50,-10},{70,10}})));
equation
  connect(world.frame_b, upper.frame_a);
  connect(upper.frame_b, rod1.frame_a);
  connect(rod1.frame_b, lower.frame_a);
  connect(lower.frame_b, rod2.frame_a);
end DoublePendulum;
```

---

## What this shows

Two rods hinged end to end. Released from two different starting angles, the motion is chaotic: wildly unpredictable in detail, yet obeying one simple rule exactly.

### Reading the equations

- `Revolute upper` / `Revolute lower` — two hinges: one to the world, one joining the rods.
- `BodyBox rod1 / rod2` — each rod is 0.5 m and made of steel — about 9.6 kg each, which is heavier than people guess.
- no dampers anywhere — nothing in this model removes energy.

### The point

You cannot check a chaotic system by comparing paths — two correct simulations of it diverge. What *can* be checked is **total energy**, which must never change. Measured drift is 0.83% and it wobbles rather than growing, which is what a good solver looks like. A physically wrong model would show energy climbing steadily, and the motion would eventually fly apart.


---

## The physics

$$M_{11}\ddot{\theta}_1 + M_{12}\ddot{\theta}_2 + mLa_2\sin(\theta_1-\theta_2)\dot{\theta}_2^2 + (m a_1 + mL)g\cos\theta_1 = 0$$

$$M_{12}\ddot{\theta}_1 + M_{22}\ddot{\theta}_2 - mLa_2\sin(\theta_1-\theta_2)\dot{\theta}_1^2 + m g a_2\cos\theta_2 = 0$$

$$E = T + V = \text{const} = 89.381\ \text{J} \qquad (\text{no dampers})$$

A chaotic system cannot be checked by comparing trajectories — two correct integrations diverge. The invariant that **can** be checked is total energy. Measured drift over 6 s is 0.83% and oscillates rather than growing, which is what a good integrator looks like.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| total energy at t = 0 | `89.381 J` | `89.4118 J` |
| worst energy drift over 6 s | `< 1%` | `0.83%` |
| motion bounded | `no divergence` | `confirmed` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
