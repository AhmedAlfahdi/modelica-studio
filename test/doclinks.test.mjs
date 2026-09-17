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
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";

const { docPageFor, docUrlFor, libraryVersionFrom, libraryHelpUrl } = await import(
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
