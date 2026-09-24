/**
 * The mathematics behind each built-in example, and what was measured.
 *
 * Kept beside the generator rather than inside the plugin: the plugin needs the
 * models, not the derivations. The `measured` numbers here were taken from real
 * OpenModelica runs and are re-checked by `test/audit.test.mjs` on every suite
 * run, so a stale number in a note fails the build rather than misleads a reader.
 */
export const NOTES = {
  Electrical: {
    title: "Electrical — RC step response",
    domain: "Electrical",
    equations: [
      "C\\,\\frac{dv_C}{dt} = \\frac{V - v_C}{R}",
      "\\tau = RC = 100 \\times 10^{-3} = 0.1\\ \\text{s}",
      "v_C(t) = V\\left(1 - e^{-t/\\tau}\\right), \\qquad i(t) = \\frac{V}{R}e^{-t/\\tau}",
    ],
    insight:
      "A capacitor integrates current, so a constant voltage through a resistor charges it exponentially — never linearly. After one time constant it reaches 63.2% of the supply; after five, 99.3%.",
    checks: [
      ["capacitor.v at t = 0.1 s", "6.3212 V", "6.3212 V"],
      ["capacitor.i at t = 0.1 s", "36.788 mA", "36.788 mA"],
      ["capacitor.v at t = 1 s", "10 V", "9.99955 V"],
      ["KVL: v_R + v_C", "10 V always", "10.000 V"],
    ],
  },
  RLC: {
    title: "Electrical — series RLC step response",
    domain: "Electrical",
    equations: [
      "L\\frac{di}{dt} + Ri + \\frac{1}{C}\\int i\\,dt = V",
      "\\alpha = \\frac{R}{2L} = 50\\ \\text{s}^{-1}, \\qquad \\omega_0 = \\frac{1}{\\sqrt{LC}} = 316.2\\ \\text{rad/s}",
      "\\omega_d = \\sqrt{\\omega_0^2 - \\alpha^2} = 312.25\\ \\text{rad/s}, \\qquad \\zeta = \\frac{\\alpha}{\\omega_0} = 0.158",
      "v_C(t) = V\\left[1 - e^{-\\alpha t}\\left(\\cos\\omega_d t + \\frac{\\alpha}{\\omega_d}\\sin\\omega_d t\\right)\\right]",
    ],
    insight:
      "A **series** RLC rings even when ζ > 1. The condition ζ < 1 for oscillation applies to a parallel RLC or a second-order low-pass; here the capacitor and inductor in series give the transfer function complex zeros, so a step overshoots regardless. This is the single most common mixed-up rule in the subject.",
    checks: [
      ["capacitor.v at t = 5 ms", "6.1670 V", "6.1670 V"],
      ["capacitor.v at t = 20 ms", "6.5804 V", "6.5804 V"],
      ["capacitor.v at t = 50 ms", "10.7373 V", "10.7373 V"],
      ["ζ from R, L, C", "0.158114", "0.158114"],
    ],
  },
  Rectifier: {
    title: "Electrical — half-wave rectifier",
    domain: "Electrical",
    equations: [
      "i_D = I_s\\left(e^{v_D/V_T} - 1\\right) + \\frac{v_D}{R_{sh}}",
      "\\tau_{discharge} = R_{load}C = 1000 \\times 10^{-4} = 0.1\\ \\text{s}",
    ],
    insight:
      "MSL's `Diode` is a Shockley model: the forward drop is **logarithmic and current-dependent**, with no knee voltage. The capacitor charges to the peak less that small drop during conduction, then discharges through the load with τ = 0.1 s — so by 20 ms it has fallen to about 23% of its peak, which is the shape you see.",

    checks: [
      ["capacitor peak vs Vs - Vt ln(v/(R Ids) + 1)", "9.54136 V", "9.54057 V"],
      ["capacitor.v at t = 10 ms", "6.14 V", "6.1352 V"],
      ["discharge over 10 ms (tau = R C = 10 ms)", "e^-1 = 0.367879", "0.367868"],
      ["ripple period", "20 ms", "20 ms"],
    ],
  },
  SineAC: {
    title: "Electrical — sine drive into an RL load",
    domain: "Electrical",
    equations: [
      "X_L = 2\\pi f L = 15.708\\ \\Omega, \\qquad |Z| = \\sqrt{R^2 + X_L^2} = 25.4311\\ \\Omega",
      "\\phi = \\arctan\\frac{X_L}{R} = 38.146^\\circ, \\qquad \\hat{I} = \\frac{\\hat{V}}{|Z|} = 9.0441\\ \\text{A}",
      "\\hat{V}_R = \\hat{I}R = 180.881\\ \\text{V}, \\qquad \\hat{V}_L = \\hat{I}X_L = 142.064\\ \\text{V}",
    ],
    insight:
      "`SineVoltage`'s `V` parameter is the **amplitude**, not the RMS value — so 230 V here is 163 V RMS. The inductor voltage leads the resistor by 90°, and the two peaks cannot occur at the same instant.",
    checks: [
      ["peak v_R = V·R/|Z|", "180.881 V", "180.881 V"],
      ["peak v_L = V·X_L/|Z|", "142.064 V", "142.063 V"],
      ["v_R at t = 0.1 s (source zero crossing)", "−111.724 V", "−111.724 V"],
    ],
  },
  MassSpring: {
    title: "Mechanical — mass on a spring and damper",
    domain: "Mechanical",
    equations: [
      "m\\ddot{s} = -c(s - s_{rel0}) - d\\dot{s}",
      "\\omega_n = \\sqrt{c/m} = 10\\ \\text{rad/s}, \\qquad \\zeta = \\frac{d}{2\\sqrt{cm}} = 0.1",
      "s(t) = s_{rel0} - s_{rel0}\\,e^{-\\zeta\\omega_n t}\\left(\\cos\\omega_d t + \\frac{\\zeta}{\\sqrt{1-\\zeta^2}}\\sin\\omega_d t\\right)",
    ],
    insight:
      "The mass starts at s = 0 while the spring's free length is 0.5 m, so the spring is **pre-compressed** and pushes with 50 N from rest — the initial acceleration is 50 m/s², not zero. The oscillation is centred on s = 0.5 m, not on zero.",
    checks: [
      ["initial acceleration c·s_rel0/m", "50 m/s²", "50 m/s²"],
      ["mass.s at t = 0.2 s", "0.629036 m", "0.629036 m"],
      ["mass.s at t = 5 s", "0.4972369 m", "0.4972 m"],
    ],
  },
  MassSpringDamper: {
    title: "Mechanical — two free masses coupled by a spring and damper",
    domain: "Mechanical",
    equations: [
      "m_1\\ddot{s}_1 = F + f_c, \\qquad m_2\\ddot{s}_2 = -f_c, \\qquad f_c = c(s_2 - s_1) + d(\\dot{s}_2 - \\dot{s}_1)",
      "x_{cm} = \\frac{m_1s_1 + m_2s_2}{m_1 + m_2} \\quad\\Longrightarrow\\quad \\ddot{x}_{cm} = \\frac{F}{m_1+m_2} = \\frac{1}{3}\\ \\text{m/s}^2",
      "\\mu = \\frac{m_1m_2}{m_1+m_2} = \\frac{2}{3}\\ \\text{kg}, \\qquad \\omega_n = \\sqrt{\\frac{c}{\\mu}} = 8.660\\ \\text{rad/s}",
      "s_{rel}(\\infty) = -\\frac{F\\,m_2}{c\\,(m_1+m_2)} = -\\frac{1}{75} = -0.013333\\ \\text{m}",
    ],
    insight:
      "The applied force is shared, so the steady stretch is **not** F/c — that is the single-ended result. The centre of mass accelerates freely at F/(m₁+m₂) while the two masses oscillate about it, and the relative motion decays with ζ = 0.0866.",
    checks: [
      ["centre of mass at t = 5 s", "4.0017 m", "4.0017 m"],
      ["steady relative stretch", "−0.013333 m", "−0.013333 m"],
      ["momentum m₁v₁ + m₂v₂ (free run)", "0", "2.6e−14"],
    ],
  },
  RotationalPendulum: {
    title: "Mechanical — torque step on a rotational spring-damper",
    domain: "Mechanical",
    equations: [
      "J\\ddot{\\varphi} = \\tau - c\\varphi - d\\dot{\\varphi}",
      "\\omega_n = \\sqrt{c/J} = 6.325\\ \\text{rad/s}, \\qquad \\zeta = \\frac{d}{2\\sqrt{cJ}} = 0.0559",
      "\\varphi(\\infty) = \\frac{\\tau}{c} = \\frac{2}{20} = 0.1\\ \\text{rad}",
    ],
    insight:
      "Despite the name there is no gravity here — MSL's rotational library has no gravitational restoring term, so this is a torsional second-order system, the rotational twin of the mass-spring. It settles at τ/c = 0.1 rad, and the step at t = 0.1 s is a genuine discontinuity.",
    checks: [
      ["inertia.phi at t = 60 s", "0.1 rad", "0.100000 rad"],
      ["settling: ζ = d/(2√(cJ))", "0.0559", "0.0559"],
    ],
  },
  DoublePendulum: {
    title: "Mechanical — double pendulum (chaotic)",
    domain: "Mechanics",
    equations: [
      "M_{11}\\ddot{\\theta}_1 + M_{12}\\ddot{\\theta}_2 + mLa_2\\sin(\\theta_1-\\theta_2)\\dot{\\theta}_2^2 + (m a_1 + mL)g\\cos\\theta_1 = 0",
      "M_{12}\\ddot{\\theta}_1 + M_{22}\\ddot{\\theta}_2 - mLa_2\\sin(\\theta_1-\\theta_2)\\dot{\\theta}_1^2 + m g a_2\\cos\\theta_2 = 0",
      "E = T + V = \\text{const} = 89.381\\ \\text{J} \\qquad (\\text{no dampers})",
    ],
    insight:
      "A chaotic system cannot be checked by comparing trajectories — two correct integrations diverge. The invariant that **can** be checked is total energy. Measured drift over 6 s is 0.83% and oscillates rather than growing, which is what a good integrator looks like.",
    checks: [
      ["total energy at t = 0", "89.381 J", "89.4118 J"],
      ["worst energy drift over 6 s", "< 1%", "0.83%"],
      ["motion bounded", "no divergence", "confirmed"],
    ],
  },
  FluidPipe: {
    title: "Fluid — water driven through a pipe",
    domain: "Fluid",
    equations: [
      "\\dot{m} = \\rho A v, \\qquad A = \\frac{\\pi D^2}{4} = 7.0686\\times10^{-4}\\ \\text{m}^2",
      "v = \\frac{\\dot m}{\\rho A} = 1.421\\ \\text{m/s}, \\qquad Re = \\frac{\\rho v D}{\\mu} = 42\\,441",
      "\\Delta p = f\\frac{L}{D}\\frac{\\rho v^2}{2}, \\qquad f \\approx 0.0243\\ (\\text{Swamee–Jain})",
    ],
    insight:
      "`StaticPipe` is massless with steady-state momentum dynamics: it evaluates Δp as a function of flow, not the other way round. The friction factor is correlation-limited, so Δp carries a few percent of genuine uncertainty — it is the weakest number in the whole example set, which is why the check below is a mass balance rather than a friction value.",

    checks: [
      ["flow in equals flow out", "m_a = -m_b", "exact"],
      ["Reynolds number at 1 kg/s", "42 441 (turbulent)", "42 441"],
      ["dp at 1 kg/s: rho g h + Colebrook friction", "6501.4 Pa", "6499.6 Pa"],
      ["dp at 0.5 kg/s", "5340.6 Pa", "5338.9 Pa"],
    ],
  },
  FluidReservoir: {
    title: "Fluid — tank draining under gravity",
    domain: "Fluid",
    equations: [
      "\\rho A_{tank}\\frac{dh}{dt} = -\\dot m, \\qquad \\dot m = \\rho A_{port}\\sqrt{\\frac{2gH}{2 + fL/D}}",
      "H = h + 1.0\\ \\text{m (pipe drop)}, \\qquad (\\zeta_{out} + \\zeta_{exit}) = 0.5 + 1 = 1.5\\ \\text{velocity heads}",
      "m(0) = \\rho A_{tank} h_0 = 995.586 \\times 0.2 \\times 0.9 = 179.205\\ \\text{kg}",
    ],
    insight:
      "Ideal Torricelli flow would give 4.30 kg/s; the tank port, the exit and pipe friction cost 35%, leaving 3.16 kg/s. Because the tank is wide (0.2 m²) the level falls only 34% in 20 s, so the flow rate itself changes little — the level curve is convex, decelerating as the head drops.",
    checks: [
      ["initial mass ρ·A·h₀", "179.205 kg", "179.205 kg"],
      ["mass drained = ρ·A·Δh", "60.513 kg", "60.513 kg"],
      ["initial flow rate", "≈3.16 kg/s", "3.1586 kg/s"],
      ["level at t = 20 s", "0.596 m", "0.5961 m"],
    ],
  },
  FluidLoop: {
    title: "Fluid — pumped loop with an orifice",
    domain: "Fluid",
    equations: [
      "\\Delta p = \\frac{\\zeta\\rho v^2}{2} = \\frac{\\zeta}{2\\rho}\\left(\\frac{\\dot m}{A}\\right)^2 = C\\,\\dot m^2",
      "C = 10177\\ \\text{Pa/(kg/s)}^2 \\quad (\\text{measured, constant})",
      "\\dot m_{turb} = \\frac{\\pi}{8}D\\mu\\times10^4 = 0.157\\ \\text{kg/s}",
    ],
    insight:
      "The orifice law is strictly quadratic in mass flow — measured C is constant to four digits across the whole range (10177 Pa/(kg/s)²). Below ṁ = 0.157 kg/s MSL blends it cubically to keep the derivative finite at zero flow, which is a numerical device, not physics.",
    checks: [
      ["dp ∝ ṁ² across the range", "C = 10177 constant", "10177 at every point"],
      ["dp at ṁ = 1.5 kg/s", "22 898 Pa", "22 898.3 Pa"],
      ["dp at ṁ = 0.975 kg/s", "9 674 Pa", "9 674.6 Pa"],
    ],
  },
  Thermal: {
    title: "Thermal — body cooling to a fixed ambient",
    domain: "Thermal",
    equations: [
      "C\\frac{dT}{dt} = G\\,(T_{amb} - T)",
      "\\tau = \\frac{C}{G} = \\frac{1000}{2} = 500\\ \\text{s}",
      "T(t) = T_{amb} + (T_0 - T_{amb})e^{-t/\\tau}",
    ],
    insight:
      "A single capacitor against a **fixed** temperature gives one clean exponential — unlike two capacitors sharing a conductor, where the equilibrium is an energy-weighted mean. Newton's law of cooling is itself a linearisation; it holds when radiation and convection coefficients are roughly constant.",

    checks: [
      ["time constant C/G", "500 s", "500 s"],
      ["body.T at t = 500 s (one tau)", "314.064 K", "314.064 K"],
      ["body.T at t = 1000 s (two tau)", "300.843 K", "300.844 K"],
      ["body.T at t = 2000 s (four tau)", "294.191 K", "294.191 K"],
      ["heat flow at t = 0, G (T0 - Tamb)", "113.70 W", "113.70 W"],
    ],
  },
  HeatConduction: {
    title: "Thermal — two bodies equalising",
    domain: "Thermal",
    equations: [
      "C\\frac{dT_h}{dt} = G(T_c - T_h), \\qquad C\\frac{dT_c}{dt} = G(T_h - T_c)",
      "T_h + T_c = \\text{const} = 666.30\\ \\text{K} \\qquad (\\text{equal capacitances})",
      "\\tau = \\frac{C}{2G} = 625\\ \\text{s}, \\qquad T_h(t) = 333.15 + 40\\,e^{-t/\\tau}",
    ],
    insight:
      "With equal capacitances the sum of the temperatures is **exactly** conserved, which is a far sharper test than either temperature alone — it holds at every instant, not just at the end. The equilibrium is the arithmetic mean 333.15 K precisely because the capacitances match.",
    checks: [
      ["T_h + T_c at every t", "666.30 K", "666.300 K"],
      ["hot.T at t = 750 s", "345.19 K", "345.198 K"],
      ["equilibrium", "333.15 K", "333.48 / 332.82 K at t=3000"],
    ],
  },
  HeatExchanger: {
    title: "Thermal — heated mass losing heat to ambient",
    domain: "Thermal",
    equations: [
      "C\\frac{dT}{dt} = Q(t) - G_c(T - T_{amb})",
      "\\tau = \\frac{C}{G_c} = \\frac{2000}{0.5} = 4000\\ \\text{s}",
      "Q(t) = 5(t - 10)\\ \\text{W on } [10, 110]\\ \\text{s, then } 500\\ \\text{W}",
    ],
    insight:
      "The time constant here is 4000 s, not the 250 s you get from C = 500 — the parameters matter more than the formula. With only 2 W/K of cooling, 500 W drives the mass towards 543 K, so the run ends far from equilibrium: an exponential approach is slow precisely where it is most visible.",
    checks: [
      ["τ = C/G_c", "4000 s", "4000 s"],
      ["mass.T at t = 60 s", "296.26 K", "296.2614 K"],
      ["mass.T at t = 200 s", "327.52 K", "327.5193 K"],
    ],
  },
  StateMachine: {
    title: "Discrete — a two-state machine on timers",
    domain: "State machine",
    equations: [
      "\\text{initial} \\xrightarrow{1\\,\\text{s}} \\text{running} \\xrightarrow{2\\,\\text{s}} \\text{stopped} \\xrightarrow{1\\,\\text{s}} \\text{initial}",
      "\\text{period} = 1 + 2 + 1 = 4\\ \\text{s}",
    ],
    insight:
      "This is the one example with no differential equations at all. `StateGraph` steps are discrete states with Boolean `active` outputs, and transitions fire on `waitTime`. The whole behaviour is a timing table, so the check is a truth table rather than a numeric tolerance.",

    checks: [
      ["running.active at t = 0.5 s", "0", "0"],
      ["running.active at t = 2 s", "1", "1"],
      ["stopped.active at t = 4 s", "1", "1"],
      ["running.active at t = 6 s (next cycle)", "1", "1"],
      ["transition instants (timers 1 s, 2 s, 1 s)", "1 / 3 / 4 s", "exact"],
    ],
  },
  BuckConverter: {
    title: "Power electronics — step-down chopper",
    domain: "Electrical",
    equations: [
      "\\bar{V}_{out} = D \\cdot V_{in} = 0.6 \\times 24 = 14.4\\ \\text{V}",
      "f_{LC} = \\frac{1}{2\\pi\\sqrt{LC}} = 159\\ \\text{Hz}, \\qquad \\zeta_{LC} = \\frac{1}{2R}\\sqrt{\\frac{L}{C}} = 0.063",
      "\\tau_{RC} = RC = 2.5\\ \\text{ms}",
    ],
    insight:
      "The averaged model predicts 14.4 V and the simulation reaches 14.40 V — but only after the LC filter has rung down. The ringing is severe (ζ ≈ 0.06, no feedback loop), so a short run shows the output **above** the input-scaled value and looks like a boost. Settling takes roughly 20 ms at these component values.",
    checks: [
      ["output at t = 4 ms (still ringing)", "—", "21.44 V"],
      ["output at t = 20 ms", "14.4 V", "14.118 V"],
      ["output at t = 30 ms", "14.4 V", "14.443 V"],
      ["energy: source = C + L + load", "balanced", "0.243 = 0.115 + 0.026 + 0.100 J"],
    ],
  },
  BatteryDischarge: {
    title: "Electrical — battery discharging into a load",
    domain: "Electrical",
    equations: [
      "OCV(SOC) = OCV_{min} + (OCV_{max}-OCV_{min})\\,SOC \\quad \\text{per cell}",
      "v_{term} = N_s\\,OCV - i\\,R_{stack}, \\qquad i = \\frac{N_s OCV}{R_{stack} + R_{load}}",
      "\\frac{d\\,SOC}{dt} = -\\frac{i}{Q_{nom}} \\quad\\Longrightarrow\\quad SOC(t) \\approx e^{-t/\\tau}, \\quad \\tau = \\frac{(R_{stack}+R_{load})Q_{nom}}{OCV_0}",
    ],
    insight:
      "Because the load is a fixed **resistance**, the current falls as the open-circuit voltage falls, so the discharge is self-limiting and roughly exponential. A constant-**power** load would do the opposite and accelerate towards empty. The 15 Ω load is chosen so the pack lasts the full 1800 s window.",
    checks: [
      ["terminal voltage at t = 0", "12.4752 V", "12.4752 V"],
      ["current at t = 0", "−0.831683 A", "−0.831683 A"],
      ["SOC at t = 1800 s", "0.608", "0.608"],
    ],
  },
  DCMotor: {
    title: "Electrical machines — permanent-magnet DC machine",
    domain: "Electrical",
    equations: [
      "L_a\\frac{di_a}{dt} = v_a - k\\,\\omega - R_a i_a, \\qquad J\\frac{d\\omega}{dt} = k\\,i_a - \\tau_{load}",
      "k = \\frac{V_{a,nom} - R_a I_{a,nom}}{\\omega_{nom}} = 0.0764\\ \\text{V·s/rad}",
      "\\text{stall current} = \\frac{V_a}{R_a} = \\frac{24}{0.2} = 120\\ \\text{A}",
    ],
    insight:
      "The machine's rotor inertia dominates (0.15 kg·m² against a 0.002 kg·m² load), so it accelerates over seconds, not milliseconds — a 1.5 s run shows only the ramp. The start-up inrush is genuine and unwelcome in reality: 24 V across 0.2 Ω is 120 A, which is why real drives limit current. Series resistance and a current limit are absent by design here so the transient is visible.",
    checks: [
      ["speed at t = 20 s (rated 300)", "303.6 rad/s", "303.566 rad/s"],
      ["armature current at t = 20 s", "≈0.65 A", "0.6467 A"],
      ["free-running speed at 24 V", "≈313 rad/s", "313.04 rad/s"],
    ],
  },

  DampedOscillator: {
    title: "Mechanical — damped harmonic oscillator",
    domain: "Mechanical",
    equations: [
      "m\\ddot{s} + d\\dot{s} + c\\,s = 0",
      "\\omega_n = \\sqrt{c/m} = 10\\ \\text{rad/s}, \\qquad \\zeta = \\frac{d}{2\\sqrt{cm}} = 0.1",
      "\\omega_d = \\omega_n\\sqrt{1-\\zeta^2} = 9.9499\\ \\text{rad/s}, \\qquad s(t) = s_0 e^{-\\zeta\\omega_n t}\\cos(\\omega_d t + \\varphi)",
      "\\text{decay per cycle} = e^{-2\\pi\\zeta/\\sqrt{1-\\zeta^2}}",
    ],
    insight:
      "Released from rest at s = 0.1 m the mass starts with acceleration **−c·s₀/m = −10 m/s²** — the spring's force and nothing else, since the damper does no work at zero velocity. That single value pins the model's stiffness and mass together before any oscillation is examined.",
    checks: [
      ["initial acceleration −c·s0/m", "−10.0000 m/s²", "−10.0000 m/s²"],
      ["decay of amplitude per cycle", "0.53180", "0.53160"],
      ["damped period 2π/ω_d", "0.63148 s", "0.63144 s (two half-cycles)"],
    ],
  },
  ForcedOscillator: {
    title: "Mechanical — driven oscillator near resonance",
    domain: "Mechanical",
    equations: [
      "m\\ddot{s} + d\\dot{s} + c\\,s = F_0\\sin\\omega t",
      "X = \\frac{F_0/c}{\\sqrt{(1-r^2)^2 + (2\\zeta r)^2}}, \\qquad r = \\frac{\\omega}{\\omega_n}",
      "\\text{phase lag} = \\arctan\\frac{2\\zeta r}{1-r^2}, \\qquad \\text{dissipation per cycle} = \\pi F_0 X \\sin\\varphi",
    ],
    insight:
      "Driving at 1.5 Hz against a 1.59 Hz natural frequency puts r = 0.94, right beside resonance: the response is **6.84 times** the static deflection. In steady state the damper must remove exactly the energy the force supplies each cycle, which closes the energy balance without needing the full transient.",
    checks: [
      ["magnification 1/sqrt((1−r²)²+(2ζr)²)", "6.8411", "6.8430"],
      ["steady amplitude X", "0.68411 m", "0.68430 m"],
      ["dissipation per cycle π·F0·X·sin φ", "13.857 J", "13.861 J"],
      ["phase lag", "40.15°", "40.15°"],
    ],
  },
  TankOrifice: {
    title: "Fluid — a tank draining through an orifice",
    domain: "Fluid",
    equations: [
      "\\dot m = C_d A \\sqrt{2\\rho\\,\\Delta p}, \\qquad \\Delta p = \\rho g h",
      "A_{tank}\\frac{dh}{dt} = -\\frac{\\dot m}{\\rho} \\;\\Rightarrow\\; \\frac{dh}{dt} = -k\\sqrt{h}",
      "\\sqrt{h(t)} = \\sqrt{h_0} - \\frac{k}{2}t \\qquad\\Longrightarrow\\qquad t_{empty} = \\frac{2\\sqrt{h_0}}{k}",
    ],
    insight:
      "A **square-root** discharge law is the whole point: because Torricelli flow goes as √h, the level does not decay exponentially — it reaches **zero in finite time**, with √h falling linearly. That is the signature distinguishing a gravity drain from an RC circuit, and it is measurable directly from the slope of √h.",
    checks: [
      ["√h falls linearly", "constant slope", "0.04920 per second"],
      ["ṁ/√h constant", "const", "0.97971 at every t"],
      ["predicted empty time", "finite", "≈20.3 s"],
      ["level at t = 10 s", "—", "0.25804 m"],
    ],
  },
  NonlinearOrifice: {
    title: "Fluid — orifice flow under a ramped pressure",
    domain: "Fluid",
    equations: [
      "\\dot m = \\frac{A}{\\sqrt{\\zeta/2}}\\sqrt{\\rho\\,\\Delta p}",
      "\\Delta p = \\frac{\\zeta}{2\\rho}\\left(\\frac{\\dot m}{A}\\right)^2 \\qquad (\\text{quadratic in flow})",
    ],
    insight:
      "The orifice law is genuinely **nonlinear**: flow goes as √Δp, not Δp. Raising the differential pressure five-fold multiplies the flow by only √5 ≈ 2.24. Equivalently Δp/ṁ² is a constant set by the geometry, which is the convenient form for checking a simulation because it needs no pressure signal at all.",
    checks: [
      ["ṁ/√Δp constant across a 5x range", "const", "0.008866"],
      ["Δp/ṁ² constant", "const", "12721.3 Pa/(kg/s)²"],
      ["flow ratio for 5x pressure", "√5 = 2.236", "6.269/2.804 = 2.236"],
    ],
  },
  PipeFriction: {
    title: "Fluid — pipe friction as the flow rises",
    domain: "Fluid",
    equations: [
      "\\Delta p = f\\frac{L}{D}\\,\\frac{\\rho v^2}{2}, \\qquad v = \\frac{\\dot m}{\\rho A}, \\qquad Re = \\frac{\\rho v D}{\\mu}",
      "\\frac{1}{\\sqrt{f}} = -2\\log_{10}\\left(\\frac{\\epsilon/D}{3.7} + \\frac{2.51}{Re\\sqrt{f}}\\right)",
    ],
    insight:
      "Friction is nonlinear for two reasons at once: Δp grows with the **square** of velocity, and the friction factor f itself **falls** as the flow becomes more turbulent. Both are visible as the ramp raises the flow — f drifts down from 0.0297 to 0.0226 while the pressure drop climbs by a factor of 49 for an eight-fold rise in flow.",
    checks: [
      ["f falls with Reynolds number", "decreasing", "0.0297 → 0.0226"],
      ["Reynolds at 1 kg/s", "—", "63 662"],
      ["Δp ratio for 8x flow", "≈64 (v²)", "45914/944 = 48.6"],
      ["Δp steady once flow is steady", "constant", "45914.5 Pa at t = 4 and 5 s"],
    ],
  },

  DampedBounce: {
    title: "Mechanical — a ball bouncing until it stops",
    domain: "Mechanical",
    equations: [
      "v_0 = \\sqrt{2gh_0}, \\qquad v_k = e^{k-1}\\,v_0"
      ,
      "\\Delta t_k = \\frac{2\\,e^{k-1}v_0}{g}, \\qquad t_{rest} = \\frac{v_0}{g} + \\sum_{k=1}^{n-2} \\frac{2e^{k}v_0}{g}",
      "h_{max,k} = e^{2k}h_0, \\qquad \\text{caught when } v_k < v_{min}",
    ],
    insight:
      "An **ideal** bouncing ball never stops: the bounces shrink geometrically but go on for ever, infinitely many of them in a finite time. A floor that can *hold* the ball therefore needs one extra rule. The model latches a Boolean the first time an impact arrives slower than `v_min`, and from then on the ball is pinned — which is what makes the rest time finite and computable.",
    checks: [
      ["time to first impact sqrt(2h0/g)", "0.9030 s", "0.9030 s"],
      ["impact speeds e^(k-1)v0", "8.8589, 7.0871, 5.6697 …", "8.8584, 7.0830, 5.6665 …"],
      ["peak heights e^2 h0", "2.5600, 1.6384, 1.0486 m", "2.5600, 1.6384, 1.0486 m"],
      ["number of rebounds", "13", "13"],
      ["time the ball comes to rest", "7.6310 s", "7.6310 s"],
      ["final height and speed", "0, 0", "−1e−10, 0"],
    ],
  },

  AirfoilLift: {
    title: "Aerospace — lift and drag of a wing",
    domain: "Aerospace",
    equations: [
      "c_l = 2\\pi(\\alpha - \\alpha_0) \\quad \\text{(thin-airfoil theory, until stall)}",
      "c_d = c_{d0} + \\frac{c_l^2}{\\pi\\,AR\\,e} \\quad \\text{(induced drag from the trailing vortices)}",
      "L = \\tfrac12 \\rho V^2 S\\,c_l, \\qquad D = \\tfrac12 \\rho V^2 S\\,c_d",
      "V_{stall} = \\sqrt{\\frac{2mg}{\\rho S\\,c_{l,max}}}",
    ],
    insight:
      "Two formulas explain the whole plot. Lift is **linear** in angle of attack, at 2π per radian, until the flow separates at the stall. Drag has a floor — the profile drag — plus a term growing with the **square** of the lift coefficient, because a wing that lifts harder trails stronger vortices and pays for them.",
    checks: [
      ["c_l = 2π·α_rad at α = 5 deg", "0.7679", "0.7682"],
      ["c_d = 0.008 + c_l²/(πARe) at α = 5 deg", "0.0396", "0.0396"],
      ["c_d at α = 10 deg", "0.1006", "0.1006"],
      ["stall speed sqrt(2mg/(rho S cl_max))", "26.74 m/s", "26.74 m/s"],
    ],
  },
  Phugoid: {
    title: "Aerospace — the phugoid oscillation",
    domain: "Aerospace",
    equations: [
      "\\dot V = -g\\sin\\gamma, \\qquad \\dot\\gamma = \\frac{\\sqrt2\\,g}{V_0}\\left(\\frac{V}{V_0}-1\\right)",
      "\\omega = \\left(g\\,\\frac{\\sqrt2\\,g}{V_0^2}\\right)^{1/2} = \\frac{2^{1/4}g}{V_0}",
      "T = \\frac{2\\pi V_0}{2^{1/4}g}, \\qquad E = \\tfrac12 V^2 + gh = \\text{const}",
    ],
    insight:
      "A disturbed aircraft trades speed for height and back again, slowly enough that a pilot feels it as a gentle porpoising. With no drag and no thrust, **energy is the only thing that must be conserved** — kinetic and potential exchange, and nothing else. That makes this a rare case where a chaotic-looking motion has an exact invariant and an exact period.",
    checks: [
      ["period 2*pi*V0/(2^(1/4)*g) at V0 = 70", "37.7009 s", "37.719 s"],
      ["energy 0.5*V^2 + g*h constant", "const", "drift 0.0001%"],
      ["speed range about the trim point", "65 to 75 m/s", "65.00 to 75.00"],
      ["amplitude independence of the period", "same at every amplitude", "37.701 s at 0.001 to 5 m/s"],
    ],
  },

  ControlLoop: {
    title: "Control — a PID loop driving a first-order plant",
    domain: "Control",
    equations: [
      "e = r - y, \\qquad u = k\\left(e + \\frac{1}{T_i}\\int e\\,dt + T_d\\frac{de}{dt}\\right)",
      "T\\frac{dy}{dt} + y = u \\qquad (\\text{first-order plant, } T = 1)",
      "\\text{steady state: } y \\to r \\text{ exactly, because the integral term removes the error}",
    ],
    insight:
      "This is the diagram everyone draws and few can point at in a running system. Three blocks and one feedback line: a **setpoint** feeds a subtractor, the error goes to a **PID**, its output drives a **plant**, and the measured output returns to be subtracted. The integral term is what makes the final error zero rather than merely small.",
    checks: [
      ["output follows a step setpoint", "y to 1", "0.7457 at 1.5 s, 1.0234 at 2 s"],
      ["steady-state error with integral action", "0", "−1.03e−4"],
      ["overshoot for k=2, Ti=0.5, Td=0.1", "finite", "9.20%"],
      ["error before the step", "0", "0.0000"],
    ],
  },
  GearTrain: {
    title: "Mechanical — a motor driving a load through a gearbox",
    domain: "Mechanical",
    equations: [
      "\\omega_a = \\text{ratio} \\times \\omega_b, \\qquad \\tau_b = \\text{ratio} \\times \\tau_a",
      "J_a\\dot\\omega_a = \\tau_{motor} - \\tau_a, \\qquad J_b\\dot\\omega_b = \\tau_b - \\tau_{bearing}",
    ],
    insight:
      "An ideal gearbox trades speed for torque, and it does so **exactly**: whatever the ratio does to one, it does the inverse to the other, so the power through it is unchanged. That is why a gearbox can let a small motor lift a heavy load — it is not creating torque, it is spending speed to buy it.",
    checks: [
      ["speed ratio ω_motor / ω_load", "5", "5.0000 at every t"],
      ["torque ratio τ_load / τ_motor", "5", "50/10 = 5"],
      ["steady-state load torque", "50 N·m", "−50.0000 N·m"],
      ["settles within the run", "0", "load.w(10) = 0.00000"],
    ],
  },

  HalfWaveRectifier: {
    title: "Electrical — a diode rectifier and its load",
    domain: "Electrical",
    equations: [
      "V_{out} = V_{source} - V_{diode} \\quad \\text{when } V_{source} > V_{diode}",
      "V_{out} = 0 \\quad \\text{otherwise (the diode blocks)}",
    ],
    insight:
      "This is the smallest circuit that shows what a diode is *for*. Positive half: the diode conducts and the load sees the source minus the diode's forward drop. Negative half: the diode blocks and the load sees nothing. One component turns an alternating supply into a one-way one.",
    checks: [
      ["peak output at the +12 V peak", "12 − 0.466", "11.5338 V"],
      ["output at the −12 V peak", "0 (blocked)", "−0.0001 V"],
      ["diode forward drop at 0.115 A", "≈0.466 V", "0.466 V"],
      ["conduction", "half the cycle", "positive half only"],
    ],
  },
  ResistorSelfHeating: {
    title: "Multiphysics — a resistor heating itself",
    domain: "Multiphysics",
    equations: [
      "P_{in} = \\frac{V^2}{R} = \\frac{10^2}{10} = 10\\ \\text{W}",
      "C\\frac{dT}{dt} = P_{in} - G\\,(T - T_{amb})",
      "\\tau = \\frac{C}{G} = \\frac{5}{0.5} = 10\\ \\text{s}, \\qquad \\Delta T_\\infty = \\frac{P_{in}}{G} = 20\\ \\text{K}",
      "T(t) = T_{amb} + \\Delta T_\\infty\\left(1 - e^{-t/\\tau}\\right)",
    ],
    insight:
      "Two domains, one equation each, joined by a single port. The **electrical** side is instantaneous — Ohm's law has no memory, so the loss is 10 W from the first microsecond. The **thermal** side integrates: that 10 W accumulates in 5 J/K of heat capacity until the body is hot enough to shed it to ambient as fast as it arrives. Nothing couples them but `connect(resistor.heatPort, body.port)`, and the two timescales are what make the model interesting: the current settles in microseconds, the temperature over tens of seconds.",
    checks: [
      ["loss power V^2/R", "10 W", "10.00 W"],
      ["time constant C/G", "10 s", "10 s"],
      ["body.T at 1 tau", "305.79 K", "305.79 K"],
      ["body.T at 2 tau", "310.44 K", "310.44 K"],
      ["steady rise P/G", "20 K", "20 K"],
    ],
  },

};
