/**
 * Where each saved model actually is, and whether that is where it belongs.
 *
 * The settings showed this as one run-on line — `Name → path, Name → path, …` —
 * which was unreadable at a glance and, worse, hid two faults behind the same
 * flat list: a model whose tracked path no longer exists, and a model sitting
 * outside the configured folder. Both look identical when the text is `A → b.mo`.
 *
 * Pure, so the classification can be tested without a vault.
 */

export interface SavedModelRow {
  name: string;
  /** The path the plugin would read and write for this model. */
  path: string;
  /**
   * `ok` — the file is where the settings say models belong.
   * `misplaced` — it exists, but not under the configured folder.
   * `missing` — the path is recorded and no file is there.
   */
  status: "ok" | "misplaced" | "missing";
  /** The file name alone, for a compact list. */
  file: string;
  /** The folder part, or "" for the vault root. */
  folder: string;
}

export interface SavedModelsView {
  rows: SavedModelRow[];
  /** `.mo` files in the vault that no model tracks. */
  untracked: string[];
  /** Models whose file is not where the settings put them. */
  misplaced: number;
  missing: number;
}

/**
 * Classify every tracked model against the vault.
 *
 * `exists` is injected rather than reading the filesystem, so the rules can be
 * tested against a made-up vault — including the cases that are awkward to
 * arrange for real, such as a tracked path whose file has been moved.
 */
export function describeSavedModels(opts: {
  modelFolder: string;
  modelFiles: Record<string, string>;
  exists: (path: string) => boolean;
  /** Every `.mo` path in the vault, for finding files no model claims. */
  allModelFiles?: string[];
}): SavedModelsView {
  const folder = opts.modelFolder.trim().replace(/^\/+|\/+$/g, "");
  const rows: SavedModelRow[] = [];

  for (const [name, raw] of Object.entries(opts.modelFiles)) {
    const path = raw.trim();
    if (!path) continue;
    // Both sides normalised. The setting is trimmed and stripped of slashes, so
    // the stored path has to be too, or a stray leading slash marks every model
    // misplaced against a folder that is actually correct.
    const clean = path.replace(/^\/+|\/+$/g, "");
    const cut = clean.lastIndexOf("/");
    const file = cut >= 0 ? clean.slice(cut + 1) : clean;
    const at = cut >= 0 ? clean.slice(0, cut) : "";
    // Only the folder that is configured counts as "in place". With none
    // configured, the vault root is the intended home, so a file there is `ok`
    // rather than misplaced.
    const inPlace = at === folder;
    rows.push({
      name,
      path: clean,
      file,
      folder: at,
      // `clean`, not `path`: the row reports the normalised form, so the lookup
      // has to use the same string or the two disagree about which file this is.
      status: !opts.exists(clean) ? "missing" : inPlace ? "ok" : "misplaced",
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));

  const claimed = new Set(rows.map((r) => r.path));
  const untracked = (opts.allModelFiles ?? [])
    .map((p) => p.replace(/^\/+/, ""))
    .filter((p) => !claimed.has(p))
    .sort();

  return {
    rows,
    untracked,
    misplaced: rows.filter((r) => r.status === "misplaced").length,
    missing: rows.filter((r) => r.status === "missing").length,
  };
}

/** The line under a model's name: where it is, and a note when that is wrong. */
export function describeRow(row: SavedModelRow, modelFolder: string): string {
  const where = row.folder ? `${row.folder}/${row.file}` : `${row.file} (vault root)`;
  if (row.status === "missing") return `${where} — no file there; it will be recreated on save`;
  if (row.status === "misplaced") {
    const to = modelFolder.trim() ? `${modelFolder.trim()}/${row.file}` : row.file;
    return `${where} — outside the save folder; moves to ${to} on the next save`;
  }
  return where;
}
