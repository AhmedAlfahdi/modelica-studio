/**
 * Getting a picture out of the plugin.
 *
 * A plot and a diagram are canvases, and until now nothing could leave the app:
 * a result could be seen, measured, hovered — and not shown to anybody who was
 * not sitting in front of Obsidian. That is the whole of a written course, a
 * slide deck, a bug report and a PDF export.
 *
 * The clipboard path is asked for the PNG specifically, because a screenshot of
 * the window carries the theme, the sidebars and the scroll position, and the
 * point of copying a figure is that it can be dropped into a document.
 */

import { App, Notice } from "obsidian";

/** The PNG a canvas holds, or null when it has nothing drawn on it yet. */
export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== "function") {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

/**
 * `Tank-2026-09-20-1930.png`.
 *
 * The model and the minute, so a folder of figures says what each one is and
 * which of several runs of the same model it came from.
 */
export function figureFileName(model: string, at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const safe = (model || "model").replace(/[^\w.-]+/g, "-");
  return (
    `${safe}-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}.png`
  );
}

/** Copy a canvas as a PNG. */
export async function copyCanvasImage(canvas: HTMLCanvasElement, what: string): Promise<boolean> {
  const blob = await canvasPng(canvas);
  if (!blob) {
    new Notice(`Modelica: there is nothing drawn on ${what} to copy yet.`);
    return false;
  }
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (!clipboard || typeof clipboard.write !== "function" || typeof ClipboardItem === "undefined") {
    new Notice("Modelica: this platform cannot copy an image to the clipboard.");
    return false;
  }
  try {
    await clipboard.write([new ClipboardItem({ "image/png": blob })]);
  } catch (err) {
    new Notice(
      `Modelica: ${what} could not be copied — ${err instanceof Error ? err.message : err}`
    );
    return false;
  }
  new Notice(`Modelica: ${what} copied as a PNG.`);
  return true;
}

/**
 * Write a canvas beside the note in front of the user.
 *
 * There rather than in a folder of the plugin's own choosing: a figure is almost
 * always wanted by the note being written, and a link that points somewhere else
 * is a link that breaks when the note moves.
 */
export async function saveCanvasImage(
  app: App,
  canvas: HTMLCanvasElement,
  model: string,
  fallbackFolder: string
): Promise<string | null> {
  const blob = await canvasPng(canvas);
  if (!blob) {
    new Notice("Modelica: there is nothing drawn to save yet.");
    return null;
  }
  const active = app.workspace.getActiveFile();
  const folder = (active?.parent?.path ?? fallbackFolder ?? "").replace(/^\/+|\/+$/g, "");
  const stem = figureFileName(model, new Date()).replace(/\.png$/, "");

  try {
    if (folder && !app.vault.getAbstractFileByPath(folder)) {
      await app.vault.createFolder(folder);
    }
    // A free name. The name carries the minute, and two saves inside one minute --
    // comparing a plot with a sweep, or the plot with the diagram -- computed the
    // same path, and `createBinary` on an existing path is refused: the second save
    // reported "the figure could not be saved" and inserted no link.
    let path = "";
    for (let n = 1; ; n++) {
      const name = n === 1 ? `${stem}.png` : `${stem}-${n}.png`;
      const candidate = folder ? `${folder}/${name}` : name;
      if (!app.vault.getAbstractFileByPath(candidate)) {
        path = candidate;
        break;
      }
      if (n > 99) throw new Error("too many figures saved in this minute");
    }
    const file = await app.vault.createBinary(path, await blob.arrayBuffer());
    new Notice(`Modelica: figure saved as ${file.path}`);
    return file.path;
  } catch (err) {
    new Notice(
      `Modelica: the figure could not be saved — ${err instanceof Error ? err.message : err}`
    );
    return null;
  }
}

/** The markdown for a saved figure, ready to put at the cursor. */
export function figureLink(path: string): string {
  const name = path.split("/").pop() ?? path;
  const alt = name.replace(/\.png$/i, "");
  // Obsidian resolves the shortest path that is unambiguous from the note.
  return `![${alt}](${encodeURI(path)})`;
}

/**
 * Put a saved figure into the note at the cursor.
 *
 * The last step of the loop this exists for: run, look, and keep the picture
 * where the words about it are.
 */
export function linkFigure(
  path: string,
  editor: { replaceSelection(text: string): void } | undefined
): void {
  if (!editor) return;
  editor.replaceSelection(`${figureLink(path)}\n`);
}
