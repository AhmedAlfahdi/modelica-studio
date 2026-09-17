/**
 * The recorded AI baseline.
 *
 * A baseline that drifts from its own data is worse than none: it would be cited
 * as evidence while saying something the rows do not. These checks make an
 * inconsistent entry a test failure, which matters because the file is meant to
 * be appended to by hand for each new model.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./helpers/build.mjs";

const file = path.join(repoRoot, "docs/ai-baseline.json");
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const doc = fs.readFileSync(path.join(repoRoot, "docs/ai-baseline.md"), "utf8");

/** The prompt ids the harness actually runs, so a run cannot cite a prompt that does not exist. */
const benchSrc = fs.readFileSync(path.join(repoRoot, "src/ai/benchmark.ts"), "utf8");
const benchPrompts = [...benchSrc.matchAll(/\{ id: "([^"]+)", domain: "([^"]+)"/g)].map((m) => ({
  id: m[1],
  domain: m[2],
}));
const benchStyles = ["visual", "equations"];

test("the file parses and carries its method", () => {
  assert.ok(Array.isArray(data.runs) && data.runs.length >= 1, "at least one run");
  assert.ok(data.method?.harness, "the method names its harness");
  assert.ok(data.method?.notes?.length, "and records its caveats");
});

test("every run records what it was run against", () => {
  const ids = new Set();
  for (const run of data.runs) {
    assert.ok(run.id, "a run has an id");
    assert.ok(!ids.has(run.id), `duplicate run id ${run.id}`);
    ids.add(run.id);
    // Without the model and the settings, a number means nothing: the point of a
    // baseline is comparing one configuration against another.
    assert.ok(run.model, `${run.id} names its model`);
    assert.ok(run.provider, `${run.id} names its provider`);
    assert.ok(run.date, `${run.id} is dated`);
    assert.ok(run.config, `${run.id} records the settings it ran under`);
    assert.ok(typeof run.config.thinking === "string", `${run.id} records the thinking level`);
    assert.ok(typeof run.config.timeoutSeconds === "number", `${run.id} records the deadline`);
    // The state of the code is what makes two runs of the same model comparable.
    assert.ok(run.codeState, `${run.id} records what the code was doing`);
  }
});

test("the recorded rows cover every prompt in both styles", () => {
  for (const run of data.runs) {
    const seen = new Set(run.rows.map((r) => `${r.id}/${r.style}`));
    for (const prompt of benchPrompts) {
      for (const style of benchStyles) {
        assert.ok(seen.has(`${prompt.id}/${style}`), `${run.id} is missing ${prompt.id}/${style}`);
      }
    }
    // And the domain on each row matches the harness, so a row cannot be filed
    // under the wrong heading.
    for (const row of run.rows) {
      const known = benchPrompts.find((p) => p.id === row.id);
      assert.ok(known, `${run.id}: unknown prompt ${row.id}`);
      assert.equal(row.domain, known.domain, `${run.id}: ${row.id} filed under the wrong domain`);
    }
  }
});

test("the summaries match the rows they summarise", () => {
  // This is the check that matters. A summary is what gets quoted; if it drifts
  // from the data it is a false claim with a citation attached.
  for (const run of data.runs) {
    for (const style of benchStyles) {
      const rows = run.rows.filter((r) => r.style === style);
      if (!rows.length) continue;
      const s = run.summary[style];
      assert.ok(s, `${run.id} summarises ${style}`);
      const ok = rows.filter((r) => r.ok);
      assert.equal(s.ok, ok.length, `${run.id}/${style}: ok count`);
      assert.equal(s.of, rows.length, `${run.id}/${style}: total`);
      assert.equal(
        s.diagrams,
        ok.filter((r) => r.components >= 2).length,
        `${run.id}/${style}: diagram count`
      );
      assert.equal(
        s.fullyWired,
        ok.filter((r) => r.components >= 2 && r.wired === r.components).length,
        `${run.id}/${style}: fully wired count`
      );
    }
  }
});

test("a failed row says why", () => {
  // "ok: false" with no note is unreadable a month later, and the reasons are the
  // most useful thing in the file.
  for (const run of data.runs) {
    for (const row of run.rows.filter((r) => !r.ok)) {
      assert.ok(row.note, `${run.id}: ${row.id}/${row.style} failed without a note`);
    }
  }
});

test("the document states what is untested", () => {
  // The whole point of recording this was to stop "the AI" being discussed as one
  // thing. One model was measured; the rest must be named as untested.
  assert.ok(/## Untested/.test(doc), "there is a section for it");
  assert.match(doc, /No OpenAI model has been tested/, "OpenAI is called out");
  assert.match(doc, /deepseek-flash/, "and the model that WAS tested is named");
  assert.match(doc, /Append rather than overwrite/, "with the rule for adding a model");
});

test("the document does not overstate one sample", () => {
  // One sample per cell cannot rank two styles on speed. The document has to say
  // so, or the numbers will be quoted as if it could.
  assert.match(doc, /What this does not establish/, "there is a limitations section");
  assert.match(doc, /One sample per cell/, "the sample size is stated");
  assert.match(doc, /not usable/, "and the confounded run-A timings are marked as such");
});
