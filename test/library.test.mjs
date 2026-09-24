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
const parserMod = await import(path.join(LIB, "parser.js"));
const { LibraryIndex, loadLibraryIndex, indexRoots, buildPackageTree, newestLibraries, INDEX_CACHE_VERSION } = await import(
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

/**
 * A library whose components inherit their picture from an `Icons` sub-package.
 *
 * This is how the whole Modelica Standard Library is written: `C` declares no
 * graphics and extends `Icons.Base`, which draws them.
 */
function makeIconLibrary(dir) {
  fs.mkdirSync(path.join(dir, "P", "Icons"), { recursive: true });
  fs.writeFileSync(path.join(dir, "P", "package.mo"), "package P\nend P;\n");
  fs.writeFileSync(path.join(dir, "P", "Own.mo"), `within P;\n${modelSource("Own")}`);
  fs.writeFileSync(
    path.join(dir, "P", "Icons", "package.mo"),
    "package Icons\n  partial model Base\n" +
      "    annotation(Icon(graphics={Rectangle(extent={{-10,-10},{10,10}})}));\n" +
      "  end Base;\nend Icons;\n"
  );
  // Declares no graphics at all -- only a label, exactly like
  // Modelica.Electrical.Analog.Sources.ConstantVoltage.
  fs.writeFileSync(
    path.join(dir, "P", "C.mo"),
    "within P;\nmodel C\n  extends Icons.Base;\n" +
      '  annotation(Icon(graphics={Text(extent={{-10,-40},{10,-30}}, textString="C")}));\n' +
      "end C;\n"
  );
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
  for (const skip of ["UsersGuide", "Resources"]) {
    fs.mkdirSync(path.join(root, "P", skip), { recursive: true });
    // The `within` has to name the directory the file is in: writing
    // `within P.UsersGuide` into every one of them made the Examples copy
    // register a class called `P.UsersGuide.X` once Examples stopped being
    // skipped, and the assertion below then failed for the wrong reason.
    fs.writeFileSync(path.join(root, "P", skip, "X.mo"), `within P.${skip};\nmodel X\nend X;\n`);
  }
  // A directory that is NOT skipped, to prove the walk still descends.
  fs.mkdirSync(path.join(root, "P", "Examples"), { recursive: true });
  fs.writeFileSync(path.join(root, "P", "Examples", "X.mo"), "within P.Examples;\nmodel X\nend X;\n");
  const index = new LibraryIndex();
  index.addDirectory(root);
  assert.ok(index.get("P.A"), "real components are indexed");
  assert.equal(index.get("P.UsersGuide.X"), undefined, "documentation is skipped");
  assert.equal(index.get("P.Resources.X"), undefined, "assets are skipped");
  // `Icons`, `Utilities` and `Examples` are NOT among them. None is ever
  // OFFERED -- Icons classes are pictures other classes inherit, the Utilities
  // ones that are partial are held back like any other partial class, and
  // Examples would put 511 demo models in a palette that exists to offer
  // components -- but all three are real Modelica that something else extends or
  // places, so all three must be indexed.
  assert.ok(index.get("P.Examples.X"), "Examples is indexed, just not offered");
  assert.equal(index.isExcluded("P.Examples.X"), true, "and is hidden from the palette");
  assert.ok(
    !index.listPlaceable().some((c) => c.name === "P.Examples.X"),
    "so it is not offered"
  );
  assert.equal(LibraryIndex.SKIP_DIRS.has("Icons"), false, "Icons must be indexed");
  assert.equal(LibraryIndex.SKIP_DIRS.has("Utilities"), false, "Utilities must be indexed");
  assert.equal(LibraryIndex.SKIP_DIRS.has("Examples"), false, "Examples must be indexed");
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

test("a class that inherits its whole picture from an Icons package is not blank", () => {
  // MSL keeps the drawing in a sub-package named `Icons` and the class itself
  // declares none: `Modelica.Electrical.Analog.Sources.ConstantVoltage` extends
  // `Icons.VoltageSource` and adds only a text label. Skipping the `Icons`
  // directory therefore left every one of the library's voltage sources,
  // batteries, clutches and flux tubes with NO graphics at all, drawn as an
  // empty box. Over MSL 4.1.0 that was 145 of the 277 blank symbols.
  const root = testTmpDir("mo-lib-");
  makeIconLibrary(root);
  const index = new LibraryIndex();
  index.addDirectory(root);

  assert.ok(index.lookup("P.Icons.Base"), "the icon definition is indexed, or it cannot be inherited");
  const c = index.describe("P.C");
  assert.ok(c, "the class resolves");
  assert.ok(
    (c.icon ?? []).some((g) => g.kind === "Rectangle"),
    `the inherited rectangle reaches the component, got ${(c.icon ?? []).map((g) => g.kind).join(",")}`
  );
  assert.equal(c.hasIcon, true, "and it counts as having an icon");
  // The class's own label is all it declares, so before the fix this was the
  // only graphic and nothing visible was drawn.
  assert.ok(index.lookup("P.C").icon.every((g) => g.kind === "Text"), "the class really does declare no shapes");
});

test("icon definitions are indexed but never offered", () => {
  // They are `partial`, so placing one produces a model OpenModelica refuses to
  // instantiate, and the palette must not grow an `Icons` folder under every
  // package. Indexing them is what fixes inheritance; offering them is not.
  const root = testTmpDir("mo-lib-");
  makeIconLibrary(root);
  const index = new LibraryIndex();
  index.addDirectory(root);

  assert.equal(index.isExcluded("P.Icons.Base"), true, "hidden from every surface that offers a class");
  assert.ok(index.isExcluded("P.Icons"), "including the package itself");
  assert.ok(
    !index.listPlaceable().some((c) => c.name.startsWith("P.Icons")),
    "not in the palette list"
  );
  assert.ok(!index.packages().some((p) => p.includes("Icons")), "no Icons palette group");
  const tree = JSON.stringify(buildPackageTree(index, "P"));
  assert.ok(!tree.includes("Icons"), `no Icons folder in the palette tree: ${tree}`);

  // The class that inherits from it is still offered: resolution is untouched.
  const names = index.listPlaceable().map((c) => c.name);
  assert.ok(names.includes("P.C"), `P.C is still placeable, got ${names.join(",")}`);
  assert.ok(names.includes("P.Own"), "and so is the class with its own icon");
});

test("the index cache version reflects the classes the index holds", () => {
  // The snapshot is cached for the whole vault, keyed by the library roots and
  // their mtimes rather than by what the parser produced. Any change to WHICH
  // classes the index holds -- adding the `Icons` packages, fixing a parse that
  // discarded two thirds of a file -- therefore has to bump this, or a cache
  // written by the previous version is read as current and the fix reaches
  // nobody who has opened the plugin before.
  //
  // Note what does NOT need a bump: the snapshot holds the PARSED classes, not
  // the resolved ones, so a change to a value that is derived on the way out --
  // a pin's position from its placement's `origin`, say -- reaches every user
  // without one. Check `toJSON` before bumping for a fix like that: a needless
  // bump costs every existing user a full reindex of the library.
  //
  // 7 is here because a change to the parsed SHAPE was shipped without one, and
  // the fix reached nobody who had opened the plugin before: `DynamicSelect` began
  // being read as its editing argument, but every existing index kept the text
  // `"DynamicSelect(...)"` where a graphic's extent belongs, so the tank still drew
  // empty and still labelled itself with the annotation's source. The parser was
  // right and the screen was wrong, which is what this test is for.
  assert.equal(INDEX_CACHE_VERSION, 7);
});

test("a package named Utilities still contributes components", () => {
  // The skip rule matched a directory NAME at any depth, so it took out
  // `Modelica.Clocked.RealSignals.Sampler.Utilities` along with MSL's own helper
  // package. Measured over MSL 4.1.0 that was 159 classes, 42 of them placeable.
  const root = testTmpDir("mo-lib-");
  fs.mkdirSync(path.join(root, "P", "Utilities"), { recursive: true });
  fs.writeFileSync(path.join(root, "P", "package.mo"), "package P\nend P;\n");
  fs.writeFileSync(
    path.join(root, "P", "Utilities", "package.mo"),
    "package Utilities\nend Utilities;\n"
  );
  fs.writeFileSync(path.join(root, "P", "Utilities", "U.mo"), `within P.Utilities;\n${modelSource("U")}`);
  const index = new LibraryIndex();
  index.addDirectory(root);
  assert.ok(index.get("P.Utilities.U"), "a component under Utilities is indexed");
  assert.ok(
    index.listPlaceable().some((c) => c.name === "P.Utilities.U"),
    "and is offered in the palette"
  );
});

test("a partial class is never offered, but is still inherited from", () => {
  // A partial class can only be extended. Offering one lets a user drop it on the
  // canvas and wire it up, and the failure surfaces much later as OpenModelica's
  // "cannot instantiate partial model". The modifier was parsed and then thrown
  // away, so 183 of MSL 4.1.0's 1492 palette entries could not be placed at all.
  const root = testTmpDir("mo-lib-");
  fs.mkdirSync(path.join(root, "P"), { recursive: true });
  fs.writeFileSync(path.join(root, "P", "package.mo"), "package P\nend P;\n");
  fs.writeFileSync(
    path.join(root, "P", "Base.mo"),
    "within P;\npartial model Base\n  Real x;\n" +
      "  annotation(Icon(graphics={Rectangle(extent={{-10,-10},{10,10}})}));\nend Base;\n"
  );
  fs.writeFileSync(
    path.join(root, "P", "Concrete.mo"),
    "within P;\nmodel Concrete\n  extends Base;\n" +
      "  annotation(Icon(graphics={Line(points={{0,0},{5,5}})}));\nend Concrete;\n"
  );
  const index = new LibraryIndex();
  index.addDirectory(root);

  assert.equal(index.get("P.Base").isPartial, true, "the modifier is recorded");
  assert.equal(index.get("P.Concrete").isPartial, false, "and is not inherited as a flag");
  assert.equal(index.isExcluded("P.Base"), true, "hidden from every surface that offers a class");

  const names = index.listPlaceable().map((c) => c.name);
  assert.ok(!names.includes("P.Base"), `a partial class is not offered, got ${names.join(",")}`);
  assert.ok(names.includes("P.Concrete"), "a concrete subclass still is");
  assert.ok(!JSON.stringify(buildPackageTree(index, "P")).includes("P.Base"), "nor in the tree");

  // Resolution is untouched: the subclass still inherits the base's picture.
  const shapes = (index.describe("P.Concrete").icon ?? []).map((g) => g.kind);
  assert.ok(shapes.includes("Rectangle"), `the base icon is inherited, got ${shapes.join(",")}`);
});

test("only the newest release of each library is indexed", () => {
  // OpenModelica keeps every installed version side by side. Indexing the
  // directory that holds them indexed three releases of `Modelica` into ONE
  // table keyed by qualified name, so which definition won depended on the order
  // the filesystem handed the files over -- and the palette, the inspector and
  // the renderer could each be describing a different release.
  const root = testTmpDir("mo-libs-");
  for (const [dir, body] of [
    ["Modelica 3.2.3+maint.om", "model Thing\n  Real x;\nend Thing;\n"],
    ["Modelica 4.0.0+maint.om", "model Thing\n  Real x;\nend Thing;\n"],
    ["Modelica 4.1.0+maint.om", "model Thing\n  Real x;\nend Thing;\n"],
    ["ModelicaServices 4.1.0+maint.om", "model Machine\n  Real x;\nend Machine;\n"],
    ["MyLib", "model Mine\n  Real x;\nend Mine;\n"],
  ]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, dir, "package.mo"), `package ${dir.split(" ")[0]}\n${body}end ${dir.split(" ")[0]};\n`);
  }

  const chosen = newestLibraries(root).map((p) => path.basename(p)).sort();
  assert.deepEqual(
    chosen,
    ["Modelica 4.1.0+maint.om", "ModelicaServices 4.1.0+maint.om", "MyLib"],
    "one release per family, and the unversioned library untouched"
  );

  // And the index built from them has no cross-version duplicates: `Modelica`
  // appears once, from 4.1.0.
  const index = new LibraryIndex();
  for (const dir of newestLibraries(root)) index.addDirectory(dir);
  const modelica = index.allNames().filter((n) => n.startsWith("Modelica."));
  assert.deepEqual(modelica, ["Modelica.Thing"], "the library is indexed once");
  assert.ok(index.get("ModelicaServices.Machine"), "and a sibling library is not dropped");

  // A directory that is itself a library is returned as it is.
  assert.deepEqual(newestLibraries(path.join(root, "MyLib")), [path.join(root, "MyLib")]);

  // The WIRING, not just the helper: `discoverLibraryRoots` has to apply it, or
  // the selection above is a function nothing calls. Guarded on the library
  // actually being installed, like the other machine-dependent tests here.
  const installed = path.join(process.env.HOME ?? "", ".openmodelica", "libraries");
  if (fs.existsSync(installed)) {
    const roots = LibraryIndex.discoverLibraryRoots();
    assert.ok(roots.length > 0, "the installed libraries are discovered");
    assert.ok(
      !roots.includes(installed),
      "the directory of libraries is expanded, not indexed whole"
    );
    const families = roots.map((r) => path.basename(r).split(" ")[0]);
    assert.equal(
      new Set(families).size,
      families.length,
      `one release per library, got ${roots.map((r) => path.basename(r)).join(", ")}`
    );
    assert.ok(
      families.includes("ModelicaServices"),
      "and every family present is discovered, not just the first"
    );
  }
});

test("an index that hits the file cap says so", () => {
  // A cap that silently discards a library is worse than no cap: the classes are
  // simply absent, and every one of them reads as "not in the library" with
  // nothing to explain why. `ModelicaServices` went missing that way.
  const root = testTmpDir("mo-cap-");
  fs.mkdirSync(path.join(root, "P"), { recursive: true });
  for (let i = 0; i < 12; i++) {
    fs.writeFileSync(path.join(root, "P", `M${i}.mo`), `within P;\nmodel M${i}\n  Real x;\nend M${i};\n`);
  }

  const complete = new LibraryIndex();
  const read = complete.addDirectory(root);
  assert.equal(read, 12, "everything is read when the cap is not reached");
  assert.deepEqual(complete.truncatedRoots, [], "and nothing is reported");

  const capped = new LibraryIndex();
  const partial = capped.addDirectory(root, { maxFiles: 5 });
  assert.equal(partial, 5, "the cap stops the walk");
  assert.deepEqual(capped.truncatedRoots, [root], "and the root is reported as incomplete");
});

test("a parsed class survives the cache exactly as the parser produced it", () => {
  // The cache holds the PARSED classes, so anything the parser learns must survive a
  // JSON round trip or the fix reaches nobody who has opened the plugin before. That
  // is not hypothetical: beta.53 taught the parser to read `DynamicSelect`, shipped
  // without a version bump, and every existing index kept the old text -- the user
  // reported the tank as still broken, twice.
  //
  // This is the field-level half of that guard. The version half is asserted above:
  // a snapshot written by another version is ignored rather than read as current.
  const src = `model Tank
  annotation (Icon(graphics={
    Rectangle(extent=DynamicSelect({{-100,-100},{100,10}}, {{-100,-100},{100,level}}),
      fillColor={85,170,255}),
    Text(extent={{-95,-24},{95,-44}}, textString=DynamicSelect("%level_start", String(level))),
    Rectangle(extent=Unreadable(1, 2))}));
end Tank;`;
  const { parseModelica, findClass } = parserMod;
  const before = findClass(parseModelica(src), "Tank");

  // Exactly what the index does when it writes and reads the snapshot.
  const after = JSON.parse(JSON.stringify(before));

  // Both graphics that use `DynamicSelect` BUILD -- that is the fix this round trip
  // has to preserve -- and the third, whose extent is a call nothing can read, is
  // the one that is dropped and recorded.
  assert.equal(after.icon.length, 2, "both DynamicSelect graphics are there");
  assert.deepEqual(
    after.icon[0].extent,
    [-100, -100, 100, 10],
    "the EDITING extent of a DynamicSelect is what was cached, not the call"
  );
  assert.deepEqual(
    after.icon[0].dynamic?.extent,
    { editing: "{{-100,-100},{100,10}}", other: "{{-100,-100},{100,level}}" },
    "and both arguments are kept, so a save can write the call back"
  );
  assert.deepEqual(
    after.icon[1].dynamic?.textString,
    { editing: '"%level_start"', other: "String(level)" },
    "the same for a label"
  );
  assert.deepEqual(
    after.unparsedGraphics,
    ["Rectangle"],
    "and the record of what could not be built survives too, or the sweep that reads it sees nothing"
  );
});

test("an excluded library leaves the palette tree, not just search", () => {
  // The exclusion policy was applied on the search path and skipped on the tree
  // path, so an excluded library's group still appeared under its package heading
  // with every class in it draggable onto the canvas -- while typing the same name
  // into the search box found nothing. This module's own comment says the tree,
  // search, browser and completion "all agree about what is available".
  const root = testTmpDir("mo-lib-");
  makeLibrary(root);
  const index = new LibraryIndex();
  index.addDirectory(root);

  const placeable = (node) => [
    ...(node.placeable ? [node.full] : []),
    ...node.children.flatMap((c) => placeable(c)),
  ];
  const everything = (node) => [node.full, ...node.children.flatMap((c) => everything(c))];

  assert.deepEqual(placeable(buildPackageTree(index, "P")).sort(), ["P.A", "P.B"], "both offered at first");

  index.setExcluded(["P.A"]);

  assert.equal(index.isExcluded("P.A"), true, "the class is excluded");
  const tree = buildPackageTree(index, "P");
  assert.deepEqual(placeable(tree), ["P.B"], `only the kept class is placeable: ${placeable(tree)}`);
  assert.ok(!everything(tree).includes("P.A"), "and the excluded class is not in the tree at all");
  assert.equal(index.hasPlaceableClass("P."), true, "the package stays while something in it is offered");

  // The package itself disappears once NOTHING in it is placeable: this is the
  // test that failed before the fix, because `hasPlaceableClass` never asked.
  index.setExcluded(["P.A", "P.B"]);
  assert.equal(index.hasPlaceableClass("P."), false, "an all-excluded package is not placeable");
  assert.equal(
    index.packages().some((p) => p === "P" || p.startsWith("P.")),
    false,
    "so the palette does not list it"
  );
  // And the caches do not outlive the change, or the palette would redraw the old
  // tree after the setting was edited.
  assert.deepEqual(placeable(index.packageTree("P")), [], "the cached tree was invalidated");
});
