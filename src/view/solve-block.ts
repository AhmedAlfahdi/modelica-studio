/**
 * The `modelica-solve` block: a calculation in a note, answered by the solver.
 *
 * A note is where a number gets explained, questioned and used again three
 * paragraphs later, and a number typed into prose is wrong the moment the model
 * changes. So the block holds the *relationship* rather than the answer, and the
 * answer is recomputed from it — which is also why the block needs no state of
 * its own and nothing is written back to the note.
 *
 * This module is the frame: read the block, ask the backend, show the number.
 * The reading is in `modelica/solve.ts` and the solving is the same
 * `SimulationBackend` the studio and the diagram embeds use, because a solver
 * block is not a second kind of simulation — it is the same translation asked for
 * the initialisation instead of a trajectory.
 */

import { renderMath, setIcon } from "obsidian";
import type { SimSeries, SimulationBackend } from "../omc/backend";
import { SimulationError } from "../omc/backend";
import { describeError } from "../errors";
import {
  DEFAULT_START,
  buildSolveModel,
  declaredNames,
  parseSolveBlock,
  solveModelName,
  type SolveSpec,
} from "../modelica/solve";
import { modelicaToLatex } from "../modelica/latex";

/** One solved symbol: what it is, what it came to, and its unit when it has one. */
interface SolvedValue {
  name: string;
  text: string;
  unit?: string;
}

/** What a solve block needs from the plugin. */
export interface SolveDeps {
  /** The backend, or null when no OpenModelica installation was found. */
  backend: SimulationBackend | null;
  /** A line for the plugin's own diagnostic log. */
  report: (message: string) => void;
  /** Opens the panel explaining how to install OpenModelica. */
  setupHelp: () => void;
}

/**
 * What an empty solve block is offered.
 *
 * The example is the one from the README: `x` appears twice and is not isolated
 * by any algebra, which is the whole reason to reach for a solver rather than a
 * calculator. An empty block that showed `1 + 1` would teach the wrong thing.
 */
export function starterSolveSource(): string {
  return ["//@ solve x", "sqrt(x) + x^2 - 56 = 67", ""].join("\n");
}

/**
 * A number as a result should read.
 *
 * Twelve significant digits: past the point where a double carries any more
 * meaning, and short of the point where a solver's answer would look like more
 * precision than the iteration actually found. `toPrecision` pads with zeros the
 * number does not have, so it is parsed back to drop them — `2.500000000000` is
 * not what a solver returned.
 *
 * The exponent form is kept for magnitudes that would otherwise be unreadable: a
 * wall of zeros on one end, or a row of them after the point on the other.
 */
export function formatSolvedValue(value: number): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? "not a number" : String(value);
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 1e7 || magnitude < 1e-4) return value.toExponential(6);
  return String(Number(value.toPrecision(12)));
}

export class SolveBlock {
  private readonly root: HTMLElement;

  /**
   * The relationship, and where its answer goes.
   *
   * Two containers rather than one, because the question is written once and the
   * answer replaces itself: `solving…`, then a value, then possibly a failure. They
   * are created in this order and never reordered, since the panel is a column and
   * the equation has to be above the number it produced — the whole reason the
   * question is drawn at all.
   */
  private readonly question: HTMLElement;
  private readonly outcome: HTMLElement;
  private disposed = false;

  constructor(
    private readonly deps: SolveDeps,
    host: HTMLElement,
    private readonly body: string
  ) {
    this.root = host.createDiv({ cls: "modelica-studio-solve" });
    this.question = this.root.createDiv({ cls: "modelica-studio-solve-question" });
    this.outcome = this.root.createDiv({ cls: "modelica-studio-solve-outcome" });
  }

  /** Solve once, then stop. A block is rebuilt whenever the note re-renders. */
  mount(): void {
    const spec = parseSolveBlock(this.body);
    this.renderQuestion(spec);

    if (spec.problem || !spec.unknown) {
      this.renderProblem(spec.problem ?? "No symbol to solve for.");
      return;
    }
    if (!this.deps.backend) {
      this.renderNoCompiler();
      return;
    }

    const modelName = solveModelName(spec);
    const source = buildSolveModel(spec, modelName);
    this.renderPending(spec.unknown);

    this.deps.report(`solve: ${modelName} for ${spec.unknown}${spec.inferred ? " (inferred)" : ""}`);

    void this.solve(modelName, source, spec);
  }

  /** Stop caring about a result that is on its way. */
  destroy(): void {
    this.disposed = true;
  }

  private async solve(modelName: string, source: string, spec: SolveSpec): Promise<void> {
    const unknown = spec.unknown!;
    try {
      // `stopTime: 0` is the whole trick. OpenModelica must find values for every
      // variable that satisfy every equation before it can take a step, and that
      // initialisation IS the solve: asked to simulate for no time at all, it
      // returns the answer and does nothing else.
      const result = await this.deps.backend!.simulate({
        modelName,
        source,
        stopTime: 0,
      });
      if (this.disposed) return;

      const series = result.series.find((s) => s.name === unknown);
      if (!series || series.values.length === 0) {
        this.renderProblem(
          `The compiler solved for \`${unknown}\` and did not report it. ` +
            `That happens when the equation determines it before the run, as in \`x = 5\`.`
        );
        return;
      }

      // Every undefined symbol was solved, not only the one that was named, so
      // every one of them is reported: a system of equations answered with one of
      // its two unknowns leaves the reader doing the rest of the work. The named
      // symbol comes first because it is the one the directive asked for; the
      // others are the same answer seen whole.
      const order = [unknown, ...spec.unknowns.filter((name) => name !== unknown)];
      const answers = order
        .map((name) => ({ name, series: result.series.find((s) => s.name === name) }))
        .filter((row): row is { name: string; series: SimSeries } => !!row.series && row.series.values.length > 0)
        .map((row) => ({ name: row.name, text: formatSolvedValue(row.series.values[0]), unit: row.series.unit }));

      this.renderAnswer(answers, spec);
    } catch (err) {
      if (this.disposed) return;
      this.renderFailure(err);
    }
  }

  /* ------------------------------ rendering ------------------------------ */

  /**
   * The relationship being solved, shown above its answer.
   *
   * The block's text is the question and the panel is the answer, so a panel that
   * showed only the number would be the very thing this feature replaces: a result
   * in a note with no statement of what produced it. Rendering the question back
   * costs a few lines and makes the block read on its own — which is what it has
   * to do once the note is read by someone else, or by its author a month later.
   *
   * Declarations come first because they are the givens, and they are quieter: a
   * `parameter target = 67` line is context for the equation rather than part of
   * the relationship.
   */
  private renderQuestion(spec: SolveSpec): void {
    if (spec.declarations.length === 0 && spec.equations.length === 0) {
      // Removed rather than left empty: the container carries the rule that
      // separates the question from the answer, and an empty one would draw a
      // divider above nothing.
      this.question.remove();
      return;
    }
    // Declarations stay as text. `parameter Real target = 70` is a declaration, not
    // a statement of mathematics, and typesetting it would dress up a keyword as a
    // symbol — while `... = target` above the answer is the part worth drawing.
    for (const declaration of spec.declarations) {
      this.question.createDiv({ cls: "modelica-studio-solve-line modelica-studio-solve-given", text: declaration });
    }
    for (const equation of spec.equations) {
      this.addEquation(this.question, equation);
    }
  }

  /**
   * One equation, typeset when it can be and shown as source when it cannot.
   *
   * The fallback is per line and automatic, which is why the converter returns
   * nothing rather than something approximate: a comprehension or an `if`
   * expression keeps its readable source, and the equation above it is typeset.
   * `renderMath` is guarded because it is the one Obsidian API here that does not
   * exist in the test stub or in the build's own type surface — a plugin that
   * failed to load over a missing renderer would be a worse outcome than plain
   * text.
   */
  private addEquation(host: HTMLElement, equation: string): void {
    const line = host.createDiv({ cls: "modelica-studio-solve-line" });
    const latex = modelicaToLatex(equation);
    if (latex && typeof renderMath === "function") {
      try {
        line.appendChild(renderMath(latex, true));
        line.addClass("modelica-studio-solve-typeset");
        return;
      } catch {
        line.empty();
      }
    }
    line.setText(equation);
  }

  private renderPending(unknown: string): void {
    const row = this.outcome.createDiv({ cls: "modelica-studio-solve-row" });
    row.createSpan({ cls: "modelica-studio-solve-name", text: unknown });
    row.createSpan({ cls: "modelica-studio-solve-eq", text: "=" });
    row.createSpan({ cls: "modelica-studio-solve-value modelica-studio-solve-pending", text: "solving…" });
  }

  private renderAnswer(answers: SolvedValue[], spec: SolveSpec): void {
    this.outcome.empty();

    for (const answer of answers) {
      const row = this.outcome.createDiv({ cls: "modelica-studio-solve-row" });
      row.createSpan({ cls: "modelica-studio-solve-name", text: answer.name });
      row.createSpan({ cls: "modelica-studio-solve-eq", text: "=" });
      row.createSpan({ cls: "modelica-studio-solve-value", text: answer.text });
      if (answer.unit) row.createSpan({ cls: "modelica-studio-solve-unit", text: answer.unit });
    }

    // Two facts are worth stating, and only when they were the plugin's choice
    // rather than the block's:
    //
    //   - which symbol the equations left undefined, when the block did not say.
    //     A solver block that quietly picked one is a block whose answer is about
    //     something the user did not ask for.
    //   - the starting value, because it is not neutral. A solver returns the root
    //     nearest to where it began, so `x^2 = 2` has two right answers and this is
    //     what chose between them. Declared by the block, the value is the user's
    //     own and repeating it back would be noise.
    const undeclared = answers.filter((a) => !declaredNames(spec.declarations).has(a.name));
    const parts: string[] = [];
    if (spec.inferred) parts.push(`solved for ${spec.unknown}, the only undefined symbol`);
    if (undeclared.length === 1) parts.push(`nearest solution to ${undeclared[0].name} = ${DEFAULT_START}`);
    else if (undeclared.length > 1) parts.push(`nearest solution to each, starting from ${DEFAULT_START}`);
    if (parts.length) {
      this.outcome.createDiv({ cls: "modelica-studio-solve-note", text: parts.join(" · ") });
    }
  }

  /**
   * A block that cannot be read, said plainly.
   *
   * These are the messages that carry the whole feature for someone who has never
   * seen Modelica: the dialect is smaller than the language, so the interesting
   * failures are all about what the block is missing rather than about syntax.
   *
   * The icon is the help one rather than a warning triangle, for the same reason:
   * every message here ends in an action — name the symbol, write an equation,
   * install the compiler — and a warning mark would say something is wrong
   * without saying what to do about it.
   */
  private renderProblem(problem: string): void {
    this.outcome.empty();
    const box = this.outcome.createDiv({ cls: "modelica-studio-solve-problem" });
    setIcon(box.createSpan({ cls: "modelica-studio-solve-icon" }), "help-circle");
    box.createSpan({ text: problem });
  }

  private renderNoCompiler(): void {
    const box = this.outcome.createDiv({ cls: "modelica-studio-solve-problem" });
    setIcon(box.createSpan({ cls: "modelica-studio-solve-icon" }), "help-circle");
    box.createSpan({ text: "OpenModelica was not found, so this calculation cannot be evaluated." });
    const button = box.createEl("button", { cls: "modelica-studio-btn", text: "How to install" });
    button.addEventListener("click", () => this.deps.setupHelp());
  }

  /**
   * A failed solve, with the compiler's own words.
   *
   * The compiler's diagnostics are the useful part — "the following equation is
   * inconsistent", "no solution found" — and paraphrasing them would lose the one
   * line that says which equation is wrong.
   */
  private renderFailure(err: unknown): void {
    this.outcome.empty();
    const box = this.outcome.createDiv({ cls: "modelica-studio-solve-error" });
    const message =
      err instanceof SimulationError
        ? err.diagnostics.filter((d) => d.severity === "error").map((d) => d.message).join("\n") || err.message
        : describeError(err);
    box.createDiv({ cls: "modelica-studio-solve-error-text", text: message });
    this.deps.report(`solve failed: ${message.split("\n")[0]}`);
  }
}
