/**
 * A folder field that suggests the folders that exist.
 *
 * The setting was a plain text box, so choosing a folder meant remembering its
 * name and spelling it correctly — and a typo produced a new folder rather than an
 * error, because the plugin creates whatever path it is given. A vault with
 * `Models`, `models` and `Modelica` is the predictable result.
 *
 * `AbstractInputSuggest` is the app's own mechanism, so the list looks and behaves
 * like every other folder picker in Obsidian rather than like a plugin's
 * imitation of one.
 */

import { AbstractInputSuggest, App, TFolder } from "obsidian";

export class FolderSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    private inputEl: HTMLInputElement,
    /** Called when a folder is chosen, with a path the vault can use. */
    private onPick: (path: string) => void
  ) {
    super(app, inputEl);
  }

  /**
   * The folders that match what has been typed.
   *
   * Every folder in the vault, plus — when the typed text names one that does not
   * exist — the typed text itself, so a new folder can be chosen without the
   * suggestion list insisting it is not there. The plugin creates the path on
   * first save, so offering it is accurate rather than optimistic.
   */
  protected getSuggestions(query: string): string[] {
    const needle = query.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
    const folders = this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder)
      .map((f) => f.path)
      .filter((p) => p && p !== "/");

    const matches = folders
      .filter((p) => !needle || p.toLowerCase().includes(needle))
      // Shortest first: a top-level `Modelica` is a likelier answer than
      // `Projects/2024/Modelica/Old`, and the list is not ranked otherwise.
      .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));

    const typed = query.trim().replace(/^\/+|\/+$/g, "");
    if (typed && !folders.some((p) => p.toLowerCase() === typed.toLowerCase())) {
      return [typed, ...matches];
    }
    return matches;
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
    // Mark which entry would be created rather than chosen, since the two have
    // different consequences and look identical in a list of paths.
    const exists = this.app.vault.getAbstractFileByPath(value) instanceof TFolder;
    if (!exists) {
      const note = el.createSpan({ cls: "modelica-studio-folder-new" });
      note.setText("new folder");
    }
  }

  selectSuggestion(value: string): void {
    this.inputEl.value = value;
    this.onPick(value);
    this.close();
  }
}
