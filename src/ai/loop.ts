/**
 * Generate, compile, repair, repeat — until it works or it is clearly stuck.
 *
 * Asking a model for a model and hoping is not enough: the first attempt usually
 * compiles and sometimes does not, and the failure is the most useful thing to
 * feed back. So the loop is:
 *
 *   ask with the full brief -> compile -> if it failed, ask again WITH the
 *   compiler's output -> repeat
 *
 * Two things stop it. A hard ceiling on attempts, because an unbounded loop on a
 * paid API is not a feature; and detection of the two ways a repair loop wastes
 * effort -- the model returning the SAME source again, which it cannot fix by
 * being asked once more, and the error not changing, which is how a loop looks
 * from the outside even when the text differs each time.
 *
 * The orchestration is a pure function of injected callbacks. No Obsidian, no
 * network, no compiler: the whole control flow can then be tested against a fake
 * that returns a fixed sequence of replies, which is the only way to check the
 * looping rules without paying for them.
 */

export interface Attempt {
  /** 1-based attempt number. */
  index: number;
  /** The source that was tried. */
  source: string;
  /** True when it compiled and ran. */
  ok: boolean;
  /** The compiler's output when it did not, verbatim. */
  failure: string;
}

export interface LoopLimits {
  /** Most attempts in total, including the first. */
  maxAttempts: number;
  /**
   * Give up after this many consecutive attempts that made no observable
   * progress. Two is enough: the first repeat is worth one more try because a
   * model often fixes a different thing on the second pass, but a third identical
   * outcome means the feedback is not being used.
   */
  maxUnchanged: number;
}

export const DEFAULT_LIMITS: LoopLimits = { maxAttempts: 5, maxUnchanged: 2 };

export type StopReason =
  | "compiled"
  | "attempts-exhausted"
  | "no-progress"
  | "cancelled"
  | "no-source"
  | "provider-error";

export interface LoopResult {
  /** The last source produced, whether or not it compiled. */
  source: string;
  /** True when a source compiled. */
  ok: boolean;
  attempts: Attempt[];
  reason: StopReason;
  /** Human-readable explanation of why it stopped. */
  message: string;
}

export interface LoopEvents {
  /**
   * Produce a candidate source. `failure` is the previous attempt's compiler
   * output, and is empty on the first call.
   */
  generate: (context: { attempt: number; previous?: Attempt }) => Promise<string>;
  /** Compile and run a candidate. Never throws; a failure is a result. */
  compile: (source: string, attempt: number) => Promise<{ ok: boolean; failure: string }>;
  /** Progress, for a status line. */
  onProgress?: (event: {
    attempt: number;
    maxAttempts: number;
    phase: "asking" | "compiling" | "repairing";
    detail?: string;
  }) => void;
  /** Polled between attempts, so a long loop can be stopped. */
  isCancelled?: () => boolean;
}

/**
 * Run the loop.
 *
 * A failure to even produce source is not retried: an empty reply, or a reply
 * with no Modelica in it, is a prompt problem rather than a model problem, and
 * asking again wastes an attempt on the same outcome.
 */
export async function runGenerationLoop(
  events: LoopEvents,
  limits: LoopLimits = DEFAULT_LIMITS
): Promise<LoopResult> {
  const attempts: Attempt[] = [];
  let previous: Attempt | undefined;
  let unchanged = 0;

  for (let index = 1; index <= limits.maxAttempts; index++) {
    if (events.isCancelled?.()) {
      return finish(attempts, "cancelled", "Stopped.");
    }

    events.onProgress?.({
      attempt: index,
      maxAttempts: limits.maxAttempts,
      phase: index === 1 ? "asking" : "repairing",
      detail: previous ? summarise(previous.failure) : undefined,
    });

    let source: string;
    try {
      source = (await events.generate({ attempt: index, previous })).trim();
    } catch (err) {
      // A provider error is not something another attempt fixes.
      return finish(attempts, "provider-error", messageOf(err));
    }

    if (!source) {
      return finish(
        attempts,
        "no-source",
        "The model replied without any Modelica source, so there was nothing to compile."
      );
    }

    // The same text as last time cannot compile differently, so the loop stops
    // rather than spend an attempt confirming it.
    if (previous && source === previous.source) {
      return finish(
        attempts,
        "no-progress",
        "The model returned the same source again, so asking once more would not help."
      );
    }

    events.onProgress?.({ attempt: index, maxAttempts: limits.maxAttempts, phase: "compiling" });
    const outcome = await events.compile(source, index);

    const attempt: Attempt = { index, source, ok: outcome.ok, failure: outcome.failure };
    attempts.push(attempt);

    if (outcome.ok) {
      return finish(attempts, "compiled", describeSuccess(index));
    }

    // Progress means the error CHANGED. A different message is a different
    // problem, which is what a repair should produce; the same one, however the
    // text is worded, means the model is going in circles.
    if (previous && !outcome.ok && sameFailure(previous.failure, outcome.failure)) {
      unchanged++;
      if (unchanged >= limits.maxUnchanged) {
        return finish(
          attempts,
          "no-progress",
          `The same error came back ${unchanged + 1} times, so the loop stopped rather than repeat it.`
        );
      }
    } else {
      unchanged = 0;
    }

    previous = attempt;
  }

  return finish(
    attempts,
    "attempts-exhausted",
    `Still failing after ${limits.maxAttempts} attempts.`
  );
}

function finish(attempts: Attempt[], reason: StopReason, message: string): LoopResult {
  const last = attempts[attempts.length - 1];
  return {
    source: last?.source ?? "",
    ok: last?.ok ?? false,
    attempts,
    reason,
    message,
  };
}

function describeSuccess(index: number): string {
  return index === 1 ? "Compiled and ran on the first attempt." : `Compiled after ${index} attempts.`;
}

/**
 * Whether two compiler outputs describe the same problem.
 *
 * Compared after removing the parts that differ between runs of the same error:
 * temporary paths, line and column numbers, and run timings. Without that, every
 * attempt looks like progress because the file path changed.
 */
export function sameFailure(a: string, b: string): boolean {
  return normaliseFailure(a) === normaliseFailure(b);
}

export function normaliseFailure(text: string): string {
  return text
    .replace(/\/[^\s:]*\.(mo|c|h|json|xml|log)/g, "<file>") // build paths
    .replace(/\bline\s+\d+/gi, "line N")
    .replace(/\bcolumn\s+\d+/gi, "column N")
    .replace(/:\d+:\d+/g, ":N:N")
    .replace(/\b\d+(\.\d+)?\s*(ms|s)\b/g, "<time>")
    .replace(/\s+/g, " ")
    .trim();
}

/** First meaningful line of a compiler failure, for a one-line status. */
export function summarise(failure: string): string {
  const lines = failure
    .split("\n")
    .map((l) => l.trim())
    // OpenModelica prefixes its own chatter; the fault is in the line with the
    // error severity on it.
    .filter((l) => l && !/^notification:/i.test(l));
  const error = lines.find((l) => /^error:|: error/i.test(l)) ?? lines[0] ?? "";
  return error.length > 160 ? error.slice(0, 157) + "…" : error;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
