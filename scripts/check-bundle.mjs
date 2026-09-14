#!/usr/bin/env node
/**
 * Release-build gate.
 *
 * Obsidian's plugin installer fetches exactly three files from a GitHub
 * release: manifest.json, main.js and styles.css. Anything else — a .wasm
 * binary, a .node addon, an extra chunk emitted by code splitting — is never
 * downloaded, so the plugin would appear to install correctly and then fail at
 * runtime only for users who installed it from the store.
 *
 * This script fails the build if that could happen, and reports the size the
 * user will actually download.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DISTRIBUTED = ["manifest.json", "main.js", "styles.css"];

/** Obsidian Sync caps plugin bundles around 5 MB; stay well inside that. */
const MAX_MAIN_JS = 5 * 1024 * 1024;
/** Warn early — a large bundle is re-downloaded on every update. */
const WARN_MAIN_JS = 1.5 * 1024 * 1024;

const errors = [];
const warnings = [];

/* ---- required files ---- */

for (const f of DISTRIBUTED) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) {
    if (f === "styles.css") {
      warnings.push("styles.css is missing (optional, but the UI will be unstyled).");
    } else {
      errors.push(`Required release file is missing: ${f}`);
    }
  }
}

/* ---- manifest sanity ---- */

const manifestPath = path.join(ROOT, "manifest.json");
if (fs.existsSync(manifestPath)) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (e) {
    errors.push(`manifest.json is not valid JSON: ${e.message}`);
  }
  if (manifest) {
    for (const key of ["id", "name", "version", "minAppVersion", "description", "author"]) {
      if (!manifest[key]) errors.push(`manifest.json is missing required field: ${key}`);
    }
    if (manifest.version && !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
      errors.push(`manifest.json version must be x.y.z, got "${manifest.version}"`);
    }
    if (manifest.id && /[A-Z]/.test(manifest.id)) {
      errors.push(`manifest.json id must be lowercase: "${manifest.id}"`);
    }
    if (manifest.description && manifest.description.length > 250) {
      errors.push(`manifest.json description exceeds 250 characters (${manifest.description.length})`);
    }
    // This plugin spawns a process and reads files, so it must declare itself
    // desktop-only or it will be installed on mobile and crash.
    if (manifest.isDesktopOnly !== true) {
      errors.push(
        "manifest.json must set isDesktopOnly: true — the plugin spawns the " +
          "OpenModelica compiler and uses Node APIs unavailable on mobile."
      );
    }
  }
}

/* ---- bundle inspection ---- */

const mainPath = path.join(ROOT, "main.js");
if (fs.existsSync(mainPath)) {
  const src = fs.readFileSync(mainPath, "utf8");
  const bytes = Buffer.byteLength(src, "utf8");

  if (bytes > MAX_MAIN_JS) {
    errors.push(
      `main.js is ${mb(bytes)}, above the ${mb(MAX_MAIN_JS)} limit Obsidian Sync tolerates.`
    );
  } else if (bytes > WARN_MAIN_JS) {
    warnings.push(
      `main.js is ${mb(bytes)}; every user re-downloads this on each update. ` +
        "Consider trimming dependencies."
    );
  }

  // The bundle must be CommonJS with a default export, as Obsidian requires.
  if (!/\bmodule\.exports\b/.test(src) && !/\bexports\.default\b/.test(src)) {
    errors.push("main.js does not look like a CommonJS bundle (no module.exports found).");
  }

  // Inline sourcemaps would balloon the file for no user benefit.
  if (/sourceMappingURL=data:application\/json/.test(src)) {
    errors.push("main.js contains an inline sourcemap; build with sourcemap: false for release.");
  }

  // A dynamic require of a sibling file cannot work after store installation.
  const dynamicRequire = /require\(\s*["'`]\.\//g;
  const hits = [...src.matchAll(dynamicRequire)];
  if (hits.length > 0) {
    errors.push(
      `main.js performs ${hits.length} relative require() call(s). Obsidian installs only ` +
        "main.js, so any file it expects beside it will be absent. Bundle the module instead."
    );
  }

  // External binary assets cannot be shipped.
  for (const ext of [".wasm", ".node", ".dll", ".so", ".dylib"]) {
    const re = new RegExp(`["'\`][^"'\`]*\\${ext}["'\`]`, "g");
    if (re.test(src)) {
      errors.push(
        `main.js references a "${ext}" file. Obsidian never distributes extra release ` +
          "assets, so this would fail for every store install. Inline it instead."
      );
    }
  }
}

/* ---- stray build artefacts that would confuse a release ---- */

for (const stray of ["main.js.map", "data.json"]) {
  if (fs.existsSync(path.join(ROOT, stray))) {
    warnings.push(`${stray} exists; it is not distributed and should not be committed for release.`);
  }
}

/* ---- report ---- */

function mb(n) {
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const mainBytes = fs.existsSync(mainPath) ? Buffer.byteLength(fs.readFileSync(mainPath, "utf8")) : 0;
console.log("Modelica Studio — release check");
console.log(`  main.js    ${mainBytes.toLocaleString()} bytes (${mb(mainBytes)})`);
for (const f of DISTRIBUTED) {
  if (f === "main.js") continue;
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) {
    console.log(`  ${f.padEnd(10)} ${fs.statSync(p).size.toLocaleString()} bytes`);
  }
}

for (const w of warnings) console.log(`  WARN  ${w}`);

if (errors.length > 0) {
  console.error("\nRelease check FAILED:");
  for (const e of errors) console.error(`  ERROR ${e}`);
  process.exit(1);
}

console.log("\nRelease check passed.");
