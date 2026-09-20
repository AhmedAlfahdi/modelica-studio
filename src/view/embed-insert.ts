/**
 * Putting a simulation into a note, from the command palette.
 *
 * An embedded block is a fenced code block whose language is `modelica`, and the
 * awkward part is not writing the fence — it is the `//@` directive on the first
 * line, which is the only way to say how long to run for and which pane to open
 * on. Obsidian does not pass a code block's info string to a plugin (measured:
 * the processor is called with three arguments and no `alt` attribute), so
 * ` ```modelica time=20 ` never reaches the plugin, and the options have to live
 * inside the block where they are neither discoverable nor memorable.
 *
 * So the command asks for what it needs instead of making the user remember it:
 * pick a model, and the directive is generated from that model's own recorded
 * span — with the panes and the span adjustable before it lands.
 *
 * Everything here that can be is pure: the block text, the candidate list and
 * the ranking are tested without a DOM, and only the picker itself needs one.
 */

import { App, Editor, Modal, Notice, Setting } from "obsidian";
import { fuzzyFilter } from "../modelica/fuzzy";

/* ------------------------------------------------------------------ */
/* The block                                                          */
/* ------------------------------------------------------------------ */

/** The height a block uses when the directive does not say. */
export const EMBED_DEFAULT_HEIGHT = 320;

export interface EmbedBlockOptions {
  /** Seconds to run for. */
  stopTime: number;
  /** Pane height in pixels. */
  height: number;
  /** True when the block opens on its plot, which is the default. */
  showPlot: boolean;
}

/** What a block gets when nothing is chosen. */
export const EMBED_DEFAULTS: EmbedBlockOptions = {
  stopTime: 0,
  height: EMBED_DEFAULT_HEIGHT,
  showPlot: true,
};

/** `4` rather than `4.0`, `0.05` kept, and no floating-point noise. */
function directiveNumber(n: number): string {
  return String(Number(n.toFixed(6)));
}

/**
 * The fenced block for a model, directive included.
 *
 * Three rules, each because of how the embed reads a directive back:
 *
 * - `time` is ALWAYS written. A block carries the span its model is meant to run
 *   over, so a later change to the plugin's own default cannot silently re-scale
 *   a note written against a 3000-second thermal model.
 * - `height` and `edit` are written only when they differ from the block's
 *   defaults, because a directive that restates the default is noise a reader has
 *   to skip.
 * - the body is trimmed of trailing whitespace but not re-indented: the source is
 *   what will be parsed, and reformatting it would make the block disagree with
 *   the `.mo` file it came from.
 */
export function embedBlockText(source: string, opts: EmbedBlockOptions): string {
  const directives: string[] = [];
  if (Number.isFinite(opts.stopTime) && opts.stopTime > 0) {
    directives.push(`time=${directiveNumber(opts.stopTime)}`);
  }
  if (Number.isFinite(opts.height) && opts.height !== EMBED_DEFAULT_HEIGHT) {
    directives.push(`height=${Math.round(opts.height)}`);
  }
  // The plot is what a block starts on, so only the diagram needs asking for.
  if (!opts.showPlot) directives.push("edit");

  const body = source.replace(/\s+$/, "");
  const head = directives.length > 0 ? `//@ ${directives.join(" ")}\n` : "";
  return "```modelica\n" + head + body + "\n```";
}

/**
 * Put a block at the cursor, on lines of its own.
 *
 * A fence is only a fence when its backticks start a line, so a cursor in the
 * middle of one gets a newline first. The newline after the closing fence keeps
 * whatever followed the cursor off the end of the block — inserting at the end of
 * a paragraph otherwise leaves the next word glued to the backticks.
 */
export function insertEmbedBlock(editor: Editor, text: string): void {
  const cursor = editor.getCursor();
  const prefix = cursor.ch === 0 ? "" : "\n";
  editor.replaceSelection(prefix + text + "\n");
}

/* ------------------------------------------------------------------ */
/* What can be embedded                                               */
/* ------------------------------------------------------------------ */

export interface EmbedCandidate {
  /** Stable within one picker: `current:Name`, `example:Name`, `file:path`. */
  id: string;
  /** Searched and shown. */
  label: string;
  /** A section heading in the list. */
  group: string;
  /** The second line of the row: where this came from. */
  detail: string;
  /** The span this model is meant to run over. */
  stopTime: number;
  /** The block's body. Deferred, because a file may not be open. */
  load: () => string | Promise<string>;
}

export interface EmbedCandidateSource {
  label: string;
  group: string;
  detail: string;
  stopTime: number;
  load: () => string | Promise<string>;
}

export interface EmbedCandidateInput {
  /** The model open in the Studio, if there is one worth offering. */
  current?: { name: string; detail: string; stopTime: number; load: () => string | Promise<string> };
  examples: EmbedCandidateSource[];
  /** Vault files. Their `detail` is the path, which is what makes them unique. */
  saved: EmbedCandidateSource[];
}

/** The order the sections are shown in: nearest first. */
export const EMBED_GROUPS = ["The model you have open", "Examples", "In this vault"] as const;

/**
 * Every model that can be embedded, grouped nearest-first.
 *
 * One flat list with headings rather than three commands: the common case is
 * "the thing I was just working on", and a second command to reach the examples
 * is a decision the user should not have to make before they have seen the list.
 */
export function buildEmbedCandidates(input: EmbedCandidateInput): EmbedCandidate[] {
  const out: EmbedCandidate[] = [];
  if (input.current) {
    out.push({
      id: `current:${input.current.name}`,
      label: input.current.name,
      group: EMBED_GROUPS[0],
      detail: input.current.detail,
      stopTime: input.current.stopTime,
      load: input.current.load,
    });
  }
  for (const e of input.examples) {
    out.push({ ...e, id: `example:${e.label}` });
  }
  for (const s of input.saved) {
    // Keyed by the path rather than the name: two folders may hold a `Tank.mo`
    // each, and an id is what the list uses to tell rows apart.
    out.push({ ...s, id: `file:${s.detail}` });
  }
  return out;
}

/**
 * Rank candidates for the search box.
 *
 * Matched against the label first and the detail second, so `tank` finds the
 * model called Tank AND the model whose file lives in a folder of that name. The
 * fuzzy matcher indexes into the string it was given, so the two passes are kept
 * apart rather than concatenated — highlighting a position in `label + detail`
 * would land on the wrong characters.
 */
export function filterCandidates(
  candidates: EmbedCandidate[],
  query: string,
  limit = 40
): Array<{ candidate: EmbedCandidate; positions: number[] }> {
  if (!query.trim()) return candidates.map((candidate) => ({ candidate, positions: [] }));

  const taken = new Set<string>();
  const out: Array<{ candidate: EmbedCandidate; positions: number[] }> = [];
  // Linear scans over a list of tens, so the quadratic shape is not worth a map.
  const take = (by: "label" | "detail", keepPositions: boolean) => {
    for (const m of fuzzyFilter(candidates.map((c) => c[by]), query, 0)) {
      if (out.length >= limit) return;
      const hit = candidates.find((c) => c[by] === m.name && !taken.has(c.id));
      if (!hit) continue;
      taken.add(hit.id);
      out.push({ candidate: hit, positions: keepPositions ? m.positions : [] });
    }
  };

  take("label", true);
  // Then the detail line — a path or a description — so `tank` finds the model
  // called Tank AND the model whose file sits in a folder of that name.
  //
  // A SUBSTRING test here, not the fuzzy matcher: subsequence matching is what
  // makes a class name findable from three remembered letters, but a path is long
  // enough that almost any query is a subsequence of something, and `rlc` came
  // back with a row whose only claim was "f**r**om Mode**l**i**c**a Studio".
  //
  // The positions are dropped for a second reason: they index the detail string,
  // and highlighting them in the label would light up characters that did not
  // match.
  if (out.length < limit) {
    const q = query.trim().toLowerCase();
    for (const candidate of candidates) {
      if (out.length >= limit) break;
      if (taken.has(candidate.id)) continue;
      if (!candidate.detail.toLowerCase().includes(q)) continue;
      taken.add(candidate.id);
      out.push({ candidate, positions: [] });
    }
  }
  return out.slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* The picker                                                         */
/* ------------------------------------------------------------------ */

/** What the picker needs from the plugin, narrowed so it can be driven in a test. */
export interface EmbedPickerHost {
  app: App;
  candidates: EmbedCandidate[];
  /** Where the block goes. Absent when there is nowhere to put it. */
  editor?: Editor;
  /** Why there is nowhere, for the notice. */
  noEditorHint: string;
}

/**
 * Pick a model, adjust the two options, and place the block.
 *
 * The span follows the SELECTED row: `RLC` is fifty milliseconds and `Tank` is
 * twenty seconds, and asking for one and running for the other is the fault this
 * whole dialog exists to avoid. It is a field rather than a fact so it can be
 * overridden for one note.
 */
export class EmbedPickerModal extends Modal {
  private rows: Array<{ candidate: EmbedCandidate; positions: number[] }> = [];
  private selected = 0;
  private readonly chosen: EmbedBlockOptions;
  private listEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private stopInput: HTMLInputElement | null = null;
  private insertBtn: HTMLButtonElement | null = null;

  constructor(private readonly host: EmbedPickerHost) {
    super(host.app);
    const first = host.candidates[0];
    this.chosen = { ...EMBED_DEFAULTS, stopTime: first ? first.stopTime : EMBED_DEFAULTS.stopTime };
  }

  onOpen(): void {
    this.titleEl.setText("Embed a simulation");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("modelica-studio-embed-picker");

    const search = contentEl.createEl("input", {
      cls: "modelica-studio-embed-search",
      attr: { type: "search", placeholder: "Search examples, saved models and the one you have open" },
    });
    this.inputEl = search;
    search.addEventListener("input", () => this.setQuery(search.value));
    search.addEventListener("keydown", (ev) => this.onSearchKey(ev));

    this.listEl = contentEl.createDiv({ cls: "modelica-studio-embed-list" });

    /* The options, shown rather than described. */
    new Setting(contentEl)
      .setName("Run for")
      .setDesc("Seconds. Follows the model you pick; change it for this note alone.")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.addClass("modelica-studio-embed-number");
        t.setValue(directiveNumber(this.chosen.stopTime));
        this.stopInput = t.inputEl;
        t.onChange((v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) this.chosen.stopTime = n;
        });
      });

    new Setting(contentEl)
      .setName("Height")
      .setDesc(`Pixels. ${EMBED_DEFAULT_HEIGHT} is the default, and the block's own field can change it later.`)
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.addClass("modelica-studio-embed-number");
        t.setValue(String(this.chosen.height));
        t.onChange((v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) this.chosen.height = Math.round(n);
        });
      });

    new Setting(contentEl)
      .setName("Open on the plot")
      .setDesc("Off starts the block on its diagram, as `edit` does in a directive.")
      .addToggle((t) =>
        t.setValue(this.chosen.showPlot).onChange((v) => {
          this.chosen.showPlot = v;
        })
      );

    const actions = contentEl.createDiv({ cls: "modelica-studio-embed-actions" });
    const insert = actions.createEl("button", { cls: "mod-cta", text: "Insert" });
    this.insertBtn = insert;
    insert.addEventListener("click", () => void this.place(false));
    const copy = actions.createEl("button", { text: "Copy block" });
    copy.addEventListener("click", () => void this.place(true));
    if (!this.host.editor) {
      insert.disabled = true;
      insert.setAttr("aria-label", this.host.noEditorHint);
    }

    this.setQuery("");
    search.focus();
  }

  onClose(): void {
    this.contentEl.empty();
    this.listEl = null;
    this.inputEl = null;
    this.stopInput = null;
    this.insertBtn = null;
  }

  /** Re-rank and repaint the list. */
  private setQuery(query: string): void {
    this.rows = filterCandidates(this.host.candidates, query);
    this.selected = 0;
    this.renderList();
    this.select(0, false);
    this.followSelection();
  }

  private renderList(): void {
    const list = this.listEl;
    if (!list) return;
    list.empty();

    if (this.rows.length === 0) {
      list.createDiv({ cls: "modelica-studio-embed-empty", text: "Nothing matches that." });
      return;
    }

    let group = "";
    this.rows.forEach((row, i) => {
      if (row.candidate.group !== group) {
        group = row.candidate.group;
        list.createDiv({ cls: "modelica-studio-embed-group", text: group });
      }
      const item = list.createDiv({ cls: "modelica-studio-embed-item" });
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.setAttribute("aria-label", `${row.candidate.label} — ${row.candidate.detail}`);
      item.createDiv({ cls: "modelica-studio-embed-item-label", text: row.candidate.label });
      item.createDiv({ cls: "modelica-studio-embed-item-detail", text: row.candidate.detail });
      item.addEventListener("click", () => {
        this.select(i);
        void this.place(false);
      });
      // No scrolling on hover, deliberately: scrolling the list under a resting
      // pointer moves a different row beneath it, which highlights in turn, which
      // scrolls again. The row the pointer is on is by definition visible.
      item.addEventListener("pointerenter", () => this.select(i, false));
    });
  }

  /**
   * Move the highlight.
   *
   * The rows are patched, never rebuilt. Rebuilding them replaced the element the
   * pointer was resting on — so the highlight blinked, and the scroll that came
   * with the rebuild could reflow the dialog and leave a different row under the
   * pointer, which then highlighted in turn. That is what "highlighting a model
   * does not stay highlighted" was: the list was fighting the mouse.
   *
   * `scroll` is for the keyboard, which can walk to a row that is out of view. It
   * moves the LIST's own scroll offset rather than calling `scrollIntoView`, which
   * also scrolls the dialog the list sits in and would shift every row.
   */
  private select(index: number, scroll = true): void {
    if (index < 0 || index >= this.rows.length) return;
    this.selected = index;
    const items = this.itemElements();
    items.forEach((el, i) => el.toggleClass("is-selected", i === this.selected));
    if (scroll) this.scrollRowIntoView(items[this.selected]);
    this.followSelection();
  }

  /**
   * The row elements, in the order of {@link rows}.
   *
   * One element per row, built in one pass, with the group headings as siblings —
   * which is what makes the index of a row and the index of its element the same
   * number.
   */
  private itemElements(): HTMLElement[] {
    if (!this.listEl) return [];
    return Array.from(this.listEl.querySelectorAll<HTMLElement>(".modelica-studio-embed-item"));
  }

  private scrollRowIntoView(el: HTMLElement | undefined): void {
    const list = this.listEl;
    if (!list || !el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }

  /** Point the span field at whatever is selected. */
  private followSelection(): void {
    const row = this.rows[this.selected];
    if (!row) return;
    this.chosen.stopTime = row.candidate.stopTime > 0 ? row.candidate.stopTime : EMBED_DEFAULTS.stopTime;
    if (this.stopInput) this.stopInput.value = directiveNumber(this.chosen.stopTime);
  }

  private onSearchKey(ev: KeyboardEvent): void {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      this.select(Math.min(this.selected + 1, this.rows.length - 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      this.select(Math.max(this.selected - 1, 0));
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      void this.place(false);
    }
  }

  /** Insert the selected block, or copy it when there is nowhere to insert it. */
  private async place(copy: boolean): Promise<void> {
    const row = this.rows[this.selected];
    if (!row) return;
    let source: string;
    try {
      source = await row.candidate.load();
    } catch (err) {
      // A file that cannot be read must not become an empty block in the note:
      // that would look like the model was embedded and simply does nothing.
      new Notice(`Modelica: could not read ${row.candidate.label} — ${err instanceof Error ? err.message : err}`);
      return;
    }
    if (!source.trim()) {
      new Notice(`Modelica: ${row.candidate.label} has no source to embed.`);
      return;
    }
    const text = embedBlockText(source, this.chosen);

    if (copy || !this.host.editor) {
      if (!copy) {
        new Notice(`Modelica: ${this.host.noEditorHint}`);
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
      } catch (err) {
        // A clipboard write can be refused (no permission, no gesture). Saying so
        // beats a notice that claims success and a block that is nowhere.
        new Notice(
          `Modelica: the clipboard refused the write — ${err instanceof Error ? err.message : err}`
        );
        return;
      }
      new Notice(`Modelica: ${row.candidate.label} copied as a block.`);
      this.close();
      return;
    }

    insertEmbedBlock(this.host.editor, text);
    new Notice(`Modelica: ${row.candidate.label} embedded.`);
    this.close();
  }
}
