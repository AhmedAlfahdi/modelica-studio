/**
 * Modelica highlighting and completion vocabulary.
 *
 * A small hand-written tokenizer rather than a grammar. The editor only needs
 * enough to colour code and to offer sensible completions, and a tokenizer that
 * cannot fail is worth more here than a parser that can: highlighting must keep
 * working on the half-finished text that exists while someone is typing.
 */

import type { LibraryIndex } from "../modelica/library";

/** What a stretch of source text is, for colouring purposes. */
export type TokenKind =
  | "plain"
  | "comment"
  | "string"
  | "keyword"
  | "type"
  | "number"
  | "operator"
  | "annotation"
  | "builtin";

export interface Token {
  start: number;
  end: number;
  kind: TokenKind;
}

/**
 * Reserved words.
 *
 * Note that `model`, `equation` and `end` are here as well as the control-flow
 * words: to a reader they are punctuation, not identifiers, and colouring them
 * differently is what makes the block structure visible at a glance.
 */
const KEYWORDS = new Set([
  "algorithm", "and", "annotation", "assert", "block", "break", "class",
  "connect", "connector", "constant", "constrainedby", "der", "discrete",
  "each", "else", "elseif", "elsewhen", "encapsulated", "end", "enumeration",
  "equation", "expandable", "extends", "external", "false", "final", "flow",
  "for", "function", "if", "import", "in", "initial", "inner", "input",
  "is", "loop", "model", "not", "operator", "or", "outer", "output", "package",
  "parameter", "partial", "pre", "protected", "public", "record", "redeclare",
  "replaceable", "return", "stream", "then", "true", "type", "when", "while",
  "within",
]);

/** Builtin scalar types and the operators that look like functions. */
const BUILTINS = new Set([
  "Real", "Integer", "Boolean", "String", "Clock", "Time",
  "der", "pre", "edge", "change", "initial", "terminal", "sample", "smooth",
  "noEvent", "homotopy", "semiLinear", "inStream", "actualStream", "spatialDistribution",
  "abs", "sign", "sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
  "sinh", "cosh", "tanh", "exp", "log", "log10", "min", "max", "sum", "product",
  "mod", "rem", "div", "ceil", "floor", "integer", "String", "ndims", "size",
  "scalar", "vector", "matrix", "transpose", "outerProduct", "symmetric",
  "cross", "skew", "identity", "diagonal", "zeros", "ones", "fill", "linspace",
  "cat", "promote", "delay", "cardinality", "noClock", "previous", "hold",
  "inStream", "backSample", "shiftSample", "subSample", "superSample",
]);

/** Operators and punctuation that get their own colour. */
const OPERATORS = new Set([
  ":=", "=", "<", ">", "<=", ">=", "==", "<>", "+", "-", "*", "/", "^", ".^",
  ".+", ".-", ".*", "./", "(", ")", "[", "]", "{", "}", ",", ";", ":", "|",
]);

/** Is this word reserved, and how should it be coloured? */
export function classifyWord(word: string): TokenKind {
  if (KEYWORDS.has(word)) return "keyword";
  if (BUILTINS.has(word)) return "builtin";
  // A capitalised identifier is a type or a class name by convention, which is
  // how the Modelica standard is written throughout.
  if (/^[A-Z]/.test(word)) return "type";
  return "plain";
}

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/**
 * Split source into coloured spans.
 *
 * Never throws: an unterminated comment or string simply runs to the end of the
 * text, which is what makes highlighting usable while the text is being typed.
 */
export function tokenize(source: string): Token[] {
  const out: Token[] = [];
  const n = source.length;
  let i = 0;

  const push = (start: number, end: number, kind: TokenKind) => {
    if (end > start) out.push({ start, end, kind });
  };

  while (i < n) {
    const ch = source[i];

    // Line comment. Modelica has no block comments, and `//` inside a string is
    // handled by the string branch below because strings are matched first.
    if (ch === "/" && source[i + 1] === "/") {
      const start = i;
      while (i < n && source[i] !== "\n") i++;
      push(start, i, "comment");
      continue;
    }

    if (ch === '"') {
      const start = i;
      i++;
      while (i < n) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      push(start, i, "string");
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      while (i < n && isIdentPart(source[i])) i++;
      const word = source.slice(start, i);
      push(start, i, classifyWord(word));
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(source[i + 1] ?? ""))) {
      const start = i;
      while (i < n && /[0-9]/.test(source[i])) i++;
      if (source[i] === ".") {
        i++;
        while (i < n && /[0-9]/.test(source[i])) i++;
      }
      if (source[i] === "e" || source[i] === "E") {
        const mark = i;
        i++;
        if (source[i] === "+" || source[i] === "-") i++;
        if (isDigit(source[i] ?? "")) {
          while (i < n && isDigit(source[i])) i++;
        } else {
          i = mark; // not an exponent after all
        }
      }
      push(start, i, "number");
      continue;
    }

    // Two-character operators before single ones, or `<=` would be read as `<`.
    const two = source.slice(i, i + 2);
    if (OPERATORS.has(two)) {
      push(i, i + 2, "operator");
      i += 2;
      continue;
    }
    if (OPERATORS.has(ch)) {
      push(i, i + 1, "operator");
      i++;
      continue;
    }

    // Anything else (whitespace, stray characters) is emitted as plain so that
    // the concatenated tokens always reproduce the source exactly.
    const start = i;
    i++;
    while (i < n && !isIdentStart(source[i]) && !isDigit(source[i]) && source[i] !== '"' &&
           !OPERATORS.has(source[i]) && !(source[i] === "/" && source[i + 1] === "/")) {
      i++;
    }
    push(start, i, "plain");
  }

  return out;
}

/** Escape for insertion into HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Render highlighted HTML.
 *
 * The output must be byte-for-byte the same length in characters as the input
 * once tags are stripped, or the highlight layer drifts out of alignment with the
 * textarea on top of it.
 */
/**
 * The highlighted runs as TEXT, for callers that paint the DOM themselves.
 *
 * `highlight` returns an HTML string, and assigning that string to `innerHTML`
 * reads it through the HTML parser — which preprocesses its input: CRLF and a lone
 * CR become LF, and a NUL byte is dropped outright. The code editor's text is what
 * the plugin adopts as the model's source and then saves, so merely OPENING code
 * mode on a model saved with Windows line endings rewrote every line ending in the
 * file. Text nodes have no such preprocessing.
 */
export function highlightRuns(source: string): Array<{ text: string; kind: string }> {
  const tokens = tokenize(source);
  const runs: Array<{ text: string; kind: string }> = [];
  let cursor = 0;
  for (const t of tokens) {
    if (t.start > cursor) runs.push({ text: source.slice(cursor, t.start), kind: "plain" });
    runs.push({ text: source.slice(t.start, t.end), kind: t.kind });
    cursor = t.end;
  }
  if (cursor < source.length) runs.push({ text: source.slice(cursor), kind: "plain" });
  return runs;
}

export function highlight(source: string): string {
  const tokens = tokenize(source);
  let html = "";
  let cursor = 0;
  for (const t of tokens) {
    if (t.start > cursor) html += escapeHtml(source.slice(cursor, t.start));
    const text = escapeHtml(source.slice(t.start, t.end));
    html += t.kind === "plain" ? text : `<span class="mst-${t.kind}">${text}</span>`;
    cursor = t.end;
  }
  if (cursor < source.length) html += escapeHtml(source.slice(cursor));
  // A trailing newline collapses in a <pre>, which would misalign the last line.
  return html + "\n";
}

/**
 * Candidates for autocompletion.
 *
 * Library class names come from the index rather than from a list here, so the
 * completions are the classes this machine can actually compile against.
 */
export interface Completion {
  label: string;
  /** Text actually inserted. */
  insert: string;
  detail: string;
  kind: "keyword" | "class" | "builtin" | "snippet";
}

/** Ready-made snippets: the shapes that are tedious to type from memory. */
export const SNIPPETS: Completion[] = [
  {
    label: "model",
    insert: 'model Name "description"\n  \nequation\n  \nend Name;',
    detail: "a new model",
    kind: "snippet",
  },
  {
    label: "connect",
    insert: "connect(a.p, b.p);",
    detail: "join two connectors",
    kind: "snippet",
  },
  {
    label: "when",
    insert: "when condition then\n  \nend when;",
    detail: "an event clause",
    kind: "snippet",
  },
  {
    label: "if-expression",
    insert: "if condition then a else b",
    detail: "a conditional expression",
    kind: "snippet",
  },
  {
    label: "parameter",
    insert: "parameter Real x=1",
    detail: "a tunable constant",
    kind: "snippet",
  },
];

/**
 * Completions for a prefix.
 *
 * Keyword and snippet matches come first: when someone types `par` they almost
 * always mean the `parameter` keyword, not a library class that happens to
 * contain those letters.
 */
export function completionsFor(prefix: string, library: LibraryIndex | undefined, limit = 60): Completion[] {
  const q = prefix.toLowerCase();
  if (!q) return [];

  const out: Completion[] = [];

  for (const s of SNIPPETS) {
    if (s.label.toLowerCase().startsWith(q)) out.push(s);
  }
  for (const k of KEYWORDS) {
    if (k.toLowerCase().startsWith(q)) {
      out.push({ label: k, insert: k, detail: "keyword", kind: "keyword" });
    }
  }

  if (library && q.length >= 2) {
    // Search the whole library, not the palette: the palette is a curated
    // subset, and completion should offer anything that will compile.
    const names = library.listPlaceable(q.toUpperCase(), limit);
    for (const def of names) {
      out.push({
        label: def.name.split(".").pop() ?? def.name,
        insert: def.name,
        detail: def.name,
        kind: "class",
      });
    }
  }

  // Case-insensitive prefix matches first, then anything containing the query.
  const ranked = out.filter((c) => c.label.toLowerCase().startsWith(q));
  const rest = out.filter((c) => !c.label.toLowerCase().startsWith(q));
  return [...ranked, ...rest].slice(0, limit);
}

/* ---- editing operations, kept pure so they can be tested ---- */

/** The identifier fragment ending at the caret, and where it starts. */
export function prefixAt(source: string, caret: number): { text: string; from: number } {
  let i = Math.max(0, Math.min(caret, source.length));
  const end = i;
  while (i > 0 && /[A-Za-z0-9_.]/.test(source[i - 1])) i--;
  return { text: source.slice(i, end), from: i };
}

/**
 * Apply a completion, returning the new text and caret position.
 *
 * A class is inserted fully qualified. The fragment already typed is replaced
 * rather than appended to, so accepting `Modelica.Electrical...` after typing
 * `Modelica.Elec` must not produce the prefix twice.
 */
export function applyCompletion(
  source: string,
  caret: number,
  item: Completion
): { text: string; caret: number } {
  const { from } = prefixAt(source, caret);
  const before = source.slice(0, from);
  const after = source.slice(caret);
  const insert = item.kind === "class" ? item.insert : item.insert;
  return { text: before + insert + after, caret: before.length + insert.length };
}

/**
 * The indent to use for a new line, and whether to add a level.
 *
 * Typing a model body otherwise means re-indenting every line by hand, which is
 * the single most tedious part of writing Modelica without an editor that knows
 * the block structure.
 */
export function indentForNewline(source: string, caret: number): string {
  const before = source.slice(0, caret);
  const line = before.slice(before.lastIndexOf("\n") + 1);
  const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
  const trimmed = before.replace(/[ \t]*$/, "");
  const deeper =
    /(\bmodel\b|\bequation\b|\balgorithm\b|\bwhen\b|\bif\b|\bfor\b|\bwhile\b|\bfunction\b|\brecord\b|\bblock\b|\bpackage\b|\bconnector\b)[^;\n]*$/.test(
      trimmed
    );
  return indent + (deeper ? "  " : "");
}

/* ---- embed directives ---- */

/** The options a `//@` directive line can carry. */
export interface DirectiveOptions {
  stopTime?: number;
  height?: number;
  showPlot?: boolean;
  autoSimulate?: boolean;
}

/**
 * Format a `//@` directive line, or return "" when there is nothing to say.
 *
 * Used when a block is written back to a note. The directive was being DROPPED
 * on every write-back, because it is parsed out of the source and only the
 * re-serialized Modelica was written: editing a block in the studio silently
 * removed the line that set its simulation span, and the block then inherited
 * whatever the studio last used.
 */
export function formatDirective(opts: DirectiveOptions): string {
  const parts: string[] = [];
  // Emitted only when set, so a block with no options gets no directive line
  // rather than an empty marker.
  if (opts.stopTime !== undefined && opts.stopTime > 0) {
    parts.push(`time=${trimNumber(opts.stopTime)}`);
  }
  if (opts.height !== undefined && opts.height > 0) parts.push(`height=${Math.round(opts.height)}`);
  if (opts.showPlot === false) parts.push("edit");
  else if (opts.showPlot === true) parts.push("result");
  if (opts.autoSimulate === false) parts.push("manual");
  return parts.length ? `//@ ${parts.join(" ")}` : "";
}

/** Avoid `time=5.0000000001` from floating-point arithmetic. */
function trimNumber(n: number): string {
  return String(Number(n.toFixed(4)));
}

/**
 * Put a directive back at the head of a block body.
 *
 * The directive belongs to the BLOCK, and the note's own text does not carry it
 * once parsed, so it has to be re-attached before writing.
 */
export function withDirective(body: string, opts: DirectiveOptions): string {
  const line = formatDirective(opts);
  const trimmed = body.replace(/^\s*\n/, "");
  return line ? `${line}\n${trimmed}` : trimmed;
}
