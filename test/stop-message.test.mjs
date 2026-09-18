/**
 * What the reader is told when a generation stops.
 *
 * Reported: "it replied that the AI couldn't give an answer, but then the
 * simulation worked". The cause was a chain of comparisons with a catch-all:
 * `timed-out` was added to the union and no branch was added alongside it, so a
 * timeout fell through to the last `else` and was announced as "The reply
 * contained no Modelica" — a different problem, with a different remedy.
 *
 * The fix makes the messages a Record keyed by the reason, so a missing one does
 * not compile. These tests hold the part a type cannot: that every reason says
 * something DIFFERENT, and that none of them is the fall-through text.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";

const { stopMessage, keptSourceNote } = await import(
  path.join(buildLibs("stop-msg", ["src/ai/stop-message.ts"]), "stop-message.js")
);

/** Every reason the loop can stop for. Kept in step with `StopReason`. */
const REASONS = [
  "attempts-exhausted",
  "no-progress",
  "cancelled",
  "no-source",
  "provider-error",
  "timed-out",
];

test("a timeout is reported as a timeout, not as a missing reply", () => {
  // The exact fault. A timeout means the model was slow or the request was long;
  // the remedy is to wait, shorten it, or raise the limit.
  const text = stopMessage("timed-out", "The provider did not reply within 300s.", 2);
  assert.match(text, /did not reply in time/, "it says the provider was slow");
  assert.match(text, /300s/, "and carries the loop's own detail");
  assert.ok(
    !/no Modelica|contained no/i.test(text),
    `a timeout must not be described as an empty reply: ${text}`
  );
  // And it must not send the reader to check a key, which is the refusal's remedy.
  assert.ok(!/key|refus/i.test(text), `a timeout is not a refusal: ${text}`);
});

test("every reason says something different", () => {
  // The catch-all was invisible because two reasons produced the SAME sentence.
  // Distinctness is the property a type cannot enforce and this can.
  const seen = new Map();
  for (const reason of REASONS) {
    const text = stopMessage(reason, "detail", 3);
    assert.ok(text.trim().length > 0, `${reason} must say something`);
    assert.ok(
      !seen.has(text),
      `${reason} reads the same as ${seen.get(text)}: ${text}`
    );
    seen.set(text, reason);
  }
  assert.equal(seen.size, REASONS.length, "one message per reason");
});

test("the counts and the provider's words are carried through", () => {
  assert.match(stopMessage("attempts-exhausted", "", 1), /1 attempt\./, "singular");
  assert.match(stopMessage("attempts-exhausted", "", 3), /3 attempts\./, "plural");
  assert.match(stopMessage("no-progress", "", 2), /2 attempts/, "and for no-progress");
  // A refusal names what is wrong with the request, so the provider's words ARE
  // the message rather than something paraphrased around them.
  assert.equal(
    stopMessage("provider-error", "401 Unauthorized: invalid key", 1),
    "401 Unauthorized: invalid key"
  );
});

test("an unknown reason degrades instead of lying", () => {
  // Belt to the type's braces: the view is built from a bundle, and a reason can
  // also arrive from a stored outcome.
  const text = stopMessage("something-new", "detail", 1);
  assert.match(text, /unknown reason/, "it admits what it does not know");
  assert.match(text, /something-new/, "and names it");
});

test("a rejected model that builds is not described as broken", () => {
  // The second half of the report: the source was applied and simulated fine, so
  // the reader is told to try it rather than to give up. A model can be rejected
  // for having nothing time-dependent to simulate, or for being the wrong form --
  // neither of which means it does not build.
  assert.match(keptSourceNote(true), /builds/, "it says the model builds");
  assert.match(keptSourceNote(true), /Simulate/, "and what to do about it");
  assert.match(keptSourceNote(false), /error can be read/, "a real failure says otherwise");
  assert.notEqual(keptSourceNote(true), keptSourceNote(false), "the two differ");
});
