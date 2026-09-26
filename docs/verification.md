# Testing and verification
How the claims in this documentation are checked: the numerical audit, the rule that every expected number is derived before the simulation runs, and how to run it all yourself.

## Testing

`examples/vault/` is an Obsidian vault you can open directly: the 30 worked
examples, cross-linked, each with a live model and its verified numbers, plus an
introduction to the language and a demonstration of using it to learn a new
subject.

1. Copy `main.js`, `manifest.json` and `styles.css` into
   `examples/vault/.obsidian/plugins/modelica-studio/`.
2. Open `examples/vault/` as a vault in Obsidian.
3. Enable the plugin, then open `showcase/00-modelica-intro.md`.

Start with the introduction, then any example, and press **Simulate** in a block.

Reports of what breaks are the most useful contribution at this stage. Include
the Modelica source, the error, and your OpenModelica version.

## Verification

Every built-in example is checked numerically against a value derived
independently of the plugin — a closed-form solution, an independent integration
of the same ODE, or the Modelica Standard Library source. The audit runs on every
`npm test`.

Where a check was not possible it says so rather than asserting a number: the
double pendulum is chaotic, so its total energy is checked (drift under 1%,
non-growing) instead of its trajectory; pipe friction depends on an empirical
correlation, so a mass balance is checked rather than a pressure drop.

Twelve expectations were themselves wrong when first written, and every one was
corrected only after tracing the discrepancy to the expectation rather than the
simulation. Not once was the solver at fault. The full account — what was
expected, what came out, which side was wrong and how it was settled — is in
[`testing-findings.md`](testing-findings.md), along with the five models
that were built, found unverifiable, and abandoned.
