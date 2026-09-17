/**
 * The library exclusion list as checkboxes.
 *
 * The stored form is a list of name PREFIXES, which is what makes both rules
 * here necessary: matching must stop at a segment boundary, and a library can be
 * excluded without its own name appearing anywhere.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildLibs } from "./helpers/build.mjs";

const { libraryRows, exclusionsFrom, isExcludedBy, parseExclusions } = await import(
  path.join(buildLibs("lib-excl", ["src/modelica/library-exclusions.ts"]), "library-exclusions.js")
);

test("matching stops at a segment boundary", () => {
  // The setting's own documentation promises this, and a plain startsWith would
  // break it: excluding Modelica.Electrical must not take Modelica.ElectricalExtra
  // with it.
  assert.equal(isExcludedBy("Modelica.Electrical.Analog", ["Modelica.Electrical"]), "Modelica.Electrical");
  assert.equal(isExcludedBy("Modelica.Electrical", ["Modelica.Electrical"]), "Modelica.Electrical");
  assert.equal(isExcludedBy("Modelica.ElectricalExtra", ["Modelica.Electrical"]), null);
  assert.equal(isExcludedBy("Modelica.ElectricalExtra.Basic", ["Modelica.Electrical"]), null);
  assert.equal(isExcludedBy("ModelicaServices", ["Modelica"]), null, "a prefix is not a substring");
  assert.equal(isExcludedBy("Modelica.Fluid", ["Modelica"]), "Modelica", "but a parent does cover it");
});

test("comments and blanks are not entries", () => {
  assert.deepEqual(parseExclusions("# a note\n\n  Modelica.Fluid  \n# another\n"), ["Modelica.Fluid"]);
  assert.equal(isExcludedBy("Modelica.Fluid", ["# Modelica.Fluid"]), null, "a commented entry excludes nothing");
});

test("a row is unchecked when an ancestor is excluded, and says which", () => {
  // The case a text area could not show at all: the library is left out without
  // its own name appearing in the list.
  const rows = libraryRows(["Modelica.Fluid", "Modelica.Electrical"], "Modelica");
  assert.ok(rows.every((r) => r.excluded), "both are out");
  assert.ok(rows.every((r) => r.excludedBy === "Modelica"), "and the reason is carried");
  // A row excluded by its own name carries no `excludedBy`, so the message can
  // tell "you excluded this" from "something above it did".
  const own = libraryRows(["Modelica.Fluid"], "Modelica.Fluid");
  assert.equal(own[0].excludedBy, undefined);
});

test("the Modelica sub-libraries come first and in order", () => {
  // A list that puts ObsoleteModelica4 above Fluid makes the common choice harder
  // to find than the setting already was.
  const rows = libraryRows(
    ["ObsoleteModelica4", "ModelicaServices", "Modelica.Thermal", "Modelica.Fluid", "Modelica.Blocks"],
    ""
  );
  assert.deepEqual(
    rows.map((r) => r.name),
    // Modelica sub-libraries first and sorted, then everything else, also sorted.
    ["Modelica.Blocks", "Modelica.Fluid", "Modelica.Thermal", "ModelicaServices", "ObsoleteModelica4"]
  );
  assert.equal(rows[0].label, "Blocks", "labelled without the Modelica prefix");
});

test("ticking writes entries, unticking removes them", () => {
  const rows = [
    { name: "Modelica.Fluid", excluded: true },
    { name: "Modelica.Media", excluded: false },
  ];
  assert.equal(exclusionsFrom(rows, ""), "Modelica.Fluid");
  assert.equal(
    exclusionsFrom(
      [
        { name: "Modelica.Fluid", excluded: false },
        { name: "Modelica.Media", excluded: true },
      ],
      "Modelica.Fluid"
    ),
    "Modelica.Media"
  );
});

test("a finer entry the checkboxes cannot express is preserved", () => {
  // The text area accepts sub-library names, which no top-level row represents.
  // Dropping them on the next tick would silently undo a deliberate setting.
  const rows = [
    { name: "Modelica.Fluid", excluded: false },
    { name: "Modelica.Media", excluded: false },
  ];
  const out = exclusionsFrom(rows, "Modelica.Fluid.Vessels\n# a note");
  assert.equal(out, "Modelica.Fluid.Vessels", "the sub-library survives, the comment does not");
});

test("a coarser entry is folded into the rows that represent it", () => {
  // `Modelica` covers both rows, so it is not kept as well -- otherwise the text
  // would grow an entry the checkboxes already express.
  const rows = [
    { name: "Modelica.Fluid", excluded: true },
    { name: "Modelica.Media", excluded: true },
  ];
  assert.equal(exclusionsFrom(rows, "Modelica"), "Modelica.Fluid\nModelica.Media");
});
