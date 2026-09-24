/**
 * What the AI client puts on the wire, and what it does when nothing comes back.
 *
 * Two provider-facing defects, both invisible until a real request is made:
 * a DeepSeek-only field was sent to every provider (the default preset is
 * OpenAI's, which rejects unrecognised arguments with a 400), and the model list
 * had no deadline, so an endpoint that accepted the connection and never answered
 * left the settings button disabled for the session.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repoRoot, testTmpDir } from "./helpers/build.mjs";

// The client imports `requestUrl` from `obsidian`, which has no Node equivalent.
// The stub records what is sent and answers with whatever the test sets.
const staging = testTmpDir("mo-ai-request-");
execFileSync(
  "npx",
  [
    "esbuild",
    "src/ai/client.ts",
    "--bundle",
    "--format=esm",
    "--platform=node",
    "--external:obsidian",
    `--outdir=${staging}`,
    "--log-level=error",
  ],
  { cwd: repoRoot, stdio: "pipe" }
);
const pkgDir = path.join(staging, "node_modules", "obsidian");
fs.mkdirSync(pkgDir, { recursive: true });
fs.writeFileSync(
  path.join(pkgDir, "package.json"),
  JSON.stringify({ name: "obsidian", version: "0.0.0", type: "module", main: "index.js" })
);
fs.writeFileSync(
  path.join(pkgDir, "index.js"),
  [
    "export class Notice { constructor(m) { this.message = m; } }",
    "export class App {}",
    "export class SecretComponent {}",
    "export const requestUrl = async (opts) => globalThis.__request(opts);",
  ].join("\n")
);
const { chat, listModels, AiError } = await import(path.join(staging, "client.js"));

/* ------------------------------------------------------------------ */

/** A config with the default provider unless a test says otherwise. */
const cfg = (over = {}) => ({
  secretName: "KEY",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.6-terra",
  temperature: 0.2,
  systemPrompt: "",
  thinking: "off",
  style: "visual",
  timeoutSeconds: 10,
  ...over,
});

/** Answer the next request with a chat completion, recording what was sent. */
function respondWith(record, body = { choices: [{ message: { content: "model M\nend M;" } }] }) {
  globalThis.__request = async (opts) => {
    record.push(opts);
    return { status: 200, text: JSON.stringify(body), json: body, headers: {} };
  };
}

test("the thinking switch is sent only to the provider that has it", async () => {
  const sent = [];
  respondWith(sent);

  await chat(cfg(), [{ role: "user", content: "hi" }], () => "sk-test");
  const openai = JSON.parse(sent[0].body);

  assert.equal(
    "thinking" in openai,
    false,
    `an OpenAI request must not carry DeepSeek's switch: ${JSON.stringify(openai)}`
  );
  assert.equal("reasoning_effort" in openai, false, "and off means off");
  assert.equal(openai.model, "gpt-5.6-terra", "the model is still named");

  sent.length = 0;
  await chat(cfg({ baseUrl: "https://api.deepseek.com/v1" }), [{ role: "user", content: "hi" }], () => "sk-test");
  const deepseek = JSON.parse(sent[0].body);
  assert.deepEqual(
    deepseek.thinking,
    { type: "disabled" },
    "DeepSeek is told explicitly, or it reasons at high effort by default"
  );

  // A reasoning level is the provider's own parameter name on either of them.
  sent.length = 0;
  await chat(cfg({ thinking: "high" }), [{ role: "user", content: "hi" }], () => "sk-test");
  const openaiHigh = JSON.parse(sent[0].body);
  assert.equal(openaiHigh.reasoning_effort, "high", "a level is passed through");
  assert.equal("thinking" in openaiHigh, false, "and the switch is not");

  sent.length = 0;
  await chat(cfg({ baseUrl: "https://api.deepseek.com/v1", thinking: "high" }), [{ role: "user", content: "hi" }], () => "sk-test");
  assert.equal(JSON.parse(sent[0].body).reasoning_effort, "high", "on DeepSeek too");
});

test("a model list that never answers gives up instead of hanging", async () => {
  // `requestUrl` takes no AbortSignal and applies no timeout of its own, which is
  // why `chat` has a deadline. `listModels` did not, and the settings button is
  // renamed "Asking…" and disabled until its promise settles -- so against an
  // endpoint that accepts the connection and never replies, Refresh stayed dead for
  // the session.
  //
  // The floor on the timeout is 5 s, so this test takes 5 s. It is the shortest
  // honest version of it.
  globalThis.__request = () => new Promise(() => {});

  const started = Date.now();
  await assert.rejects(
    () => listModels(cfg({ timeoutSeconds: 1 }), "sk-test"),
    (err) => {
      assert.ok(err instanceof AiError, `it fails as an AI error, got ${err}`);
      assert.match(err.message, /did not arrive within/, `and says what happened: ${err.message}`);
      return true;
    }
  );
  const took = Date.now() - started;
  assert.ok(took < 20000, `it gave up on its own (${took} ms)`);

  // A provider that answers is unaffected.
  respondWith([], { data: [{ id: "gpt-5.6-terra" }, { id: "text-embedding-3-small" }] });
  const ids = await listModels(cfg(), "sk-test");
  assert.deepEqual(ids, ["gpt-5.6-terra", "text-embedding-3-small"], "chat models first");
});
