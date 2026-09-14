/**
 * Library indexing tests.
 *
 * Indexing the Modelica Standard Library is seconds of main-thread work, so how
 * it is cached, and what it refuses to cache, decides whether opening the plugin
 * freezes. These tests cover the cache contract rather than the parse itself.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLibs, repoRoot, testTmpDir } from "./helpers/build.mjs";

const LIB = buildLibs("library-lib", ["src/modelica/library.ts", "src/modelica/parser.ts", "src/modelica/types.ts"]);
const { LibraryIndex, loadLibraryIndex, indexRoots, INDEX_CACHE_VERSION } = await import(
  path.join(LIB, "library.js")
);

/** A model carrying its own Icon, which is what makes a class placeable. */
function modelSource(name, comment = "") {
  return `model ${name}${comment}
  Real x;
  annotation(Icon(graphics={Rectangle(extent={{-10,-10},{10,10}})}));
end ${name};
`;
}

/** A tiny library tree, so the tests do not depend on an MSL installation. */
function makeLibrary(dir) {
  fs.mkdirSync(path.join(dir, "P"), { recursive: true });
  fs.writeFileSync(path.join(dir, "P", "package.mo"), `package P\n${modelSource("A")}\nend P;\n`);
  fs.writeFileSync(path.join(dir, "P", "B.mo"), `within P;\n${modelSource("B")}`);
  return dir;
}

test("redundant roots are skipped so the library is not parsed twice", () => {
  // The library directory and a version directory inside it are both offered;
  // indexing both parsed every file twice, doubling the cost of the first open.
  const root = testTmpDir("mo-lib-");
  makeLibrary(root);
  const child = path.join(root, "P");
  const kept = indexRoots([root, child]);
  assert.deepEqual(kept, [root], "a root inside another root must be dropped");

  // The opposite order must also collapse to one.
  assert.deepEqual(indexRoots([child, root]).length, 1);
});

test("documentation and asset packages are not indexed", () => {
  // They hold no placeable components, and in the standard library they are a
  // large share of the files.
  const root = testTmpDir("mo-lib-");
  makeLibrary(root);
  for (const skip of ["UsersGuide", "Resources", "Examples", "Icons"]) {
    fs.mkdirSync(path.join(root, "P", skip), { recursive: true });
    fs.writeFileSync(path.join(root, "P", skip, "X.mo"), "within P.UsersGuide;\nmodel X\nend X;\n");
  }
  const index = new LibraryIndex();
  index.addDirectory(root);
  assert.ok(index.get("P.A"), "real components are indexed");
  assert.equal(index.get("P.UsersGuide.X"), undefined, "documentation is skipped");
});

test("the index round-trips through its cache form", () => {
  const root = testTmpDir("mo-lib-");
  makeLibrary(root);
  const built = new LibraryIndex();
  built.addDirectory(root);
  const restored = LibraryIndex.fromJSON(JSON.parse(JSON.stringify(built.toJSON())));
  assert.ok(restored, "a snapshot restores");
  assert.equal(restored.size, built.size, "every class survives");
  assert.ok(restored.get("P.B"), "a class defined in a deep file survives");
});

test("a snapshot from another version is refused, not misread", () => {
  // Reading a stale snapshot as current is how a parser change turns into a
  // silently wrong palette.
  const snapshot = { version: INDEX_CACHE_VERSION + 1, classes: [{ qualifiedName: "P.A" }], kinds: [] };
  assert.equal(LibraryIndex.fromJSON(snapshot), null, "a future version is refused");
  assert.equal(LibraryIndex.fromJSON({ classes: [] }), null, "a missing version is refused");
});

test("the second load uses the cache; a change to the library invalidates it", () => {
  // A cached index is only worthless when the library it describes changes, so
  // the cache lives outside the tree it indexes.
  const lib = testTmpDir("mo-lib-");
  makeLibrary(lib);
  const cacheFile = path.join(testTmpDir("mo-cache-"), "index.json");

  const first = loadLibraryIndex({ roots: [lib], cacheFile });
  assert.equal(first.fromCache, false, "the first load parses");
  assert.ok(fs.existsSync(cacheFile), "a cache is written");

  const second = loadLibraryIndex({ roots: [lib], cacheFile });
  assert.equal(second.fromCache, true, "the second load is served from the cache");
  assert.equal(second.index.size, first.index.size, "and holds the same classes");

  // Touch the library: the cache must not be trusted any more.
  const later = Date.now() / 1000 + 5;
  fs.utimesSync(lib, later, later);
  const third = loadLibraryIndex({ roots: [lib], cacheFile });
  assert.equal(third.fromCache, false, "an updated library forces a re-index");
});

test("a corrupt cache falls back to parsing rather than failing", () => {
  const lib = testTmpDir("mo-lib-");
  makeLibrary(lib);
  const cacheFile = path.join(testTmpDir("mo-cache-"), "index.json");
  fs.writeFileSync(cacheFile, "{ this is not json");
  const result = loadLibraryIndex({ roots: [lib], cacheFile });
  assert.equal(result.fromCache, false, "the bad cache is ignored");
  assert.ok(result.index.size > 0, "and a real index is produced");
});

test("indexing never exceeds the file cap", () => {
  const root = testTmpDir("mo-lib-");
  makeLibrary(root);
  for (let i = 0; i < 40; i++) {
    fs.writeFileSync(path.join(root, "P", `M${i}.mo`), `within P;\nmodel M${i}\nend M${i};\n`);
  }
  const index = new LibraryIndex();
  index.addDirectory(root, { maxFiles: 10 });
  assert.ok(index.size <= 10, `the cap is honoured, got ${index.size}`);
});

void repoRoot;

test("a limited listing describes only what it returns", () => {
  // Deciding whether a class is placeable resolves its inheritance, which is
  // the expensive part. Filtering by name first, and stopping at the page size,
  // is what keeps the palette responsive on a large library.
  const root = testTmpDir("mo-lib-");
  makeLibrary(root);
  for (let i = 0; i < 50; i++) {
    fs.writeFileSync(path.join(root, "P", `M${i}.mo`), `within P;\n${modelSource(`M${i}`)}`);
  }
  const index = new LibraryIndex();
  index.addDirectory(root);

  const page = index.listPlaceable("P.", 5);
  assert.equal(page.length, 5, "the page size is honoured");

  const everything = index.listPlaceable("P.");
  assert.ok(everything.length > 5, "the unlimited listing returns more");

  // Search must span the library rather than a page of it.
  const byName = index.listPlaceable("M4");
  assert.ok(
    byName.some((c) => c.shortName === "M4"),
    "a name search finds a class that a page would not have shown"
  );
  const none = index.listPlaceable("nothing-matches-this");
  assert.equal(none.length, 0);
});

test("packages are derived from the library, not a fixed list", () => {
  // A fixed list left whole domains unreachable: `Modelica.Fluid` and
  // `Modelica.Mechanics.MultiBody` were indexed and worked, but could not be
  // searched for or dragged in.
  const root = testTmpDir("mo-lib-");
  makeLibrary(root);
  fs.mkdirSync(path.join(root, "Q"), { recursive: true });
  fs.writeFileSync(path.join(root, "Q", "package.mo"), `package Q\n${modelSource("C")}\nend Q;\n`);
  const index = new LibraryIndex();
  index.addDirectory(root);
  const pkgs = index.packages();
  assert.ok(pkgs.includes("P"), `the library's own packages are found, got ${pkgs.join(", ")}`);
  assert.ok(pkgs.includes("Q"), "including ones added later");
  // A package with nothing placeable is not offered.
  fs.mkdirSync(path.join(root, "Empty"), { recursive: true });
  fs.writeFileSync(path.join(root, "Empty", "package.mo"), "package Empty\nend Empty;\n");
  const fresh = new LibraryIndex();
  fresh.addDirectory(root);
  assert.ok(!fresh.packages().includes("Empty"), "an empty package is not offered");
});

test("the package tree nests sub-packages and components", () => {
  // Mirrors how OMEdit browses a library. Nested classes must appear as
  // children, because that is where MSL keeps most of its components: `Step`
  // lives inside `Blocks/Sources.mo`, not in a file of its own.
  const root = testTmpDir("mo-lib-");
  fs.mkdirSync(path.join(root, "P", "Sub"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "P", "package.mo"),
    `package P\n${modelSource("Top")}\npackage Sub\n${modelSource("Inner")}\nend Sub;\nend P;\n`
  );
  const index = new LibraryIndex();
  index.addDirectory(root);

  const tree = index.packageTree("P");
  const names = [];
  const walk = (n, d = 0) => {
    names.push(`${"  ".repeat(d)}${n.name}${n.placeable ? "*" : ""}`);
    n.children.forEach((c) => walk(c, d + 1));
  };
  walk(tree);

  assert.ok(tree.children.some((c) => c.name === "Sub"), "a sub-package becomes a branch");
  const sub = tree.children.find((c) => c.name === "Sub");
  assert.ok(sub.children.some((c) => c.name === "Inner" && c.placeable), "its component is a leaf");
  assert.ok(tree.children.some((c) => c.name === "Top" && c.placeable), "a top-level model is a leaf");
});

test("a package holding nothing placeable is not shown", () => {
  const root = testTmpDir("mo-lib-");
  fs.mkdirSync(path.join(root, "P", "Empty"), { recursive: true });
  fs.writeFileSync(path.join(root, "P", "package.mo"), `package P\n${modelSource("A")}\nend P;\n`);
  fs.writeFileSync(path.join(root, "P", "Empty", "package.mo"), "package Empty\nend Empty;\n");
  const index = new LibraryIndex();
  index.addDirectory(root);
  const tree = index.packageTree("P");
  assert.deepEqual(tree.children.map((c) => c.name), ["A"], "the empty branch is pruned");
});

test("operator records keep their own names", () => {
  // `operator record R` is one kind marker, not an `operator` class named
  // `record`. Reading it wrongly made every operator record in MSL a class
  // literally called `record`, so `Modelica.Units.SI.Angle` surfaced as
  // `Modelica.Units.SI.record.record...record.Angle` with the real name lost.
  const root = testTmpDir("mo-lib-");
  fs.mkdirSync(path.join(root, "P"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "P", "package.mo"),
    "package P\n  operator record R\n    Real x;\n  end R;\n  operator function f\n    input Real u;\n  end f;\nend P;\n"
  );
  const index = new LibraryIndex();
  index.addDirectory(root);
  const names = index.allNames().sort();
  assert.deepEqual(names, ["P", "P.R", "P.f"], `operator kinds are named correctly, got ${names}`);
  assert.ok(!names.some((n) => n.includes(".record")), "no class is named 'record'");
});
