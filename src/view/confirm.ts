/**
 * A yes/no question, in a modal.
 *
 * Its own module because more than one place asks one: deleting a model asks, and
 * so does resetting the settings. It imports only `Modal`, so a surface that needs
 * a confirmation does not pull in the saved-models dialog and everything it
 * reaches for.
 *
 * The safe answer is focused and the destructive one is marked, because a stray
 * Enter on a dialog that replaces or removes something is the mistake this exists
 * to prevent.
 */

import { App, Modal } from "obsidian";

export function confirm(
  app: App,
  title: string,
  body: string,
  /** Label of the button that goes ahead; the safe one is always "Cancel". */
  okLabel = "Delete"
): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new Modal(app);
    modal.titleEl.setText(title);
    modal.contentEl.createEl("p", { text: body });
    let answered = false;
    const done = (value: boolean) => {
      if (answered) return;
      answered = true;
      modal.close();
      resolve(value);
    };
    const buttons = modal.contentEl.createDiv({ cls: "modelica-studio-prompt-buttons" });
    const yes = buttons.createEl("button", { cls: "mod-warning", text: okLabel });
    yes.addEventListener("click", () => done(true));
    const no = buttons.createEl("button", { text: "Cancel" });
    no.addEventListener("click", () => done(false));
    modal.onClose = () => done(false);
    modal.open();
    // Focus the safe button, so a stray Enter does not delete anything.
    window.setTimeout(() => no.focus(), 0);
  });
}
