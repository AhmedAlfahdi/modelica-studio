import fs from "node:fs";
import path from "node:path";
import { buildLibs } from "./test/helpers/build.mjs";
const LIB = buildLibs("time-diag", ["src/modelica/library.ts", "src/modelica/parser.ts", "src/modelica/types.ts"]);
const { LibraryIndex } = await import(path.join(LIB, "library.js"));
const raw = JSON.parse(fs.readFileSync("/home/para/modelica-vault/.obsidian/plugins/modelica-studio/library-index.json", "utf8"));
const idx = LibraryIndex.fromJSON(raw.index);
for (let i = 0; i < 3; i++) {
  const t = performance.now();
  const n = idx.listPlaceable().length;
  console.log(`listPlaceable: ${n} in ${(performance.now() - t).toFixed(1)} ms`);
}
