/**
 * A log of simulation runs.
 *
 * Kept for one reason: OpenModelica's output is the most useful thing anyone can
 * send to a model asked to fix a failure, and until now only the FIRST LINE of it
 * survived long enough to be used. The rest was shown in a diagnostics panel and
 * then lost when the next run started, so "Fix errors" was working from a
 * fragment — often `Internal error`, which says nothing.
 *
 * Entries are held in memory and capped. They are also written to the vault's
 * debug log when that setting is on, but this buffer is independent of it: the
 * repair path must work without the user having enabled logging first.
 */

export interface RunLogEntry {
  /** ISO timestamp of when the run finished. */
  at: string;
  model: string;
  ok: boolean;
  /** The source that was run, kept so a repair request can quote it. */
  source: string;
  /** Parameters passed as run-time overrides. */
  parameters: Record<string, string>;
  /** The run settings actually used. */
  settings: {
    startTime: number;
    stopTime: number;
    tolerance: number;
    numberOfIntervals: number;
    solver: string;
  };
  /**
   * The full text: compiler diagnostics and OpenModelica's own output on
   * failure, a summary on success.
   */
  detail: string;
  /** Wall-clock milliseconds for the whole run. */
  elapsedMs?: number;
  /** True when a previously compiled binary was reused. */
  reused?: boolean;
}

/** How many runs to keep. Enough to cover a debugging session, bounded in memory. */
const LIMIT = 50;

export class RunLog {
  private entries: RunLogEntry[] = [];

  /** Append a run, dropping the oldest beyond the cap. */
  add(entry: RunLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > LIMIT) this.entries.splice(0, this.entries.length - LIMIT);
  }

  /** Every entry, oldest first. */
  all(): readonly RunLogEntry[] {
    return this.entries;
  }

  /** The most recent run that failed, or undefined when none has. */
  lastFailure(): RunLogEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (!this.entries[i].ok) return this.entries[i];
    }
    return undefined;
  }

  /** The most recent run, whatever its outcome. */
  last(): RunLogEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  /** The last few failures, oldest first — what a repair prompt is built from. */
  recentFailures(count = 3): RunLogEntry[] {
    return this.entries.filter((e) => !e.ok).slice(-count);
  }

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }

  /**
   * Render the log as plain text.
   *
   * Used both for the panel the user reads and for the prompt the model reads, so
   * that what is being sent is never a mystery: the two are the same string.
   */
  toText(entries: readonly RunLogEntry[] = this.entries): string {
    if (!entries.length) return "No simulations have been run yet.";
    const out: string[] = [];
    for (const e of entries) {
      const head =
        `${e.at}  ${e.model}  ${e.ok ? "ok" : "FAILED"}` +
        (e.elapsedMs !== undefined ? `  ${e.elapsedMs} ms` : "") +
        (e.reused ? "  (reused build)" : "");
      out.push(head);
      out.push(
        `  settings: t=${e.settings.startTime}..${e.settings.stopTime}` +
          ` intervals=${e.settings.numberOfIntervals} tolerance=${e.settings.tolerance}` +
          (e.settings.solver ? ` solver=${e.settings.solver}` : "")
      );
      const params = Object.entries(e.parameters);
      if (params.length) out.push("  parameters: " + params.map(([k, v]) => `${k}=${v}`).join(", "));
      if (!e.ok) {
        out.push("  output:");
        for (const line of (e.detail.trim() || "(no output captured)").split("\n")) {
          out.push("    " + line);
        }
      }
    }
    return out.join("\n");
  }
}
