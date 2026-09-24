/**
 * Write a diagram's changes into a model's own source TEXT.
 *
 * Why this exists
 * ---------------
 * The serializer (`serializeDiagram`) rebuilds a class from the parsed model, and
 * the parsed model is a projection: it holds components, variables, wires and
 * free graphics, and nothing else. Anything the projection has no field for is
 * simply absent from the output — a nested `package Medium = ...`, an `extends`
 * clause, an `import`, an `algorithm` section, a `protected` marker, a model-level
 * `annotation(experiment(StopTime=...))`, the description string on a declaration,
 * and every comment.
 *
 * Losing those was not cosmetic. The plugin's own history folder holds the proof:
 * a 4227-byte TwoOutletTank holding `package Medium = Modelica.Media.Water...`
 * and twelve comments became 1888 bytes with NO declaration of Medium at all —
 * byte for byte what `serializeDiagram` produces from it — and every later
 * simulation of that file failed with "Base class Medium not found in scope
 * TwoOutletTank", the error in the user's log.
 *
 * The rule this module implements: a diagram edit rewrites the declarations the
 * diagram OWNS — component instances, variables, connect statements, the model's
 * own Diagram annotation — and leaves every other byte of the file alone. A
 * declaration that did not change is not re-emitted, so its comment, its
 * formatting and its description string survive a drag.
 *
 * Everything is verified before it is returned: the patched text is re-parsed and
 * compared against the model it is supposed to describe. A mismatch returns
 * `undefined` and the caller decides what to do — this function never hands back
 * text it could not confirm.
 */

import { tokenize, type Token } from "./lexer";
import { findClass, parseModelica, toDiagramModel, type ParsedClass } from "./parser";
import {
  serializeComponent,
  serializeConnection,
  serializeGraphic,
  serializePlacement,
  serializeVariable,
} from "./serializer";
import type {
  ComponentInstance,
  DiagramModel,
  Graphic,
  Placement,
  VariableInstance,
} from "./types";

/* ------------------------------------------------------------------ */
/* Token-level shapes                                                  */
/* ------------------------------------------------------------------ */

const CLASS_WORDS = new Set([
  "class",
  "model",
  "block",
  "record",
  "connector",
  "package",
  "function",
  "type",
]);

/** Keywords that may precede a class word in a definition. */
const CLASS_MODIFIERS = new Set([
  "partial",
  "encapsulated",
  "expandable",
  "final",
  "replaceable",
  "redeclare",
  "operator",
  "pure",
  "impure",
]);

/** Section markers: they carry no `;` of their own. */
const SECTION_WORDS = new Set(["equation", "algorithm", "public", "protected", "external"]);

type StmtKind = "decl" | "connect" | "annotation" | "extends" | "classdef" | "other";

interface Stmt {
  /** Offset of the first character of the line the statement starts on. */
  start: number;
  /** Offset just past the terminating `;`. */
  end: number;
  kind: StmtKind;
  /** Declared identifiers; more than one for `Real a, b;`. */
  names: string[];
  /** Token index of the first and last token of the statement. */
  first: number;
  last: number;
  /** Which section it sits in: decl, protected, equation, algorithm, ... */
  section: string;
}

interface ClassBody {
  firstToken: number;
  endToken: number;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * Why the last call refused, for the caller's trace log.
 *
 * A silent fallback to the lossy path is how the data loss went unnoticed for so
 * long; whoever calls this can record the reason instead of guessing.
 */
let refusalReason: string | undefined;

export function lastPatchRefusal(): string | undefined {
  return refusalReason;
}

function refuse(why: string): undefined {
  refusalReason = why;
  return undefined;
}

export interface PatchResult {
  text: string;
  /** One line per change, for the trace log. */
  changes: string[];
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

/**
 * Rewrite `source` so it describes `model`, touching only what the diagram owns.
 *
 * Returns `undefined` when the edit cannot be made safely — an unrecognised
 * shape, an ambiguous declaration, or a verification failure. The caller is
 * expected to fall back rather than to force it.
 */
export function patchDiagramEdits(
  source: string,
  model: DiagramModel,
  opts: { indent?: string } = {}
): PatchResult | undefined {
  if (!source.trim()) return refuse("the source is empty");
  const ind = opts.indent ?? "  ";

  let cls: ParsedClass | undefined;
  try {
    cls = findClass(parseModelica(source), model.name);
  } catch {
    // Unparseable text is not ours to rewrite.
    return refuse("the source does not parse");
  }
  if (!cls) return refuse("the model is not a class in this source");

  const tokens = tokenize(source);
  const body = classBody(tokens, model.name);
  if (!body) return refuse("the class body could not be located");

  const scan = scanStatements(source, tokens, body);
  if (!scan) return refuse("the class body could not be split into statements");
  const { stmts, declEnd, equationMarkerEnd } = scan;

  // Every declaration the parser found, by name. The token scan supplies the
  // offsets; the parser supplies the meaning (variable or component).
  const byName = new Map<string, Stmt[]>();
  for (const s of stmts) {
    if (s.kind !== "decl") continue;
    for (const n of s.names) {
      const list = byName.get(n) ?? [];
      list.push(s);
      byName.set(n, list);
    }
  }
  /** The one statement declaring `name`, or undefined when there is none or several. */
  const stmtFor = (name: string): Stmt | undefined => {
    const list = byName.get(name);
    return list && list.length === 1 ? list[0] : undefined;
  };
  const ambiguous = (name: string) => (byName.get(name)?.length ?? 0) > 1;

  const fromSource = toDiagramModel(cls, () => undefined);
  const edits: Edit[] = [];
  const changes: string[] = [];

  /* ---- components the diagram draws ---- */
  const sourceComponents = new Map(fromSource.components.map((c) => [c.id, c]));
  const modelComponents = new Map(model.components.map((c) => [c.id, c]));

  const newComponents: string[] = [];
  for (const mc of model.components) {
    const stmt = stmtFor(mc.id);
    if (!stmt) {
      if (ambiguous(mc.id)) return refuse(`the declaration of ${mc.id} is ambiguous`);
      newComponents.push(ind + componentText(mc));
      continue;
    }
    const sc = sourceComponents.get(mc.id);
    if (sc && sameEntity(sc, mc)) continue; // untouched: keep the file's own bytes
    if (sc && sameExceptPlacement(sc, mc)) {
      const edit = placementEdit(tokens, stmt, mc.placement);
      if (!edit) return refuse("the placement annotation could not be rewritten");
      edits.push(edit);
      changes.push(`moved ${mc.id}`);
      continue;
    }
    edits.push({
      start: stmt.start,
      end: stmt.end,
      text: ind + withDescription(componentText(mc), descriptionOf(source, tokens, stmt)),
    });
    changes.push(`${sc ? "changed" : "replaced"} ${mc.id}`);
  }
  if (newComponents.length) {
    edits.push({ start: declEnd, end: declEnd, text: newComponents.join("\n") + "\n" });
    changes.push(
      `added ${model.components.filter((c) => !sourceComponents.has(c.id)).map((c) => c.id).join(", ")}`
    );
  }

  /* ---- variables ---- */
  const sourceVars = new Map((fromSource.variables ?? []).map((v) => [v.id, v]));
  const modelVars = new Set((model.variables ?? []).map((v) => v.id));
  const newVars: string[] = [];
  for (const mv of model.variables ?? []) {
    const stmt = stmtFor(mv.id);
    if (!stmt) {
      if (ambiguous(mv.id)) return refuse(`the declaration of variable ${mv.id} is ambiguous`);
      newVars.push(serializeVariable(mv, ind));
      continue;
    }
    const sv = sourceVars.get(mv.id);
    if (sv && sameVariable(sv, mv)) continue;
    edits.push({
      start: stmt.start,
      end: stmt.end,
      text: withDescription(serializeVariable(mv, ind), descriptionOf(source, tokens, stmt)),
    });
    changes.push(`${sv ? "changed" : "replaced"} variable ${mv.id}`);
  }
  if (newVars.length) {
    edits.push({ start: declEnd, end: declEnd, text: newVars.join("\n") + "\n" });
    changes.push(
      `added variable ${(model.variables ?? []).filter((v) => !sourceVars.has(v.id)).map((v) => v.id).join(", ")}`
    );
  }

  /* ---- declarations the diagram no longer has ---- */
  //
  // Only names the parser listed as declarations are candidates, and only when
  // they are absent from the model. A nested class definition is not one of
  // `cls.components`, so `package Medium` can never be deleted here — which is
  // the whole point.
  const removed = cls.components
    .map((c) => c.name)
    .filter((n) => !modelComponents.has(n) && !modelVars.has(n));
  for (const name of removed) {
    const stmt = stmtFor(name);
    if (!stmt) return refuse("a declaration to remove could not be found"); // cannot find what must go: do not guess
    edits.push({ start: stmt.start, end: lineEnd(source, stmt), text: "" });
    changes.push(`removed ${name}`);
  }

  /* ---- connect statements ---- */
  const wants = (model.connections ?? []).map(connText).sort();
  const has = (fromSource.connections ?? []).map(connText).sort();
  if (!sameList(wants, has)) {
    const connects = stmts.filter((s) => s.kind === "connect");
    const lines = (model.connections ?? []).map((c) => ind + connText(c));
    if (connects.length) {
      for (const s of connects) edits.push({ start: s.start, end: lineEnd(source, s), text: "" });
      // Put the new set where the old one was, so the wires stay where the file
      // had them rather than drifting to the end of the class.
      const at = connects[0].start;
      edits.push({ start: at, end: at, text: lines.length ? lines.join("\n") + "\n" : "" });
      changes.push(`rewired (${model.connections.length} connection(s))`);
    } else if (lines.length) {
      if (equationMarkerEnd !== undefined) {
        edits.push({ start: equationMarkerEnd, end: equationMarkerEnd, text: "\n" + lines.join("\n") });
      } else {
        // No equation section yet: make one, above any model-level annotation.
        edits.push({ start: declEnd, end: declEnd, text: `${ind}equation\n${lines.join("\n")}\n` });
      }
      changes.push(`added ${model.connections.length} connection(s)`);
    }
  }

  /* ---- the model's own Diagram annotation ---- */
  const graphicsEdit = diagramAnnotationEdit(
    tokens,
    stmts,
    model.graphics,
    fromSource.graphics,
    ind,
    declEnd
  );
  if (graphicsEdit === null) return refuse("the diagram annotation could not be rewritten");
  if (graphicsEdit) {
    edits.push(graphicsEdit);
    changes.push("changed the diagram layer");
  }

  if (!edits.length) return { text: source, changes: [] };
  if (overlaps(edits)) return refuse("two edits overlap");

  const text = applyEdits(source, edits);
  if (!verifies(text, model)) return refuse("the result does not describe the model");
  return { text, changes };
}

function componentText(c: ComponentInstance): string {
  return serializeComponent(c.className, c.id, c.placement, c.params, c.prefixes, c.suffixDims, c.condition);
}

/**
 * The declaration's own description string, as the file wrote it.
 *
 * A string at the statement's own level is the description — `Constant c(k=1)
 * "a source"` — because a modifier's strings sit inside its parentheses. Both
 * emitters drop it, so a declaration the diagram changed would lose the sentence
 * the user wrote about it; this puts it back.
 */
function descriptionOf(source: string, tokens: Token[], stmt: Stmt): string | undefined {
  let depth = 0;
  for (let i = stmt.first; i <= stmt.last; i++) {
    const t = tokens[i];
    if (t.value === "(" || t.value === "[" || t.value === "{") depth++;
    else if (t.value === ")" || t.value === "]" || t.value === "}") depth--;
    else if (depth === 0 && t.type === "string") return source.slice(t.start, t.end);
  }
  return undefined;
}

/** Re-insert a description into freshly emitted declaration text. */
function withDescription(text: string, desc: string | undefined): string {
  if (!desc) return text;
  const at = text.lastIndexOf(" annotation(");
  if (at >= 0) return `${text.slice(0, at)} ${desc}${text.slice(at)}`;
  return text.endsWith(";") ? `${text.slice(0, -1)} ${desc};` : `${text} ${desc}`;
}

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

/**
 * What a rebuilt text no longer says, compared with the text it came from.
 *
 * The last line of defence: when the patcher cannot write an edit into the
 * source, the caller has to choose between a lossy rebuild and leaving the file
 * alone. This says what the rebuild would cost, so that choice is made on
 * evidence rather than on hope. An empty list means the rebuild still says
 * everything the source said that matters.
 */
export function structureLostBy(source: string, rebuilt: string): string[] {
  const lost: string[] = [];
  try {
    const from = parseModelica(source)[0];
    const to = parseModelica(rebuilt)[0];
    if (!from || !to) return ["the class itself"];

    const declaredIn = (c: ParsedClass) => new Set(c.components.map((x) => x.name));
    const has = declaredIn(to);
    for (const c of from.components) {
      if (!has.has(c.name)) lost.push(`the declaration of ${c.name}`);
    }
    const nested = new Set(to.nestedClassNames ?? []);
    for (const n of from.nestedClassNames ?? []) {
      if (!nested.has(n)) lost.push(`the nested class ${n}`);
    }
    const supers = new Set(to.extendsTypes ?? []);
    for (const e of from.extendsTypes ?? []) {
      if (!supers.has(e)) lost.push(`the extends clause ${e}`);
    }
  } catch {
    return ["the class itself"];
  }

  // Shapes the parser does not model at all, so they are looked for in the text.
  const text: Array<[RegExp, string]> = [
    [/^\s*import\b/m, "an import"],
    [/^\s*algorithm\b/m, "an algorithm section"],
    [/^\s*protected\b/m, "a protected section"],
    [/annotation\(\s*(?:experiment|Icon|uses|version)/, "a model annotation"],
    [/^[ \t]*\/\//m, "a comment"],
  ];
  for (const [re, what] of text) {
    if (re.test(source) && !re.test(rebuilt)) lost.push(what);
  }
  return lost;
}

/**
 * True when `text` describes exactly the model we were asked to write.
 *
 * This is the guard that makes the module safe to call: it re-parses what was
 * produced and compares it field by field against the model. It is deliberately
 * strict about the things a lost declaration would change, and silent about
 * formatting, because formatting is the file's business.
 */
function verifies(text: string, model: DiagramModel): boolean {
  let cls: ParsedClass | undefined;
  try {
    cls = findClass(parseModelica(text), model.name);
  } catch {
    return false;
  }
  if (!cls) return false;
  const after = toDiagramModel(cls, () => undefined);

  if (after.components.length !== model.components.length) return false;
  const byId = new Map(after.components.map((c) => [c.id, c]));
  for (const mc of model.components) {
    const ac = byId.get(mc.id);
    if (!ac || !sameEntity(ac, mc)) return false;
  }

  const vars = after.variables ?? [];
  const mine = model.variables ?? [];
  if (vars.length !== mine.length) return false;
  const varById = new Map(vars.map((v) => [v.id, v]));
  for (const mv of mine) {
    const av = varById.get(mv.id);
    if (!av || !sameVariable(av, mv)) return false;
  }

  if (!sameList((after.connections ?? []).map(connText).sort(), (model.connections ?? []).map(connText).sort())) {
    return false;
  }

  if (after.graphics.length !== model.graphics.length) return false;
  if (!sameList(after.graphics.map(graphicText).sort(), model.graphics.map(graphicText).sort())) {
    return false;
  }

  // Hand-written equations are not ours to touch, and must not have moved.
  return sameList(after.equations ?? [], model.equations ?? []);
}

/* ------------------------------------------------------------------ */
/* Comparing model entities                                            */
/* ------------------------------------------------------------------ */

function sameEntity(a: ComponentInstance, b: ComponentInstance): boolean {
  return (
    sameExceptPlacement(a, b) && samePlacement(a.placement, b.placement)
  );
}

function sameExceptPlacement(a: ComponentInstance, b: ComponentInstance): boolean {
  return (
    a.id === b.id &&
    a.className === b.className &&
    a.suffixDims === b.suffixDims &&
    (a.condition ?? "") === (b.condition ?? "") &&
    sameList(a.prefixes ?? [], b.prefixes ?? []) &&
    sameParams(a.params, b.params)
  );
}

function sameVariable(a: VariableInstance, b: VariableInstance): boolean {
  return (
    a.id === b.id &&
    a.type === b.type &&
    a.suffixDims === b.suffixDims &&
    sameList(a.prefixes ?? [], b.prefixes ?? []) &&
    sameParams(a.params, b.params)
  );
}

function sameParams(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a ?? {}).sort();
  const kb = Object.keys(b ?? {}).sort();
  if (!sameList(ka, kb)) return false;
  return ka.every((k) => a[k] === b[k]);
}

/**
 * Compare placements numerically.
 *
 * The editor computes coordinates, so two placements that describe the same box
 * can differ in the last bits of a float. Refusing to patch over that would send
 * every ordinary drag down the lossy path.
 */
function samePlacement(a: Placement | undefined, b: Placement | undefined): boolean {
  if (!a || !b) return a === b;
  if (!sameList(a.extent.map(round), b.extent.map(round))) return false;
  if (round(a.rotation ?? 0) !== round(b.rotation ?? 0)) return false;
  if ((a.visible ?? true) !== (b.visible ?? true)) return false;
  const ao = a.origin ?? [0, 0];
  const bo = b.origin ?? [0, 0];
  return ao[0] === bo[0] && ao[1] === bo[1];
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function connText(c: {
  from: { component: string; port: string };
  to: { component: string; port: string };
  points: number[];
  color?: [number, number, number];
}): string {
  return normalize(
    serializeConnection(c.from.component, c.from.port, c.to.component, c.to.port, c.points, c.color)
  );
}

function graphicText(g: Graphic): string {
  return normalize(serializeGraphic(g));
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/* ------------------------------------------------------------------ */
/* Finding the class body                                              */
/* ------------------------------------------------------------------ */

function classBody(tokens: Token[], name: string): ClassBody | undefined {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "keyword" || !CLASS_WORDS.has(t.value)) continue;
    let j = i + 1;
    while (j < tokens.length && tokens[j].type === "keyword" && CLASS_MODIFIERS.has(tokens[j].value)) j++;
    const nameTok = tokens[j];
    if (!nameTok || nameTok.type !== "ident" || nameTok.value !== name) continue;

    let k = j + 1;
    // A class header ends at its optional description string.
    if (tokens[k] && tokens[k].type === "string") k++;

    let depth = 0;
    let paren = 0;
    let brack = 0;
    let brace = 0;
    for (let m = k; m < tokens.length; m++) {
      const s = tokens[m];
      if (s.value === "(") paren++;
      else if (s.value === ")") paren--;
      else if (s.value === "[") brack++;
      else if (s.value === "]") brack--;
      else if (s.value === "{") brace++;
      else if (s.value === "}") brace--;
      if (paren || brack || brace) continue;

      if (isClassStart(tokens, m) && !isShortClassDef(tokens, m) && m > k) {
        depth++;
        continue;
      }
      if (s.type === "keyword" && s.value === "end") {
        if (isBlockEnd(tokens, m)) continue;
        if (depth > 0) {
          depth--;
          continue;
        }
        return { firstToken: k, endToken: m };
      }
    }
    return undefined;
  }
  return undefined;
}

/** `package Medium = Modelica...;` has no `end` of its own. */
function isShortClassDef(tokens: Token[], i: number): boolean {
  if (!isClassStart(tokens, i)) return false;
  let j = i + 1;
  while (j < tokens.length && tokens[j].type === "keyword" && CLASS_MODIFIERS.has(tokens[j].value)) j++;
  const name = tokens[j];
  return Boolean(name && name.type === "ident" && tokens[j + 1] && tokens[j + 1].value === "=");
}

/** `end if;` / `end for;` / `end when;` close a statement, not a class. */
function isBlockEnd(tokens: Token[], i: number): boolean {
  const next = tokens[i + 1];
  return Boolean(
    next &&
      next.type === "keyword" &&
      (next.value === "if" || next.value === "for" || next.value === "when" || next.value === "while")
  );
}

/** True when a class definition starts here (modifiers included). */
function isClassStart(tokens: Token[], i: number): boolean {
  const t = tokens[i];
  if (!t) return false;
  if (t.type === "keyword" && CLASS_WORDS.has(t.value)) return true;
  // `replaceable package Medium = X` starts with a modifier.
  if (t.type === "keyword" && CLASS_MODIFIERS.has(t.value)) {
    let j = i + 1;
    while (j < tokens.length && tokens[j].type === "keyword" && CLASS_MODIFIERS.has(tokens[j].value)) j++;
    return Boolean(tokens[j] && tokens[j].type === "keyword" && CLASS_WORDS.has(tokens[j].value));
  }
  return false;
}

/** Step past a nested class definition; returns the index after it. */
function skipClass(tokens: Token[], i: number, limit: number): number | undefined {
  if (isShortClassDef(tokens, i)) {
    let paren = 0;
    for (let j = i; j < limit; j++) {
      const s = tokens[j];
      if (s.value === "(") paren++;
      else if (s.value === ")") paren--;
      else if (s.value === ";" && !paren) return j + 1;
    }
    return undefined;
  }
  let depth = 0;
  let paren = 0;
  for (let j = i; j < limit; j++) {
    const s = tokens[j];
    if (s.value === "(") paren++;
    else if (s.value === ")") paren--;
    if (paren) continue;
    if (j > i && isClassStart(tokens, j) && !isShortClassDef(tokens, j)) depth++;
    if (s.type === "keyword" && s.value === "end") {
      if (isBlockEnd(tokens, j)) continue;
      if (depth > 0) {
        depth--;
        continue;
      }
      let k = j + 1;
      if (tokens[k] && tokens[k].type === "ident") k++;
      if (tokens[k] && tokens[k].value === ";") k++;
      return k;
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Splitting the body into statements                                  */
/* ------------------------------------------------------------------ */

function scanStatements(
  source: string,
  tokens: Token[],
  body: ClassBody
): { stmts: Stmt[]; declEnd: number; equationMarkerEnd?: number } | undefined {
  const stmts: Stmt[] = [];
  let section = "decl";
  let declEnd: number | undefined;
  let equationMarkerEnd: number | undefined;

  let i = body.firstToken;
  while (i < body.endToken) {
    const t = tokens[i];

    if (t.type === "keyword" && SECTION_WORDS.has(t.value)) {
      section = t.value === "public" ? "decl" : t.value;
      if (t.value === "equation" && equationMarkerEnd === undefined) equationMarkerEnd = t.end;
      if (declEnd === undefined && t.value !== "public") declEnd = lineStart(source, t.start);
      i++;
      continue;
    }
    if (
      t.type === "keyword" &&
      t.value === "initial" &&
      tokens[i + 1] &&
      tokens[i + 1].type === "keyword" &&
      (tokens[i + 1].value === "equation" || tokens[i + 1].value === "algorithm")
    ) {
      section = tokens[i + 1].value === "equation" ? "initialEquation" : "algorithm";
      if (declEnd === undefined) declEnd = lineStart(source, t.start);
      i += 2;
      continue;
    }
    if (isClassStart(tokens, i)) {
      if (declEnd === undefined) declEnd = lineStart(source, t.start);
      const next = skipClass(tokens, i, body.endToken);
      if (next === undefined) return undefined;
      i = next;
      continue;
    }

    // A statement runs to the `;` that closes it at this level.
    let j = i;
    let paren = 0;
    let brack = 0;
    let brace = 0;
    for (; j < body.endToken; j++) {
      const s = tokens[j];
      if (s.value === "(") paren++;
      else if (s.value === ")") paren--;
      else if (s.value === "[") brack++;
      else if (s.value === "]") brack--;
      else if (s.value === "{") brace++;
      else if (s.value === "}") brace--;
      else if (s.value === ";" && !paren && !brack && !brace) break;
    }
    if (j >= body.endToken) return undefined; // unterminated statement

    const start = lineStart(source, tokens[i].start);
    const kind = classifyStatement(tokens, i, section);
    stmts.push({
      start,
      end: tokens[j].end,
      kind,
      names: kind === "decl" ? declaredNames(tokens, i, j) : [],
      first: i,
      last: j,
      section,
    });
    if (declEnd === undefined && kind === "annotation") declEnd = start;
    i = j + 1;
  }

  // With no section marker, no annotation and no nested class, new declarations
  // go just before `end`.
  return {
    stmts,
    declEnd: declEnd ?? lineStart(source, tokens[body.endToken].start),
    equationMarkerEnd,
  };
}

/**
 * What kind of statement this is.
 *
 * The SECTION is half the answer, and leaving it out was a bug with teeth: in an
 * equation section `coolingPower = maximumCooling * tanh(...)` looks exactly like
 * a declaration of `coolingPower`, because a declaration is `Name = value` too.
 * Counting it as one made the name look declared twice (once in the declarations,
 * once in the equations), which refused every patch of that model — and, worse,
 * `x = 1` in an equation section counted as a declaration of `x`, so a model that
 * no longer had a component called `x` would have had its EQUATION deleted as a
 * stale declaration.
 *
 * `protected` is not an equation section: it holds declarations, and they are
 * edited like any other.
 */
function classifyStatement(tokens: Token[], first: number, section: string): StmtKind {
  const v = tokens[first].value;
  if (v === "connect") return "connect";
  if (section !== "decl" && section !== "protected") return "other";
  if (v === "annotation") return "annotation";
  if (v === "extends") return "extends";
  if (isClassStart(tokens, first)) return "classdef";
  return "decl";
}

/**
 * The identifiers a declaration declares.
 *
 * The declared name is the identifier followed by the thing that can come after
 * a name and never after a type: `(`, `=`, `;`, `[`, `,`, `if`, an `annotation`
 * or the declaration's description string. In
 * `Modelica.Fluid.Vessels.OpenTank tank(...)` that picks `tank` and not
 * `OpenTank`, whose successor is a dot; in `Modelica.Fluid.System system
 * annotation(...)` it picks `system`, and without the `annotation` case that
 * declaration looked like it declared nothing at all — which made the patcher
 * insert a SECOND copy of it and refuse its own output.
 */
function declaredNames(tokens: Token[], first: number, last: number): string[] {
  const out: string[] = [];
  let depth = 0;
  for (let i = first; i <= last; i++) {
    const t = tokens[i];
    if (t.value === "(" || t.value === "[" || t.value === "{") depth++;
    else if (t.value === ")" || t.value === "]" || t.value === "}") depth--;
    if (depth !== 0) continue;
    // A conditional declaration is `Type name if CONDITION`: the condition is an
    // EXPRESSION, and its identifiers are not declarations. Reading them as ones made
    // `A.R r1 if useR;` declare both `r1` and `useR`, so `useR` looked declared twice
    // (the `parameter Boolean useR = false;` line declares it for real) and EVERY
    // patch of that model was refused as ambiguous -- which is how a diagram edit
    // silently stopped being saved at all.
    if (t.type === "keyword" && t.value === "if") break;
    if (t.type !== "ident") continue;
    const next = tokens[i + 1];
    if (!next) continue;
    if (
      next.value === "(" ||
      next.value === "=" ||
      next.value === ";" ||
      next.value === "[" ||
      next.value === "," ||
      next.value === "if" ||
      next.value === "annotation" ||
      next.type === "string"
    ) {
      out.push(t.value);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Placement surgery                                                   */
/* ------------------------------------------------------------------ */

/** Replace just the Placement annotation of a declaration. */
function placementEdit(tokens: Token[], stmt: Stmt, placement: Placement): Edit | undefined {
  const text = `annotation(Placement(${serializePlacement(placement).replace(/^Placement\((.*)\)$/s, "$1")}))`;
  const span = placementAnnotationSpan(tokens, stmt);
  if (span === undefined) return undefined;
  if (span === null) {
    // No annotation on the declaration: put one before its `;`.
    if (tokens[stmt.last].value !== ";") return undefined;
    return { start: tokens[stmt.last].start, end: tokens[stmt.last].start, text: ` ${text}` };
  }
  if (span.other) return undefined; // it carries something we would have to keep
  return { start: span.start, end: span.end, text };
}

/**
 * The span of the declaration's own `annotation(...)`.
 *
 * `undefined` when the shape is not understood, `null` when the declaration has
 * no annotation at all, and `other: true` when that annotation holds anything
 * besides the `Placement` — MSL puts `defaultComponentName` and `Icon` on
 * instances, and replacing those wholesale would delete them.
 */
function placementAnnotationSpan(
  tokens: Token[],
  stmt: Stmt
): { start: number; end: number; other: boolean } | null | undefined {
  for (let i = stmt.first; i <= stmt.last; i++) {
    if (tokens[i].value !== "annotation") continue;
    if (tokens[i + 1]?.value !== "(") return undefined;
    const close = matchParen(tokens, i + 1, stmt.last);
    if (close === undefined || close !== stmt.last - 1) return undefined;
    const args = splitTopLevel(tokens, i + 2, close - 1);
    if (args.length === 0) return undefined;
    const placementArg = args.find((a) => tokens[a[0]].value === "Placement");
    if (!placementArg) return { start: tokens[i].start, end: tokens[close].end, other: true };
    return {
      start: tokens[i].start,
      end: tokens[close].end,
      other: args.length > 1,
    };
  }
  return null;
}

/** Split `first..last` on the commas that sit at its own level. */
function splitTopLevel(tokens: Token[], first: number, last: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let depth = 0;
  let start = first;
  for (let i = first; i <= last; i++) {
    const v = tokens[i].value;
    if (v === "(" || v === "{" || v === "[") depth++;
    else if (v === ")" || v === "}" || v === "]") depth--;
    else if (v === "," && depth === 0) {
      if (i > start) out.push([start, i - 1]);
      start = i + 1;
    }
  }
  if (last >= start) out.push([start, last]);
  return out;
}

function matchParen(tokens: Token[], open: number, limit: number): number | undefined {
  let depth = 0;
  for (let i = open; i <= limit; i++) {
    if (tokens[i].value === "(") depth++;
    else if (tokens[i].value === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return undefined;
}

/**
 * Make the model's Diagram annotation match `graphics`.
 *
 * `null` means "a shape this function will not touch" and `undefined` means
 * "nothing to do" — different answers, and the caller treats them differently.
 */
function diagramAnnotationEdit(
  tokens: Token[],
  stmts: Stmt[],
  graphics: Graphic[],
  fromSource: Graphic[],
  ind: string,
  declEnd: number
): Edit | null | undefined {
  if (sameList(graphics.map(graphicText).sort(), fromSource.map(graphicText).sort())) return undefined;

  const stmt = stmts.find((s) => s.kind === "annotation" && annotationHasDiagram(tokens, s));
  const body = graphics.map((g) => `${ind}${ind}${serializeGraphic(g)},`).join("\n");
  const block = `Diagram(\n${body}\n${ind})`;

  if (!stmt) {
    if (!graphics.length) return undefined;
    return { start: declEnd, end: declEnd, text: `${ind}annotation(${block});\n` };
  }

  for (let i = stmt.first; i <= stmt.last; i++) {
    if (tokens[i].value !== "Diagram") continue;
    if (tokens[i + 1]?.value !== "(") return null;
    const close = matchParen(tokens, i + 1, stmt.last);
    if (close === undefined) return null;
    if (!graphics.length) {
      // Take the comma that joined it to whatever else the annotation holds.
      const before = tokens[i - 1];
      return before && before.value === ","
        ? { start: before.start, end: tokens[close].end, text: "" }
        : { start: tokens[i].start, end: tokens[close].end, text: "" };
    }
    return { start: tokens[i].start, end: tokens[close].end, text: block };
  }
  // An annotation with no Diagram call: add one beside whatever is there.
  const open = tokens[stmt.first + 1];
  if (!open || open.value !== "(") return null;
  return { start: open.end, end: open.end, text: `${block}, ` };
}

function annotationHasDiagram(tokens: Token[], stmt: Stmt): boolean {
  for (let i = stmt.first; i <= stmt.last; i++) if (tokens[i].value === "Diagram") return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Text splicing                                                       */
/* ------------------------------------------------------------------ */

function lineStart(source: string, offset: number): number {
  const nl = source.lastIndexOf("\n", offset - 1);
  return nl < 0 ? 0 : nl + 1;
}

/**
 * Just past a statement's line, newline included — but only when the rest of the
 * line is whitespace, because a statement that shares its line with something
 * else must not take that something with it.
 */
function lineEnd(source: string, stmt: { start: number; end: number }): number {
  const nl = source.indexOf("\n", stmt.end);
  if (nl < 0) return stmt.end;
  if (source.slice(stmt.end, nl).trim().length) return stmt.end;
  return nl + 1;
}

function overlaps(edits: Edit[]): boolean {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) return true;
  }
  return false;
}

function applyEdits(source: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = source;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
