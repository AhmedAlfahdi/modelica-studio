/**
 * Help, in the studio.
 *
 * Two things belong here that were not anywhere: the keyboard shortcuts, which
 * are the least discoverable part of any editor, and what this installation
 * actually is — the OpenModelica version, the library, the count of classes. The
 * library documentation link was a settings panel, which is the wrong place for
 * something you reach for while working.
 *
 * The shortcuts are listed from the code that implements them, so a key that does
 * not exist cannot be documented, and one that stops existing shows up as a test
 * failure rather than as a lie.
 */

import { App, Modal, Platform } from "obsidian";
import type ModelicaStudioPlugin from "../main";
import { libraryHelpUrl, libraryVersionFrom } from "../modelica/doclinks";
import { openInBrowser } from "./studio-view";

/** What the modifier key is called on this platform. */
const mod = Platform.isMacOS ? "Cmd" : "Ctrl";

interface Shortcut {
  keys: string;
  what: string;
}

/** Diagram shortcuts, from the canvas editor's key handler. */
export const DIAGRAM_SHORTCUTS: Shortcut[] = [
  { keys: `${mod}+Z / ${mod}+Shift+Z`, what: "Undo / redo" },
  { keys: `${mod}+A`, what: "Select every component" },
  { keys: `${mod}+C / ${mod}+V / ${mod}+X`, what: "Copy, paste, cut" },
  { keys: `${mod}+D`, what: "Duplicate the selection" },
  { keys: `${mod}+0`, what: "Fit the diagram in the canvas" },
  { keys: "Arrow keys", what: "Nudge by one grid step; with Shift, by five" },
  { keys: "Tab / Shift+Tab", what: "Cycle through components" },
  { keys: "R / Shift+R", what: "Rotate a quarter turn, either way" },
  { keys: "Delete / Backspace", what: "Delete the selection" },
  { keys: "Escape", what: "Cancel what is in progress" },
  { keys: "Scroll", what: "Zoom about the pointer" },
  { keys: `${mod}+Enter`, what: "Simulate" },
];

/** Code editor shortcuts, from the code editor's key handler. */
export const CODE_SHORTCUTS: Shortcut[] = [
  { keys: `${mod}+Space`, what: "Complete the name being typed" },
  { keys: `${mod}+Enter`, what: "Simulate" },
  { keys: `${mod}+Z / ${mod}+Shift+Z`, what: "Undo / redo" },
  { keys: "Up / Down", what: "Move between completions" },
  { keys: "Tab / Enter", what: "Accept the highlighted completion" },
  { keys: "Escape", what: "Dismiss the completion list" },
  { keys: "Home / End, Page Up / Page Down", what: "Move within the file" },
];

export class HelpModal extends Modal {
  constructor(app: App, private plugin: ModelicaStudioPlugin) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Modelica Studio");
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl: el } = this;
    el.empty();
    el.addClass("modelica-studio-help-modal");

    /* ---- this installation ---- */
    el.createEl("h4", { text: "This installation" });
    const facts = el.createDiv({ cls: "modelica-studio-help-facts" });
    const info = this.plugin.backend?.info;
    const row = (label: string, value: string, note?: string) => {
      const line = facts.createDiv({ cls: "modelica-studio-help-fact" });
      line.createSpan({ cls: "modelica-studio-help-fact-label", text: label });
      line.createSpan({ cls: "modelica-studio-help-fact-value", text: value });
      if (note) line.createSpan({ cls: "modelica-studio-help-fact-note", text: note });
    };

    const classes = this.plugin.library.size;
    // `BackendInfo.detail` is the human-readable line the backend supplies --
    // "OpenModelica 1.27.0" or why it is unavailable -- so it is used as-is rather
    // than reconstructing a version from parts that are not there.
    row(
      "OpenModelica",
      info?.available ? info.detail ?? info.label : "not found",
      info?.available ? "the compiler that runs the model" : "set its path in settings before simulating"
    );
    if (classes) {
      row("Modelica library", libraryVersionFrom(this.plugin.libraryRootNames()), `${classes} classes indexed`);
    } else {
      row("Modelica library", "still indexing…", "the palette fills in when it finishes");
    }
    const saved = Object.keys(this.plugin.settings.modelFiles).length;
    row(
      "Save folder",
      this.plugin.settings.modelFolder.trim() || "the vault root",
      saved ? `${saved} model${saved === 1 ? "" : "s"} saved` : "nothing saved yet"
    );

    /* ---- documentation ---- */
    el.createEl("h4", { text: "Documentation" });
    el.createEl("p", {
      cls: "modelica-studio-muted",
      text:
        "Every class in the palette has a help icon beside its name, in the palette and " +
        "in the inspector, that opens its own page in the library reference.",
    });
    const links = el.createDiv({ cls: "modelica-studio-help-links" });
    const link = (label: string, hint: string, url: string) => {
      const b = links.createEl("button", { cls: "modelica-studio-btn" });
      b.createSpan({ text: label });
      b.setAttribute("aria-label", hint);
      b.addEventListener("click", () => openInBrowser(url));
    };
    const version = libraryVersionFrom(this.plugin.libraryRootNames());
    link("Modelica library reference", `Open the reference for Modelica ${version}`, libraryHelpUrl(version));
    link(
      "OpenModelica documentation",
      "The compiler's own documentation",
      "https://openmodelica.org/doc/OpenModelicaUsersGuide/latest/"
    );

    /* ---- shortcuts ---- */
    el.createEl("h4", { text: "Diagram" });
    this.shortcutTable(el, DIAGRAM_SHORTCUTS);
    el.createEl("h4", { text: "Code editor" });
    this.shortcutTable(el, CODE_SHORTCUTS);

    /* ---- about ---- */
    el.createEl("h4", { text: "About" });
    const about = el.createDiv({ cls: "modelica-studio-help-about" });
    about.createSpan({ text: `Modelica Studio ${this.plugin.manifest.version}` });
    about.createSpan({
      cls: "modelica-studio-muted",
      text: " — beta, and experimental. Models are plain Modelica source; nothing is locked in.",
    });
  }

  /** Keys on the left, what they do on the right, aligned so they can be scanned. */
  private shortcutTable(parent: HTMLElement, shortcuts: Shortcut[]): void {
    const table = parent.createDiv({ cls: "modelica-studio-keys" });
    for (const s of shortcuts) {
      const line = table.createDiv({ cls: "modelica-studio-key-row" });
      line.createSpan({ cls: "modelica-studio-key-combo", text: s.keys });
      line.createSpan({ cls: "modelica-studio-key-what", text: s.what });
    }
  }
}
