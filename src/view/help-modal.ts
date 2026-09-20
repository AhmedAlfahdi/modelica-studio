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
import { libraryHelpUrl, libraryIconsUrl, libraryVersionFrom } from "../modelica/doclinks";
import { openInBrowser } from "./studio-view";
import { DOMAIN_INFO, domainAttributes } from "../render/domains";

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

/**
 * The installed libraries other than the Modelica Standard Library itself.
 *
 * Root directories are named `ModelicaServices 4.1.0+maint.om`, so the library
 * name is what precedes the version. `Modelica` is matched with its space, or
 * `ModelicaServices` would count as the standard library.
 */
export function otherLibraryNames(rootNames: string[]): string[] {
  const out = new Set<string>();
  for (const root of rootNames) {
    const name = root.trim().split(/\s+/)[0];
    if (!name || name === "Modelica") continue;
    out.add(name);
  }
  return [...out].sort();
}

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
      // The index covers every installed library, not just the Modelica one.
      // Reporting the whole of it under the library's name overstated the
      // Modelica Standard Library by 143 classes, and made a figure the reader
      // could check against the library itself impossible to check.
      const names = this.plugin.library.allNames();
      const inModelica = names.filter((n) => n === "Modelica" || n.startsWith("Modelica.")).length;
      row(
        "Modelica library",
        libraryVersionFrom(this.plugin.libraryRootNames()),
        `${inModelica} classes indexed`
      );
      const others = otherLibraryNames(this.plugin.libraryRootNames());
      if (others.length) {
        row("Also indexed", others.join(", "), `${classes - inModelica} classes`);
      }
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

    /* ---- the domain colour code ---- */
    el.createEl("h4", { text: "Domain colours" });
    el.createEl("p", {
      cls: "modelica-studio-muted",
      text:
        "Modelica's standard library assigns a colour to each physical domain, and " +
        "this plugin uses the same code — so the palette's groups, the examples and " +
        "these notes are coloured the way the library itself colours its icons.",
    });
    // TWO tables, because seven of these are the library's own codes and three
    // are groupings this plugin adds. One list left the reader to work out which
    // was which from a "no code" repeated down the column, and gave the three
    // plugin groupings the same standing as a colour the library actually
    // specifies.
    const legend = (heading: string, infos: typeof DOMAIN_INFO) => {
      el.createDiv({ cls: "modelica-studio-help-legend-head", text: heading });
      const grid = el.createDiv({ cls: "modelica-studio-help-domains" });
      for (const info of infos) {
        const line = grid.createDiv({ cls: "modelica-studio-help-domain" });
        // The same class the palette and the notes use, so the legend cannot
        // drift from what it describes.
        line.createSpan({ ...domainAttributes(info.domain), text: info.label });
        line.createSpan({ cls: "modelica-studio-help-domain-code", text: info.msl ?? "—" });
        if (info.from) {
          line.createSpan({ cls: "modelica-studio-help-domain-from", text: info.from });
        }
      }
    };
    legend(
      `The library's codes, from Modelica.UsersGuide.Conventions.Icons`,
      DOMAIN_INFO.filter((d) => d.msl !== null)
    );
    legend(
      "Groupings this plugin adds",
      DOMAIN_INFO.filter((d) => d.msl === null)
    );

    el.createEl("p", {
      cls: "modelica-studio-muted",
      text:
        "The library's values are icon FILL colours, and a fill that reads well on a " +
        "white icon can be unreadable as text — rgb(85,170,255) is 1.9:1 against a " +
        "pale background. Each domain keeps the library's hue at a lightness that " +
        "works as text in both themes, measured at no less than 4.5:1; where the " +
        "library's own value already clears that, it is used unchanged, so " +
        "electrical is exactly rgb(0,0,255). Mechanics is the one domain the library " +
        "gives two codes — grey for rotational and multibody, green for " +
        "translational — so the table gives the one covering most of it and names " +
        "the package it comes from.",
    });
    const codeLinks = el.createDiv({ cls: "modelica-studio-help-links" });
    const codeLink = codeLinks.createEl("button", { cls: "modelica-studio-btn" });
    codeLink.createSpan({ text: "The library's icon conventions" });
    codeLink.setAttribute(
      "aria-label",
      "Open Modelica.UsersGuide.Conventions.Icons, where the library lists these colours"
    );
    // The indexed version, so an install of an older library opens the tree that
    // matches it. libraryIconsUrl falls back where no WSM tree was published for
    // that version, which is the case for 4.1.0.
    codeLink.addEventListener("click", () =>
      openInBrowser(libraryIconsUrl(libraryVersionFrom(this.plugin.libraryRootNames())))
    );

    /* ---- reading the diagram ---- */
    //
    // Behaviour that has no visible affordance: nothing on screen says a hover
    // will explain a component, or why one connector is dimmed. Both are easy to
    // discover by accident and impossible to look up, which is what this section
    // is for.
    el.createEl("h4", { text: "Reading the diagram" });
    el.createEl("p", {
      cls: "modelica-studio-muted",
      text:
        "Hovering a component shows what its parameters are set to, with the ones " +
        "that differ from the class default first — reading a diagram's settings " +
        "otherwise means selecting each component in turn. Switch it off, and set " +
        "the size of the name under each component, in Settings → Modelica Studio → " +
        "Diagram labels. Both apply to the Studio and to diagrams embedded in notes.",
    });
    el.createEl("p", {
      cls: "modelica-studio-muted",
      text:
        "Moving the pointer across a result plot reads off the time under it and " +
        "each trace's value at that moment, with a crosshair marking the position. " +
        "The Studio's plots and an embedded block's plot work the same way.",
    });
    el.createEl("p", {
      cls: "modelica-studio-muted",
      text:
        "A dimmed connector in the inspector is one the class only declares " +
        "conditionally — a heat port appears only once useHeatPort is true. It " +
        "cannot be wired until then, so its pin is not drawn either. A connector " +
        "shown in the error colour has a wire on it already and is no longer " +
        "available; turn the parameter back on, or remove the wire.",
    });

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
