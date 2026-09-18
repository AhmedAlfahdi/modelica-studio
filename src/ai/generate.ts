/**
 * The AI generation feature: ask, compile, repair.
 *
 * Kept apart from the loop itself so the control flow can be tested without a
 * provider or a compiler, and apart from the view so the same run can be driven
 * from anywhere.
 *
 * Two decisions worth stating.
 *
 * It COMPILES rather than simulating while it iterates. Compiling is what
 * produces diagnostics, it is the step that fails, and it costs about a fifth of
 * a run — so a loop of four repairs costs less than one simulate. The simulation
 * happens once, at the end, on a model that already builds.
 *
 * A model that compiles but has no time-dependent variables is treated as a
 * FAILURE, not a success. OpenModelica builds it happily and then refuses to
 * simulate it, so accepting it at the compile step would hand the user a model
 * that cannot run and no explanation.
 */

import type { SimulationBackend } from "../omc/backend";
import { SimulationError, type CompileDiagnostic } from "../omc/backend";
import type { AiConfig, ChatMessage } from "./prompts";
import { extractModelica, modelNameOf, type ModelStyle } from "./prompts";
import { DEFAULT_LIMITS, runGenerationLoop, summarise, type Attempt, type LoopLimits, type LoopResult } from "./loop";
import type { AiExchange } from "./interaction-log";

export interface GenerationRequest {
  /** What the user asked for. */
  prompt: string;
  /** The brief about this installation, from `ai/context.ts`. */
  environment: string;
  /** The model currently in the editor, if the request is an edit. */
  current?: string;
  /** Resolves the API key; only Obsidian can reach the keychain. */
  getKey: () => string | null;
  config: AiConfig;
  backend: SimulationBackend;
  /** Run settings, so the structural check matches what a run would use. */
  settings: {
    startTime: number;
    stopTime: number;
    numberOfIntervals: number;
    tolerance: number;
    solver: string;
  };
  /**
   * Turn the conversation into messages.
   *
   * `style` is which approach this attempt should take, so the fallback reaches
   * the prompt rather than only the loop.
   */
  buildMessages: (
    prompt: string,
    current: string | undefined,
    failure: string,
    style: ModelStyle
  ) => ChatMessage[];
  /**
   * Send a conversation to the provider and return its reply.
   *
   * Injected rather than imported: the HTTP client reaches Obsidian's request
   * helper, and keeping that out of this module is what lets the whole runner —
   * including how it feeds a failure back — be tested against a fake provider.
   */
  send: (messages: ChatMessage[]) => Promise<string>;
  onProgress?: (event: {
    attempt: number;
    maxAttempts: number;
    phase: "asking" | "compiling" | "repairing" | "switching";
    style?: string;
    detail?: string;
  }) => void;
  /**
   * Called once per attempt, with the reply AND its verdict.
   *
   * Both halves are needed for the record to be worth keeping, and they are known
   * at different moments -- the reply when it arrives, the verdict after the
   * compiler has seen it. This is called at the later of the two.
   */
  onExchange?: (exchange: AiExchange) => void;
  isCancelled?: () => boolean;
  limits?: LoopLimits;
}

export interface GenerationOutcome extends LoopResult {
  /** The model name the last attempt declared, when it could be read. */
  modelName?: string;
  /** Diagnostics from the final failed compile, for the gutter. */
  diagnostics: CompileDiagnostic[];
}

/**
 * Run one generation, repairing until it compiles.
 *
 * Never throws for an ordinary failure: a run that cannot produce a compiling
 * model is a result with a reason, because that is what the caller has to report.
 */
export async function generateModel(request: GenerationRequest): Promise<GenerationOutcome> {
  let diagnostics: CompileDiagnostic[] = [];
  let modelName: string | undefined;
  const initial = request.config.style ?? "visual";
  /**
   * The style the source being compiled was asked for.
   *
   * `compile` is only given the source, so it cannot know which form was
   * requested; the style is recorded as each answer arrives, which is the answer
   * about to be compiled.
   */
  let askedFor: ModelStyle = initial;
  /** The last conversation sent and the raw reply, held until its verdict is in. */
  let lastMessages: ChatMessage[] = [];
  let lastReply = "";
  let lastAskedAt = 0;

  const result = await runGenerationLoop(
    {
      style: initial,
      /**
       * The diagram is the better answer when it works and the harder one to get
       * right, so it is tried first and abandoned for equations when it will not
       * build. Only from visual: there is nothing less error-prone to fall back
       * to, and a second change would be thrashing.
       */
      switchStyle: ({ from, lastFailure }) => {
        if (from !== "visual") return null;
        // A model that is not a diagram at all is not a diagram that failed:
        // falling back would be the right answer for the wrong reason, and the
        // equations answer is what the request already had.
        return "equations";
      },
      generate: async ({ attempt, previous, style }) => {
        askedFor = (style as ModelStyle) || initial;
        const messages = request.buildMessages(
          request.prompt,
          request.current,
          previous ? failureText(previous) : "",
          (style as ModelStyle) || initial
        );
        // Kept so the record has the conversation that produced the reply. The
        // reply alone cannot be used to improve a prompt: what was asked is half
        // the evidence.
        lastMessages = messages;
        lastAskedAt = Date.now();
        const reply = await request.send(messages);
        lastReply = reply;
        const source = extractModelica(reply);
        if (source) modelName = modelNameOf(source) ?? modelName;
        return source;
      },

      compile: async (source, attempt) => {
        // Whatever the verdict, it is recorded against the reply that earned it.
        const record = (outcome: AiExchange["outcome"], detail: string) => {
          request.onExchange?.({
            at: new Date().toISOString(),
            attempt,
            style: askedFor,
            prompt: request.prompt,
            messages: lastMessages.map((m) => ({ role: m.role, content: m.content })),
            reply: lastReply,
            extracted: source || null,
            outcome,
            detail,
            ms: lastAskedAt ? Date.now() - lastAskedAt : 0,
          });
        };

        const name = modelNameOf(source);
        if (!name) {
          // Without a class to build there is nothing to ask the compiler, and
          // OpenModelica's answer would be about the file rather than the model.
          const failure =
            'The reply has no class declaration, so there is nothing to compile. Expected "model <Name> ... end <Name>;".';
          record("no-source", failure);
          return { ok: false, builds: false, failure };
        }
        modelName = name;
        const outcome = await request.backend.compile({
          modelName: name,
          source,
          startTime: request.settings.startTime,
          stopTime: request.settings.stopTime,
          numberOfIntervals: request.settings.numberOfIntervals,
          tolerance: request.settings.tolerance,
          solver: request.settings.solver || undefined,
        });
        diagnostics = outcome.diagnostics;

        if (!outcome.ok) {
          const failure = formatDiagnostics(outcome.diagnostics);
          record("compile-error", failure);
          return { ok: false, builds: false, failure };
        }

        // Compiling is not the same as being usable. Two things build perfectly
        // and are still not what was asked for, and both are checked here so a
        // repair attempt hears about them instead of the run reporting success.
        const problem =
          describeStaticModel(source, outcome.diagnostics) ??
          describeLooseDiagram(source) ??
          describeStyleViolation(source, askedFor);
        // It BUILT. A problem here is a rejection, not a compile failure, and the
        // caller is told so because the source is worth keeping and running.
        if (problem) {
          // It BUILT. Recorded as a rejection so the log can separate "the
          // instruction was unclear" from "the model cannot write Modelica".
          record("rejected", problem);
          return { ok: false, builds: true, failure: problem };
        }
        record("ok", "");
        return { ok: true, builds: true, failure: "" };
      },

      onProgress: request.onProgress,
      isCancelled: request.isCancelled,
    },
    request.limits ?? DEFAULT_LIMITS
  );

  return { ...result, modelName, diagnostics };
}

/**
 * Detect a model that builds but cannot be simulated.
 *
 * OpenModelica compiles a model with nothing time-dependent and then refuses it
 * with "Found equation without time-dependent variables", which arrives after a
 * full compile and reads as a mystery. Catching it here lets the repair attempt
 * be told what to add.
 */
export function describeStaticModel(source: string, diagnostics: CompileDiagnostic[]): string | null {
  // If the compiler already said it, it is not a static-model problem.
  if (diagnostics.some((d) => d.severity === "error")) return null;

  const body = source.replace(/\/\/[^\n]*/g, "");
  const timeDependent =
    /\bder\s*\(/.test(body) ||
    /\btime\b/.test(body) ||
    /\bwhen\b/.test(body) ||
    /\bsample\s*\(/.test(body) ||
    // A component from a library brings its own dynamics; only a model made of
    // nothing but equations can be genuinely static.
    /Modelica\.[A-Za-z0-9_.]+/.test(body) && /^\s*(?:Modelica\.)?\w[\w.]*\s+\w+/m.test(body);

  if (timeDependent) return null;
  return (
    "The model compiles but has nothing that changes with time: no der(), no time, " +
    "no when, and no library components. OpenModelica refuses such a model as having " +
    '"no time-dependent variables", so add the dynamics the request is about.'
  );
}

/** The compiler's output as text, with the positions it reported. */
export function formatDiagnostics(diagnostics: CompileDiagnostic[]): string {
  const lines = diagnostics
    .filter((d) => d.severity !== "notification")
    .map((d) => {
      const where =
        d.line !== undefined
          ? ` (line ${d.line}${d.column !== undefined ? `, column ${d.column}` : ""})`
          : "";
      return `${d.severity}: ${d.message}${where}`;
    });
  // A compile can fail with no diagnostic parsed out; say so rather than send an
  // empty "failure", which would read as progress.
  return lines.length
    ? lines.join("\n")
    : "The compiler failed without reporting a diagnostic. Check that the model is complete and self-contained.";
}

function failureText(attempt: Attempt): string {
  return attempt.failure;
}

export { summarise };

/**
 * Detect a diagram whose components are not wired to each other.
 *
 * Eight library components with no `connect` between them compile and simulate:
 * the physics is whatever their defaults happen to be, and nothing links the
 * blocks. It looks like a schematic and is not one -- a `Mass`, two `Force`
 * blocks, an `Area` and a `Velocity` sitting unconnected, presented as a drag
 * model.
 *
 * Reported as a failure so the repair attempt is told, rather than the run
 * reporting success on something that draws a picture of nothing.
 */
export function describeLooseDiagram(source: string): string | null {
  const body = stripComments(source);
  // Only a model built from library components can be a loose diagram.
  const declared = [...body.matchAll(/^\s*(?:redeclare\s+)?(Modelica\.[\w.]+)\s+(\w+)/gm)];
  if (declared.length < 2) return null;

  const connected = new Set<string>();
  // Every name inside connect(...), which captures both ends of each pair.
  for (const call of body.matchAll(/connect\s*\(([^)]*)\)/g)) {
    for (const name of call[1].matchAll(/\b([A-Za-z_]\w*)\s*\./g)) connected.add(name[1]);
  }

  const loose = declared.map((m) => m[2]).filter((name) => !connected.has(name));
  if (loose.length === 0) return null;

  // One loose component among several that are wired is a small omission; all of
  // them loose is the model not being a diagram at all, and the two want
  // different answers.
  const allLoose = loose.length === declared.length;
  return allLoose
    ? `None of the ${declared.length} components are connected to each other: ${loose.join(", ")}. ` +
        `A schematic whose blocks are not wired together is not a model of anything -- ` +
        `either add the connect() statements that join them, or write the physics as ` +
        `equations, where there is nothing to wire.`
    : `${loose.length} component${loose.length === 1 ? " is" : "s are"} connected to nothing: ` +
        `${loose.join(", ")}. Every declared component must appear in a connect(), ` +
        `or be removed.`;
}

/** Source with comments removed, so a commented-out connect is not counted. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * Detect an answer that ignored the form it was asked for.
 *
 * Measured: asked for equations, the model assembled components anyway in 2 runs
 * out of 8, and one of those then failed structurally -- four components, none
 * wired. The instruction and the class list disagreed and the class list won,
 * which is now fixed upstream; this is the check that catches a relapse.
 *
 * A library component inside an otherwise-equation model is fine -- a `Modelica.
 * Constants` reference or a medium is not a diagram. Something is only a diagram
 * when it has several components AND wires between them.
 */
export function describeStyleViolation(source: string, style: ModelStyle): string | null {
  if (style !== "equations") return null;
  const components = [...source.matchAll(/^\s*(?:redeclare\s+)?Modelica\.[\w.]+\s+\w+/gm)].length;
  const connects = (source.match(/\bconnect\s*\(/g) ?? []).length;

  // Two of each is the point at which it is unmistakably an assembly.
  if (components < 2 || connects < 2) return null;
  return (
    `This answer was asked for as EQUATIONS but came back as an assembly of ${components} ` +
    `library components and ${connects} connections. Rewrite it as equations: no ` +
    `components, no connect(), no Placement. Declare the quantities you need and write ` +
    `one equation per unknown.`
  );
}
