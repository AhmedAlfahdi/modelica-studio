/**
 * The diagnostic log, capped.
 *
 * The plugin writes this file in the vault on startup and on every simulation event, for
 * a bug report to be read from. Append-only with no ceiling is how it reached 9 MB in
 * the vault this was written in — a diagnostic aid that fills a disk is its own bug
 * report — and a log is read from its recent end, so the cap trims the old end and keeps
 * the whole lines around it.
 *
 * Ascertained on a real file, in a temporary directory: the interesting part is what the
 * file looks like after many appends, which a stub filesystem would only re-state.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";

const { appendCappedLine, LOG_MAX_BYTES, logLine, trimLogText } = await import(
  path.join(buildLibs("log-file", ["src/log-file.ts"]), "log-file.js")
);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mst-log-"));
const file = (name) => path.join(dir, name);

test("a log line carries its own timestamp", () => {
  const at = new Date("2026-09-25T12:00:00.000Z");
  assert.equal(logLine("simulate: 504 samples", at), "2026-09-25T12:00:00.000Z simulate: 504 samples\n");
  // Stamped on the line rather than dated once per session: a run that crosses
  // midnight would otherwise be one date.
  assert.match(logLine("x"), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z x\n$/);
});

test("trimming keeps whole lines, and the newest ones", () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${String(i).padStart(3, "0")}\n`);
  const text = lines.join("");

  // Under the budget: untouched, so a small log is never rewritten.
  assert.equal(trimLogText(text, text.length + 1), text);

  const kept = trimLogText(text, 200);
  assert.ok(kept.length <= 200, `within the budget: ${kept.length}`);
  assert.ok(kept.startsWith("line 0"), "a whole line at the top, not half of one");
  assert.ok(kept.endsWith("line 099\n"), "and the newest line is still there");
  const keptLines = kept.split("\n").filter(Boolean);
  assert.deepEqual(
    keptLines,
    lines.slice(lines.length - keptLines.length).map((l) => l.trimEnd()),
    "a contiguous run from the end, with nothing skipped"
  );

  // A single line longer than the budget has no boundary to cut at, so nothing is kept
  // rather than half a line.
  assert.equal(trimLogText("x".repeat(500), 100), "");
});

test("appending trims only once the file is past the cap", () => {
  const log = file("grows.log");
  const cap = 4_000;
  const big = "y".repeat(200) + "\n";

  for (let i = 0; i < 10; i++) appendCappedLine(log, `small ${i}\n`, cap);
  assert.equal(fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length, 10, "well under the cap, nothing trimmed");

  for (let i = 0; i < 60; i++) appendCappedLine(log, big, cap);
  const text = fs.readFileSync(log, "utf8");
  assert.ok(text.length <= cap, `the file stays within the cap: ${text.length} > ${cap}`);
  // Trimmed to half the cap, so the next trim is half a cap of logging away rather than
  // one line away -- 60 appends happened, and the file is one whole-line run.
  assert.ok(text.length > cap / 2 - big.length, `and holds a useful amount: ${text.length}`);
  for (const line of text.split("\n").filter(Boolean)) {
    assert.equal(line, "y".repeat(200), "every line in it is whole");
  }
  assert.ok(!text.includes("small 0"), "the oldest lines went first");

  // The cap is a real number of bytes, not a line count that happens to be small.
  assert.ok(LOG_MAX_BYTES >= 64 * 1024, `room for a session's worth of events: ${LOG_MAX_BYTES}`);
});

test("trimming never costs the line that was just appended", () => {
  // The append is the point; the trim is housekeeping. So the line whose own append
  // pushed the file past the cap must still be the last line in it -- which is also the
  // line a bug report is being written about.
  const log = file("newest.log");
  const cap = 600;
  for (let i = 0; i < 200; i++) appendCappedLine(log, `event ${i}\n`, cap);
  const text = fs.readFileSync(log, "utf8");
  assert.ok(text.length <= cap, `within the cap after 200 appends: ${text.length}`);
  assert.ok(text.endsWith("event 199\n"), "the newest line survived the trim it caused");
  assert.ok(!text.includes("event 0\n"), "and the oldest did not");

  // An append that cannot happen at all is reported to the caller, which is what keeps
  // diagnostics from breaking the plugin: `appendDiagnosticLog` catches everything.
  const asDir = file("dir-for-append");
  fs.mkdirSync(asDir, { recursive: true });
  assert.throws(
    () => appendCappedLine(asDir, "line\n"),
    /EISDIR|EPERM|EACCES/,
    "the caller is told, rather than the plugin failing silently"
  );
});
