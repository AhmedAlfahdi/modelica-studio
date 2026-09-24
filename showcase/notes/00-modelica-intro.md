# Modelica in ten minutes

> A short tour of what Modelica is, how the plugin runs it, and how to read the
> worked examples that follow.

**Next:** [Electrical — RC step response](electrical.md) · **All examples:** [index](README.md)

---

## What is Modelica?

Modelica is a language for describing **physical systems** — electrical circuits, mechanisms, pipes, heat flow — as **equations** rather than as a sequence of steps.

That is the whole idea, and it is what makes it different from almost every other simulator.

### The usual way: tell the computer what to do

Most simulation code is a recipe. You write down the order of operations:

```python
# Imperative: you decide the order
v = 10
i = v / R          # step 1
dv = i / C         # step 2
v = v + dv * dt    # step 3
```

You had to know that current comes from voltage, that voltage changes from current, and which one to compute first. Swap two lines and it breaks.

### The Modelica way: describe what is true

In Modelica you write down what is *true about the system* and let the tool work out the order:

```text
v = R * i;          // Ohm's law
i = C * der(v);     // the capacitor's law
```

Two facts. No order. The tool rearranges them into something it can solve. If you add a third component, you add a third fact — you do not rewrite a recipe.

### "der" means "rate of change"

`der(v)` is how fast `v` changes. In the capacitor's law above, `C * der(v)` is the current that flows to change the voltage across a capacitance. That single operator is how Modelica writes every differential equation.

### Connectors: equations you get for free

Components have **connectors** — the pins you wire together. When you connect two pins, Modelica adds two rules automatically:

- the **potential** is equal on both sides (voltage, temperature, position)
- the **flow** sums to zero (current in = current out, heat in = heat out)

That is why a wire in the diagram is not "a signal being sent". It is a **statement that two things are equal**, plus a conservation law. This is called an *acausal* connection, and it means a wire has no direction.

### Blocks vs. components

You will see two kinds of parts in the palette:

| | Looks like | Connectors | Example |
|---|---|---|---|
| **Physical component** | a schematic symbol | acausal pins, wired either way | `Resistor`, `Mass`, `Pipe` |
| **Block** | a box with arrows | causal inputs and outputs | `Sine`, `Gain`, `PID` |

Blocks come from control theory: they have a direction, input on the left, output on the right. Physical components do not.

---

## Solving a model

Once you have written the equations, the tool:

1. **Flattens** the model — pulls in every library component's own equations.
2. **Sorts** them into an order it can evaluate (this is what a recipe-writer does by hand).
3. **Integrates** them through time with a numerical solver.
4. **Writes** every variable to a result file.

Step 3 is where the arithmetic happens, and it is why a simulation takes time. Steps 1 and 2 are why you did not have to think about order.

---

## The three things you actually write

```text
model Name "what this is"
  Real x(start = 1);                       // a variable, and where it starts
  Modelica.Blocks.Sources.Sine drive;      // a component from a library
equation
  der(x) = -x + drive.y;                   // the physics
  connect(drive.y, something.u);           // the wiring
end Name;
```

- **Declarations** — what exists: variables and components
- **Equations** — what is true, written with `=`
- **Connections** — what is joined, written with `connect(...)`

That is the entire language surface this plugin uses.

---

## Units are part of the type

Modelica types carry units. `Modelica.Units.SI.Voltage` and `Modelica.Units.SI.Current` are both floating-point numbers underneath, but the compiler will reject `voltage + current`. This catches a whole class of errors that would otherwise show up as a wrong-looking plot.

---

## About these notes

Every example note follows the same shape:

1. **The model** — a live block. It renders as a diagram, **Simulate** compiles and
   plots it, and the diagram is editable in place: drag a component and the note's own
   text is rewritten. Its first line is a directive giving the span that model is meant
   to run over, so a block does not depend on whatever span the Studio last used.
   (Obsidian does not pass a fence's info string to a code-block processor, so the
   option has to live inside the block.)
2. **The physics** — the equations worked out by hand.
3. **Does the simulation agree?** — the number the hand calculation predicts, beside the number the simulation produced.

That third section is the point. Anyone can produce a curve. These notes show a curve that was *predicted before it was plotted*, and they are re-checked by `test/audit.test.mjs` on every test run — so a value that drifts fails the build rather than quietly misleading you.

Start with any example below, or read one end to end: **[Electrical — RC step response](electrical.md)** is the simplest complete case.

---

## Try the model this note keeps referring to

`15` lines, no ordering instructions anywhere in it — and
it produces an exponential curve. Press **Simulate** beneath the diagram.

```modelica
//@ time=1
model Electrical "RC step response: a capacitor charging through a resistor"
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

The derivation and the checked numbers for it are in
**[Electrical — RC step response](electrical.md)**.
