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

const { DOMAINS, DOMAIN_INFO, domainInfo, domainOfPackage, domainOfLabel, domainAttributes } =
  await import(path.join(buildLibs("domains", ["src/render/domains.ts"]), "domains.js"));
const theme = await import(
  path.join(buildLibs("domain-theme", ["src/render/theme.ts"]), "theme.js")
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
  // Media is a support package, not a physics: it holds fluid properties rather
  // than fluid models, and the library leaves it uncoloured. So does this.
  assert.equal(domainOfPackage("Modelica.Media.Air"), "other");
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
  // `attr`, not a bare key: Obsidian's helpers ignore anything they do not know.
  assert.deepEqual(domainAttributes("thermal"), {
    cls: "modelica-studio-domain",
    attr: { "data-domain": "thermal" },
  });
});

test("the palette and the examples actually use it", async () => {
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

  // Really rendered, not just present in the source. The path comes from the shared
  // placement: the notes are grouped into a folder per domain, so a literal path here is
  // a test that breaks the next time a note moves.
  const { buildPlacement } = await import(path.join(repoRoot, "showcase", "placement.mjs"));
  const { EXAMPLES } = await import(
    path.join(buildLibs("domains-ex", ["src/modelica/examples.ts"]), "examples.js")
  );
  const note = fs.readFileSync(
    path.join(repoRoot, "showcase", "notes", buildPlacement(EXAMPLES).pathOf("ResistorSelfHeating")),
    "utf8"
  );
  assert.match(
    note,
    /\*\*Domain:\*\* <span class="modelica-studio-domain" data-domain="multiphysics">/,
    `the newest note carries its colour: ${note.split("\n")[4]}`
  );
});

test("a rendered heading actually gets the colour", async () => {
  // The check that was missing. The previous version of this file asserted that
  // `domainAttributes` was SPREAD at the call site, that the CSS parsed, and that
  // both hex values cleared AA -- all of which passed while every group heading in
  // the palette rendered in the ordinary colour.
  //
  // The reason: Obsidian's element helpers read a fixed set of keys from their
  // options and ignore the rest, so a bare `"data-domain"` key was dropped and
  // `.modelica-studio-domain[data-domain="..."]` matched nothing. Only rendering it
  // and asking the browser what colour came out can tell the difference.
  const { runInDom, DOM_PREAMBLE } = await import("./helpers/dom-runner.mjs");
  const R = repoRoot;
  // Passed in from here rather than read in the page: the runner aliases the Node
  // builtins to an empty module for the browser bundle, so `fs` is not `fs` there.
  const css = JSON.stringify(fs.readFileSync(path.join(R, "styles.css"), "utf8"));
  const out = runInDom(
    [
      DOM_PREAMBLE,
      `import { domainAttributes, DOMAINS } from "${R}/src/render/domains";`,
      `import { StubVault } from "${R}/test/helpers/obsidian-stub";`,
      "",
      "// The plugin's own stylesheet, exactly as it ships.",
      "const style = document.createElement('style');",
      `style.textContent = ${css};`,
      "document.head.appendChild(style);",
      "",
      "// The palette's group heading, as the view builds it: a div whose colour is",
      "// the muted text colour, containing a span that should override it.",
      "function heading(domain, label, dark) {",
      "  document.body.className = dark ? 'theme-dark' : 'theme-light';",
      "  const host = document.body.createDiv({ cls: 'modelica-studio-palette-group-head' });",
      "  host.style.color = 'rgb(120, 120, 120)';",
      "  const span = host.createSpan({ ...domainAttributes(domain), text: label });",
      "  return { host, span };",
      "}",
      "",
      "window.test('the attribute survives the element helper', () => {",
      "  const { span } = heading('blocks', 'MODELICA.BLOCKS', false);",
      "  return 'data-domain=' + span.getAttribute('data-domain') +",
      "    ' class=' + span.classList.contains('modelica-studio-domain');",
      "});",
      "window.test('the CSS selector matches the rendered element', () => {",
      "  const { span } = heading('thermal', 'MODELICA.THERMAL', false);",
      "  return String(span.matches('.modelica-studio-domain[data-domain=\"thermal\"]'));",
      "});",
      "window.test('light mode colours it, and differently from its parent', () => {",
      "  const { host, span } = heading('blocks', 'MODELICA.BLOCKS', false);",
      "  const own = getComputedStyle(span).color;",
      "  return own + ' vs parent ' + getComputedStyle(host).color;",
      "});",
      "window.test('dark mode uses the dark value', () => {",
      "  const { span } = heading('blocks', 'MODELICA.BLOCKS', true);",
      "  return getComputedStyle(span).color;",
      "});",
      "window.test('every domain renders in a colour of its own', () => {",
      "  const seen = {};",
      "  const clashes = [];",
      "  for (const d of DOMAINS) {",
      "    const { span } = heading(d, d, false);",
      "    const c = getComputedStyle(span).color;",
      "    if (c === 'rgb(120, 120, 120)') clashes.push(d + ' kept the parent colour');",
      "    if (seen[c]) clashes.push(d + ' same as ' + seen[c]);",
      "    seen[c] = d;",
      "  }",
      "  return clashes.length ? clashes.join('; ') : Object.keys(seen).length + ' distinct colours';",
      "});",
      "window.finish();",
    ].join("\n")
  );
  if (out.skip) return;
  assert.ok(!out.fatal, out.fatal);
  assert.deepEqual(out.errors, [], "no page errors");
  for (const r of out.results) assert.ok(r.ok, `${r.name}: ${r.error ?? ""}`);
  const d = Object.fromEntries(out.results.map((r) => [r.name, r.detail]));

  assert.equal(
    d["the attribute survives the element helper"],
    "data-domain=blocks class=true",
    "the element helper must apply `attr`, not silently drop it"
  );
  assert.equal(d["the CSS selector matches the rendered element"], "true");

  // The proof: a colour computed by the browser, different from the parent's.
  assert.notEqual(
    d["light mode colours it, and differently from its parent"].split(" vs parent ")[0],
    "rgb(120, 120, 120)",
    `light mode must override the parent colour, got ${d["light mode colours it, and differently from its parent"]}`
  );
  assert.notEqual(
    d["dark mode uses the dark value"],
    "rgb(120, 120, 120)",
    "and so must dark mode"
  );
  assert.notEqual(
    d["dark mode uses the dark value"],
    d["light mode colours it, and differently from its parent"].split(" vs parent ")[0],
    "the two themes must not use the same value"
  );
  assert.equal(
    d["every domain renders in a colour of its own"],
    `${DOMAINS.length} distinct colours`
  );
});

test("the code is the library's, not one invented here", () => {
  // `Modelica.UsersGuide.Conventions.Icons` publishes a colour per domain. The
  // point of this module is to USE that convention, so a reader who knows the
  // library recognises the colours -- magnetic is orange because the library says
  // orange, not violet because violet looked nice.
  // Every domain in the legend, and nothing else.
  assert.equal(DOMAIN_INFO.length, DOMAINS.length);
  for (const d of DOMAINS) assert.ok(domainInfo(d), `${d} must appear in the legend`);

  // The codes are quoted from the library, so they are the library's values.
  const expected = {
    electrical: "rgb(0, 0, 255)",
    mechanical: "rgb(95, 95, 95)",
    fluid: "rgb(0, 127, 255)",
    thermal: "rgb(191, 0, 0)",
    magnetic: "rgb(255, 127, 0)",
    blocks: "rgb(0, 0, 127)",
    discrete: "rgb(0, 0, 0)",
  };
  for (const [domain, code] of Object.entries(expected)) {
    assert.equal(domainInfo(domain).msl, code, `${domain} must quote the library's code`);
  }
  // The three the library does not name say so rather than inventing a code.
  assert.equal(domainInfo("aerospace").msl, null);
  assert.equal(domainInfo("multiphysics").msl, null);
  assert.equal(domainInfo("other").msl, null);

  // And where the library's own value is already readable as text, it is used
  // UNCHANGED -- that is what makes this the library's code rather than a
  // lookalike. Light mode only: the dark values have to be lighter to be seen.
  const { light } = coloursFromCss();
  const keptExactly = { electrical: "#0000ff", thermal: "#bf0000", blocks: "#00007f" };
  for (const [domain, hex] of Object.entries(keptExactly)) {
    assert.equal(light[domain], hex, `${domain} should keep the library's value exactly`);
  }
});

test("no two domains are close enough to be confused", () => {
  // Contrast against the background is not enough on its own: two colours can
  // both be readable and still indistinguishable from each other, which makes the
  // code useless as a code. Mechanics and StateGraph are both greyscale in the
  // library -- {95,95,95} and {0,0,0} -- so lightness has to carry that
  // difference, and this is the check that it actually does.
  const { light, dark } = coloursFromCss();
  const distance = (a, b) => {
    const p = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i + 1, i + 3), 16));
    const [x, y] = [p(a), p(b)];
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  };
  // 30 out of a possible 441 is a clearly visible difference; a collision like
  // mechanical #8b8b8b against discrete #8a8a8a scores under 2.
  const MIN = 30;
  const tooClose = [];
  for (let i = 0; i < DOMAINS.length; i++) {
    for (let j = i + 1; j < DOMAINS.length; j++) {
      for (const [mode, set] of [["light", light], ["dark", dark]]) {
        const d = distance(set[DOMAINS[i]], set[DOMAINS[j]]);
        if (d < MIN) {
          tooClose.push(`${mode}: ${DOMAINS[i]} ${set[DOMAINS[i]]} vs ${DOMAINS[j]} ${set[DOMAINS[j]]} = ${d.toFixed(0)}`);
        }
      }
    }
  }
  assert.deepEqual(tooClose, [], `colours too close to tell apart:\n  ${tooClose.join("\n  ")}`);
});

/**
 * A wire is coloured by its connector's own icon, so the palette a diagram is
 * read through is the LIBRARY's, not this plugin's: `{0,0,255}` electrical,
 * `{191,0,0}` thermal, `{0,0,127}` blocks, `{95,95,95}` multibody frames, and
 * black where a connector names no line colour at all.
 *
 * Those values were chosen to fill a white icon, and a wire is a thin line on a
 * canvas — so they are measured here the same way the domain colours above are.
 * It matters: before the wire path had its own floor, five of the eight sat
 * between 1.0:1 and 2.5:1 against the dark canvas, which is a wire you cannot
 * follow.
 */
test("a wire's colour is legible on the canvas it is drawn on", () => {
  const LIGHT_CANVAS = [250, 251, 253];
  const DARK_CANVAS = [30, 33, 39];
  const themes = {
    light: { dark: false, ink: [0, 0, 0], paper: LIGHT_CANVAS, minInkLuminance: 0, fillLuminanceCap: 0, fillBlend: 0 },
    dark: { dark: true, ink: [235, 238, 245], paper: DARK_CANVAS, minInkLuminance: 0.145, fillLuminanceCap: 0.5, fillBlend: 0.45 },
  };
  const hexOf = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  // Every colour MSL 4.1.0 uses for a connector's line, plus the default black.
  const used = {
    "electrical {0,0,255}": [0, 0, 255],
    "thermal {191,0,0}": [191, 0, 0],
    "fluid {0,127,255}": [0, 127, 255],
    "magnetic {255,127,0}": [255, 127, 0],
    "blocks {0,0,127}": [0, 0, 127],
    "bus {255,204,51}": [255, 204, 51],
    "multibody {95,95,95}": [95, 95, 95],
    "no line colour": [0, 0, 0],
  };

  const failures = [];
  for (const [name, colour] of Object.entries(used)) {
    for (const [which, t] of Object.entries(themes)) {
      const wire = theme.wireColorFor(colour, t);
      const canvas = which === "light" ? LIGHT_CANVAS : DARK_CANVAS;
      const ratio = contrast(hexOf(wire), hexOf(canvas));
      // 3:1 is the WCAG threshold for a graphical object, which a line is; 4.5:1
      // is for text.
      if (ratio < 3) failures.push(`${name} on ${which} = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], "every wire colour clears 3:1 on both canvases");

  // And the ICONS keep the library's own greys: the wire floor is not applied to
  // them, because there a grey is shading rather than a line to follow.
  // Lifted just past the floor, and no further: a wire stays as close to the
  // library's own colour as legibility allows.
  const lifted = theme.wireColorFor([95, 95, 95], themes.dark);
  // The blend moves in steps of 5%, so it clears the floor by a little rather
  // than landing on it exactly — and no further, which is the point.
  const liftedRatio = contrast(hexOf(lifted), hexOf(DARK_CANVAS));
  assert.ok(
    liftedRatio >= 3 && liftedRatio < 3.8,
    `the multibody grey is lifted just past the floor, got ${liftedRatio.toFixed(2)}:1`
  );
  assert.ok(lifted[0] > 95 && lifted[0] < 140, `and stays a grey, got rgb(${lifted.join(",")})`);
  assert.deepEqual(
    theme.themedColor([95, 95, 95], themes.dark, "stroke"),
    [95, 95, 95],
    "while an icon's stroke is left exactly as the library asked"
  );
  // Black is the one that must change most: a black wire on a dark canvas is
  // 1.3:1, which is why the language's default is drawn as ink.
  assert.deepEqual(theme.wireColorFor([0, 0, 0], themes.dark), [235, 238, 245]);
});
