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

test("the documented performance figures are internally consistent", () => {
  // The tables cannot be verified automatically, but a table that contradicts
  // itself can be caught. The jobs table must fall monotonically: more parallel
  // codegen cannot be slower, and if it ever reads that way the measurement is
  // wrong rather than the machine.
  //
  // The measurements moved into `docs/performance.md` when the documentation was
  // split, and this test moved with them: a figure that stops being checked because
  // its page moved is how a table starts contradicting itself unnoticed.
  const performance = fs.readFileSync(path.join(repoRoot, "docs", "performance.md"), "utf8");
  const from = performance.indexOf("# Performance");
  const to = performance.indexOf("## Measuring it yourself");
  assert.ok(from >= 0 && to > from, "there is a performance page, with a Measuring it yourself section");
  const table = performance.slice(from, to);

  // Cells are read loosely: the first saving is an em dash and the last is bold,
  // so a strict pattern silently matched two rows out of four and the test passed
  // its length check for the wrong reason.
  const jobs = [...table.matchAll(/^\|\s*(\d+)\s*\|\s*([\d.]+)\s*s\s*\|\s*([^|]*)\|/gm)]
    .map((m) => {
      const cell = m[3].replace(/[*\s]/g, "");
      return {
        jobs: Number(m[1]),
        seconds: Number(m[2]),
        saving: cell.includes("%") ? Number(cell.replace("%", "")) : null,
      };
    });
  assert.ok(jobs.length >= 4, `found ${jobs.length} job rows`);
  for (let i = 1; i < jobs.length; i++) {
    assert.ok(
      jobs[i].seconds < jobs[i - 1].seconds,
      `jobs=${jobs[i].jobs} (${jobs[i].seconds}s) should beat jobs=${jobs[i - 1].jobs} (${jobs[i - 1].seconds}s)`
    );
    assert.ok(jobs[i].jobs > jobs[i - 1].jobs, "the job counts ascend");
  }

  // Every percentage must match the times on its own row, or the table claims a
  // saving the numbers beside it do not support.
  const base = jobs[0].seconds;
  for (const row of jobs.slice(1)) {
    if (row.saving === null) continue;
    const actual = Math.round((1 - row.seconds / base) * 100);
    assert.ok(
      Math.abs(actual - row.saving) <= 1,
      `jobs=${row.jobs} claims ${row.saving}% but the times give ${actual}%`
    );
  }

  // And the section must state the machine, or the numbers mean nothing.
  assert.match(table, /Ryzen 5 2600X/, "the machine is named");
  assert.match(table, /OpenModelica/, "and the toolchain");
});

test("the settings tab and the performance page quote the same figures", () => {
  // These have drifted twice already: the README said 970 ms / 1.9 s / 4.6 s
  // while docs/design.md said the same stale numbers, and the settings tab kept
  // a third copy. A number with two homes ends up with two values, so every
  // figure the settings tab quotes must appear in the README's table.
  const performance = fs.readFileSync(path.join(repoRoot, "docs", "performance.md"), "utf8");
  const perf = performance.slice(
    performance.indexOf("# Performance"),
    performance.indexOf("## Measuring it yourself")
  );
  assert.ok(perf.length > 500, "the performance page carries the measurements");

  const settings = fs.readFileSync(path.join(repoRoot, "src/settings.ts"), "utf8");
  // The heading is built with Obsidian's own `setHeading`, which the plugin directory's
  // linter requires of a settings tab; the section runs from it to the next heading.
  const block = /setName\("Performance"\)\.setHeading\(\);([\s\S]*?)\n    new Setting\(/.exec(settings);
  assert.ok(block, "the settings tab has one too");

  const quoted = [...block[1].matchAll(/metric\(\w+, "([^"]+)", "([^"]+)"/g)].map((m) => ({
    label: m[1],
    value: m[2].replace(/\\u2013/g, "\u2013"),
  }));
  assert.ok(quoted.length >= 6, `every metric is read, got ${quoted.length}`);

  for (const { label, value } of quoted) {
    // The leading number, so `0.3–0.5 s` and `18–36 ms` are checked by their
    // first figure rather than needing an exact string match on a range.
    const lead = /[\d.]+/.exec(value)?.[0];
    assert.ok(lead, `${label} quotes a number`);
    assert.ok(
      perf.includes(lead),
      `the settings tab says "${label}: ${value}" and the performance page does not mention ${lead}`
    );
  }
});
