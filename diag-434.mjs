import fs from "node:fs";
import path from "node:path";
import { buildLibs } from "./test/helpers/build.mjs";
const LIB = buildLibs("d434-diag", ["src/modelica/library.ts", "src/modelica/parser.ts", "src/modelica/types.ts", "src/modelica/fuzzy.ts"]);
const { LibraryIndex } = await import(path.join(LIB, "library.js"));
const { fuzzyFilter } = await import(path.join(LIB, "fuzzy.js"));
const raw = JSON.parse(fs.readFileSync("/home/para/modelica-vault/.obsidian/plugins/modelica-studio/library-index.json", "utf8"));
const idx = LibraryIndex.fromJSON(raw.index);
const all = idx.allNames();
const placeable = idx.listPlaceable().map((c) => c.name);
const withIcon = all.filter((n) => { const d = idx.component(n); return d && d.hasIcon; });
for (const [label, names] of [["every name in the index", all], ["placeable only", placeable], ["has an icon", withIcon]]) {
  console.log(`${label.padEnd(24)}: ${names.length} names, "force" matches ${fuzzyFilter(names, "force", 0).length}`);
}
