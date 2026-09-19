/**
 * The domain colour code.
 *
 * Modelica is organised by physics, and the palette, the Examples menu and the
 * example notes all already name those domains. This gives them one colour each,
 * from one definition in `styles.css`, so a domain looks the same wherever it
 * appears.
 *
 * The requirement was explicit: "be mindful that the colors are well readable for
 * both light and dark mode". Readable is measurable — the WCAG contrast ratio —
 * so it is measured here rather than asserted, against both theme backgrounds.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildLibs, repoRoot } from "./helpers/build.mjs";

const { DOMAINS, domainOfPackage, domainOfLabel, domainAttributes } = await import(
  path.join(buildLibs("domains", ["src/render/domains.ts"]), "domains.js")
);

/** Obsidian's own `--background-secondary`, which is what these sit on. */
const LIGHT_BG = "#f2f3f5";
const DARK_BG = "#161616";

/** WCAG relative luminance. */
function luminance(hex) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two colours. */
function contrast(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The pairs defined in the stylesheet, per domain. */
function coloursFromCss() {
  const css = fs.readFileSync(path.join(repoRoot, "styles.css"), "utf8");
  const light = {};
  const dark = {};
  // Anchored to the start of a line, so the DARK rules -- which contain the same
  // selector after `.theme-dark ` -- cannot overwrite the light values. They did,
  // and the result looked like every domain failing its contrast check.
  for (const m of css.matchAll(
    /^\.modelica-studio-domain\[data-domain="([a-z]+)"\]\s*\{\s*color:\s*(#[0-9a-f]{6})/gm
  )) {
    light[m[1]] = m[2];
  }
  for (const m of css.matchAll(
    /\.theme-dark \.modelica-studio-domain\[data-domain="([a-z]+)"\]\s*\{\s*color:\s*(#[0-9a-f]{6})/g
  )) {
    dark[m[1]] = m[2];
  }
  return { light, dark };
}

test("every domain has a colour in both themes", () => {
  // A domain without a rule renders in the default colour, which is not a colour
  // code — and would be invisible as a mistake.
  const { light, dark } = coloursFromCss();
  for (const domain of DOMAINS) {
    assert.ok(light[domain], `${domain} needs a light-mode colour`);
    assert.ok(dark[domain], `${domain} needs a dark-mode colour`);
  }
  // And no rule for a domain that does not exist, which would be dead CSS.
  for (const key of Object.keys(light)) {
    assert.ok(DOMAINS.includes(key), `styles.css colours an unknown domain: ${key}`);
  }
});

test("every colour is readable as text on both themes", () => {
  // AA for body text is 4.5:1. These are headings and labels rather than body
  // copy, so AA is the right bar rather than AAA -- but a colour that fails it is
  // one a reader has to strain for, which is what the requirement was about.
  const { light, dark } = coloursFromCss();
  const failures = [];
  for (const domain of DOMAINS) {
    const onLight = contrast(light[domain], LIGHT_BG);
    const onDark = contrast(dark[domain], DARK_BG);
    if (onLight < 4.5) {
      failures.push(`${domain} light ${light[domain]} is ${onLight.toFixed(2)}:1 on ${LIGHT_BG}`);
    }
    if (onDark < 4.5) {
      failures.push(`${domain} dark ${dark[domain]} is ${onDark.toFixed(2)}:1 on ${DARK_BG}`);
    }
  }
  assert.deepEqual(failures, [], `colours below AA:\n  ${failures.join("\n  ")}`);
});

test("the colours are distinguishable from each other", () => {
  // A code where two domains share a colour is not a code. Mechanical and Other
  // are deliberately close -- both are structural rather than physical -- but not
  // identical, and no other pair may collide in both themes.
  const { light, dark } = coloursFromCss();
  const problems = [];
  for (let i = 0; i < DOMAINS.length; i++) {
    for (let j = i + 1; j < DOMAINS.length; j++) {
      const a = DOMAINS[i];
      const b = DOMAINS[j];
      if (light[a] === light[b]) problems.push(`${a} and ${b} share ${light[a]} in light mode`);
      if (dark[a] === dark[b]) problems.push(`${a} and ${b} share ${dark[a]} in dark mode`);
    }
  }
  assert.deepEqual(problems, [], problems.join("; "));

  // And each mode's set is internally consistent: light colours must be dark
  // enough, dark colours light enough, or the pair is the wrong way round.
  for (const domain of DOMAINS) {
    assert.ok(
      luminance(light[domain]) < luminance(dark[domain]),
      `${domain}: the dark-mode colour must be the lighter of the two`
    );
  }
});

test("the mapping reads the vocabulary that is already there", () => {
  // The palette's groups are library packages; the Examples menu groups by the
  // domain named in each description. Both vocabularies already exist, so this
  // reads them rather than introducing a third.
  assert.equal(domainOfPackage("Modelica.Electrical.Analog"), "electrical");
  assert.equal(domainOfPackage("Modelica.Mechanics.Rotational"), "mechanical");
  assert.equal(domainOfPackage("Modelica.Mechanics.Translational"), "mechanical");
  assert.equal(domainOfPackage("Modelica.Thermal.HeatTransfer"), "thermal");
  assert.equal(domainOfPackage("Modelica.Fluid.Pipes"), "fluid");
  assert.equal(domainOfPackage("Modelica.Magnetic.FluxTubes"), "magnetic");
  assert.equal(domainOfPackage("Modelica.Blocks.Math"), "blocks");
  assert.equal(domainOfPackage("Modelica.Media.Air"), "media");
  assert.equal(domainOfPackage("Modelica.StateGraph"), "discrete");
  // No physics at all: services, icons and the obsolete tree.
  assert.equal(domainOfPackage("ModelicaServices"), "other");
  assert.equal(domainOfPackage("ObsoleteModelica4.Mechanics"), "other");
  assert.equal(domainOfPackage("Modelica.Icons"), "other");

  assert.equal(domainOfLabel("Electrical"), "electrical");
  assert.equal(domainOfLabel("Mechanical"), "mechanical");
  assert.equal(domainOfLabel("Thermal"), "thermal");
  assert.equal(domainOfLabel("Fluid"), "fluid");
  assert.equal(domainOfLabel("Aerospace"), "aerospace");
  assert.equal(domainOfLabel("Multiphysics"), "multiphysics");
  assert.equal(domainOfLabel("Control"), "blocks");
  // An unknown label must not throw: a new example with a new domain should be
  // colourless, not broken.
  assert.equal(domainOfLabel("Something New"), "other");

  // The attributes are what both the plugin and a generated note use.
  assert.deepEqual(domainAttributes("thermal"), {
    cls: "modelica-studio-domain",
    "data-domain": "thermal",
  });
});

test("the palette and the examples actually use it", () => {
  // A mapping nothing applies is not a colour code.
  const view = fs.readFileSync(path.join(repoRoot, "src/view/studio-view.ts"), "utf8");
  assert.match(
    view,
    /head\.createSpan\(\{\s*\.\.\.domainAttributes\(domainOfPackage\(root\)\)/,
    "the palette's package heading is coloured"
  );
  assert.match(
    view,
    /\.\.\.domainAttributes\(dom\), text: domain/,
    "the Examples menu's domain heading is coloured"
  );

  // And the notes, through the same class, so one definition covers both.
  const generate = fs.readFileSync(path.join(repoRoot, "showcase/generate.mjs"), "utf8");
  assert.match(generate, /domainOfLabel/, "the generator uses the same mapping");
  assert.match(
    generate,
    /class="modelica-studio-domain" data-domain="\$\{domainOfLabel\(note\.domain\)\}"/,
    "a note's Domain line is coloured"
  );

  // Really rendered, not just present in the source.
  const note = fs.readFileSync(
    path.join(repoRoot, "showcase/notes/resistor-self-heating.md"),
    "utf8"
  );
  assert.match(
    note,
    /\*\*Domain:\*\* <span class="modelica-studio-domain" data-domain="multiphysics">/,
    `the newest note carries its colour: ${note.split("\n")[4]}`
  );
});
