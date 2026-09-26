# Testing and verification
How the claims in this documentation are checked: the numerical audit, the rule that every expected number is derived before the simulation runs, and how to run it all yourself.

## Testing

The thirty worked examples are markdown, so they can be read here rather than
downloaded: [the index](../showcase/notes/README.md) lists them by domain, and each
note derives its physics, embeds the model as a live block, and puts the numbers an
independent calculation predicts beside the numbers the simulation produces.

To run them rather than read them, the studio's **Examples** menu opens the same set
inside your own vault — no setup beyond having installed the plugin. There is also a
ready-made vault in `examples/vault/`, for a machine where you would rather not use
your own:

1. Copy `main.js`, `manifest.json` and `styles.css` into
   `examples/vault/.obsidian/plugins/modelica-studio/`.
2. Open `examples/vault/` as a vault in Obsidian.
3. Enable the plugin, then open `showcase/00-modelica-intro.md`.

Either way, start with the introduction, then any example, and press **Simulate** in a
block.

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
