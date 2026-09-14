/**
 * A plain-language explanation for each example, and how to read its equations.
 *
 * Kept apart from the mathematics: the derivation is the proof, this is the
 * teaching. Every note gets a "What this shows" and a "Reading the equations"
 * section, so a reader who does not want to follow algebra can still learn what
 * the model is doing and why it behaves the way it does.
 */
export const EXPLAIN = {
  BouncingBall: {
    idea:
      "A ball is dropped from 1 m. Each time it hits the floor it rebounds at 90% of the speed it arrived with, so every bounce is lower than the last. Nothing pushes the ball — the whole model is gravity plus one rule about the floor.",
    schematic:
      "**This model has no schematic, and that is correct.** There are no library components in it: no spring, no motor, no mass block. The ball is just two variables — a height and a speed — and the physics is written directly as equations. Other examples (like `MassSpring` or `Electrical`) are built from parts, so they *do* have a diagram. This one is a sentence about a ball.",
    reading: [
      ["`Real h(start=1)`", "how high the ball is. `start=1` means it begins 1 metre up."],
      ["`Real v`", "how fast it is moving, upwards being positive."],
      ["`der(h) = v`", "the height changes at exactly the speed. If it moves at 2 m/s, the height grows by 2 each second."],
      ["`der(v) = -9.81`", "the speed changes by −9.81 every second, because gravity pulls down. This is the only force."],
      ["`when h <= 0 then`", "below this is not an equation — it is an **event**. It fires the instant the ball reaches the floor."],
      ["`reinit(v, -e*pre(v))`", "at that instant, set the speed to −0.9 × whatever it was. `pre(v)` means 'the value just before the bounce', which is how you read the old speed while replacing it."],
    ],
    takeaway:
      "Because the ball loses 10% of its speed each bounce, it loses 19% of its *height* (0.9² = 0.81). The bounce times get closer and closer together, and in the ideal maths the ball makes infinitely many bounces before coming to rest — which is why the plot's bounces bunch up at the end.",
  },
  Electrical: {
    idea:
      "A 10 V battery charges a capacitor through a 100 Ω resistor. The capacitor starts empty, so current flows fast at first; as it fills, the current drops and the voltage rises, each approaching its final value but never quite arriving.",
    reading: [
      ["`ConstantVoltage source(V=10)`", "the battery. It holds 10 V no matter what."],
      ["`Resistor resistor(R=100)`", "how hard it is for current to flow: 10 V pushes 0.1 A through 100 Ω."],
      ["`Capacitor capacitor(C=0.001)`", "stores charge. Its rule is `i = C·der(v)` — current flows only while the voltage is *changing*."],
      ["`connect(...)`", "each `connect` does two things silently: it makes the voltages equal at the joined pins, and makes the currents balance (what flows out of one part flows into the next)."],
      ["`τ = RC = 0.1 s`", "the **time constant** — the natural timescale of the circuit. After one τ it is 63% charged; after five τ, 99.3%."],
    ],
    takeaway:
      "A capacitor does not fill up at a steady rate. The fuller it gets, the less voltage is left across the resistor to push current in, so it slows down. That is why the curve is an exponential and not a straight line.",
  },
  RLC: {
    idea:
      "A resistor, an inductor and a capacitor in series, switched on. Energy sloshes back and forth between the capacitor's voltage and the inductor's current, while the resistor drains it away.",
    reading: [
      ["`StepVoltage source(V=10, startTime=0.001)`", "the supply switches on 1 ms into the run."],
      ["`Inductor inductor(L=0.1)`", "resists *changes* in current, and stores energy in a magnetic field."],
      ["`Capacitor capacitor(C=0.0001)`", "resists changes in voltage, and stores energy in an electric field."],
      ["`ζ = (R/2)·√(C/L) = 1.58`", "the damping ratio. It is greater than 1 — which usually means 'no ringing'."],
    ],
    takeaway:
      "**This circuit rings anyway, and that is not a bug.** The rule 'ζ > 1 means no overshoot' belongs to a *parallel* RLC or a second-order low-pass filter. In a **series** RLC the capacitor and inductor are in the same loop, so the response has complex zeros and oscillates whatever ζ is. The plot is right and the folk rule is being applied to the wrong circuit.",
  },
  SineAC: {
    idea:
      "A 50 Hz sine wave drives a resistor and an inductor in series. The inductor fights the current, so the current lags behind the voltage and the two components do not peak at the same moment.",
    reading: [
      ["`SineVoltage source(V=230, f=50)`", "`V` is the **amplitude**, not the RMS value — so this is 230 V peak, about 163 V RMS."],
      ["`X_L = 2πfL = 15.71 Ω`", "the inductor's 'resistance' to alternating current. It grows with frequency."],
      ["`|Z| = √(R² + X_L²) = 25.43 Ω`", "the total opposition, combining resistance and reactance — they add like the sides of a triangle, not like plain numbers."],
      ["`φ = 38.15°`", "how far the current lags the voltage. At the instant the supply peaks, the current has already started to fall."],
    ],
    takeaway:
      "Resistor voltage and inductor voltage are always 90° out of phase, so their peaks never coincide and they do **not** add up to the supply voltage at any instant. The supply's 230 V is split in a way that a simple sum would get wrong.",
  },
  MassSpring: {
    idea:
      "A mass sits on a spring that is already squashed, with a damper to take energy out. Released from rest, it oscillates about the spring's resting position and slowly settles there.",
    reading: [
      ["`Spring spring(c=100, s_rel0=0.5)`", "`c` is stiffness in N/m; `s_rel0=0.5` is its **unstretched length**, so at the mass's starting position it is compressed by 0.5 m."],
      ["`Mass mass(m=1)`", "1 kg. Its equation is simply `F = ma`."],
      ["`Damper damper(d=2)`", "takes energy out in proportion to speed, which is what makes the oscillation die away."],
      ["`ωₙ = √(c/m) = 10 rad/s`", "how fast it *would* oscillate with no damping at all."],
      ["`ζ = d/(2√(cm)) = 0.1`", "how much damping there is. Below 1 means it oscillates while decaying."],
    ],
    takeaway:
      "The mass starts at position 0 while the spring's natural length is 0.5 m, so the spring is **pre-loaded** and shoves the mass with 50 N from the very first instant. Its initial acceleration is 50 m/s², not zero — the oscillation is centred on 0.5 m, not on 0.",
  },
  MassSpringDamper: {
    idea:
      "Two masses float free, joined by a spring and damper, with a 1 N force applied to the first one. Nothing is bolted down, so the whole pair drifts away while the two masses bob relative to each other.",
    reading: [
      ["`Force force`", "a constant 1 N push on `mass1`, switched on at t = 0.1 s."],
      ["`SpringDamper coupling(c=50, d=1)`", "the only thing joining the two masses. Its force depends on how far apart they are and how fast that gap is changing."],
      ["`μ = m₁m₂/(m₁+m₂) = 2/3 kg`", "the **reduced mass** — the effective inertia of the bobbing motion, always smaller than either mass alone."],
      ["`x_cm'' = F/(m₁+m₂) = 1/3 m/s²`", "because nothing external holds the pair back, their common centre of mass just accelerates."],
    ],
    takeaway:
      "Two things happen at once: the pair drifts as one object, and the gap between them oscillates and settles. The steady gap is **not** `F/c` — that would be true if one end were nailed down. With both free, the spring carries only part of the force and the gap settles at `F·m₂/(c(m₁+m₂))`.",
  },
  RotationalPendulum: {
    idea:
      "A flywheel on a torsional spring, twisted by a torque that switches on at t = 0.1 s. It twists, springs back, and rings down to a stopped position.",
    reading: [
      ["`Inertia inertia(J=0.5)`", "the rotational equivalent of mass: harder to spin up."],
      ["`SpringDamper spring(c=20, d=0.5)`", "a torsional spring that also loses energy as it turns."],
      ["`TorqueStep torque(stepTorque=2, startTime=0.1)`", "nothing, then suddenly a steady 2 N·m twist."],
      ["`φ(∞) = τ/c = 0.1 rad`", "where it finally stops: the twist at which the spring pushes back exactly as hard as the torque pushes."],
    ],
    takeaway:
      "Despite the name there is **no gravity and no pendulum** here. Modelica's rotational library has no gravitational term, so this is a torsional oscillator — the rotational twin of a mass on a spring. The final angle is only 0.1 rad (about 6°), which surprises people who expect a big swing; torque and angle are different quantities and `τ/c` is what sets it.",
  },
  DampedOscillator: {
    idea:
      "A 1 kg mass on a 100 N/m spring, with a damper. Pulled aside by 10 cm and let go, it wobbles, each swing smaller than the last.",
    reading: [
      ["`Mass mass(m=1, s(fixed=true, start=0.1))`", "`s` is position; `fixed=true` means 'start exactly here', not 'let the solver choose'."],
      ["`Spring spring(c=100)`", "a stiff spring. On its own it would oscillate at 10 rad/s, about 1.6 Hz."],
      ["`Damper damper(d=2)`", "force proportional to speed — the classic 'viscous' damping."],
      ["`ζ = d/(2√(cm)) = 0.1`", "lightly damped. Each full cycle keeps 53% of the amplitude."],
    ],
    takeaway:
      "The first instant tells you a lot: the mass is moving at zero speed, so the damper does nothing yet, and the only force is the spring. That gives an initial acceleration of exactly `−c·s₀/m = −10 m/s²`. One measurement pins down the spring and the mass together before any oscillation is looked at.",
  },
  ForcedOscillator: {
    idea:
      "The same mass and spring, but now something pushes it back and forth at a steady rhythm — and the rhythm is set close to the spring's own natural one. The response is far bigger than a slow push would give.",
    reading: [
      ["`Sine drive(amplitude=10, f=1.5)`", "a 10 N push, reversing 1.5 times a second."],
      ["`ωₙ = 10 rad/s = 1.59 Hz`", "the frequency the spring *wants* to oscillate at."],
      ["`r = ω/ωₙ = 0.94`", "the drive is running at 94% of the natural frequency — very close to resonance."],
      ["`X = 0.684 m`", "the steady swing. A *static* 10 N would only stretch this spring 0.1 m, so the rhythm multiplies the effect by **6.8×**."],
      ["`φ = 40.15°`", "the response lags the push. By the time the mass reaches its furthest point, the force has already turned around and is heading back."],
    ],
    takeaway:
      "Resonance is not a magical amplification — it is what happens when you push in time with the natural motion. The damper is the only thing limiting the size: in steady state it must remove exactly the energy the push supplies each cycle, and those two numbers balance to within 0.03%.",
  },
  DoublePendulum: {
    idea:
      "Two rods hinged end to end. Released from two different starting angles, the motion is chaotic: wildly unpredictable in detail, yet obeying one simple rule exactly.",
    reading: [
      ["`Revolute upper` / `Revolute lower`", "two hinges: one to the world, one joining the rods."],
      ["`BodyBox rod1 / rod2`", "each rod is 0.5 m and made of steel — about 9.6 kg each, which is heavier than people guess."],
      ["no dampers anywhere", "nothing in this model removes energy."],
    ],
    takeaway:
      "You cannot check a chaotic system by comparing paths — two correct simulations of it diverge. What *can* be checked is **total energy**, which must never change. Measured drift is 0.83% and it wobbles rather than growing, which is what a good solver looks like. A physically wrong model would show energy climbing steadily, and the motion would eventually fly apart.",
  },
  FluidPipe: {
    idea:
      "Water is pushed through a 1 m pipe at a flow rate that ramps up from nothing to 1 kg/s. The faster it goes, the more pressure it takes to keep it going.",
    reading: [
      ["`MassFlowSource_T pump`", "imposes a *flow rate* rather than a pressure — it is the 'pump'."],
      ["`Ramp ramp(height=1, duration=1, startTime=0.1)`", "the flow rises smoothly from 0 to 1 kg/s between 0.1 s and 1.1 s."],
      ["`Boundary_pT sink`", "the far end, held at a fixed 1 atmosphere."],
      ["`Re ≈ 42 000`", "the flow is thoroughly **turbulent**, not smooth and layered."],
    ],
    takeaway:
      "The pressure drop depends on a *friction correlation*, not on a law of nature — different books give different formulas that disagree by a few percent. So the honest check here is not the pressure value but a **mass balance**: whatever flows in must flow out, exactly. That is true whatever the correlation says.",
  },
  FluidReservoir: {
    idea:
      "A wide tank of water drains through a small pipe at its bottom. The level falls faster at first and more slowly as the water gets shallower — because the shallower it is, the less pressure pushes it out.",
    reading: [
      ["`OpenTank tank(crossArea=0.2, level_start=0.9)`", "0.2 m² of surface area and 0.9 m of water to start with — about 180 kg."],
      ["`StaticPipe pipe(height_ab=-1)`", "the pipe drops 1 m below the tank's outlet."],
      ["`portsData={...diameter=0.03}`", "the outlet is 30 mm across."],
      ["`Boundary_pT drain`", "open air at the far end, 1 atmosphere."],
    ],
    takeaway:
      "Ideal textbook Torricelli flow would give 4.3 kg/s. Add the losses a real fitting has — the tank's outlet, the pipe's friction, and the water spraying out of the end — and you get 3.16 kg/s. A third of the flow is lost to effects the ideal formula ignores, which is why the measured number is the one to trust.",
  },
  TankOrifice: {
    idea:
      "A narrow tank drains through a hole. This is the classic demonstration that a tank does **not** empty like a leaking battery: the level falls in a curve that reaches zero in a *finite* time.",
    reading: [
      ["`OpenTank tank(crossArea=0.01, level_start=1)`", "a narrow tank — 100 cm² — so the level moves visibly."],
      ["`SimpleGenericOrifice orifice(zeta=0.5)`", "a hole with a known resistance coefficient."],
      ["`Δp = ρgh`", "the pressure at the hole comes from the weight of water above it."],
      ["`ṁ ∝ √h`", "so the flow is proportional to the **square root** of the depth."],
    ],
    takeaway:
      "Because the flow goes as √h, the *square root* of the level falls in a straight line — and a straight line reaches zero. That is the difference between this and a capacitor discharging, which only ever approaches zero. You can see it directly: `√h` drops by 0.0492 every second, evenly, right to the end. The last millimetre takes a long time, but it does get there.",
  },
  NonlinearOrifice: {
    idea:
      "Water is pushed through a small hole while the supply pressure is steadily raised from 1 to 6 atmospheres. The flow rises too — but nowhere near as fast as the pressure does.",
    reading: [
      ["`Ramp pressure(height=500000, offset=101325)`", "the supply climbs from 1 bar to 6 bar over 10 s."],
      ["`SimpleGenericOrifice orifice(zeta=2.5, diameter=0.02)`", "a 20 mm hole with a resistance coefficient."],
      ["`Boundary_pT sink(p=101325)`", "the outlet stays at 1 bar, so the *difference* across the hole is what drives the flow."],
      ["`ṁ ∝ √Δp`", "the square-root law of a sharp-edged orifice."],
    ],
    takeaway:
      "Five times the pressure gives only √5 ≈ 2.24 times the flow. This is **the** nonlinearity of fluid systems: doubling the effort does not double the result. It is also why doubling a pump's pressure does not double a system's throughput, and why flow meters can infer flow from a pressure measurement using a square root.",
  },
  PipeFriction: {
    idea:
      "The same pipe, with the flow ramped up to eight times its starting rate, to see how the pressure needed grows.",
    reading: [
      ["`StaticPipe pipe(length=2, diameter=0.02)`", "2 m of 20 mm bore pipe."],
      ["`Δp = f·(L/D)·(ρv²/2)`", "the Darcy–Weisbach law: friction pressure grows with the **square** of velocity."],
      ["`f`, the friction factor", "how rough the flow is. This is the interesting part — it is *not* a constant."],
      ["`Re = ρvD/μ`", "the Reynolds number: the ratio of inertia to viscosity, which tells you whether the flow is smooth or churning."],
    ],
    takeaway:
      "Two effects stack. Pressure rises with velocity squared, so eight times the flow would give 64 times the pressure if `f` stayed put. But `f` **falls** as the flow becomes more turbulent — from 0.0297 down to 0.0226 — so the real rise is 49 times, not 64. Both numbers are in the table, and the gap between them is exactly this second effect.",
  },
  Thermal: {
    idea:
      "A warm block cools towards a large room held at a fixed temperature. The bigger the temperature gap, the faster it cools; as the gap closes, cooling slows.",
    reading: [
      ["`HeatCapacitor body(C=1000, T(start=350))`", "the block: 1000 J/K of heat capacity, starting at 350 K (77 °C)."],
      ["`ThermalConductor conductor(G=2)`", "how easily heat gets out: 2 W per kelvin of difference."],
      ["`FixedTemperature ambient(T=293.15)`", "the room, held at 20 °C and unaffected by the block."],
      ["`τ = C/G = 500 s`", "the cooling timescale. After 500 s the gap to room temperature has shrunk to 37% of what it was."],
    ],
    takeaway:
      "Newton's law of cooling is *linear in the temperature difference*, which is why this produces one clean exponential. At the first instant the gap is 56.85 K, so heat leaves at `2 × 56.85 = 113.7 W` — the largest it will ever be, and easy to check by hand.",
  },
  HeatConduction: {
    idea:
      "Two identical blocks, one hot and one cold, joined by a bar. Heat flows from the hot one to the cold one until they meet in the middle.",
    reading: [
      ["`hot` / `cold`", "identical: 2500 J/K each, starting at 100 °C and 20 °C."],
      ["`ThermalConductor wall(G=2)`", "the bar between them: 2 W per kelvin of difference."],
      ["`τ = C/(2G) = 625 s`", "how long the equalising takes."],
    ],
    takeaway:
      "Because the two blocks are **identical**, the sum of their temperatures can never change — energy only moves between them, and equal capacities mean equal temperature swings. So `hot.T + cold.T = 666.30 K` at every instant, not just at the end. That is a much sharper test than checking either temperature alone, and it holds to the last decimal. They settle at the average, 333.15 K.",
  },
  HeatExchanger: {
    idea:
      "A block of material is heated by a power supply that ramps up over 100 seconds, while a cooler surround steadily draws heat away. It warms, and keeps warming, because the heater outpaces the losses.",
    reading: [
      ["`HeatCapacitor mass(C=2000)`", "2000 J/K — a substantial thermal mass."],
      ["`Ramp ramp(height=500, duration=100, startTime=10)`", "the heater: nothing for 10 s, then rising to 500 W by t = 110 s, then holding."],
      ["`ThermalConductor loss(G=0.5)`", "a poor path to the surroundings — only 0.5 W per kelvin."],
      ["`τ = C/G = 4000 s`", "the thermal timescale. It is **much** longer than the 200 s run."],
    ],
    takeaway:
      "The parameters decide the answer more than the shape of the formula does. With these values the block would eventually reach 543 K (270 °C), but the run ends after only 5% of one time constant, so it is nowhere near. That is why the curve looks almost straight here: an exponential approached over a short window always does.",
  },
  StateMachine: {
    idea:
      "A simple state machine: it starts, runs for 2 seconds, stops for 1, then starts again — repeating forever. No differential equations at all.",
    reading: [
      ["`StateGraph.InitialStep`", "where the machine begins."],
      ["`StepWithSignal running` / `stopped`", "the states, each with an `active` output that is 1 while it is the current state."],
      ["`Transition waitForStart(waitTime=1)`", "a change of state that fires after a delay."],
      ["`inner StateGraphRoot`", "the shared 'engine' every state machine needs; it manages which state is active."],
    ],
    takeaway:
      "This is the one example that is **discrete** — it has states rather than variables, and its behaviour is a timing table rather than a curve. So the natural check is a truth table: `running.active` is 0 before 1 s, 1 between 1 s and 3 s, 0 again by 4 s, and the cycle repeats every 4 seconds.",
  },
  BuckConverter: {
    idea:
      "A 24 V supply is switched on and off 20,000 times a second. On for 60% of each cycle, off for 40% — so the load sees an *average* of about 14.4 V, which is how a chopper makes a lower voltage without wasting the difference as heat.",
    reading: [
      ["`ChopperStepDown chopper`", "a switch and a freewheeling diode. The switch connects the supply; the diode takes over the current when it opens."],
      ["`SignalPWM pwm(f=20000)`", "turns the switch on and off 20,000 times per second."],
      ["`Ramp duty(height=0.6, duration=0.001)`", "the on-fraction, ramping from 0 to 0.6 in the first millisecond."],
      ["`Inductor inductor(L=0.002)`", "smooths the on/off pulses into a steady current."],
      ["`V_out = D × V_in = 0.6 × 24 = 14.4 V`", "the average, which is what the filter passes through."],
    ],
    takeaway:
      "At t = 4 ms the output reads **21 V** — well above the 14.4 V 'answer'. That is not a bug: the LC filter has almost no damping (ζ ≈ 0.06) and is still ringing, and a short run catches it on the way up. Extend to 30 ms and it settles at 14.44 V, exactly the prediction. The example's time span was extended for this reason.",
  },
  BatteryDischarge: {
    idea:
      "A three-cell battery powers a resistor. As it drains, its voltage falls, so it pushes less current — the discharge slows itself down.",
    reading: [
      ["`CellStack battery(Ns=3, Np=1)`", "3 cells in series, 1 in parallel. Each stores 3600 coulombs."],
      ["`CellData(Qnom=3600, OCVmax=4.2, OCVmin=3.0, Ri=0.05)`", "the cell model: 4.2 V full, 3.0 V empty, 0.05 Ω internal resistance each."],
      ["`Resistor load(R=15)`", "a fixed resistance — this detail is what makes the discharge self-limiting."],
      ["`SOC(fixed=true, start=1)`", "starts fully charged."],
    ],
    takeaway:
      "A fixed **resistance** load draws less current as the voltage sags, so the discharge decays roughly exponentially and lasts a long time. A fixed **power** load does the opposite: it draws *more* current as the voltage falls, and the battery collapses suddenly at the end. Same battery, very different curve — the load decides.",
  },
  DCMotor: {
    idea:
      "A permanent-magnet DC motor is switched on through a voltage ramp and spins up a small load. It starts with a large current because a stationary motor has no back-EMF to oppose the supply.",
    reading: [
      ["`DC_PermanentMagnet motor(VaNominal=24, IaNominal=5, wNominal=300)`", "a machine rated 24 V, 5 A, 300 rad/s. Modelica derives its torque constant from these."],
      ["`Ra = 0.2 Ω`", "the armature resistance. Set explicitly, and it is what limits the starting current."],
      ["`Inertia load(J=0.002)`", "a light load, but the machine's *own* rotor is 0.15 kg·m² — 75 times bigger."],
      ["`QuadraticSpeedDependentTorque drag(tau_nominal=0.05, w_nominal=300)`", "a fan-like load: torque grows with the square of speed, reaching 0.05 N·m at rated speed."],
    ],
    takeaway:
      "A motor at standstill generates no back-EMF, so at the first instant the full 24 V sits across 0.2 Ω — a 120 A inrush, 24 times the rated current. Real drives limit this, because the heat is enormous. Here it is left visible. The machine's own rotor inertia dominates the load, so it takes about 2.7 s to reach its operating point near 300 rad/s; a 1.5 s run would only catch the ramp.",
  },
  Rectifier: {
    idea:
      "A diode, a capacitor and a load. The diode lets current through in only one direction, so it passes the positive half of each AC cycle and blocks the negative half — roughly halving the sine wave. The capacitor then holds the voltage up between the peaks.",
    reading: [
      ["`SineVoltage source(V=10, f=50)`", "a 10 V amplitude sine at 50 Hz — one cycle every 20 ms."],
      ["`Diode diode`", "Modelica's diode is a **Shockley** device: the forward drop is logarithmic and depends on current. It is not the 0.7 V step most textbooks draw."],
      ["`Capacitor capacitor(C=0.0001)`", "holds charge through the gap between peaks."],
      ["`Resistor load(R=1000)`", "the only discharge path, so the capacitor empties with τ = R·C = 0.1 s."],
    ],
    takeaway:
      "The capacitor charges to the peak, then discharges through the load while the diode is off. With a 0.1 s time constant against a 20 ms cycle, it loses about three quarters of its charge between peaks — this is a *poorly* smoothed supply. Fitting a larger capacitor is exactly how a real one would be improved, and that is the design lesson here.",
  },
  FluidLoop: {
    idea:
      "A pump drives water round a loop through a small orifice. The flow is ramped up to 1.5 kg/s, and the pressure needed across the orifice climbs much faster than the flow does.",
    reading: [
      ["`ControlledPump pump`", "imposes a flow rate rather than a pressure — think of it as a positive-displacement pump."],
      ["`Ramp ramp(height=1.5, duration=2, startTime=0.2)`", "flow rises from 0 to 1.5 kg/s over two seconds."],
      ["`SimpleGenericOrifice orifice(zeta=2.5, diameter=0.02)`", "the restriction: a 20 mm hole with a known loss coefficient."],
      ["`Boundary_pT reservoir` / `sink`", "both at 1 atmosphere, so only the orifice creates any pressure difference."],
    ],
    takeaway:
      "The orifice follows a strict square law — `Δp` divided by flow squared is the same number at every flow rate, 10 177 in SI units. Below about 0.157 kg/s Modelica blends the curve cubically so the maths stays well-behaved near zero flow; that is a numerical device, not physics, and it is why the very lowest points sit slightly off the square law.",
  },
  DampedBounce: {
    idea:
      "The same ball, dropped from 4 m, but the floor now GIVES UP catching it once the impacts get gentle enough. It bounces 13 times, each one lower than the last, and then simply sits on the floor.",
    schematic:
      "**No schematic again, and for the same reason.** The ball is two variables; the physics is in the equations. What is new here is a third declaration — a Boolean that remembers whether the ball has been caught.",
    reading: [
      ["`Real h(start=4, fixed=true)`", "the ball starts 4 m up. Higher than the other example, so there are more bounces to watch."],
      ["`Real v`", "the vertical speed, upwards positive."],
      ["`Boolean atRest(start=false)`", "a **memory**: false while the ball is bouncing, true once it has settled. A Boolean is a declaration just like `Real`, so it costs nothing on the canvas."],
      ["`atRest = h <= 0 and abs(v) < v_min`", "the ball counts as caught when it is on the floor *and* arriving gently."],
      ["`der(v) = if atRest then 0 else -9.81`", "gravity keeps pulling until the ball is caught. The `if` is how an equation is switched off without deleting it."],
      ["`der(h) = if atRest then 0 else v`", "and the height stops changing too — otherwise the ball would keep sinking through the floor at whatever speed it had."],
      ["`when h <= 0 and abs(v) >= v_min then reinit(v, -e*v)`", "still arriving fast: bounce, keeping 80% of the speed."],
      ["`when atRest then reinit(v, 0)`", "just been caught: throw the speed away. **`reinit` is the only way to replace a value at an event** — setting the acceleration to zero would stop it speeding up but leave it drifting downwards."],
    ],
    takeaway:
      "An ideal ball never stops — the bounces get smaller but there are infinitely many, all squeezed into a finite time. So a ball that *does* stop needs a rule saying when the floor wins. Here it is a speed threshold: the floor catches anything arriving slower than 0.5 m/s. That makes the number of bounces countable (13) and the stopping time predictable (7.63 s), and both match the simulation exactly.",
  },
};
