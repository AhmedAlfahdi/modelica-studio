/**
 * Why an AI request can appear to hang, and why New did not clear the canvas.
 *
 * Two reports, both traced to something that was true but invisible:
 *
 * 1. "When creating a new model via the New button, the canvas doesn't clean up."
 *    `newModel` replaced the diagram and left `modelSource` pointing at the
 *    PREVIOUS model. `loadModelIntoEditor` then filled the editor from that stale
 *    text, and the editor's own change handler parsed it straight back into the
 *    plugin — so the canvas repainted the model the user had just replaced.
 *
 * 2. "After trying AI it no longer provides an answer... it seems to go forever."
 *    `Thinking` was set to High, which asks the provider to reason at length
 *    before answering. The label called it "the provider's own default", which
 *    reads as the safe choice, and nothing on screen during a run said otherwise.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildLibs, repoRoot } from "./helpers/build.mjs";

const { AI_THINKING_LEVELS } = await import(
  path.join(buildLibs("ai-think", ["src/ai/prompts.ts"]), "prompts.js")
);

const main = fs.readFileSync(path.join(repoRoot, "src/main.ts"), "utf8");
const view = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");

test("replacing the model replaces its source too", () => {
  // The fault, stated as an invariant: the diagram and the text that describes it
  // are set in ONE place, so no path can leave the other behind. `newModel` was
  // the one of five that did.
  const helper = /private replaceModel\([\s\S]*?\n  \}/.exec(main);
  assert.ok(helper, "there is one place that sets both");
  assert.match(helper[0], /this\.model = model/, "it sets the diagram");
  assert.match(helper[0], /this\.modelSource = source/, "and the source");

  // Nothing outside it assigns the diagram directly: a second assignment is how
  // the pair came apart.
  const direct = [...main.matchAll(/^\s*this\.model = (?!model;)/gm)].map((m) => m[0].trim());
  assert.deepEqual(direct, [], `only replaceModel may assign the diagram, found ${JSON.stringify(direct)}`);

  // Every path that replaces the model goes through it. Each body is bounded by
  // its own closing brace rather than by a character window: a window measured in
  // characters is really a measure of how long the comments are, and it failed
  // here on the longest one.
  for (const call of ["newModel", "adoptModel", "setModelFromSource", "loadModelFromFile"]) {
    // Anchored to a line start with the class's own indentation, so a CALL to the
    // method inside another body cannot match -- which it did, and the failure
    // then pointed at the wrong thing.
    const body = new RegExp(`\\n  (?:private |public )?(?:async )?${call}\\([\\s\\S]*?\\n  \\}`).exec(main);
    assert.ok(body, `${call} was found`);
    assert.match(body[0], /this\.replaceModel\(/, `${call} must replace the model and its source together`);
  }
});

test("a new model leaves no trace of the previous one", () => {
  // The chain that repainted the old model: the editor is filled from
  // `modelSourceText()`, and the editor's change handler adopts what it parses.
  // So a stale source is not inert — it is a route back into the plugin.
  const fresh = /async newModel\(name: string\): Promise<void> \{[\s\S]*?\n  \}/.exec(main);
  assert.ok(fresh, "newModel is present");
  assert.match(fresh[0], /this\.replaceModel\(emptyDiagram\(name\)/, "the diagram is empty");
  // The skeleton, not an empty string: the editor should not open blank and Save
  // should write a valid class.
  assert.match(fresh[0], /`model \$\{name\}\\nend \$\{name\};\\n`/, "with a valid skeleton source");
  assert.ok(
    !/this\.model = emptyDiagram/.test(fresh[0]),
    "and not the diagram on its own, which is what left the source behind"
  );

  // The adoption really is what happens next, so the invariant matters.
  const validate = /private validateCode\(\): void \{[\s\S]*?\n  \}/.exec(view);
  assert.ok(validate, "validateCode is present");
  assert.match(validate[0], /adoptModel\(model, text\)/, "it adopts the parsed text");
  const load = /loadModelIntoEditor\(\): void \{[\s\S]*?\n  \}/.exec(view);
  assert.ok(load, "loadModelIntoEditor is present");
  assert.match(load[0], /modelSourceText\(\)/, "and the editor is filled from the source");
});

test("every thinking level says what it costs", () => {
  // "The provider's own default" described the SLOWEST sensible choice as though
  // it were neutral, and it is the setting that turns seconds into minutes.
  assert.equal(AI_THINKING_LEVELS.length, 4, "four levels");
  for (const level of AI_THINKING_LEVELS) {
    assert.match(
      level.hint,
      /second|minute|slow|fast/i,
      `${level.id} must say what it costs, got "${level.hint}"`
    );
  }
  const byId = Object.fromEntries(AI_THINKING_LEVELS.map((l) => [l.id, l]));
  assert.match(byId.off.hint, /second/i, "Off is the fast one");
  assert.match(byId.high.hint, /MINUTES/i, "High says minutes, in the strongest terms available");
  // The phrase that caused the confusion must be gone from High, which claimed to
  // be "the default" without saying it was the slow one.
  assert.ok(
    !/^The provider's own default\./.test(byId.high.hint),
    `High must not open by calling itself the default: ${byId.high.hint}`
  );
  assert.match(byId.max.hint, /slow/i, "Max admits it is the slowest");
});

test("a running request names the setting that explains the wait", () => {
  // A clock that climbs for five minutes with nothing beside it is
  // indistinguishable from a hang, and the remedy is one dropdown away.
  const tick = /private tickAiProgress\(model: string\): void \{[\s\S]*?\n  \}/.exec(view);
  assert.ok(tick, "the progress ticker is present");
  assert.match(tick[0], /settings\.ai\.thinking/, "it reads the thinking level");
  assert.match(tick[0], /thinking=\$\{thinking\}/, "and shows it while running");
  // Only when it is not off, or every ordinary run carries noise.
  assert.match(tick[0], /thinking === "off" \? "" :/, "and stays quiet for the fast default");
});

test("the timeout message names the likely cause", async () => {
  // The old message sent the reader to check the provider and the timeout, and
  // never mentioned the setting that was actually responsible.
  const client = fs.readFileSync(path.join(repoRoot, "src/ai/client.ts"), "utf8");
  const timeout = /const seconds = Math\.round\(timeoutMs \/ 1000\);[\s\S]*?\);/.exec(client);
  assert.ok(timeout, "the timeout message is present");
  assert.match(timeout[0], /Reasoning is set to/, "it names the thinking level");
  assert.match(timeout[0], /set Thinking to Off/, "and says what to do about it");
  // With thinking off it must NOT blame the thinking level.
  assert.match(timeout[0], /level === "off"/, "the two cases are told apart");
});

test("a missing optional field cannot abort a request", async () => {
  // `env.excluded.length` was the one optional read with no guard. Every other
  // field used `?.`, and an unguarded one throws before the request is sent,
  // which from outside looks like the AI doing nothing at all.
  const { describeEnvironment } = await import(
    path.join(buildLibs("ai-ctx", ["src/ai/context.ts"]), "context.js")
  );
  const minimal = { startTime: 0, stopTime: 1, numberOfIntervals: 1, tolerance: 1e-6, solver: "" };
  const text = describeEnvironment(minimal);
  assert.match(text, /This installation/, "it describes what it can");
  assert.match(text, /not detected/, "and says what it does not know");
});

test("a type declaration is not an unwired block", async () => {
  // THE REPORTED FAILURE. Asked to "simulate freefall of an object", the model came
  // back written as quantities and equations — correct, and it builds — and was
  // rejected five times running with "None of the 4 components are connected to
  // each other: height, velocity, weight, drag_force". Those are declarations of
  // `Modelica.Units.SI.*` types: physical quantities with no connector, for which
  // no connect() could ever be written. The advice that followed was impossible to
  // act on, so the same answer came back.
  const { describeLooseDiagram, describeStyleViolation } = await import(
    path.join(buildLibs("ai-loose", ["src/ai/generate.ts"]), "generate.js")
  );

  const equations = [
    "model FreeFall",
    "  parameter Modelica.Units.SI.Height release_height = 1000;",
    "  Modelica.Units.SI.Height height(start = release_height, fixed = true);",
    "  Modelica.Units.SI.Velocity velocity;",
    "  Modelica.Units.SI.Force weight;",
    "  Modelica.Units.SI.Force drag_force;",
    "equation",
    "  weight = 80 * 9.81;",
    "  der(height) = -velocity;",
    "end FreeFall;",
  ].join("\n");
  assert.equal(describeLooseDiagram(equations), null, "a correct equations model is not a loose diagram");
  // And the style check agrees with it, which it always did -- the two were in
  // direct contradiction, which is what made the loop unwinnable.
  assert.equal(describeStyleViolation(equations, "equations"), null, "and it is the form that was asked for");

  // A genuine loose diagram is still caught, or the fix would have removed the check.
  const loose = [
    "model Loose",
    "  Modelica.Blocks.Math.Gain a;",
    "  Modelica.Blocks.Math.Gain b;",
    "equation",
    "  y = a.y;",
    "end Loose;",
  ].join("\n");
  // The message reads "None of the 2 components ARE connected to each other", so
  // the phrase to match is the opening clause rather than a "not connected".
  assert.match(String(describeLooseDiagram(loose)), /None of the 2 components are connected/, "a real loose diagram still fails");

  // The library's own verdict takes precedence when it is available, so the check
  // does not depend on a list of namespaces staying correct.
  const asType = (name) => name.startsWith("Modelica.Blocks.");
  assert.equal(describeLooseDiagram(equations, asType), null, "no components by the library's reckoning");
  assert.match(String(describeLooseDiagram(loose, asType)), /None of the 2 components/, "and the blocks are still blocks");
});

test("an equations answer is not asked to wire anything", () => {
  // The two checks contradicted each other: the style check says in as many words
  // that "a library component inside an otherwise-equation model is fine", and the
  // loose-diagram check rejected exactly that. Only a DIAGRAM can be a loose
  // diagram, so the form decides whether the check applies at all.
  const generate = fs.readFileSync(path.join(repoRoot, "src/ai/generate.ts"), "utf8");
  const call = /const problem =[\s\S]*?describeStyleViolation\(source, askedFor\);/.exec(generate);
  assert.ok(call, "the check chain is present");
  assert.match(call[0], /askedFor === "equations"[\s\S]*?null/, "the equations form skips the loose check");
  assert.match(call[0], /describeLooseDiagram\(source, request\.isComponent\)/, "and the library's verdict is used");
  // The view supplies it.
  const view = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  assert.match(view, /isComponent: \(name\) => this\.plugin\.isComponentClass\(name\)/, "the view answers it");
});

test("the report says what the problem was, not just that it recurred", () => {
  // The panel read "the same problem came back" and left it there. The reason was
  // known -- the check returned it -- so withholding it made a concrete fault look
  // vague and gave the reader nothing to do.
  const sm = fs.readFileSync(path.join(repoRoot, "src/ai/stop-message.ts"), "utf8");
  assert.match(sm, /export function reasonDetail\(/, "the reason is carried");
  const view = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  const finish = /private finishAiRun\([\s\S]*?\n  \}/.exec(view);
  assert.ok(finish, "finishAiRun is present");
  assert.match(finish[0], /reasonDetail\(last\?\.failure\)/, "and shown in the panel");
  // The whole reason goes to the console, where it can be read and copied.
  assert.match(finish[0], /ai stopped: \$\{why\} Reason:/, "with the full text logged");
});

test("the AI log is reachable from the row that reports the failure", () => {
  // "The summary line can only carry so much, and the log is where the rest is" is
  // the whole point: a button next to Generate is nearer to hand than a command.
  const view = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  assert.match(view, /logBtn\.createSpan\(\{ text: "Prompt log" \}\)/, "there is a button");
  assert.match(view, /logBtn\.addEventListener\("click", \(\) => this\.showAiLog\(\)\)/, "and it opens the log");
  const show = /private showAiLog\(\): void \{[\s\S]*?\n  \}/.exec(view);
  assert.ok(show, "showAiLog is present");
  assert.match(show[0], /readAiExchanges\(\)/, "it reads the recorded exchanges");
  assert.match(show[0], /formatSummary\(/, "with the summary");
  assert.match(show[0], /formatExchanges\(/, "and the exchanges themselves");
  // One formatter shared with the command, so the two views cannot drift.
  const main = fs.readFileSync(path.join(repoRoot, "src/main.ts"), "utf8");
  assert.match(main, /formatExchanges\(exchanges\)/, "the command uses the same formatter");
});
