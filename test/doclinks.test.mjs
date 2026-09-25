/**
 * Documentation links.
 *
 * Worth testing because the natural URL is wrong. `.../Modelica.Electrical.Analog
 * .Basic.Resistor.html` is what anyone would write, and it 404s: the MSL
 * documentation is one page per PACKAGE with an anchor per class. Every case
 * below was checked against the live site before the rule was written down.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildLibs, repoRoot } from "./helpers/build.mjs";

const { docPageFor, docUrlFor, libraryVersionFrom, libraryHelpUrl, libraryIconsUrl, PUBLISHED_VERSIONS, WSM_VERSIONS, WSM_FALLBACK_VERSION } = await import(
  path.join(buildLibs("doclinks", ["src/modelica/doclinks.ts"]), "doclinks.js")
);

test("a class maps to its PACKAGE page plus an anchor", () => {
  // The package file is the class's package with dots as underscores, and the
  // class itself is the anchor inside it.
  assert.deepEqual(docPageFor("Modelica.Electrical.Analog.Basic.Resistor"), {
    file: "Modelica_Electrical_Analog_Basic.html",
    anchor: "Modelica.Electrical.Analog.Basic.Resistor",
  });
  assert.deepEqual(docPageFor("Modelica.Fluid.Machines.Pump"), {
    file: "Modelica_Fluid_Machines.html",
    anchor: "Modelica.Fluid.Machines.Pump",
  });
  // The root class and its immediate children share a page.
  assert.deepEqual(docPageFor("Modelica.Blocks.Continuous.PID"), {
    file: "Modelica_Blocks_Continuous.html",
    anchor: "Modelica.Blocks.Continuous.PID",
  });
});

test("a class with no package page has no link", () => {
  // `Modelica.Blocks` is its own page, with nothing to shorten to, and a link
  // that 404s is worse than no link.
  assert.equal(docPageFor("Modelica.Blocks"), null);
  assert.equal(docPageFor("Modelica"), null);
  // And a user's own class is not in the MSL at all.
  assert.equal(docPageFor("MyModel"), null);
  assert.equal(docPageFor("ModelicaServices.Machine"), null);
  assert.equal(docUrlFor("MyModel"), null);
});

test("the URL is the one the site actually serves", () => {
  const url = docUrlFor("Modelica.Electrical.Analog.Basic.Resistor");
  assert.equal(
    url,
    "https://doc.modelica.org/Modelica%204.1.0/Resources/helpDymola/" +
      "Modelica_Electrical_Analog_Basic.html#Modelica.Electrical.Analog.Basic.Resistor"
  );
  // The space in the tree name is encoded; the anchor's dots are not.
  assert.match(url, /Modelica%204\.1\.0/);
  assert.ok(!url.includes(" "), "no raw space");
  assert.match(url, /#Modelica\.Electrical\.Analog\.Basic\.Resistor$/);
});

test("the version comes from the installed library, not a constant", () => {
  // A tree for a version that is not installed documents classes that do not
  // match the ones in the palette.
  assert.equal(libraryVersionFrom(["Modelica 4.1.0"]), "4.1.0");
  assert.equal(libraryVersionFrom(["Modelica 4.0.0", "ModelicaServices 4.1.0"]), "4.0.0");
  // Build metadata is stripped: no published tree carries it.
  assert.equal(libraryVersionFrom(["Modelica 3.2.3+maint.om"]), "3.2.3");
  // Nothing to read: the current release is a better guess than nothing.
  assert.equal(libraryVersionFrom([]), "4.1.0");
  assert.equal(libraryVersionFrom(undefined), "4.1.0");
  // A root that is not the Modelica library is skipped rather than misparsed.
  assert.equal(libraryVersionFrom(["ModelicaServices 4.1.0"]), "4.1.0");

  assert.match(docUrlFor("Modelica.Fluid.Machines.Pump", "4.0.0"), /Modelica%204\.0\.0/);
});

test("the library entry page is its own URL", () => {
  // Separate from docUrlFor, which needs a class deep enough to have a package
  // page: this is the root a general "documentation" link opens.
  assert.equal(
    libraryHelpUrl("4.1.0"),
    "https://doc.modelica.org/Modelica%204.1.0/Resources/helpDymola/Modelica.html"
  );
});

test("the version is normalised to a tree the site publishes", () => {
  // The installed directory is often named with build metadata -- the local copy
  // is "Modelica 4.1.0+maint.om" -- and passing that through produced
  // /Modelica%204.1.0%2Bmaint.om/..., which is a 404. Checked against the live
  // site. A link that 404s is worse than a link to the current release.
  assert.equal(libraryVersionFrom(["Modelica 4.1.0+maint.om"]), "4.1.0");
  assert.equal(libraryVersionFrom(["Modelica 4.1.0"]), "4.1.0");
  assert.equal(libraryVersionFrom(["Modelica 3.2.3+maint.om"]), "3.2.3");
  assert.equal(libraryVersionFrom(["Modelica 4.0.0"]), "4.0.0");
  // A version with no published tree falls back rather than 404ing.
  assert.equal(libraryVersionFrom(["Modelica 9.9.9"]), "4.1.0");
  assert.equal(libraryVersionFrom(["Modelica 2.2.2"]), "4.1.0");
  // And the URL it feeds contains no build metadata.
  const url = docUrlFor("Modelica.Mechanics.Rotational.Sources.Torque", libraryVersionFrom(["Modelica 4.1.0+maint.om"]));
  assert.ok(!/%2B|\+maint/.test(url), `no build metadata in ${url}`);
  assert.match(url, /Modelica%204\.1\.0\//);
});

test("the icon-conventions page links to a tree the site publishes", () => {
  // The library reference is generated four times over -- helpDymola, helpOM,
  // helpWSM, help -- and the four are not published for the same versions. The
  // conventions page exists only in the WSM tree, and there is NO 4.1.0 WSM tree:
  // Modelica%204.1.0/Resources/helpWSM/... answers 404 while the helpDymola tree
  // for the same version answers 200. Verified against the live site.
  const url = libraryIconsUrl();
  assert.equal(
    url,
    `https://doc.modelica.org/Modelica%20${WSM_FALLBACK_VERSION}/Resources/helpWSM/` +
      "Modelica/Modelica.UsersGuide.Conventions.Icons.html"
  );
  // The page it names is the one this plugin's colour table was read from.
  assert.match(url, /UsersGuide\.Conventions\.Icons\.html$/);
  assert.ok(!url.includes(" "), "no raw space");
});

test("no version produces the dead helpWSM URL", () => {
  // The regression: the link was written against the indexed library version by
  // hand, and the indexed library here is 4.1.0, which has no WSM tree.
  const dead = libraryIconsUrl("4.1.0");
  assert.ok(!dead.includes("Modelica%204.1.0"), `4.1.0 WSM tree is a 404: ${dead}`);

  // Every published version must land on a WSM tree that exists.
  for (const version of PUBLISHED_VERSIONS) {
    const produced = libraryIconsUrl(version);
    const named = decodeURIComponent(produced.split("/")[3]).replace("Modelica ", "");
    assert.ok(
      WSM_VERSIONS.has(named),
      `libraryIconsUrl(${version}) names ${named}, which has no WSM tree`
    );
  }
  // A version that does have one is kept rather than flattened to the fallback.
  assert.ok(libraryIconsUrl("3.2.3").includes("Modelica%203.2.3"));
  // Anything unknown -- including build metadata -- falls back.
  assert.equal(libraryIconsUrl("9.9.9"), libraryIconsUrl());
  assert.equal(libraryIconsUrl("4.1.0+maint.om"), libraryIconsUrl());
});

test("every URL it can produce begins with a literal from the source", () => {
  // The plugin directory's review reads the source for network endpoints, and warns
  // when one is assembled at runtime: a host built by splitting segments into an
  // array and joining them again is how malware keeps its endpoint out of a
  // scanner's list. This module is the only place in the plugin that appends to a
  // URL, so the assertion is here, and it is made against the endpoints rather than
  // the code: everything up to the page name -- scheme, host and the version segment
  // -- has to be a string the source spells out in full.
  const source = fs.readFileSync(path.join(repoRoot, "src/modelica/doclinks.ts"), "utf8");
  const produced = [];
  for (const version of PUBLISHED_VERSIONS) {
    produced.push(
      docUrlFor("Modelica.Blocks.Continuous.PID", version),
      libraryHelpUrl(version),
      libraryIconsUrl(version)
    );
  }
  assert.ok(produced.length >= 9, `every version and every page is measured (${produced.length})`);
  for (const url of produced) {
    const tree = url.slice(0, url.indexOf("/Resources/"));
    assert.ok(tree.startsWith("https://doc.modelica.org/"), `an absolute URL: ${url}`);
    assert.ok(source.includes(tree), `${tree} is written out in the source, not built from parts`);
  }
});
