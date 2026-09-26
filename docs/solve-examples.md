# Calculation block: examples to try

Every block on this page has been run through the plugin's own code path against
OpenModelica 1.27.0, and the answer quoted is the one that came back. Paste them into a
note and they will do what is written here.

The reference for the block itself — the directive, the typesetting rule, what it refuses
and why — is [The calculation block](solve-block.md).

## Working examples

### 1 · The basic case

`x` appears twice and is never isolated. Nothing is rearranged, by you or by the block.

````
```modelica-solve
//@ solve x
sqrt(x) + x^2 - 56 = 67
```
````

→ `x = 10.940400921`

### 2 · The same, with no directive

The unknown is inferred, and the panel says so: *solved for x, the only undefined symbol*.

````
```modelica-solve
sqrt(x) + x^2 - 56 = 67
```
````

→ `x = 10.940400921`

### 3 · Something to edit

Change `target` and the answer follows. This is the difference between holding a
relationship and holding a number.

````
```modelica-solve
//@ solve x
parameter Real target = 70;
sqrt(x) + x^2 - 56 = target
```
````

→ `x = 11.0757382071`

### 4 · A system of two equations

Both unknowns are reported, not only the one the directive named.

````
```modelica-solve
//@ solve x
2*x + y = 7;
x - y = 2
```
````

→ `x = 3` and `y = 1`

### 5 · Choosing which root

`x^2 = 2` has two right answers. The start value is what picks between them, which is why
the block prints it.

````
```modelica-solve
//@ solve x
Real x(start = -1);
x^2 = 2
```
````

→ `x = -1.41421356237`

### 6 · Units the note never mentions

`V` is inherited from the declared type; the block never says it.

````
```modelica-solve
//@ solve v
Modelica.Units.SI.Voltage v;
parameter Real R = 100;
parameter Real C = 1e-3;
parameter Real t = 0.1;
v = 10*(1 - exp(-t/(R*C)))
```
````

→ `v = 6.32120558829 V`

### 7 · A definite integral, by quadrature

∫₀¹ eˣ dx, exact to 13 digits.

````
```modelica-solve
//@ solve y
y = Modelica.Math.Nonlinear.quadratureLobatto(Modelica.Math.exp, 0, 1, 1e-8)
```
````

→ `y = 1.71828182846`

### 8 · A definite integral of your own, as a sum

The comprehension cannot be typeset, so the equation stays as source — and the answer
still arrives. That is the all-or-nothing rule working, not a failure.

````
```modelica-solve
//@ solve y
parameter Integer n = 2000;
Real dx = Modelica.Constants.pi / n;
y = sum(sin((i - 0.5) * dx) * dx for i in 1:n)
```
````

→ `y = 2.00000020562`

### 9 · Rearranging for you

Solving for time rather than for distance, with no algebra in between:

````
```modelica-solve
//@ solve t
parameter Real a = 9.81;
parameter Real d = 10;
parameter Real v = 1.3;
d = -1/2 * (a * t) + v*t
```
````

→ `t = -2.77392510402`

Check it by hand: `d = t(v − a/2) = t(1.3 − 4.905) = −3.605t`, so `t = 10 / −3.605`.

### 10 · Nested fractions

A check that division is drawn as a fraction at every depth.

````
```modelica-solve
//@ solve R
R = 1/(1/10 + 1/15)
```
````

→ `R = 6`, the resistance of 10 Ω and 15 Ω in parallel.

### 11 · A quadratic

The root nearest the start value, not both roots and not the first one.

````
```modelica-solve
//@ solve x
x^2 + 3*x - 10 = 0
```
````

→ `x = 2`, rather than `−5`

### 12 · Two units at once

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

→ `R = 200 Ohm`

## What it says when something is off

Each of these is worth trying once, because the message is the feature: the compiler's own
reply to the same mistake is much harder to act on.

| Block | The panel says |
|---|---|
| `d = -1/2 (a * t) + v*t` | *multiplies without a `*`, and Modelica has no implicit multiplication. Write `1/2 * (a * t)` rather than `1/2 (a * t)`…* |
| a `function f … end f;` in the block | *`function` cannot be defined inside this block: it holds equations, not classes…* |
| `//@ solve k` where `parameter Real k = 5` | *`k` is a parameter, so it is fixed before the solve and cannot be solved for* |
| `x + y = 5`, no directive | *More than one symbol is undefined (x, y), so which one to solve for is ambiguous…* |
| `x = 1;` and `x = 2` | *Too many equations, over-determined system* — the compiler's own words, shown as they are |
| `//@ solve x` and nothing else | *There is no equation to solve. Write one, for example `x^2 = 2`.* |

## Traps worth knowing

### `der()` answers with the initial value, not an integral

````
```modelica-solve
//@ solve y
Real y(start = 0);
der(y) = 1
```
````

→ `y = 0`

That is correct — the block asks for no simulated time, so nothing accumulates — but it is
easy to read `0` as a wrong answer rather than as *this is not the tool*. To integrate over
time, put the model in a `modelica` block, which simulates properly.

### A refused equation is not an error

Example 8 keeps its source and solves. Anything the LaTeX converter cannot fully account
for — a comprehension, an `if` expression, an array — is shown as written, because LaTeX
that is nearly right would be a different equation with nothing on screen to say so.

### One root, silently

A solver returns the root nearest to where it began, and an undeclared unknown begins at 1.
Where which root matters, declare the start value:
`Real x(start = -5); x^2 + 3*x - 10 = 0` gives `x = -5`.
