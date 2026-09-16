/**
 * A Modelica source editor.
 *
 * Built from a textarea with a highlighted layer behind it rather than pulling
 * in CodeMirror. Obsidian bundles CodeMirror 6 but does not export a way to
 * construct an `EditorView` from a plugin, and reaching into the app's internals
 * for one is not something a plugin can rely on across versions. A textarea has
 * the editing behaviour people already expect — selection, undo, IME, spellcheck
 * suppression — and the layer behind it only has to get the colours right.
 *
 * The one hard requirement is that the two layers agree exactly: same font,
 * same padding, same wrapping. Everything else follows from that.
 */

import { LibraryIndex } from "../modelica/library";
import { Completion, applyCompletion, completionsFor, highlight, indentForNewline, prefixAt } from "./modelica-lang";

export interface CodeEditorOptions {
  /** Called after every edit, debounced. */
  onChange?: (text: string) => void;
  /** Called with a message for the status bar. */
  onStatus?: (text: string) => void;
  /** Library used for completions. */
  library?: () => LibraryIndex | undefined;
  /** Ctrl/Cmd+Enter handler, for simulate. */
  onSubmit?: () => void;
  /** Diagnostic sink for the layer geometry, called once on first focus. */
  probe?: (info: Record<string, string | number>) => void;
}

/** A diagnostic to mark in the gutter. */
export interface Diagnostic {
  /** 1-based line. */
  line: number;
  message: string;
  severity: "error" | "warning";
}

export interface CodeEditorHandle {
  getValue(): string;
  setValue(text: string, opts?: { keepCursor?: boolean }): void;
  focus(): void;
  element: HTMLElement;
  setDiagnostics(list: Diagnostic[]): void;
  /** Scroll a line into view and flash it. */
  revealLine(line: number): void;
  destroy(): void;
}

/**
 * A scratch 2D context for text measurement.
 *
 * Created lazily and reused. Canvas measurement needs no DOM mutation, so it can
 * run on every keystroke without forcing a layout of the painted text.
 */
let scratch: CanvasRenderingContext2D | null | undefined;
function measureContext(): CanvasRenderingContext2D | null {
  if (scratch === undefined) {
    try {
      scratch = document.createElement("canvas").getContext("2d");
    } catch {
      scratch = null;
    }
  }
  return scratch;
}

export function createCodeEditor(
  parent: HTMLElement,
  initial: string,
  opts: CodeEditorOptions = {}
): CodeEditorHandle {
  const root = parent.createDiv({ cls: "mst-code" });

  const gutter = root.createDiv({ cls: "mst-code-gutter" });
  const gutterInner = gutter.createDiv({ cls: "mst-code-gutter-inner" });
  const scroll = root.createDiv({ cls: "mst-code-scroll" });
  const pre = scroll.createEl("pre", { cls: "mst-code-highlight" });
  const area = scroll.createEl("textarea", { cls: "mst-code-input" });
  const popup = root.createDiv({ cls: "mst-code-popup" });
  popup.style.display = "none";

  area.setAttribute("spellcheck", "false");
  area.setAttribute("autocapitalize", "off");
  area.setAttribute("autocomplete", "off");
  area.setAttribute("wrap", "off");
  area.value = initial;

  let diagnostics: Diagnostic[] = [];
  let popupItems: Completion[] = [];
  let popupIndex = 0;
  /** Start of the word being completed, in textarea offsets. */
  let popupFrom = 0;
  let changeTimer: number | null = null;

  /* ---- rendering ---- */

  function lineCount(): number {
    return area.value.split("\n").length;
  }

  function renderGutter(): void {
    const lines = lineCount();
    const parts: string[] = [];
    const byLine = new Map<number, Diagnostic>();
    for (const d of diagnostics) byLine.set(d.line, d);
    for (let i = 1; i <= lines; i++) {
      const d = byLine.get(i);
      const mark = d ? `<span class="mst-code-mark is-${d.severity}" title="${escapeAttr(d.message)}"></span>` : "";
      parts.push(`<div class="mst-code-ln${d ? " has-" + d.severity : ""}">${i}${mark}</div>`);
    }
    gutterInner.innerHTML = parts.join("");
  }

  function renderHighlight(): void {
    pre.innerHTML = highlight(area.value);
  }

  function syncScroll(): void {
    // Both layers must move together or the colours slide off the text.
    pre.style.transform = `translate(${-area.scrollLeft}px, ${-area.scrollTop}px)`;
    gutterInner.style.transform = `translateY(${-area.scrollTop}px)`;
  }

  function renderAll(): void {
    renderHighlight();
    renderGutter();
    syncScroll();
  }

  /* ---- completion ---- */

  function caretOffset(): number {
    return area.selectionStart ?? 0;
  }

  /** The identifier fragment immediately before the caret. */
  function prefixAtCaret(): { text: string; from: number } {
    return prefixAt(area.value, caretOffset());
  }

  function hidePopup(): void {
    popup.style.display = "none";
    popupItems = [];
  }

  function showPopup(force: boolean): void {
    const { text, from } = prefixAtCaret();
    if (!text || (text.length < (force ? 1 : 2))) {
      hidePopup();
      return;
    }
    const items = completionsFor(text, opts.library?.());
    if (!items.length) {
      hidePopup();
      return;
    }
    popupItems = items;
    popupFrom = from;
    popupIndex = 0;
    renderPopup();
    positionPopup();
  }

  function renderPopup(): void {
    popup.empty();
    const max = 12;
    const items = popupItems.slice(0, max);
    items.forEach((c, i) => {
      const row = popup.createDiv({ cls: `mst-code-item${i === popupIndex ? " is-active" : ""}` });
      row.createSpan({ cls: "mst-code-item-label", text: c.label });
      row.createSpan({ cls: "mst-code-item-detail", text: c.detail });
      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault(); // keep focus in the textarea
        acceptPopup(i);
      });
    });
    popup.style.display = "";
  }

  /** Place the popup under the caret using a mirrored measurement. */
  function positionPopup(): void {
    const value = area.value;
    const offset = caretOffset();
    const before = value.slice(0, offset);
    const lineStart = before.lastIndexOf("\n") + 1;
    const line = before.slice(lineStart);
    const lineIndex = before.split("\n").length - 1;

    const style = getComputedStyle(area);
    // Measure the prefix with a canvas rather than by inserting a hidden span
    // into the highlight layer. Appending to that <pre> re-ran layout on every
    // keystroke and left a stray span behind if anything threw in between.
    const measure = measureContext();
    if (measure) {
      measure.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    }
    const width = measure ? measure.measureText(line || " ").width : 0;
    const lineHeight = parseFloat(style.lineHeight) || 18;
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;

    const x = paddingLeft + width - area.scrollLeft;
    const y = paddingTop + (lineIndex + 1) * lineHeight - area.scrollTop;
    popup.style.left = `${Math.max(0, x)}px`;
    popup.style.top = `${y}px`;
  }

  function acceptPopup(index: number): void {
    const item = popupItems[index];
    if (!item) return;
    const applied = applyCompletion(area.value, caretOffset(), item);
    area.value = applied.text;
    area.setSelectionRange(applied.caret, applied.caret);
    hidePopup();
    renderAll();
    emitChange();
  }

  /* ---- editing behaviour ---- */

  function emitChange(): void {
    if (changeTimer !== null) window.clearTimeout(changeTimer);
    changeTimer = window.setTimeout(() => {
      changeTimer = null;
      opts.onChange?.(area.value);
    }, 250);
  }

  function insertText(text: string): void {
    const start = area.selectionStart ?? 0;
    const end = area.selectionEnd ?? 0;
    area.value = area.value.slice(0, start) + text + area.value.slice(end);
    const caret = start + text.length;
    area.setSelectionRange(caret, caret);
    renderAll();
    emitChange();
  }

  area.addEventListener("input", () => {
    renderAll();
    emitChange();
    showPopup(false);
  });

  area.addEventListener("scroll", syncScroll);

  area.addEventListener("blur", () => hidePopup());

  area.addEventListener("click", () => {
    hidePopup();
  });

  /**
   * Report the layer geometry once, the first time the editor is focused.
   *
   * The text is painted by the layer behind the textarea, so if the two drift
   * apart — different font resolution, a stray theme rule, a zero-height box —
   * the visible symptom is "the text vanished" with nothing to inspect. This
   * puts the numbers in the debug log at the moment it would happen.
   */
  function report(tag: string): void {
    if (!opts.probe) return;
    const pr = pre.getBoundingClientRect();
    const ar = area.getBoundingClientRect();
    const ps = getComputedStyle(pre);
    const as = getComputedStyle(area);
    const first = pre.firstElementChild as HTMLElement | null;
    // Deliberately verbose. "The text is invisible" has several unrelated
    // causes — a blank layer, a transparent colour, layers misaligned, zero
    // height — and they are indistinguishable from a screenshot. Reporting the
    // real HTML settles it in one line.
    opts.probe({
      tag,
      preRect: `${Math.round(pr.width)}x${Math.round(pr.height)}`,
      inputRect: `${Math.round(ar.width)}x${Math.round(ar.height)}`,
      preOpacity: ps.opacity,
      preVisibility: ps.visibility,
      preDisplay: ps.display,
      preColor: ps.color,
      preFill: ps.webkitTextFillColor,
      preZ: ps.zIndex,
      inputColor: as.color,
      inputFill: as.webkitTextFillColor,
      inputZ: as.zIndex,
      inputBorder: as.borderTopWidth,
      highlightChars: pre.textContent?.length ?? 0,
      sourceChars: area.value.length,
      childCount: pre.childElementCount,
      firstChildColor: first ? getComputedStyle(first).color : "-",
      htmlHead: (pre.innerHTML || "").slice(0, 120),
      // The colour resolves through a chain of Obsidian variables. If the
      // computed value is wrong, which LINK is wrong is what matters, so the
      // whole chain is reported.
      // The surface the code actually sits on. If the theme class and the real
      // background disagree, contrast cannot be taken from the theme variables.
    });
  }

  // Reported on first focus, not at creation: the pane is display:none until
  // the mode is switched, so a report taken then measures 0x0 and an empty
  // layer and says nothing true about what is on screen.
  let probed = false;
  area.addEventListener("focus", () => {
    if (probed) return;
    probed = true;
    window.setTimeout(() => report("focused"), 250);
  });

  area.addEventListener("keydown", (ev) => {
    // Completion is open: it owns the navigation keys.
    if (popupItems.length) {
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        popupIndex = (popupIndex + 1) % Math.min(popupItems.length, 12);
        renderPopup();
        return;
      }
      if (ev.key === "ArrowUp") {
        ev.preventDefault();
        popupIndex = (popupIndex - 1 + Math.min(popupItems.length, 12)) % Math.min(popupItems.length, 12);
        renderPopup();
        return;
      }
      if (ev.key === "Enter" || ev.key === "Tab") {
        ev.preventDefault();
        acceptPopup(popupIndex);
        return;
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        hidePopup();
        return;
      }
    }

    if (ev.key === "Tab") {
      ev.preventDefault();
      // The same unit `indentForNewline` adds, so Tab and auto-indent agree.
      insertText("  ");
      return;
    }

    if (ev.key === "Enter") {
      // Keep the current indentation, and add a level after a block opener.
      ev.preventDefault();
      insertText("\n" + indentForNewline(area.value, caretOffset()));
      return;
    }

    if ((ev.ctrlKey || ev.metaKey) && ev.key === " ") {
      ev.preventDefault();
      showPopup(true);
      return;
    }

    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
      ev.preventDefault();
      opts.onSubmit?.();
      return;
    }
  });

  renderAll();

  return {
    element: root,
    getValue: () => area.value,
    setValue(text, o = {}) {
      const caret = caretOffset();
      area.value = text;
      if (o.keepCursor) {
        const at = Math.min(caret, text.length);
        area.setSelectionRange(at, at);
      }
      renderAll();
    },
    focus: () => area.focus(),
    setDiagnostics(list) {
      diagnostics = list;
      renderGutter();
    },
    revealLine(line) {
      const style = getComputedStyle(area);
      const lineHeight = parseFloat(style.lineHeight) || 18;
      area.scrollTop = Math.max(0, (line - 3) * lineHeight);
      syncScroll();
      const el = gutterInner.children[line - 1] as HTMLElement | undefined;
      if (el) {
        el.addClass("is-flash");
        window.setTimeout(() => el.removeClass("is-flash"), 1200);
      }
    },
    destroy() {
      if (changeTimer !== null) window.clearTimeout(changeTimer);
      root.remove();
    },
  };
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
