# Mechanical — two free masses coupled by a spring and damper

> Mechanical: two free masses coupled by a spring and damper

**Domain:** <span class="modelica-studio-domain" data-domain="mechanical">Mechanical</span> · **Simulated span:** 5 s · **Example:** `MassSpringDamper`

*New to Modelica? Read [Modelica in ten minutes](00-modelica-intro.md) first.*

---

## The model

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
    annotation(Placement(transformation(extent={{-100,30},{-80,50}})));
equation
  connect(step.y, force.f);
  connect(force.flange, mass1.flange_a);
  connect(mass1.flange_b, coupling.flange_a);
  connect(coupling.flange_b, mass2.flange_a);
end MassSpringDamper;
```

---

## What this shows

Two masses float free, joined by a spring and damper, with a 1 N force applied to the first one. Nothing is bolted down, so the whole pair drifts away while the two masses bob relative to each other.

### Reading the equations

- `Force force` — a constant 1 N push on `mass1`, switched on at t = 0.1 s.
- `SpringDamper coupling(c=50, d=1)` — the only thing joining the two masses. Its force depends on how far apart they are and how fast that gap is changing.
- `μ = m₁m₂/(m₁+m₂) = 2/3 kg` — the **reduced mass** — the effective inertia of the bobbing motion, always smaller than either mass alone.
- `x_cm'' = F/(m₁+m₂) = 1/3 m/s²` — because nothing external holds the pair back, their common centre of mass just accelerates.

### The point

Two things happen at once: the pair drifts as one object, and the gap between them oscillates and settles. The steady gap is **not** `F/c` — that would be true if one end were nailed down. With both free, the spring carries only part of the force and the gap settles at `F·m₂/(c(m₁+m₂))`.


---

## The physics

$$m_1\ddot{s}_1 = F + f_c, \qquad m_2\ddot{s}_2 = -f_c, \qquad f_c = c(s_2 - s_1) + d(\dot{s}_2 - \dot{s}_1)$$

$$x_{cm} = \frac{m_1s_1 + m_2s_2}{m_1 + m_2} \quad\Longrightarrow\quad \ddot{x}_{cm} = \frac{F}{m_1+m_2} = \frac{1}{3}\ \text{m/s}^2$$

$$\mu = \frac{m_1m_2}{m_1+m_2} = \frac{2}{3}\ \text{kg}, \qquad \omega_n = \sqrt{\frac{c}{\mu}} = 8.660\ \text{rad/s}$$

$$s_{rel}(\infty) = -\frac{F\,m_2}{c\,(m_1+m_2)} = -\frac{1}{75} = -0.013333\ \text{m}$$

The applied force is shared, so the steady stretch is **not** F/c — that is the single-ended result. The centre of mass accelerates freely at F/(m₁+m₂) while the two masses oscillate about it, and the relative motion decays with ζ = 0.0866.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| centre of mass at t = 5 s | `4.0017 m` | `4.0017 m` |
| steady relative stretch | `−0.013333 m` | `−0.013333 m` |
| momentum m₁v₁ + m₂v₂ (free run) | `0` | `2.6e−14` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
