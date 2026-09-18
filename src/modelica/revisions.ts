/**
 * Version history for saved models.
 *
 * Written because two `.mo` files disappeared from the development vault and there
 * was nothing to recover them from: no trash, no backup, no copy anywhere. A model
 * is source that took a conversation to produce, and the plugin is the thing that
 * writes it, so the plugin is the thing that should keep the previous version.
 *
 * Snapshots live in the plugin's OWN folder rather than in the vault, so they
 * cannot be moved, renamed, deleted or synced by mistake along with the models
 * they protect — and so a vault stays a vault rather than filling with timestamped
 * copies. They use `.mo`, so they can be copied back out and opened by anything.
 *
 * The format is deliberately boring: one directory per model, one file per
 * revision, named after the time it was taken. That is readable with `ls`, needs
 * no index to be repaired, and survives this plugin being uninstalled.
 */

export interface Revision {
  /** File name within the model's directory, e.g. `2026-09-18T03-40-12.mo`. */
  file: string;
  /** The time it was taken, parsed from the name. */
  at: Date;
  /** Size in bytes. */
  bytes: number;
}

/** How many revisions to keep per model. */
export const MAX_REVISIONS = 20;

/**
 * A file-safe encoding of a model name.
 *
 * Model names are already identifier-like, but a name from a file — or one with a
 * dot — would otherwise create a nested path. Everything outside the safe set
 * becomes `_`, which cannot collide with a real identifier.
 */
export function revisionDirName(modelName: string): string {
  return modelName.replace(/[^A-Za-z0-9_-]/g, "_") || "model";
}

/**
 * The snapshot's file name for a moment in time.
 *
 * Colons are not legal in a Windows path, and this is read by people as well as
 * by code, so the ISO form is kept with the separators changed rather than the
 * timestamp being replaced by a counter.
 */
export function revisionFileName(at: Date): string {
  return `${at.toISOString().slice(0, 19).replace(/:/g, "-")}.mo`;
}

/** The moment a snapshot was taken, or null when the name is not one of ours. */
export function revisionTime(file: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\.mo$/.exec(file);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as unknown as number[];
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

/**
 * Whether a snapshot is worth keeping.
 *
 * Every save would otherwise add a revision, and saving an unchanged model several
 * times in a row produces a history of identical files that hides the one revision
 * that mattered.
 */
export function isNewRevision(previous: string | undefined, next: string): boolean {
  if (previous === undefined) return true;
  // Compared with line endings normalised, since the same model written on two
  // platforms differs only in those.
  const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
  return norm(previous) !== norm(next);
}

/**
 * The revisions to delete to stay within the limit, oldest first.
 *
 * `keep` is protected from pruning: the newest revision is what a restore most
 * often wants, and a long run of saves should never push it out.
 */
export function revisionsToPrune(revisions: Revision[], max = MAX_REVISIONS): Revision[] {
  if (revisions.length <= max) return [];
  const sorted = [...revisions].sort((a, b) => b.at.getTime() - a.at.getTime());
  return sorted.slice(max);
}
