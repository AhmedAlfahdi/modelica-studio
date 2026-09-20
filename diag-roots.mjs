import path from "node:path";
import { buildLibs } from "./test/helpers/build.mjs";
const LIB = buildLibs("roots-diag", ["src/modelica/library.ts", "src/modelica/parser.ts", "src/modelica/types.ts"]);
const mod = await import(path.join(LIB, "library.js"));
console.log("exports:", Object.keys(mod).filter((k) => /root|Root|newest|discover/i.test(k)).join(", "));
if (mod.discoverLibraryRoots) {
  const roots = mod.discoverLibraryRoots(["/home/para/.openmodelica/libraries"]);
  console.log("discoverLibraryRoots -> ", roots.length, "roots:");
  for (const r of roots) console.log("   ", r);
}
