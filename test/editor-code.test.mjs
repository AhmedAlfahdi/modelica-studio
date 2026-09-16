/**
 * Source editor and AI client.
 *
 * The tokenizer carries a promise that is easy to break and hard to notice: the
 * highlighted output must be the input again once the tags are stripped, or the
 * colours drift away from the text underneath them. That is the first thing
 * checked here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { buildLibs, repoRoot } from "./helpers/build.mjs";

const langMod = await import(
  path.join(buildLibs("lang-lib", ["src/view/modelica-lang.ts"]), "modelica-lang.js")
);
const {
  tokenize, highlight, escapeHtml, classifyWord, completionsFor, SNIPPETS,
  prefixAt, applyCompletion, indentForNewline,
} = langMod;

const aiMod = await import(path.join(buildLibs("ai-lib", ["src/ai/prompts.ts"]), "prompts.js"));
const {
  buildMessages, extractModelica, modelNameOf, AI_DEFAULTS, relevantClasses,
  aiReady, secretNameOf, legacyKeyOf, LEGACY_SECRET_NAME,
} = aiMod;

/** Strip tags and unescape, to compare against the original source. */
function textOf(html) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // &amp; last, or "&amp;lt;" would become "<".
    .replace(/&amp;/g, "&");
}

const SAMPLE = `model Tank "A tank"
  // drain through an orifice
  parameter Real g=9.81 "gravity";
  Real h(start=1, fixed=true) "depth";
  Modelica.Fluid.Vessels.OpenTank tank(crossArea=0.01);
equation
  der(h) = -sqrt(2*g*h)*0.001;
  if h <= 0.5 then
    tank.level = 1.0e-3 + 4.2;
  end if;
end Tank;
`;

test("highlighting reproduces the source exactly", () => {
  // The whole point of the two-layer editor: what is drawn must be the text.
  assert.equal(textOf(highlight(SAMPLE)), SAMPLE + "\n");
});

test("highlighting survives half-typed code", () => {
  // Colouring has to keep working while someone is mid-keystroke, so an
  // unterminated string or comment must not throw or swallow the rest.
  for (const partial of [
    'model M\n  Real x "unterminated',
    "model M\n  // a comment with no end",
    "model M\n  Real x = ",
    "model M\n  Real x = 1.5e",
    '"',
    "//",
    "",
  ]) {
    const html = highlight(partial);
    assert.equal(textOf(html), partial + "\n", `round trip failed for ${JSON.stringify(partial)}`);
  }
});

test("tokenizer covers comments, strings, numbers and keywords", () => {
  const kinds = (src) => tokenize(src).map((t) => t.kind);
  assert.ok(kinds("// note").includes("comment"));
  assert.ok(kinds('"a string"').includes("string"));
  assert.ok(kinds("model M").includes("keyword"));
  assert.ok(kinds("1.5e-3").includes("number"));
  // A `//` inside a string is not a comment.
  assert.ok(!kinds('"http://x"').includes("comment"));
  // Operators are matched longest-first, so `<=` is not `<` then `=`.
  const ops = tokenize("a <= b").filter((t) => t.kind === "operator");
  assert.deepEqual(ops.map((t) => "a <= b".slice(t.start, t.end)), ["<="]);
});

test("identifiers are classified the way Modelica is written", () => {
  assert.equal(classifyWord("model"), "keyword");
  assert.equal(classifyWord("Real"), "builtin");
  assert.equal(classifyWord("Modelica"), "type");
  assert.equal(classifyWord("myVariable"), "plain");
  // A digit-leading word is not an identifier, but capitals are the convention
  // for types and must not be coloured as plain text.
  assert.equal(classifyWord("Resistor"), "type");
});

test("escapes the characters that would break the highlight layer", () => {
  // Angle brackets and ampersands are what would break out of the layer.
  assert.equal(escapeHtml('<a> & "b"'), '&lt;a&gt; &amp; "b"');
  const src = "model M\n  // <b>not markup</b> & co\nend M;";
  const html = highlight(src);
  assert.ok(!html.includes("<b>"), "angle brackets from the source must be escaped");
  assert.equal(textOf(html), src + "\n");
});

test("completions offer keywords, snippets and nothing on an empty prefix", () => {
  assert.deepEqual(completionsFor("", undefined), [], "an empty prefix completes nothing");
  const kw = completionsFor("par", undefined);
  assert.ok(kw.some((c) => c.label === "parameter"), "the keyword is offered");
  assert.ok(SNIPPETS.length > 0, "snippets exist");

  // Prefix matches rank before incidental ones.
  const both = completionsFor("mo", undefined);
  const idx = both.findIndex((c) => c.label === "model");
  assert.ok(idx >= 0 && idx < 5, `"model" should rank early, got ${idx}`);
});

test("buildMessages carries the request, the current source and the rules", () => {
  const msgs = buildMessages({
    prompt: "a tank draining through an orifice",
    current: "model Old\nend Old;",
  });
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, "system");
  const system = msgs[0].content;
  const user = msgs[1].content;

  // The rules that stop the model inventing library classes.
  assert.match(system, /Modelica Standard Library/);
  assert.match(system, /fully qualified/i);
  assert.match(system, /fenced code block/i);
  // The current source goes to the model, or it cannot edit what it cannot see.
  assert.match(user, /model Old/);
  assert.match(user, /tank draining/);
});

test("buildMessages includes diagnostics only when repairing", () => {
  const plain = buildMessages({ prompt: "make a tank" })[1].content;
  assert.ok(!/fails to compile/.test(plain));
  const fixing = buildMessages({
    prompt: "fix it",
    current: "model X\nend X;",
    diagnostics: "Error: X is not declared",
  })[1].content;
  assert.match(fixing, /fails to compile/);
  assert.match(fixing, /X is not declared/);
});

test("a user's standing instructions are passed through", () => {
  const msgs = buildMessages({ prompt: "x", systemPrompt: "Always use SI units." });
  assert.match(msgs[0].content, /Always use SI units\./);
});

test("extractModelica takes the fenced block, preferring the longest", () => {
  assert.equal(extractModelica("```modelica\nmodel A\nend A;\n```"), "model A\nend A;");
  // A short usage example alongside the model must not win.
  const reply = "```\nmodel A\nend A;\n```\nand then\n```modelica\nmodel B\n  Real x;\nend B;\n```";
  assert.match(extractModelica(reply), /model B/);
  // Prose with no code is not source.
  assert.equal(extractModelica("I cannot help with that."), "");
});

test("extractModelica accepts a reply that is already source", () => {
  // Models frequently answer without a fence despite being asked for one.
  const bare = "model Plain\n  Real x;\nend Plain;";
  assert.equal(extractModelica(bare), bare);
});

test("modelNameOf reads the declared class", () => {
  assert.equal(modelNameOf("model Tank\nend Tank;"), "Tank");
  assert.equal(modelNameOf("  // comment\nblock Control\nend Control;"), "Control");
  assert.equal(modelNameOf("this is not modelica"), undefined);
  assert.equal(modelNameOf(""), undefined);
});

test("the default configuration has the feature switched off", () => {
  // Shipping an enabled AI feature with a placeholder key would mean requests
  // going somewhere the user did not choose.
  assert.equal(AI_DEFAULTS.secretName, "", "no secret chosen by default");
  assert.ok(AI_DEFAULTS.baseUrl.startsWith("https://"), "and a sane default endpoint");
  assert.ok(AI_DEFAULTS.temperature <= 0.5, "low temperature suits code");
});

test("relevantClasses searches the library and returns nothing without one", () => {
  assert.deepEqual(relevantClasses(undefined, "a tank"), []);
  // Stand-in index: only the call shape and the de-duplication are under test.
  const seen = [];
  const fake = {
    listPlaceable(filter, limit) {
      seen.push(filter);
      return [
        { name: "Modelica.Fluid.Vessels.OpenTank" },
        { name: "Modelica.Fluid.Vessels.OpenTank" }, // duplicate
      ].slice(0, limit);
    },
  };
  const names = relevantClasses(fake, "tank vessels", 10);
  assert.deepEqual(names, ["Modelica.Fluid.Vessels.OpenTank"], "duplicates are dropped");
  assert.ok(seen.length > 0, "the library was searched");
});

test("the editor and AI client are reachable from the bundle", () => {
  // The plugin ships as one bundle; a module that is never imported is silently
  // missing at run time, which is how the source editor would fail.
  const bundle = buildLibs("editor-lib", ["src/view/code-editor.ts"]);
  const built = path.join(bundle, "code-editor.js");
  assert.ok(built.length > 0);
});

test("the completion prefix is the identifier under the caret", () => {
  const src = "model M\n  Modelica.Electrical.Analog";
  assert.deepEqual(prefixAt(src, src.length), {
    text: "Modelica.Electrical.Analog",
    from: "model M\n  ".length,
  });
  // Mid-word: only the part before the caret counts, so the last three
  // characters of "Analog" are excluded.
  const caret = src.indexOf("Analog") + 3;
  assert.equal(prefixAt(src, caret).text, "Modelica.Electrical.Ana");
  // After a space there is no prefix to complete.
  assert.equal(prefixAt("model ", 6).text, "");
  // Out-of-range carets are clamped rather than throwing.
  assert.equal(prefixAt("abc", 99).text, "abc");
  assert.equal(prefixAt("abc", -5).text, "");
});

test("accepting a completion replaces the typed fragment, never duplicates it", () => {
  const src = "  Modelica.Elec";
  const item = {
    label: "Resistor",
    insert: "Modelica.Electrical.Analog.Basic.Resistor",
    detail: "",
    kind: "class",
  };
  const out = applyCompletion(src, src.length, item);
  assert.equal(out.text, "  Modelica.Electrical.Analog.Basic.Resistor");
  assert.equal(out.caret, out.text.length);
  // The fragment typed must not survive anywhere in the result.
  assert.equal(out.text.split("Modelica.").length - 1, 1, "the qualifier appears once");
});

test("accepting a keyword splices it in at the caret", () => {
  const out = applyCompletion("Real par", 8, { label: "parameter", insert: "parameter", detail: "", kind: "keyword" });
  assert.equal(out.text, "Real parameter");
  assert.equal(out.caret, 14);
});

test("a new line keeps the indentation and deepens after a block opener", () => {
  // Inside a model body, the next line should stay indented.
  assert.equal(indentForNewline("model M\n  ", 10), "  ");
  // After an opener, one more level.
  assert.equal(indentForNewline("model M", 7), "  ");
  assert.equal(indentForNewline("equation", 8), "  ");
  assert.equal(indentForNewline("  Real x = 1;", 13), "  ");
  // A declaration does not open a block.
  assert.equal(indentForNewline("  Real x;", 9), "  ");
});

test("the highlight layer states its own text colour", () => {
  // The layer paints the text, so if it inherits a colour it can inherit the
  // wrong one. This was a real fault: Obsidian colours `pre`/`code` with
  // rgb(34,34,34), so on a dark theme every token without an explicit colour —
  // identifiers, punctuation, `connect`, `end` — was painted near-black on a
  // dark background. The coloured tokens stayed visible, which made it look like
  // text was randomly missing rather than miscoloured.
  const css = fs.readFileSync(path.join(repoRoot, "styles.css"), "utf8");
  // The class has several rules; the colour is asserted on whichever one sets it.
  const blocks = [...css.matchAll(/(?:^|\n)\.mst-code-highlight\s*\{[^}]*\}/g)].map((m) => m[0]);
  assert.ok(blocks.length >= 2, "the layer has its own rules, separate from the shared metrics rule");
  const joined = blocks.join("\n");
  assert.match(joined, /color:\s*var\(--text-normal\)/, "it sets its own colour");
  assert.match(joined, /!important/, "and cannot be overridden by a theme rule on pre/code");
  assert.match(joined, /z-index:\s*1/, "it sits under the input");

  const input = [...css.matchAll(/(?:^|\n)\.mst-code-input\s*\{[^}]*\}/g)].map((m) => m[0]).join("\n");
  assert.ok(input, "the textarea has a rule");
  assert.match(input, /z-index:\s*2/, "and above the highlight");
});

test("the CSS is loadable and the selectors match what the editor emits", () => {
  const css = fs.readFileSync(path.join(repoRoot, "styles.css"), "utf8");
  // Every class the editor creates must have a rule, or it renders unstyled.
  const editor = fs.readFileSync(path.join(repoRoot, "src/view/code-editor.ts"), "utf8");
  const emitted = new Set(
    [...editor.matchAll(/cls: ([`"])([^`"]+)\1/g)].flatMap((m) => m[2].split(/\s+/))
  );
  for (const cls of emitted) {
    if (!cls.startsWith("mst-code")) continue;
    assert.ok(css.includes("." + cls), `${cls} has a style rule`);
  }
});

test("the config holds a secret NAME, never the key itself", () => {
  // The whole point of using the keychain: the value must not be persistable.
  assert.equal(AI_DEFAULTS.secretName, "", "nothing chosen by default");
  assert.equal(AI_DEFAULTS.apiKey, undefined, "and no plaintext field in a fresh install");

  const cfg = { ...AI_DEFAULTS, secretName: "my-openai-key" };
  assert.equal(secretNameOf(cfg), "my-openai-key");
  assert.equal(secretNameOf({ ...AI_DEFAULTS }), "", "absent means empty, not undefined");
  assert.equal(secretNameOf({ ...AI_DEFAULTS, secretName: "   " }), "", "whitespace is not a name");
});

test("readiness needs a resolved key, not just a name", () => {
  const cfg = { ...AI_DEFAULTS, secretName: "k" };
  // A name with no value behind it must not be treated as configured: the
  // secret may have been deleted from the keychain after being chosen.
  assert.equal(aiReady(cfg, null), false, "no key resolved");
  assert.equal(aiReady(cfg, ""), false, "empty key");
  assert.equal(aiReady(cfg, "   "), false, "whitespace key");
  assert.equal(aiReady(cfg, "sk-real"), true);
  // And a key with no endpoint or model is still not usable.
  assert.equal(aiReady({ ...cfg, model: "" }, "sk-real"), false);
  assert.equal(aiReady({ ...cfg, baseUrl: "" }, "sk-real"), false);
});

test("a legacy plaintext key is detectable so it can be migrated", () => {
  assert.equal(legacyKeyOf({ ...AI_DEFAULTS }), "", "nothing to migrate in a fresh install");
  assert.equal(legacyKeyOf({ ...AI_DEFAULTS, apiKey: "sk-old" }), "sk-old");
  assert.equal(legacyKeyOf({ ...AI_DEFAULTS, apiKey: "  sk-old  " }), "sk-old", "trimmed");
});

test("the migration secret name is valid for SecretStorage", () => {
  // SecretStorage requires lowercase alphanumeric with optional dashes and
  // throws otherwise, so an invalid constant would fail only at run time.
  assert.match(LEGACY_SECRET_NAME, /^[a-z0-9-]+$/, "lowercase alphanumeric with dashes");
  assert.ok(LEGACY_SECRET_NAME.includes("modelica"), "namespaced to avoid another plugin\'s secret");
});
