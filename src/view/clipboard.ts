/**
 * Putting text on the clipboard, and saying what happened.
 *
 * Three surfaces offer a copy button — the run log, the AI prompt log and a saved
 * revision — and the first of them wrote to the clipboard and announced success
 * unconditionally. `navigator.clipboard.writeText` rejects for reasons that have
 * nothing to do with the plugin (the window is not focused, the platform wants a
 * gesture, a browser refuses a non-secure context), and a button that claims to
 * have copied something it did not is worse than one that failed loudly: the
 * paste lands somewhere else, or nowhere, and the text it was meant to carry is
 * gone from the clipboard.
 *
 * So: one helper, one message, and the failure is reported rather than swallowed.
 */

import { Notice } from "obsidian";

/**
 * Copy `text`, reporting the outcome. Resolves to true when it was copied.
 *
 * `what` names the thing in both messages — "Run log copied." / "the run log
 * could not be copied: …" — so a user who has several of these buttons knows
 * which one they pressed.
 */
export async function copyText(text: string, what: string): Promise<boolean> {
  if (!text) {
    new Notice(`Modelica: there is nothing in ${what} to copy.`);
    return false;
  }
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== "function") {
    new Notice(`Modelica: this platform has no clipboard to copy ${what} to.`);
    return false;
  }
  try {
    await clipboard.writeText(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    new Notice(`Modelica: ${what} could not be copied — ${reason}`);
    return false;
  }
  new Notice(`Modelica: ${what} copied.`);
  return true;
}
