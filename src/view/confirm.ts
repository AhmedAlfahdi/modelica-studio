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

/**
 * A question with more than two answers.
 *
 * When the file changed on disk, "yes or no" is the wrong shape: reloading the file and
 * overwriting it are BOTH destructive in one direction, and cancelling is the safe
 * answer. A yes/no dialog forces one of the two to be the default, and the default is
 * what a stray Enter gets.
 *
 * Resolves to the id of the button pressed, or `null` if the dialog was dismissed.
 */
export function choose(
  app: App,
  title: string,
  body: string,
  buttons: Array<{ id: string; label: string; warning?: boolean; focused?: boolean }>
): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = new Modal(app);
    modal.titleEl.setText(title);
    modal.contentEl.createEl("p", { text: body });
    let answered = false;
    const done = (value: string | null) => {
      if (answered) return;
      answered = true;
      modal.close();
      resolve(value);
    };
    const row = modal.contentEl.createDiv({ cls: "modelica-studio-prompt-buttons" });
    let focus: HTMLButtonElement | undefined;
    for (const spec of buttons) {
      const b = row.createEl("button", { text: spec.label });
      if (spec.warning) b.addClass("mod-warning");
      if (spec.focused) focus = b;
      b.addEventListener("click", () => done(spec.id));
    }
    modal.onClose = () => done(null);
    modal.open();
    window.setTimeout(() => {
      const first = focus ?? (row.firstElementChild as HTMLElement | null);
      first?.focus?.();
    }, 0);
  });
}
