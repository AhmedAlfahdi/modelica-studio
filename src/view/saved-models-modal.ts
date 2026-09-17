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

import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type ModelicaStudioPlugin from "../main";
import { describeRow, describeSavedModels, repairModelFiles, type SavedModelRow } from "../modelica/saved-models";

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

  /** One model: click to open, and a marker on the one already in the studio. */
  private renderRow(list: HTMLElement, row: SavedModelRow, isCurrent: boolean): void {
    const line = list.createDiv({
      cls: `modelica-studio-saved-row is-${row.status}${isCurrent ? " is-current" : ""}`,
    });
    line.createSpan({ cls: "modelica-studio-saved-name", text: row.name });
    line.createSpan({
      cls: "modelica-studio-saved-path",
      text: describeRow(row, this.plugin.settings.modelFolder),
    });

    if (row.status === "missing") {
      // Nothing to open, so the row is not made clickable. Offering a click that
      // fails is worse than a row that plainly does not respond.
      return;
    }
    line.addClass("is-openable");
    line.setAttribute("role", "button");
    line.tabIndex = 0;
    line.setAttribute("aria-label", `Open ${row.name}`);
    if (isCurrent) line.createSpan({ cls: "modelica-studio-saved-current", text: "open" });

    const open = async () => {
      this.close();
      await this.plugin.loadModelFromPath(row.path);
    };
    line.addEventListener("click", () => void open());
    line.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        void open();
      }
    });
  }
}
