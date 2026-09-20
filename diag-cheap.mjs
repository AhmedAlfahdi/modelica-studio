import fs from "node:fs";
import path from "node:path";
import { buildLibs } from "./test/helpers/build.mjs";
const LIB = buildLibs("cheap-diag", ["src/modelica/library.ts", "src/modelica/parser.ts", "src/modelica/types.ts"]);
const { LibraryIndex, isLibraryScaffolding } = await import(path.join(LIB, "library.js"));
const raw = JSON.parse(fs.readFileSync("/home/para/modelica-vault/.obsidian/plugins/modelica-studio/library-index.json", "utf8"));
const idx = LibraryIndex.fromJSON(raw.index);
const t = performance.now();
let cheap = 0;
for (const [name, cls] of idx.classes) {
  if (isLibraryScaffolding(name) || cls.isPartial) continue;
  if (cls.kind !== "model" && cls.kind !== "block") continue;
  if (cls.icon.length > 0 || cls.componentIcons.length > 0) cheap++;
}
console.log(`cheap structural count: ${cheap} in ${(performance.now() - t).toFixed(1)} ms`);
const t2 = performance.now();
console.log(`listPlaceable: ${idx.listPlaceable().length} in ${(performance.now() - t2).toFixed(1)} ms`);
