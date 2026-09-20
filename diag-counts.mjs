import fs from "node:fs";
import path from "node:path";
import { buildLibs } from "./test/helpers/build.mjs";
const LIB = buildLibs("counts-diag", [
  "src/modelica/library.ts",
  "src/modelica/parser.ts",
  "src/modelica/types.ts",
  "src/modelica/fuzzy.ts",
]);
const { LibraryIndex } = await import(path.join(LIB, "library.js"));
const { fuzzyFilter } = await import(path.join(LIB, "fuzzy.js"));

/** How many classes under each top-level library name. */
function byLibrary(names) {
  const out = new Map();
  for (const n of names) {
    const root = n.includes(".") ? n.split(".")[0] : n;
    out.set(root, (out.get(root) ?? 0) + 1);
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
}

const cachePath = "/home/para/modelica-vault/.obsidian/plugins/modelica-studio/library-index.json";
const raw = JSON.parse(fs.readFileSync(cachePath, "utf8"));
const cached = LibraryIndex.fromJSON(raw.index);
console.log("CACHE (what the app is using)");
console.log("  classes :", cached.allNames().length);
console.log("  placeable:", cached.listPlaceable().length);
console.log("  fuzzy 'force':", fuzzyFilter(cached.allNames(), "force", 0).length,
  "| capped at 600:", fuzzyFilter(cached.allNames(), "force", 600).length);
console.log("  by library:", JSON.stringify(byLibrary(cached.allNames()).slice(0, 8)));

const fresh = new LibraryIndex();
fresh.addDirectory("/home/para/.openmodelica/libraries");
console.log("FRESH BUILD");
console.log("  classes :", fresh.allNames().length);
console.log("  placeable:", fresh.listPlaceable().length);
console.log("  fuzzy 'force':", fuzzyFilter(fresh.allNames(), "force", 0).length);
console.log("  by library:", JSON.stringify(byLibrary(fresh.allNames()).slice(0, 8)));
console.log("  roots:", JSON.stringify(fresh.rootNames ? fresh.rootNames() : null));
