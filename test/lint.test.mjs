/**
 * The plugin directory's own linters, as tests.
 *
 * The submission review runs `eslint-plugin-obsidianmd`'s recommended config over the
 * source and the same family of CSS checks the published `stylelint-config-obsidianmd`
 * applies over the stylesheet. A submission is a bad place to see either list for the
 * first time: a style finding means a rewrite in public, and an error holds the plugin
 * out of the directory until it is fixed. `eslint.config.mjs` and `stylelint.config.mjs`
 * reproduce those rules with the same severities, so these tests are the review, run
 * locally.
 *
 * The source test is the slowest in the suite (type-aware linting over the whole source:
 * about forty seconds), which is why it is one test rather than one per rule. Both are
 * skipped when their linter is not installed — the suite is otherwise usable without the
 * dev tooling.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./helpers/build.mjs";

const eslint = path.join(repoRoot, "node_modules", ".bin", "eslint");
const stylelint = path.join(repoRoot, "node_modules", ".bin", "stylelint");

/**
 * Every finding eslint reports for `target`, as text lines.
 *
 * `target` is relative to the repository root, so the repository's own
 * `eslint.config.mjs` applies — including for a target that is a temporary directory
 * inside the repository, which is how the review's environment is reproduced below.
 */
function lintFindings(target) {
  let out = "";
  try {
    out = execFileSync(eslint, [target, "-f", "json"], { cwd: repoRoot, encoding: "utf8" });
  } catch (err) {
    out = String(err.stdout ?? "");
  }
  const files = JSON.parse(out.slice(out.indexOf("[")));
  return files.flatMap((file) => {
    const rel = path.relative(repoRoot, file.filePath);
    return file.messages.map(
      (m) => `${rel}:${m.line}:${m.column} sev${m.severity} ${m.ruleId ?? "parse"} ${String(m.message).split("\n")[0]}`
    );
  });
}

test("the source passes the plugin directory's linter", { skip: !fs.existsSync(eslint) && "eslint is not installed" }, () => {
  const findings = lintFindings("src");
  const errors = findings.filter((f) => f.includes(" sev2 "));
  const warnings = findings.filter((f) => f.includes(" sev1 "));

  // Errors are what the directory refuses to publish: none are allowed, and the message
  // lists them so a failure says what to fix rather than "lint failed".
  assert.deepEqual(errors, [], `${errors.length} lint errors:\n  ${errors.join("\n  ")}`);

  // Warnings are allowed through, but the list is asserted so that it is a KNOWN list. A
  // new warning fails this test, which is the point: the count only ever moves because
  // someone decided it should.
  const known = (w) =>
    w.includes("@typescript-eslint/no-deprecated") ||
    w.includes("obsidianmd/settings-tab/prefer-setting-definitions");
  assert.ok(
    warnings.every(known),
    `unexpected lint warnings:\n  ${warnings.filter((w) => !known(w)).join("\n  ")}`
  );
  assert.ok(warnings.length >= 1, "the two known warning families are still being reported");
});

test("and passes it in the review's environment, which has no @types/node", { skip: !fs.existsSync(eslint) && "eslint is not installed" }, () => {
  // The community directory's lint provides the `obsidian` package — the API types — and
  // NOT this repository's devDependencies. Its report on this plugin cited roughly three
  // hundred and fifty `no-unsafe-member-access` / `-call` / `-assignment` / `-argument`
  // warnings on `node:fs`, `node:path`, `node:child_process` and `process` calls, which is
  // what those APIs look like when `@types/node` is missing and nothing else is wrong.
  //
  // `src/host/node.ts` declares that surface and every other file reaches Node through it,
  // so the same run is clean. This reproduces the condition exactly: a copy of `src` linted
  // against a tsconfig with `types: []`, which is what removes the ambient Node types. The
  // copy lives inside the repository so the repository's config applies to it; a file that
  // goes back to importing a Node module directly brings the warnings back, which is what
  // makes this a test rather than a note.
  const dir = fs.mkdtempSync(path.join(repoRoot, ".review-env-"));
  try {
    fs.cpSync(path.join(repoRoot, "src"), path.join(dir, "src"), { recursive: true });
    fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            baseUrl: ".",
            module: "ESNext",
            target: "ES2020",
            moduleResolution: "node",
            strict: true,
            skipLibCheck: true,
            noImplicitAny: true,
            // The whole point: no ambient `@types/node`.
            types: [],
            lib: ["DOM", "ES2020"],
          },
          include: ["src/**/*.ts"],
        },
        null,
        2
      )
    );

    const findings = lintFindings(path.join(path.basename(dir), "src"));
    const missingTypes = findings.filter(
      (f) => f.includes("no-unsafe-") || f.includes("no-redundant-type-constituents")
    );
    assert.deepEqual(
      missingTypes,
      [],
      `${missingTypes.length} findings that only exist where @types/node is absent:\n  ${missingTypes.join("\n  ")}`
    );

    // The known list is the same list there — the two families this plugin has decided to
    // carry as the price of supporting Obsidian 1.11.4 — so the clean result above is not
    // "the linter stopped looking".
    const errors = findings.filter((f) => f.includes(" sev2 "));
    assert.deepEqual(errors, [], `errors without @types/node:\n  ${errors.join("\n  ")}`);
    const unknown = findings.filter((f) => f.includes(" sev1 ") && !knownWarning(f));
    assert.deepEqual(unknown, [], `unexpected warnings without @types/node:\n  ${unknown.join("\n  ")}`);
    assert.ok(findings.length >= 10, `the copy was really linted (${findings.length} findings)`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** The two warning families this plugin carries deliberately (see `eslint.config.mjs`). */
function knownWarning(line) {
  return (
    line.includes("@typescript-eslint/no-deprecated") ||
    line.includes("obsidianmd/settings-tab/prefer-setting-definitions")
  );
}

/**
 * Run stylelint over `code` and return its findings as text lines.
 *
 * Over stdin the report goes to STDERR, not stdout: stdout is where `--fix` writes the
 * corrected CSS, so it stays empty unless a fix was asked for. Both streams are read and
 * the JSON is taken from whichever carried it, because the exit code cannot be used to
 * decide -- a stylesheet with findings is a normal result here, not a crash.
 */
function cssFindings(code) {
  const run = spawnSync(stylelint, ["--stdin", "--stdin-filename", "styles.css", "-f", "json"], {
    cwd: repoRoot,
    encoding: "utf8",
    input: code,
  });
  assert.equal(run.error, undefined, `stylelint did not run: ${run.error}`);
  const out = `${run.stderr ?? ""}${run.stdout ?? ""}`;
  const at = out.indexOf("[");
  assert.notEqual(at, -1, `stylelint reported nothing (status ${run.status}):\n${out}`);
  const files = JSON.parse(out.slice(at));
  return files.flatMap((f) =>
    f.warnings.map((w) => `${path.relative(repoRoot, f.source)}:${w.line}:${w.column} ${w.rule} ${w.text}`)
  );
}

test("the stylesheet passes the review's CSS checks", { skip: !fs.existsSync(stylelint) && "stylelint is not installed" }, () => {
  const findings = cssFindings(fs.readFileSync(path.join(repoRoot, "styles.css"), "utf8"));
  assert.deepEqual(findings, [], `${findings.length} stylesheet findings:\n  ${findings.join("\n  ")}`);
});

// A gate that cannot fail is worse than no gate, because it reads as coverage. These two
// constructs are the ones this stylesheet has actually been pulled up on, so they are the
// ones checked here: `:has()` for broad invalidation, and the row wrappers that were laid
// out with `display: contents`.
test("the CSS gate still rejects what the review rejects", { skip: !fs.existsSync(stylelint) && "stylelint is not installed" }, () => {
  const has = cssFindings(".modelica-studio-x:has(> .modelica-studio-y) { color: var(--text-normal); }");
  assert.ok(
    has.some((f) => f.includes("selector-pseudo-class-disallowed-list")),
    `a :has() selector is reported:\n  ${has.join("\n  ")}`
  );

  const contents = cssFindings(".modelica-studio-x { display: contents; }");
  assert.ok(
    contents.some((f) => f.includes("plugin/no-unsupported-browser-features")),
    `display: contents is reported:\n  ${contents.join("\n  ")}`
  );

  // And a rule that is fine stays fine, so the gate is not simply failing everything.
  assert.deepEqual(cssFindings(".modelica-studio-x { display: grid; }"), []);
});
