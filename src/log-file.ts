/**
 * The plugin's diagnostic log, and the ceiling that keeps it a log.
 *
 * The file is in the vault, where the setting and the README say it is, and every
 * diagnostic event is appended to it. Append-only with no ceiling is how it reached
 * 9 MB in the vault this was written in: a diagnostic aid that fills a disk becomes
 * its own bug report. Past the cap the file is trimmed to its most recent half, which
 * is the part anyone reads -- what happened just before the failure -- and the rewrite
 * then happens once per half-cap of logging rather than once per line.
 */

import { nodeFs as fs } from "./host/node";

/** The size past which the log is trimmed. */
export const LOG_MAX_BYTES = 512 * 1024;

/**
 * One line of the log.
 *
 * Stamped on every line rather than dated once per session: a log is read by finding
 * the recent end of it, and a run that crosses midnight would otherwise be one date.
 */
export function logLine(message: string, at: Date = new Date()): string {
  return `${at.toISOString()} ${message}\n`;
}

/**
 * The newest complete lines of `text` that fit in `keepBytes`.
 *
 * Whole lines only: half a line at the top of a log reads as corruption, and the first
 * thing a reader does with it is look for the rest. A single line longer than the
 * budget keeps nothing, which is the only honest answer -- there is no line boundary
 * to cut at.
 */
export function trimLogText(text: string, keepBytes: number): string {
  if (text.length <= keepBytes) return text;
  const at = text.indexOf("\n", text.length - keepBytes);
  return at < 0 ? "" : text.slice(at + 1);
}

/**
 * Append one line, trimming the file when it has grown past `maxBytes`.
 *
 * The append is the point, so a failure to trim is swallowed here: losing the
 * measurement must not cost the line. A failure to APPEND is left to the caller, which
 * treats diagnostics as something that must never break the plugin.
 */
export function appendCappedLine(file: string, line: string, maxBytes: number = LOG_MAX_BYTES): void {
  fs.appendFileSync(file, line);
  try {
    if (fs.statSync(file).size <= maxBytes) return;
    const kept = trimLogText(fs.readFileSync(file, "utf8"), Math.floor(maxBytes / 2));
    fs.writeFileSync(file, kept);
  } catch {
    /* a log that stayed long is better than a line that went missing */
  }
}
