/**
 * What a rewritten class no longer says.
 *
 * The writer is a normaliser: it re-indents, re-orders sections, resolves graphics into the
 * class's own coordinate system. What it may never do is DROP something the author wrote, and
 * this is the measurement that decides whether it has.
 *
 * The comparison is a multiset of identifiers, keywords, numbers and string contents, with
 * `annotation(…)` removed from both sides — annotations are the one part the writer really does
 * rewrite (a component keeps its `Placement`, a declaration should never have had one). Counts,
 * not just presence: a class that says `final` seven times and comes back with six has lost one.
 *
 * Built because a list of known-bad constructs is always one construct behind. `initial
 * equation`, declaration comments, `algorithm` sections, `partial`, `extends`, `protected`, the
 * class's own `Icon`, `final` inside a modifier, a `connect` to a connector of the class itself
 * — each was found by a person reading a file, and each would have been caught here on the day
 * it was written.
 */

/** Remove `annotation(…)` spans, balanced, so a nested annotation goes with its parent. */
export function stripAnnotations(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf("annotation", i);
    if (at < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, at);
    let depth = 0;
    let k = text.indexOf("(", at);
    for (; k < text.length; k++) {
      if (text[k] === "(") depth++;
      else if (text[k] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    i = k + 1;
  }
  return out;
}

/** Identifiers, keywords, numbers and string contents, in order, with comments removed. */
export function tokensOf(text: string): string[] {
  return (
    stripAnnotations(text)
      .replace(/\/\/[^\n]*/g, " ")
      .match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|"[^"]*"/g) ?? []
  );
}

function multiset(list: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of list) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/**
 * Tokens the source has more of than the rewrite, as `name` or `name×n`.
 *
 * Empty means the rewrite still says everything the source said. `protected` is exempt: a class
 * with several protected sections comes back with one, which is a normalisation of the same
 * declarations rather than a loss of them.
 */
export function missingTokens(source: string, rebuilt: string): string[] {
  const before = multiset(tokensOf(source));
  const after = multiset(tokensOf(rebuilt));
  const missing: string[] = [];
  for (const [tok, count] of before) {
    if (tok === "protected") continue;
    const have = after.get(tok) ?? 0;
    if (have < count) missing.push(count - have > 1 ? `${tok}×${count - have}` : tok);
  }
  return missing;
}
