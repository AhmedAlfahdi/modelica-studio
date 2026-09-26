/**
 * Modelica expressions as LaTeX, for display.
 *
 * The panel already shows the equation it solved, in monospace, exactly as it was
 * typed. That is honest but it is still source code; a note that explains a
 * calculation reads better with the relationship typeset — `sqrt(x) + x^2 - 56 = 67`
 * as √x + x² − 56 = 67.
 *
 * The rule that makes this safe is that a conversion either happens completely or
 * not at all. LaTeX that is *nearly* right is worse than source code: `a + b / c`
 * rendered as `a + b/c` with the wrong grouping is a wrong equation that looks
 * authoritative, and nothing on screen says so. So this is a real parser rather
 * than a token substitution, and anything it cannot parse — a comprehension, an
 * `if` expression, an array constructor — returns null and the caller shows the
 * text instead.
 *
 * Parsing properly is also what makes the output faithful rather than merely
 * plausible: precedence comes from the grammar, and the user's own parentheses are
 * kept as nodes in the tree, so `(a + b) * c` cannot lose its grouping on the way
 * out.
 *
 * The source of truth stays the code block above the panel, so nothing is lost
 * when a conversion is declined.
 */

import { tokenize, type Token } from "./lexer";

/** Operators, longest first so that `<=` is not read as `<` then `=`. */
const OPERATORS = ["<=", ">=", "<>", "+", "-", "*", "/", "^", "=", "<", ">"];

/**
 * Functions with their own notation.
 *
 * The value is the LaTeX command, or a marker for the few that need their
 * argument in a different shape: `sqrt` is a radical, `abs` is two bars, `exp` is
 * a power of e, and `der` is a dot.
 */
const FUNCTIONS: Record<string, string> = {
  sqrt: "@radical",
  abs: "@bars",
  exp: "@power-of-e",
  der: "@dot",
  sin: "\\sin",
  cos: "\\cos",
  tan: "\\tan",
  asin: "\\arcsin",
  acos: "\\arccos",
  atan: "\\arctan",
  sinh: "\\sinh",
  cosh: "\\cosh",
  tanh: "\\tanh",
  log: "\\ln",
  log10: "\\log_{10}",
  floor: "\\lfloor@rfloor",
  ceil: "\\lceil@rceil",
};

/** Constants that have a symbol of their own. */
const CONSTANTS: Record<string, string> = {
  "Modelica.Constants.pi": "\\pi",
  "Modelica.Constants.eps": "\\varepsilon",
  "Modelica.Constants.inf": "\\infty",
};

/**
 * How a function is written when it is NAMED rather than called.
 *
 * `quadratureLobatto(Modelica.Math.exp, 0, 1, 1e-8)` hands the function itself
 * over, and the reader needs `\exp` there — not the call form `e^{…}`, which has
 * no argument to raise, and not the name, which would draw a library path inside
 * an equation.
 */
const FUNCTION_VALUES: Record<string, string> = {
  exp: "\\exp",
  sqrt: "\\sqrt{\\ }",
  abs: "\\left|\\cdot\\right|",
  der: "\\frac{d}{dt}",
};

/* ------------------------------------------------------------------ */
/* The tree                                                            */
/* ------------------------------------------------------------------ */

type Node =
  /** A number, already in LaTeX (`1e-8` became `1 \\times 10^{-8}`). */
  | { kind: "number"; latex: string }
  /** A name, already in LaTeX. */
  | { kind: "symbol"; latex: string }
  | { kind: "group"; inner: Node }
  | { kind: "unary"; op: string; inner: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "call"; name: string; args: Node[] }
  | { kind: "subscript"; base: Node; index: Node };

/**
 * Convert one Modelica expression, or return null.
 *
 * Null means "this is not understood well enough to draw". The caller shows the
 * original text, which is never wrong.
 */
export function modelicaToLatex(source: string): string | null {
  const text = source.trim().replace(/;\s*$/, "");
  if (!text) return null;

  const tokens = withJoinedOperators(tokenize(text));
  if (tokens.length === 0) return null;

  try {
    const parser = new Parser(tokens);
    const node = parser.expression();
    // Anything left over means the expression was not fully understood: a
    // trailing `for i in 1:n`, a stray token, a construct with no rule. Refusing
    // is the whole design — a partial parse is how `dxfor iin1 : n` happens.
    if (!parser.atEnd()) return null;
    return render(node);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

/**
 * Reassemble operators the lexer splits.
 *
 * The lexer was written to read diagram annotations, where `<`, `>` and `=` only
 * ever appear alone, so `<=` arrives as two tokens. Joining them here rather than
 * changing the lexer keeps that reader untouched — it is used by the parser, the
 * serializer and the linter, none of which want multi-character operator handling
 * added underneath them.
 */
function withJoinedOperators(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "eof") break;
    const pair = token.value + (tokens[i + 1]?.value ?? "");
    if (token.type === "punct" && OPERATORS.includes(pair)) {
      out.push({ ...token, value: pair, end: tokens[i + 1].end });
      i++;
      continue;
    }
    out.push(token);
  }
  return out;
}

const isPunct = (token: Token | undefined, value: string): boolean =>
  token?.type === "punct" && token.value === value;

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

/**
 * A recursive-descent parser over the token list.
 *
 * Precedence, lowest first: `or`, `and`, comparison, `+ -`, `* /`, unary `-`,
 * `^`, then atoms. Every method either returns a node or throws, and a throw means
 * the caller shows text: there is no partial result to be tempted by.
 */
class Parser {
  private at = 0;

  constructor(private readonly tokens: Token[]) {}

  atEnd(): boolean {
    return this.at >= this.tokens.length;
  }

  private peek(): Token | undefined {
    return this.tokens[this.at];
  }

  private take(): Token {
    const token = this.tokens[this.at++];
    if (!token) throw new Error("unexpected end of expression");
    return token;
  }

  private eat(value: string): boolean {
    if (isPunct(this.peek(), value)) {
      this.at++;
      return true;
    }
    return false;
  }

  private expect(value: string): void {
    if (!this.eat(value)) throw new Error(`expected ${value}`);
  }

  expression(): Node {
    return this.disjunction();
  }

  private disjunction(): Node {
    let left = this.conjunction();
    while (this.peek()?.type === "keyword" && this.peek()?.value === "or") {
      this.take();
      left = { kind: "binary", op: "\\lor", left, right: this.conjunction() };
    }
    return left;
  }

  private conjunction(): Node {
    let left = this.comparison();
    while (this.peek()?.type === "keyword" && this.peek()?.value === "and") {
      this.take();
      left = { kind: "binary", op: "\\land", left, right: this.comparison() };
    }
    return left;
  }

  private comparison(): Node {
    const left = this.sum();
    const token = this.peek();
    const op = token?.type === "punct" ? token.value : "";
    const latex = { "=": "=", "<>": "\\neq", "<": "<", ">": ">", "<=": "\\leq", ">=": "\\geq" }[op];
    if (!latex) return left;
    this.take();
    return { kind: "binary", op: latex, left, right: this.sum() };
  }

  private sum(): Node {
    let left = this.term();
    for (;;) {
      const token = this.peek();
      if (!isPunct(token, "+") && !isPunct(token, "-")) return left;
      this.take();
      left = { kind: "binary", op: token!.value, left, right: this.term() };
    }
  }

  private term(): Node {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      if (!isPunct(token, "*") && !isPunct(token, "/")) return left;
      this.take();
      left = { kind: "binary", op: token!.value, left, right: this.unary() };
    }
  }

  private unary(): Node {
    if (this.eat("-")) return { kind: "unary", op: "-", inner: this.unary() };
    if (this.eat("+")) return this.unary();
    return this.power();
  }

  private power(): Node {
    const base = this.postfix();
    if (!this.eat("^")) return base;
    // The exponent is an ATOM, and checked against the compiler rather than
    // assumed: `2^3^2` and `2^-2` are both rejected by OpenModelica outright, and
    // `2^(3^2)` and `(2^3)^2` both compile. Drawing a chain the compiler refuses
    // would put a well-formed-looking equation in the note for a model that does
    // not build.
    return { kind: "binary", op: "^", left: base, right: this.postfix() };
  }

  /** An atom, with any number of `[...]` subscripts after it. */
  private postfix(): Node {
    let node = this.atom();
    while (this.eat("[")) {
      const index = this.expression();
      this.expect("]");
      node = { kind: "subscript", base: node, index };
    }
    return node;
  }

  private atom(): Node {
    const token = this.take();

    if (token.type === "number") return { kind: "number", latex: numberToLatex(token.value) };

    if (token.type === "punct" && token.value === "(") {
      const inner = this.expression();
      this.expect(")");
      return { kind: "group", inner };
    }

    if (token.type === "keyword") {
      if (token.value === "not") return { kind: "unary", op: "\\neg ", inner: this.unary() };
      if (token.value === "true" || token.value === "false") {
        return { kind: "symbol", latex: `\\mathrm{${token.value}}` };
      }
      // `der` is a keyword to the lexer, not an identifier, so it never reaches
      // the call rule below. It is the one keyword that is really a function.
      if (token.value === "der" && this.eat("(")) {
        const inner = this.expression();
        this.expect(")");
        return { kind: "call", name: "der", args: [inner] };
      }
      // `if`, `for`, `in`, `when`, `algorithm` … have no rule here, and guessing
      // at one is how a wrong equation gets drawn.
      throw new Error(`no rule for the keyword ${token.value}`);
    }

    if (token.type === "ident") return this.name(token);

    throw new Error(`unexpected ${token.value}`);
  }

  /** A name, a call, or a qualified name — read as one chain. */
  private name(first: Token): Node {
    const parts = [first.value];
    while (isPunct(this.peek(), ".")) {
      this.take();
      const segment = this.peek();
      if (segment?.type !== "ident" && segment?.type !== "keyword") throw new Error("dotted name");
      parts.push(this.take().value);
    }
    const full = parts.join(".");

    if (this.eat("(")) {
      const args: Node[] = [];
      if (!isPunct(this.peek(), ")")) {
        do {
          args.push(this.expression());
        } while (this.eat(","));
      }
      this.expect(")");
      return { kind: "call", name: full, args };
    }

    if (CONSTANTS[full]) return { kind: "symbol", latex: CONSTANTS[full] };
    // A known function named as a value, as an integrand is. Restricted to a
    // `Modelica.` path so that a component which happens to be called `exp` is
    // still drawn as the component it is.
    const last = parts[parts.length - 1];
    if (parts[0] === "Modelica") {
      const asValue = FUNCTION_VALUES[last] ?? (FUNCTIONS[last]?.startsWith("\\") ? FUNCTIONS[last] : undefined);
      if (asValue) return { kind: "symbol", latex: asValue };
    }
    return { kind: "symbol", latex: nameToLatex(parts) };
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

/** A number, with `e` notation turned into a power of ten. */
function numberToLatex(text: string): string {
  const exponent = /^([0-9.]+)[eE]([+-]?[0-9]+)$/.exec(text);
  if (!exponent) return text;
  return `${exponent[1]} \\times 10^{${Number(exponent[2])}}`;
}

/**
 * A name as LaTeX.
 *
 * Single letters stay as they are, because a maths italic `x` is what a variable
 * should look like. Anything longer is upright: in maths mode `mass` renders as
 * *m·a·s·s*, four variables multiplied together, which is a different statement
 * from the one the user wrote.
 *
 * An underscore and a dotted tail both become subscripts, and they go into ONE
 * subscript group. `mass_1.a` produced `\mathrm{mass}_{1}_{a}` when they were
 * emitted separately — a double subscript, which LaTeX refuses to render at all,
 * so the equation would have vanished from the note rather than been merely wrong.
 */
function nameToLatex(parts: string[]): string {
  const [head, ...tail] = parts;
  const [base, ...fromUnderscore] = head.split("_");
  const subscripts = [...fromUnderscore, ...tail];
  if (subscripts.length === 0) return atom(base);
  return `${atom(base)}_{${subscripts.map(atom).join(",\\,")}}`;
}

/** One name segment: short stays italic, longer is set upright. */
function atom(text: string): string {
  return text.length === 1 ? escape(text) : `\\mathrm{${escape(text)}}`;
}

function escape(text: string): string {
  return text.replace(/[\\{}$&#%_^~]/g, (c) => `\\${c}`);
}

/**
 * Whether an expression contains a fraction anywhere.
 *
 * The one thing that decides between `e^{…}` and `\exp(…)`: a stacked fraction is
 * tall, and a tall construct in a superscript is what makes an expression
 * unreadable. Anything else — a sum, a product, a power — sits in a superscript
 * perfectly well.
 */
function containsFraction(node: Node): boolean {
  switch (node.kind) {
    case "binary":
      return node.op === "/" || containsFraction(node.left) || containsFraction(node.right);
    case "unary":
      return containsFraction(node.inner);
    case "group":
      return containsFraction(node.inner);
    case "subscript":
      return containsFraction(node.base) || containsFraction(node.index);
    case "call":
      return node.args.some(containsFraction);
    default:
      return false;
  }
}

/**
 * A node as LaTeX.
 *
 * `unwrap` is set where the surrounding construct already delimits — a fraction,
 * a radical, an exponent, a function's parentheses — so `(a + b) / c` becomes
 * `\frac{a + b}{c}` rather than keeping a pair of brackets nothing needs.
 */
function render(node: Node, unwrap = false): string {
  if (unwrap && node.kind === "group") return render(node.inner);
  switch (node.kind) {
    case "number":
    case "symbol":
      return node.latex;
    case "group":
      return `\\left(${render(node.inner)}\\right)`;
    case "unary":
      return `${node.op}${render(node.inner, node.op === "\\neg ")}`;
    case "binary": {
      if (node.op === "/") return `\\frac{${render(node.left, true)}}{${render(node.right, true)}}`;
      if (node.op === "^") return `{${render(node.left, true)}}^{${render(node.right, true)}}`;
      if (node.op === "*") return `${render(node.left)} \\cdot ${render(node.right)}`;
      const spaced = ["=", "\\neq", "<", ">", "\\leq", "\\geq", "\\land", "\\lor"].includes(node.op);
      return `${render(node.left)} ${node.op}${spaced ? " " : " "}${render(node.right)}`;
    }
    case "subscript":
      return `${render(node.base)}_{${render(node.index)}}`;
    case "call":
      return renderCall(node);
  }
}

function renderCall(node: { name: string; args: Node[] }): string {
  const short = node.name.split(".").pop() ?? node.name;
  const notation = FUNCTIONS[short];
  const single = node.args.length === 1;

  if (notation === "@radical" && single) return `\\sqrt{${render(node.args[0], true)}}`;
  if (notation === "@bars" && single) return `\\left|${render(node.args[0])}\\right|`;
  if (notation === "@dot" && single) return `\\dot{${render(node.args[0], true)}}`;
  if (notation === "@power-of-e" && single) {
    // A fraction does not belong in a superscript.
    //
    // `exp(-time/(r.R*c.C))` lifted into `e^{…}` puts a stacked fraction in script
    // size inside brackets that then stretch to twice the line height: measured in
    // KaTeX, twenty spans of the expression end up script-sized instead of six, and
    // the answer is dominated by two enormous brackets. Nobody writes it that way
    // by hand — a compound argument is written `\exp(…)`, which keeps the fraction
    // at its own size and is how the expression reads anyway.
    return containsFraction(node.args[0])
      ? `\\exp\\!\\left(${render(node.args[0])}\\right)`
      : `e^{${render(node.args[0], true)}}`;
  }

  const args = node.args.map((arg) => render(arg)).join(",\\ ");
  if (notation === "\\lfloor@rfloor" && single) {
    return `\\lfloor ${render(node.args[0])} \\rfloor`;
  }
  if (notation === "\\lceil@rceil" && single) {
    return `\\lceil ${render(node.args[0])} \\rceil`;
  }
  // A function with its own command takes no separator: `\sin(x)`, not `\sin (x)`.
  if (notation) return `${notation}\\!\\left(${args}\\right)`;
  // A name this module has never heard of is still a call, and drawing it as one
  // is faithful: the qualifier is a namespace, so only the last part is shown.
  return `\\mathrm{${escape(short)}}\\left(${args}\\right)`;
}
