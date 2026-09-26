# AI assistance
Optional, and off until an API key is entered. The request, the repair loop and what has actually been measured are all here; the key itself lives in Obsidian's keychain.

Optional, off until an API key is entered.

1. Settings → Modelica Studio → AI assistance.
2. **API key** opens Obsidian's keychain: pick an existing secret, or create one.
   Pick a provider preset, or set the base URL and model directly. Any
   OpenAI-compatible endpoint works, including a local Ollama or llama.cpp
   server.
3. **Test** confirms the provider answers, and says what it said if it does not.
4. **Refresh model list** asks the provider which models it currently offers.
   Model names are retired without notice — `deepseek-chat` became
   `deepseek-flash` — and a retired name fails with an error that reads like a
   bad key, so the plugin fetches the list rather than shipping a stale one.

In the studio, switch to **Code** and press **AI**. Describe the model you want
and it is written, compiled and **repaired until it builds** — without further
input:

1. The request goes to the provider with the brief above attached.
2. The reply is **compiled** with OpenModelica.
3. If it fails, the compiler's own output — with its line and column numbers —
   goes back to the provider as the next request.
4. Steps 2 and 3 repeat until it compiles.

**You choose the form and the effort.** Two settings under AI assistance:

- **Model style** — *Diagram first* builds from library components, so you get a
  schematic you can see and rewire. A schematic depends on component paths,
  parameters and every connection being right, so the ways to fail outnumber the
  ways to succeed; equations have far less to get wrong. So if the diagram has
  had two attempts and still will not compile, the run **falls back to equations**
  automatically and says so. *Equations* skips straight there.
- **Reasoning effort** — *Off* / *Low* / *High* / *Max*. Providers that default to
  thinking spend that time on every request, and it silently disables Temperature.
  Off is fastest and suits code; raise it when attempts keep failing.

The loop stops when the model compiles, when the model returns the same source
twice, when the same error comes back twice (compared after stripping build
paths and timings, which differ on every attempt), when a provider error
occurs, or at five attempts. A model that compiles but has nothing that changes
with time counts as a **failure**, because OpenModelica builds it and then
refuses to simulate it.

Each step is reported as it happens — the attempt number, and the fault being
repaired — and **Stop** ends the run after the current step. Nothing is written
to the editor until a model compiles, so a run that produces nothing leaves your
model as it was.

**The Run log** tab keeps every simulation of the session: the model, the
parameters and run settings used, the timings, and on failure OpenModelica's
**complete output**. **Send to AI** hands that to the model and asks for a fix,
so a repair request is built from the compiler's own words rather than a
paraphrase — the first line of an OpenModelica error is usually a file path or
`Internal error`, and the line naming the fault comes several lines later.
**Copy** puts the same text on the clipboard for a bug report.

Every request also carries a standing brief about this installation, so the model
writes for the machine it is actually on rather than a generic one: the
OpenModelica version and path, the indexed libraries and how many classes they
hold, the run settings a simulation will use (span, intervals, tolerance,
solver), the libraries you have excluded, and the failures already in the log.
It is told not to add an `experiment` annotation, because the plugin applies the
run settings itself and an annotation conflicts with them.

The key lives in **Obsidian's keychain**, not in this plugin's `data.json`. Only
the *name* of the secret is stored with the plugin, so the value stays out of
vault backups, sync services and version control, and any other plugin can reuse
the same secret. It is never written to the debug log, never attached to an error
message, and only ever sent to the endpoint configured here.

This needs **Obsidian 1.11.4 or later**, which is where the keychain API arrived;
the plugin declares that as its minimum. On an older build the AI section says so
rather than falling back to storing a key in plain text.

If you configured a key with an earlier version of this plugin, it is still in
`data.json` and the settings page offers to move it into the keychain and delete
the plaintext copy.

Generated code is **unverified**: it is a draft to simulate and check, not an
answer. The request includes the current source and a shortlist of library
classes relevant to your description, so the model composes real MSL classes
instead of inventing names.

## What is known about the AI

One model has been measured, not assumed: see
[`ai-baseline.md`](ai-baseline.md) for the method, the results, and
what they do **not** establish. In short, for `deepseek-flash`:

- diagram-first works — 8/8 compiled, 7 as fully wired diagrams across electrical,
  mechanical, thermal, fluid, multibody and control;
- the equations fallback earned itself, on one run out of eight;
- a hard request can take several minutes, because the repair loop is additive.

**No OpenAI model has been tested.** If you run one, `modelicaStudio.bench()` in
the developer console measures it, and the result belongs in
`docs/ai-baseline.json` as a new entry.
