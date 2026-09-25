/**
 * The Node surface this plugin uses, declared here.
 *
 * The plugin is desktop-only and runs inside Obsidian's Electron window, where Node is
 * available: it reads files, spawns the OpenModelica compiler and hashes model sources.
 * Those calls are typed by `@types/node` — except in the community directory's review
 * environment, which provides the `obsidian` package (the API types) and not this
 * repository's devDependencies. There, every `node:fs`, `node:path` and
 * `node:child_process` member is an implicit `any`, and the review reports some three
 * hundred and fifty "unsafe member access / call / assignment / argument" warnings that
 * say nothing about this plugin and everything about the missing package.
 *
 * So the surface is declared here, and the modules are cast to it once. That is only
 * honest if the declarations are the real shapes, so the last block in this file asserts
 * — in an environment that HAS `@types/node`, which is where the plugin is built and
 * tested — that each declaration is satisfied by the real module. A shape that drifts
 * fails `tsc` here rather than a user's simulation.
 *
 * It also leaves every filesystem, process and shell call reached through one file, which
 * is the file to read to see what this plugin does to the machine.
 * `test/host-surface.test.mjs` asserts that no other file in `src/` imports a Node module
 * or touches `process` at all.
 */

import * as childProcessModule from "node:child_process";
import * as cryptoModule from "node:crypto";
import * as fsModule from "node:fs";
import * as osModule from "node:os";
import * as pathModule from "node:path";
import * as processModule from "node:process";

/** A directory entry, as `readdirSync(…, { withFileTypes: true })` returns them. */
export interface DirentLike {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

/** The file metadata this plugin reads: its size, its age, and what kind of thing it is. */
export interface StatsLike {
  size: number;
  mtimeMs: number;
  isDirectory(): boolean;
  isFile(): boolean;
}

/** A chunk of a child process's output. A `Buffer` at run time; `toString` takes an encoding. */
export interface ByteChunk {
  readonly length: number;
  toString(encoding?: string): string;
}

export interface FsSurface {
  readFileSync(path: string, encoding: "utf8"): string;
  writeFileSync(path: string, data: string, encoding?: "utf8"): void;
  appendFileSync(path: string, data: string, encoding?: "utf8"): void;
  existsSync(path: string): boolean;
  accessSync(path: string, mode?: number): void;
  statSync(path: string): StatsLike;
  readdirSync(path: string): string[];
  readdirSync(path: string, options: { withFileTypes: true }): DirentLike[];
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  unlinkSync(path: string): void;
  /** Only `X_OK` is used: "is this file the executable we are looking for". */
  constants: { X_OK: number };
}

export interface PathSurface {
  join(...parts: string[]): string;
  dirname(path: string): string;
  sep: string;
}

export interface OsSurface {
  homedir(): string;
  tmpdir(): string;
}

/** The environment and identity of the process the window runs in. */
export interface ProcessSurface {
  pid: number;
  platform: string;
  env: Record<string, string | undefined>;
  kill(pid: number, signal?: number | string): boolean;
}

/** Enough of a spawned child to read its output and wait for it. */
export interface ChildProcessLike {
  stdout: { on(event: "data", listener: (chunk: ByteChunk) => void): unknown };
  stderr: { on(event: "data", listener: (chunk: ByteChunk) => void): unknown };
  on(event: "close", listener: (code: number | null) => void): unknown;
  on(event: "error", listener: (error: { message?: string } | null) => void): unknown;
}

export interface ChildProcessSurface {
  spawn(
    command: string,
    args: string[],
    options: { cwd: string; windowsHide: boolean; env: Record<string, string | undefined> }
  ): ChildProcessLike;
  execFile(
    file: string,
    args: string[],
    options: { timeout: number; windowsHide: boolean; maxBuffer: number },
    callback: (error: { message?: string } | null, stdout: string, stderr: string) => void
  ): void;
  execFileSync(
    file: string,
    args: string[],
    options: { encoding: "utf8"; timeout?: number; maxBuffer?: number; windowsHide?: boolean }
  ): string;
}

export interface CryptoSurface {
  createHash(algorithm: string): {
    update(data: string): { digest(encoding: "hex"): string };
  };
}

/*
 * The casts. `as unknown as` is deliberate: these are the real modules, and the
 * declarations above are what the rest of the plugin is typed against. `Matches` below is
 * what keeps them from being a lie.
 */
export const nodeFs = fsModule as unknown as FsSurface;
export const nodePath = pathModule as unknown as PathSurface;
export const nodeOs = osModule as unknown as OsSurface;
export const hostProcess = processModule as unknown as ProcessSurface;
export const childProcess = childProcessModule as unknown as ChildProcessSurface;
export const nodeCrypto = cryptoModule as unknown as CryptoSurface;

/**
 * Checked where the types exist: each declaration is satisfied by the real module.
 *
 * With `@types/node` installed these bindings are the real module types, so a
 * declaration that no longer matches — a renamed method, a changed return — is a
 * typecheck failure here. In the review's environment they are `any`, the conditional
 * resolves to `true`, and nothing is reported: the point is to fail in the place that
 * can tell, not to fail everywhere.
 */
type Matches<Real, Declared> = Real extends Declared ? true : never;

const matches: [
  Matches<typeof fsModule, FsSurface>,
  Matches<typeof pathModule, PathSurface>,
  Matches<typeof osModule, OsSurface>,
  Matches<typeof processModule, ProcessSurface>,
  Matches<typeof childProcessModule, ChildProcessSurface>,
  Matches<typeof cryptoModule, CryptoSurface>,
] = [true, true, true, true, true, true];
void matches;
