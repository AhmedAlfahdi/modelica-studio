/**
 * Minimal but correct Modelica lexer.
 *
 * Handles the lexical forms that matter for reading and round-tripping
 * diagrams and packages:
 *   - line comments   slash-slash to end of line
 *   - block comments  slash-star ... star-slash (nestable per MLS)
 *   - strings         quoted, with backslash escapes
 *   - identifiers, keywords, numbers
 *   - punctuation used by annotations: ( ) [ ] { } , ; : = .
 *
 * Deliberately NOT a full Modelica lexer (no operator overloading on
 * `'` quoted identifiers beyond passthrough, no string templating).
 */

export type TokenType =
  | "ident"
  | "keyword"
  | "number"
  | "string"
  | "punct"
  | "eof";

export interface Token {
  type: TokenType;
  value: string;
  /** Byte offset of the token start, for error reporting / splicing. */
  start: number;
  end: number;
  /** True when the token was followed by a line break (used for annotation layout). */
  newlineBefore?: boolean;
}

const KEYWORDS = new Set([
  "algorithm", "and", "annotation", "as", "block", "break", "class",
  "connect", "connector", "constant", "constrainedby", "der", "discrete",
  "each", "else", "elseif", "elsewhen", "encapsulated", "end", "enumeration",
  "equation", "expandable", "extends", "external", "false", "final", "flow",
  "for", "function", "if", "import", "impure", "in", "initial", "inner",
  "input", "loop", "model", "not", "operator", "or", "outer", "output",
  "package", "parameter", "partial", "protected", "public", "pure", "record",
  "redeclare", "replaceable", "return", "stream", "then", "true", "type",
  "when", "while", "within", "zeroDerivative",
]);

/**
 * Tokenize Modelica source.
 *
 * `annotatedComments` controls whether annotation-bearing comments are kept.
 * They are skipped entirely, because we re-emit from the structured model
 * rather than preserving raw text.
 */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  let sawNewline = false;

  const push = (type: TokenType, value: string, start: number, end: number) => {
    tokens.push({ type, value, start, end, newlineBefore: sawNewline });
    sawNewline = false;
  };

  while (i < n) {
    const c = src[i];

    // Whitespace / newlines
    if (c === "\n") {
      sawNewline = true;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\f") {
      i++;
      continue;
    }

    // Line comment
    if (c === "/" && src[i + 1] === "/") {
      i += 2;
      while (i < n && src[i] !== "\n") i++;
      continue;
    }

    // Block comment (nestable)
    if (c === "/" && src[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (src[i] === "/" && src[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (src[i] === "*" && src[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          if (src[i] === "\n") sawNewline = true;
          i++;
        }
      }
      continue;
    }

    // String literal
    if (c === '"') {
      const start = i;
      i++;
      let out = "";
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < n) {
          const esc = src[i + 1];
          out += esc === "n" ? "\n" : esc === "t" ? "\t" : esc === '"' ? '"' : esc === "\\" ? "\\" : esc;
          i += 2;
        } else {
          out += src[i];
          i++;
        }
      }
      i++; // closing quote
      push("string", out, start, i);
      continue;
    }

    // Number
    if (isDigit(c) || (c === "." && isDigit(src[i + 1]))) {
      const start = i;
      while (i < n && (isDigit(src[i]) || src[i] === ".")) i++;
      if (i < n && (src[i] === "e" || src[i] === "E")) {
        i++;
        if (i < n && (src[i] === "+" || src[i] === "-")) i++;
        while (i < n && isDigit(src[i])) i++;
      }
      push("number", src.slice(start, i), start, i);
      continue;
    }

    // Identifier / keyword
    if (isIdentStart(c)) {
      const start = i;
      while (i < n && isIdentPart(src[i])) i++;
      const word = src.slice(start, i);
      push(KEYWORDS.has(word) ? "keyword" : "ident", word, start, i);
      continue;
    }

    // Punctuation
    push("punct", c, i, i + 1);
    i++;
  }

  tokens.push({ type: "eof", value: "", start: n, end: n });
  return tokens;
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}
function isIdentStart(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
}
function isIdentPart(c: string): boolean {
  return isIdentStart(c) || isDigit(c);
}
