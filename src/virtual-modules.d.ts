/**
 * Modules the bundler provides.
 *
 * `virtual:whats-new` is the changelog section for the version being built, extracted by
 * `scripts/whats-new.mjs` inside `esbuild.config.mjs`. It is declared here rather than
 * written to a file so that a release's notes cannot be stale: they are read from
 * CHANGELOG.md every time the bundle is built.
 */
declare module "virtual:whats-new" {
  export const whatsNew: { version: string; date: string; body: string } | null;
}
