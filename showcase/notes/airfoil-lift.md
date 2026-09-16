# Aerospace — lift and drag of a wing

> Aerospace: lift and drag as the angle of attack changes

**Domain:** Aerospace · **Simulated span:** 20 s · **Example:** `AirfoilLift`

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
//@ time=20
model AirfoilLift "Lift and drag of a wing as the angle of attack changes"
  parameter Real rho=1.225 "Air density at sea level";
  parameter Real V=50 "Airspeed";
  parameter Real S=16 "Wing planform area";
  parameter Real AR=7 "Aspect ratio";
  parameter Real e_os=0.85 "Oswald efficiency factor";
  parameter Real alpha0=-2 "Zero-lift angle of attack";
  parameter Real alpha_stall=15 "Angle at which the flow separates";
  parameter Real cl_max=1.4 "Peak lift coefficient";
  parameter Real m=1000 "Aircraft mass";
  Real alpha_deg "Angle of attack";
  Real cl "Lift coefficient";
  Real cd "Drag coefficient";
  Real L "Lift force";
  Real D "Drag force";
  Real V_stall "Speed at which the wing can just carry the weight";
equation
  alpha_deg = -5 + 30*time/20;
  // Thin-airfoil theory: lift grows linearly with angle at 2*pi per radian,
  // until the flow separates. sin() keeps the curve smooth through the stall
  // instead of a hard kink, and is exact for the linear part at small angles.
  cl = if alpha_deg <= alpha_stall then
         2*Modelica.Constants.pi*Modelica.Units.Conversions.from_deg(alpha_deg - alpha0)
       else
         cl_max*sin(Modelica.Constants.pi/2*(90 - alpha_deg)/(90 - alpha_stall));
  // Induced drag from the trailing vortex sheet, plus a small profile drag.
  cd = 0.008 + cl*cl/(Modelica.Constants.pi*AR*e_os);
  L = 0.5*rho*V*V*S*cl;
  D = 0.5*rho*V*V*S*cd;
  V_stall = sqrt(2*m*9.81/(rho*S*cl_max));
end AirfoilLift;
```

---

## What this shows

A wing at a shallow angle generates lift in proportion to that angle. Past about 15 degrees the airflow separates from the upper surface and lift collapses. This model sweeps the angle from -5 to 25 degrees and shows both halves of that story on one plot.

### Reading the equations

- `c_l = 2*pi*(alpha - alpha0)` — thin-airfoil theory. `alpha0 = -2 deg` is the angle at which a cambered wing makes no lift at all.
- `if alpha_deg <= alpha_stall` — below the stall the relation is linear; above it the flow has separated and a different curve takes over.
- `cl_max*sin(...)` — a smooth post-stall falloff. Real stall is abrupt; a smooth curve keeps the simulation well behaved and matches the trend.
- `c_d = 0.008 + c_l^2/(pi*AR*e)` — drag has two parts: a fixed profile drag, plus **induced** drag that grows with lift squared.
- `AR = 7` — aspect ratio — span divided by chord. A long slender wing (high AR) makes less induced drag, which is why gliders look the way they do.
- `V_stall = sqrt(2*m*g/(rho*S*cl_max))` — the slowest speed at which the wing can still carry the aircraft.

### The point

This is the shape of a real lift curve, and three engineering trade-offs are visible in it at once. Fly faster and lift grows with the **square** of speed, so you can fly slower with more wing area or more angle — until the stall. Pull more angle for more lift and induced drag rises with its **square**, so turning harder costs disproportionately more fuel. And the stall speed is a single number that sets how fast an aircraft must land.


---

## The physics

$$c_l = 2\pi(\alpha - \alpha_0) \quad \text{(thin-airfoil theory, until stall)}$$

$$c_d = c_{d0} + \frac{c_l^2}{\pi\,AR\,e} \quad \text{(induced drag from the trailing vortices)}$$

$$L = \tfrac12 \rho V^2 S\,c_l, \qquad D = \tfrac12 \rho V^2 S\,c_d$$

$$V_{stall} = \sqrt{\frac{2mg}{\rho S\,c_{l,max}}}$$

Two formulas explain the whole plot. Lift is **linear** in angle of attack, at 2π per radian, until the flow separates at the stall. Drag has a floor — the profile drag — plus a term growing with the **square** of the lift coefficient, because a wing that lifts harder trails stronger vortices and pays for them.

---

## Does the simulation agree?

Every value below was derived **before** the simulation was run — from the
closed-form solution, from an independent numerical integration of the same
ODE, or from reading the Modelica Standard Library source. They are re-checked
against a real OpenModelica run by `test/audit.test.mjs` on every test run, so
a stale number here fails the suite rather than misleading a reader.

| Quantity | Expected (independent) | Simulated |
|---|---|---|
| c_l = 2π·α_rad at α = 5 deg | `0.7679` | `0.7682` |
| c_d = 0.008 + c_l²/(πARe) at α = 5 deg | `0.0396` | `0.0396` |
| c_d at α = 10 deg | `0.1006` | `0.1006` |
| stall speed sqrt(2mg/(rho S cl_max)) | `26.74 m/s` | `26.74 m/s` |

---

## Reproducing it

Press **Simulate** in the block above. The result appears beneath the diagram;
the **Results** tab lists every variable the model exposes, and the **Component**
tab lets you change a parameter and watch the answer move.

To see the whole set checked at once:

```bash
node --test test/audit.test.mjs
```
