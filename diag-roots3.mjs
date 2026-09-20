import path from "node:path";
import { buildLibs } from "./test/helpers/build.mjs";
const LIB = buildLibs("roots3-diag", ["src/modelica/library.ts", "src/modelica/parser.ts", "src/modelica/types.ts"]);
const { indexRoots, newestLibraries, LibraryIndex } = await import(path.join(LIB, "library.js"));
const dir = "/home/para/.openmodelica/libraries";
const count = (idx) => {
  const names = idx.allNames();
  return `${names.length} classes (${names.filter((n) => n.startsWith("Modelica.")).length} under Modelica)`;
};
const a = new LibraryIndex(); a.addDirectory(dir);
console.log("addDirectory(parent)      :", count(a));
const b = new LibraryIndex();
for (const r of newestLibraries(dir)) b.addDirectory(r);
console.log("addDirectory(each newest) :", count(b));
