/**
 * Modelica parser for diagram round-tripping.
 *
 * Scope: enough of the language to (a) read a user's model class and rebuild
 * its diagram, and (b) read MSL class definitions to extract icons, connector
 * ports and parameter dialogs for the palette.
 *
 * It is intentionally a *pragmatic* parser: unknown constructs are skipped by
 * brace/keyword balancing rather than rejected, so real-world MSL source parses
 * even where this implementation is incomplete.
 */

import { tokenize, type Token } from "./lexer";
import type { ArrowKind, BitmapGraphic, BorderPattern, Color, ComponentClass, Connection, ConnectorRef, DiagramModel, EllipseGraphic, FillPattern, Graphic, LineGraphic, LinePattern, ParameterDef, Placement, PolygonGraphic, PortDef, RectangleGraphic, SmoothKind, TextGraphic, VariableInstance } from "./types";

/** Depth-first flatten of a class tree into a list, parents first. */
function collectNested(cls: ParsedClass, out: ParsedClass[]): void {
  out.push(cls);
  for (const n of cls.nested) collectNested(n, out);
}

/** Depth-first flatten of a class tree into a list, parents before children. */

export class ParseError extends Error {
  constructor(message: string, public readonly offset: number) {
    super(message);
    this.name = "ParseError";
  }
}

/** Parsed representation of one Modelica class. */
export interface ParsedClass {
  kind: string;
  name: string;
  comment?: string;
  /** Fully qualified name including enclosing packages. */
  qualifiedName: string;
  extendsTypes: string[];
  /** Component declarations found inside the class body. */
  components: ParsedComponent[];
  connections: Connection[];
  /**
   * The class's `equation` section, as verbatim source text.
   *
   * Declarations and `connect` statements are modelled structurally, but a
   * hand-written equation has no structural form here. Discarding it lost the
   * physics of every equation-based model: `BouncingBall` came back as three
   * declarations and an empty `equation`, and OpenModelica then refused it with
   * "Too few equations, under-determined system. The model has 0 equation(s) and
   * 2 variable(s)."
   *
   * Captured by slicing the original source rather than by re-joining tokens.
   * Re-joining was tried first and produced `- 9.81` and `0then`: text that
   * still parses but is not what was written, and a reformatter that mangles
   * code is worse than one that loses it.
   */
  equations: string[];
  /** Icon-layer graphics (short class name "Icon" or the class's own default icon). */
  icon: Graphic[];
  /**
   * Primitives the class declares that could not be interpreted, by kind.
   *
   * A graphic whose `extent` is an expression the parser cannot read is DROPPED,
   * and a dropped graphic is invisible: the tank's water rectangle is declared
   * `extent=DynamicSelect(...)`, so the tank drew empty and nothing anywhere said
   * why. Recording the drop turns "the picture is missing something" into a named
   * fault a test can assert across the whole library. Empty for every class in MSL
   * 4.1.0 -- which is the assertion.
   */
  unparsedGraphics: string[];
  /**
   * Icons declared on this class's own components, used only when the class
   * declares no Icon of its own. MSL's `Boundary_pT` draws nothing itself and
   * gives its `medium` component the picture instead.
   */
  componentIcons: Graphic[];
  /**
   * Whether the class is declared `partial`.
   *
   * A partial class can only be extended, never instantiated, so it must never be
   * offered as a component: dropping one on the canvas produces a model that
   * OpenModelica refuses to build with "cannot instantiate partial model". The
   * modifier was parsed and then thrown away, so 183 of the 1492 palette entries
   * in MSL 4.1.0 were classes that cannot be placed.
   */
  isPartial: boolean;
  diagram: Graphic[];
  parameters: ParameterDef[];
  /** Names of classes nested in this class. */
  nestedClassNames: string[];
  /**
   * Classes declared inside this class, kept as full objects so the class tree
   * can be flattened for indexing. The Modelica Standard Library declares
   * roughly half its classes this way (e.g. `block Step` lives inside
   * `Blocks/Sources.mo`), so without this, whole sublibraries never reach the
   * component palette.
   */
  nested: ParsedClass[];
  /** Raw source extent, for round-tripping text we do not understand. */
  startOffset: number;
  endOffset: number;
}

export interface ParsedComponent {
  type: string;
  name: string;
  /** Prefixes in declaration order: parameter, constant, input, output, flow, ... */
  prefixes: string[];
  /** Modifier bindings, e.g. R = 100. */
  modifiers: Record<string, string>;
  placement?: Placement;
  comment?: string;
  /**
   * Icon graphics declared on the component's OWN annotation.
   *
   * MSL uses this for a component whose type carries the picture: `Boundary_pT`
   * draws nothing itself and gives its `medium` component an
   * `annotation(defaultComponentName=..., Icon(...))`, expecting the instance to
   * take that icon. Without lifting it, such classes have no icon at all and
   * never reach the palette.
   */
  icon?: Graphic[];
  /**
   * Enabling condition of a conditional declaration, e.g. `if use_p_in`.
   *
   * The component exists only when this is true; the instance is still recorded
   * so it can be wired, and the condition is carried so it can be re-emitted
   * rather than silently dropped.
   */
  condition?: string;
  /** True when this is a connector instance (declared with a connector type). */
  arrayDims?: number[];
  /**
   * Which section the declaration appeared in.
   *
   * A `protected` parameter belongs to the class's implementation. Offering it
   * for editing is wrong twice over: it is not the user's to set, and
   * OpenModelica rejects the modifier outright with "protected element may not
   * be modified".
   */
  visibility?: "public" | "protected";
  /**
   * Dimensions written after the name, e.g. the `[Medium.nX]` in
   * `RealInput X_in[Medium.nX](...)`. Kept as source text because the
   * expression need not be a literal.
   */
  suffixDims?: string;
}

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(ahead = 0): Token {
    return this.tokens[Math.min(this.pos + ahead, this.tokens.length - 1)];
  }
  private next(): Token {
    return this.tokens[this.pos++];
  }
  private at(value: string): boolean {
    const t = this.peek();
    return t.value === value;
  }
  /** True when the cursor is on a plain identifier, not punctuation or a keyword. */
  private atIdent(): boolean {
    return this.peek().type === "ident";
  }
  private eat(value: string): boolean {
    if (this.at(value)) {
      this.pos++;
      return true;
    }
    return false;
  }
  private expect(value: string): Token {
    if (!this.at(value)) {
      const t = this.peek();
      throw new ParseError(`expected '${value}' but found '${t.value}'`, t.start);
    }
    return this.next();
  }
  private isEof(): boolean {
    return this.peek().type === "eof";
  }

  /* ---------------- top level ---------------- */

  /**
   * Parse a whole file into a flat list of classes.
   *
   * Nested classes are included. This matters a great deal in practice: the
   * Modelica Standard Library declares roughly half its classes *inside*
   * package files (e.g. `block Step` lives within `Blocks/Sources.mo`), so
   * without flattening, whole sublibraries such as `Modelica.Blocks.*` would
   * never reach the component palette.
   */
  /**
   * Parse a whole file into a FLAT list of classes, including nested ones.
   */
  parseProgram(): ParsedClass[] {
    const classes: ParsedClass[] = [];
    // Optional `within A.B;` — the following classes live inside that package.
    let within: string[] = [];
    if (this.at("within")) {
      this.next();
      let name = "";
      if (this.at(".")) this.next();
      while (!this.isEof() && !this.at(";")) {
        const t = this.next();
        if (t.value !== ".") name += t.value;
        else name += ".";
      }
      this.eat(";");
      within = name ? name.split(".") : [];
    }
    while (!this.isEof()) {
      const cls = this.tryParseClass(within);
      if (cls) collectNested(cls, classes);
      else this.next();
    }
    return classes;
  }

  /** Parse one class if the cursor is at a class definition. */
  private tryParseClass(prefix: string[]): ParsedClass | null {
    const startTok = this.peek();
    if (startTok.type === "eof") return null;

    const modifiers: string[] = [];
    while (
      this.at("encapsulated") ||
      this.at("partial") ||
      this.at("expandable") ||
      this.at("final") ||
      this.at("inner") ||
      this.at("outer") ||
      this.at("replaceable")
    ) {
      modifiers.push(this.next().value);
    }

    let kindTok = this.peek();
    const CLASS_KINDS = [
      "model", "class", "block", "connector", "record", "package",
      "function", "type", "operator",
    ];
    if (!CLASS_KINDS.includes(kindTok.value)) return null;

    // `operator record`, `operator function` and `operator '` are single kind
    // markers, not an `operator` class followed by a name. Reading the next
    // token as the name made every operator record in MSL a class literally
    // called `record`, so `Modelica.Units.SI.Angle` appeared as
    // `Modelica.Units.SI.record...record.Angle` and the real name was lost.
    if (
      kindTok.value === "operator" &&
      (this.peek(1).value === "record" ||
        this.peek(1).value === "function" ||
        this.peek(1).value === "'")
    ) {
      this.next(); // `operator`
      const substantive = this.next(); // `record` / `function` / `'`
      // A fresh object: the token in the array is shared, and rewriting its
      // value in place corrupted the lexer's output for later reads.
      kindTok = { type: substantive.type, value: substantive.value, start: substantive.start, end: substantive.end };
    } else {
      this.next(); // consume the kind keyword
    }

    const nameTok = this.next();
    if (nameTok.type !== "ident" && nameTok.type !== "keyword") return null;
    const name = nameTok.value;

    // Optional specialisation / constraining clause, e.g. `type X = Real;`
    if (this.at("=")) {
      while (!this.isEof() && !this.at(";")) this.next();
      this.eat(";");
      return {
        kind: kindTok.value,
        name,
        qualifiedName: [...prefix, name].join("."),
        isPartial: modifiers.includes("partial"),
        extendsTypes: [],
        components: [],
        connections: [],
        equations: [],
        icon: [],
        unparsedGraphics: [],
        componentIcons: [],
        diagram: [],
        parameters: [],
        nestedClassNames: [],
        nested: [],
        startOffset: startTok.start,
        endOffset: this.peek().start,
      };
    }

    // String comment after the class name
    let comment: string | undefined;
    if (this.peek().type === "string") comment = this.next().value;

    const cls: ParsedClass = {
      kind: kindTok.value,
      name,
      comment,
      qualifiedName: [...prefix, name].join("."),
      isPartial: modifiers.includes("partial"),
      extendsTypes: [],
      components: [],
      connections: [],
      equations: [],
      icon: [],
      unparsedGraphics: [],
      componentIcons: [],
      diagram: [],
      parameters: [],
      nestedClassNames: [],
      nested: [],
      startOffset: startTok.start,
      endOffset: startTok.start,
    };

    // Drops are attributed to the class whose body is being walked: the stack is
    // pushed here and popped here, so a nested class's graphic is never charged to
    // its parent.
    this.dropStack.push(cls.unparsedGraphics);
    this.parseClassBody(cls, [...prefix, name]);
    this.dropStack.pop();
    cls.endOffset = this.peek().start;
    return cls;
  }


  /**
   * Walk a class body until its matching `end Name;`.
   * Handles nested classes, extends clauses, equations and annotations.
   */
  private parseClassBody(cls: ParsedClass, prefix: string[]): void {
    /** Visibility of the section the cursor is in; `public` until told otherwise. */
    let sectionVisibility: "public" | "protected" = "public";
    /**
     * Whether the cursor is inside the `equation` section.
     *
     * Only there are bare statements equations. Outside it a statement starting
     * with an identifier is a declaration being parsed, not text to keep.
     */
    let inEquations = false;
    while (!this.isEof()) {
      // End of this class?
      //
      // `end` also closes equation-section blocks: `end if;`, `end for;`,
      // `end when;`, `end while;`. Treating any of those as the end of the class
      // stopped the body at the first loop and discarded everything after it —
      // including the class-level `annotation(Icon(...))`, which is why classes
      // such as `Boundary_pT` came out with no icon and never reached the
      // palette. Only `end` followed by a plain identifier, or by `;` directly,
      // closes a class.
      if (this.at("end")) {
        const after = this.peek(1).value;
        if (after === "if" || after === "for" || after === "when" || after === "while") {
          this.next(); // end
          this.next(); // if / for / when / while
          this.eat(";");
          continue;
        }
        this.next();
        // `end Name;` or `end Name "comment";`. Consuming a token blindly was
        // also wrong: MSL writes
        //     annotation(...));
        //   end Boundary_pT;
        // and the stray `)` leaves the cursor already on `end`, so the token
        // after `end` was the closing `;` itself.
        if (this.atIdent()) this.next();
        this.eat(";");
        return;
      }

      // Nested class definition
      const save = this.pos;
      const nested = this.tryParseClass(prefix);
      if (nested) {
        cls.nestedClassNames.push(nested.name);
        cls.nested.push(nested);
        // An `Icon`/`Diagram` nested class carries the graphics.
        if (nested.name === "Icon") cls.icon.push(...nested.icon);
        this.mergePublicMembers(cls, nested);
        continue;
      }
      this.pos = save;

      // Section keywords. The visibility sections matter: `protected`
      // declarations are internal, and treating them as parameters put values
      // like `evenOrder` in front of the user, who then could not edit them —
      // OpenModelica rejects a modifier on a protected element.
      if (this.at("public")) {
        this.next();
        sectionVisibility = "public";
        continue;
      }
      if (this.at("protected")) {
        this.next();
        sectionVisibility = "protected";
        continue;
      }
      if (this.at("equation") || this.at("algorithm") || this.at("initial")) {
        // `algorithm` and `initial` are not captured: an algorithm's meaning is
        // the order of its assignments, and re-emitting it as an equation would
        // misrepresent it. Only `equation` is kept.
        inEquations = this.peek().value === "equation";
        this.next();
        continue;
      }

      // extends clause
      if (this.at("extends")) {
        this.next();
        const t = this.peek();
        const typeName = this.parseTypeName();
        if (typeName) cls.extendsTypes.push(typeName);
        void t;
        // Possible modifier `( ... )`
        if (this.at("(")) this.parseModifierAssignments();
        // Optional annotation
        if (this.at("annotation")) this.parseAnnotationInto(cls, null);
        this.eat(";");
        continue;
      }

      // A class-level annotation, e.g. annotation(Icon(graphics={...}))
      if (this.at("annotation")) {
        this.parseAnnotationInto(cls, null);
        this.eat(";");
        continue;
      }

      // import
      if (this.at("import")) {
        while (!this.isEof() && !this.at(";")) this.next();
        this.eat(";");
        continue;
      }

      // connect( ... ) — with optional annotation
      if (this.at("connect")) {
        const conn = this.parseConnect();
        if (conn) cls.connections.push(conn);
        continue;
      }

      // A statement with no structural form. Inside the equation section it is
      // kept verbatim; anywhere else it is skipped as before.
      if (inEquations && (this.isStatementStart() || this.atIdent())) {
        const statement = this.captureStatement();
        if (statement) cls.equations.push(statement);
        continue;
      }
      if (this.isStatementStart()) {
        this.skipStatement(this.beginsStatement());
        continue;
      }

      // Otherwise attempt a component declaration
      const comp = this.tryParseComponent();
      if (comp) {
        comp.visibility = sectionVisibility;
        cls.components.push(comp);
        // A component may carry the class's picture (see ParsedComponent.icon).
        // Collected here so the class can fall back to it below.
        if (comp.icon?.length) cls.componentIcons.push(...comp.icon);
        // A `parameter`/`constant` declaration becomes palette metadata.
        if (comp.prefixes.includes("parameter") || comp.prefixes.includes("constant")) {
          cls.parameters.push(toParameterDef(comp));
        }
        continue;
      }

      this.next();
    }
  }

  private mergePublicMembers(target: ParsedClass, nested: ParsedClass): void {
    // Graphics inside a nested Icon/Diagram class belong to the parent.
    if (nested.name !== "Icon" && nested.name !== "Diagram") {
      target.parameters.push(...nested.parameters);
    }
  }

  /**
   * Read an enabling condition up to whatever ends the declaration.
   *
   * Stops at a string comment, `annotation`, or `;` at bracket depth zero, so
   * `if use_X_in and Medium.nXi > 0 "doc" annotation(...)` yields just the
   * expression. Balanced brackets are respected, since a condition may contain
   * a call.
   */
  private readConditionClause(): string {
    const start = this.peek().start;
    let depth = 0;
    while (!this.isEof()) {
      const t = this.peek();
      if (depth === 0) {
        if (t.value === ";" || t.value === "annotation") break;
        if (t.type === "string") break;
      }
      if (t.value === "(" || t.value === "[" || t.value === "{") depth++;
      else if (t.value === ")" || t.value === "]" || t.value === "}") depth--;
      this.next();
    }
    return this.sourceSlice(start, this.peek().start).trim();
  }

  private isStatementStart(): boolean {
    const v = this.peek().value;
    return (
      v === "if" || v === "for" || v === "while" || v === "when" ||
      v === "assert" || v === "der" || v === "return" || v === "break"
    );
  }

  /** Skip a statement, respecting nesting and `end if`/`end for`. */
  /**
   * Skip an equation/algorithm statement.
   *
   * The subtlety that matters: `if` is both a statement and an expression, and
   * `end if` closes only the statement form. A statement `if` is introduced by
   * the keyword at the head of a statement, whereas an expression `if` (as in
   * `smooth(0, if a then b else c)`) always appears inside a bracketed context.
   * Counting every `if` therefore terminates the skip at the wrong `end if`,
   * leaving the cursor mid-expression and desynchronising the whole stream.
   *
   * So block keywords are only counted when the scan is NOT inside brackets.
   */
  /**
   * Skip an equation/algorithm statement.
   *
   * The subtlety that matters: `if` is both a statement and an expression, and
   * only the statement form has a matching `end if`. Counting every `if` makes
   * the scan stop at the wrong `end if` — or, for a statement like
   * `y = if x > 0 then 1 else -1;` which has no `end` at all, run to end of
   * file and silently discard every following class.
   *
   * An `if`/`for`/`while`/`when` opens a block only when it begins a statement.
   * A statement begins after `;`, `then`, `else` or `loop`, and at the start of
   * the skip. Inside brackets, or after an operator, an `if` is an expression
   * and is not counted. Tokens inside brackets never affect the count either,
   * so a parenthesised `if` expression cannot unbalance it.
   */
  private skipStatement(headIsStatement = true): void {
    let blockDepth = 0;
    let bracketDepth = 0;
    let atStatementStart = true;
    // Whether the STATEMENT's own head is a block keyword. An `if` can only open
    // a block at the head of a statement, and outside a block that means this
    // one: `y = if a then b else if c then d else e;` contains two EXPRESSION
    // ifs and no `end if` at all. Counting the one after `else` started a hunt
    // for a closing `end if` that never came, so the scan ran past the end of the
    // class and took its `Icon` annotation with it — `Sources.LogFrequencySweep`
    // parsed with 0 of its 12 graphics, one equation away from being correct.
    const headOpensBlock =
      headIsStatement &&
      (this.peek().value === "if" ||
        this.peek().value === "for" ||
        this.peek().value === "while" ||
        this.peek().value === "when");
    // Whether the expression being scanned has passed an `if` that is NOT a
    // statement. Its `then`/`else` do not begin nested statements, so they must
    // not arm the next `if` to open a block: `x = if a then 1 else if b then 2
    // else 3;` is one equation with two expression ifs, and counting the second
    // sent the scan looking for an `end if` that does not exist. Inside a
    // `when` or `if` block -- where `then`/`else` really do begin statements --
    // that made the block appear one level deeper than it is, so its `end when;`
    // closed the wrong level and the rest of the class, `Icon` included, was
    // swallowed.
    let inExpressionIf = false;

    while (!this.isEof()) {
      const t = this.peek();
      const v = t.value;

      // Brackets: consume whole, and remember we are inside them.
      if (v === "(" || v === "[" || v === "{") {
        bracketDepth++;
        atStatementStart = false;
        this.next();
        continue;
      }
      if (v === ")" || v === "]" || v === "}") {
        if (bracketDepth === 0) return; // belongs to an enclosing construct
        bracketDepth--;
        this.next();
        continue;
      }

      if (bracketDepth === 0) {
        // `end if;` / `end for;` / `end when;` closes a block.
        if (v === "end") {
          const nxt = this.peek(1).value;
          if (nxt === "if" || nxt === "for" || nxt === "while" || nxt === "when" || nxt === "for") {
            blockDepth--;
            if (blockDepth <= 0) {
              this.next(); // end
              this.next(); // if/for/when
              this.eat(";");
                return;
            }
            this.next();
            this.next();
            this.eat(";");
            atStatementStart = true;
            continue;
          }
        }

        // A block opener only when it starts a statement -- at the head of this
        // one, or at the head of a nested statement inside a block.
        if (
          atStatementStart &&
          (blockDepth > 0 || headOpensBlock) &&
          (v === "if" || v === "for" || v === "while" || v === "when")
        ) {
          blockDepth++;
          atStatementStart = false;
          inExpressionIf = false;
          this.next();
          continue;
        }

        // An `if` anywhere else is an expression, and its branches are not
        // statements. Remembered until the statement's `;`.
        if (v === "if") inExpressionIf = true;

        // Statement terminator.
        if (v === ";") {
          this.next();
          if (blockDepth <= 0) return;
          atStatementStart = true;
          inExpressionIf = false;
          continue;
        }

        // Inside a BLOCK, `then`/`else`/`loop` begin a nested statement. Not
        // inside an expression if, where they only introduce another branch.
        if (v === "loop") {
          atStatementStart = true;
          this.next();
          continue;
        }
        if (v === "then" || v === "else") {
          if (!inExpressionIf) atStatementStart = true;
          this.next();
          continue;
        }

        if (v === "end") {
          // Any other `end` (e.g. `end ModelName;`) closes an enclosing scope.
          return;
        }
      }

      atStatementStart = false;
      this.next();
      void t;
    }
  }

  /**
   * Consume one equation statement and return the source text it came from.
   *
   * The boundary is found by `skipStatement`, which already knows how to tell a
   * statement `if` from an expression `if` — the hard case, and one this method
   * got wrong when it tried to track blocks itself: `y2 = if x > 0 then 1 else
   * -1;` was read as opening a block, and the rest of the file was swallowed.
   *
   * The text is then sliced from the ORIGINAL source between token offsets, so
   * it is exactly what the author wrote — spacing and comments included — rather
   * than a reconstruction. Re-joining tokens was tried first and produced
   * `- 9.81` and `0then`.
   */
  private captureStatement(): string {
    const first = this.peek();
    if (!first) return "";
    const sliceStart = first.start;
    this.skipStatement();
    const last = this.tokens[Math.max(0, this.pos - 1)];
    const sliceEnd = last ? Math.max(first.end, last.end) : first.end;
    return this.sourceSlice(sliceStart, sliceEnd).trim();
  }

  /**
   * Whether the token at the cursor really begins a statement.
   *
   * `isStatementStart` asks about the token alone, and `if` is both a keyword
   * that opens a block and the head of an expression. This loop reaches `if`
   * with the rest of a statement already skipped -- `y := if a then b else c;`
   * in an `algorithm` section arrives with `y` and `:=` behind it -- and treating
   * that `if` as a block opener began a hunt for an `end if` that does not exist.
   * The scan then ran through the class's `annotation` and stopped only at its
   * `end`, so the class kept a placeholder icon: `Electrical.Digital.
   * InertialDelaySensitive` parsed 0 of its 8 graphics.
   *
   * What precedes the keyword decides it. A statement can begin after another
   * statement, after a section keyword, or at the head of the class body.
   */
  private beginsStatement(): boolean {
    const prev = this.tokens[this.pos - 1];
    if (!prev) return true;
    return (
      prev.value === ";" ||
      prev.value === "then" ||
      prev.value === "else" ||
      prev.value === "loop" ||
      prev.value === "equation" ||
      prev.value === "algorithm" ||
      prev.value === "initial" ||
      prev.value === "protected" ||
      prev.value === "public"
    );
  }

  /** Parse a dotted type name, e.g. Modelica.Electrical.Analog.Basic.Resistor */
  private parseTypeName(): string | null {
    if (this.at(".")) this.next(); // leading dot = fully qualified
    const first = this.peek();
    if (first.type !== "ident" && first.type !== "keyword") return null;
    let name = this.next().value;
    while (this.at(".")) {
      this.next();
      const part = this.peek();
      if (part.type !== "ident" && part.type !== "keyword") break;
      name += "." + this.next().value;
    }
    return name;
  }

  /* ---------------- components ---------------- */

  private tryParseComponent(): ParsedComponent | null {
    const save = this.pos;
    const PREFIXES = [
      "parameter", "constant", "input", "output", "flow", "stream",
      "discrete", "final", "inner", "outer", "replaceable", "redeclare",
      "each", "public", "protected",
    ];
    const prefixes: string[] = [];
    for (;;) {
      const t = this.peek();
      const isTypeLike =
        t.type === "ident" || (t.type === "keyword" && t.value === "flow");
      if (t.type === "keyword" && PREFIXES.includes(t.value)) {
        prefixes.push(this.next().value);
        continue;
      }
      if (t.type === "keyword" && (t.value === "type" || t.value === "connector")) {
        // rare: local type declaration — not a component
        this.pos = save;
        return null;
      }
      if (!isTypeLike) {
        this.pos = save;
        return null;
      }
      break;
    }

    const type = this.parseTypeName();
    if (!type) {
      this.pos = save;
      return null;
    }

    // Optional array dimensions on the type
    const arrayDims: number[] = [];
    while (this.at("[")) {
      this.next();
      let d = 0;
      let sign = 1;
      while (!this.isEof() && !this.at("]")) {
        const t = this.next();
        if (t.type === "number") d = d * 10 + Number(t.value);
        else if (t.value === "-") sign = -1;
      }
      this.eat("]");
      arrayDims.push(d * sign);
    }

    const nameTok = this.peek();
    if (nameTok.type !== "ident") {
      this.pos = save;
      return null;
    }
    const name = this.next().value;

    // Array dimensions AFTER the name, before any modifier:
    //     RealInput X_in[Medium.nX](each unit="1") if use_X_in
    //
    // Modelica allows the dimensions on either side of the name, and MSL uses
    // this form throughout. Reading the modifier first meant the `[` was
    // unexpected, the declaration failed, and the scanner then swallowed the
    // rest of the class. The dimension expression is kept verbatim so the
    // declaration survives a round trip.
    let suffixDims: string | undefined;
    if (this.at("[")) {
      const dimStart = this.peek().start;
      while (this.at("[")) {
        let depth = 0;
        do {
          const v = this.next().value;
          if (v === "[") depth++;
          else if (v === "]") depth--;
        } while (!this.isEof() && depth > 0);
      }
      const last = this.tokens[this.pos - 1];
      suffixDims = this.sourceSlice(dimStart, last.end).trim();
    }

    // Modifiers
    let modifiers: Record<string, string> = {};
    if (this.at("(")) {
      modifiers = this.parseModifierAssignments();
    }

    // A declaration binding: `Type name = expression`. Common throughout the
    // MSL (e.g. `RealOutput y = 0.0 "output"`); without handling it the token
    // stream desynchronises and the rest of the file is lost.
    let binding: string | undefined;
    if (this.at("=")) {
      this.next();
      binding = this.parseBindingExpression();
      if (binding) modifiers[name] = binding;
    }


    // Conditional declaration: `RealInput p_in(...) if use_p_in "doc" ...;`
    //
    // MSL uses this constantly — every optional connector on a fluid or blocks
    // component is declared this way. Left unhandled, the trailing `if` reached
    // the statement scanner, which saw a block opener and consumed EVERYTHING to
    // the end of the class. That silently cost the class its remaining
    // components, its equations, and its `annotation(Icon(...))`, which is why
    // classes such as `Boundary_pT` arrived with no icon and were dropped from
    // the palette.
    let condition: string | undefined;
    if (this.at("if")) {
      this.next();
      condition = this.readConditionClause();
    }

    let comment: string | undefined;
    let placement: Placement | undefined;
    let icon: Graphic[] = [];

    // Optional trailing string comment and annotation
    while (this.at("annotation") || this.peek().type === "string") {
      if (this.peek().type === "string") {
        comment = this.next().value;
        continue;
      }
      const holder = {
        placement: undefined as Placement | undefined,
        icon: undefined as Graphic[] | undefined,
      };
      this.parseAnnotationForComponent(holder);
      if (holder.placement) placement = holder.placement;
      if (holder.icon?.length) icon = holder.icon;
    }

    if (!this.eat(";")) {
      // Not a well-formed declaration after all.
      this.pos = save;
      return null;
    }

    return {
      type,
      name,
      prefixes,
      modifiers,
      placement,
      comment,
      icon: icon.length ? icon : undefined,
      condition,
      arrayDims: arrayDims.length ? arrayDims : undefined,
      suffixDims,
    };
  }

  /**
   * Parse `( a = 1, b = {1,2}, nested(x=3) )` into a flat map of raw
   * expression text keyed by top-level name. Nested modifiers are kept as
   * their raw inner text so they can be re-emitted verbatim.
   */
  private parseModifierAssignments(): Record<string, string> {
    const out: Record<string, string> = {};
    this.expect("(");
    while (!this.isEof() && !this.at(")")) {
      if (this.at(",")) {
        this.next();
        continue;
      }
      const keyTok = this.peek();
      if (keyTok.type !== "ident" && keyTok.type !== "keyword") {
        // Unrecognised content: bail out past the closing paren.
        this.skipBalancedParens();
        break;
      }
      const key = this.next().value;

      // `each` prefix inside modifiers
      let keyPath = key;
      while (this.at(".")) {
        this.next();
        const part = this.next();
        keyPath += "." + part.value;
      }

      if (this.at("(")) {
        // Value is a nested modifier set — capture raw text.
        const startOff = this.peek().start;
        this.skipBalancedParens();
        out[keyPath] = "@modifier:" + this.rawText(startOff, this.peek().start);
        continue;
      }
      if (this.at("=")) {
        this.next();
        const startOff = this.peek().start;
        this.skipExpression();
        out[keyPath] = this.rawText(startOff, this.peek().start).trim();
        continue;
      }
      // Redeclare-style modifier without `=`
      out[keyPath] = "";
    }
    this.eat(")");
    return out;
  }

  /** Consume a balanced `( ... )` group, assuming cursor is on `(`. */
  private skipBalancedParens(): void {
    if (!this.at("(")) return;
    let depth = 0;
    do {
      const t = this.next();
      if (t.value === "(") depth++;
      else if (t.value === ")") depth--;
      if (t.type === "eof") return;
    } while (depth > 0);
  }

  /** Consume an expression up to a top-level `,` or `)`. */
  private skipExpression(): void {
    let depth = 0;
    while (!this.isEof()) {
      const v = this.peek().value;
      if (depth === 0 && (v === "," || v === ")")) return;
      if (v === "(" || v === "[" || v === "{") depth++;
      else if (v === ")" || v === "]" || v === "}") {
        if (depth === 0) return;
        depth--;
      }
      this.next();
    }
  }

  /**
   * Source text between two offsets.
   *
   * This used to scan every token with `findIndex` to locate the start, and
   * threw the answer away. Called once per modifier — and MSL declares
   * thousands — that made parsing quadratic in the token count: indexing the
   * standard library took **8.8 seconds**, on the main thread, every time the
   * view opened.
   */
  private rawText(start: number, end: number): string {
    return this.sourceSlice(start, end);
  }

  /** Set by the entry point so raw-text capture works. */
  sourceSlice: (start: number, end: number) => string = () => "";

  /* ---------------- connect ---------------- */

  private parseConnect(): Connection | null {
    this.expect("connect");
    this.expect("(");
    const a = this.parseConnectorRef();
    this.expect(",");
    const b = this.parseConnectorRef();
    this.expect(")");

    let points: number[] = [];
    let color: Color | undefined;
    if (this.at("annotation")) {
      const holder = { line: undefined as LineGraphic | undefined };
      this.parseAnnotationForConnect(holder);
      if (holder.line) {
        points = holder.line.points;
        color = holder.line.color;
      }
    }
    this.eat(";");

    if (!a || !b) return null;
    return {
      id: `${refKey(a)}|${refKey(b)}`,
      from: a,
      to: b,
      points,
      color,
    };
  }

  /**
   * Parse one side of a `connect(...)`.
   *
   * Forms seen in practice:
   *   r.n                     -> component "r", port "n"
   *   plug[1].pin             -> component "plug", port "pin"
   *   sub.model.port          -> component "sub.model"? No: Modelica connects
   *                              connectors, so the LAST segment is the port and
   *                              everything before it is the component path.
   *   p                       -> a port of the enclosing class (no component)
   */
  private parseConnectorRef(): ConnectorRef | null {
    const first = this.peek();
    if (first.type !== "ident" && first.type !== "keyword") return null;

    const head = this.next();
    const segments: string[] = [head.value];

    /**
     * A subscript may follow any segment, e.g. `u[1]` or `plug[1].pin`.
     *
     * The subscript is part of the port name and must be kept: MSL fluid
     * connectors are arrays, so `ports[1]` and `ports[2]` are different ports.
     * Dropping it rewrote `connect(source.ports[1], pipe.port_a)` as
     * `connect(source.ports, pipe.port_a)`, which does not compile.
     */
    const readSubscript = (): string => {
      if (!this.at("[")) return "";
      const startOff = this.peek().start;
      this.next(); // consume '['
      let depth = 1;
      while (!this.isEof() && depth > 0) {
        const v = this.next().value;
        if (v === "[") depth++;
        else if (v === "]") depth--;
      }
      // Slice to the end of the last consumed token, so the closing bracket is
      // included; `peek().start` would be the following token and cut it off.
      const last = this.tokens[this.pos - 1];
      return this.sourceSlice(startOff, last.end);
    };

    segments[0] += readSubscript();
    while (this.at(".")) {
      this.next();
      const t = this.next();
      segments.push(t.value + readSubscript());
    }

    if (segments.length === 1) {
      return { component: "", port: segments[0] };
    }
    // The last segment is the port; the rest form the component path.
    const port = segments[segments.length - 1];
    const component = segments.slice(0, -1).join(".");
    return { component, port };
  }

/* ---------------- annotations ---------------- */

  /**
   * Parse `annotation(...)` in a class context, routing graphics into the
   * class's Icon and Diagram layers.
   */
  private parseAnnotationInto(cls: ParsedClass | null, holder: unknown): void {
    void holder;
    this.expect("annotation");
    // MSL writes `annotation (Icon(...))` with a space, so the keyword and the
    // argument list are not necessarily adjacent tokens.
    this.expect("(");
    const args = this.parseArgumentListRaw();
    if (cls) {
      const icon = args["Icon"];
      const diagram = args["Diagram"];
      if (Array.isArray(icon)) cls.icon.push(...(icon.filter(isGraphic) as Graphic[]));
      if (Array.isArray(diagram)) cls.diagram.push(...(diagram.filter(isGraphic) as Graphic[]));
    }
  }

  /**
   * Parse `annotation(...)` attached to a component declaration and extract
   * the `Placement`. Graphics inside are ignored (they belong to the class).
   */
  private parseAnnotationForComponent(holder: {
    placement?: Placement;
    icon?: Graphic[];
  }): void {
    this.expect("annotation");
    this.expect("(");
    const args = this.parseArgumentListRaw();
    const p = args["Placement"];
    if (p) holder.placement = p as Placement;
    // A component may carry its own Icon; see ParsedComponent.icon.
    const icon = args["Icon"];
    if (Array.isArray(icon) && icon.length > 0) {
      holder.icon = icon.filter(isVisibleGraphic) as Graphic[];
    }
  }

  private parseAnnotationForConnect(holder: { line?: LineGraphic }): void {
    this.expect("annotation");
    this.expect("(");
    const args = this.parseArgumentListRaw();
    const l = args["Line"];
    if (isGraphic(l)) holder.line = l as LineGraphic;
  }


  /**
   * Parse the contents of an `Icon(...)` / `Diagram(...)` layer.
   *
   * Two idioms occur in real libraries:
   *   Icon(graphics={Rectangle(...), Line(...)})   // Modelica Standard Library
   *   Icon(Rectangle(...), Line(...))              // bare primitives
   * Both yield a flat list of graphics; other arguments are skipped.
   */
  private parseGraphicsList(): Graphic[] {
    const out: Graphic[] = [];
    while (!this.isEof() && !this.at(")")) {
      if (this.at(",")) {
        this.next();
        continue;
      }
      const k = this.peek();

      // name = value  (e.g. graphics={...}, coordinateSystem(...))
      if ((k.type === "ident" || k.type === "keyword") && this.peek(1).value === "=") {
        const argName = this.next().value;
        this.next(); // '='
        const val = this.parseValue();
        if (argName === "graphics" && Array.isArray(val)) {
          for (const item of val) if (isGraphic(item)) out.push(item as Graphic);
        }
        continue;
      }
      // name(...) — a graphics container such as coordinateSystem(...)
      if ((k.type === "ident" || k.type === "keyword") && this.peek(1).value === "(") {
        const name = this.next().value;
        this.next(); // '('
        if (GRAPHIC_KINDS.has(name)) {
          // A primitive written POSITIONALLY inside the layer — `Icon(Rectangle(...))`
          // rather than `Icon(graphics={Rectangle(...)})`. Legal Modelica, and a
          // second place a graphic can be dropped, so it records the drop and keeps
          // any `DynamicSelect` the same way the list form does.
          const dyn: Record<string, { editing: string; other: string }> = {};
          const args = this.parseArgumentListRaw(dyn);
          const g = buildGraphic(name, args, dyn);
          if (g) out.push(g);
          else this.dropStack[this.dropStack.length - 1]?.push(name);
        } else {
          // An unrecognised group (coordinateSystem, etc.) — consume it and,
          // for containers that may hold graphics, harvest nested primitives.
          const nested = this.parseGraphicsList();
          out.push(...nested);
        }
        continue;
      }
      this.next();
    }
    this.eat(")");
    return out;
  }

  /**
   * Parse `Placement(...)`.
   *
   * Conventionally the geometry lives one level deeper:
   *   Placement(transformation(extent={{-10,10},{10,30}}, rotation=90))
   * but bare `Placement(extent=...)` also occurs, so accept both.
   *
   * Transformation order per MLS §18.6.2 is extent -> rotation -> origin.
   */
  private parsePlacement(): Placement | null {
    this.expect("(");
    const outer = this.parseArgumentListRaw();

    let args = outer;
    const t = outer["transformation"];
    if (t && typeof t === "object" && !Array.isArray(t)) {
      args = t as Record<string, unknown>;
    }

    const extent = asExtentLike(args["extent"]);
    if (!extent) return null;

    const rotationRaw = args["rotation"];
    const rotation = rotationRaw === undefined ? 0 : Number(rotationRaw) || 0;

    return {
      extent,
      rotation,
      origin: toPairLike(args["origin"]),
      visible: args["visible"] === undefined ? true : Boolean(args["visible"]),
    };
  }

  /**
   * Consume the expression of a declaration binding and return its source text.
   *
   * The caller has already consumed the `=`. Scanning stops at a top-level
   * `;`, `annotation`, or string literal (the declaration's trailing comment),
   * while respecting nesting so bracketed groups are taken whole.
   */
  private parseBindingExpression(): string {
    const start = this.peek().start;
    let depth = 0;
    // A binding may itself begin with a bracket, as in
    //     parameter Medium.Density d=
    //       (if use_T then f(a, b, c) else g(d, e, f))
    //         "Boundary density"
    //         annotation (Dialog(...));
    // The closing bracket at depth 1 therefore belongs to the binding and must
    // be consumed. Breaking on it at depth 0 returned an empty string without
    // advancing, which left the cursor inside the expression; the declaration
    // then failed to parse, the body fell through to `skipStatement`, and that
    // stopped at the same bracket — losing the remainder of the class and every
    // class after it. `Fluid/Sources.mo` yielded 3 classes instead of 30.
    let enteredBracket = false;

    while (!this.isEof()) {
      const t = this.peek();
      const v = t.value;
      if (depth === 0 && enteredBracket) break;
      if (depth === 0) {
        if (v === ";" || v === "annotation") break;
        if (t.type === "string") break;
      }
      if (v === "(" || v === "[" || v === "{") {
        depth++;
        enteredBracket = true;
      } else if (v === ")" || v === "]" || v === "}") {
        depth--;
        this.next();
        continue;
      }
      this.next();
    }
    return this.sourceSlice(start, this.peek().start).trim();
  }

  /**
   * Parse an argument list, converting nested `name(...)` groups into plain
   * objects so wrappers like `transformation(...)` are preserved.
   *
   * `Icon`, `Diagram` and `Placement` are routed to be parsed by
   * `parseAnnotationBody` where they can be interpreted as layers/placement
   * rather than as opaque values.
   */
  private parseArgumentListRaw(
    /** Filled with any `DynamicSelect` calls found, by attribute name. */
    dynamic?: Record<string, { editing: string; other: string }>
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    while (!this.isEof() && !this.at(")")) {
      if (this.at(",")) {
        this.next();
        continue;
      }
      const k = this.peek();
      if (k.type !== "ident" && k.type !== "keyword") {
        this.next();
        continue;
      }
      const key = this.next().value;

      // Icon/Diagram layers hold a list of graphic primitives; Placement is
      // parsed structurally so `transformation(...)` is unwrapped.
      if ((key === "Icon" || key === "Diagram") && this.at("(")) {
        this.next();
        out[key] = this.parseGraphicsList();
        continue;
      }
      if (key === "Placement" && this.at("(")) {
        const p = this.parsePlacement();
        if (p) out[key] = p;
        continue;
      }

      // A graphic primitive written with `=`: `Rectangle(extent=...)`.
      if (GRAPHIC_KINDS.has(key) && this.at("(") && !this.at("=")) {
        this.next();
        const dyn: Record<string, { editing: string; other: string }> = {};
        const args = this.parseArgumentListRaw(dyn);
        const g = buildGraphic(key, args, dyn);
        if (g) out[key] = g;
        else this.dropStack[this.dropStack.length - 1]?.push(key);
        continue;
      }

      if (this.at("(") && !this.at("=")) {
        // Nested modifier group, e.g. transformation(...)
        this.next();
        out[key] = this.parseArgumentListRaw();
        continue;
      }
      if (this.at("=")) {
        this.next();
        const value = this.parseValue();
        if (isDynamic(value)) {
          // The EDITING value is what the diagram draws; the call itself is kept
          // beside the arguments so the serializer can put it back verbatim.
          out[key] = value.editing;
          (dynamic ??= {})[key] = { editing: value.editingText, other: value.other };
          continue;
        }
        out[key] = value;
        continue;
      }
      // A bare name with nothing after it: `annotation (Dialog)` marks a
      // declaration as having a dialog without configuring one. Treating it as a
      // value made the parser ask for the value of `)`, and the recovery scan
      // that followed ran to the next `)` in the FILE — swallowing every class
      // after it. `Blocks/Math.mo` lost 20 blocks that way, `Math.Feedback`
      // among them.
      if (this.at(",") || this.at(")")) {
        out[key] = true;
        continue;
      }
      // positional value
      out[key] = this.parseValue();
    }
    this.eat(")");
    return out;
  }


  /**
   * Whether the parenthesised group at the cursor holds a top-level `=`.
   *
   * `(a = 1, b = 2)` is a modifier list; `(a and b)` is an expression. The
   * distinction is the whole difference between a record and a boolean test.
   * Lookahead only — the cursor does not move.
   */
  private parenGroupHasAssignment(): boolean {
    let depth = 0;
    for (let i = this.pos; i < this.tokens.length; i++) {
      const tk = this.tokens[i];
      if (tk.type === "eof") return false;
      if (tk.value === "(" || tk.value === "{" || tk.value === "[") depth++;
      else if (tk.value === ")" || tk.value === "}" || tk.value === "]") {
        depth--;
        if (depth === 0) return false;
      } else if (tk.value === "=" && depth === 1) return true;
    }
    return false;
  }

  /** Parse a value, falling back to raw text for anything unrecognised. */
  /**
   * `DynamicSelect(editing, other)`.
   *
   * Returns the EDITING value — the first argument, which the specification
   * requires to be a literal — wrapped so the attribute reader can also record
   * the source text of both arguments. The wrapper never reaches a graphic: the
   * reader unwraps it and stores the call beside the value, for the serializer.
   */
  private parseDynamicSelect(): DynamicArgument {
    this.next(); // '('
    const editingStart = this.peek().start;
    const editing = this.parseValue();
    const editingText = this.sourceSlice(editingStart, this.peek().start).replace(/,\s*$/, "").trim();
    let other = "";
    if (this.at(",")) {
      this.next();
      const otherStart = this.peek().start;
      this.skipToCloseParen();
      other = this.sourceSlice(otherStart, this.closedAt).trim();
    } else {
      this.eat(")");
    }
    return { editing, editingText, other };
  }

  /**
   * Consume up to and including the `)` that closes the current group.
   *
   * `closedAt` records where that `)` started, so the caller can take the source
   * text of everything before it without re-scanning.
   */
  private skipToCloseParen(): void {
    let depth = 0;
    while (!this.isEof()) {
      const t = this.peek();
      if (t.value === "(" || t.value === "[" || t.value === "{") depth++;
      else if (t.value === ")" || t.value === "]" || t.value === "}") {
        if (depth === 0 && t.value === ")") {
          this.closedAt = t.start;
          this.next();
          return;
        }
        depth--;
      }
      this.next();
    }
    this.closedAt = this.peek().start;
  }

  private closedAt = 0;

  private parseValue(): unknown {
    const t = this.peek();
    const result = this.parseValueInner();
    if (result !== UNPARSED) return result;
    // Unknown construct: capture its raw source text so it can round-trip,
    // then let the caller continue from a sane position.
    const startOff = t.start;
    const before = this.pos;
    this.skipExpression();
    // Nothing was consumed, so the token is a separator the value cannot include.
    // Returning "" would leave a caller's loop with no progress to make.
    if (this.pos === before) return undefined;
    return this.sourceSlice(startOff, this.peek().start).trim();
  }

  private parseValueInner(): unknown {
    const t = this.peek();

    if (t.type === "number") {
      this.next();
      return Number(t.value);
    }
    if (t.value === "true") {
      this.next();
      return true;
    }
    if (t.value === "false") {
      this.next();
      return false;
    }
    if (t.type === "string") {
      this.next();
      return t.value;
    }
    if (t.value === "-" || t.value === "+") {
      const sign = this.next().value === "-" ? -1 : 1;
      const num = this.peek();
      if (num.type === "number") {
        this.next();
        return sign * Number(num.value);
      }
      return NaN;
    }
    if (t.value === "{") {
      // A brace list may be plain data, or — in the MSL idiom
      // `Icon(graphics={Rectangle(...), Line(...)})` — a list of graphic
      // primitives. Recognise the primitive form so icons are not lost.
      return this.parseBraceList();
    }
    if (t.value === "(") {
      // Modelica writes both a modifier list and a parenthesised EXPRESSION in
      // this position, and only the first is `name = value`. Reading the second
      // as the first turned `visible=(use_pder and use_pder2)` into
      // `{"use_pder": "and use_pder2"}`: an object, which is neither `true` nor a
      // string, so the graphic failed every visibility test and was hidden. 20
      // graphics in MSL are written this way, all of them icon labels.
      const startOff = t.start;
      if (!this.parenGroupHasAssignment()) {
        let depth = 0;
        do {
          const tk = this.next();
          if (tk.value === "(") depth++;
          else if (tk.value === ")") depth--;
          if (tk.type === "eof") break;
        } while (depth > 0);
        // Drop the outer parentheses: the value is the expression inside them.
        const raw = this.sourceSlice(startOff, this.peek().start).trim();
        return raw.replace(/^\(([\s\S]*)\)$/, "$1").trim();
      }
      // A tuple/record value — keep as object
      this.next();
      return this.parseArgumentListRaw();
    }
    if (t.value === "[" ) {
      // A matrix — keep raw
      const startOff = t.start;
      let depth = 0;
      do {
        const tk = this.next();
        if (tk.value === "[") depth++;
        else if (tk.value === "]") depth--;
        if (tk.type === "eof") break;
      } while (depth > 0);
      return this.sourceSlice(startOff, this.peek().start);
    }
    if (t.type === "ident" || t.type === "keyword") {
      // An identifier or keyword value: an enumeration literal, a parameter
      // reference, a function call, or an operator expression such as
      // `not use_p` or `-x`.
      //
      // The whole expression must be consumed. Consuming only the first token
      // left the rest to be re-read as the next argument's key, which looped:
      // MSL writes `annotation (Dialog(enable=not use_p))` throughout, and each
      // one walked the cursor to end of file, discarding every class after it.
      // `Fluid/Sources.mo` yielded 3 classes instead of 30.
      const startOff = t.start;
      let name = this.next().value;
      while (this.at(".")) {
        this.next();
        name += "." + this.next().value;
      }
      if (this.at("(")) {
        // `DynamicSelect(editing, other)` is the one call in a graphical
        // annotation whose VALUE matters: MLS §18.6.4 defines the first argument
        // as the value for the editing state and the second as the value while a
        // simulation runs. A diagram in an editor is the editing state, so the
        // first argument is what is drawn.
        //
        // Summarising it as `name(...)` — which is right for every other call —
        // meant the tank's water rectangle parsed as the STRING "DynamicSelect(...)"
        // where a numeric extent was required, so the graphic was dropped and the
        // tank drew empty; and its level text drew the source of the annotation
        // instead of the value. 106 annotations in MSL 4.1.0 are written this way.
        if (name === "DynamicSelect") {
          return this.parseDynamicSelect();
        }
        // Any other function call — treat as raw expression
        this.skipBalancedParens();
        return name + "(...)";
      }
      // Anything further (an operator and its operand) belongs to this value.
      // Stop at a separator or the end of the enclosing group.
      if (!this.at(",") && !this.at(")")) {
        this.skipExpression();
      }
      return this.sourceSlice(startOff, this.peek().start).trim();
    }

    // Deliberately does NOT consume the token. Consuming it here left
    // `skipExpression` starting one token late, from which it ran to the next
    // separator in the file rather than the end of this value.
    return UNPARSED;
  }

  private parseArray(): unknown[] {
    this.expect("{");
    const out: unknown[] = [];
    while (!this.isEof() && !this.at("}")) {
      if (this.at(",")) {
        this.next();
        continue;
      }
      const v = this.parseValue();
      if (v !== undefined) out.push(v);
      else this.next();
    }
    this.eat("}");
    return out;
  }

  /**
   * Parse a `{ ... }` list.
   *
   * If the list contains graphic primitives (the `graphics={Rectangle(...),...}`
   * idiom used by the whole Modelica Standard Library), the result is a list of
   * `Graphic` objects; otherwise it is a plain array of values.
   */
  /**
   * Primitives that could not be interpreted, per class being parsed.
   *
   * A stack, because a nested class's graphics belong to the nested class: its own
   * body parse pushes and pops, so a parent is never charged with a child's drop
   * (nor credited with its graphics).
   */
  private dropStack: string[][] = [];

  private parseBraceList(): unknown[] {
    const GRAPHICS = new Set([
      "Line", "Polygon", "Rectangle", "Ellipse", "Text", "Bitmap",
    ]);
    this.expect("{");
    const out: unknown[] = [];

    while (!this.isEof() && !this.at("}")) {
      if (this.at(",")) {
        this.next();
        continue;
      }
      const t = this.peek();

      // Graphic primitive form
      if (
        (t.type === "ident" || t.type === "keyword") &&
        GRAPHICS.has(t.value) &&
        this.peek(1).value === "("
      ) {
        const kind = this.next().value;
        this.next(); // '('
        const dyn: Record<string, { editing: string; other: string }> = {};
        const args = this.parseArgumentListRaw(dyn);
        const g = buildGraphic(kind, args, dyn);
        if (g) out.push(g);
        else this.dropStack[this.dropStack.length - 1]?.push(kind);
        continue;
      }

      const v = this.parseValue();
      if (v !== undefined) out.push(v);
      else this.next();
    }
    this.eat("}");
    return out;
  }
}

/** Sentinel returned by parseValueInner when it cannot interpret the input. */
const UNPARSED = Symbol("unparsed");

/**
 * A value that arrived as `DynamicSelect(editing, other)`.
 *
 * `editing` is what a diagram draws; the two source texts are kept so a save can
 * write the call back as it was written (see `Graphic.dynamic`).
 */
interface DynamicArgument {
  editing: unknown;
  editingText: string;
  other: string;
}

function isDynamic(v: unknown): v is DynamicArgument {
  return !!v && typeof v === "object" && "editing" in (v as object) && "editingText" in (v as object);
}

/** The six Modelica graphical primitives (MLS §18.6.5). */
const GRAPHIC_KINDS = new Set([
  "Line", "Polygon", "Rectangle", "Ellipse", "Text", "Bitmap",
]);

function isGraphic(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const k = (v as { kind?: unknown }).kind;
  return (
    k === "Line" || k === "Polygon" || k === "Rectangle" ||
    k === "Ellipse" || k === "Text" || k === "Bitmap"
  );
}

function refKey(r: ConnectorRef): string {
  return r.component ? `${r.component}.${r.port}` : r.port;
}

/**
 * Turn a `parameter`/`constant` declaration into palette metadata.
 * Values that are not simple literals are left unset so the UI can show the
 * declared expression rather than inventing a value.
 */
function toParameterDef(c: ParsedComponent): ParameterDef {
  const raw = c.modifiers[c.name];
  const literal =
    raw !== undefined && /^-?(\d+\.?\d*([eE][-+]?\d+)?|true|false|".*")$/.test(raw.trim())
      ? raw.trim().replace(/^"|"$/g, "")
      : undefined;
  const unit = c.modifiers["unit"];
  const min = c.modifiers["min"];
  const max = c.modifiers["max"];
  return {
    name: c.name,
    type: c.type,
    defaultValue: literal,
    unit: typeof unit === "string" ? unit.replace(/^"|"$/g, "") : undefined,
    comment: c.comment,
    min: min !== undefined && Number.isFinite(Number(min)) ? Number(min) : undefined,
    max: max !== undefined && Number.isFinite(Number(max)) ? Number(max) : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Graphic construction from parsed argument maps                      */
/* ------------------------------------------------------------------ */

function toFlatPoints(v: unknown): number[] {
  // Expect [[x,y],[x,y],...] — flatten. Also accept a flat list.
  const out: number[] = [];
  if (!Array.isArray(v)) return out;
  for (const item of v) {
    if (Array.isArray(item)) {
      for (const n of item) if (typeof n === "number") out.push(n);
    } else if (typeof item === "number") {
      out.push(item);
    }
  }
  return out;
}

function asColor(v: unknown): Color | undefined {
  if (!Array.isArray(v) || v.length < 3) return undefined;
  const c = v.slice(0, 3).map((n) => Number(n));
  if (c.some((n) => !Number.isFinite(n))) return undefined;
  return [clamp255(c[0]), clamp255(c[1]), clamp255(c[2])];
}

/**
 * `LinePattern.Dash` -> `Dash`. The renderer compares the bare literal.
 *
 * Modelica writes these attributes as qualified enumerations, and the renderer
 * switches on the member name alone, so a stored `"FillPattern.Backward"`
 * matched no case at all and fell through to the default. Nothing failed
 * loudly: every fill pattern, dash pattern, Bezier smoothing and border pattern
 * in the library was silently dropped, and `LinePattern.None` -- which MLS
 * defines as an INVISIBLE line -- was stroked as though it were Solid, putting
 * an outline on 1018 graphics that ask for none.
 *
 * Normalised here, at the single point where an annotation becomes a graphic,
 * rather than by teaching every renderer both spellings.
 */
function enumName(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const dot = v.lastIndexOf(".");
  const name = dot === -1 ? v : v.slice(dot + 1);
  return name === "" ? undefined : name;
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function asExtent(v: unknown): [number, number, number, number] | undefined {
  const f = toFlatPoints(v);
  if (f.length < 4) return undefined;
  return [f[0], f[1], f[2], f[3]];
}

function buildGraphic(
  kind: string,
  a: Record<string, unknown>,
  /** `DynamicSelect` calls found in this primitive's arguments, if any. */
  dynamic?: Record<string, { editing: string; other: string }>
): Graphic | null {
  const common = {
    // Any `DynamicSelect` call this primitive was written with, so a save puts
    // it back instead of leaving the editing value as a literal.
    dynamic: dynamic && Object.keys(dynamic).length > 0 ? dynamic : undefined,
    // Kept as parsed: `true`/`false` are booleans, but MSL also writes
    // expressions such as `visible=useHeatPort`. Coercing those with Boolean()
    // makes every conditional graphic visible, which is wrong for the common
    // defaults (a Resistor's heat port is hidden unless useHeatPort is set).
    visible: a.visible as boolean | string | undefined,
    origin: toPair(a.origin),
    rotation: typeof a.rotation === "number" ? a.rotation : undefined,
    lineColor: asColor(a.lineColor),
    pattern: enumName(a.pattern) as LinePattern | undefined,
    smooth: enumName(a.smooth) as SmoothKind | undefined,
  };

  switch (kind) {
    case "Line": {
      const arrowArr = a.arrow;
      let arrow: [ArrowKind, ArrowKind] | undefined;
      if (Array.isArray(arrowArr) && arrowArr.length >= 2) {
        arrow = [enumName(arrowArr[0]) as ArrowKind, enumName(arrowArr[1]) as ArrowKind];
      }
      const g: LineGraphic = {
        kind: "Line",
        points: toFlatPoints(a.points),
        color: asColor(a.color),
        thickness: typeof a.thickness === "number" ? a.thickness : undefined,
        arrow,
        arrowSize: typeof a.arrowSize === "number" ? a.arrowSize : undefined,
        ...common,
      };
      return g;
    }
    case "Polygon": {
      const g: PolygonGraphic = {
        kind: "Polygon",
        points: toFlatPoints(a.points),
        fillColor: asColor(a.fillColor),
        fillPattern: enumName(a.fillPattern) as FillPattern | undefined,
        lineThickness: typeof a.lineThickness === "number" ? a.lineThickness : undefined,
        ...common,
      };
      return g;
    }
    case "Rectangle": {
      const extent = asExtent(a.extent);
      if (!extent) return null;
      const g: RectangleGraphic = {
        kind: "Rectangle",
        extent,
        fillColor: asColor(a.fillColor),
        fillPattern: enumName(a.fillPattern) as FillPattern | undefined,
        lineThickness: typeof a.lineThickness === "number" ? a.lineThickness : undefined,
        borderPattern: enumName(a.borderPattern) as BorderPattern | undefined,
        radius: typeof a.radius === "number" ? a.radius : undefined,
        ...common,
      };
      return g;
    }
    case "Ellipse": {
      const extent = asExtent(a.extent);
      if (!extent) return null;
      const g: EllipseGraphic = {
        kind: "Ellipse",
        extent,
        fillColor: asColor(a.fillColor),
        fillPattern: enumName(a.fillPattern) as FillPattern | undefined,
        lineThickness: typeof a.lineThickness === "number" ? a.lineThickness : undefined,
        startAngle: typeof a.startAngle === "number" ? a.startAngle : undefined,
        endAngle: typeof a.endAngle === "number" ? a.endAngle : undefined,
        closure: enumName(a.closure) as EllipseGraphic["closure"],
        ...common,
      };
      return g;
    }
    case "Text": {
      const extent = asExtent(a.extent);
      if (!extent) return null;
      const style = Array.isArray(a.textStyle)
        ? (a.textStyle as unknown[]).map(Number).filter(Number.isFinite)
        : undefined;
      const g: TextGraphic = {
        kind: "Text",
        extent,
        textString: typeof a.textString === "string" ? a.textString : undefined,
        fontSize: typeof a.fontSize === "number" ? a.fontSize : undefined,
        textColor: asColor(a.textColor),
        textStyle: style,
        horizontalAlignment: toAlign(a.horizontalAlignment),
        verticalAlignment: toAlign(a.verticalAlignment),
        ...common,
      };
      return g;
    }
    case "Bitmap": {
      const extent = asExtent(a.extent);
      if (!extent) return null;
      const g: BitmapGraphic = {
        kind: "Bitmap",
        extent,
        fileName: typeof a.fileName === "string" ? a.fileName : undefined,
        imageSource: typeof a.imageSource === "string" ? a.imageSource : undefined,
        ...common,
      };
      return g;
    }
    default:
      return null;
  }
}

function toPair(v: unknown): [number, number] | undefined {
  const f = toFlatPoints(v);
  if (f.length < 2) return undefined;
  return [f[0], f[1]];
}

/** Like `asExtent`, but also accepts a nested object carrying `extent`. */
function asExtentLike(v: unknown): [number, number, number, number] | undefined {
  const direct = asExtent(v);
  if (direct) return direct;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const inner = (v as Record<string, unknown>)["extent"];
    return asExtent(inner);
  }
  return undefined;
}

/** Like `toPair`, but also accepts a nested object carrying `origin`. */
function toPairLike(v: unknown): [number, number] | undefined {
  const direct = toPair(v);
  if (direct) return direct;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return toPair((v as Record<string, unknown>)["origin"]);
  }
  return undefined;
}

function toAlign(v: unknown): -1 | 0 | 1 | undefined {
  const n = Number(v);
  if (n === -1 || n === 0 || n === 1) return n;
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Parse a whole Modelica file into its class definitions. */
export function parseModelica(source: string): ParsedClass[] {
  const p = new Parser(tokenize(source));
  p.sourceSlice = (s, e) => source.slice(s, e);
  return p.parseProgram();
}

/** Find one class by (possibly qualified) name. */
export function findClass(
  classes: ParsedClass[],
  name: string
): ParsedClass | undefined {
  for (const c of classes) {
    if (c.name === name || c.qualifiedName === name) return c;
  }
  return undefined;
}

/**
 * Convert a parsed class into a DiagramModel, resolving component class
 * references through the supplied lookup so port names are known.
 */
/**
 * Builtin scalar and array types, with any `parameter`/`constant` qualifier
 * already stripped by the parser.
 *
 * A declaration of one of these is a VARIABLE, not a component: it has no icon,
 * no ports and no position, so it does not belong on a schematic. Treating one as
 * a component put it on the canvas with a default placement — three stacked
 * 20x20 boxes, in the same place, for a model with three state variables.
 */
const MODELICA_BUILTIN = new Set([
  "Real", "Integer", "Boolean", "String", "Clock", "Time",
  "RealInput", "RealOutput", "IntegerInput", "IntegerOutput",
  "BooleanInput", "BooleanOutput",
  "Complex", "ComplexInput", "ComplexOutput",
  "Color", "Axis", "RotationTypes", "ExternalObject",
]);

/** True when a declaration is a variable rather than a schematic component. */
export function isBuiltinType(type: string): boolean {
  return MODELICA_BUILTIN.has(type);
}

export function toDiagramModel(
  cls: ParsedClass,
  lookup: (className: string) => ComponentClass | undefined
): DiagramModel {
  const declared = cls.components.filter((c) => c.type && c.name);
  // Split variables from components. Both are declarations, but only one kind
  // is drawn.
  const variables: VariableInstance[] = declared
    .filter((c) => isBuiltinType(c.type))
    .map((c) => ({
      id: c.name,
      type: c.type,
      params: extractParams(c.modifiers),
      prefixes: declarationPrefixes(c.prefixes),
      suffixDims: c.suffixDims,
    }));

  const components = declared
    .filter((c) => !isBuiltinType(c.type))
    .map((c) => ({
      id: c.name,
      className: c.type,
      placement: c.placement ?? {
        extent: [-10, -10, 10, 10],
        rotation: 0,
        visible: true,
      },
      params: extractParams(c.modifiers),
      prefixes: declarationPrefixes(c.prefixes),
      suffixDims: c.suffixDims,
      condition: c.condition,
    }));

  const known = new Set(components.map((c) => c.id));
  const connections = cls.connections.filter(
    (cn) => known.has(cn.from.component) && known.has(cn.to.component)
  );

  void lookup;
  return {
    name: cls.name,
    comment: cls.comment,
    components,
    variables,
    equations: cls.equations,
    connections,
    graphics: cls.diagram.length ? cls.diagram : [],
  };
}

/** Keep only modifiers that look like parameter bindings (not annotations). */
/**
 * Prefixes that must survive a round trip.
 *
 * `input`/`output` are properties of a class's interface, not of an instance,
 * and are not kept here.
 *
 * `parameter` and `constant` ARE kept. Dropping them turned a parameter record
 * into an ordinary component, so a model declaring
 * `parameter CellData cellData(...)` and then `cellData=cellData` came back as a
 * continuous variable bound to a higher-variability expression — OpenModelica:
 * "Component cellData of variability parameter has binding of higher
 * variability continuous". A record instance placed on the diagram is exactly
 * that case, and the qualifier is what keeps it valid.
 */
const KEPT_PREFIXES = new Set([
  "inner",
  "outer",
  "flow",
  "stream",
  "replaceable",
  "parameter",
  "constant",
]);

function declarationPrefixes(prefixes: string[] | undefined): string[] | undefined {
  const kept = (prefixes ?? []).filter((p) => KEPT_PREFIXES.has(p));
  return kept.length ? kept : undefined;
}

/**
 * Split `a=1, b=(c=2, d=3)` into top-level assignments.
 *
 * Nested sets are returned whole, so the caller can recurse into them.
 */
function splitModifierBody(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** The `start=1, fixed=true` inside `@modifier:(start=1, fixed=true)`. */
function modifierBody(raw: string): string {
  const open = raw.indexOf("(");
  if (open < 0) return "";
  const body = raw.slice(open + 1);
  let depth = 0;
  let inString = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) return body.slice(0, i);
      depth--;
    }
  }
  return body;
}

/**
 * Parameter bindings for an instance, with nested modifiers expanded.
 *
 * `T(start=293.15)` arrives as `T: "@modifier:(start=293.15)"` and is expanded
 * to `T.start = 293.15`, which is the form the serializer emits and the
 * inspector edits. Dropping these lost every initial condition and every
 * structural flag on load: a heat capacitor came back with no starting
 * temperature at all, and a joint with `useAxisFlange=true` lost that too.
 */
function extractParams(modifiers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(modifiers)) {
    if (k.startsWith("__")) continue;
    if (k === "placement") continue;
    if (v.startsWith("@modifier:")) {
      for (const part of splitModifierBody(modifierBody(v))) {
        const eq = part.indexOf("=");
        if (eq < 0) continue;
        out[`${k}.${part.slice(0, eq).trim()}`] = part.slice(eq + 1).trim();
      }
      continue;
    }
    out[k] = v;
  }
  return out;
}


function isVisibleGraphic(g: Graphic): boolean {
  return g.visible !== false && (g as { kind: string }).kind !== "__placement";
}

/**
 * Where a component's Placement puts the CENTRE of its icon, in the enclosing
 * class's canonical icon coordinates. Used to locate connector pins inside a
 * component symbol.
 *
 * MLS 18.6.2 applies the transformation in the order `extent`, `rotation`,
 * `origin`: the icon is mapped onto the `extent` rectangle, rotated about
 * `{0, 0}` -- explicitly NOT about `origin` -- and then shifted by `origin`.
 * The centre of the icon therefore lands on the centre of the extent PLUS the
 * origin.
 *
 * Dropping the origin is not a rounding error. Every one of the 393 MSL pin
 * placements that gives an origin writes the extent symmetrically
 * (`extent={{-20,-20},{20,20}}, origin={-120,60}`), so its centre is exactly
 * `{0,0}` and the pin was placed at the middle of the symbol: 284 of them land
 * strictly inside the artwork they are supposed to sit on the edge of. A Ground
 * pin, declared at `origin={0,100}`, resolved to the icon origin instead of the
 * top of its stem, and wires met it there.
 */
export function placementCenter(
  p:
    | { extent: [number, number, number, number]; origin?: [number, number] }
    | undefined
): [number, number] | undefined {
  if (!p?.extent) return undefined;
  const [x1, y1, x2, y2] = p.extent;
  const [ox, oy] = p.origin ?? [0, 0];
  return [(x1 + x2) / 2 + ox, (y1 + y2) / 2 + oy];
}
