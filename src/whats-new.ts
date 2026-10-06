/**
 * When to show the release notes.
 *
 * The plugin knows two things at startup: the version it is running, and the version it
 * last ran as. Deciding what to do with them is a pure function, because the interesting
 * cases are the ones nobody tests by hand — a fresh install, a version that went
 * backwards, a release installed twice in one day — and because getting them wrong is
 * annoying in a way that is hard to report: a popup on every launch, or a popup that
 * congratulates a user on an update they have already read.
 *
 * The rules:
 *
 *  - **First install announces nothing.** There is no "what's new" for someone who has
 *    never run the plugin; the notes are about a change they did not experience. The
 *    version is recorded so the NEXT update does announce.
 *  - **A new version announces**, once. Which is why the version is recorded as seen
 *    whether or not the popup opens — a reader who closes it has read it.
 *  - **A version that goes backwards does not.** Downgrades happen (a regression, an
 *    older vault) and a popup headed "what's new" for a version they have moved away
 *    from is noise. The older version is recorded, so moving forward again announces.
 *  - **The setting is the last word.** With it off, the version is still recorded: the
 *    reader turned off a popup, not the record of what they have seen.
 */

/** The notes as the bundler provides them: the section of one version. */
export interface WhatsNew {
  version: string;
  date: string;
  body: string;
}

/** What to do about the version now running. */
export interface Announcement {
  /** Open the popup. */
  announce: boolean;
  /** The version to record as seen; write it only if it differs from what was stored. */
  seen: string;
}

/** Decide, from the last version seen and the one running now. */
export function announcementFor(
  lastSeen: string | undefined,
  current: string,
  enabled: boolean
): Announcement {
  const running = String(current ?? "").trim();
  const seenBefore = String(lastSeen ?? "").trim();
  if (!running) return { announce: false, seen: seenBefore };
  if (!seenBefore) return { announce: false, seen: running };
  if (compareVersions(seenBefore, running) >= 0) return { announce: false, seen: running };
  return { announce: enabled, seen: running };
}

/**
 * Versions compared the way a release orders them.
 *
 * Numeric per part, so `0.10.0` is newer than `0.9.0` — which a plain string comparison
 * gets wrong, and this plugin has already passed ten minor releases.
 *
 * A part with a suffix (`0.4.0-beta.1`) ranks BELOW the same part without one, which is
 * what a prerelease means; that is also why the comparison is not simply
 * `Number(part)`: `Number("0-beta")` is NaN, and NaN comparisons are all false, which is
 * a version order that silently does not exist.
 */
export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const l = left[i] ?? { num: 0, suffix: "" };
    const r = right[i] ?? { num: 0, suffix: "" };
    if (l.num === null || r.num === null) {
      // A part with no number at all (`beta`) is below one with (`1`).
      if (l.num === null && r.num === null) {
        if (l.suffix !== r.suffix) return l.suffix < r.suffix ? -1 : 1;
        continue;
      }
      return l.num === null ? -1 : 1;
    }
    if (l.num !== r.num) return l.num < r.num ? -1 : 1;
    if (l.suffix !== r.suffix) {
      // No suffix outranks any suffix: the release is above its own prerelease.
      if (l.suffix === "") return 1;
      if (r.suffix === "") return -1;
      return l.suffix < r.suffix ? -1 : 1;
    }
  }
  return 0;
}

/** `0.4.0-beta.1` as `[{num:0},{num:4},{num:0,suffix:"-beta"},{num:1}]`. */
function versionParts(version: string): Array<{ num: number | null; suffix: string }> {
  return String(version)
    .split(".")
    .map((raw) => {
      const part = raw.trim();
      const digits = /^(\d+)(.*)$/.exec(part);
      return digits ? { num: Number(digits[1]), suffix: digits[2] } : { num: null, suffix: part };
    });
}
