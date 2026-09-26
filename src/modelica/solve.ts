/**
 * Reading a `modelica-solve` block, and turning it into a model that can be solved.
 *
 * A solver block is not a program. It is a relationship — "this equals that" —
 * and the whole point of using Modelica for it is that the relationship is
 * written once and the tool works out which symbol to compute. That is why there
 * is no expression parser here: OpenModelica already has one, and re-implementing
 * it would be a second, worse answer to the same question.
 *
 * So this module does the two things OpenModelica cannot do for itself: it reads
 * a note-shaped dialect that is smaller than a model (no wrapper, no `equation`
 * keyword, no declaration for the unknown), and it generates the class that makes
 * the dialect legal Modelica.
 *
 * Everything here is pure text in, pure text out, so the parsing rules can be
 * tested without a compiler, a DOM or an editor.
 */

import { tokenize } from "./lexer";

/** Prefix on every generated class name, so a solver's scratch model is recognisable. */
const MODEL_PREFIX = "ms_solve_";

/**
 * The starting value given to an unknown the block did not declare.
 *
 * A root-finder returns the root nearest where it started, so this is not a
 * detail: `x^2 = 2` has two answers and this is what picks between them. One is
 * chosen because there is no better default, and it is written into the generated
 * source where the answer panel can show it, so the choice is visible rather than
 * invisible.
 */
export const DEFAULT_START = 1;

/** Declaration prefixes that make a statement a declaration rather than an equation. */
const DECL_PREFIXES = new Set(["parameter", "constant", "discrete", "final", "input", "output"]);

/** Class-definition keywords, none of which can appear inside a model body. */
const CLASS_KEYWORDS = new Set([
  "block", "class", "connector", "function", "model", "package", "record", "type",
]);

/** Builtin types, the other way a statement announces itself as a declaration. */
const BUILTIN_TYPES = new Set(["Real", "Integer", "Boolean", "String"]);

/**
 * Identifiers that are not unknowns.
 *
 * Keywords are already excluded by the lexer, which types `if`, `then`, `true`
 * and `der` as keywords rather than identifiers. What is left is the builtin
 * function and constant vocabulary, which the lexer cannot know about.
 *
 * The list is deliberately the common vocabulary rather than the complete one.
 * A missed name makes the block ask which symbol is wanted — a clear, recoverable
 * answer — whereas a name wrongly listed here would make a real unknown invisible
 * and produce a confusing failure instead.
 */
const BUILTIN_NAMES = new Set([
  // Constants and the simulation variable.
  "time", "pi", "Infinity", "NaN", "false", "true",
  // Elementary functions.
  "abs", "sign", "sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
  "sinh", "cosh", "tanh", "exp", "log", "log10", "floor", "ceil", "integer",
  "mod", "rem", "div", "max", "min", "sum", "product",
  // Event and hybrid vocabulary.
  "pre", "edge", "change", "initial", "terminal", "sample", "smooth", "noEvent",
  "semiLinear", "homotopy", "delay", "cardinality", "spatialDistribution",
  // Array vocabulary.
  "size", "zeros", "ones", "fill", "linspace", "transpose", "outerProduct",
  "symmetric", "skew", "identity", "cross", "cat", "ndims", "scalar", "vector",
  "matrix", "promote",
  // Builtin type names, when used as conversions.
  "Real", "Integer", "Boolean", "String",
]);

/** What a block asks for, once read. */
export interface SolveSpec {
  /** The symbol whose value is reported, or null when it could not be determined. */
  unknown: string | null;
  /**
   * Every symbol the equations leave undefined.
   *
   * Not just the reported one: several equations with several unknowns is a
   * system, and a system is solved as a whole. Declaring only the reported symbol
   * would leave the others undefined and turn a solvable system into a compiler
   * error about an undeclared variable.
   */
  unknowns: string[];
  /** Declarations carried into the generated class, without their semicolons. */
  declarations: string[];
  /** Equation statements, without their semicolons and without the `equation` keyword. */
  equations: string[];
  /** True when the unknown was worked out rather than written in the block. */
  inferred: boolean;
  /** Set when the block cannot be solved, saying what to change. */
  problem?: string;
}

/**
 * The `//@` directive line, matching the convention the diagram blocks already
 * use. Options live inside the block rather than in the fence's info string
 * because Obsidian hands a code-block processor the body and drops the info
 * string, so ` ```modelica-solve solve=x ` never reaches the plugin.
 */
const DIRECTIVE = /^[ \t]*\/\/[ \t]*@([^\n]*)$/m;

/**
 * Read a block body into a spec.
 *
 * Never throws: a block mid-edit is the normal state of a block, so an
 * unreadable one produces a `problem` the panel can show rather than an
 * exception that removes the panel.
 */
export function parseSolveBlock(body: string): SolveSpec {
  const spec: SolveSpec = {
    unknown: null,
    unknowns: [],
    declarations: [],
    equations: [],
    inferred: false,
  };

  const directive = DIRECTIVE.exec(body);
  const named = directive ? readSolveDirective(directive[1]) : null;
  const rest = directive ? body.slice(0, directive.index) + body.slice(directive.index + directive[0].length) : body;

  // `equation` as a line of its own is the Modelica spelling, and accepting it
  // costs nothing while making a block that was copied out of a real model work
  // unchanged.
  const split = /^[ \t]*equation[ \t]*$/m.exec(rest);
  const declarationText = split ? rest.slice(0, split.index) : rest;
  const equationText = split ? rest.slice(split.index + split[0].length) : "";

  const statements = splitStatements(declarationText);
  if (split) {
    spec.declarations = statements;
    spec.equations = splitStatements(equationText);
  } else {
    for (const statement of statements) {
      if (isDeclaration(statement)) spec.declarations.push(statement);
      else spec.equations.push(statement);
    }
  }

  // A class definition inside the block, refused by name.
  //
  // The block's text is the BODY of a model, so `function`, `model` and the rest
  // cannot be declared in it — but the compiler's answer to trying is a parse error
  // about algorithms and equations that names neither the block nor the rule. It is
  // the natural thing to reach for when an integrand has to be a function, so the
  // refusal is worth stating instead of leaving to be decoded.
  const definition = [...spec.declarations, ...spec.equations].find(startsClassDefinition);
  if (definition) {
    const keyword = tokenize(definition)[0]?.value ?? "function";
    spec.problem =
      `\`${keyword}\` cannot be defined inside this block: it holds equations, not classes. ` +
      `Use a function that already exists — \`Modelica.Math.exp\`, \`Modelica.Math.sin\` and the ` +
      `rest of \`Modelica.Math\` can be integrated directly — or write the integral as a sum, ` +
      `as in \`sum(f((i - 0.5) * dx) * dx for i in 1:n)\`.`;
    return spec;
  }

  if (spec.equations.length === 0) {
    spec.problem = "There is no equation to solve. Write one, for example `x^2 = 2`.";
    return spec;
  }

  // Checked before the unknowns are looked for, because an equation that multiplies
  // by juxtaposition would also report nonsense unknowns and the real mistake would
  // be the second thing said rather than the first.
  const juxtaposed = spec.equations.find(hasImplicitMultiplication);
  if (juxtaposed) {
    spec.problem =
      `\`${juxtaposed}\` multiplies without a \`*\`, and Modelica has no implicit multiplication. ` +
      `Write \`1/2 * (a * t)\` rather than \`1/2 (a * t)\`, and \`2*x\` rather than \`2x\` — ` +
      `the same goes for \`(a + b)(c + d)\`.`;
    return spec;
  }

  const declared = declaredNames(spec.declarations);
  const free = freeSymbols(spec.equations.join("\n;\n"), declared);
  spec.unknowns = free;

  if (named) {
    // A symbol declared as a parameter can never be the answer, and saying so
    // here is the difference between a usable message and a compiler error about
    // an over-determined system that does not mention the real cause.
    if (spec.declarations.some((statement) => isParameterDeclaration(statement, named))) {
      spec.problem =
        `\`${named}\` is a parameter, so it is fixed before the solve and cannot be solved for. ` +
        `Solve for a variable, or change the parameter's value.`;
      return spec;
    }
    spec.unknown = named;
    return spec;
  }

  if (free.length === 1) {
    spec.unknown = free[0];
    spec.inferred = true;
    return spec;
  }

  spec.problem =
    free.length === 0
      ? "Every symbol in the equation is already defined, so there is nothing to solve for."
      : `More than one symbol is undefined (${free.join(", ")}), so which one to solve for is ambiguous. ` +
        `Name it on a directive line at the top of the block: \`//@ solve ${free[0]}\`.`;
  return spec;
}

/** Read `solve x` or `solve=x` out of a directive line. */
function readSolveDirective(text: string): string | null {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const eq = /^solve=(.+)$/.exec(token);
    if (eq) return eq[1];
    if (token === "solve") {
      const next = tokens[i + 1];
      if (next) return next.replace(/[;,]$/, "");
    }
  }
  return null;
}

/**
 * Split source into `;`-terminated statements.
 *
 * Depth matters: a ModifierList such as `(start = 1, fixed = true)` contains no
 * semicolon, but an array or a function call in an initial equation can, and a
 * split inside one would tear a statement in half. The token stream already knows
 * which semicolons are real, so the split is done on tokens and the original text
 * is sliced between them — the statement keeps the user's own spelling.
 */
export function splitStatements(src: string): string[] {
  const tokens = tokenize(src);
  const out: string[] = [];
  let start = 0;
  let depth = 0;

  for (const token of tokens) {
    if (token.type === "eof") break;
    if (token.type !== "punct") continue;
    if (token.value === "(" || token.value === "[" || token.value === "{") depth++;
    else if (token.value === ")" || token.value === "]" || token.value === "}") depth = Math.max(0, depth - 1);
    else if (token.value === ";" && depth === 0) {
      out.push(src.slice(start, token.start).trim());
      start = token.end;
    }
  }

  const tail = src.slice(start).trim();
  if (tail) out.push(tail);
  return out.filter(Boolean);
}

/** Whether a statement is the start of a class definition, which the block cannot hold. */
function startsClassDefinition(statement: string): boolean {
  const first = tokenize(statement).find((token) => token.type !== "eof");
  return first?.type === "keyword" && CLASS_KEYWORDS.has(first.value);
}

/**
 * Whether an equation multiplies by writing two things side by side.
 *
 * Mathematics on paper is full of it — `2x`, `1/2 (a*t)`, `(a+b)(c+d)` — and
 * Modelica has none of it. The compiler's answer is `Missing token: SEMICOLON`,
 * which says where the parser gave up and nothing about the habit that caused it,
 * and this is the single most natural thing to write in a block meant for
 * calculations.
 *
 * Two shapes are recognised, both of which are errors in an equation however they
 * are read: something that ends a value — a number, `)` or `]` — followed directly
 * by something that starts one — a name, a number or `(`. An identifier followed
 * by `(` is NOT one of them, because `f(x)` is a call.
 *
 * Equations only. Two names in a row is a declaration (`Real x`), which is why this
 * is never asked about a declaration.
 */
export function hasImplicitMultiplication(equation: string): boolean {
  const tokens = tokenize(equation).filter((token) => token.type !== "eof");
  for (let i = 1; i < tokens.length; i++) {
    const previous = tokens[i - 1];
    const current = tokens[i];
    const endsValue =
      previous.type === "number" ||
      (previous.type === "punct" && (previous.value === ")" || previous.value === "]"));
    const startsValue =
      current.type === "ident" ||
      current.type === "number" ||
      (current.type === "punct" && current.value === "(");
    if (endsValue && startsValue) return true;
  }
  return false;
}

/**
 * Whether a statement declares something.
 *
 * Three tests, in the order that makes each one safe:
 *   - a declaration prefix (`parameter`, `constant`, …) always declares;
 *   - a builtin type name always declares;
 *   - otherwise, anything with no `=` at depth zero declares — which is how a
 *     qualified type such as `Modelica.Units.SI.Voltage v` is recognised, since
 *     its only `=` would be inside a modifier list.
 *
 * An equation is what is left. This is the one rule that has to be right, because
 * misreading an equation as a declaration produces a model with nothing to solve
 * and a compiler error that does not mention the real cause.
 */
function isDeclaration(statement: string): boolean {
  const tokens = tokenize(statement).filter((t) => t.type !== "eof");
  const first = tokens[0];
  if (!first) return false;
  if (first.type === "keyword" && DECL_PREFIXES.has(first.value)) return true;
  if (first.type === "ident" && BUILTIN_TYPES.has(first.value)) return true;
  return !hasTopLevelEquals(tokens);
}

function hasTopLevelEquals(tokens: { type: string; value: string }[]): boolean {
  let depth = 0;
  for (const token of tokens) {
    if (token.type !== "punct") continue;
    if (token.value === "(" || token.value === "[" || token.value === "{") depth++;
    else if (token.value === ")" || token.value === "]" || token.value === "}") depth = Math.max(0, depth - 1);
    else if (token.value === "=" && depth === 0) return true;
  }
  return false;
}

/** Names a declaration introduces, so the unknown search can ignore them. */
export function declaredNames(declarations: string[]): Set<string> {
  const names = new Set<string>();
  for (const statement of declarations) {
    const match = /^[ \t]*(?:(?:parameter|constant|discrete|final|input|output)[ \t]+)*[A-Za-z_][\w.]*[ \t]+([A-Za-z_]\w*)/.exec(
      statement
    );
    if (match) names.add(match[1]);
  }
  return names;
}

/** Whether a declaration introduces this name. */
function declares(statement: string, name: string): boolean {
  const match = /^[ \t]*(?:(?:parameter|constant|discrete|final|input|output)[ \t]+)*[A-Za-z_][\w.]*[ \t]+([A-Za-z_]\w*)/.exec(
    statement
  );
  return match?.[1] === name;
}

/** Whether a declaration is a `parameter`, which can never be solved for. */
export function isParameterDeclaration(statement: string, name: string): boolean {
  return /^[ \t]*parameter\b/.test(statement) && declares(statement, name);
}

/**
 * Identifiers in the equations that nothing else defines.
 *
 * A qualified name is skipped whole (`Modelica.Math.sin` is one thing, not three)
 * and so is a name being called, since `f(x)` is a function and not an unknown.
 * Anything indexed (`x[1]`) is kept: a subscript does not change what it is.
 *
 * An iterator is skipped too, and the rule for spotting one is `in`: Modelica
 * reserves that keyword for iterator lists, so a name followed by it is bound by
 * the comprehension rather than missing from the model. Reading `for i in 1:n` as
 * an unknown used to declare `i` as a variable and leave the model one equation
 * short of its variables — a solve that fails with "under-determined system" and
 * never mentions the loop.
 */
export function freeSymbols(text: string, declared: Set<string>): string[] {
  const tokens = tokenize(text);
  const found: string[] = [];
  const seen = new Set<string>();

  // The iterators first, because they are bound by the comprehension and can be
  // USED before the `for` that binds them: `sum(x[i] * dx for i in 1:n)` mentions
  // `i` first and binds it second, so a single pass would record it as missing
  // before it ever reached the `in`. Modelica reserves `in` for iterator lists, so
  // a name followed by it is the whole test.
  const iterators = new Set<string>();
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (tokens[i].type !== "ident") continue;
    const next = tokens[i + 1];
    if (next.type === "keyword" && next.value === "in") iterators.add(tokens[i].value);
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== "ident") continue;
    if (BUILTIN_NAMES.has(token.value) || declared.has(token.value) || seen.has(token.value)) continue;
    if (iterators.has(token.value)) continue;

    const previous = tokens[i - 1];
    const next = tokens[i + 1];
    if (previous?.type === "punct" && previous.value === ".") continue;
    if (next?.type === "punct" && (next.value === "." || next.value === "(")) continue;

    seen.add(token.value);
    found.push(token.value);
  }
  return found;
}

/**
 * The class name a block's model is built under.
 *
 * Stable for a given shape — the reported unknown, the declared names, and the
 * symbols that get declared as variables — and deliberately blind to everything
 * else. The backend keys its build directory and its cache by this name, so a
 * name that changed on every keystroke would leave a directory of generated C
 * behind for each one. Keeping it stable means a number changed in an equation
 * rebuilds in place, in the same directory, rather than beside it.
 *
 * A changed SHAPE does get its own directory, since that is a different model
 * and the two must not be confused. Those are bounded by how many distinct
 * calculations a session writes, and the existing sweep in `work-root.ts`
 * removes them the next time the process starts.
 *
 * A hash rather than the user's text, because a class name has to be a legal
 * identifier and the block's text is arbitrary.
 */
export function solveModelName(spec: SolveSpec): string {
  // Every symbol that gets declared is part of the shape: two blocks that solve
  // for `x` alone and for `x` and `y` together are different models that must not
  // share a build directory.
  const names = [...new Set([...declaredNames(spec.declarations), ...spec.unknowns])].sort();
  const shape = [spec.unknown ?? "?", ...names].join("|");
  return MODEL_PREFIX + fnv1a(shape);
}

/** FNV-1a, 32 bits, hex. Small, pure, and stable across runs — which is all a name needs. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The Modelica class for a block.
 *
 * The wrapper is the whole transformation: a name, the user's declarations, a
 * declaration for the unknown if the block did not write one, the `equation`
 * keyword, and the user's equations. Nothing is rewritten — the equations reach
 * the compiler exactly as they were typed, so what is solved is what is written.
 */
export function buildSolveModel(spec: SolveSpec, modelName: string): string {
  if (!spec.unknown) return "";
  const declared = declaredNames(spec.declarations);
  const lines = [`model ${modelName}`];
  for (const declaration of spec.declarations) lines.push(`  ${declaration};`);
  // Every undefined symbol becomes a variable, so a system of equations is
  // solved as a system rather than failing on an undeclared name.
  for (const unknown of spec.unknowns) {
    if (!declared.has(unknown)) lines.push(`  Real ${unknown}(start = ${DEFAULT_START});`);
  }
  lines.push("equation");
  for (const equation of spec.equations) lines.push(`  ${equation};`);
  lines.push(`end ${modelName};`);
  return lines.join("\n") + "\n";
}
