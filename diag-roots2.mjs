import path from "node:path";
import { buildLibs } from "./test/helpers/build.mjs";
const LIB = buildLibs("roots2-diag", ["src/modelica/library.ts", "src/modelica/parser.ts", "src/modelica/types.ts"]);
const { indexRoots, newestLibraries, LibraryIndex } = await import(path.join(LIB, "library.js"));
const roots = indexRoots(["/home/para/.openmodelica/libraries"]);
console.log("indexRoots ->", roots.length, "roots:");
for (const r of roots) console.log("   ", r);
console.log("newestLibraries ->", JSON.stringify(newestLibraries("/home/para/.openmodelica/libraries")));
