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
import { extractModelica, modelNameOf } from "./prompts";
import { DEFAULT_LIMITS, runGenerationLoop, summarise, type Attempt, type LoopLimits, type LoopResult } from "./loop";

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
  /** Turn the conversation into messages. Injected so prompt building stays testable. */
  buildMessages: (
    prompt: string,
    current: string | undefined,
    failure: string
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
    phase: "asking" | "compiling" | "repairing";
    detail?: string;
  }) => void;
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

  const result = await runGenerationLoop(
    {
      generate: async ({ attempt, previous }) => {
        const messages = request.buildMessages(
          request.prompt,
          request.current,
          previous ? failureText(previous) : ""
        );
        const reply = await request.send(messages);
        const source = extractModelica(reply);
        if (source) modelName = modelNameOf(source) ?? modelName;
        request.onProgress?.({
          attempt,
          maxAttempts: request.limits?.maxAttempts ?? DEFAULT_LIMITS.maxAttempts,
          phase: previous ? "repairing" : "asking",
        });
        return source;
      },

      compile: async (source) => {
        const name = modelNameOf(source);
        if (!name) {
          // Without a class to build there is nothing to ask the compiler, and
          // OpenModelica's answer would be about the file rather than the model.
          return {
            ok: false,
            failure:
              'The reply has no class declaration, so there is nothing to compile. Expected "model <Name> ... end <Name>;".',
          };
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

        if (!outcome.ok) return { ok: false, failure: formatDiagnostics(outcome.diagnostics) };

        // Compiling is not the same as being simulatable.
        const staticProblem = describeStaticModel(source, outcome.diagnostics);
        return staticProblem ? { ok: false, failure: staticProblem } : { ok: true, failure: "" };
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
