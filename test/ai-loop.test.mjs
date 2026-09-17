/**
 * The generate-compile-repair loop.
 *
 * The control flow is tested against a fake generator and a fake compiler, which
 * is the only way to check the stopping rules: a real provider costs money and a
 * real compiler takes two seconds an attempt, and the interesting cases are the
 * ones that must NOT keep going.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { buildLibs, repoRoot } from "./helpers/build.mjs";

const omcLib = buildLibs("ai-loop-omc", ["src/omc/backend.ts", "src/omc/locate.ts"]);
const { OmcBackend } = await import(path.join(omcLib, "backend.js"));
const { locateOmcSync } = await import(path.join(omcLib, "locate.js"));
const { simCacheDir } = await import("./helpers/build.mjs");
const omcInfo = locateOmcSync();
const HAS_OMC = omcInfo.status === "found" && !!omcInfo.omcPath;

const mod = await import(path.join(buildLibs("ai-loop", ["src/ai/loop.ts"]), "loop.js"));
const { runGenerationLoop, sameFailure, normaliseFailure, summarise, DEFAULT_LIMITS } = mod;

/** A generator that hands back a scripted list of replies. */
const scripted = (replies) => {
  let i = 0;
  return async () => replies[Math.min(i++, replies.length - 1)];
};

/** A compiler that fails the first `n` times, with scripted errors. */
const failingFirst = (failures) => {
  let calls = 0;
  return async () => {
    const failure = failures[calls++];
    return failure === undefined ? { ok: true, failure: "" } : { ok: false, failure };
  };
};

test("a first-attempt success stops immediately", async () => {
  const r = await runGenerationLoop({
    generate: scripted(["model A\nend A;"]),
    compile: failingFirst([]),
  });
  assert.equal(r.ok, true);
  assert.equal(r.reason, "compiled");
  assert.equal(r.attempts.length, 1, "one attempt, one compile");
  assert.match(r.message, /first attempt/);
});

test("a failure is fed back and the repair is compiled", async () => {
  const seen = [];
  const r = await runGenerationLoop({
    generate: async ({ previous }) => {
      seen.push(previous?.failure ?? "");
      return previous ? "model A\n  Real x;\nend A;" : "model A\nend A;";
    },
    compile: failingFirst(["Variable m not found in scope A"]),
  });
  assert.equal(r.ok, true, "the second attempt compiled");
  assert.equal(r.attempts.length, 2);
  assert.equal(r.reason, "compiled");
  // The first call had no failure to go on; the second was given the error.
  assert.equal(seen[0], "");
  assert.match(seen[1], /Variable m not found/);
  assert.match(r.message, /after 2 attempts/);
});

test("an identical reply stops the loop instead of confirming it", async () => {
  // The same text cannot compile differently, so another attempt is wasted.
  let compiles = 0;
  const r = await runGenerationLoop({
    generate: scripted(["model A\nend A;"]),
    compile: async () => {
      compiles++;
      return { ok: false, failure: "Error: something" };
    },
  });
  assert.equal(r.reason, "no-progress");
  assert.match(r.message, /same source again/);
  assert.equal(compiles, 1, "it did not compile the same text twice");
});

test("a changing message is progress; the same message is not", async () => {
  // Different text each time but the SAME fault is still a loop.
  let n = 0;
  const r = await runGenerationLoop({
    generate: async () => `model A\n  Real x${n++};\nend A;`,
    compile: async () => ({ ok: false, failure: "Error: x is not declared\n  at /tmp/build-1/a.mo" }),
    isCancelled: () => false,
  });
  assert.equal(r.reason, "no-progress", "it gave up rather than loop");
  assert.ok(r.attempts.length <= 3, `stopped early, got ${r.attempts.length} attempts`);
});

test("a genuinely different error each time is allowed to continue", async () => {
  const failures = ["Error: one", "Error: two", "Error: three", undefined];
  let n = 0;
  const r = await runGenerationLoop({
    generate: async () => `model A\n  Real y${n++};\nend A;`,
    compile: failingFirst(failures),
  });
  assert.equal(r.ok, true, "progress was recognised and it kept going");
  assert.equal(r.attempts.length, 4);
});

test("the attempt ceiling is enforced", async () => {
  let n = 0;
  const r = await runGenerationLoop({
    generate: async () => `model A\n  Real z${n++};\nend A;`,
    compile: async () => ({ ok: false, failure: `Error: distinct ${n}` }),
    isCancelled: () => false,
  });
  assert.equal(r.reason, "attempts-exhausted");
  assert.equal(r.attempts.length, DEFAULT_LIMITS.maxAttempts);
  assert.match(r.message, new RegExp(String(DEFAULT_LIMITS.maxAttempts)));
});

test("cancellation stops it and says so", async () => {
  let cancelled = false;
  let attempts = 0;
  const r = await runGenerationLoop({
    generate: async () => {
      attempts++;
      cancelled = true; // cancelled while the first request is in flight
      return "model A\nend A;";
    },
    compile: async () => ({ ok: false, failure: "Error: one" }),
    isCancelled: () => cancelled && attempts > 0,
  });
  assert.equal(r.reason, "cancelled");
  assert.equal(r.attempts.length, 1);
});

test("an empty reply is not retried", async () => {
  // A reply with no Modelica is a prompt problem, so another attempt produces
  // the same thing.
  let calls = 0;
  const r = await runGenerationLoop({
    generate: async () => {
      calls++;
      return "   ";
    },
    compile: async () => ({ ok: true, failure: "" }),
  });
  assert.equal(r.reason, "no-source");
  assert.equal(calls, 1, "asked once");
});

test("a provider error stops immediately rather than burning attempts", async () => {
  const r = await runGenerationLoop({
    generate: async () => {
      throw new Error("Provider error 401: the API key was rejected.");
    },
    compile: async () => ({ ok: true, failure: "" }),
  });
  assert.equal(r.reason, "provider-error");
  assert.match(r.message, /401/);
});

test("progress is reported for each phase", async () => {
  const events = [];
  await runGenerationLoop({
    generate: async ({ previous }) => (previous ? "model A\n  Real x;\nend A;" : "model A\nend A;"),
    compile: failingFirst(["Error: one"]),
    onProgress: (e) => events.push(`${e.phase}:${e.attempt}`),
  });
  assert.deepEqual(events, ["asking:1", "compiling:1", "repairing:2", "compiling:2"]);
});

test("failures are compared after stripping what changes between runs", () => {
  // Build paths and timings differ on every attempt; without normalising them
  // every attempt looks like progress.
  const a = "[/tmp/omc-build-1234/A.mo:5:3] Error: Variable m not found in scope A. (1200 ms)";
  const b = "[/tmp/omc-build-9999/A.mo:5:3] Error: Variable m not found in scope A. (1300 ms)";
  assert.equal(sameFailure(a, b), true, "the same fault with different paths");
  const c = "[/tmp/omc-build-9999/A.mo:9:1] Error: Too few equations.";
  assert.equal(sameFailure(a, c), false, "a different fault");
});

test("normalising keeps the part that says what is wrong", () => {
  const n = normaliseFailure("[/x/y.mo:5:3] Error: Variable m not found in scope M. (900 ms)");
  assert.match(n, /Variable m not found/, "the message survives");
  assert.ok(!/900/.test(n), "the timing does not");
  assert.ok(!/\/x\/y\.mo/.test(n), "nor the path");
});

test("a status summary names the fault, not the chatter", () => {
  // OpenModelica's first line is often a notification; the fault is further down.
  const detail = [
    "notification: Automatically loaded package Modelica 4.1.0",
    "[/tmp/a.mo:5:3] error: Variable m not found in scope M.",
  ].join("\n");
  const s = summarise(detail);
  assert.match(s, /Variable m not found/);
  assert.ok(!/Automatically loaded/.test(s));
  // And it stays short enough for one line of a status bar.
  assert.ok(summarise("x".repeat(500)).length <= 160);
});

/* ---- the runner: how it talks to the provider and the compiler ---- */

const gen = await import(path.join(buildLibs("ai-gen", ["src/ai/generate.ts"]), "generate.js"));
const { generateModel, formatDiagnostics, describeStaticModel } = gen;

/** A backend whose compile() returns a scripted sequence. */
const fakeBackend = (outcomes) => {
  let i = 0;
  return {
    compile: async () => outcomes[Math.min(i++, outcomes.length - 1)],
  };
};
const failWith = (message, line) => ({
  ok: false,
  diagnostics: [{ severity: "error", message, line }],
});

/** A buildMessages that records what it was asked, so the feedback is visible. */
const recorder = () => {
  const calls = [];
  return {
    calls,
    fn: (prompt, current, failure) => {
      calls.push({ prompt, current, failure });
      return [{ role: "user", content: prompt + (failure ? ` | ${failure}` : "") }];
    },
  };
};

const baseRequest = (over = {}) => ({
  prompt: "a tank draining through an orifice",
  environment: "## This installation\n- OpenModelica 1.27.0",
  getKey: () => "sk-test",
  config: { apiKey: "", baseUrl: "https://example.invalid", model: "m", temperature: 0, systemPrompt: "" },
  settings: { startTime: 0, stopTime: 20, numberOfIntervals: 500, tolerance: 1e-6, solver: "" },
  ...over,
});

test("a compiling model is accepted on the first attempt", async () => {
  const rec = recorder();
  let sent = 0;
  const r = await generateModel(
    baseRequest({
      backend: fakeBackend([{ ok: true, diagnostics: [] }]),
      buildMessages: rec.fn,
      send: async () => {
        sent++;
        return "```modelica\nmodel Tank\n  Real h;\nequation\n  der(h) = -h;\nend Tank;\n```";
      },
    })
  );
  assert.equal(r.ok, true);
  assert.equal(r.reason, "compiled");
  assert.equal(sent, 1, "asked once");
  assert.equal(r.modelName, "Tank", "the declared class is reported");
  // The first request carries no failure; there was nothing to repair.
  assert.equal(rec.calls[0].failure, "");
});

test("the compiler output is what the repair attempt is given", async () => {
  // The heart of the loop: attempt 2 must see the fault, verbatim and with its
  // position, or it is guessing. The fake provider answers differently once it
  // has been shown a failure, which is what a repair looks like from here.
  const rec = recorder();
  let sent = 0;
  const r = await generateModel(
    baseRequest({
      backend: fakeBackend([
        failWith("Variable m not found in scope Tank.", 5),
        { ok: true, diagnostics: [] },
      ]),
      buildMessages: rec.fn,
      send: async () => {
        sent++;
        return sent === 1
          ? "```modelica\nmodel Tank\n  Real h;\nder(h) = m;\nend Tank;\n```"
          : "```modelica\nmodel Tank\n  Real h;\nder(h) = -h;\nend Tank;\n```";
      },
    })
  );
  assert.equal(r.attempts.length, 2, "it compiled twice");
  assert.equal(r.ok, true, "the second attempt was accepted");
  assert.equal(rec.calls.length, 2);
  assert.equal(rec.calls[0].failure, "", "nothing to repair on the first");
  assert.match(rec.calls[1].failure, /Variable m not found/, "the fault is passed on");
  assert.match(rec.calls[1].failure, /line 5/, "with its position");
});

test("the same failure twice is reported and the loop stops", async () => {
  let n = 0;
  const r = await generateModel(
    baseRequest({
      // Never fixes it, and the text differs only in the parts that always differ.
      backend: {
        compile: async () => {
          n++;
          return failWith(`Variable m not found in scope Tank. at /tmp/build-${n}/a.mo`, 5);
        },
      },
      buildMessages: recorder().fn,
      send: async () => ["model Tank", "  Real h;", "der(h) = m;", "end Tank;"].join("\n"),
    })
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-progress", "it stopped rather than burn every attempt");
  assert.ok(r.attempts.length <= 3, `stopped early, got ${r.attempts.length}`);
  assert.ok(r.attempts.length >= 1, "having tried at least once");
});

test("a static model is reported as a failure, not a success", () => {
  // OpenModelica compiles a model with nothing time-dependent and then refuses to
  // simulate it. Accepting it at the compile step hands over a model that cannot
  // run and no explanation.
  const problem = describeStaticModel("model A\n  Real y;\nequation\n  y = 2;\nend A;", []);
  assert.ok(problem, "it is caught");
  assert.match(problem, /nothing that changes with time/);
  // Dynamics in any of the usual forms is fine.
  for (const body of [
    "model A\n  Real x;\nequation\n  der(x) = -x;\nend A;",
    "model A\n  Real x;\nequation\n  x = time;\nend A;",
    "model A\n  Real x;\nequation\n  when time > 1 then\n    x = 1;\n  end when;\nend A;",
  ]) {
    assert.equal(describeStaticModel(body, []), null, `accepted: ${body.split("\n")[0]}`);
  }
});

test("a model with library components is not called static", () => {
  // A component brings its own equations, so a circuit of a source and a resistor
  // is legitimately static between its initial and final values.
  const model = [
    "model A",
    "  Modelica.Electrical.Analog.Sources.ConstantVoltage source(V=10);",
    "  Modelica.Electrical.Analog.Basic.Resistor r(R=100);",
    "equation",
    "  connect(source.p, r.p);",
    "end A;",
  ].join("\n");
  assert.equal(describeStaticModel(model, []), null);
});

test("a compiler error suppresses the static-model guess", () => {
  // If the compiler already said something, the static guess would be a second,
  // worse explanation of the same failure.
  const withError = describeStaticModel("model A\n  Real y;\nequation\n  y = 2;\nend A;", [
    { severity: "error", message: "Too few equations" },
  ]);
  assert.equal(withError, null, "the compiler's own message wins");
});

test("diagnostics are rendered with the positions the compiler gave", () => {
  const text = formatDiagnostics([
    { severity: "error", message: "Variable m not found in scope A.", line: 5, column: 3 },
    { severity: "warning", message: "Unused variable" },
  ]);
  assert.match(text, /error: Variable m not found in scope A\. \(line 5, column 3\)/);
  assert.match(text, /warning: Unused variable/);
});

test("a compile that failed with no parsed diagnostic still says something", () => {
  // An empty failure would read to the loop as progress, and the model would be
  // asked to fix nothing.
  const text = formatDiagnostics([]);
  assert.ok(text.length > 20, "not empty");
  assert.match(text, /without reporting a diagnostic/);
});

test("notifications are left out of the feedback", () => {
  // OpenModelica emits several "Automatically loaded package" notifications on
  // every build; sending them would bury the fault.
  const text = formatDiagnostics([
    { severity: "notification", message: "Automatically loaded package Modelica 4.1.0" },
    { severity: "error", message: "Variable m not found" },
  ]);
  assert.ok(!/Automatically loaded/.test(text));
  assert.match(text, /Variable m not found/);
});

/* ---- against the real compiler ---- */

test("a broken model is compiled, repaired and accepted", { skip: !HAS_OMC, timeout: 300000 }, async () => {
  // The whole point, end to end: the first reply does not compile, the compiler's
  // own words go back to the provider, and the second reply is accepted. Uses the
  // real OpenModelica, because a fake compiler cannot show that the feedback is
  // the right shape for it to act on.
  const omc = locateOmcSync();
  const backend = new OmcBackend({
    omcPath: omc.omcPath,
    cacheDir: simCacheDir("ai-loop-e2e"),
  });

  // Undeclared `m` — the fault a model actually made, and one OpenModelica
  // reports with a line number.
  const broken = [
    "model Tank \"draining\"",
    "  Real h(start = 1, fixed = true);",
    "equation",
    "  der(h) = -m*h;",
    "end Tank;",
  ].join("\n");
  const fixed = [
    "model Tank \"draining\"",
    "  parameter Real m = 0.1;",
    "  Real h(start = 1, fixed = true);",
    "equation",
    "  der(h) = -m*h;",
    "end Tank;",
  ].join("\n");

  const rec = recorder();
  let sent = 0;
  const r = await generateModel(
    baseRequest({
      backend,
      buildMessages: rec.fn,
      send: async () => "```modelica\n" + (++sent === 1 ? broken : fixed) + "\n```",
      limits: { maxAttempts: 3, maxUnchanged: 2 },
    })
  );

  assert.equal(r.ok, true, `expected it to compile; got ${r.reason}: ${r.message}`);
  assert.equal(r.attempts.length, 2, "it took a repair");
  assert.match(rec.calls[1].failure, /m/i, "the undeclared name was reported back");
  backend.dispose();
});

test("a model that builds but cannot run is sent back for repair", { skip: !HAS_OMC, timeout: 300000 }, async () => {
  // OpenModelica compiles a static model happily and refuses to simulate it. If
  // the loop accepted it at the compile step the user would get a model that
  // cannot run, and no explanation.
  const omc = locateOmcSync();
  const backend = new OmcBackend({ omcPath: omc.omcPath, cacheDir: simCacheDir("ai-loop-static") });

  const staticModel = ["model Flat", "  Real y;", "equation", "  y = 2;", "end Flat;"].join("\n");
  const dynamic = [
    "model Flat",
    "  Real y(start = 1, fixed = true);",
    "equation",
    "  der(y) = -y;",
    "end Flat;",
  ].join("\n");

  const rec = recorder();
  let sent = 0;
  const r = await generateModel(
    baseRequest({
      backend,
      buildMessages: rec.fn,
      send: async () => "```modelica\n" + (++sent === 1 ? staticModel : dynamic) + "\n```",
      limits: { maxAttempts: 3, maxUnchanged: 2 },
    })
  );

  assert.equal(r.ok, true, `expected the repair to be accepted; got ${r.reason}`);
  assert.equal(r.attempts.length, 2);
  assert.match(rec.calls[1].failure, /nothing that changes with time/, "it says what is missing");
  backend.dispose();
});

/* ---- the request itself: the deadline and the thinking switch ---- */

// The deadline helper is pure, so it is tested directly rather than through the
// HTTP client, which imports Obsidian and cannot load here.
const { withTimeout } = await import(
  path.join(buildLibs("ai-deadline", ["src/ai/deadline.ts"]), "deadline.js")
);

test("a request that never answers fails instead of hanging", async () => {
  // `requestUrl` takes no AbortSignal and applies no timeout, so a request that
  // never answers waited forever: the UI sat on "asking…" with a Stop button that
  // could not interrupt it, which is what "it looks stuck" was.
  const never = new Promise(() => {});
  const started = Date.now();
  await assert.rejects(
    () => withTimeout(never, 60, () => new Error("timed out")),
    /timed out/
  );
  assert.ok(Date.now() - started < 2000, "it gave up at its deadline, not later");
});

test("a request that answers in time is returned untouched", async () => {
  const value = await withTimeout(Promise.resolve("model A\nend A;"), 5000, () => new Error("late"));
  assert.equal(value, "model A\nend A;");
});

test("the timer is cleared, so nothing fires after the fact", async () => {
  // A live timer keeps the process awake and would reject a promise that has
  // already settled, which surfaces as an unhandled rejection.
  await withTimeout(Promise.resolve(1), 20, () => new Error("late"));
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(true, "no unhandled rejection and nothing left running");
});

test("a rejection from the request is passed through, not replaced", async () => {
  // A connection refused must read as a connection problem, not as a timeout.
  await assert.rejects(
    () => withTimeout(Promise.reject(new Error("ECONNREFUSED")), 5000, () => new Error("timed out")),
    /ECONNREFUSED/
  );
});

test("a cancellation during the wait is noticed", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 10_000, () => new Error("timed out"), controller.signal),
    /Cancelled/
  );
});

test("thinking is disabled by default, because it is mostly latency here", () => {
  // DeepSeek V4 reasons at "high" effort before answering unless told not to,
  // which is a minute of waiting for a task the compiler checks a second later.
  // It also silently disables `temperature`: the provider accepts it and ignores
  // it, so the setting appeared to work and did nothing.
  const src = fs.readFileSync(path.join(repoRoot, "src/ai/prompts.ts"), "utf8");
  assert.match(src, /thinking: "disabled"/, "the default disables it");
  assert.match(src, /type: ThinkingMode|thinking\?: ThinkingMode/, "and it is configurable");
  const client = fs.readFileSync(path.join(repoRoot, "src/ai/client.ts"), "utf8");
  assert.match(client, /body\.thinking = \{ type: "disabled" \}/, "the request carries the switch");
  // And a deadline is always applied.
  assert.match(client, /timeoutSeconds \?\? DEFAULT_TIMEOUT_SECONDS/, "the deadline has a default");
});

test("the default model matches the provider presets", () => {
  // The defaults had drifted to a model the presets no longer list, so a user who
  // never opened the provider picker was configured for a name nothing offered.
  const src = fs.readFileSync(path.join(repoRoot, "src/ai/prompts.ts"), "utf8");
  const defaults = /export const AI_DEFAULTS[\s\S]*?\n\};/.exec(src)[0];
  const preset = /label: "OpenAI"[\s\S]*?verified/.exec(src)[0];
  const model = /model: "([^"]+)"/.exec(defaults)[1];
  assert.match(preset, new RegExp(`model: "${model}"`), `${model} is a preset model`);
});

test("a timeout is reported as a timeout, not as a refusal", async () => {
  // "The provider refused the request" for a deadline sends the reader to check
  // an API key that was working, when the problem is that the model is slow or
  // the prompt is long. The two need different actions.
  const r = await runGenerationLoop({
    generate: async () => {
      throw new Error(
        "deepseek-flash did not reply within 220 s. It may be a slow model, a long prompt, or a provider that is not responding."
      );
    },
    compile: async () => ({ ok: true, failure: "" }),
  });
  assert.equal(r.reason, "timed-out", "told apart from a refusal");
  assert.match(r.message, /did not reply within/, "and the message is carried through");
});

test("a real refusal is still a provider error", async () => {
  const r = await runGenerationLoop({
    generate: async () => {
      throw new Error("Provider error 401: the API key was rejected.");
    },
    compile: async () => ({ ok: true, failure: "" }),
  });
  assert.equal(r.reason, "provider-error");
});

test("timeout detection does not catch an ordinary failure", () => {
  const { isTimeout } = mod;
  assert.equal(isTimeout("did not reply within 120 s"), true);
  assert.equal(isTimeout("connect ETIMEDOUT 1.2.3.4:443"), true);
  assert.equal(isTimeout("the request timed out"), true);
  assert.equal(isTimeout("Provider error 401: the API key was rejected."), false);
  assert.equal(isTimeout("Could not reach https://api.example.com."), false);
});
