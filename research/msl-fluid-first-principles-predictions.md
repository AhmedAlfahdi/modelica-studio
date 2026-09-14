# First-principles predictions for three MSL 4.1.0 `Modelica.Fluid` models
Analyst report. **No simulation was run.** Every parameter and correlation was read from the
installed MSL 4.1.0 checkout (`~/.openmodelica/libraries/Modelica 4.1.0+maint.om/`); all
arithmetic is shown and was cross-checked with a calculator script.

## 0. Global constants (read from MSL source, not assumed)

| Quantity | Value | Source |
|---|---|---|
| `d_const` (rho) | **995.586 kg/m3** | `Media/Water/package.mo:52` (`ConstantPropertyLiquidWater` -> `PartialSimpleMedium(d_const=995.586, eta_const=1e-3)`) |
| `eta_const` (mu) | **1.0e-3 Pa.s** | `Media/Water/package.mo:53` |
| nu = mu/rho | 1.00443e-6 m2/s | derived |
| g (`Constants.g_n`) | 9.80665 m/s2 | `Modelica/Constants.mo`; `Fluid.System.g = g_n` |
| `system.use_eps_Re` | **false** (default) | `Fluid/System.mo:51` |
| `system.m_flow_small` | **0.01 kg/s** | `Fluid/System.mo:63` |
| `system.dp_small` | **1 Pa** | `Fluid/System.mo:60` |
| `system.m_flow_nominal` (=1e2*m_flow_small) | 1 kg/s | `Fluid/System.mo:54` |
| `T_default`, `p_default` | 293.15 K, 101325 Pa | `Media/package.mo:1176-1179` |

Notes that matter:
* The user's "about 995 kg/m3" is right, but the exact constant is **995.586**.
* `roughness` default of `Modelica.Fluid.Types.Roughness` in `PartialStraightPipe` is **2.5e-5 m** = 0.025 mm (`Fluid/Pipes.mo:241`).
* `PartialStraightPipe` asserts `length >= height_ab` (`Pipes.mo:259`).
* `StaticPipe` is **massless/energy-less** (`Pipes.mo:5-56`) and its momentum balance is
  `final momentumDynamics = Types.Dynamics.SteadyState` => the flow model runs in
  **`from_dp = false`** mode and evaluates `dp = f(m_flow)` (no algebraic loop).
  Its mass balance is exactly `port_a.m_flow + port_b.m_flow = 0` (`Pipes.mo:44`).

---

# MODEL 1 — `FluidPipe`

## 1.1 Governing equations

* Mass (exact, from `Pipes.mo:43-44`): `port_a.m_flow + port_b.m_flow = 0`.
* Momentum / Bernoulli with friction (steady, constant area, `height_ab = 0`):
  `p_a - p_b = dp_fric(m_flow)`, no static term, no momentum-flux term (constant area).
* Friction closure actually used by MSL: `WallFriction.Detailed.pressureLoss_m_flow`
  (`Pipes.mo:2930-2952`) in the turbulent branch:
  `lambda2 = 0.25*(Re/log10(Delta/3.7 + 5.74/Re^0.9))^2` (Swamee-Jain), and
  `dp = L*mu^2/(2*rho*D^3) * lambda2`, i.e. **Darcy-Weisbach**
  `dp = f*(L/D)*rho*v^2/2` with `f = lambda2/Re^2`.
  Transition: `Re1 = min((745*exp(1 or 0.0065/Delta))^0.97, 4000)`, `Re2 = 4000`.
* Source: `MassFlowSource_T` enforces `sum(ports.m_flow) = -m_flow_in` (`Sources.mo:484`)
  => the pump **pushes** `m_flow_in` out of its port (positive source value = outflow).
* Ramp: `y = 0` for `t<=0.1`; `y = (t-0.1)/1` for `0.1<t<1.1`; `y = 1` for `t>=1.1`.

## 1.2 Numbers

Geometry: A = pi*D^2/4 = pi*0.03^2/4 = **7.068583e-4 m2**.

At the end of the ramp (`t >= 1.1 s`, i.e. at `stopTime = 2 s`) `m_flow = 1 kg/s`:

```
G  = m_dot/A   = 1/7.068583e-4      = 1414.71 kg/(m2 s)
v  = G/rho     = 1414.71/995.586    = 1.4210 m/s
Re = rho*v*D/mu= 995.586*1.4210*0.03/1e-3 = 42 441
    (= G*D/mu  = 1414.71*0.03/1e-3        = 42 441)
Delta = ks/D   = 2.5e-5/0.03        = 8.333e-4
Re1 = (745*exp(1))^0.97 = 1503  (Delta < 0.0065)  ; Re2 = 4000
```

`Re = 42 441 >> Re2 = 4000` => **fully turbulent, Swamee-Jain/Colebrook branch**.

Swamee-Jain (the formula literally inside MSL):
```
f = 0.25/[log10(Delta/3.7 + 5.74/Re^0.9)]^2
  = 0.25/[log10(8.333e-4/3.7 + 5.74/42441^0.9)]^2
  = 0.25/[log10(2.2523e-4 + 4.0791e-3)]^2
  = 0.25/[log10(4.3043e-3)]^2 = 0.25/[-2.36616]^2 = 0.044657   => f = 0.02427
dp = f*(L/D)*rho*v^2/2
   = 0.02427*(1/0.03)*995.586*1.4210^2/2
   = 0.02427*33.3333*1005.14 = 813.3 Pa
```
Colebrook-White (the "true" correlation, solved iteratively) gives `f = 0.02416`
and `dp = 809.3 Pa` — only **0.5 %** apart. Haaland gives 0.02383 (dp = 799 Pa).

**Best estimate: `pipe.port_a.p - pipe.port_b.p = 810 Pa` (0.0081 bar, 83 mm water).**
Uncertainty statement: the two correlations that MSL itself uses (`pressureLoss_m_flow` for
`StaticPipe` and `massFlowRate_dp` for a `from_dp` component) agree to 0.5 % here; other
standard explicit fits (Haaland 0.02383, Swamee-Jain 0.02427) straddle 810 Pa by -1.3 % and
+0.4 %. I am confident in **810 +- 40 Pa**; that is a real friction-correlation uncertainty,
not a modelling subtlety, and I would refuse to quote a tighter number.

Absolute pressures at `t = 2 s`: `port_b.p = 101325 Pa` (fixed by `sink`),
`port_a.p = 101325 + 810 = 102135 Pa`.

*(The `n=2` internal staggered discretisation, with `m_flow/2 = 0.5 kg/s` per segment
(Re = 21 221, f = 0.0273 per segment), sums to the same total dp; that is why segment count
does not change the answer.)*

## 1.3 Checkable predictions

1. `pipe.port_a.m_flow = +1.0 kg/s` and `pipe.port_b.m_flow = -1.0 kg/s` at t >= 1.1 s
   (exactly equal and opposite; sum = 0 to solver tolerance).
2. `sink.ports[1].m_flow = +1.0 kg/s`, `pump.ports[1].m_flow = -1.0 kg/s` at t = 2 s;
   all four magnitudes equal `ramp.y`.
3. `pipe.port_a.p - pipe.port_b.p = 810 Pa +- 40 Pa`, with `port_b.p = 101325 Pa` exactly.
4. `pipe.port_a.p = 102135 Pa +- 40 Pa` at t = 2 s; at `t = 0.1 s` (zero flow)
   `port_a.p = port_b.p = 101325 Pa` (friction vanishes, dp -> 0 linearly/continuously).
5. Energy: `height_ab = 0` => `port_b.h_outflow = inStream(port_a.h_outflow)` exactly
   (no geodetic enthalpy change); with an incompressible medium `h_a = h_b`, so
   `T_a = T_b = 293.15 K` (temperature is not integrated anywhere).

## 1.4 Wrong / suspicious

* **The pipeline has no inlet pressure boundary.** The pump imposes only `m_flow`; the
  pressure at `port_a` is a *result*. Reading `port_a.p` is therefore a direct measurement
  of the friction correlation, whereas `port_b.p` is trivially 101325 Pa. Predictions about
  flow rates are parameter-free and safe; predictions about `port_a.p` are
  correlation-limited (that is the 810 Pa +-40 Pa above).
* The model silently uses MSL's Swamee-Jain variant (a *fit*, explicitly chosen in
  `Pipes.mo:1477-1480` because it is explicit), not a solved Colebrook equation. Difference
  here is 0.5 %; in the transition band `1500 < Re < 4000` MSL's two directions
  (`pressureLoss_m_flow` vs `massFlowRate_dp`) are deliberately *not* inverses.
* `StaticPipe` models a **vertical** pipe in its static-head and friction terms: the
  documentation states `pathLengths` is the vertical `length` and `height_ab` the elevation
  difference, while the icon is horizontal. With `height_ab = 0` this is harmless, but a
  user adding `height_ab != 0` should know the friction length and the elevation are the
  same geometric quantity in this component.
* Both sources' parameter interfaces are incomplete as written (omitted here): the ramp
  constructor calls omit `offset`, and `system`/`sink`/`pump` would need the usual
  `p_ambient`/`T_ambient`/medium boilerplate. Not physics, but the listing will not compile
  verbatim (`pump` also needs `m_flow`/`T` defaults, which exist).
* No `checkValve`: the small `m_flow_small = 0.01 kg/s` regularisation means the reported dp
  at very small times is a smooth blend, not a physical value.

---

# MODEL 2 — `FluidReservoir`

## 2.1 Governing equations

* Tank mass balance (DirectDynamics): `rho*crossArea*d(level)/dt = tank.ports[1].m_flow`.
  `OpenTank` fills from the bottom: `V = crossArea*level`, port at `portsData.height = 0`.
* Tank **port** pressure relation (`Vessels.mo:350-358`, outflow branch,
  `regSquare2` in the turbulent limit):
  `p_port = p_ambient + rho*g*level + 0.5*rho*v_port^2*(zeta_out + 1 - A_port^2/A_tank^2)`
  with `VesselPortsData` defaults **zeta_out = 0.5**, `zeta_in = 1.04`
  (`Vessels.mo:541-544`). With `A_port/A_tank = 3.53e-3`, the last term is ~1e-5 =>
  `p_port = 101325 + rho*g*level + 1.5*rho*v_port^2/2`.
* Pipe (`StaticPipe`, `height_ab = -1 m`, `L = 0.5 m`, `D = 0.03 m`): Darcy-Weisbach plus
  static head: `p_b - p_a = rho*g*(-1) ...` i.e. the 1 m drop **adds** static pressure.
* Drain boundary: fixes `p = 101325 Pa`; the kinetic energy of the jet
  (`rho*v^2/2`) is dissipated there, i.e. it is a **free discharge** (exit loss coefficient 1).
* Steady Bernoulli from the free surface (p = p_atm, v ~ 0) to the outlet (p = p_atm):
  `rho*g*(level + 1) = 0.5*rho*v^2*(1 [port] + f*L/D [friction] + 1 [exit])`.

## 2.2 Numbers

```
A_pipe = pi*0.03^2/4 = 7.06858e-4 m2 ;  A_pipe/A_tank = 3.534e-3
H(0)   = level_start + 1 m = 0.9 + 1.0 = 1.9 m   (surface is 1.9 m above the drain)
```
Iterating `v = sqrt(2*g*H/(2 + f*L/D))` with Colebrook:
```
v = 3.9789 m/s ; Re = rho*v*D/mu = 995.586*3.9789*0.03/1e-3 = 118 840
f = 0.02123 (Colebrook; Swamee-Jain 0.02125)
W = 1 + f*L/D + 1 = 1 + 0.02123*16.667 + 1 = 2.3538
check: W*v^2/(2g) = 2.3538*0.8072 = 1.900 m = H  OK
m_dot(0) = rho*A*v = 995.586*7.06858e-4*3.9789 = 2.800 kg/s
```
Reference (the user's ideal Torricelli number): `v = sqrt(2*9.80665*1.9) = 6.105 m/s`,
`m_dot = 4.296 kg/s`. Losses cost **34.8 %** of the ideal flow. Note the bookkeeping:
pipe friction (L/D = 16.7) is only 15 % of the loss; the **tank port (zeta_out=0.5, +1 for
kinetic energy) and the exit are each worth a full velocity head**.

**Level history.** Putting `v = sqrt(2g)*sqrt(level+1)/sqrt(W)` into the tank balance:
```
d(level)/dt = -(A_pipe/A_tank)*sqrt(2g/W)*sqrt(level+1) = -C*sqrt(level+1)
C = 3.534e-3 * sqrt(19.61330/2.3538) = 3.534e-3 * 2.88661 = 1.02021e-2 m^(1/2)/s
```
(exact ODE; `f` re-evaluated at the initial state — over 0.9 -> 0.63 m, Re changes
118 840 -> 109 900 and `f` 0.02123 -> 0.02137, so `C` is constant to 0.1 %.)

Closed form (substitute `u = sqrt(level+1)`): **`level(t) = 0.9 - C*t*sqrt(1.9) + C^2*t^2/4`**.

```
t = 20 s:  C*t = 0.20404 ;  C*t*sqrt(1.9) = 0.28131 ;  C^2 t^2/4 = 0.010408
level(20) = 0.9 - 0.28131 + 0.01041 = 0.6292 m
v(20)     = sqrt(2g*1.6292/2.3538) = 3.6853 m/s ; m_dot(20) = 2.5929 kg/s
m(0)  = rho*crossArea*0.9 = 995.586*0.2*0.9 = 179.21 kg
m(20) = 995.586*0.2*0.62916    = 125.28 kg
drained over 0..20 s = 179.21 - 125.28 = 53.93 kg  (30.1 % of the initial 0.9 m)
```
Cross-check by **explicit Euler, dt = 1 s** (requested): h(20) = **0.62865 m**
(0.5 mm below the exact 0.62916 m; 0.08 %), drained 54.2 kg. The initial drop rate is
`d(level)/dt = -(A/A_tank)*v = -3.534e-3*3.9789 = -0.01406 m/s` (1.4 cm/s), 25 % slower
than the loss-free 0.0215 m/s.

Time to empty (extrapolating the same ODE): `t_empty = 2*(sqrt(1.9)-1)/C = 74.2 s`
— i.e. **under this model the tank does not empty within `stopTime = 20 s`**; the pipe's
1 m drop keeps `level+1 > 0` the whole time.

**Concavity.** `d(level)/dt = -C*sqrt(level+1)` with `C > 0` gives
`d2(level)/dt2 = -C/(2*sqrt(level+1)) * d(level)/dt = +C^2/2 > 0`:
**the level curve is convex (curving upward), decelerating** — it falls fastest at t = 0 and
flattens as the head (and therefore the flow) decreases. The flow rate is also monotone
decreasing (2.800 -> 2.593 kg/s). Do not confuse this with an exponential: the sqrt law
gives a *finite* emptying time.

## 2.3 Checkable predictions

1. `m_dot(0) = tank.ports[1].m_flow = +2.80 kg/s` (magnitude; positive = out of the tank),
   and `pipe.port_b.m_flow = -2.80 kg/s`. A pure-Torricelli simulation would show 4.30 kg/s:
   **if your result is ~4.3 kg/s, losses are not being applied**; 2.80 kg/s is the MSL answer.
2. `2.55 < m_dot(20 s) < 2.65 kg/s` (predicted 2.593) — the flow has only fallen 7.4 %.
3. `level(20 s) = 0.629 m +- 0.01 m`; equivalently `tank.level` drops by 0.271 m.
4. Mass conservation (exact identity in MSL, checkable to solver tolerance):
   `rho*crossArea*(level(t)-level(0)) + integral(m_dot dt) = 0`; over 0..20 s the drained
   mass is 53.9 kg +- 1 kg.
5. `pipe.port_a.p = 114837 Pa +- 60 Pa` at t = 0, built up as
   `101325 (p_ambient) + rho*g*0.9 (static head = 8789 Pa) + 1.5*rho*v^2/2 (port loss
   = 4723 Pa) = 101325 + 8789 + 4723 = 114837 Pa`.
   `pipe.port_b.p = 101325 Pa` exactly (the jet's kinetic energy is dumped at the drain, so
   the exit gauge pressure is zero). The 1 m pipe drop is recovered as static pressure, which
   is why `port_a.p` is ~13.5 kPa above the drain rather than ~8.8 kPa.

## 2.4 Wrong / suspicious

* **The tank has no vent and only one port** (`nPorts = 1`) used as the outlet. As written
  the tank is a sealed-but-incompressible volume whose free surface is implicitly at
  `p_ambient`; that is the documented `OpenTank` idealisation, but physically a 0.2 m2 tank
  draining at 2.8 kg/s (2.8 L/s) through a 30 mm port needs a vent or it would pull a vacuum.
  A real `OpenTank` needs `portsData.height = 0` for "bottom" — the default, so that part is
  correct.
* **`level_start = 0.9` with `height = 1` leaves only 0.1 m of freeboard**, and
  `OpenTank` asserts if the level exceeds `height`. Fine as written, but any transient
  overshoot (there is none here) would abort the run.
* **Direction of `height_ab`.** `port_a` is the tank side and `port_b` the drain; the
  requested `height_ab = -1` correctly means "port_b is 1 m lower than port_a". If it were
  `+1` the static head would *oppose* the flow and the pipe would have to lift water 1 m —
  a sign error that is easy to make and would change the answer completely (that would give
  ~2.4 kg/s with a different h-dependence, or no flow at all if the tank were lower).
* `drain.X = {1}` is meaningless for `ConstantPropertyLiquidWater` (single substance,
  `Medium.nXi = 0`); harmless but it signals copy-paste from a moist-air model.
* The 1 m drop through a 0.5 m long pipe is geometrically impossible for a *straight* pipe
  (it is a 63 deg incline, not a 0.5 m long straight run); MSL's `StaticPipe` only uses
  `height_ab` for static head and `length` for friction, so it accepts this silently.
  The `assert(length >= height_ab)` passes (-1 <= 0.5), so there is no warning.
* **At/after the tank empties (~74 s, beyond `stopTime`)** the port switches to the
  `inFlow`/blocked branches of `PartialLumpedVessel`; the "blocked" branch sets
  `ports[i].m_flow = 0` while still computing a port pressure. Expect a non-smooth event or
  solver trouble if anyone extends `stopTime` past ~74 s — a modelling artefact, not physics.
* `level` is integrated and `p` is *derived* from it: `OpenTank` computes
  `p = p_ambient + rho*g*level`, so the tank is a pure level integrator. That makes the
  system a clean first-order ODE (no index problem), which is why the analytic solution above
  is exact for a frozen `f`.

---

# MODEL 3 — `FluidLoop`

## 3.1 Governing equations

* `ControlledPump` with `control_m_flow = true` (default) and `use_m_flow_set = false`
  (default) imposes exactly (`Machines.mo:196-205`): `m_flow = m_flow_nominal` (= 0.1 kg/s),
  `port_b.m_flow = -port_a.m_flow`.
* `SimpleGenericOrifice` (`Fittings.mo:276-370`) is a pure quadratic resistance on the
  **full orifice area**, `A = pi*D^2/4`, with `zeta` a lumped loss factor:
  ```
  dp = 0.5*zeta*rho*v*|v| = [8*zeta/(pi^2*D^4*rho)] * m_dot*|m_dot|
     = lossConstant_D_zeta(D,zeta)/rho * m_dot^2
  ```
  With `use_zeta = true` (`Fittings.mo:292`, the default) `zeta_nominal = zeta` and the
  `dp_nominal`/`m_flow_nominal` parameters are **ignored for the physics**.
* Energy: isenthalpic (`port_b.h_outflow = port_a.h_outflow`), no storage; incompressible
  medium => `T` constant, `rho` constant.
* Regularisation (the one trap): the model is evaluated in **`from_dp = true`** mode
  (`from_dp` defaults to true; `StaticPipe` is the exception), so
  `m_flow = regRoot2(dp_fg, dp_turbulent, rho/k, rho/k)` with
  ```
  m_flow_turbulent = max(m_flow_small, (pi/8)*D*(mu_a+mu_b)*10000)
                   = max(0.01, (pi/8)*0.02*2e-3*1e4) = 0.15708 kg/s
  dp_turbulent     = max(1 Pa, k/rho*m_flow_turbulent^2) = 313.89 Pa
  ```
  The pure quadratic law holds **exactly** for `m_dot >= 0.157 kg/s`; below that, MSL blends
  through a cubic over `|dp| < 313.9 Pa`.

## 3.2 Numbers

```
A = pi*0.02^2/4 = 3.141593e-4 m2
k = 8*zeta/(pi^2*D^4) = 8*2.5/(9.8696*1.6e-7) = 20/1.579137e-6 = 1.266515e7 Pa/(kg/s)^2
k/rho = 1.266515e7/995.586 = 1.27213e4 Pa/(kg/s)^2
```
| m_dot | v = m_dot/(rho*A) | rho*v^2/2 | zeta*rho*v^2/2 = dp | bar | regime |
|---|---|---|---|---|---|
| 0.1 kg/s | 0.31972 m/s | 50.885 Pa | **127.21 Pa** | 0.00127 | below m_turb -> regularised |
| 1.0 kg/s | 3.19721 m/s | 5088.5 Pa | **12721.3 Pa** | 0.1272 | pure quadratic |
| 1.5 kg/s | 4.79582 m/s | 11449.2 Pa | **28622.9 Pa** | 0.2862 | pure quadratic |

At the imposed **0.1 kg/s** the exact MSL model gives
`dp = 169.80 Pa` (0.0017 bar) rather than 127.21 Pa, i.e. **+33.5 %**, because 0.1 < 0.157
sits inside the cubic regularisation band (127.2 Pa < dp_turb = 313.9 Pa). The gap closes
fast: at 0.15 kg/s it is +0.8 %, and at >= 0.157 kg/s it is zero.

Relation: **dp ∝ m_dot^2** (equivalently `dp ∝ v^2`), so `dp2 = dp1*(m2/m1)^2`.
Three pairs: **(0.2 kg/s, 508.9 Pa), (0.5 kg/s, 3180 Pa), (1.5 kg/s, 28 623 Pa)**;
plus **(0.1 kg/s, 169.8 Pa)** as the regularised outlier.

Pump consequences at 0.1 kg/s: `pump.port_b.p = 101325 + 169.8 = 101495 Pa` while
`pump.port_a.p = 101325 Pa`, `dp_pump = 169.8 Pa` (1.7 mbar, 17 mm water);
hydraulic power `= dp_pump*m_dot/rho = 0.017 W`. If the setpoint ramps to 1.5 kg/s,
`dp_pump = 28.6 kPa` (0.286 bar) and hydraulic power `= 43.1 W`.

## 3.3 Checkable predictions

1. `orifice.port_a.m_flow = +0.1 kg/s`, `orifice.port_b.m_flow = -0.1 kg/s`,
   `pump.port_b.m_flow = -0.1 kg/s`, `sink.ports[1].m_flow = +0.1 kg/s` — all constant in
   time (a `ControlledPump` with a fixed setpoint has no dynamics).
2. **`orifice.dp = 169.8 Pa` at 0.1 kg/s, not 127.2 Pa.** If your run reports ~127 Pa you
   are looking at the quadratic formula, not the model; if it reports ~170 Pa the cubic
   regularisation is confirmed. Use `m_dot >= 0.16 kg/s` if you want the clean quadratic law.
   *(Confidence: high on the direction and the +33.5 % from the exact `regRoot2` code path;
   medium on the last digit, since the cubic is an MSL-specific blend.)*
3. `dp(m_dot)` must satisfy `dp(2*m_dot) = 4*dp(m_dot)` to better than 1 % for
   `m_dot >= 0.2 kg/s` — the single strongest check of the orifice equation.
4. `sink.ports[1].p = 101325 Pa` and `pump.port_b.p - pump.port_a.p = orifice.dp` exactly
   (only two resistances in series, both massless).
5. `orifice.port_a.h_outflow = orifice.port_b.h_outflow` (isenthalpic) and
   `orifice.port_a.T = orifice.port_b.T = 293.15 K`; `rho` constant everywhere.

## 3.4 Wrong / suspicious

* The listing's `...` hides `p_a_nominal`, `p_b_nominal`, `m_flow_nominal` — all three are
  **required** parameters of `ControlledPump` (no defaults). If the intent was
  "imposed flow", fine; but if the intent was a pump *curve*, note that with
  `control_m_flow = true` the entire `flowCharacteristic`/`head_nominal` machinery is
  **inactive** and only `m_flow_nominal` matters. If instead `control_m_flow = false` were
  set, the model would control `port_b.p = p_b_nominal` and the flow would be whatever the
  orifice passes at that pressure — a completely different, and then genuinely interesting,
  problem. As written the answer is a 3-line arithmetic exercise.
* At **1 kg/s** the orifice dissipates hydraulic power
  `P = dp*V_dot = dp*m_dot/rho = 12721.3*1/995.586 = 12.78 W` (not kW — `V_dot` is only
  `1/995.586 = 1.004e-3 m3/s`); at **1.5 kg/s** it is
  `28622.9*1.5/995.586 = 43.12 W` with a pump pressure rise of 0.286 bar. Both are small, but
  note that 0.286 bar is far outside any sane `p_a_nominal`/`p_b_nominal` pair a modeller
  would use to build this pump's (here inactive) characteristic, and that the pump efficiency
  model (`constantEfficiency(eta_nominal = 0.8)`, `Machines.mo:354`) would report a shaft
  power of `43.12/0.8 = 53.9 W` — check `pump.W_single` against that if you ramp the setpoint.
* `zeta = 2.5` is applied to the **full** 20 mm bore, not to a contracted jet: this component
  has **no discharge coefficient and no area ratio**. If the 2.5 was taken from a table for a
  sharp-edged orifice, it is referenced to the *pipe* diameter only if the table says so;
  a real orifice plate with `beta = d/D` needs `zeta` referred to the correct area. This is
  the most likely source of a "physically wrong but numerically consistent" result.
* `nPorts = 1` on both boundaries with `noEvent`-free path: fine, but the boundaries are at
  identical `p` and `T` on both sides of the pump, so **`pump.port_a.p = sink.p = 101325 Pa`**
  always; the loop cannot pressurise anything. There is also no elevation anywhere
  (`StaticPipe` is absent), so gravity plays no role — if the intent was a "loop", it is a
  flat series circuit.
* `pump` has `m_flow_start = 0.1` equal to `m_flow_nominal`; harmless in steady state, but
  with `control_m_flow` the algebraic constraint overrides the start value instantly, so any
  initial transient you see is a solver artefact.

---

# Confidence summary

| Prediction | Confidence | Why |
|---|---|---|
| M1 flow signs/magnitudes, dp = 810 Pa | **High (+-5 %)** | exact mass balance; the two MSL correlations agree to 0.5 %, independent fits straddle it by ~1 % |
| M1 absolute `port_a.p` | High | trivially `101325 + dp` |
| M2 `m_dot(0) = 2.80 kg/s` | **High (+-5 %)** | loss coefficients read from source; friction is a small part of the budget |
| M2 `level(20 s) = 0.629 m` | **High (+-0.01 m)** | analytic solution of the exact ODE; Euler agrees to 0.5 mm |
| M2 convexity / finite 74 s empty time | High | sign of `d2(level)/dt2` is rigorous |
| M3 `dp(1.0) = 12.72 kPa`, `dp(1.5) = 28.62 kPa` | **Very high** | closed-form quadratic, no correlation involved |
| M3 `dp(0.1) = 169.8 Pa` (not 127 Pa) | Medium-high | exact MSL `regRoot2` code path; the cubic blend is MSL-specific |
| Any friction number to better than +-5 % | **Low** | friction correlations are fits; MSL itself switches between two non-inverse fits |
