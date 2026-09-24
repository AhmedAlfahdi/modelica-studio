/**
 * Compile every Modelica model in a folder, and say which ones fail.
 *
 * Built for working through a vault one file at a time: `omc` reports the first error it
 * finds and stops, so a model with two mistakes needs two rounds — this does the rounds
 * for you and prints the error line each time, with the file and column `omc` gave.
 *
 *     node scripts/check-models.mjs ~/modelica-vault/Modelica
 *     node scripts/check-models.mjs ~/modelica-vault/Modelica --verbose
 *
 * Files are checked ONE AT A TIME in a fresh `omc` process: loading them together lets
 * two models that share a class name shadow each other, which reads as an error in the
 * wrong file.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dir = process.argv[2];
const verbose = process.argv.includes("--verbose");
if (!dir) {
  console.error("usage: node scripts/check-models.mjs <folder> [--verbose]");
  process.exit(2);
}
const omc = ["/usr/bin/omc", "/usr/local/bin/omc"].find((p) => fs.existsSync(p));
if (!omc) {
  console.error("no omc on this machine");
  process.exit(2);
}

const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".mo"))
  .sort();
if (files.length === 0) {
  console.error(`no .mo files in ${dir}`);
  process.exit(2);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "check-models-"));
const failures = [];
for (const file of files) {
  const name = path.basename(file, ".mo");
  const script = path.join(work, `${name}.mos`);
  fs.writeFileSync(
    script,
    `loadFile("${path.join(dir, file)}"); getErrorString();\ncheckModel(${name}); getErrorString();\n`
  );
  let out = "";
  try {
    out = execFileSync(omc, [script], { encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    out = String(err.stdout ?? "") + String(err.stderr ?? "");
  }
  if (/completed successfully/.test(out)) {
    console.log(`ok    ${name}`);
    continue;
  }
  // The first thing omc says is not always the useful thing: a load failure reads as a
  // missing class, so the error lines are what get reported.
  const errors = out
    .split("\n")
    .filter((line) => /error/i.test(line))
    .slice(0, verbose ? 6 : 2);
  failures.push({ name, errors });
  console.log(`FAIL  ${name}`);
  for (const line of errors) console.log(`        ${line.trim()}`);
}
fs.rmSync(work, { recursive: true, force: true });

console.log(`\n${files.length - failures.length} of ${files.length} compile`);
if (failures.length > 0) {
  console.log("fix these, then run it again — a fix often reveals the next error in the same file");
  process.exit(1);
}
