/**
 * The "what's new" popup.
 *
 * Shown once per version, after an update — see `whats-new.ts` for when, which is a
 * separate module because the rules there are testable without a DOM and this is a
 * window with some markdown in it.
 *
 * The notes are the changelog's own words, rendered as markdown rather than reworded:
 * a second summary kept for the popup would be a second thing to forget to update, and
 * the changelog is already written for a reader.
 */

import { App, Component, MarkdownRenderer, Modal } from "obsidian";
import type { WhatsNew } from "../whats-new";

/** Open the popup for these notes, if there are any. */
export function openWhatsNew(app: App, notes: WhatsNew | null): void {
  if (!notes || !notes.body.trim()) return;
  new WhatsNewModal(app, notes).open();
}

export class WhatsNewModal extends Modal {
  /**
   * What the rendered markdown is registered against.
   *
   * `Modal` is not a `Component`, and the renderer needs one: anything in the notes with
   * a lifetime of its own (a code block, a link handler) registers there and has to be
   * unloaded when the modal closes, or it outlives the window it was drawn in.
   */
  private readonly renderer = new Component();

  constructor(
    app: App,
    private notes: WhatsNew
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(`What's new in Modelica Studio ${this.notes.version}`);
    const body = this.contentEl.createDiv({ cls: "modelica-studio-whats-new" });
    this.renderer.load();
    void MarkdownRenderer.render(this.app, this.notes.body, body, "", this.renderer);
    if (this.notes.date) {
      this.contentEl.createDiv({
        cls: "modelica-studio-muted modelica-studio-whats-new-date",
        text: this.notes.date,
      });
    }
    // The notes start at their beginning. Reported: the window opened showing the BOTTOM of
    // the list, which is what focusing a button at the end of a scrolling window does — the
    // browser scrolls the focused element into view. `preventScroll` is the fix, and the
    // offsets are set anyway because which element Obsidian scrolls (`.modal` or its content)
    // is its business, not something to assume.
    const buttons = this.contentEl.createDiv({ cls: "modelica-studio-prompt-buttons" });
    const close = buttons.createEl("button", { cls: "mod-cta", text: "Close" });
    close.addEventListener("click", () => this.close());
    // Focused, so the popup is dismissed by the Enter a reader is already reaching for, and
    // so Escape has somewhere to land.
    close.focus({ preventScroll: true });
    this.modalEl.scrollTop = 0;
    this.contentEl.scrollTop = 0;
  }

  onClose(): void {
    this.renderer.unload();
    this.contentEl.empty();
  }
}
