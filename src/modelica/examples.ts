/**
 * Built-in example models.
 *
 * These exist so the editor is never a blank canvas: pressing Simulate, moving
 * a component or editing a parameter should all do something visible within
 * seconds of opening the view. They also serve as living documentation of what
 * the serializer produces.
 *
 * Each entry is plain Modelica with real Placement annotations, so the same
 * text is what gets written to a `.mo` file and what OMEdit would open.
 *
 * They span the four physical domains — electrical, mechanical, fluid and
 * thermal — with several per domain, so the palette's range is visible
 * immediately and a gap in any one domain's library support shows up on first
 * use rather than in the field.
 *
 * Every example is checked to compile, simulate, and produce at least one
 * variable that actually varies. That last condition matters: a model can
 * compile and run while sitting at a steady state, which plots as a flat line
 * and looks like a failure to a user pressing Simulate for the first time.
 */

export interface ExampleModel {
  /** Class name; also the file stem when saved. */
  name: string;
  /** Short description shown in the picker. */
  description: string;
  /** Simulation defaults that suit this model. */
  stopTime: number;
  /**
   * Variables to plot first, most interesting first.
   *
   * A Modelica result holds every variable in the model and offers no way to
   * tell which matter, so a guess based on magnitude or variation puts
   * `tank.U` beside `tank.level` and flattens one of them. An example knows
   * what it is demonstrating, so it says so. Anything unlisted remains
   * selectable in the inspector.
   */
  series?: string[];
  /** Full Modelica source. */
  source: string;
}

const ELECTRICAL = `model Electrical "RC step response: a capacitor charging through a resistor"
  Modelica.Electrical.Analog.Sources.ConstantVoltage source(V=10)
    annotation(Placement(transformation(extent={{-60,0},{-40,20}}, rotation=90)));
  Modelica.Electrical.Analog.Basic.Resistor resistor(R=100)
    annotation(Placement(transformation(extent={{-20,20},{0,40}})));
  Modelica.Electrical.Analog.Basic.Capacitor capacitor(C=0.001)
    annotation(Placement(transformation(extent={{20,-10},{40,10}}, rotation=90)));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{-20,-40},{0,-20}})));
equation
  connect(source.n, resistor.p) annotation(Line(points={{-50,20},{-50,30},{-35,30},{-20,30}}));
  connect(resistor.n, capacitor.n) annotation(Line(points={{0,30},{15,30},{30,30},{30,10}}));
  connect(capacitor.p, ground.p) annotation(Line(points={{30,-10},{30,-20},{10,-20},{-10,-20}}));
  connect(ground.p, source.p) annotation(Line(points={{-10,-20},{-30,-20},{-50,-20},{-50,0}}));
end Electrical;
`;

const RLC = `model RLC "Series RLC circuit: underdamped step response"
  Modelica.Electrical.Analog.Sources.StepVoltage source(V=10, startTime=0.001)
    annotation(Placement(transformation(extent={{-80,20},{-60,40}})));
  Modelica.Electrical.Analog.Basic.Resistor resistor(R=10)
    annotation(Placement(transformation(extent={{-40,20},{-20,40}})));
  Modelica.Electrical.Analog.Basic.Inductor inductor(L=0.1)
    annotation(Placement(transformation(extent={{0,20},{20,40}})));
  Modelica.Electrical.Analog.Basic.Capacitor capacitor(C=0.001)
    annotation(Placement(transformation(extent={{20,20},{40,40}})));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{40,-40},{60,-20}})));
equation
  connect(source.p, resistor.p);
  connect(resistor.n, inductor.p);
  connect(inductor.n, capacitor.p);
  connect(capacitor.n, source.n);
  connect(source.n, ground.p);
end RLC;
`;

const RECTIFIER = `model Rectifier "Half-wave rectifier: diode charging a capacitor"
  Modelica.Electrical.Analog.Sources.SineVoltage source(V=10, f=50)
    annotation(Placement(transformation(extent={{-80,20},{-60,40}})));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{-80,-40},{-60,-20}})));
  Modelica.Electrical.Analog.Semiconductors.Diode diode
    annotation(Placement(transformation(extent={{-30,20},{-10,40}})));
  Modelica.Electrical.Analog.Basic.Resistor resistor(R=100)
    annotation(Placement(transformation(extent={{40,20},{60,40}})));
  Modelica.Electrical.Analog.Basic.Capacitor capacitor(C=0.0001)
    annotation(Placement(transformation(extent={{10,-10},{30,10}})));
equation
  connect(source.p, diode.p);
  connect(diode.n, resistor.p);
  connect(resistor.n, source.n);
  connect(source.n, ground.p);
  connect(diode.n, capacitor.p);
  connect(capacitor.n, source.n);
end Rectifier;
`;

const SINEAC = `model SineAC "AC circuit: a sine drive through an RL load"
  Modelica.Electrical.Analog.Sources.SineVoltage source(V=230, f=50)
    annotation(Placement(transformation(extent={{-70,20},{-50,40}})));
  Modelica.Electrical.Analog.Basic.Resistor resistor(R=20)
    annotation(Placement(transformation(extent={{-20,20},{0,40}})));
  Modelica.Electrical.Analog.Basic.Inductor inductor(L=0.05)
    annotation(Placement(transformation(extent={{20,20},{40,40}})));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{20,-40},{40,-20}})));
equation
  connect(source.p, resistor.p);
  connect(resistor.n, inductor.p);
  connect(inductor.n, source.n);
  connect(source.n, ground.p);
end SineAC;
`;

const MASSSPRING = `model MassSpring "Mass on a spring and damper, released from stretch"
  Modelica.Mechanics.Translational.Components.Fixed fixed
    annotation(Placement(transformation(extent={{-60,-10},{-40,10}})));
  Modelica.Mechanics.Translational.Components.Spring spring(c=100, s_rel0=0.5)
    annotation(Placement(transformation(extent={{-20,-10},{0,10}})));
  Modelica.Mechanics.Translational.Components.Mass mass(m=1)
    annotation(Placement(transformation(extent={{20,-10},{40,10}})));
  Modelica.Mechanics.Translational.Components.Damper damper(d=2)
    annotation(Placement(transformation(extent={{-20,-40},{0,-20}})));
equation
  connect(fixed.flange, spring.flange_a);
  connect(spring.flange_b, mass.flange_a);
  connect(damper.flange_a, spring.flange_a);
  connect(damper.flange_b, mass.flange_a);
end MassSpring;
`;

const ROTATIONALPENDULUM = `model RotationalPendulum "Pendulum swinging on a revolute joint"
  Modelica.Mechanics.Rotational.Components.Inertia inertia(J=0.5)
    annotation(Placement(transformation(extent={{20,-10},{40,10}})));
  Modelica.Mechanics.Rotational.Components.SpringDamper spring(c=20, d=0.5)
    annotation(Placement(transformation(extent={{-20,-10},{0,10}})));
  Modelica.Mechanics.Rotational.Components.Fixed fixed
    annotation(Placement(transformation(extent={{-60,-10},{-40,10}})));
  Modelica.Mechanics.Rotational.Sources.TorqueStep torque(stepTorque=2, startTime=0.1)
    annotation(Placement(transformation(extent={{60,-10},{80,10}})));
equation
  connect(fixed.flange, spring.flange_a);
  connect(spring.flange_b, inertia.flange_a);
  connect(torque.flange, inertia.flange_b);
end RotationalPendulum;
`;

const MASSSPRINGDAMPER = `model MassSpringDamper "Two masses coupled by a spring and damper"
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
`;

const FLUIDPIPE = `model FluidPipe "Water driven through a pipe by a rising mass flow"
  inner Modelica.Fluid.System system
    annotation(Placement(transformation(extent={{-90,-80},{-70,-60}})));
  Modelica.Blocks.Sources.Ramp ramp(height=1, duration=1, startTime=0.1)
    annotation(Placement(transformation(extent={{-90,20},{-70,40}})));
  Modelica.Fluid.Sources.MassFlowSource_T pump(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, use_m_flow_in=true, T=293.15, X={1})
    annotation(Placement(transformation(extent={{-60,-10},{-40,10}})));
  Modelica.Fluid.Pipes.StaticPipe pipe(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    length=2, diameter=0.03, height_ab=0.5)
    annotation(Placement(transformation(extent={{-10,-10},{10,10}})));
  Modelica.Fluid.Sources.Boundary_pT sink(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, p=101325, T=293.15, X={1})
    annotation(Placement(transformation(extent={{50,-10},{70,10}})));
equation
  connect(ramp.y, pump.m_flow_in);
  connect(pump.ports[1], pipe.port_a);
  connect(pipe.port_b, sink.ports[1]);
end FluidPipe;
`;

const FLUIDRESERVOIR = `model FluidReservoir "Water draining from a tank under gravity"
  inner Modelica.Fluid.System system
    annotation(Placement(transformation(extent={{-90,-80},{-70,-60}})));
  Modelica.Fluid.Vessels.OpenTank tank(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    crossArea=0.2, height=1, level_start=0.9, nPorts=1,
    use_T_start=true, T_start=293.15,
    portsData={Modelica.Fluid.Vessels.BaseClasses.VesselPortsData(diameter=0.03)})
    annotation(Placement(transformation(extent={{-30,-10},{-10,10}})));
  Modelica.Fluid.Pipes.StaticPipe pipe(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    length=0.5, diameter=0.03, height_ab=-1)
    annotation(Placement(transformation(extent={{10,-10},{30,10}})));
  Modelica.Fluid.Sources.Boundary_pT drain(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, p=101325, T=293.15, X={1})
    annotation(Placement(transformation(extent={{50,-10},{70,10}})));
equation
  connect(tank.ports[1], pipe.port_a);
  connect(pipe.port_b, drain.ports[1]);
end FluidReservoir;
`;

const FLUIDLOOP = `model FluidLoop "A pump-driven loop with a rising flow rate"
  inner Modelica.Fluid.System system
    annotation(Placement(transformation(extent={{-90,-80},{-70,-60}})));
  Modelica.Blocks.Sources.Ramp ramp(height=1.5, duration=2, startTime=0.2)
    annotation(Placement(transformation(extent={{-90,20},{-70,40}})));
  Modelica.Fluid.Sources.MassFlowSource_T pump(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, use_m_flow_in=true, T=303.15, X={1})
    annotation(Placement(transformation(extent={{-60,-10},{-40,10}})));
  Modelica.Fluid.Pipes.StaticPipe supply(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    length=3, diameter=0.025, height_ab=1)
    annotation(Placement(transformation(extent={{-10,-10},{10,10}})));
  Modelica.Fluid.Fittings.SimpleGenericOrifice orifice(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    diameter=0.02, zeta=2)
    annotation(Placement(transformation(extent={{25,-10},{45,10}})));
  Modelica.Fluid.Sources.Boundary_pT return_(redeclare package Medium =
        Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, p=101325, T=303.15, X={1})
    annotation(Placement(transformation(extent={{65,-10},{85,10}})));
equation
  connect(ramp.y, pump.m_flow_in);
  connect(pump.ports[1], supply.port_a);
  connect(supply.port_b, orifice.port_a);
  connect(orifice.port_b, return_.ports[1]);
end FluidLoop;
`;

const THERMAL = `model Thermal "A warm body cooling towards ambient through a conductor"
  Modelica.Thermal.HeatTransfer.Components.HeatCapacitor body(C=1000, T(start=350, fixed=true))
    annotation(Placement(transformation(extent={{-10,20},{10,40}})));
  Modelica.Thermal.HeatTransfer.Components.ThermalConductor conductor(G=2)
    annotation(Placement(transformation(extent={{-10,-10},{10,10}})));
  Modelica.Thermal.HeatTransfer.Sources.FixedTemperature ambient(T=293.15)
    annotation(Placement(transformation(extent={{-50,-10},{-30,10}})));
equation
  connect(body.port, conductor.port_a);
  connect(conductor.port_b, ambient.port);
end Thermal;
`;

const HEATCONDUCTION = `model HeatConduction "Two bodies equalising through a conducting wall"
  Modelica.Thermal.HeatTransfer.Components.HeatCapacitor hot(C=2500, T(start=373.15, fixed=true))
    annotation(Placement(transformation(extent={{-40,20},{-20,40}})));
  Modelica.Thermal.HeatTransfer.Components.HeatCapacitor cold(C=2500, T(start=293.15, fixed=true))
    annotation(Placement(transformation(extent={{40,20},{60,40}})));
  Modelica.Thermal.HeatTransfer.Components.ThermalConductor wall(G=2)
    annotation(Placement(transformation(extent={{-10,-10},{10,10}})));
equation
  connect(hot.port, wall.port_a);
  connect(wall.port_b, cold.port);
end HeatConduction;
`;

const HEATEXCHANGER = `model HeatExchanger "A heated mass losing heat to ambient by convection"
  Modelica.Thermal.HeatTransfer.Sources.PrescribedHeatFlow heater
    annotation(Placement(transformation(extent={{-60,-10},{-40,10}})));
  Modelica.Thermal.HeatTransfer.Components.HeatCapacitor mass(C=2000, T(start=293.15, fixed=true))
    annotation(Placement(transformation(extent={{-30,10},{-10,30}})));
  Modelica.Thermal.HeatTransfer.Components.ThermalConductor loss(G=0.5)
    annotation(Placement(transformation(extent={{10,0},{30,20}})));
  Modelica.Thermal.HeatTransfer.Sources.FixedTemperature ambient(T=293.15)
    annotation(Placement(transformation(extent={{60,0},{80,20}})));
  Modelica.Blocks.Sources.Ramp ramp(height=500, duration=100, startTime=10)
    annotation(Placement(transformation(extent={{-100,-10},{-80,10}})));
equation
  connect(ramp.y, heater.Q_flow);
  connect(heater.port, mass.port);
  connect(mass.port, loss.port_a);
  connect(loss.port_b, ambient.port);
end HeatExchanger;
`;

const STATEMACHINE = `model StateMachine "A two-state machine driven by timers"
  inner Modelica.StateGraph.StateGraphRoot root
    annotation(Placement(transformation(extent={{-90,60},{-70,80}})));
  Modelica.StateGraph.InitialStep start(nOut=1, nIn=1)
    annotation(Placement(transformation(extent={{-70,0},{-50,20}})));
  Modelica.StateGraph.Transition waitForStart(enableTimer=true, waitTime=1)
    annotation(Placement(transformation(extent={{-40,0},{-20,20}})));
  Modelica.StateGraph.StepWithSignal running(nIn=1, nOut=1)
    annotation(Placement(transformation(extent={{-10,0},{10,20}})));
  Modelica.StateGraph.Transition waitForStop(enableTimer=true, waitTime=2)
    annotation(Placement(transformation(extent={{20,0},{40,20}})));
  Modelica.StateGraph.StepWithSignal stopped(nIn=1, nOut=1)
    annotation(Placement(transformation(extent={{50,0},{70,20}})));
  Modelica.StateGraph.Transition restart(enableTimer=true, waitTime=1)
    annotation(Placement(transformation(extent={{78,0},{98,20}})));
equation
  connect(start.outPort[1], waitForStart.inPort);
  connect(waitForStart.outPort, running.inPort[1]);
  connect(running.outPort[1], waitForStop.inPort);
  connect(waitForStop.outPort, stopped.inPort[1]);
  connect(stopped.outPort[1], restart.inPort);
  connect(restart.outPort, start.inPort[1]);
end StateMachine;
`;

const DOUBLEPENDULUM = `model DoublePendulum "Two linked rods swinging under gravity"
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
`;

const BUCKCONVERTER = `model BuckConverter "A step-down chopper feeding an RC load"
  Modelica.Electrical.PowerConverters.DCDC.ChopperStepDown chopper
    annotation(Placement(transformation(extent={{-20,20},{0,40}})));
  Modelica.Electrical.Analog.Sources.ConstantVoltage supply(V=24)
    annotation(Placement(transformation(extent={{-100,20},{-80,40}}, rotation=90)));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{-80,-30},{-60,-10}})));
  Modelica.Electrical.Analog.Basic.Inductor inductor(L=0.002)
    annotation(Placement(transformation(extent={{60,40},{80,60}})));
  Modelica.Electrical.Analog.Basic.Capacitor capacitor(C=0.0005)
    annotation(Placement(transformation(extent={{70,10},{90,30}}, rotation=-90)));
  Modelica.Electrical.Analog.Basic.Resistor load(R=5)
    annotation(Placement(transformation(extent={{40,-20},{60,0}})));
  Modelica.Blocks.Sources.Ramp duty(height=0.6, duration=0.001, startTime=0.0005)
    annotation(Placement(transformation(extent={{-70,-70},{-50,-50}})));
  Modelica.Electrical.PowerConverters.DCDC.Control.SignalPWM pwm(f=20000, useConstantDutyCycle=false)
    annotation(Placement(transformation(extent={{-30,-70},{-10,-50}})));
equation
  connect(supply.p, chopper.dc_p1);
  connect(supply.n, chopper.dc_n1);
  connect(supply.n, ground.p);
  connect(duty.y, pwm.dutyCycle);
  connect(pwm.fire, chopper.fire_p);
  connect(chopper.dc_p2, inductor.p);
  connect(inductor.n, capacitor.p);
  connect(capacitor.n, supply.n);
  connect(inductor.n, load.p);
  connect(load.n, supply.n);
end BuckConverter;
`;

const BATTERYDISCHARGE = `model BatteryDischarge "A battery powering a resistive load"
  parameter Modelica.Electrical.Batteries.ParameterRecords.CellData cellData(
    Qnom=3600, OCVmax=4.2, OCVmin=3.0, Ri=0.05)
    annotation(Placement(transformation(extent={{-90,30},{-70,50}})));
  Modelica.Electrical.Batteries.BatteryStacks.CellStack battery(
    Ns=3, Np=1, cellData=cellData, useHeatPort=false, SOC(fixed=true, start=1))
    annotation(Placement(transformation(extent={{-10,20},{10,40}}, rotation=90)));
  Modelica.Electrical.Analog.Basic.Resistor load(R=15)
    annotation(Placement(transformation(extent={{-50,60},{-30,80}})));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{-60,0},{-40,20}})));
equation
  connect(battery.p, load.p);
  connect(load.n, battery.n);
  connect(battery.n, ground.p);
end BatteryDischarge;
`;

const DCMOTOR = `model DCMotor "A permanent-magnet DC machine driving a load"
  Modelica.Electrical.Machines.BasicMachines.DCMachines.DC_PermanentMagnet motor(
    VaNominal=24, IaNominal=5, wNominal=300, useSupport=true, useThermalPort=false)
    annotation(Placement(transformation(extent={{-20,0},{0,20}})));
  Modelica.Mechanics.Rotational.Components.Inertia load(J=0.002)
    annotation(Placement(transformation(extent={{20,0},{40,20}})));
  Modelica.Mechanics.Rotational.Sources.QuadraticSpeedDependentTorque drag(
    tau_nominal=0.05, w_nominal=300)
    annotation(Placement(transformation(extent={{60,0},{80,20}})));
  Modelica.Mechanics.Rotational.Components.Fixed housing
    annotation(Placement(transformation(extent={{-20,-20},{0,0}})));
  Modelica.Electrical.Analog.Sources.RampVoltage supply(V=24, duration=0.5, startTime=0.1)
    annotation(Placement(transformation(extent={{-20,30},{0,50}})));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{-50,20},{-30,40}})));
equation
  connect(supply.p, motor.pin_ap);
  connect(supply.n, motor.pin_an);
  connect(supply.n, ground.p);
  connect(motor.support, housing.flange);
  connect(motor.flange, load.flange_a);
  connect(load.flange_b, drag.flange);
end DCMotor;
`;

const DAMPEDOSCILLATOR = `model DampedOscillator "A mass on a spring with viscous damping"
  Modelica.Mechanics.Translational.Components.Mass mass(m=1, s(fixed=true, start=0.1), v(fixed=true))
    annotation(Placement(transformation(extent={{0,-10},{20,10}})));
  Modelica.Mechanics.Translational.Components.Spring spring(c=100, s_rel0=0)
    annotation(Placement(transformation(extent={{-40,-10},{-20,10}})));
  Modelica.Mechanics.Translational.Components.Damper damper(d=2)
    annotation(Placement(transformation(extent={{-40,-40},{-20,-20}})));
  Modelica.Mechanics.Translational.Components.Fixed fixed
    annotation(Placement(transformation(extent={{-70,-10},{-50,10}})));
equation
  connect(fixed.flange, spring.flange_a);
  connect(spring.flange_b, mass.flange_a);
  connect(damper.flange_a, spring.flange_a);
  connect(damper.flange_b, mass.flange_a);
end DampedOscillator;
`;
const FORCEDOSCILLATOR = `model ForcedOscillator "A driven mass on a spring, near resonance"
  Modelica.Mechanics.Translational.Components.Mass mass(m=1, s(fixed=true, start=0), v(fixed=true))
    annotation(Placement(transformation(extent={{0,-10},{20,10}})));
  Modelica.Mechanics.Translational.Components.Spring spring(c=100, s_rel0=0)
    annotation(Placement(transformation(extent={{-40,-10},{-20,10}})));
  Modelica.Mechanics.Translational.Components.Damper damper(d=1)
    annotation(Placement(transformation(extent={{-40,-40},{-20,-20}})));
  Modelica.Mechanics.Translational.Components.Fixed fixed
    annotation(Placement(transformation(extent={{-70,-10},{-50,10}})));
  Modelica.Mechanics.Translational.Sources.Force force
    annotation(Placement(transformation(extent={{-10,30},{10,50}})));
  Modelica.Blocks.Sources.Sine drive(amplitude=10, f=1.5)
    annotation(Placement(transformation(extent={{-70,30},{-50,50}})));
equation
  connect(fixed.flange, spring.flange_a);
  connect(spring.flange_b, mass.flange_a);
  connect(damper.flange_a, spring.flange_a);
  connect(damper.flange_b, mass.flange_a);
  connect(drive.y, force.f);
  connect(force.flange, mass.flange_a);
end ForcedOscillator;
`;
const TANKORIFICE = `model TankOrifice "A tank draining through an orifice"
  inner Modelica.Fluid.System system
    annotation(Placement(transformation(extent={{-90,-80},{-70,-60}})));
  Modelica.Fluid.Vessels.OpenTank tank(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    crossArea=0.01, height=1, level_start=1, nPorts=1,
    use_T_start=true, T_start=293.15,
    portsData={Modelica.Fluid.Vessels.BaseClasses.VesselPortsData(diameter=0.02)})
    annotation(Placement(transformation(extent={{-40,0},{-20,20}})));
  Modelica.Fluid.Fittings.SimpleGenericOrifice orifice(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    diameter=0.02, zeta=0.5, use_zeta=true)
    annotation(Placement(transformation(extent={{0,-20},{20,0}})));
  Modelica.Fluid.Sources.Boundary_pT sink(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, p=101325, T=293.15, X={1})
    annotation(Placement(transformation(extent={{40,-20},{60,0}})));
equation
  connect(tank.ports[1], orifice.port_a);
  connect(orifice.port_b, sink.ports[1]);
end TankOrifice;
`;
const NONLINEARORIFICE = `model NonlinearOrifice "Flow through an orifice under a ramped pressure"
  inner Modelica.Fluid.System system
    annotation(Placement(transformation(extent={{-90,-80},{-70,-60}})));
  Modelica.Fluid.Sources.Boundary_pT supply(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, use_p_in=true, T=293.15)
    annotation(Placement(transformation(extent={{-60,0},{-40,20}})));
  Modelica.Blocks.Sources.Ramp pressure(height=500000, duration=10, offset=101325)
    annotation(Placement(transformation(extent={{-90,40},{-70,60}})));
  Modelica.Fluid.Fittings.SimpleGenericOrifice orifice(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    diameter=0.02, zeta=2.5, use_zeta=true)
    annotation(Placement(transformation(extent={{-10,-10},{10,10}})));
  Modelica.Fluid.Sources.Boundary_pT sink(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, p=101325, T=293.15)
    annotation(Placement(transformation(extent={{40,0},{60,20}})));
equation
  connect(pressure.y, supply.p_in);
  connect(supply.ports[1], orifice.port_a);
  connect(orifice.port_b, sink.ports[1]);
end NonlinearOrifice;
`;
const PIPEFRICTION = `model PipeFriction "Pressure drop along a pipe as the flow rises"
  inner Modelica.Fluid.System system
    annotation(Placement(transformation(extent={{-90,-80},{-70,-60}})));
  Modelica.Fluid.Sources.MassFlowSource_T pump(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, use_m_flow_in=true)
    annotation(Placement(transformation(extent={{-60,0},{-40,20}})));
  Modelica.Blocks.Sources.Ramp flowRamp(height=2, duration=4, startTime=0)
    annotation(Placement(transformation(extent={{-90,40},{-70,60}})));
  Modelica.Fluid.Pipes.StaticPipe pipe(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    length=2, diameter=0.02, height_ab=0)
    annotation(Placement(transformation(extent={{-10,-10},{10,10}})));
  Modelica.Fluid.Sources.Boundary_pT sink(
    redeclare package Medium = Modelica.Media.Water.ConstantPropertyLiquidWater,
    nPorts=1, p=101325, T=293.15)
    annotation(Placement(transformation(extent={{40,0},{60,20}})));
equation
  connect(flowRamp.y, pump.m_flow_in);
  connect(pump.ports[1], pipe.port_a);
  connect(pipe.port_b, sink.ports[1]);
end PipeFriction;
`;

const DAMPEDBOUNCE = `model DampedBounce "A ball bouncing until it comes to rest"
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
`;

const AIRFOILLIFT = `model AirfoilLift "Lift and drag of a wing as the angle of attack changes"
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
`;
const PHUGOID = `model Phugoid "The slow speed-and-height exchange of an aircraft"
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
`;

const HALFWAVE = `model HalfWaveRectifier "One diode, one load, referenced to the source"
  Modelica.Electrical.Analog.Sources.SineVoltage source(V=12, f=50)
    annotation(Placement(transformation(extent={{-60,0},{-40,20}})));
  Modelica.Electrical.Analog.Semiconductors.Diode d
    annotation(Placement(transformation(extent={{-10,0},{10,20}})));
  Modelica.Electrical.Analog.Basic.Resistor load(R=100)
    annotation(Placement(transformation(extent={{30,0},{50,20}})));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{30,-40},{50,-20}})));
equation
  connect(source.p, d.p);
  connect(d.n, load.p);
  connect(load.n, ground.p);
  connect(source.n, ground.p);
end HalfWaveRectifier;
`;

const CONTROLLOOP = `model ControlLoop "A PID controller driving a first-order plant"
  Modelica.Blocks.Sources.Step setpoint(height=1, startTime=1)
    annotation(Placement(transformation(extent={{-80,30},{-60,50}})));
  Modelica.Blocks.Math.Feedback error
    annotation(Placement(transformation(extent={{-30,30},{-10,50}})));
  Modelica.Blocks.Continuous.PID controller(k=2, Ti=0.5, Td=0.1)
    annotation(Placement(transformation(extent={{10,30},{30,50}})));
  Modelica.Blocks.Continuous.FirstOrder plant(k=1, T=1)
    annotation(Placement(transformation(extent={{50,30},{70,50}})));
  Modelica.Blocks.Continuous.FirstOrder sensor(k=1, T=0.05)
    annotation(Placement(transformation(extent={{50,-30},{30,-10}})));
equation
  connect(setpoint.y, error.u1);
  connect(error.y, controller.u);
  connect(controller.y, plant.u);
  connect(plant.y, sensor.u);
  // Negative feedback: the measured output returns to the subtractor.
  connect(sensor.y, error.u2);
end ControlLoop;
`;
const GEARTRAIN = `model GearTrain "A motor driving a load through a gearbox"
  Modelica.Mechanics.Rotational.Sources.TorqueStep motor(stepTorque=10, startTime=0.2)
    annotation(Placement(transformation(extent={{-80,-10},{-60,10}})));
  Modelica.Mechanics.Rotational.Components.Inertia motorInertia(J=0.1)
    annotation(Placement(transformation(extent={{-50,-10},{-30,10}})));
  Modelica.Mechanics.Rotational.Components.IdealGear gear(ratio=5)
    annotation(Placement(transformation(extent={{-15,-10},{5,10}})));
  Modelica.Mechanics.Rotational.Components.Inertia loadInertia(J=2)
    annotation(Placement(transformation(extent={{20,-10},{40,10}})));
  Modelica.Mechanics.Rotational.Components.SpringDamper bearing(c=200, d=20)
    annotation(Placement(transformation(extent={{50,-10},{70,10}})));
  // The whole chain sits 10 units left of where it started: the frame used to reach
  // x = 110, outside the ±100 box a Modelica diagram is drawn in.
  Modelica.Mechanics.Rotational.Components.Fixed frame
    annotation(Placement(transformation(extent={{80,-10},{100,10}})));
equation
  connect(motor.flange, motorInertia.flange_a);
  connect(motorInertia.flange_b, gear.flange_a);
  connect(gear.flange_b, loadInertia.flange_a);
  connect(loadInertia.flange_b, bearing.flange_a);
  connect(bearing.flange_b, frame.flange);
end GearTrain;
`;
/** All built-in examples, grouped by physical domain, in the order shown. */
const RESISTORSELFHEATING = `model ResistorSelfHeating "A resistor self-heating: electrical loss into a thermal mass"
  Modelica.Electrical.Analog.Sources.ConstantVoltage supply(V = 10)
    "Constant 10 V across the resistor"
    annotation(Placement(transformation(extent = {{-60, -10}, {-40, 10}})));
  Modelica.Electrical.Analog.Basic.Resistor resistor(R = 10, useHeatPort = true)
    "10 ohm resistor; its electrical loss leaves through heatPort"
    annotation(Placement(transformation(extent = {{-10, 20}, {10, 40}})));
  Modelica.Electrical.Analog.Basic.Ground return_path
    "The return conductor, held at zero potential"
    annotation(Placement(transformation(extent = {{-60, -50}, {-40, -30}})));
  Modelica.Thermal.HeatTransfer.Components.HeatCapacitor body(C = 5, T(start = 293.15, fixed = true))
    "The resistor body: 5 J/K of thermal mass"
    annotation(Placement(transformation(extent = {{20, 20}, {40, 40}})));
  Modelica.Thermal.HeatTransfer.Components.ThermalConductor toAmbient(G = 0.5)
    "0.5 W/K path from the body to the surrounding air"
    annotation(Placement(transformation(extent = {{20, -40}, {40, -20}})));
  Modelica.Thermal.HeatTransfer.Sources.FixedTemperature ambient(T = 293.15)
    "Still air at 20 degrees C"
    annotation(Placement(transformation(extent = {{60, -40}, {80, -20}})));
equation
  connect(supply.p, resistor.p);
  connect(resistor.n, supply.n);
  connect(supply.n, return_path.p);
  connect(resistor.heatPort, body.port);
  connect(body.port, toAmbient.port_a);
  connect(toAmbient.port_b, ambient.port);
end ResistorSelfHeating;
`;
export const EXAMPLES: ExampleModel[] = [
  {
    name: "Electrical",
    description: "Electrical: a capacitor charging through a resistor",
    stopTime: 1,
    series: ["capacitor.v", "capacitor.i"],
    source: ELECTRICAL,
  },
  {
    name: "RLC",
    description: "Electrical: series RLC step response with ringing",
    stopTime: 0.05,
    series: ["capacitor.v", "inductor.i"],
    source: RLC,
  },
  {
    name: "Rectifier",
    description: "Electrical: half-wave rectifier charging a capacitor",
    stopTime: 0.2,
    series: ["source.v", "capacitor.v"],
    source: RECTIFIER,
  },
  {
    name: "SineAC",
    description: "Electrical: a sine drive through an RL load",
    stopTime: 0.1,
    series: ["source.v", "inductor.i"],
    source: SINEAC,
  },
  {
    name: "MassSpring",
    description: "Mechanical: a mass on a spring and damper",
    stopTime: 5,
    series: ["mass.s", "mass.v"],
    source: MASSSPRING,
  },
  {
    name: "RotationalPendulum",
    description: "Mechanical: a rotational spring-damper met by a torque step",
    stopTime: 3,
    series: ["inertia.phi", "inertia.w"],
    source: ROTATIONALPENDULUM,
  },
  {
    name: "MassSpringDamper",
    description: "Mechanical: two free masses coupled by a spring and damper",
    stopTime: 5,
    // The two quantities this model is ABOUT: where the pair has drifted to, and how
    // far the coupling is stretched — the second settles at F*m2/(c*(m1+m2)), not at
    // F/c, which is the point of the example. mass1.v and mass2.s were here before and
    // told a reader nothing they could not see better from these two.
    series: ["mass1.s", "coupling.s_rel"],
    source: MASSSPRINGDAMPER,
  },
  {
    name: "FluidPipe",
    description: "Fluid: a rising mass flow driving water through a pipe",
    stopTime: 2,
    series: ["pipe.port_a.m_flow", "pipe.port_a.p"],
    source: FLUIDPIPE,
  },
  {
    name: "FluidReservoir",
    description: "Fluid: water draining from a tank under gravity",
    stopTime: 20,
    series: ["tank.level", "pipe.port_a.m_flow"],
    source: FLUIDRESERVOIR,
  },
  {
    name: "FluidLoop",
    description: "Fluid: a pumped loop through a pipe and an orifice",
    stopTime: 3,
    series: ["orifice.m_flow", "orifice.dp"],
    source: FLUIDLOOP,
  },
  {
    name: "Thermal",
    description: "Thermal: a warm body cooling through a conductor",
    stopTime: 2000,
    series: ["body.T", "conductor.Q_flow"],
    source: THERMAL,
  },
  {
    name: "HeatConduction",
    description: "Thermal: two bodies equalising through a conducting wall",
    stopTime: 3000,
    series: ["hot.T", "cold.T"],
    source: HEATCONDUCTION,
  },
  {
    name: "HeatExchanger",
    description: "Thermal: a heated mass losing heat to ambient",
    stopTime: 200,
    series: ["mass.T", "heater.Q_flow"],
    source: HEATEXCHANGER,
  },
  {
    name: "StateMachine",
    description: "State machine: two states alternating on timers",
    stopTime: 6,
    series: ["running.active", "stopped.active"],
    source: STATEMACHINE,
  },
  {
    name: "DoublePendulum",
    description: "Mechanics: a double pendulum swinging under gravity",
    stopTime: 6,
    series: ["upper.phi", "lower.phi"],
    source: DOUBLEPENDULUM,
  },
  {
    name: "BuckConverter",
    description: "Electrical: a step-down chopper feeding an RC load",
    // 4 ms ended while the output was still ringing up to 21 V, which reads as
    // a boost rather than a step-down. It settles to Vin*D = 14.4 V by ~20 ms.
    stopTime: 0.03,
    series: ["capacitor.v", "inductor.i"],
    source: BUCKCONVERTER,
  },
  {
    name: "BatteryDischarge",
    description: "Electrical: a battery discharging into a load",
    stopTime: 1800,
    series: ["battery.SOC", "battery.p.v"],
    source: BATTERYDISCHARGE,
  },
  {
    name: "DCMotor",
    description: "Electrical: a permanent-magnet DC machine accelerating a load",
    // The machine's own rotor inertia dominates, so it reaches its operating
    // point around 300 rad/s in about 2.7 s; 1.5 s stopped mid-acceleration.
    stopTime: 20,
    series: ["motor.wMechanical", "motor.tauElectrical"],
    source: DCMOTOR,
  },
  {
    name: "DampedOscillator",
    description: "Mechanical: a mass on a spring with viscous damping",
    stopTime: 4,
    series: ["mass.s", "mass.v"],
    source: DAMPEDOSCILLATOR,
  },
  {
    name: "ForcedOscillator",
    description: "Mechanical: a driven mass on a spring, near resonance",
    stopTime: 20,
    series: ["mass.s", "mass.v"],
    source: FORCEDOSCILLATOR,
  },
  {
    name: "TankOrifice",
    description: "Fluid: a tank draining through an orifice",
    stopTime: 25,
    series: ["tank.level", "orifice.m_flow"],
    source: TANKORIFICE,
  },
  {
    name: "NonlinearOrifice",
    description: "Fluid: orifice flow under a ramped pressure",
    stopTime: 12,
    series: ["orifice.m_flow", "orifice.dp"],
    source: NONLINEARORIFICE,
  },
  {
    name: "PipeFriction",
    description: "Fluid: pressure drop along a pipe as the flow rises",
    stopTime: 5,
    series: ["pipe.port_a.m_flow", "pipe.port_a.p"],
    source: PIPEFRICTION,
  },
  {
    name: "DampedBounce",
    description: "Mechanical: a ball bouncing until it comes to rest",
    stopTime: 10,
    series: ["h", "v"],
    source: DAMPEDBOUNCE,
  },
  {
    name: "AirfoilLift",
    description: "Aerospace: lift and drag as the angle of attack changes",
    stopTime: 20,
    series: ["cl", "L"],
    source: AIRFOILLIFT,
  },
  {
    name: "Phugoid",
    description: "Aerospace: the slow speed-and-height exchange of an aircraft",
    stopTime: 200,
    series: ["V", "gamma"],
    source: PHUGOID,
  },
  {
    name: "HalfWaveRectifier",
    description: "Electrical: a diode rectifier and its load",
    stopTime: 0.06,
    series: ["source.v", "load.p.v"],
    source: HALFWAVE,
  },
  {
    name: "ControlLoop",
    description: "Control: a PID controller driving a first-order plant",
    stopTime: 8,
    series: ["setpoint.y", "plant.y"],
    source: CONTROLLOOP,
  },
  {
    name: "GearTrain",
    description: "Mechanical: a motor driving a load through a 5:1 gearbox",
    stopTime: 10,
    series: ["motorInertia.w", "loadInertia.w"],
    source: GEARTRAIN,
  },
  {
    name: "ResistorSelfHeating",
    description: "Multiphysics: electrical loss heating a thermal mass, one domain into another",
    stopTime: 100,
    series: ["body.T", "resistor.LossPower", "toAmbient.Q_flow"],
    source: RESISTORSELFHEATING,
  },
];

export function findExample(name: string): ExampleModel | undefined {
  return EXAMPLES.find((e) => e.name === name);
}
