# Using it in a note
A note can hold a live model, or a calculation. Both are ordinary fenced code blocks, so what they contain is text that diffs, copies and commits like anything else — and the reference for the calculation block is [The calculation block](solve-block.md).

<table>
<tr>
<td width="50%"><img src="docs/images/embed-light.png" alt="A modelica block in a note, showing the live diagram (light theme)"></td>
<td width="50%"><img src="docs/images/embed-dark.png" alt="A modelica block in a note, showing the live diagram (dark theme)"></td>
</tr>
<tr>
<td><sub>Light theme</sub></td><td><sub>Dark theme</sub></td>
</tr>
</table>

*A block in a note, opened on its diagram. It carries its own toolbar: **Simulate**, the span it runs over, **Open diagram** to take the model into the studio, **Fit**, and the switch between the two panes. It simulates once when the note opens.*

<table>
<tr>
<td width="50%"><img src="docs/images/embedPlot-light.png" alt="The same block switched to its plot (light theme)"></td>
<td width="50%"><img src="docs/images/embedPlot-dark.png" alt="The same block switched to its plot (dark theme)"></td>
</tr>
<tr>
<td><sub>Light theme</sub></td><td><sub>Dark theme</sub></td>
</tr>
</table>

*The same block on its plot — this is what `//@ result` in the block's first line opens on. The diagram is always there underneath, a scroll away: a plot is the result *of* the diagram, and hiding one to show the other loses the thing the reader came for.*

A block runs itself once, when the note opens; after that the **Simulate** button
starts a run. Dragging a component inside the block writes the note back — the section
below says why that does not start a loop.

````markdown
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
    annotation(Placement(transformation(extent={{-80,30},{-60,50}})));
equation
  connect(step.y, force.f);
  connect(force.flange, mass1.flange_a);
  connect(mass1.flange_b, coupling.flange_a);
  connect(coupling.flange_b, mass2.flange_a);
end MassSpringDamper;
```
````

That is the model from [the worked example](examples.md)
— the same file the studio opens from **Examples** — so a block in a note and the
studio show the same diagram and the same numbers.

To put a block in a note, use the command palette: **Embed a simulation in the
current note** asks which model — the one open in the studio, a built-in example, or
a saved `.mo` file — and writes the block at the cursor with its options filled in.
**Embed the open model in the current note** skips the question.

A note can also hold a **`modelica-solve`** block, which is an equation to be solved
rather than a model to be run — `sqrt(x) + x^2 - 56 = 67` in, `x = 10.940400921` out.
**Insert a calculation in the current note** writes one at the cursor. It carries no
diagram, mounts no editor and never writes back, and it is described in
[The calculation block](solve-block.md).

The first line is an optional **directive**: `time` sets the simulation span,
`height` the height of the pane (the plot and the diagram are the same box, shown one
at a time), `result`/`edit` which of the two starts open, and `noauto`/`manual` to
keep the block from running itself at all. It lives inside the block because
Obsidian does not pass a fenced block's info string to a plugin.

**A block runs itself once**, when the note is opened. After that the **Simulate**
button is what starts a run — the plot has a `t_end` field beside it, and typing a
span there re-runs the block and records it in the directive. The reason is that an
edit made in a block's own diagram writes the note back, and a note that re-renders
rebuilds the block: without the rule, dragging one component ran four simulations.
A rebuilt block repaints the result it already had; if the model has changed since
that run, the line above the plot says so rather than the stale curve passing itself
off as current.

Blocks follow the studio: change the plot scale, the visible traces or the
simulation span there and the blocks follow, and a block re-simulates when a
parameter value it ran with changes. A block answers the pointer the way the studio
does — resting on a component shows its parameters, and moving across the plot reads
the time and every visible trace's value with a crosshair on it.
