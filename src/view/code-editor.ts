/**
 * A Modelica source editor.
 *
 * ONE editable element, whose content IS the highlighted HTML. The editor is a
 * `contenteditable` div rather than a textarea with a highlight layer behind it.
 *
 * That is a deliberate reversal. The two-layer design — a transparent textarea
 * over a painted `<pre>` — is a common technique, but it has a failure mode that
 * cannot be fixed from the inside: the text is drawn by a DIFFERENT element from
 * the one being edited, so anything that makes those two disagree (a theme rule
 * reaching the `<pre>`, a colour resolving differently in the host app, font
 * resolution, compositing) presents as "the text is invisible" with the caret
 * moving through empty space. That was reported three times and could not be
 * reproduced outside the reporter's app, and each attempted fix was a guess at
 * which of those it was.
 *
 * With one layer there is nothing to disagree. The glyphs being edited are the
 * glyphs being painted, so no theme, snippet or stylesheet can separate them.
 * The cost is that caret handling becomes explicit, which is what the rest of
 * this file is about.
 *
 * CodeMirror would have avoided all of it, but Obsidian bundles CodeMirror 6
 * without exporting a way to construct an `EditorView` from a plugin.
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
  /** Diagnostic sink, called once on first focus. */
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

/** Indent unit. Shared with `indentForNewline`, which adds the same string. */
const INDENT_UNIT = "  ";

/** How many edits the in-editor undo stack holds. */
const UNDO_LIMIT = 200;

export function createCodeEditor(
  parent: HTMLElement,
  initial: string,
  opts: CodeEditorOptions = {}
): CodeEditorHandle {
  const root = parent.createDiv({ cls: "mst-code" });

  const gutter = root.createDiv({ cls: "mst-code-gutter" });
  const gutterInner = gutter.createDiv({ cls: "mst-code-gutter-inner" });
  const scroll = root.createDiv({ cls: "mst-code-scroll" });
  // The single editable layer. `pre` behaviour comes from CSS (`white-space:
  // pre`), not from the tag, so the markup stays a plain div.
  const editor = scroll.createEl("div", { cls: "mst-code-editor" });
  const popup = root.createDiv({ cls: "mst-code-popup" });
  popup.style.display = "none";

  editor.setAttribute("contenteditable", "plaintext-only");
  editor.setAttribute("spellcheck", "false");
  editor.setAttribute("autocapitalize", "off");
  editor.setAttribute("autocomplete", "off");
  // `plaintext-only` is what makes typing and pasting insert text rather than
  // markup. It is supported in the Chromium Obsidian ships; the paste handler
  // below is the fallback if it were ever ignored.
  if (editor.contentEditable !== "plaintext-only") {
    editor.setAttribute("contenteditable", "true");
  }

  let diagnostics: Diagnostic[] = [];
  let popupItems: Completion[] = [];
  let popupIndex = 0;
  let changeTimer: number | null = null;
  /** Guards handlers while we are the ones rewriting the DOM. */
  let internal = false;

  /* ---- text and caret ---- */

  const text = (): string => editor.textContent ?? "";

  /** Caret position as a plain-text offset from the start of the document. */
  function caretOffset(): number {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return text().length;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return text().length;
    const before = range.cloneRange();
    before.selectNodeContents(editor);
    before.setEnd(range.startContainer, range.startOffset);
    return before.toString().length;
  }

  /** Put the caret at a plain-text offset, clamped to the content. */
  function setCaret(offset: number): void {
    const target = Math.max(0, Math.min(offset, text().length));
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let seen = 0;
    let node = walker.nextNode() as Text | null;
    while (node) {
      const len = node.data.length;
      if (seen + len >= target) {
        const range = document.createRange();
        range.setStart(node, target - seen);
        range.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        return;
      }
      seen += len;
      node = walker.nextNode() as Text | null;
    }
    // Empty content, or past the end: collapse at the end of the element.
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  /* ---- rendering ---- */

  function lineCount(): number {
    return text().split("\n").length;
  }

  function renderGutter(): void {
    const byLine = new Map<number, Diagnostic>();
    for (const d of diagnostics) byLine.set(d.line, d);
    const parts: string[] = [];
    for (let i = 1; i <= lineCount(); i++) {
      const d = byLine.get(i);
      const mark = d
        ? `<span class="mst-code-mark is-${d.severity}" title="${escapeAttr(d.message)}"></span>`
        : "";
      parts.push(`<div class="mst-code-ln${d ? " has-" + d.severity : ""}">${i}${mark}</div>`);
    }
    gutterInner.innerHTML = parts.join("");
  }

  function syncScroll(): void {
    gutterInner.style.transform = `translateY(${-scroll.scrollTop}px)`;
  }

  /**
   * Repaint the highlighted HTML, keeping the caret where it was.
   *
   * Rewriting `innerHTML` destroys the selection, so the offset is saved and
   * restored around it. That round trip is the price of syntax colouring in a
   * single layer, and it is why the caret is tracked as a text offset rather
   * than as a DOM node.
   */
  function repaint(restoreCaret = true): void {
    const offset = restoreCaret ? caretOffset() : null;
    internal = true;
    editor.innerHTML = highlight(text());
    internal = false;
    syncScroll();
    if (offset !== null) setCaret(offset);
  }

  /* ---- undo history ---- */

  const past: Array<{ text: string; caret: number }> = [];
  const future: Array<{ text: string; caret: number }> = [];

  function snapshot(): void {
    past.push({ text: text(), caret: caretOffset() });
    if (past.length > UNDO_LIMIT) past.shift();
    future.length = 0;
  }

  function restore(state: { text: string; caret: number }): void {
    internal = true;
    editor.innerHTML = highlight(state.text);
    internal = false;
    renderGutter();
    syncScroll();
    setCaret(state.caret);
    emitChange();
  }

  function undo(): void {
    const prev = past.pop();
    if (!prev) return;
    future.push({ text: text(), caret: caretOffset() });
    restore(prev);
  }

  function redo(): void {
    const next = future.pop();
    if (!next) return;
    past.push({ text: text(), caret: caretOffset() });
    restore(next);
  }

  /* ---- completion ---- */

  function hidePopup(): void {
    popup.style.display = "none";
    popupItems = [];
  }

  function showPopup(force: boolean): void {
    const prefix = prefixAt(text(), caretOffset()).text;
    if (!prefix || prefix.length < (force ? 1 : 2)) {
      hidePopup();
      return;
    }
    const items = completionsFor(prefix, opts.library?.());
    if (!items.length) {
      hidePopup();
      return;
    }
    popupItems = items;
    popupIndex = 0;
    renderPopup();
    positionPopup();
  }

  function renderPopup(): void {
    popup.empty();
    popupItems.slice(0, 12).forEach((c, i) => {
      const row = popup.createDiv({ cls: `mst-code-item${i === popupIndex ? " is-active" : ""}` });
      row.createSpan({ cls: "mst-code-item-label", text: c.label });
      row.createSpan({ cls: "mst-code-item-detail", text: c.detail });
      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault(); // keep the caret in the editor
        acceptPopup(i);
      });
    });
    popup.style.display = "";
  }

  /**
   * A scratch 2D context, created once and reused.
   *
   * Measuring the caret's pixel position by inserting a hidden element would
   * perturb the very layer being measured, on every keystroke.
   */
  let measureCtx: CanvasRenderingContext2D | null | undefined;
  function measureFont(style: CSSStyleDeclaration): CanvasRenderingContext2D | null {
    if (measureCtx === undefined) {
      try {
        measureCtx = document.createElement("canvas").getContext("2d");
      } catch {
        measureCtx = null;
      }
    }
    if (measureCtx) {
      measureCtx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    }
    return measureCtx;
  }

  function positionPopup(): void {
    const before = text().slice(0, caretOffset());
    const line = before.slice(before.lastIndexOf("\n") + 1);
    const lineIndex = before.split("\n").length - 1;

    const style = getComputedStyle(editor);
    const ctx = measureFont(style);
    const width = ctx ? ctx.measureText(line || " ").width : 0;
    const lineHeight = parseFloat(style.lineHeight) || 18;
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;

    popup.style.left = `${Math.max(0, paddingLeft + width - scroll.scrollLeft)}px`;
    popup.style.top = `${paddingTop + (lineIndex + 1) * lineHeight - scroll.scrollTop}px`;
  }

  function acceptPopup(index: number): void {
    const item = popupItems[index];
    if (!item) return;
    const applied = applyCompletion(text(), caretOffset(), item);
    snapshot();
    replaceAll(applied.text, applied.caret);
    hidePopup();
    emitChange();
  }

  /** Replace the whole document and place the caret. */
  function replaceAll(value: string, caret: number): void {
    internal = true;
    editor.innerHTML = highlight(value);
    internal = false;
    renderGutter();
    syncScroll();
    setCaret(caret);
  }

  /* ---- editing ---- */

  function emitChange(): void {
    if (changeTimer !== null) window.clearTimeout(changeTimer);
    changeTimer = window.setTimeout(() => {
      changeTimer = null;
      opts.onChange?.(text());
    }, 250);
  }

  /** Replace the current selection with plain text. */
  function insertText(value: string): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editor.contains(sel.getRangeAt(0).startContainer)) {
      setCaret(text().length);
    }
    const range = window.getSelection()!.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(value);
    range.insertNode(node);
    const after = document.createRange();
    after.setStart(node, node.data.length);
    after.collapse(true);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(after);
    repaint();
    renderGutter();
    emitChange();
  }

  // One snapshot per edit burst. `beforeinput` fires before the DOM changes, so
  // the state pushed is the one to return to.
  editor.addEventListener("beforeinput", () => {
    if (!internal) snapshot();
  });

  editor.addEventListener("input", () => {
    if (internal) return;
    // The DOM has already changed. Re-render it with colours and put the caret
    // back; `plaintext-only` means the content is text, so nothing is lost.
    repaint();
    renderGutter();
    emitChange();
    showPopup(false);
  });

  editor.addEventListener("paste", (ev) => {
    // Belt and braces for a build that ignores `plaintext-only`: paste the text
    // only, never markup.
    ev.preventDefault();
    const data = ev.clipboardData?.getData("text/plain") ?? "";
    if (data) insertText(data);
  });

  scroll.addEventListener("scroll", syncScroll);
  editor.addEventListener("blur", () => hidePopup());
  editor.addEventListener("click", () => hidePopup());

  function report(tag: string): void {
    if (!opts.probe) return;
    const cs = getComputedStyle(editor);
    opts.probe({
      tag,
      layers: "single",
      editorColor: cs.color,
      editorFill: cs.webkitTextFillColor,
      editorFont: `${cs.fontSize}/${cs.lineHeight}`,
      textChars: text().length,
      childCount: editor.childElementCount,
      theme: document.body.classList.contains("theme-dark") ? "dark" : "light",
      htmlHead: (editor.innerHTML || "").slice(0, 100),
    });
  }

  let probed = false;
  editor.addEventListener("focus", () => {
    if (probed) return;
    probed = true;
    window.setTimeout(() => report("focused"), 250);
  });

  editor.addEventListener("keydown", (ev) => {
    const mod = ev.ctrlKey || ev.metaKey;

    if (mod && ev.key.toLowerCase() === "z") {
      ev.preventDefault();
      if (ev.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && ev.key.toLowerCase() === "y") {
      ev.preventDefault();
      redo();
      return;
    }

    if (popupItems.length) {
      const max = Math.min(popupItems.length, 12);
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        popupIndex = (popupIndex + 1) % max;
        renderPopup();
        return;
      }
      if (ev.key === "ArrowUp") {
        ev.preventDefault();
        popupIndex = (popupIndex - 1 + max) % max;
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
      insertText(INDENT_UNIT);
      return;
    }

    if (ev.key === "Enter") {
      // Keep the current indentation, and deepen after a block opener.
      ev.preventDefault();
      insertText("\n" + indentForNewline(text(), caretOffset()));
      return;
    }

    if (mod && ev.key === " ") {
      ev.preventDefault();
      showPopup(true);
      return;
    }

    if (mod && ev.key === "Enter") {
      ev.preventDefault();
      opts.onSubmit?.();
      return;
    }
  });

  // Seed the content: the highlighted HTML IS the editable content.
  internal = true;
  editor.innerHTML = highlight(initial);
  internal = false;
  renderGutter();

  return {
    element: root,
    getValue: () => text(),
    setValue(value) {
      snapshot();
      replaceAll(value, 0);
    },
    focus: () => editor.focus(),
    setDiagnostics(list) {
      diagnostics = list;
      renderGutter();
    },
    revealLine(line) {
      const style = getComputedStyle(editor);
      const lineHeight = parseFloat(style.lineHeight) || 18;
      scroll.scrollTop = Math.max(0, (line - 3) * lineHeight);
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
