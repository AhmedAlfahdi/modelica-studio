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
    // NOT "moves to X on the next save": a save returns to the file it came from, so
    // a model that sits outside the configured folder is saved where it IS, and this
    // row would stay "misplaced" for ever. Saying so is better than a promise the
    // save path does not make -- the Record button moves the record, and deleting
    // and re-saving is what actually relocates the file.
    return `${where} — outside the save folder (${to} is where a new save would go)`;
  }
  return where;
}

export interface RepairResult {
  /** The mapping to store. */
  modelFiles: Record<string, string>;
  /** Models whose recorded path was stale and now points at a real file. */
  repointed: Array<{ name: string; from: string; to: string }>;
  /** Files that exist but no model claimed, now adopted under their own name. */
  adopted: Array<{ name: string; path: string }>;
  /** Tracked models with no matching file anywhere in the vault. */
  stillMissing: string[];
}

/**
 * Bring the tracked paths back in line with what is actually in the vault.
 *
 * Stale records are easy to create and awkward to fix by hand: move a file
 * between folders, or change the save folder, and every path recorded for it is
 * wrong while the file itself is perfectly fine. The plugin already copes — a
 * save looks the file up again — but the settings then report a vault full of
 * missing models, and each one is only corrected when it happens to be saved.
 *
 * Resolution is by file name, which is what makes it a repair rather than a
 * guess: a model named `Tank` and a file `Tank.mo` are the same thing, wherever
 * the file has ended up.
 *
 * `preferred` is the configured folder, so a file that exists in two places is
 * resolved to the one the settings point at rather than to whichever the
 * filesystem listed first.
 */
export function repairModelFiles(opts: {
  modelFolder: string;
  modelFiles: Record<string, string>;
  /** Every `.mo` path in the vault. */
  allModelFiles: string[];
  exists: (path: string) => boolean;
  /** Adopt files no model claims. Off by default: an unclaimed file may be deliberate. */
  adopt?: boolean;
}): RepairResult {
  const folder = opts.modelFolder.trim().replace(/^\/+|\/+$/g, "");
  const all = opts.allModelFiles.map((p) => p.replace(/^\/+/, ""));
  const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

  /** The best file for a model name: the configured folder first, then anywhere. */
  const find = (name: string): string | undefined => {
    const wanted = `${name}.mo`;
    const candidates = all.filter((p) => basename(p) === wanted);
    if (!candidates.length) return undefined;
    const at = folder ? candidates.find((p) => p === `${folder}/${wanted}`) : candidates.find((p) => !p.includes("/"));
    return at ?? candidates.sort()[0];
  };

  const modelFiles: Record<string, string> = {};
  const repointed: RepairResult["repointed"] = [];
  const stillMissing: string[] = [];

  for (const [name, recorded] of Object.entries(opts.modelFiles)) {
    const clean = recorded.trim().replace(/^\/+/, "");
    if (clean && opts.exists(clean)) {
      // Still where it says it is. Kept as recorded, because a model deliberately
      // saved elsewhere must not be dragged into the folder by a repair.
      modelFiles[name] = clean;
      continue;
    }
    const found = find(name);
    if (found) {
      modelFiles[name] = found;
      repointed.push({ name, from: clean || "(unrecorded)", to: found });
    } else {
      stillMissing.push(name);
      if (clean) modelFiles[name] = clean;
    }
  }

  const adopted: RepairResult["adopted"] = [];
  if (opts.adopt) {
    const claimed = new Set(Object.values(modelFiles));
    for (const path of all) {
      if (claimed.has(path)) continue;
      const name = basename(path).replace(/\.mo$/i, "");
      // A file whose name is already tracked belongs to that model; a repair must
      // not create a second entry for one file.
      if (modelFiles[name]) continue;
      modelFiles[name] = path;
      claimed.add(path);
      adopted.push({ name, path });
    }
  }

  return { modelFiles, repointed, adopted, stillMissing };
}
