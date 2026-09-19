# Example vault

An Obsidian vault containing the 29 worked examples from Modelica Studio. Open
this folder as a vault to try the plugin without setting up your own.

## Before opening

The plugin is not included here — `main.js` is a build artifact and is not
committed. Put it in place first:

```bash
# from the repository root
npm install && npm run build
cp main.js manifest.json styles.css \
   examples/vault/.obsidian/plugins/modelica-studio/
```

## Then

1. Open this folder as a vault in Obsidian.
2. Enable **Modelica Studio** in Settings → Community plugins.
3. Open `showcase/00-modelica-intro.md` and work through from there.

Each example note embeds its model as a live block. Press **Simulate** beneath a
diagram to compile and plot it — this needs OpenModelica installed and `omc` on
your PATH.

## What is here

- `showcase/00-modelica-intro.md` — what Modelica is and how to read the notes
- `showcase/*.md` — one note per example: the derivation, the live model, and a
  table comparing an independent calculation against the simulation
- `Embedded Demo.md` — a note showing inline diagrams in a normal note
