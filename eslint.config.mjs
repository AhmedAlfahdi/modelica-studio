// The plugin directory's own linter, run locally.
//
// `eslint-plugin-obsidianmd`'s recommended config is what the community directory reviews
// a submission with — the same rules, the same severities — so a submission is not the
// first time anyone sees the list. `npm run lint` reproduces it here, and
// `test/lint.test.mjs` fails the suite when it is not clean, which is what keeps it from
// drifting between releases.
//
// The rules that need type information are the reason for `projectService`: without it
// the `no-unsafe-*` family reports nothing (or everything) and the check is worthless.

import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    // Built output, local build caches, the example vault's copy of the bundle, and the
    // generated notes: not source, and not ours to lint.
    ignores: [
      "main.js",
      "node_modules/**",
      "examples/vault/.obsidian/**",
      ".readme-images-*/**",
      "scripts/readme-icons.json",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    rules: {
      // The directory reports a deprecated API as a RECOMMENDATION, not an error, and this
      // config exists to predict what the directory will say. Kept visible as a warning so
      // the list stays in front of whoever raises `minAppVersion`: several of them
      // (`display`, `setDynamicTooltip`) are the price of supporting 1.11.4.
      "@typescript-eslint/no-deprecated": "warn",
      // The plugin's own proper nouns. The rule lowercases anything it does not know, so
      // "OpenModelica path" became "Openmodelica path" and "Modelica Studio" became
      // "Modelica studio" — both wrong, and both would have been "fixed" into the UI by
      // the rule's autofix. These are the product, language and library names this plugin
      // is about; `SI` is a unit system, not a word.
      "obsidianmd/ui/sentence-case": [
        "error",
        {
          brands: [
            "Modelica",
            "Modelica Studio",
            "OpenModelica",
            "Modelica Standard Library",
            "OMEdit",
            "DeepSeek",
            "Groq",
            "OpenRouter",
            "Ollama",
            "llama.cpp",
            "SI",
            "Ryzen",
          ],
          // `omc` is the executable's real name (lower case, as OpenModelica writes it),
          // so it is deliberately not in this list: the rule would demand "OMC".
          acronyms: ["SI", "AI", "MSL", "API", "URL", "PID", "RC", "RLC", "DC", "AC"],
        },
      ],
    },
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Files that are not in `tsconfig.json`'s `include`: the config file itself and
          // the build script. The test suite is linted with its own project below, because
          // a `**` glob in this list is rejected by typescript-eslint (it would put
          // hundreds of files on the default project and make linting crawl).
          allowDefaultProject: ["eslint.config.mjs", "esbuild.config.mjs"],
        },
      },
    },
  },
  {
    // The test suite and the build/verification scripts are not the plugin: they run in
    // Node on the developer's machine, they may log, and they have no business obeying
    // rules about Obsidian's UI or its popout windows. `document.createElement` in a test
    // harness that stubs the DOM is not a UI decision either.
    files: ["test/**/*.mjs", "test/**/*.ts", "scripts/**/*.mjs", "scripts/**/*.ts", "esbuild.config.mjs"],
    rules: {
      "obsidianmd/rule-custom-message": "off",
      "no-console": "off",
      "obsidianmd/no-static-styles-assignment": "off",
      "obsidianmd/prefer-create-el": "off",
      "obsidianmd/no-plugin-id-in-command-id": "off",
      "obsidianmd/no-command-in-command-name": "off",
    },
  },
]);
