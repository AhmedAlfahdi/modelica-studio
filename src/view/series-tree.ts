/**
 * The variable list as a tree.
 *
 * A Modelica result names every variable by its path in the model —
 * `chopper.diode.i`, `der(capacitor.v)` — so a flat list repeats the same prefix
 * on every row. For the buck converter that is `chopper.` on most of them, and
 * reading past the prefix to the quantity is the whole job of the list. Folding
 * the names into a tree is what makes the prefix a heading instead of noise: one
 * row per component, one row per variable, and the quantities that share a
 * component sit together.
 *
 * This module is the RULES only — no DOM, no result data beyond the names — so
 * the shape of the list is a pure function that can be tested without a browser,
 * the way `series.ts` is. The three rules that are decisions rather than parsing:
 *
 *  - A group with a handful of variables opens on sight (a few rows, and it
 *    saves a click); a group with dozens stays closed, because opening those is
 *    what made the list a wall of names in the first place.
 *  - `der(x)` and `previous(x)` are wrappers, not components, so
 *    `inductor.i` and `der(inductor.i)` sit together under `inductor` instead of
 *    in two unrelated places. Array elements hang under their array (`x` →
 *    `[1]`, `[2]`), which is what makes a vector navigable rather than a hundred
 *    rows differing in their last two characters.
 *  - A filter is a search, and a search result folded away is not a result: when
 *    one is active, every group on the way to a match is open, whatever the
 *    reader had collapsed.
 *
 * The row budget (the list shows a window, not everything) is applied here too,
 * so "the list is cut short" is a fact this module reports rather than something
 * the renderer guesses at. It counts VARIABLES, not rows: a heading is not
 * something the reader can switch on, so it does not use up the space reserved
 * for the things they can.
 */

/** One node of the variable tree. */
export interface TraceNode {
  /**
   * The node's identity in the tree: its path, with wrappers folded into the
   * segment they belong to (`inductor.der(i)`, not `der(inductor.i)`). Stable
   * across runs of the same model, which is what lets expansion survive one.
   */
  path: string;
  /** The row's text: the last segment, `der(v)`, or an index like `[3]`. */
  label: string;
  /** The result's own name for the variable, when the node is one. */
  name?: string;
  children: TraceNode[];
}

/** A node with the depth it is drawn at, and whether its children are shown. */
export interface TraceRow {
  node: TraceNode;
  depth: number;
  open: boolean;
}

export interface TraceRows {
  rows: TraceRow[];
  /** Variables the filter and preset kept, on screen or folded away. */
  matched: number;
  /** Variables actually in `rows`. */
  shown: number;
  /** True when the row budget cut the list short. */
  truncated: boolean;
}

/**
 * How many variables a group may hold and still open by itself.
 *
 * Six is about what fits under a heading without the heading being lost in its
 * own contents, and it is what makes the first view of a small model complete:
 * every group in a model like the buck converter is small, so nothing is hidden
 * behind a click. A group of forty stays closed and says so with its count.
 */
const SMALL_GROUP = 6;

/**
 * A dot splits a path — except inside a quoted identifier (`'a.b'.c` is one
 * component, not two) and except in front of an array index (`cell[2].v`), where
 * the brackets are part of the name rather than a step down. OMEdit splits names
 * by the same two rules, which is where the shape of this list comes from.
 */
const SPLIT_PATH = /\.(?=(?:[^']*'[^']*')*[^']*$)(?![^[\]]*\])/;

/** `der(x)` / `previous(x)`, outermost first. */
const WRAPPER = /^(der|previous)\(([\s\S]*)\)$/;

/**
 * The segments of a result variable name, as the tree draws them.
 *
 * `der(inductor.i)` becomes `["inductor", "der(i)"]`: the variable lives where
 * its state lives, and the wrapper stays on the label where it reads as a
 * qualifier rather than as a component nobody declared. A wrapper on an array
 * element attaches to the array (`der(x[1])` → `["der(x)", "[1]"]`) so the
 * element is still an element of the thing being differentiated.
 */
export function traceSegments(name: string): string[] {
  let wrapper = "";
  let inner = name;
  for (;;) {
    const match = WRAPPER.exec(inner);
    if (!match) break;
    wrapper += `${match[1]}(`;
    inner = match[2];
  }

  let parts = inner.split(SPLIT_PATH).filter((part) => part.length > 0);
  if (parts.length === 0) parts = [inner];

  // An index is its own step down: `x[1]` is a child of `x`, not a name of its
  // own, so the array can be collapsed as one thing.
  const last = parts[parts.length - 1];
  const bracket = last.lastIndexOf("[");
  if (bracket > 0) parts = [...parts.slice(0, -1), last.slice(0, bracket), last.slice(bracket)];

  if (wrapper) {
    const count = wrapper.length - wrapper.replace(/\(/g, "").length;
    // The label goes on the variable, which for an array element is the array.
    const target =
      parts.length > 1 && parts[parts.length - 1].startsWith("[") ? parts.length - 2 : parts.length - 1;
    parts[target] = `${wrapper}${parts[target]}${")".repeat(count)}`;
  }
  return parts;
}

/**
 * Fold result variable names into a tree, in the order the result lists them.
 *
 * Order is kept rather than sorted: the list has always been in simulation order
 * and never reordered, because a list that rearranges itself as the reader works
 * through it moves the row out from under the pointer. A group therefore appears
 * where its first variable appears.
 */
export function buildTraceTree(names: string[]): TraceNode[] {
  const roots: TraceNode[] = [];
  const byPath = new Map<string, TraceNode>();

  for (const name of names) {
    const segments = traceSegments(name);
    let parent: TraceNode | undefined;
    let path = "";
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      path = path ? `${path}.${segment}` : segment;
      let node = byPath.get(path);
      if (!node) {
        node = { path, label: segment, children: [] };
        byPath.set(path, node);
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
      // A connector is a variable AND has members: `pin` is in the result, and so
      // is `pin.v`. Both facts live on one node.
      if (i === segments.length - 1) node.name = name;
      parent = node;
    }
  }
  return roots;
}

/** The variables under a node, and how many of them are being drawn. */
export function traceCounts(
  node: TraceNode,
  drawn: ReadonlySet<string> = new Set()
): { total: number; drawn: number } {
  let total = node.name === undefined ? 0 : 1;
  let shown = node.name !== undefined && drawn.has(node.name) ? 1 : 0;
  for (const child of node.children) {
    const counts = traceCounts(child, drawn);
    total += counts.total;
    shown += counts.drawn;
  }
  return { total, drawn: shown };
}

/** Every group path in the tree, for "expand all". */
export function allGroupPaths(roots: TraceNode[]): Set<string> {
  const paths = new Set<string>();
  const walk = (node: TraceNode): void => {
    if (node.children.length === 0) return;
    paths.add(node.path);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return paths;
}

/**
 * The groups open the first time a result is listed.
 *
 * The top level opens because it is the map of the model — one row per
 * component. Small groups open because they cost a few rows and save a click.
 * Every group holding a drawn trace opens, because the traces the reader chose
 * are the ones they must be able to see and switch off again. Nothing else
 * opens: that is the difference between a tree and a wall.
 */
export function initialOpenPaths(
  roots: TraceNode[],
  options: { drawn?: Iterable<string>; smallGroup?: number } = {}
): Set<string> {
  const drawn = new Set(options.drawn ?? []);
  const smallGroup = options.smallGroup ?? SMALL_GROUP;
  const open = new Set<string>();

  const walk = (node: TraceNode, depth: number): void => {
    if (node.children.length > 0) {
      const counts = traceCounts(node, drawn);
      if (depth === 0 || counts.total <= smallGroup || counts.drawn > 0) open.add(node.path);
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return open;
}

/**
 * The rows to draw: the tree with the filter, the presets and the reader's
 * expansion applied.
 *
 * `match` is the filter and the preset as one predicate over result names —
 * composed by the caller, so this stays a function of names and facts. With a
 * match active the groups on the way to a match are open regardless of
 * `expanded`: the reader asked to see those variables, and a group between them
 * and the screen would be answering a different question.
 */
export function traceRows(
  roots: TraceNode[],
  options: {
    expanded?: ReadonlySet<string>;
    match?: (name: string) => boolean;
    budget?: number;
    /** Groups the reader has opened or closed by hand. */
    decided?: ReadonlySet<string>;
  } = {}
): TraceRows {
  const expanded = options.expanded ?? new Set<string>();
  const match = options.match;
  const decided = options.decided ?? new Set<string>();
  const budget = options.budget ?? Number.POSITIVE_INFINITY;
  const rows: TraceRow[] = [];
  let matched = 0;
  let shown = 0;
  let truncated = false;

  const isMatch = (node: TraceNode): boolean =>
    node.name !== undefined && (match === undefined || match(node.name));

  const kept = (node: TraceNode): boolean => isMatch(node) || node.children.some(kept);

  const countMatched = (node: TraceNode): number => {
    let count = isMatch(node) ? 1 : 0;
    for (const child of node.children) count += countMatched(child);
    return count;
  };

  const emit = (node: TraceNode, depth: number): TraceRow[] => {
    if (!kept(node)) return [];
    if (isMatch(node) && shown >= budget) {
      truncated = true;
      return [];
    }
    const children = node.children.filter(kept);
    // A search opens the groups on the way to its own answers, because the rows it keeps ARE
    // the answer — but not a group the reader has opened or closed themselves. Without that,
    // every twisty in the list did nothing at all while a preset or a filter was on: it drew a
    // chevron, answered the click, said "Collapse pipe" to a screen reader, and nothing moved.
    // Reported as "sometimes the collapsing of traces does not work", and the sometimes was
    // exactly this.
    const open =
      children.length > 0 &&
      (expanded.has(node.path) || (match !== undefined && !decided.has(node.path)));
    const own: TraceRow[] = [];
    if (isMatch(node)) shown++;
    own.push({ node, depth, open });
    if (open) for (const child of children) own.push(...emit(child, depth + 1));
    // A heading that was OPENED and still has nothing under it is not a row: the
    // budget took its contents, and a group the reader can open onto nothing is
    // worse than the line that says the list was cut short. A CLOSED heading is
    // the opposite case — its contents are deliberately not drawn, and the row is
    // the only thing that says they exist.
    if (!isMatch(node) && open && own.length === 1) return [];
    return own;
  };

  for (const root of roots) {
    matched += countMatched(root);
    rows.push(...emit(root, 0));
  }
  return { rows, matched, shown, truncated };
}
