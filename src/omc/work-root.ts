/**
 * Where a model is compiled, and the sweep that stops it accumulating.
 *
 * OpenModelica's scratch space is a directory per process under the system temporary
 * folder: a compiled model and its generated C are tens of megabytes, and a re-run
 * reuses them, which is why they are not deleted when a session ends. What IS useless
 * is the directory of a process that has exited -- a later run cannot reuse it, since
 * the build cache is keyed by model inside the running process -- and every session
 * used to leave one behind. 201 of them had collected on the machine this was written
 * on, from three days of work.
 *
 * So the plugin sweeps the ones whose process is gone when it starts, and keeps two
 * kinds:
 *
 *   - a directory belonging to a LIVE process, because two Obsidian windows can run at
 *     once and deleting a build that is in progress is worse than keeping a stale one;
 *   - a directory younger than `minAgeMs`, which is what protects a build whose process
 *     cannot be seen at all -- another container sharing the temporary folder, or a
 *     platform that will not report another user's process. A directory whose timestamp
 *     is not in the past yet counts as younger: `now` can sit a fraction of a
 *     millisecond behind an mtime, and keeping something for one more start is the safe
 *     direction.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** The parent of every work root, and the directory a sweep runs over. */
export function workRootParent(tmp: string = os.tmpdir()): string {
  return path.join(tmp, "modelica-studio");
}

/** This process's work root. */
export function defaultWorkRoot(pid: number = process.pid, tmp: string = os.tmpdir()): string {
  return path.join(workRootParent(tmp), String(pid));
}

/**
 * Whether a process with this PID exists, as far as this user can tell.
 *
 * `kill` with signal 0 performs the permission and existence checks without sending
 * anything. `EPERM` means it exists and belongs to someone else, which counts as alive.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === "EPERM";
  }
}

export interface SweepOptions {
  /** The PID whose work root is in use and must be kept. */
  currentPid?: number;
  /** How to ask whether a process exists. Injected by tests. */
  alive?: (pid: number) => boolean;
  now?: number;
  minAgeMs?: number;
}

/**
 * Remove the work roots whose process is gone, and report their names.
 *
 * Never throws: this runs while the plugin is loading, and a temporary folder that
 * cannot be read is not a reason to fail to start.
 */
export function sweepStaleWorkRoots(root: string, opts: SweepOptions = {}): string[] {
  const current = opts.currentPid ?? process.pid;
  const alive = opts.alive ?? isProcessAlive;
  const now = opts.now ?? Date.now();
  const minAge = opts.minAgeMs ?? 60 * 60 * 1000;
  const removed: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return removed;
  }

  for (const entry of entries) {
    // Only this plugin's own PID directories. Anything else in the folder -- a file, a
    // directory whose name is not a number -- was not put there by this code.
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const pid = Number(entry.name);
    if (pid === current || alive(pid)) continue;
    const dir = path.join(root, entry.name);
    try {
      if (now - fs.statSync(dir).mtimeMs < minAge) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(entry.name);
    } catch {
      /* one directory that will not go is not the others' problem */
    }
  }
  return removed;
}
