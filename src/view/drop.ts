/**
 * What a drag-and-drop carries, and whether to accept it.
 *
 * Free of any Obsidian import so it can be tested directly: the parsing rules
 * here are the kind that only fail against real input — a percent-encoded path,
 * an `obsidian://` link, a `file://` URL — and none of those can be checked
 * through a DOM stub.
 */

/**
 * The vault path inside whatever a drag or a link carried.
 *
 * Four shapes appear in practice:
 *
 *   Modelica/Tank.mo                                  a bare vault path
 *   Modelica%2FTank.mo                                a percent-encoded one
 *   file:///home/u/vault/Modelica/Tank.mo             a file URL
 *   obsidian://open?vault=v&file=Modelica%2FTank.mo   what the file explorer sends
 *
 * That last one is what a drag from the file explorer actually produced, and it
 * was reported verbatim as "not found in the vault", URI encoding and all.
 *
 * Returns null when the text names something that is not a model file, so a
 * palette class name cannot be mistaken for a path.
 */
export function vaultPathFrom(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  if (/^obsidian:/i.test(text)) {
    const match = /[?&]file=([^&]+)/i.exec(text);
    if (!match) return null;
    const decoded = safeDecode(match[1]).replace(/^\/+/, "");
    return decoded.endsWith(".mo") ? decoded : null;
  }

  if (/^file:/i.test(text)) {
    const decoded = safeDecode(text.replace(/^file:\/\//i, ""));
    // The vault prefix is not knowable from here, so the path is taken from the
    // first segment that could be a vault path. Anything else is outside it.
    const at = decoded.indexOf("/Modelica/");
    return at >= 0 ? decoded.slice(at + 1) : null;
  }

  const decoded = safeDecode(text);
  return decoded.endsWith(".mo") ? decoded.replace(/^\/+/, "") : null;
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    // A filename containing `%` is not an encoding error worth breaking a drop.
    return text;
  }
}

/**
 * Whether a drag could be a model file, decided WITHOUT reading its data.
 *
 * `dragover` must call `preventDefault` or the browser refuses the drop and
 * `drop` never fires — and the browser hides the data until the drop is
 * accepted, so acceptance cannot be decided by content. Deciding by content is
 * why dragging a file onto the code pane did nothing at all.
 *
 * `types` IS available during `dragover`, so that is what decides.
 */
export function acceptsFileDrag(types: readonly string[], fileCount: number): boolean {
  if (types.includes("text/vnd.obsidian.file")) return true;
  // A drop from outside the app carries real files rather than data.
  return fileCount > 0;
}

/** The vault path from a drop, reading the data that is available at that point. */
export function droppedVaultFile(read: (type: string) => string): string | null {
  for (const type of ["text/vnd.obsidian.file", "text/uri-list", "text/plain"]) {
    const raw = read(type);
    if (!raw) continue;
    const path = vaultPathFrom(raw);
    if (path) return path;
  }
  return null;
}
