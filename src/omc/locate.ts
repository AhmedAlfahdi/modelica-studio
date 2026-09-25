/**
 * Locating and validating an OpenModelica installation.
 *
 * The plugin does not bundle a Modelica compiler (Obsidian distributes only
 * `manifest.json`, `main.js` and `styles.css`, so a multi-megabyte native
 * toolchain cannot be shipped anyway). Instead it finds an existing
 * installation and, when none is present, reports exactly what to install.
 *
 * Discovery is ordered cheapest-first and results are cached, because probing
 * is only needed once per session.
 */

import { childProcess, hostProcess, nodeFs as fs, nodeOs as os, nodePath as path } from "../host/node";

export type OmcStatus = "found" | "not-found" | "error";

export interface OmcInstallation {
  status: OmcStatus;
  /** Absolute path to the omc executable. */
  omcPath?: string;
  /** e.g. "OpenModelica 1.27.0" */
  version?: string;
  /** e.g. "1.27.0" */
  versionNumber?: string;
  /** Library roots discovered alongside the installation. */
  libraryRoots: string[];
  /** Actionable message when status is not "found". */
  message?: string;
  /** Where the executable was found, for diagnostics. */
  source?: "path" | "well-known" | "configured";
}

/**
 * Host paths as seen from inside a Flatpak with `--filesystem=host`.
 * A host program found here usually cannot run, because it links against the
 * host's C library while the sandbox provides its own; it is still probed so
 * the failure can be reported precisely instead of as "not found".
 */
const FLATPAK_HOST_PREFIX = "/run/host";

const WELL_KNOWN_UNIX = [
  "/usr/bin/omc",
  "/usr/local/bin/omc",
  "/opt/openmodelica/bin/omc",
  "/usr/lib/omc/bin/omc",
  "/snap/bin/omc",
];

const WELL_KNOWN_MAC = [
  "/usr/local/bin/omc",
  "/opt/homebrew/bin/omc",
  "/Applications/OpenModelica.app/Contents/MacOS/omc",
];

/**
 * Test whether a path is an executable file.
 * Uses X_OK on POSIX; on Windows the extension is what matters.
 */
function isExecutable(p: string): boolean {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    if (hostProcess.platform === "win32") return true;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Parse "OpenModelica 1.27.0" (possibly with noise lines) into a version. */
export function parseOmcVersion(output: string): { version?: string; number?: string } {
  const m = /OpenModelica\s+([0-9][0-9A-Za-z.\-+]*)/.exec(output);
  if (!m) return {};
  return { version: `OpenModelica ${m[1]}`, number: m[1] };
}

/**
 * Compare dotted version strings.
 * Returns negative when a < b, 0 when equal, positive when a > b.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-+]/).map((s) => parseInt(s, 10) || 0);
  const pb = b.split(/[.\-+]/).map((s) => parseInt(s, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Minimum OpenModelica version whose CLI contract this plugin relies on. */
export const MIN_OMC_VERSION = "1.16.0";

/** Library roots that commonly sit next to an OpenModelica install. */
function libraryRootsFor(omcPath: string): string[] {
  const roots: string[] = [];
  const home = os.homedir();
  // The per-user library cache OpenModelica populates on first install.
  roots.push(path.join(home, ".openmodelica", "libraries"));

  // System-wide library directories, derived from the install prefix.
  const binDir = path.dirname(omcPath);
  const prefix = path.dirname(binDir);
  roots.push(path.join(prefix, "lib", "omc", "libraries"));
  roots.push(path.join(prefix, "share", "omc", "libraries"));
  roots.push("/usr/lib/omc/libraries");
  roots.push("/usr/share/omc/libraries");
  return dedupe(roots.filter(existsDir));
}

function existsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

/**
 * Find the omc executable synchronously.
 *
 * `configuredPath` lets the user override discovery from plugin settings;
 * it is trusted first so an unusual install can always be made to work.
 */
export function locateOmcSync(configuredPath?: string): OmcInstallation {
  if (configuredPath) {
    if (isExecutable(configuredPath)) {
      return {
        status: "found",
        omcPath: configuredPath,
        libraryRoots: libraryRootsFor(configuredPath),
        source: "configured",
      };
    }
    const sandbox = detectSandbox();
    return {
      status: "error",
      libraryRoots: [],
      message:
        `The configured OpenModelica path does not exist or is not executable:\n${configuredPath}\n\n` +
        (sandbox.sandboxed
          ? `Obsidian appears to be sandboxed (${sandbox.kind}), which hides host programs.\n\n${sandbox.hint}`
          : `Update it in Settings → Modelica Studio, or clear it to auto-detect.`),
    };
  }

  // 1. PATH lookup. `which`/`where` is cheapest and respects the user's env.
  const fromPath = whichOmc();
  if (fromPath) {
    return {
      status: "found",
      omcPath: fromPath,
      libraryRoots: libraryRootsFor(fromPath),
      source: "path",
    };
  }

  // 2. Well-known install locations, plus host-mounted equivalents.
  const base = hostProcess.platform === "darwin" ? WELL_KNOWN_MAC : WELL_KNOWN_UNIX;
  const candidates = [
    ...base,
    ...base.map((p) => `${FLATPAK_HOST_PREFIX}${p}`),
  ];
  for (const c of candidates) {
    if (isExecutable(c)) {
      return {
        status: "found",
        omcPath: c,
        libraryRoots: libraryRootsFor(c),
        source: "well-known",
      };
    }
  }

  const sandbox = detectSandbox();
  return {
    status: "not-found",
    libraryRoots: [],
    message: sandbox.sandboxed
      ? `OpenModelica was not found, and Obsidian appears to be sandboxed (${sandbox.kind}).\n\n` +
        sandbox.hint!
      : "OpenModelica was not found on this system.\n\n" +
        "Modelica Studio needs the OpenModelica compiler (`omc`) to translate and " +
        "simulate models. Install it, then reload this plugin:\n\n" +
        installHint(),
  };
}


/**
 * Detect a sandboxed Linux install (Flatpak/Snap), where a host-installed
 * OpenModelica is invisible to the app even though it works in a terminal.
 *
 * This is worth detecting explicitly: the failure mode is otherwise baffling
 * ("omc works in my shell but the plugin says it is missing"), and the fix is a
 * one-line command rather than an OpenModelica install.
 */
export function detectSandbox(): { sandboxed: boolean; kind?: string; hint?: string } {
  if (hostProcess.platform !== "linux") return { sandboxed: false };

  const inFlatpak = fs.existsSync("/.flatpak-info") || !!hostProcess.env.FLATPAK_ID;
  if (inFlatpak) {
    const appId = hostProcess.env.FLATPAK_ID || "md.obsidian.Obsidian";
    return {
      sandboxed: true,
      kind: "Flatpak",
      hint:
        `Obsidian is running as a Flatpak, so it cannot see OpenModelica installed on the host.\n\n` +
        `Grant it access, then restart Obsidian:\n\n` +
        `    flatpak override --user --filesystem=host ${appId}\n\n` +
        `Alternatively, install OpenModelica inside the sandbox, or set the ` +
        `"OpenModelica path" setting to a copy of omc the sandbox can reach.`,
    };
  }

  if (hostProcess.env.SNAP || hostProcess.env.SNAP_NAME) {
    return {
      sandboxed: true,
      kind: "Snap",
      hint:
        `Obsidian is running as a Snap, which cannot see programs outside its sandbox.\n\n` +
        `Grant it access and restart:\n\n` +
        `    sudo snap connect obsidian:system-observe\n\n` +
        `or set the "OpenModelica path" setting to a path inside the sandbox.`,
    };
  }

  return { sandboxed: false };
}

function whichOmc(): string | undefined {
  try {
    const cmd = hostProcess.platform === "win32" ? "where" : "which";
    const out = childProcess.execFileSync(cmd, ["omc"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (first && isExecutable(first)) return first;
  } catch {
    /* not on PATH */
  }
  return undefined;
}

/** Platform-appropriate installation guidance. */
export function installHint(): string {
  switch (hostProcess.platform) {
    case "darwin":
      return (
        "  macOS:\n" +
        "    1. Download the OpenModelica installer from https://openmodelica.org/download/download-mac\n" +
        "    2. Run the .pkg installer\n" +
        "    3. Reload Obsidian (Ctrl/Cmd+R)"
      );
    case "win32":
      return (
        "  Windows:\n" +
        "    1. Download the OpenModelica installer from https://openmodelica.org/download/download-windows\n" +
        "    2. Run the installer and keep \"Add OpenModelica to PATH\" checked\n" +
        "    3. Restart Obsidian"
      );
    default:
      return (
        "  Linux:\n" +
        "    • Arch / CachyOS:  yay -S openmodelica-bin   (or openmodelica)\n" +
        "    • Debian / Ubuntu: follow https://openmodelica.org/download/download-linux\n" +
        "    • Fedora:          sudo dnf install openmodelica\n" +
        "  Then reload Obsidian (Ctrl/Cmd+R)."
      );
  }
}

/**
 * Run `omc --version` to confirm the binary works and read its version.
 * This is the only reliable check: the file existing does not mean it runs
 * (missing shared libraries are a common failure on Linux).
 */
export function probeOmc(omcPath: string): Promise<OmcInstallation> {
  return new Promise((resolve) => {
    childProcess.execFile(
      omcPath,
      ["--version"],
      { timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        // `omc --version` can exit non-zero while still printing the version,
        // and may emit a harmless libcurl warning on stderr.
        const text = `${stdout ?? ""}\n${stderr ?? ""}`;
        const parsed = parseOmcVersion(text);

        if (!parsed.version) {
          const detail = (stderr || stdout || (err && err.message) || "").trim();
          const sandbox = detectSandbox();
          const hostBinary = omcPath.startsWith(FLATPAK_HOST_PREFIX);
          const libcClash =
            /GLIBC_PRIVATE|GLIBC_2\.\d+.*not found|version `GLIBC/i.test(detail);

          let message =
            `Found an OpenModelica executable at:\n${omcPath}\n\n` +
            `but it did not report a version.\n\n${detail.slice(0, 500)}`;

          if (hostBinary && sandbox.sandboxed && libcClash) {
            // This is a hard incompatibility, not a misconfiguration: the host
            // binary needs the host C library, and the sandbox provides its own.
            message =
              `OpenModelica exists on the host, but it cannot run inside the ` +
              `${sandbox.kind} sandbox.\n\n` +
              `The host compiler links against the host's C library, while the ` +
              `sandbox supplies a different one, so the dynamic loader refuses to ` +
              `start it. Setting a path or library variable cannot fix this.\n\n` +
              `Use a non-sandboxed Obsidian instead — the AppImage, a distribution ` +
              `package, or the .deb/.rpm build from obsidian.md — which can run ` +
              `OpenModelica normally.`;
          } else if (sandbox.sandboxed) {
            message += `\n\nObsidian appears to be sandboxed (${sandbox.kind}).\n\n${sandbox.hint}`;
          }

          resolve({ status: "error", omcPath, libraryRoots: [], message });
          return;
        }

        const number = parsed.number!;
        if (compareVersions(number, MIN_OMC_VERSION) < 0) {
          resolve({
            status: "error",
            omcPath,
            version: parsed.version,
            versionNumber: number,
            libraryRoots: libraryRootsFor(omcPath),
            message:
              `OpenModelica ${number} is too old. ` +
              `Modelica Studio requires ${MIN_OMC_VERSION} or newer ` +
              `(the \`-override\` fast path and \`-n\` parallel codegen are required).\n\n` +
              installHint(),
          });
          return;
        }

        resolve({
          status: "found",
          omcPath,
          version: parsed.version,
          versionNumber: number,
          libraryRoots: libraryRootsFor(omcPath),
        });
      }
    );
  });
}

/** Full check: locate, then probe. */
export async function detectOmc(configuredPath?: string): Promise<OmcInstallation> {
  const located = locateOmcSync(configuredPath);
  if (located.status !== "found" || !located.omcPath) {
    return located;
  }
  const probed = await probeOmc(located.omcPath);
  return { ...probed, source: located.source };
}
