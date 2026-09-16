/**
 * Matching for the component palette's search box.
 *
 * Typing `res` should find `Resistor`, `tank` should find `OpenTank`, and `cv`
 * should find `ConstantVoltage`. In a library of about 6,900 classes the exact
 * spelling is often the thing being looked for, so substring matching is not
 * enough.
 *
 * The scoring is the well-known fuzzy-match formulation: every character of the
 * query is matched in order, and each match scores by WHERE it landed —
 * adjacent to the previous one, at the start of the name, at the start of a
 * camel hump, or at a word boundary — with a penalty for skipped characters and
 * a normalisation by the length being searched.
 *
 * This replaced a series of hand-tuned bonuses that kept fixing one query and
 * breaking another. Measured against the real library, `tank` returned `Brake`
 * and `Rankine` while `OpenTank` ranked below both, because the earlier rule
 * scored a subsequence across the entire qualified path and unrelated segments
 * supplied the letters. The lesson taken: score one name with a principled
 * formula rather than accumulate special cases.
 *
 * A query is matched against the class name first and, failing that, against the
 * path flattened from a segment it opens — which is how a Modelica path is typed
 * from memory (`elreba` for `Electrical...Basic.Resistor`).
 */

export interface FuzzyMatch {
  score: number;
  /** Character positions in the candidate that matched, for highlighting. */
  positions: number[];
}

/* ---- scoring weights ---- */
const SCORE_ADJACENT = 12;
const SCORE_SEPARATOR = 8;
const SCORE_CAMEL = 10;
const SCORE_FIRST_LETTER = 14;
const SCORE_MATCH = 6;
const PENALTY_LEADING = -4;
const PENALTY_MAX = -12;
const PENALTY_UNMATCHED = -1;

/** True for the separators that mark a word boundary in a class path. */
function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === "." || ch === "_" || ch === " ";
}

/** True when `ch` starts a camel hump after a lower-case letter or a digit. */
function isCamelStart(previous: string | undefined, ch: string | undefined): boolean {
  if (previous === undefined || ch === undefined) return false;
  return /[a-z0-9]/.test(previous) && /[A-Z]/.test(ch);
}

interface Scored {
  score: number;
  positions: number[];
}

/**
 * Match `query` inside `text` as late as possible.
 *
 * Matching forwards greedily is wrong when the query's characters are spread
 * over a path: for `lareba` in `...Electrical.Analog.Basic.Resistor`, the
 * forward scan takes the `l` of "Electrical" and then has no `a` left before it.
 * Working backwards takes the LAST possible position for each character, which
 * leaves room for the earlier ones — the longest match that exists.
 */
function scoreLatest(text: string, query: string): Scored | null {
  const positions = new Array<number>(query.length);
  let limit = text.length;
  for (let k = query.length - 1; k >= 0; k--) {
    const want = query[k];
    let found = -1;
    for (let i = limit - 1; i >= 0; i--) {
      if (text[i] === want) {
        found = i;
        break;
      }
    }
    if (found < 0) return null;
    positions[k] = found;
    limit = found;
  }
  // Score the span with the same rules as everywhere else.
  return scorePositions(text, query, positions);
}

/**
 * Score `query` against `text` as an ordered subsequence.
 *
 * Returns null when the query does not match at all. `query` must be
 * lower-case; `text` may be any case, and positions are reported against it.
 */
function score(text: string, query: string): Scored | null {
  if (!query) return { score: 0, positions: [] };
  if (query.length > text.length) return null;

  // Greedy forward match. For the palette's short queries this is
  // indistinguishable from an exhaustive search and costs a fraction as much,
  // which matters because every keystroke scans the whole library.
  const positions: number[] = [];
  let from = 0;
  for (const want of query) {
    let found = -1;
    for (let i = from; i < text.length; i++) {
      if (text[i].toLowerCase() === want) {
        found = i;
        break;
      }
    }
    if (found < 0) return null;
    positions.push(found);
    from = found + 1;
  }

  return scorePositions(text, query, positions);
}

/** Apply the scoring rules to an already-determined set of match positions. */
function scorePositions(text: string, query: string, positions: number[]): Scored {
  let total = 0;
  for (let k = 0; k < positions.length; k++) {
    const at = positions[k];
    const previous = k > 0 ? positions[k - 1] : -1;
    let points = SCORE_MATCH;

    if (at === previous + 1) points += SCORE_ADJACENT;
    if (isBoundary(text[at - 1]) || isCamelStart(text[at - 1], text[at])) {
      points += SCORE_CAMEL;
    }
    // Landing on a separator is worth less than landing on a letter.
    if (text[at] === "." || text[at] === "_" || text[at] === " ") points += SCORE_SEPARATOR;

    if (at === 0) {
      points += SCORE_FIRST_LETTER;
    } else {
      const gap = at - previous - 1;
      if (gap > 0) points += Math.max(PENALTY_MAX, gap * PENALTY_UNMATCHED * 2);
    }
    total += points;
  }

  total += Math.max(PENALTY_LEADING * 2, positions[0] * PENALTY_LEADING);
  // Normalise by the text examined, so a long name is not rewarded for merely
  // containing the letters somewhere.
  total += Math.max(0, text.length - query.length) * PENALTY_UNMATCHED;
  return { score: total, positions };
}

/** The part of a path a query is matched against directly. */
function directTarget(text: string): string {
  const parts = text.split(".");
  return parts.length <= 2 ? text : parts.slice(-2).join(".");
}

/**
 * Match the query against the class name, then against the name with its parent
 * segment, taking whichever explains it better.
 */
function nameScore(text: string, query: string): Scored | null {
  const name = text.split(".").pop()!;
  const nameOffset = text.length - name.length;

  const onName = score(name, query);
  if (onName) {
    // A hit on the class name itself always beats one on its package.
    return { score: onName.score + 60, positions: onName.positions.map((p) => p + nameOffset) };
  }

  const target = directTarget(text);
  if (target.length === name.length) return null;
  const onTarget = score(target, query);
  if (!onTarget) return null;
  const targetOffset = text.length - target.length;
  return { score: onTarget.score, positions: onTarget.positions.map((p) => p + targetOffset) };
}

/**
 * Match a query that opens one of the trailing segments.
 *
 * The anchor is what keeps this honest: the query's first character must be the
 * first character of a segment. Without it the rule is not a rule — scoring
 * every segment initial matched `tank` against
 * `Mechanics.Translational.Components.Brake`, because 't' begins
 * "Translational" and a-n-k occur somewhere later in the path.
 *
 * The remainder may span the whole flattened tail, which is what reaches an
 * abbreviated camel-case name: `cvs` for ConstantVoltage, whose letters after
 * the 'C' are 'v' in Voltage and 's' in the following Sources segment.
 */
const TRAILING_SEGMENTS = 8;

function pathScore(text: string, query: string): Scored | null {
  const parts = text.split(".");
  if (parts.length < 2) return null;
  const from = Math.max(0, parts.length - TRAILING_SEGMENTS);
  const tail = parts.slice(from);
  const flat = tail.join("").toLowerCase().replace(/[_.]/g, "");

  // Where each segment begins inside the flattened tail.
  const starts: number[] = [];
  let at = 0;
  for (const part of tail) {
    starts.push(at);
    at += part.replace(/[_.]/g, "").length;
  }

  if (query.length === 1) {
    const first = starts.find((s) => flat[s] === query[0]);
    return first === undefined ? null : { score: 100 - first, positions: [] };
  }

  // Match the query's TAIL first, as late as possible, then find an anchor
  // before it. Taking the anchor first steals the character the tail needs:
  // with `elareba`, anchoring on the E of Electrical left the tail `lareba` to
  // claim the S that its own last letter required, and no match existed.
  const rest = scoreLatest(flat, query.slice(1));
  if (!rest) return null;

  let best: Scored | null = null;
  for (const s of starts) {
    // The anchor must be a segment's FIRST character. This is what stops the
    // rule from being meaningless: without it `tank` matched
    // `Mechanics.Translational.Components.Brake`, 't' from Translational and
    // a-n-k from later in the path.
    if (s >= rest.positions[0]) break;
    if (flat[s] !== query[0]) continue;

    const positions = [s, ...rest.positions];
    const scored = scorePositions(flat, query, positions);
    // How many of the query's characters opened a segment: initials, typed
    // deliberately, rank above a loose span.
    const opened = positions.filter((p) => starts.includes(p)).length;
    const score = scored.score + 60 + opened * 20 - s;
    if (!best || score > best.score) best = { score, positions: [] };
  }
  return best;
}

/**
 * Match a query against a qualified class name.
 *
 * The class name is tried first and the path only as a fallback, so a real match
 * cannot be outranked by letters found scattered across the package.
 */
export function fuzzyMatch(text: string, query: string): FuzzyMatch | null {
  if (!query) return { score: 0, positions: [] };
  if (query.length > text.length) return null;

  const byName = nameScore(text, query);
  if (byName) return byName;
  return pathScore(text, query);
}

/**
 * Rank candidates for a query.
 *
 * `names` is scanned in full — a few thousand short strings, a few milliseconds
 * — and only the winners are resolved into drawable components.
 */
export function fuzzyFilter(
  names: readonly string[],
  query: string,
  limit = 0
): Array<{ name: string; score: number; positions: number[] }> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const hits: Array<{ name: string; score: number; positions: number[] }> = [];
  for (const name of names) {
    const m = fuzzyMatch(name, q);
    if (m) hits.push({ name, score: m.score, positions: m.positions });
  }

  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return limit > 0 ? hits.slice(0, limit) : hits;
}

/**
 * True when `name` belongs to one of `prefixes`.
 *
 * Used for excluding whole libraries from search. The comparison is on segment
 * boundaries, so excluding `Modelica.Electrical` does not also exclude a
 * hypothetical `Modelica.ElectricalExtra`.
 */
export function isUnderAny(name: string, prefixes: readonly string[]): boolean {
  for (const raw of prefixes) {
    const prefix = raw.trim();
    if (!prefix) continue;
    if (name === prefix || name.startsWith(prefix + ".")) return true;
  }
  return false;
}
