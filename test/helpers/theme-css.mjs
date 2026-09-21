/**
 * The stylesheet a rendered test runs against.
 *
 * Two sources, and both are needed for a computed style to mean anything:
 *
 * - `PLUGIN_CSS` is the plugin's real `styles.css`.
 * - `THEME_CSS` is the part of the app's own `app.css` this plugin competes with,
 *   copied here so the test does not depend on where Obsidian is installed.
 *   Without it a rule that LOSES to the theme looks correct in the source and
 *   wrong on screen — which is exactly how the sweep's two fields came to be drawn
 *   by two different stylesheets.
 */

import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./build.mjs";

export const PLUGIN_CSS = fs.readFileSync(path.join(repoRoot, "styles.css"), "utf8");

/**
 * The theme rules that decide this plugin's controls.
 *
 * `select`/`.dropdown`: where the chevron lives, and why a bare `select` has none
 * (`appearance: none`). `input[type='text']`: (0,1,1), which outranks a lone class.
 * The variables are given the values the default dark theme gives them.
 */
export const THEME_CSS = `
:root {
  --input-height: 30px;
  --input-padding: 4px 8px;
  --input-radius: 6px;
  --input-shadow: inset 0 0 0 1px rgba(255,255,255,0.05), 0 1px 2px rgba(0,0,0,0.2);
  --font-ui-small: 13px;
  --background-modifier-form-field: #1a1a1a;
  --interactive-normal: #2a2a2a;
  --interactive-hover: #333333;
  --interactive-accent: #7b6cd9;
  --interactive-accent-hover: #8a7ce6;
  --background-primary: #1e1e1e;
  --background-secondary: #262626;
  --background-modifier-border: #333333;
  --background-modifier-border-hover: #444444;
  --background-modifier-hover: rgba(255,255,255,0.06);
  --text-normal: #dcddde;
  --text-muted: #aaaaaa;
  --text-faint: #666666;
  --text-on-accent: #ffffff;
  --text-warning: #d9a04a;
  --radius-s: 4px;
}
select, .dropdown {
  height: var(--input-height);
  font-size: var(--font-ui-small);
  color: var(--text-normal);
  box-sizing: border-box;
  border: 0;
  box-shadow: var(--input-shadow);
  border-radius: var(--input-radius);
  -webkit-appearance: none;
  appearance: none;
  background-color: var(--interactive-normal);
  padding: var(--input-padding);
}
.dropdown {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23FFF' stroke-width='2'%3E%3Cpath d='m7 15 5 5 5-5'/%3E%3Cpath d='m7 9 5-5 5 5'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 4px center;
  background-size: 15px auto;
}
input[type='text'] {
  background: var(--background-modifier-form-field);
  border: 1px solid var(--background-modifier-border);
  color: var(--text-normal);
  padding: var(--input-padding);
  font-size: var(--font-ui-small);
  border-radius: var(--input-radius);
  height: var(--input-height);
}
`;
