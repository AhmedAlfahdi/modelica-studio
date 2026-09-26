## Debugging, and recovering a lost model
What the plugin logs, what the console handle exposes, and the three places a model can still be found after the vault copy is gone.

## Recovering a lost model

A saved model has three places it can still be found after the vault copy is gone:

1. **The plugin's history** — every save keeps the version it replaced, in the
   plugin's own folder (`.obsidian/plugins/modelica-studio/history/`), one
   directory per model. Twenty revisions are kept; **Model list…** in the studio
   shows them with restore.
2. **OpenModelica's build cache** — `/tmp/modelica-studio/*/<Model>/<Model>.mo`
   holds the exact source that was last compiled.
3. **The desktop trash** — `~/.local/share/Trash/files/` on Linux.

Deleting from **Model list…** uses the vault's own trash and snapshots first, so
that route is reversible twice.

# Debugging

The plugin logs to Obsidian's **developer console** (Ctrl+Shift+I) as well as to
`.modelica-studio.log` in the vault. It also publishes a handle for inspecting its
state live:

```js
modelicaStudio.help()        // what you can inspect
modelicaStudio.state()       // model, span, save path, toolchain, run count
modelicaStudio.source()      // the model as Modelica
modelicaStudio.model         // the parsed diagram
modelicaStudio.settings      // stored settings
modelicaStudio.library       // the class index
modelicaStudio.runLog        // every simulation this session
modelicaStudio.setVerbose(true)   // print every diagnostic line
modelicaStudio.trace()            // what the plugin held, step by step
```

The **run log** (the Run log tab under the results) and the **AI prompt log**
(Show the AI prompt log in the command palette) each have a **Copy** button, which
puts exactly what the pane is showing on the clipboard — for a bug report, or for
pasting into a prompt. A copy that the platform refuses says so rather than
claiming success.

`trace()` is the one for a suspected loss. The file log records what the plugin
**did**; the trace records what it **held** at each moment that changed — which
model, how long its source is, whether that source is still current, and which
file it will be written to:

```
      0ms  open    AirplaneDrag   src=2869 current=true comps=8 eqs=0 file=Modelica/AirplaneDrag.mo mode=code
   4200ms  edit    AirplaneDrag   src=2869 current=false comps=8 eqs=0 file=Modelica/AirplaneDrag.mo mode=diagram
   5100ms  adopt   AirplaneDrag   src=2874 current=true  comps=8 eqs=0 file=Modelica/AirplaneDrag.mo mode=code
   9800ms  switch  AirplaneDrag   src=2874 current=true  comps=8 eqs=0 file=Modelica/AirplaneDrag.mo mode=code
```

A `current=false` with no following `save` is the shape of a loss: the plugin was
holding an edit it had not written.

The log file is opt-in (**Write diagnostic log** in settings) because it survives
a reload and can be read from outside the app. The console needs no setting:
errors and warnings always print there, because a failure nobody can see is the
one that gets reported as "nothing happened".
