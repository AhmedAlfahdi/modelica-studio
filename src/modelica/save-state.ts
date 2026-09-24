/**
 * Whether the model in the studio differs from the file it came from.
 *
 * There was no notion of this at all, which is why the loss reports kept coming:
 * a repair from the AI compiled and simulated, the status line said "Ready", and
 * the work was only in memory. Nothing distinguishes "saved" from "looks like it
 * worked" from the outside, so the reasonable reading of a successful run was that
 * the model had been kept.
 *
 * Kept pure and separate from both Obsidian and the filesystem so the rule can be
 * tested directly: comparing two strings is easy to get subtly wrong, and this is
 * the flag a dialog will act on.
 */

export type SaveState =
  /** The file matches what is in the studio. */
  | "saved"
  /** There is a file, and the studio has moved on from it. */
  | "modified"
  /** The file itself changed on disk, after this plugin last read or wrote it. */
  | "conflict"
  /** There is no file for this model yet. */
  | "unsaved";

/**
 * What each state is CALLED where a reader sees it.
 *
 * `modified` rather than "unsaved changes": the old wording described the file ("unsaved")
 * when the state is about the model, and it read as a warning about work that might be
 * lost rather than as "there are edits the file does not have yet". Reported twice by a
 * user who kept reading it as something being wrong.
 */
export const SAVE_STATE_WORDS: Record<SaveState, string> = {
  saved: "saved",
  modified: "modified",
  conflict: "file changed on disk",
  unsaved: "not saved to a file",
};

export interface SaveDescription {
  state: SaveState;
  /** What to show in the status bar. Short: it shares the line with the status. */
  label: string;
  /** Whether a "save?" prompt is worth raising. */
  worthAsking: boolean;
}

/**
 * Compare what the studio holds against what is on disk.
 *
 * Line endings are normalised first: the same model written on two platforms
 * differs only in those, and reporting "modified" for a file that has not changed
 * would train the reader to ignore the indicator.
 *
 * A model with no file is `unsaved` rather than `modified`, because the action
 * differs -- one creates a file and should say so.
 */
export function describeSaveState(opts: {
  /** What the studio holds. */
  source: string;
  /** The file's contents, or null when there is no file. */
  onDisk: string | null;
  /**
   * The file's contents the last time this plugin read or wrote it.
   *
   * Undefined when nothing is known — a model loaded before this was tracked, or one
   * that has no file at all.
   */
  lastSeen?: string;
}): SaveDescription {
  if (opts.onDisk === null) {
    return { state: "unsaved", label: "not saved to a file", worthAsking: true };
  }
  // The file changed underneath the studio. This is its own state, and an important
  // one: the status line used to read "unsaved changes", which sounds like the user's
  // own edits and is why a Save could write a stale model over somebody else's work
  // without anyone being told. It happened with a repair made outside the studio --
  // the studio's copy was written back over it, and the model failed to compile again.
  if (opts.lastSeen !== undefined && normalise(opts.onDisk) !== normalise(opts.lastSeen)) {
    return { state: "conflict", label: "file changed on disk", worthAsking: true };
  }
  if (normalise(opts.source) === normalise(opts.onDisk)) {
    return { state: "saved", label: "saved", worthAsking: false };
  }
  return { state: "modified", label: "modified", worthAsking: true };
}

function normalise(text: string): string {
  // Trailing whitespace as well as line endings: a trailing blank line is not a
  // change worth prompting about.
  return text.replace(/\r\n/g, "\n").trim();
}

/**
 * The question to ask about unsaved work, or null when there is nothing to ask.
 *
 * Phrased around what will happen rather than what the state is: "Save this
 * model?" is answerable, "The model has unsaved changes" is not. The detail names
 * the file, because "save" beside a vault full of models is ambiguous.
 */
export function savePrompt(desc: SaveDescription, modelName: string, path: string | null): string | null {
  if (!desc.worthAsking) return null;
  return desc.state === "unsaved"
    ? `Save "${modelName}" to a .mo file so it is kept?`
    : `Save the changes to "${modelName}"?\n\nThe file at ${path} is older than what is in the studio.`;
}

/**
 * The line above the toolbar: which model is open, and which file it is in.
 *
 * Asked for because the studio showed neither. The tab says "Modelica Studio" and the
 * toolbar holds buttons, so a reader with several models open had nothing on screen
 * naming the one they were editing -- and nothing saying whether their edits were in the
 * file yet.
 */
export function describeTitle(
  desc: SaveDescription,
  modelName: string,
  path: string | null
): { name: string; file: string; state: string; stateClass: string } {
  return {
    name: modelName || "Untitled",
    // The vault-relative path, because that is what a reader would type or look for.
    file: path ?? "not saved to a file yet",
    state: desc.label,
    stateClass: `is-${desc.state}`,
  };
}
