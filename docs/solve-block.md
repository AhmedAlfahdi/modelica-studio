# The calculation block

A fenced `modelica-solve` block holds a **relationship** rather than a number, and the
answer is recomputed when the note opens.

````
```modelica-solve
//@ solve x
sqrt(x) + x^2 - 56 = 67
```
````

That block renders as the equation with `x = 10.940400921` under it. The number is never
typed into the prose, so it cannot go stale when the model or the parameters change —
which is the whole reason to put a calculation in a note instead of its result.

A **modelica** block is a model to run; a **modelica-solve** block is a question to
answer. They share the compiler and nothing else.

## Why it needs no algebra

Modelica has no solver function to call. It does not need one: before a simulation can
take a single step, the compiler must find values for every variable that satisfy every
equation at the starting moment. That step is called *initialisation*, and for a model
with no states it **is** the answer.

So the block asks for no simulated time — `stopTime = 0` — and reads the result. The
simulator becomes a solver, and `x` does not have to be alone on the left of anything.
No rearrangement is done to the equation, by the plugin or by you: what is solved is what
was written.

## What the block accepts

**The directive.** `//@ solve x` names the symbol whose value is reported. With exactly
one undefined symbol in the equations it can be left out — the block says which one it
chose — and with more than one it asks rather than guessing. It is written inside the
block because Obsidian does not pass a fenced block's info string to a plugin.

**Declarations**, which are the givens:

````
```modelica-solve
//@ solve x
parameter Real target = 67;
sqrt(x) + x^2 - 56 = target
```
````

**Several equations**, solved together as a system. Every undefined symbol becomes a
variable, so this needs no more than the directive:

````
```modelica-solve
//@ solve x
2*x + y = 7;
x - y = 2
```
````

→ `x = 3` and `y = 1`. Every solved symbol is reported, not only the one the directive
named: answering a system with one of its two unknowns leaves the reader to finish the
job.

**An `equation` keyword**, if you paste in something from a real model. Both spellings
work.

## Which answer you get

An equation can have more than one solution, and a solver returns the one nearest to
where it started. An undeclared unknown starts at 1, and the block prints that under the
answer because it is not neutral:

- `x^2 + 3*x - 10 = 0` → `x = 2`, not `−5`
- declare it yourself and yours is used: `Real x(start = -1)` with `x^2 = 2` gives
  `x = -1.41421356237`

## Units

The answer carries the unit of the quantity solved for, and it comes from the model the
compiler builds rather than from your text:

````
```modelica-solve
//@ solve R
Modelica.Units.SI.Resistance R;
Modelica.Units.SI.Voltage v;
Modelica.Units.SI.Current i;
v = 10;
i = 0.05;
R = v/i
```
````

→ `R = 200 Ohm`. The word "Ohm" appears nowhere in the block: the unit is inherited from
the declared type, and only the compiler knows it.

## Integrals

Modelica has no integral operator, and **this block does not integrate over time**: it
asks for no simulated time at all, so nothing can accumulate. A definite integral in one
is an ordinary algebraic expression, and there are two ways to write it.

**Adaptive quadrature**, for an integrand that is already a function. Every scalar
function in `Modelica.Math` qualifies:

````
```modelica-solve
//@ solve y
y = Modelica.Math.Nonlinear.quadratureLobatto(Modelica.Math.exp, 0, 1, 1e-8)
```
````

→ `y = 1.71828182846`, and the exact value is `e - 1`.

**A sum**, for an integrand of your own, which is the only way to write one that is not
already a function:

````
```modelica-solve
//@ solve y
parameter Integer n = 2000;
Real dx = Modelica.Constants.pi / n;
y = sum(sin((i - 0.5) * dx) * dx for i in 1:n)
```
````

→ `y = 2.00000020562`; the exact answer is 2, and the error is the midpoint rule's
`O((b-a)³/n²)`.

Integrating over time belongs in a `modelica` block, which simulates properly.

## The equation is typeset

Where the equation can be read as mathematics it is drawn as mathematics — `sqrt(x) + x^2
- 56 = 67` becomes √x + x² − 56 = 67 — at the note's own text size, above the answer. The
answer stays monospace so its digits line up with every other block.

The rule is that a conversion happens **completely or not at all**. LaTeX that is nearly
right is worse than source code: `(a + b) * c` drawn without its brackets is a different
equation and nothing on screen would say so. So a comprehension, an `if` expression or an
array keeps its source, line by line, while the rest of the block is typeset around it.

The source of truth stays the code block, so nothing is lost when a conversion is
declined. What converts: `sqrt`, `sin`, `exp`, `abs`, `der` and the rest of the functions
with a notation of their own; `*` as a dot and `/` as a fraction; `<=`, `>=` and `<>` as
≤, ≥ and ≠; subscripts, comparisons and `and`/`or`/`not`.

## What it refuses, and why

Each of these is a message in place of an answer, and each exists because the compiler's
own reply to the same mistake is much harder to act on.

| What you wrote | What the block says |
|---|---|
| `d = -1/2 (a * t) + v*t` | Modelica has no implicit multiplication: write `1/2 * (a * t)` |
| a `function … end f;` in the block | a block holds equations, not classes — use a function that already exists, or write a sum |
| `//@ solve k` where `k` is a `parameter` | a parameter is fixed before the solve and cannot be solved for |
| `x + y = 5` with no directive | more than one symbol is undefined, so name one |
| nothing but a directive | there is no equation to solve |

An equation with no solution is not refused by the block — the compiler reports it in its
own words, which are shown as they are.

## Limits

- **A parameter cannot be solved for.** Parameters are decided before the solve. Solve
  for a variable instead.
- **One root, the nearest to the start value.** Print the start value, or declare it
  yourself, when which root matters.
- **`der()` gives the initial value, not an integral.** `Real y(start = 0); der(y) = 1`
  answers `y = 0`, correctly, because no time passes. A model to integrate over time is
  a `modelica` block, not this one.
- **A `function` cannot be defined in the block.** It is a model body. A custom integrand
  is a sum.
- **OpenModelica must be installed**, since this is the same compiler the rest of the
  plugin uses.
- **Note-sized calculations.** A large system belongs in the studio.

## What it does not do

A block never writes to the note. Its text is the question and the panel is the answer,
so there is no write-back path and nothing to undo.
