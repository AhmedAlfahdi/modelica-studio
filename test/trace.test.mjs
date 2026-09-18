/**
 * The trace of what the plugin holds.
 *
 * Written because every loss in this plugin has had the same shape: two modules
 * disagreeing about when something is written, with nothing failing at the time.
 * The Run log showed a successful run and the status line said "Ready", so there
 * was nothing to look at afterwards.
 *
 * The trace records what the plugin HOLDS at each step, so the step where the two
 * diverged is visible after the fact.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";

const { Trace, describeStateForTrace, TRACE_LIMIT } = await import(
  path.join(buildLibs("trace", ["src/diagnostics/trace.ts"]), "trace.js")
);

test("a step records what was held, not only what was done", () => {
  // The file log already records actions. What was missing is the STATE: a length
  // that changed without a save, a source that stopped being current.
  const detail = describeStateForTrace({
    modelName: "Tank",
    sourceLength: 120,
    sourceIsCurrent: true,
    components: 4,
    equations: 2,
    savedPath: "Modelica/Tank.mo",
    mode: "code",
  });
  assert.equal(detail.src, 120);
  assert.equal(detail.current, true);
  assert.equal(detail.file, "Modelica/Tank.mo");
  assert.equal(detail.mode, "code");
  // A model with no file says so rather than omitting the field, since a missing
  // key and an unsaved model look the same in a table.
  const unsaved = describeStateForTrace({
    modelName: "New",
    sourceLength: 10,
    sourceIsCurrent: false,
    components: 0,
    equations: 0,
    savedPath: null,
    mode: "diagram",
  });
  assert.equal(unsaved.file, "(unsaved)");
  assert.equal(unsaved.current, false);
});

test("the trace is bounded, and keeps the most recent steps", () => {
  // An unbounded trace of every drag would be a leak, and the interesting part is
  // always the last few steps before something went wrong.
  const trace = new Trace();
  for (let i = 0; i < TRACE_LIMIT + 50; i++) trace.add("edit", `M${i}`);
  assert.equal(trace.size, TRACE_LIMIT, "it holds the limit");
  const all = trace.all();
  assert.equal(all[all.length - 1].model, `M${TRACE_LIMIT + 49}`, "the newest is kept");
  assert.equal(all[0].model, "M50", "and the oldest were dropped");
});

test("steps can be read for one model", () => {
  // A report is about one model, so the whole session's steps are the wrong view.
  const trace = new Trace();
  trace.add("open", "Tank", { src: 100 });
  trace.add("edit", "Valve");
  trace.add("save", "Tank", { bytes: 120 });
  assert.equal(trace.forModel("Tank").length, 2);
  assert.equal(trace.forModel("Valve").length, 1);
  assert.equal(trace.forModel("Nothing").length, 0);
  assert.deepEqual(trace.last(2).map((e) => e.kind), ["edit", "save"]);
});

test("the trace reads as a table, and says so when empty", () => {
  const trace = new Trace();
  assert.equal(trace.toText(), "(nothing traced yet)", "an empty trace explains itself");

  trace.add("open", "Tank", { src: 100, current: true, file: "Modelica/Tank.mo" });
  trace.add("save", "Tank", { bytes: 120, to: "Modelica/Tank.mo" });
  const text = trace.toText();
  const lines = text.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\s*\d+ms\s+open\s+Tank\s+src=100 current=true file=Modelica\/Tank\.mo$/);
  assert.match(lines[1], /save\s+Tank\s+bytes=120/);

  // A null or undefined detail is left out rather than printed as "null", so the
  // table stays readable.
  trace.add("edit", "Tank", { src: 130, note: null });
  const last = trace.toText().split("\n").pop();
  assert.ok(!/note=/.test(last), `no empty field: ${last}`);
  assert.match(last, /src=130/);
});

test("clearing rests the clock as well as the entries", () => {
  const trace = new Trace();
  trace.add("open", "Tank");
  assert.equal(trace.size, 1);
  trace.clear();
  assert.equal(trace.size, 0);
  assert.equal(trace.toText(), "(nothing traced yet)");
});
