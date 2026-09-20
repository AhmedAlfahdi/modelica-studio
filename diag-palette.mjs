import path from "node:path";
import { buildLibs } from "./test/helpers/build.mjs";
const LIB = buildLibs("palette-diag", [
  "src/modelica/library.ts",
  "src/modelica/parser.ts",
  "src/modelica/types.ts",
  "src/modelica/fuzzy.ts",
]);
const { LibraryIndex } = await import(path.join(LIB, "library.js"));
const { fuzzyFilter } = await import(path.join(LIB, "fuzzy.js"));

const index = new LibraryIndex();
index.addDirectory("/home/para/.openmodelica/libraries");

const all = index.allNames();
const placeable = index.listPlaceable().map((c) => c.name);
console.log("classes in the index      :", all.length);
console.log("offered by the palette    :", placeable.length);

for (const q of ["force", "resistor", "rlc", "cvs"]) {
  const ranked = fuzzyFilter(all, q, 0);
  const substring = all.filter((n) => n.toLowerCase().includes(q.toLowerCase()));
  const shortName = all.filter((n) => n.split(".").pop().toLowerCase().includes(q.toLowerCase()));
  console.log(
    `"${q}": fuzzy matches ${ranked.length} | containing the text ${substring.length} | whose class name contains it ${shortName.length}`
  );
  if (q === "force") {
    console.log("   first ten fuzzy hits:", ranked.slice(0, 10).map((r) => r.name.split(".").pop()).join(", "));
    console.log("   a hit with nothing to do with force:",
      ranked.slice(-3).map((r) => r.name).join(" | "));
  }
}
