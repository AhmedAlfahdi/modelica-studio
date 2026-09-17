/**
 * A deadline for a request that cannot be cancelled.
 *
 * Obsidian's `requestUrl` accepts no `AbortSignal` and applies no timeout, so a
 * request that never answers waits forever. That is not a theoretical problem:
 * the status line sat on "asking…" indefinitely with a Stop button that could not
 * interrupt it, and the only way out was to reload Obsidian.
 *
 * Racing a timer turns a hang into an error the caller can report and the loop
 * can stop on. It is kept apart from the HTTP client — which imports Obsidian and
 * therefore cannot be loaded in a test — because the rules here are worth
 * checking directly and cheaply.
 */

/**
 * Settle `work` within `timeoutMs`, or fail it.
 *
 * The `signal` is polled as well, so a cancellation during the wait is noticed
 * rather than only afterwards. The timer and the poll are always cleared, so
 * nothing rejects a promise that has already settled.
 */
export async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
  signal?: AbortSignal
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => reject(onTimeout()), timeoutMs);
      if (signal) {
        poll = setInterval(() => {
          if (signal.aborted) reject(new Error("Cancelled."));
        }, 250);
      }
      work.then(resolve, reject);
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (poll !== undefined) clearInterval(poll);
  }
}
