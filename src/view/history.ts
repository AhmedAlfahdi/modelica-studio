/**
 * Undo/redo history for diagram edits.
 *
 * Snapshot-based rather than command-based on purpose: the diagram model is
 * small (a few hundred components at most), so serialising it is cheap, and
 * snapshots cannot drift out of sync with the document the way a hand-written
 * inverse operation can. Every editor mutation already produces a whole new
 * logical document, so "record the state before the edit" is both simpler and
 * harder to get wrong.
 *
 * Continuations (a drag, a run of arrow-key nudges) collapse into a single
 * entry, so Ctrl+Z undoes the gesture rather than each mouse-move.
 */

export interface HistoryEntry {
  /** Diagram state before the edit. */
  before: string;
  /** Diagram state after the edit. */
  after: string;
  /** Human-readable label, shown in the status line and the menu. */
  label: string;
  /** Wall-clock time, used to coalesce rapid repeats. */
  at: number;
}

export interface HistoryOptions {
  /** Maximum number of undo steps retained. */
  limit?: number;
  /** Window within which a same-label edit merges into the previous entry. */
  coalesceMs?: number;
}

export class History {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private readonly limit: number;
  private readonly coalesceMs: number;

  constructor(opts: HistoryOptions = {}) {
    this.limit = opts.limit ?? 100;
    this.coalesceMs = opts.coalesceMs ?? 400;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  get undoLabel(): string | undefined {
    return this.past[this.past.length - 1]?.label;
  }
  get redoLabel(): string | undefined {
    return this.future[this.future.length - 1]?.label;
  }
  get depth(): number {
    return this.past.length;
  }

  /**
   * Record an edit.
   *
   * When `coalesce` is true and the previous entry has the same label and was
   * recorded moments ago, the two merge: the earlier `before` is kept and only
   * `after` advances. That turns a burst of nudges into one undo step.
   */
  push(
    before: string,
    after: string,
    label: string,
    opts: { coalesce?: boolean; now?: number } = {}
  ): void {
    if (before === after) return; // nothing actually changed
    const now = opts.now ?? Date.now();

    const last = this.past[this.past.length - 1];
    if (opts.coalesce && last && last.label === label && now - last.at <= this.coalesceMs) {
      last.after = after;
      last.at = now;
    } else {
      this.past.push({ before, after, label, at: now });
      if (this.past.length > this.limit) this.past.shift();
    }
    // Any new edit invalidates the redo branch.
    this.future.length = 0;
  }

  /** Step back. Returns the state to restore, or undefined when at the start. */
  undo(current: string): { state: string; label: string } | undefined {
    const entry = this.past.pop();
    if (!entry) return undefined;
    // If the live document has drifted from what we recorded (an edit made
    // outside the history), still restore `before` — that is the user's intent.
    void current;
    this.future.push(entry);
    return { state: entry.before, label: entry.label };
  }

  /** Step forward. Returns the state to restore, or undefined at the end. */
  redo(): { state: string; label: string } | undefined {
    const entry = this.future.pop();
    if (!entry) return undefined;
    this.past.push(entry);
    return { state: entry.after, label: entry.label };
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }
}

/**
 * Clipboard for diagram fragments.
 *
 * Stored as a serialised fragment plus an origin, so pasting can offset the
 * copies and they do not land exactly on top of the originals.
 */
export interface ClipboardFragment {
  components: unknown[];
  /** Connections between copied components, by old id. */
  connections: { from: string; port: string; to: string; port2: string }[];
  /** Paste counter, so repeated pastes cascade instead of stacking. */
  pasteCount: number;
}

/** How far each successive paste is offset, in diagram units. */
export const PASTE_OFFSET = 20;
