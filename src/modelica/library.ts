/**
 * Index of Modelica classes available to the editor.
 *
 * Parses the Modelica Standard Library (and any user libraries) from disk once,
 * then answers the two questions the UI needs:
 *   - what does this class look like (icon graphics, ports, parameters)?
 *   - which classes can I put in a palette?
 *
 * Ports and parameters are inherited through `extends`, which matters a lot in
 * practice: `Modelica.Electrical.Analog.Basic.Resistor` declares neither its
 * pins nor its heat port directly — they arrive via `extends OnePort` and
 * `extends ConditionalHeatPort`. Without walking that chain the palette would
 * show a resistor with no pins.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseModelica, placementCenter as extentCenter, type ParsedClass } from "./parser";
import type { ComponentClass, Graphic, ParameterDef, PortDef } from "./types";

export interface LibrarySource {
  /** Directory containing the library (may hold .mo files recursively). */
  root: string;
  /** True when the root itself is a package directory (has package.mo). */
  isPackageDir: boolean;
}

/** A connector type's essential shape, and which class it turned out to be. */
interface ConnectorInfo {
  isFlow: boolean;
  /** Number of potential variables (excluding flow) — 0 means a signal port. */
  hasPotential: boolean;
  /** The class the declared name resolved to, fully qualified. */
  qualifiedName: string;
}

/**
 * Cache format version.
 *
 * Bump when the parsed shape changes, so a stale cache is ignored rather than
 * read as if it were current — the same reasoning as the persisted-model schema.
 */
export const INDEX_CACHE_VERSION = 6;

/**
 * Whether a class belongs to the library's own scaffolding rather than to the
 * set of components a user places.
 *
 * Two kinds qualify, for different reasons, and both must be INDEXED:
 *
 * `Icons` holds the shared pictures other classes inherit.
 * `Modelica.Electrical.Analog.Icons.VoltageSource` draws the whole battery symbol
 * that `Sources.ConstantVoltage` extends, while `ConstantVoltage` itself declares
 * nothing but a text label. Skipping that directory left every such class with no
 * graphics at all, drawn blank.
 *
 * `Examples` holds runnable demos AND the utility blocks they are built from.
 * `Modelica.Mechanics.Rotational.Examples.Utilities.DirectInertia` is a real
 * block -- "Input/output block of a direct inertia model" -- and a model that
 * references one has to be able to draw it. Skipping that directory left it as a
 * bare placeholder box.
 *
 * Neither must ever be OFFERED. `Icons` classes are `partial`, so placing one
 * produces a model OpenModelica refuses to instantiate, and `Examples` would add
 * 511 demo models to a palette that exists to offer components.
 *
 * Resolution is untouched: `lookup` and `describe` still see these classes, which
 * is the whole point.
 */
export function isLibraryScaffolding(qualifiedName: string): boolean {
  const parts = qualifiedName.split(".");
  return parts.includes("Icons") || parts.includes("Examples");
}

export class LibraryIndex {
  /** qualified name -> parsed class */
  private classes = new Map<string, ParsedClass>();
  /** qualified name -> element kind (model/connector/package/...) */
  private kinds = new Map<string, string>();
  /** file that defined each class, for lazy re-reads */
  private files = new Map<string, string>();
  /** Cache of resolved connector info. */
  private connectorCache = new Map<string, ConnectorInfo | null>();
  /** Cache of resolved ComponentClass entries. */
  private resolvedCache = new Map<string, ComponentClass>();
  /** Cache of `listPlaceable` results, keyed by filter. */
  private placeableCache = new Map<string, ComponentClass[]>();
  /** Cached result of `packages()`. */
  private packageCache: string[] | null = null;
  /** Cached package trees, keyed by root. */
  private treeCache = new Map<string, TreeNode>();
  /**
   * Qualified name prefixes excluded from search and from the palette.
   *
   * Excluding a library is a policy of the index rather than of the palette, so
   * that the palette tree, the search results, the browser and completion all
   * agree about what is available. Filtering only the palette left excluded
   * classes reachable by typing their name.
   *
   * This is also where inheritance-only classes are held back, for the same
   * reason: `isLibraryScaffolding` has to hide them from every one of those surfaces
   * at once, and this is the single predicate they all consult.
   */
  private excluded: string[] = [];
  /** Cached lower-cased names, for the subsequence scan. */
  private lowered: Array<{ name: string; lower: string }> | null = null;

  /**
   * Exclude libraries by qualified-name prefix.
   *
   * Clears the caches that depended on the previous set, or an exclusion would
   * not take effect until the plugin was reloaded.
   */
  setExcluded(prefixes: readonly string[]): void {
    const next = prefixes.map((p) => p.trim()).filter(Boolean).sort();
    const same = next.length === this.excluded.length && next.every((p, i) => p === this.excluded[i]);
    if (same) return;
    this.excluded = next;
    this.placeableCache.clear();
    this.packageCache = null;
    this.treeCache.clear();
  }

  get exclusions(): readonly string[] {
    return this.excluded;
  }

  /** True when a class is hidden by the exclusion list. */
  isExcluded(qualifiedName: string): boolean {
    // Inheritance-only classes are never offered, wherever they are looked for.
    if (isLibraryScaffolding(qualifiedName)) return true;
    // Nor are partial ones: they cannot be instantiated, so every surface that
    // offers a class to place has to agree about leaving them out.
    if (this.classes.get(qualifiedName)?.isPartial) return true;
    if (!this.excluded.length) return false;
    for (const prefix of this.excluded) {
      if (qualifiedName === prefix || qualifiedName.startsWith(prefix + ".")) return true;
    }
    return false;
  }

  get size(): number {
    return this.classes.size;
  }

  /** Every qualified class name in the index. */
  allNames(): string[] {
    return [...this.classes.keys()];
  }

  /**
   * Packages that offer something placeable, derived from the library.
   *
   * Computed once and kept: the palette asks for it on every render, and
   * deriving it walks the class table.
   */
  packages(): string[] {
    this.packageCache ??= indexedPackages(this);
    return this.packageCache;
  }

  /**
   * The package tree under `root`, for the palette.
   *
   * Cached: the user expands and collapses branches repeatedly, and rebuilding
   * walks the class table each time.
   */
  packageTree(root: string): TreeNode {
    const cached = this.treeCache.get(root);
    if (cached) return cached;
    const tree = buildPackageTree(this, root);
    this.treeCache.set(root, tree);
    return tree;
  }

  /**
   * Whether any class under `prefix` could be placed.
   *
   * A cheap prefix test over the class table: kind is `model` or `block` and the
   * class carries graphics of its own. Inheritance is not resolved, so this can
   * err towards true, which is the harmless direction — the palette simply ends
   * up with a group it then finds nothing to put in.
   */
  hasPlaceableClass(prefix: string): boolean {
    for (const [qn, cls] of this.classes) {
      if (!qn.startsWith(prefix)) continue;
      if (isLibraryScaffolding(qn) || cls.isPartial) continue;
      if (cls.kind !== "model" && cls.kind !== "block") continue;
      if (cls.icon.length > 0 || cls.componentIcons.length > 0) return true;
    }
    return false;
  }

  /**
   * Serialisable snapshot of the index.
   *
   * Parsing the Modelica Standard Library takes seconds and happens on the main
   * thread, so it is done once and reused. The parsed classes are plain data —
   * no methods, no cycles — so a snapshot round-trips through JSON.
   */
  toJSON(): { version: number; classes: ParsedClass[]; kinds: [string, string][] } {
    // Source offsets are only meaningful during a parse, and dropping them
    // keeps the cache materially smaller.
    const classes = [...this.classes.values()].map((c) => {
      const { startOffset: _s, endOffset: _e, ...rest } = c;
      return rest as ParsedClass;
    });
    return {
      version: INDEX_CACHE_VERSION,
      classes,
      kinds: [...this.kinds.entries()],
    };
  }

  /** Rebuild an index from `toJSON` output. */
  static fromJSON(data: {
    version?: number;
    classes?: ParsedClass[];
    kinds?: [string, string][];
  }): LibraryIndex | null {
    if (!data || data.version !== INDEX_CACHE_VERSION) return null;
    if (!Array.isArray(data.classes)) return null;
    const index = new LibraryIndex();
    for (const c of data.classes) {
      if (!c || typeof c.qualifiedName !== "string") continue;
      index.classes.set(c.qualifiedName, c);
    }
    for (const [name, kind] of data.kinds ?? []) index.kinds.set(name, kind);
    return index;
  }

  /**
   * Packages whose contents are documentation or assets, never components.
   *
   * Indexing them costs time and memory and adds nothing to the palette. In the
   * standard library they account for a large share of the files.
   *
   * `Icons` is deliberately NOT in this list even though it is never offered.
   * Its classes are what other classes INHERIT their picture from —
   * `Modelica.Electrical.Analog.Icons.VoltageSource` is the whole of
   * `Sources.ConstantVoltage`'s icon — so skipping the directory left those
   * classes with no graphics and they were drawn blank. They are kept out of the
   * palette by `isLibraryScaffolding` instead. Measured over MSL 4.1.0: +50 files,
   * and the count of model/block classes with no visible shape falls from 277 to
   * 132.
   *
   * `Examples` came out for the third time and the same reason: it is never
   * offered, but `Examples.Utilities.*` are components models really use. It is
   * held out of the palette by `isLibraryScaffolding` instead. Measured over MSL
   * 4.1.0: +617 files and about 70 ms of indexing for 672 classes, with the
   * palette unchanged.
   *
   * `Utilities` came out too, though NOT for the reason it first appeared to.
   * The rule matches the name at any depth, so it also skipped packages such as
   * `Modelica.Clocked.RealSignals.Sampler.Utilities`, which hold real components:
   * indexing it adds 159 classes, 42 of them placeable (`UpSample`,
   * `AssignClockToTriggerHold`, `Limiter`, ...) and previously absent from the
   * palette. Measured over MSL 4.1.0: +73 files, no measurable indexing time.
   *
   * It does NOT fix `Modelica.Fluid.Dissipation.Utilities.Records.*`, which was
   * the reason first assumed: measured before and after, the number of unresolved
   * `extends` targets was 77 either way, because those classes are declared
   * inline in the file `Fluid/Dissipation.mo`, which was never skipped. They were
   * in fact missing for an unrelated reason -- a runaway recovery scan after
   * `annotation (Dialog)` that discarded the rest of the file -- fixed in
   * `parseValue`. Recorded so this change is not credited with a fix it did not
   * make.
   */
  private static readonly SKIP_DIRS = new Set([
    "UsersGuide",
    "Resources",
  ]);

  /** Add every .mo file under a directory tree. */
  addDirectory(root: string, opts: { maxFiles?: number } = {}): number {
    // A guard against a pathological tree, not a working limit. It was 5000,
    // which the standard library alone exceeded the moment more than one release
    // was installed under one root: 280 files were dropped without a word,
    // `ModelicaServices` among them. A cap that silently discards a library is
    // worse than no cap, so this one is far above any real installation AND it
    // says when it bites -- see `truncatedRoots`.
    const maxFiles = opts.maxFiles ?? 50000;
    let count = 0;
    const walk = (dir: string) => {
      if (count >= maxFiles) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (count >= maxFiles) return;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (LibraryIndex.SKIP_DIRS.has(e.name)) continue;
          walk(p);
        } else if (e.name.endsWith(".mo")) {
          this.addFile(p);
          count++;
        }
      }
    };
    walk(root);
    if (count >= maxFiles) this.truncatedRoots.push(root);
    return count;
  }

  /**
   * Roots whose walk hit the file cap, so the index is incomplete.
   *
   * Recorded rather than thrown: a partial index still draws most of a model,
   * and refusing to open one because a library is enormous would be worse. But
   * the caller is expected to SAY so -- an index that is quietly missing
   * `ModelicaServices` is a bug report waiting to happen.
   */
  readonly truncatedRoots: string[] = [];

  /** Parse one .mo file and register the classes it defines. */
  addFile(file: string): ParsedClass[] {
    let src: string;
    try {
      src = fs.readFileSync(file, "utf8");
    } catch {
      return [];
    }
    return this.addSource(src, file);
  }

  addSource(src: string, file = "<memory>"): ParsedClass[] {
    let classes: ParsedClass[];
    try {
      classes = parseModelica(src);
    } catch {
      return [];
    }
    for (const c of classes) {
      this.classes.set(c.qualifiedName, c);
      this.kinds.set(c.qualifiedName, c.kind);
      this.files.set(c.qualifiedName, file);
    }
    return classes;
  }

  has(name: string): boolean {
    return this.classes.has(name);
  }

  get(name: string): ParsedClass | undefined {
    return this.classes.get(name);
  }

  /**
   * Resolve a possibly-relative class name against a package context.
   * Modelica name lookup is complex; this handles the common cases:
   * fully qualified, and relative to any enclosing package.
   */
  lookup(name: string, fromPackage?: string): ParsedClass | undefined {
    if (this.classes.has(name)) return this.classes.get(name);
    if (fromPackage) {
      const parts = fromPackage.split(".");
      for (let i = parts.length; i > 0; i--) {
        const candidate = parts.slice(0, i).join(".") + "." + name;
        if (this.classes.has(candidate)) return this.classes.get(candidate);
      }
    }
    // Last resort: unique short-name match
    const short = name.split(".").pop()!;
    let found: ParsedClass | undefined;
    for (const [qn, c] of this.classes) {
      if (c.name === short) {
        if (found) return undefined; // ambiguous
        found = c;
      }
      void qn;
    }
    return found;
  }

  /**
   * Whether a class exposes a port, ignoring any array subscript.
   *
   * A connection names one element of an array port — `outPort[1]` — while the
   * declaration names the array itself. Both refer to the same connector, so the
   * subscript is stripped before matching.
   */
  hasPort(className: string, port: string, fromPackage?: string): boolean {
    const def = this.lookup(className, fromPackage);
    if (!def) return false;
    const bare = port.replace(/\[[^\]]*\]$/, "");
    return def.components.some((c) => !c.arrayDims?.length
      ? c.name === bare
      : c.name === bare || c.name === port);
  }

  /** True when the named class is a connector. */
  isConnector(name: string, fromPackage?: string): boolean {
    const info = this.connectorInfo(name, fromPackage);
    return info !== null;
  }

  /**
   * Determine whether a class is a connector, and whether it is flow-based.
   *
   * `fromPackage` supplies the enclosing package so that relative type names
   * (e.g. `PositivePin` inside `Modelica.Electrical.Analog.Interfaces`) resolve.
   */
  connectorInfo(name: string, fromPackage?: string): ConnectorInfo | null {
    const cls = this.lookup(name, fromPackage);
    if (!cls || cls.kind !== "connector") return null;

    const cacheKey = cls.qualifiedName;
    if (this.connectorCache.has(cacheKey)) return this.connectorCache.get(cacheKey)!;

    let isFlow = false;
    let hasPotential = false;
    for (const c of cls.components) {
      if (c.prefixes.includes("flow")) isFlow = true;
      else if (!c.prefixes.includes("parameter") && !c.prefixes.includes("constant")) {
        hasPotential = true;
      }
    }
    // Inherited members
    const pkg = cls.qualifiedName.split(".").slice(0, -1).join(".");
    for (const base of cls.extendsTypes) {
      const b = this.connectorInfo(base, pkg);
      if (b) {
        if (b.isFlow) isFlow = true;
        if (b.hasPotential) hasPotential = true;
      }
    }

    const info: ConnectorInfo = { isFlow, hasPotential, qualifiedName: cls.qualifiedName };
    this.connectorCache.set(cacheKey, info);
    return info;
  }

  /** Resolve an extends target to a fully qualified name where possible. */
  private resolveExtends(typeName: string, from: ParsedClass): string {
    if (this.classes.has(typeName)) return typeName;
    const pkg = from.qualifiedName.split(".").slice(0, -1).join(".");
    const probe = pkg ? `${pkg}.${typeName}` : typeName;
    if (this.classes.has(probe)) return probe;
    const found = this.lookup(typeName, pkg);
    return found ? found.qualifiedName : typeName;
  }

  /**
   * Collect component declarations from a class and all its ancestors.
   * Nearer declarations shadow inherited ones of the same name.
   */
  private collectInherited(cls: ParsedClass): {
    ports: {
      name: string;
      type: string;
      prefixes: string[];
      pkg: string;
      center?: [number, number];
      condition?: string;
    }[];
    parameters: ParameterDef[];
    icons: Graphic[];
  } {
    const ports = new Map<
      string,
      {
        name: string;
        type: string;
        prefixes: string[];
        pkg: string;
        center?: [number, number];
        condition?: string;
      }
    >();
    const parameters = new Map<string, ParameterDef>();
    const icons: Graphic[] = [];
    const seen = new Set<string>();

    const visit = (c: ParsedClass, depth: number) => {
      if (depth > 12) return; // guard against pathological inheritance
      if (seen.has(c.qualifiedName)) return;
      seen.add(c.qualifiedName);
      // Depth-first so that this class's own declarations win.
      const pkg = c.qualifiedName.split(".").slice(0, -1).join(".");
      for (const base of c.extendsTypes) {
        const baseCls = this.lookup(base, pkg);
        if (baseCls && baseCls !== c) visit(baseCls, depth + 1);
      }
      for (const comp of c.components) {
        if (comp.name.endsWith("_actual")) continue;
        // A protected declaration is the class's own business. Listing one as a
        // parameter offers the user a value they may not set: OpenModelica
        // rejects the modifier with "protected element may not be modified".
        if (comp.visibility === "protected") continue;
        // A `final` parameter is computed by the class and may not be
        // overridden either; OpenModelica reports "Trying to override final
        // element nx". MSL derives several of these, e.g. `Final parameter
        // Integer nx = ...` in Continuous.Filter.
        if (comp.prefixes.includes("final")) continue;
        const isParam =
          comp.prefixes.includes("parameter") || comp.prefixes.includes("constant");
        if (isParam) {
          if (!parameters.has(comp.name)) {
            parameters.set(comp.name, toParameter(comp));
          }
          continue;
        }
        // A state's initial value. The inspector needs it: without it a model
        // such as HeatCapacitor offers only `C`, and the starting temperature —
        // the thing that decides where the curve begins — has no field at all.
        const start = comp.modifiers?.start;
        if (typeof start === "string" && !parameters.has(`${comp.name}.start`)) {
          parameters.set(`${comp.name}.start`, {
            name: `${comp.name}.start`,
            type: comp.type,
            defaultValue: start,
            comment: `Initial ${comp.name}`,
            isStart: true,
          });
        }
        if (!ports.has(comp.name)) {
          ports.set(comp.name, {
            name: comp.name,
            type: comp.type,
            prefixes: comp.prefixes,
            // A conditional connector only exists once its parameter is true.
            condition: comp.condition,
            // Package where this declaration lives — needed to resolve
            // relative type names such as `PositivePin`.
            pkg,
            // The connector's own Placement gives its pin location inside the
            // enclosing class's canonical icon box.
            center: extentCenter(comp.placement),
          });
        }
      }
      if (c.icon.length) icons.push(...c.icon);
    };

    visit(cls, 0);
    return {
      ports: [...ports.values()],
      parameters: [...parameters.values()],
      icons,
    };
  }

  /**
   * Resolved, palette/render-ready view of a class.
   *
   * Prefer this over `get()` anywhere the UI needs ports, parameters or icons:
   * `get()` returns the raw parsed class, which has none of the inherited
   * members resolved.
   */
  component(className: string): ComponentClass | undefined {
    return this.describe(className);
  }

  /** Build a palette-ready description of a class, resolving inheritance. */
  describe(name: string): ComponentClass | undefined {
    const cached = this.resolvedCache.get(name);
    if (cached) return cached;

    const cls = this.lookup(name);
    if (!cls) return undefined;

    const { ports: rawPorts, parameters, icons } = this.collectInherited(cls);
    // A class that draws nothing itself may still carry a picture on one of its
    // components; use it rather than showing an empty symbol.
    const effectiveIcon = icons.length ? icons : cls.icon.length ? cls.icon : cls.componentIcons;

    const ports: PortDef[] = [];
    for (const p of rawPorts) {
      const prefixes = new Set(p.prefixes);
      const info = this.connectorInfo(p.type, p.pkg);
      const isScalarSignal =
        prefixes.has("input") ||
        prefixes.has("output") ||
        (!info && isPrimitiveType(p.type));

      if (!info && !isScalarSignal) continue; // not a port (e.g. an inner block)
      if (prefixes.has("parameter") || prefixes.has("constant")) continue;

      const causality: PortDef["causality"] = prefixes.has("input")
        ? "input"
        : prefixes.has("output")
          ? "output"
          : "acausal";

      ports.push({
        name: p.name,
        type: p.type,
        isFlow: prefixes.has("flow") || info?.isFlow === true,
        causality,
        condition: p.condition,
        // Where the type resolved to, so a caller can look the connector class up
        // without knowing the package the declaration sat in.
        ...(info ? { connectorClass: info.qualifiedName } : {}),
      });
    }

    const portPositions: Record<string, [number, number]> = {};
    for (const p of rawPorts) {
      if (p.center) portPositions[p.name] = p.center;
    }

    const result: ComponentClass = {
      name: cls.qualifiedName,
      shortName: cls.name,
      comment: cls.comment,
      icon: effectiveIcon,
      diagram: cls.diagram,
      ports,
      parameters,
      portPositions,
      hasIcon: effectiveIcon.length > 0,
    };
    this.resolvedCache.set(name, result);
    return result;
  }

  /** All classes that can plausibly be dropped into a diagram. */
  /**
   * Placeable classes, optionally limited to a package prefix.
   *
   * Resolving every candidate through `describe` is the expensive part — it
   * walks the inheritance chain — so the result is cached. The palette asks for
   * this repeatedly as the user types, and on a large library the uncached cost
   * is close to a second.
   */
  listPlaceable(filter?: string, limit = 0): ComponentClass[] {
    const key = `${filter ?? ""}|${limit}`;
    const cached = this.placeableCache.get(key);
    if (cached) return cached;
    // The palette calls this once per keystroke, so without a bound the cache
    // grows with every prefix ever typed.
    if (this.placeableCache.size > 64) this.placeableCache.clear();

    // Filter by name FIRST. Deciding placeability means resolving a class's
    // inheritance, which is the expensive part; doing it for all 4,782 classes
    // before discarding most of them costs about a second, and the palette only
    // ever shows a page of results.
    const needle = (filter ?? "").toLowerCase();
    const candidates: string[] = [];
    for (const [qn, cls] of this.classes) {
      if (cls.kind !== "model" && cls.kind !== "block") continue;
      if (this.isExcluded(qn)) continue;
      if (needle && !qn.toLowerCase().includes(needle)) continue;
      candidates.push(qn);
    }
    candidates.sort((a, b) => a.localeCompare(b));

    const out: ComponentClass[] = [];
    for (const qn of candidates) {
      if (limit > 0 && out.length >= limit) break;
      const d = this.describe(qn);
      if (d && d.hasIcon) out.push(d);
    }
    this.placeableCache.set(key, out);
    return out;
  }

  /** Candidate library roots found on this machine. */
  static discoverLibraryRoots(): string[] {
    const home = process.env.HOME ?? "";
    const candidates = [
      path.join(home, ".openmodelica", "libraries"),
      "/usr/lib/omc/libraries",
      "/usr/share/omc/libraries",
      path.join(home, ".modelica"),
    ];
    const out: string[] = [];
    for (const c of candidates) {
      try {
        if (!fs.existsSync(c) || !fs.statSync(c).isDirectory()) continue;
        out.push(...newestLibraries(c));
      } catch {
        /* ignore */
      }
    }
    return out;
  }
}

/**
 * One directory per library, the newest release of each.
 *
 * OpenModelica keeps every installed version side by side --
 * `Modelica 3.2.3+maint.om` next to `Modelica 4.0.0+maint.om` next to
 * `Modelica 4.1.0+maint.om` -- so indexing the directory that holds them indexes
 * three releases of the same library into ONE table, keyed by qualified name.
 * Which definition wins is then decided by the order the filesystem happens to
 * hand the files over: `Modelica.Blocks.Math.Feedback` is a different class in
 * 3.2.3 and in 4.1.0, and the palette, the inspector and the renderer could each
 * be describing a different one. The 5,000-file cap finished the job by dropping
 * 274 files and never reaching `ModelicaServices` at all, which MSL classes
 * reference.
 *
 * A directory that is itself a library (`package.mo` directly inside) is
 * returned unchanged. Otherwise the subdirectories are grouped by their name
 * without the version -- `Modelica` for `Modelica 4.1.0+maint.om` -- and the
 * highest version of each is kept. A directory whose name carries no version is
 * kept as it is: there is nothing to choose between.
 */
export function newestLibraries(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  // A library in its own right, rather than a directory of them.
  if (entries.some((e) => e.isFile() && e.name === "package.mo")) return [dir];

  const out: string[] = [];
  const newest = new Map<string, { dir: string; version: number[] }>();
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(dir, e.name);
    // `Modelica 4.1.0+maint.om` -> family `Modelica`, version [4, 1, 0].
    const m = /^(\S+)\s+(\d+(?:\.\d+)*)/.exec(e.name);
    if (!m) {
      out.push(full);
      continue;
    }
    const version = m[2].split(".").map(Number);
    const held = newest.get(m[1]);
    if (!held || compareVersions(version, held.version) > 0) {
      newest.set(m[1], { dir: full, version });
    }
  }
  // The kept releases first, then anything unversioned, both in a stable order.
  return [...newest.values()].map((v) => v.dir).sort().concat(out.sort());
}

/** Compare dotted numeric versions, newest last. */
function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function isPrimitiveType(t: string): boolean {
  const short = t.split(".").pop()!;
  return (
    short === "Real" || short === "Integer" || short === "Boolean" ||
    short === "String" || short === "Complex" || short === "Time"
  );
}

/**
 * A declaration default usable as a run-time override.
 *
 * Only self-contained literals qualify. MSL writes defaults that depend on the
 * enclosing scope — `parameter Init initType=Init.NoInit`, where `Init` is
 * imported by that class and means nothing anywhere else. Re-emitting such a
 * value on a placed component produces
 *     "Variable Init.NoInit not found in scope T"
 * so those are left unset and the class's own default is used, which is the
 * behaviour the library intended.
 */
function literalDefault(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim();
  return /^-?(\d+\.?\d*([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?|true|false|".*")$/.test(v)
    ? v
    : undefined;
}

function toParameter(c: { name: string; type: string; modifiers: Record<string, string>; comment?: string }): ParameterDef {
  const raw = c.modifiers[c.name];
  return {
    name: c.name,
    type: c.type,
    defaultValue: literalDefault(raw),
    unit: c.modifiers["unit"]?.replace(/^"|"$/g, ""),
    comment: c.comment,
    min: numOr(c.modifiers["min"]),
    max: numOr(c.modifiers["max"]),
  };
}

function numOr(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Build an index from the standard library plus optional extra roots.
 * Returns the index and the roots that were actually loaded.
 */
export function buildLibraryIndex(extraRoots: string[] = []): {
  index: LibraryIndex;
  loadedRoots: string[];
} {
  const index = new LibraryIndex();
  const loaded: string[] = [];
  // A root that contains another root is redundant, and indexing both parses
  // every file twice. The library directory and the individual versions inside
  // it are commonly both offered, which doubled the cost of opening the view.
  const unique = indexRoots([...LibraryIndex.discoverLibraryRoots(), ...extraRoots]);
  for (const root of unique) {
    try {
      index.addDirectory(root);
      loaded.push(root);
    } catch {
      /* ignore unreadable roots */
    }
  }
  return { index, loadedRoots: loaded };
}

/**
 * Load the component index, using a cache when it is still valid.
 *
 * Parsing the standard library costs seconds of main-thread work, and it was
 * being redone on every launch. The cache is keyed by the library roots and
 * their modification times, so installing or updating a library invalidates it
 * automatically rather than serving a stale index.
 *
 * A cache miss is never fatal: any failure falls back to a full index.
 */
export function loadLibraryIndex(opts: {
  roots: string[];
  cacheFile?: string;
  fsModule?: {
    readFileSync: (p: string, enc: string) => string;
    writeFileSync: (p: string, data: string) => void;
    statSync: (p: string) => { mtimeMs: number };
    existsSync: (p: string) => boolean;
  };
}): { index: LibraryIndex; loadedRoots: string[]; fromCache: boolean } {
  const fsModule = opts.fsModule ?? fs;
  const signature = (roots: string[]): string => {
    const parts: string[] = [`v${INDEX_CACHE_VERSION}`];
    for (const r of roots) {
      let mtime = 0;
      try {
        mtime = fsModule.statSync(r).mtimeMs;
      } catch {
        /* unreadable root is recorded as 0 and re-checked on every load */
      }
      parts.push(`${r}@${mtime}`);
    }
    return parts.join("|");
  };

  // Key on the roots that will actually be indexed, including those discovered
  // from the OpenModelica installation — not just the ones passed in. Keying on
  // the requested list alone would miss a change in what was loaded.
  const wanted = indexRoots([...LibraryIndex.discoverLibraryRoots(), ...opts.roots]);
  const key = signature(wanted);

  if (opts.cacheFile && fsModule.existsSync(opts.cacheFile)) {
    try {
      const raw = JSON.parse(fsModule.readFileSync(opts.cacheFile, "utf8")) as {
        key?: string;
        index?: unknown;
      };
      if (raw.key === key) {
        const restored = LibraryIndex.fromJSON(
          raw.index as { version?: number; classes?: ParsedClass[]; kinds?: [string, string][] }
        );
        if (restored && restored.size > 0) {
          return { index: restored, loadedRoots: wanted, fromCache: true };
        }
      }
    } catch {
      /* a corrupt cache is ignored and rebuilt */
    }
  }

  const { index, loadedRoots } = buildLibraryIndex(opts.roots);
  if (opts.cacheFile) {
    try {
      fsModule.writeFileSync(
        opts.cacheFile,
        JSON.stringify({ key, index: index.toJSON() })
      );
    } catch {
      /* a cache we cannot write is only a performance loss */
    }
  }
  return { index, loadedRoots, fromCache: false };
}

/**
 * The roots that will actually be indexed, with redundant ones removed.
 *
 * Exported because the cache key must describe the same set the index is built
 * from; keying on the requested list would miss a change in what was loaded.
 */
export function indexRoots(roots: string[]): string[] {
  const unique: string[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    // Skip a root that contains, or is contained by, one already kept. Both
    // directions matter: the candidate order depends on how the roots were
    // discovered, and indexing nested roots parses the same files twice.
    const redundant = unique.some(
      (kept) =>
        root === kept || root.startsWith(kept + path.sep) || kept.startsWith(root + path.sep)
    );
    if (redundant) continue;
    unique.push(root);
  }
  return unique;
}

/**
 * The top-level packages present in the index.
 *
 * Offering a fixed list meant whole domains were unreachable — `Modelica.Fluid`
 * and `Modelica.Mechanics.MultiBody` were indexed and worked, but could not be
 * searched for or dragged in. Deriving the list from the library keeps the
 * palette in step with what is actually installed.
 */
export function indexedPackages(index: LibraryIndex): string[] {
  const packages = new Set<string>();
  for (const name of index.allNames()) {
    const parts = name.split(".");
    if (parts.length < 2) continue;
    // Group under the OUTERMOST package, so `Modelica.Fluid.Sources.Boundary_pT`
    // is offered as `Modelica.Fluid`. Two levels is the usual depth for the
    // standard library; a library with a single top-level package collapses to
    // that package rather than to nothing.
    const depth = parts[0] === "Modelica" && parts.length >= 3 ? 2 : 1;
    packages.add(parts.slice(0, depth).join("."));
  }
  // Keep only packages that contain something offerable. The test is made on
  // the raw class table rather than through `listPlaceable`, which resolves
  // every candidate's inheritance chain: that costs about a second, and this
  // runs before the palette can be drawn at all.
  const kept = [...packages].filter((p) => index.hasPlaceableClass(p + "."));
  // Drop a package that is only a container for packages already listed. The
  // standard library's root `Modelica` holds no component of its own, and
  // offering it as well as `Modelica.Fluid`, `Modelica.Electrical` and the rest
  // would list the entire library twice under two different headings.
  return kept
    .filter((p) => !kept.some((other) => other !== p && other.startsWith(p + ".")))
    .sort();
}

/** One node of the package tree offered by the palette. */
export interface TreeNode {
  /** Short name, as shown. */
  name: string;
  /** Fully qualified name. */
  full: string;
  /** Sub-packages, sorted. Empty for a leaf. */
  children: TreeNode[];
  /**
   * False when the node only holds sub-packages, so it cannot be placed.
   * A package node is still worth showing — that is how a library is browsed.
   */
  placeable: boolean;
}

/**
 * The library as a tree of packages, in the shape OMEdit shows.
 *
 * Built from the class table rather than from `listPlaceable`, so browsing a
 * package does not have to resolve the inheritance of everything inside it. Only
 * the nodes actually rendered are turned into components, and only when they are
 * about to be drawn.
 *
 * Nested classes are included, because that is where MSL keeps most of its
 * components: `block Step` lives inside `Blocks/Sources.mo`, not in a file of
 * its own, and OMEdit shows it as a child of `Sources` for exactly that reason.
 */
export function buildPackageTree(index: LibraryIndex, root: string): TreeNode {
  const node: TreeNode = { name: root.split(".").pop() ?? root, full: root, children: [], placeable: false };
  const byFull = new Map<string, TreeNode>([[root, node]]);
  const prefix = root + ".";

  const ensure = (full: string): TreeNode => {
    const existing = byFull.get(full);
    if (existing) return existing;
    const parentFull = full.split(".").slice(0, -1).join(".");
    const parent = parentFull.startsWith(root) || parentFull === root
      ? ensure(parentFull === root ? root : parentFull)
      : node;
    const created: TreeNode = {
      name: full.split(".").pop() ?? full,
      full,
      children: [],
      placeable: false,
    };
    byFull.set(full, created);
    parent.children.push(created);
    return created;
  };

  for (const name of index.allNames()) {
    if (!name.startsWith(prefix)) continue;
    // Skipped before the parent is created, so no `Icons` folder appears: these
    // classes are pictures to inherit, not components to browse.
    if (isLibraryScaffolding(name)) continue;
    const cls = index.get(name);
    if (!cls) continue;
    const parentFull = name.split(".").slice(0, -1).join(".");
    const parent = ensure(parentFull === root ? root : parentFull);
    if (cls.kind === "model" || cls.kind === "block") {
      // A component: a leaf, unless it also contains classes of its own.
      const self = byFull.get(name) ?? {
        // Short name: the tree already shows the path as its nesting.
        name: name.split(".").pop() ?? name,
        full: name,
        children: [],
        placeable: false,
      };
      self.placeable = !cls.isPartial && (cls.icon.length > 0 || cls.componentIcons.length > 0);
      if (!byFull.has(name)) {
        byFull.set(name, self);
        parent.children.push(self);
      }
      continue;
    }
    if (cls.kind === "package") ensure(name);
  }

  const prune = (n: TreeNode): void => {
    n.children = n.children.filter((c) => c.children.length > 0 || c.placeable);
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    for (const c of n.children) prune(c);
  };
  prune(node);
  return node;
}
