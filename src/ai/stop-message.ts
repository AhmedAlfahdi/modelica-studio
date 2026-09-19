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
    // "The same problem came back" is a description of the loop, not of the
    // problem: it left the reader with nothing to act on, and the reason was
    // already known. `reasonDetail` carries it.
    "no-progress": `Stopped after ${attempts} attempt${plural}.`,
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
 * What the checks actually objected to, in their own words.
 *
 * Reported: the panel said "the same problem came back" with no statement of what
 * the problem WAS. The reason exists at that point -- the checks returned it -- so
 * withholding it made a concrete fault ("none of the 4 components are connected")
 * look like a vague one, and left the reader with nothing to do about it.
 *
 * The first line only: the checks open with the fault and continue with advice,
 * and the advice is what the summary line has no room for.
 */
export function reasonDetail(failure: string | undefined, max = 160): string {
  const first = (failure ?? "").split("\n")[0].trim();
  if (!first) return "";
  return first.length <= max ? first : `${first.slice(0, max - 1)}…`;
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
