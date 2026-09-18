/**
 * What to tell the reader when a generation stops.
 *
 * A `Record` keyed by the reason, rather than a chain of comparisons with a
 * catch-all. The chain is what produced the report this fixes: `timed-out` was
 * added to the union and no branch was added alongside it, so a timeout fell
 * through to the last `else` and was announced as "The reply contained no
 * Modelica" — a different problem with a different remedy, and one the reader
 * cannot act on. With a Record a missing reason does not compile.
 */

import type { StopReason } from "./loop";

/**
 * The headline for a stop.
 *
 * `message` is the loop's own explanation, used verbatim where it is the whole
 * story (a provider error is the provider's words) and ignored where it is not.
 */
export function stopMessage(reason: StopReason, message: string, attempts: number): string {
  const plural = attempts === 1 ? "" : "s";
  const messages: Record<StopReason, string> = {
    // Never reported: `compiled` takes the success path. Present because the
    // Record has to be total, and an empty string is a visible placeholder.
    compiled: "",
    "attempts-exhausted": `Gave up after ${attempts} attempt${plural}.`,
    "no-progress": `Stopped after ${attempts} attempt${plural}: the same problem came back.`,
    cancelled: "Stopped.",
    // The provider answered, but not with anything that could be built.
    "no-source": "The reply contained no Modelica source.",
    // The provider's own words: a refusal names what is wrong with the request.
    "provider-error": message,
    // Distinct from a refusal on purpose. A timeout means the model was slow or
    // the request was long, and the reader's remedy is to wait, shorten it, or
    // raise the limit -- not to go and check their key.
    "timed-out": `The provider did not reply in time. ${message}`,
  };
  return messages[reason] ?? `Stopped for an unknown reason (${String(reason)}).`;
}

/**
 * The second line, when there is source worth keeping.
 *
 * A model can be rejected for reasons that are not "it does not build": it may
 * build perfectly and have nothing time-dependent to simulate, or a diagram whose
 * blocks are not wired, or the wrong form entirely. Reporting those as "it
 * failed" is what made a working model look broken — the source is in the editor,
 * it compiles, and pressing Simulate runs it.
 */
export function keptSourceNote(builds: boolean): string {
  return builds
    ? "It builds, so it is in the editor — press Simulate to try it."
    : "The last attempt is in the editor so the error can be read.";
}
