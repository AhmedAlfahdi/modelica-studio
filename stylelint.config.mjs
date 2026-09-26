/**
 * CSS gate: the checks the community-plugin review applies to `styles.css`.
 *
 * Obsidian publishes `stylelint-config-obsidianmd` for theme submissions and
 * applies the same family of checks to plugins. The rules below are that set,
 * carried over whole, minus its stylistic base: what is enforced here is what a
 * review reports -- `:has()`, `!important`, CSS no supported Electron renders,
 * external URLs, named colours, `all`, duplicate properties, unknown syntax --
 * and nothing about formatting, so the file stays readable to a human.
 *
 * Two of these have bitten this stylesheet:
 *
 *   - `:has()` is rejected on performance grounds: a selector that depends on a
 *     descendant invalidates broadly, so a class toggled on the element itself
 *     is used instead.
 *   - `display: contents` is rejected as an unsupported feature. The browser
 *     data behind that flags the accessibility bugs around it, so the row
 *     wrappers that used it were removed and their children placed directly in
 *     the grid that lays them out; that keeps the shared columns of a single
 *     grid, which per-row grids would have lost.
 *
 * Deliberately NOT extended from `stylelint-config-standard`: whitespace,
 * quoting and number formatting are not review findings, and a gate that fails
 * on them would be turned off rather than satisfied.
 */
export default {
  plugins: ["stylelint-no-unsupported-browser-features"],
  rules: {
    "declaration-no-important": true,
    "selector-pseudo-class-disallowed-list": ["has"],
    "plugin/no-unsupported-browser-features": [
      true,
      // The same target the published config uses: anything Electron 43 or
      // later renders is fair game, and nothing older has to be supported.
      { browsers: ["electron >= 43"], ignore: ["css-nesting", "css-cascade-layers"] },
    ],
    "function-url-scheme-disallowed-list": [["http", "https", "file"]],
    "function-url-scheme-allowed-list": ["data"],
    "color-named": "never",
    "property-disallowed-list": [["all"]],
    "declaration-block-no-duplicate-properties": true,
    "selector-pseudo-class-no-unknown": [true, { ignorePseudoClasses: ["global", "local"] }],
    "selector-pseudo-element-no-unknown": true,
    // Custom elements are allowed, because MathJax renders into one. `renderMath`
    // returns an `<mjx-container>`, and it is the only element the typeset
    // equation's rules can name — the stylesheet styled `.math` for a while, which
    // is what Obsidian's own markdown renderer wraps maths in and not what this API
    // returns, so the rules matched nothing and said nothing.
    "selector-type-no-unknown": [true, { ignore: ["custom-elements"] }],
    "at-rule-no-unknown": [true, { ignoreAtRules: ["layer", "property", "container"] }],
    "unit-no-unknown": true,
  },
};
