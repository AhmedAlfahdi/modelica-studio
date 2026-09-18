/**
 * The AI exchange log.
 *
 * Kept so a prompt can be improved from evidence. The run log has the compiler's
 * verdict and not the reply that provoked it, so by the time a model has been
 * repaired twice the original answer is gone — and the answer is what a prompt
 * change has to be aimed at.
 *
 * The one rule that is not negotiable is that the API key never reaches the file.
 * It travels in an authorization header rather than in the messages, so today there
 * is nothing to redact; these tests exist because "nothing to redact today" is not
 * a property a log of arbitrary provider output can rely on.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";

const {
  MAX_EXCHANGES,
  formatSummary,
  parseLog,
  pruneLines,
  redact,
  summarise,
  toLogLine,
} = await import(
  path.join(buildLibs("ai-log", ["src/ai/interaction-log.ts"]), "interaction-log.js")
);

/** An exchange with everything filled in, for the cases that do not vary. */
function exchange(over = {}) {
  return {
    at: "2026-09-18T16:29:26.788Z",
    attempt: 1,
    style: "visual",
    prompt: "a tank that drains through three pipes",
    messages: [
      { role: "system", content: "you write Modelica" },
      { role: "user", content: "a tank that drains through three pipes" },
    ],
    reply: "```modelica\nmodel Tank end Tank;\n```",
    extracted: "model Tank end Tank;",
    outcome: "ok",
    detail: "",
    ms: 4210,
    ...over,
  };
}

test("the API key cannot reach the log", () => {
  const key = "sk-abcdefghijklmnopqrstuvwxyz012345";
  // All the ways it could arrive: quoted in the prompt, echoed back by the
  // provider, or pasted into a failure message.
  const line = toLogLine(
    exchange({
      // The real text is kept ALONGSIDE the key, so the test also proves the
      // redaction did not take the useful content with it.
      prompt: `a tank that drains through three pipes, my key is ${key}`,
      reply: `401 for key ${key}`,
      detail: `Authorization: Bearer ${key}`,
      messages: [{ role: "user", content: `a tank that drains, key ${key}` }],
    }),
    key
  );
  assert.ok(!line.includes(key), `the key must not appear: ${line.slice(0, 120)}`);
  assert.match(line, /REDACTED/, "and it is visibly replaced");
  // The rest of the record survives: a redaction that took the useful content
  // with it would defeat the purpose of keeping the log at all.
  assert.match(line, /a tank that drains/);
  assert.match(line, /401 for key/, "and the provider's reply is still readable");
});

test("a key the plugin was not told about is still caught by shape", () => {
  // A provider that echoes an authorization header, or a key from another tool in
  // a pasted error, is not the configured one -- so matching the known key is not
  // enough on its own.
  assert.ok(!redact("Authorization: Bearer abcdefghijklmnop1234", null).includes("abcdefghijklmnop"));
  assert.ok(!redact("key sk-abcdefghijklmnopqrst", null).includes("sk-abcdefghijklmnopqrst"));
  // An ordinary sentence is left alone.
  assert.equal(redact("a tank with three pipes", "sk-xyz"), "a tank with three pipes");
});

test("one exchange is one line, whatever the reply contains", () => {
  // The file is appended to and grepped, so a multi-line reply must not become
  // several records.
  const line = toLogLine(exchange({ reply: "line one\nline two\n\nline four" }));
  assert.ok(!line.includes("\n"), "no raw newline in the record");
  const back = parseLog(line + "\n").exchanges;
  assert.equal(back.length, 1, "it reads back as one exchange");
  assert.match(back[0].reply, /line four/, "with the reply intact");
});

test("a half-written line does not cost the rest of the file", () => {
  // The plugin can be killed mid-append. Losing the last line must not lose the
  // other 199.
  const good = toLogLine(exchange());
  const text = [good, good, '{"at":"2026-09-18T16:00:00Z","outcome":"ok"', ""].join("\n");
  const { exchanges, skipped } = parseLog(text);
  assert.equal(exchanges.length, 2, "the readable records survive");
  assert.equal(skipped, 1, "and the truncated one is counted, not hidden");
});

test("the file is bounded by construction", () => {
  // Trimmed on write, so it cannot grow without limit if nobody opens it.
  const one = toLogLine(exchange());
  const over = Array.from({ length: MAX_EXCHANGES + 25 }, () => one).join("\n") + "\n";
  const pruned = pruneLines(over);
  assert.equal(pruned.split("\n").filter(Boolean).length, MAX_EXCHANGES, "the newest are kept");
  // Something already inside the limit is returned untouched, so a normal write
  // does not rewrite the file.
  const small = [one, one].join("\n");
  assert.equal(pruneLines(small), small, "no needless rewrite");
});

test("rejections are grouped, because a list is not a conclusion", () => {
  // A model the COMPILER accepted and that is still not usable means the
  // instruction was unclear. Those are the entries a prompt change aims at, and
  // the run log cannot show them.
  const log = [
    exchange({ outcome: "ok" }),
    exchange({ outcome: "rejected", detail: "The blocks are not wired together.\nAdd connections." }),
    exchange({ outcome: "rejected", detail: "The blocks are not wired together.\nOnly one was." }),
    exchange({ outcome: "rejected", detail: "That is not a diagram.\nIt has no components." }),
    exchange({ outcome: "compile-error", detail: "Variable m not found in scope A" }),
    exchange({ outcome: "no-source", detail: "no class declaration" }),
  ];
  const s = summarise(log);
  assert.equal(s.total, 6);
  assert.equal(s.byOutcome.rejected, 3);
  assert.equal(s.byOutcome.ok, 1);
  assert.equal(s.emptyReplies, 1, "the reply with no Modelica is counted separately");
  // Most common first, and counted rather than listed once per model.
  assert.equal(s.rejections.length, 2, `two distinct reasons, got ${JSON.stringify(s.rejections)}`);
  assert.equal(s.rejections[0].count, 2, "the repeated reason comes first");
  assert.match(s.rejections[0].reason, /not wired together/);
  // The detail after the first line is dropped: that is the per-model part.
  assert.ok(!/Add connections/.test(s.rejections[0].reason), "grouped by the opening sentence");
  // And an example prompt is carried, since that is what a prompt change needs.
  assert.match(s.rejections[0].examplePrompt, /tank that drains/);
});

test("the summary reads as something to act on", () => {
  const empty = formatSummary(summarise([]));
  assert.match(empty, /No AI exchanges/, "an empty log explains itself");

  const s = summarise([
    exchange({ outcome: "rejected", detail: "That is not a diagram." }),
    exchange({ outcome: "no-source", detail: "nothing" }),
  ]);
  const text = formatSummary(s, []);
  assert.match(text, /2 exchanges recorded/);
  assert.match(text, /Rejected after building/, "the actionable section is named");
  assert.match(text, /That is not a diagram/);
  assert.match(text, /contained no Modelica/, "and the extraction fault is flagged");

  // A log with no rejections says so rather than printing an empty heading.
  const clean = formatSummary(summarise([exchange({ outcome: "ok" })]), []);
  assert.match(clean, /Nothing was rejected/, "an all-clear is stated");
  assert.ok(!/Rejected after building/.test(clean), "and the heading is not left dangling");
});

test("the recent list is a table, not the whole reply", () => {
  const text = formatSummary(summarise([exchange()]), [exchange()]);
  assert.match(text, /attempt 1/, "the attempt is shown");
  assert.match(text, /visual/, "and the style, since an equations answer is not a diagram failure");
  assert.match(text, /4210ms/, "and how long it took");
  // The full reply belongs in the record, not in the summary.
  assert.ok(!/```modelica/.test(text), "no raw source in the summary");
});
