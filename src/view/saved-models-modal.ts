/**
 * The models saved in this vault, as a dialog in the studio.
 *
 * This belongs in the studio rather than in settings: it is about the model being
 * worked on and where it lives, which is a thing you want to see while working,
 * not a preference you configure. Settings kept it behind a scroll through
 * unrelated panels.
 *
 * The rows are also made to do something. A list of what has been saved is a list
 * of things to open, and the studio already knows how to load a `.mo` file — so
 * the list is the way in, not only a report.
 */

import { App, Menu, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import { confirm } from "./confirm";
import type ModelicaStudioPlugin from "../main";
import { describeRow, describeSavedModels, repairModelFiles, type SavedModelRow } from "../modelica/saved-models";
import type { Revision } from "../modelica/revisions";
import { copyText } from "./clipboard";

export class SavedModelsModal extends Modal {
  private plugin: ModelicaStudioPlugin;

  constructor(app: App, plugin: ModelicaStudioPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    this.titleEl.setText("Saved models");
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** Rebuilt after a repair, so the dialog shows its own effect. */
  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("modelica-studio-saved-modal");

    const vault = this.app.vault;
    const view = describeSavedModels({
      modelFolder: this.plugin.settings.modelFolder,
      modelFiles: this.plugin.settings.modelFiles,
      exists: (p) => vault.getAbstractFileByPath(p) instanceof TFile,
      allModelFiles: vault
        .getFiles()
        .filter((f) => f.extension === "mo")
        .map((f) => f.path),
    });

    const current = this.plugin.model.name;
    contentEl.createEl("p", {
      cls: "modelica-studio-muted",
      text: view.rows.length
        ? `${view.rows.length} model${view.rows.length === 1 ? "" : "s"} saved in this vault. ` +
          `Click one to open it.`
        : "No models saved yet. Save writes the model you are working on to a .mo file.",
    });

    if (view.misplaced || view.missing) {
      const parts: string[] = [];
      if (view.misplaced) parts.push(`${view.misplaced} outside the save folder`);
      if (view.missing) parts.push(`${view.missing} with no file`);
      contentEl.createEl("p", {
        cls: "modelica-studio-muted",
        text: `${parts.join(", ")}. Both are corrected the next time the model is saved.`,
      });
    }

    const list = contentEl.createDiv({ cls: "modelica-studio-saved" });
    for (const row of view.rows) {
      this.renderRow(list, row, row.name === current);
    }

    if (view.untracked.length) {
      list.createDiv({
        cls: "modelica-studio-saved-untracked",
        text:
          `${view.untracked.length} .mo file${view.untracked.length === 1 ? " is" : "s are"} in the ` +
          `vault with no model recorded: ${view.untracked.join(", ")}`,
      });
    }

    if (view.misplaced || view.missing || view.untracked.length) {
      new Setting(contentEl)
        .setName("Fix the recorded paths")
        .setDesc(
          "Matching is by file name, so this only rewrites a record that points at " +
            "nothing, and only claims a file that no model owns."
        )
        .addButton((b) =>
          b.setButtonText("Fix").onClick(async () => {
            const result = repairModelFiles({
              modelFolder: this.plugin.settings.modelFolder,
              modelFiles: this.plugin.settings.modelFiles,
              allModelFiles: vault
                .getFiles()
                .filter((f) => f.extension === "mo")
                .map((f) => f.path),
              exists: (p) => vault.getAbstractFileByPath(p) instanceof TFile,
              adopt: true,
            });
            this.plugin.settings.modelFiles = result.modelFiles;
            await this.plugin.saveSettings();
            const parts: string[] = [];
            if (result.repointed.length) parts.push(`${result.repointed.length} path(s) repointed`);
            if (result.adopted.length) parts.push(`${result.adopted.length} file(s) claimed`);
            if (result.stillMissing.length) parts.push(`${result.stillMissing.length} still missing`);
            new Notice(
              parts.length
                ? `Modelica Studio: ${parts.join(", ")}.`
                : "Modelica Studio: every recorded path already matches a file."
            );
            this.render();
          })
        );
    }

    if (this.plugin.settings.modelFolder.trim() === "" && view.rows.length) {
      // Worth saying here rather than only in settings: an empty folder is why a
      // model saved from a note lands beside the notes instead of with the rest.
      contentEl.createEl("p", {
        cls: "modelica-studio-muted",
        text:
          "No save folder is set, so models are written beside your notes. Set one " +
          "under Settings → Modelica Studio → Save folder to keep them together.",
      });
    }
  }

  /**
   * One model: click to open, with its own actions on the right.
   *
   * The row used to be one clickable line. It now carries two buttons, so the
   * whole row cannot be a button any more -- a click on Delete would also open the
   * model. The name is the clickable part, which is also what a reader tries.
   */
  private renderRow(list: HTMLElement, row: SavedModelRow, isCurrent: boolean): void {
    const line = list.createDiv({
      cls: `modelica-studio-saved-row is-${row.status}${isCurrent ? " is-current" : ""}`,
    });

    const name = line.createSpan({ cls: "modelica-studio-saved-name", text: row.name });
    line.createSpan({
      cls: "modelica-studio-saved-path",
      text: describeRow(row, this.plugin.settings.modelFolder),
    });

    const actions = line.createDiv({ cls: "modelica-studio-saved-actions" });
    if (isCurrent) actions.createSpan({ cls: "modelica-studio-saved-current", text: "open" });

    const revisions = this.plugin.listRevisions(row.name);
    if (revisions.length) {
      const history = actions.createEl("button", { cls: "modelica-studio-saved-action" });
      setIcon(history, "history");
      history.setAttribute("aria-label", `${revisions.length} earlier version(s) of ${row.name}`);
      history.title = `${revisions.length} earlier version${revisions.length === 1 ? "" : "s"}`;
      history.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.showHistory(row);
      });
    }

    // Delete is behind a menu, not a button on the row.
    //
    // It was a trash icon sitting beside the history icon on every row, which is
    // one mis-click from destroying a model -- and one was made: a saved file
    // ended up in the system trash while nothing on screen suggested a deletion
    // was in progress. A menu costs one extra click and cannot be hit by accident.
    const more = actions.createEl("button", { cls: "modelica-studio-saved-action" });
    setIcon(more, "more-horizontal");
    more.setAttribute("aria-label", `More actions for ${row.name}`);
    more.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle(row.status === "missing" ? "Forget this model" : "Delete the file…")
          .setIcon("trash")
          .onClick(() => void this.deleteModel(row))
      );
      // Anchored to the button, so the menu appears where it was asked for.
      menu.showAtMouseEvent(ev);
    });

    if (row.status === "missing") {
      // Nothing to open. Offering a click that fails is worse than a row that
      // plainly does not respond -- but the delete button still works, to forget
      // a model whose file is gone.
      return;
    }
    name.addClass("is-openable");
    name.setAttribute("role", "button");
    name.tabIndex = 0;
    name.setAttribute("aria-label", `Open ${row.name}`);

    const open = async () => {
      this.close();
      await this.plugin.loadModelFromPath(row.path);
    };
    name.addEventListener("click", () => void open());
    name.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        void open();
      }
    });
  }

  /**
   * Delete a model's file, after confirming.
   *
   * Confirmation names the file and says where it goes, because "delete" beside a
   * list of paths is exactly the button someone presses on the wrong row. The file
   * is moved to the vault's trash rather than removed, and only after the current
   * contents have been snapshotted -- so the one destructive action in this dialog
   * is the one that can be undone twice over.
   */
  private async deleteModel(row: SavedModelRow): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(row.path);
    const missing = !(file instanceof TFile);

    const confirmed = await confirm(
      this.app,
      missing ? `Forget "${row.name}"?` : `Delete "${row.name}"?`,
      missing
        ? `No file is at ${row.path}, so there is nothing to delete. This removes the ` +
            `record only.`
        : `${row.path} will be moved to the vault's trash. A copy of its current ` +
            `contents is kept in the plugin's history first, so it can be restored.`
    );
    if (!confirmed) return;

    try {
      if (file instanceof TFile) {
        this.plugin.snapshotRevision(row.name, await this.app.vault.read(file));
        // `FileManager.trashFile`, not `Vault.trash`: the file manager is what applies
        // the user's own deletion preference — trash, a system trash folder, or a
        // permanent delete — and `Vault.trash` ignored it.
        await this.app.fileManager.trashFile(file);
      }
      delete this.plugin.settings.modelFiles[row.name];
      await this.plugin.saveSettings();
      new Notice(
        missing
          ? `Modelica Studio: "${row.name}" is no longer recorded.`
          : `Modelica Studio: "${row.name}" moved to the trash. Its history is kept.`
      );
      this.render();
    } catch (err) {
      new Notice(`Modelica Studio: could not delete "${row.name}". ${String(err)}`, 10000);
    }
  }

  /**
   * The earlier versions of one model, with restore.
   *
   * A list rather than a diff view: the useful question here is "which one do I
   * want back", and a diff of two Modelica models is not a thing to read in a
   * dialog. Restoring puts the old text back in the editor and saves it, so the
   * version being replaced becomes a revision in its turn.
   */
  private showHistory(row: SavedModelRow): void {
    const revisions = this.plugin.listRevisions(row.name);
    new RevisionModal(this.app, this.plugin, row.name, revisions, () => this.render()).open();
  }
}

/**
 * A yes/no dialog.
 *
 * `Modal` rather than a `confirm()`: the latter blocks the renderer, cannot be
 * styled, and reads as a browser warning rather than as part of the app.
 */
/** One model's earlier versions. */
class RevisionModal extends Modal {
  constructor(
    app: App,
    private plugin: ModelicaStudioPlugin,
    private modelName: string,
    private revisions: Revision[],
    private onRestored: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(`Earlier versions of ${this.modelName}`);
    const el = this.contentEl;
    el.createEl("p", {
      cls: "modelica-studio-muted",
      text:
        "Kept in the plugin's own folder, so they cannot be moved or deleted along " +
        "with the models they protect. Restoring puts the old text back in the " +
        "editor and saves it; the version it replaces becomes a revision itself.",
    });

    const list = el.createDiv({ cls: "modelica-studio-saved" });
    for (const rev of this.revisions) {
      const line = list.createDiv({ cls: "modelica-studio-saved-row" });
      line.createSpan({ cls: "modelica-studio-saved-name", text: formatWhen(rev.at) });
      line.createSpan({
        cls: "modelica-studio-saved-path",
        text: `${(rev.bytes / 1024).toFixed(1)} kB · ${rev.file}`,
      });
      const actions = line.createDiv({ cls: "modelica-studio-saved-actions" });
      const view = actions.createEl("button", { cls: "modelica-studio-saved-action" });
      setIcon(view, "eye");
      view.setAttribute("aria-label", `Show this version of ${this.modelName}`);
      view.title = "Show this version";
      view.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.show(rev);
      });
      const restore = actions.createEl("button", { cls: "modelica-studio-saved-action" });
      setIcon(restore, "undo-2");
      restore.setAttribute("aria-label", `Restore this version of ${this.modelName}`);
      restore.title = "Restore this version";
      restore.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void this.restore(rev);
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private show(rev: Revision): void {
    const text = this.plugin.readRevision(this.modelName, rev.file);
    new TextModal(this.app, formatWhen(rev.at), text ?? "(this version could not be read)").open();
  }

  private async restore(rev: Revision): Promise<void> {
    const text = this.plugin.readRevision(this.modelName, rev.file);
    if (text === null) {
      new Notice(`Modelica Studio: could not read that version of ${this.modelName}.`);
      return;
    }
    // The model has to be the one in the studio for the text to mean anything, so
    // restoring opens it first rather than writing into whatever is loaded.
    await this.plugin.setModelFromSource(text);
    this.plugin.getView()?.loadModelIntoEditor();
    const saved = await this.plugin.saveModelToNote();
    this.close();
    this.onRestored();
    new Notice(
      `Modelica Studio: restored ${this.modelName} from ${formatWhen(rev.at)} and saved it to ${saved.path}.`
    );
  }
}

/** Read-only text, for looking at a revision. */
/**
 * A read-only block of text.
 *
 * Exported so the AI prompt log can be read in the app rather than in a console:
 * reviewing what was sent and what came back is the whole point of keeping it.
 */
export interface TextModalAction {
  label: string;
  /** What the button will do, as a tooltip. */
  hint: string;
  run: () => void;
}

export class TextModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private text: string,
    /** An optional second button, for a dialog whose text suggests an action. */
    private action?: TextModalAction
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.title);
    const pre = this.contentEl.createEl("pre", { cls: "modelica-studio-revision-text" });
    pre.setText(this.text);
    // The whole reason to open one of these is to get the text OUT — into a bug
    // report, a prompt, a diff against the current model. Selecting it by hand
    // from a scrolling block is the part people get wrong.
    const actions = this.contentEl.createDiv({ cls: "modelica-studio-text-actions" });
    const copy = actions.createEl("button", { cls: "modelica-studio-btn" });
    setIcon(copy, "clipboard-copy");
    copy.createSpan({ text: "Copy" });
    copy.addEventListener("click", () => void copyText(this.text, `the ${this.title.toLowerCase()}`));
    if (this.action) {
      const button = actions.createEl("button", { cls: "modelica-studio-btn mod-cta" });
      setIcon(button, "sparkles");
      button.createSpan({ text: this.action.label });
      button.setAttr("aria-label", this.action.hint);
      button.addEventListener("click", () => {
        this.close();
        this.action?.run();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** A time as a person reads it, in their own zone. */
export function formatWhen(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  );
}
