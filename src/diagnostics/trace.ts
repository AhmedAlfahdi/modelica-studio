/**
 * A trace of every step that changes what is on disk.
 *
 * Written because the losses in this plugin have all been the same shape: two
 * modules disagreeing about when something is written, with nothing failing at the
 * time. A repair was saved and then wasn't; a model was replaced before its own
 * file was written; the editor grew a newline per repaint. In each case the Run
 * log showed a successful run and the status line showed "Ready", so there was
 * nothing to look at afterwards.
 *
 * The file log records what the plugin DID. This records what the plugin HOLDS, at
 * each moment it changes: which model, how long its source is, whether that source
 * is current or stale, and where it is meant to be written. Reading it back shows
 * the step where the two diverged.
 *
 * Kept in memory rather than on disk: it is for asking "what just happened", not
 * for auditing last week, and a plugin that writes a trace file on every edit
 * would be a performance problem in exchange for a diagnostic nobody reads.
 */

export type TraceKind =
  | "open"          // a model was loaded, from a file or an example
  | "edit"          // the model changed (a drag, a wire, a delete)
  | "adopt"         // the source was accepted from the editor or the AI
  | "mode"          // diagram ↔ code
  | "save"          // written to a .mo file
  | "snapshot"      // a revision was kept
  | "switch"        // the outgoing model was flushed before a replacement
  | "unload"        // the plugin is going away
  | "revision";     // history was touched

export interface TraceEntry {
  /** Milliseconds since the plugin loaded, which is what makes the ORDER clear. */
  at: number;
  kind: TraceKind;
  /** What was being operated on. */
  model: string;
  /** The facts worth comparing between steps. */
  detail: Record<string, string | number | boolean | null>;
}

/** How many steps to keep. Enough for a session's worth of switching and saving. */
export const TRACE_LIMIT = 200;

/**
 * A ring of the most recent steps.
 *
 * Bounded on purpose: an unbounded trace of every drag would be a leak, and the
 * interesting part is always the last few steps before something went wrong.
 */
export class Trace {
  private entries: TraceEntry[] = [];
  private started = Date.now();

  add(kind: TraceKind, model: string, detail: Record<string, string | number | boolean | null> = {}): void {
    this.entries.push({ at: Date.now() - this.started, kind, model, detail });
    if (this.entries.length > TRACE_LIMIT) this.entries.shift();
  }

  all(): TraceEntry[] {
    return [...this.entries];
  }

  last(n = 20): TraceEntry[] {
    return this.entries.slice(-n);
  }

  /** Steps for one model, which is what a report about that model needs. */
  forModel(name: string): TraceEntry[] {
    return this.entries.filter((e) => e.model === name);
  }

  clear(): void {
    this.entries = [];
    this.started = Date.now();
  }

  get size(): number {
    return this.entries.length;
  }

  /**
   * The trace as text, one step per line.
   *
   * Plain text rather than a table: it is read in a console, pasted into a bug
   * report, and compared against a file listing, and a monospaced column of
   * `time kind model detail` survives all three.
   */
  toText(entries: TraceEntry[] = this.entries): string {
    if (!entries.length) return "(nothing traced yet)";
    const width = Math.max(...entries.map((e) => e.kind.length));
    return entries
      .map((e) => {
        const detail = Object.entries(e.detail)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ");
        return `${String(e.at).padStart(7)}ms  ${e.kind.padEnd(width)}  ${e.model.padEnd(24)} ${detail}`;
      })
      .join("\n");
  }
}

/**
 * The facts about the current state, gathered in one place.
 *
 * Every loss in this plugin would have been visible in these five numbers next to
 * the previous step's: a source that stopped being current, a length that changed
 * without a save, a file that is not where the settings say.
 */
export function describeStateForTrace(state: {
  modelName: string;
  sourceLength: number;
  sourceIsCurrent: boolean;
  components: number;
  equations: number;
  savedPath: string | null;
  mode: string;
}): Record<string, string | number | boolean | null> {
  return {
    src: state.sourceLength,
    current: state.sourceIsCurrent,
    comps: state.components,
    eqs: state.equations,
    file: state.savedPath ?? "(unsaved)",
    mode: state.mode,
  };
}
