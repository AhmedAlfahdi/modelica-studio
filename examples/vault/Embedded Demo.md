# Inline Modelica results

Each block below simulates when the note opens and shows the result. Press
**Open diagram** to edit it in Modelica Studio, or **Simulate** to re-run it.

## Electrical — a capacitor charging

```modelica
model Electrical "RC step response"
  Modelica.Electrical.Analog.Sources.ConstantVoltage source(V=10)
    annotation(Placement(transformation(extent={{-60,20},{-40,40}})));
  Modelica.Electrical.Analog.Basic.Resistor resistor(R=100)
    annotation(Placement(transformation(extent={{-20,20},{0,40}})));
  Modelica.Electrical.Analog.Basic.Capacitor capacitor(C=0.001)
    annotation(Placement(transformation(extent={{20,20},{40,40}})));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{20,-40},{40,-20}})));
equation
  connect(source.p, resistor.p);
  connect(resistor.n, capacitor.p);
  connect(capacitor.n, source.n);
  connect(source.n, ground.p);
end Electrical;
```

## Thermal — two bodies equalising

```modelica
model HeatConduction "Two bodies equalising through a conducting wall"
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
```

## Mechanical — a mass on a spring

```modelica
model MassSpring "Mass on a spring and damper"
  // Components
  Modelica.Mechanics.Translational.Components.Fixed fixed annotation(Placement(transformation(extent={{-60,-10},{-40,10}})));
  Modelica.Mechanics.Translational.Components.Spring spring(c=100, s_rel0=0.5) annotation(Placement(transformation(extent={{-30,-10},{-10,10}})));
  Modelica.Mechanics.Translational.Components.Mass mass(m=1) annotation(Placement(transformation(extent={{40,-10},{60,10}})));
  Modelica.Mechanics.Translational.Components.Damper damper(d=2) annotation(Placement(transformation(extent={{-30,-40},{-10,-20}})));

equation
  connect(fixed.flange, spring.flange_a);
  connect(spring.flange_b, mass.flange_a);
  connect(damper.flange_a, spring.flange_a);
  connect(damper.flange_b, mass.flange_a);
end MassSpring;

```

## With the diagram shown too

```modelica edit height=360
model FluidReservoir "Water draining from a tank under gravity"
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
```
