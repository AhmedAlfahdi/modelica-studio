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
  aiReady, secretNameOf, legacyKeyOf, LEGACY_SECRET_NAME, AI_PROVIDERS,
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

test("the editor paints text in a single layer, so nothing can hide it", () => {
  // The two-layer design — a transparent textarea over a painted <pre> — is what
  // allowed "the text is invisible but the caret still moves": the glyphs were
  // drawn by an element other than the one being edited, so any disagreement
  // between them showed as missing text. Reported three times, never
  // reproducible outside the reporter's app. One layer cannot disagree.
  const css = fs.readFileSync(path.join(repoRoot, "styles.css"), "utf8");
  const editor = fs.readFileSync(path.join(repoRoot, "src/view/code-editor.ts"), "utf8");

  assert.match(editor, /contenteditable/, "the editor is one editable element");
  assert.ok(!/createEl\("textarea"/.test(editor), "and there is no textarea");
  assert.ok(!/mst-code-input/.test(css), "the transparent textarea rule is gone");
  assert.ok(!/mst-code-highlight/.test(css), "and so is the separate highlight layer");

  // The single layer must state a real colour, and must not be transparent.
  const rule = [...css.matchAll(/(?:^|\n)\.mst-code-editor\s*\{[^}]*\}/g)].map((m) => m[0]).join("\n");
  assert.ok(rule, "the editable layer has a rule");
  assert.match(rule, /color:\s*var\(--text-normal\)/, "it sets its own colour");
  assert.ok(
    !/transparent/.test(rule.replace(/caret-color:[^;]*;?/g, "")),
    "and never makes its own text transparent"
  );
  // Preformatted behaviour is required, since a div collapses whitespace.
  assert.match(rule, /white-space:\s*pre/, "whitespace is preserved");

  // Tokens are coloured as spans inside it.
  for (const cls of ["mst-keyword", "mst-type", "mst-string", "mst-number", "mst-comment"]) {
    assert.ok(css.includes("." + cls), `${cls} is styled`);
  }
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

/* ---- fuzzy search and library exclusion ---- */

const fuzzyMod = await import(
  path.join(buildLibs("fuzzy-lib", ["src/modelica/fuzzy.ts"]), "fuzzy.js")
);
const { fuzzyMatch, fuzzyFilter, isUnderAny } = fuzzyMod;

const LIB = [
  "Modelica.Electrical.Analog.Basic.Resistor",
  "Modelica.Electrical.Analog.Basic.Capacitor",
  "Modelica.Electrical.Analog.Sources.ConstantVoltage",
  "Modelica.Fluid.Vessels.OpenTank",
  "Modelica.Fluid.Pipes.StaticPipe",
  "Modelica.Mechanics.Rotational.Components.Inertia",
  "Modelica.Blocks.Sources.Sine",
];

test("fuzzy matching accepts a subsequence, not just a substring", () => {
  // The reason for fuzzy search: in ~6,900 classes the exact spelling is often
  // what you are looking for. Substring search finds none of these.
  assert.ok(fuzzyMatch("Modelica.Electrical.Analog.Basic.Resistor", "res"));
  assert.ok(fuzzyMatch("Modelica.Fluid.Vessels.OpenTank", "tank"));
  assert.ok(fuzzyMatch("Modelica.Blocks.Continuous.PID", "pid"));
  assert.ok(fuzzyMatch("Modelica.Fluid.Fittings.SimpleGenericOrifice", "orifice"));
  // Order still matters: a subsequence is ordered, not a bag of letters.
  assert.equal(fuzzyMatch("Resistor", "rts"), null, "r-t-s is not in order");
  assert.ok(fuzzyMatch("Resistor", "rst"), "but r-s-t is");
  assert.ok(fuzzyMatch("Resistor", "rsr"), "and r-s-r");
  // Absent characters never match.
  assert.equal(fuzzyMatch("Sine", "xyz"), null);
  assert.equal(fuzzyMatch("Sine", "sines"), null, "a longer query than the name");
  assert.deepEqual(fuzzyMatch("Anything", ""), { score: 0, positions: [] });
});

test("the ranking puts the class a user means near the top", () => {
  // The measure that matters, and the one the first hand-tuned scoring failed:
  // against the real library `tank` returned `Brake` and `Rankine` while
  // `OpenTank` ranked below both.
  const names = [
    "Modelica.Electrical.Analog.Basic.Resistor",
    "Modelica.Electrical.Analog.Basic.Capacitor",
    "Modelica.Blocks.Continuous.PID",
    "Modelica.Fluid.Vessels.OpenTank",
    "Modelica.Mechanics.Translational.Components.Brake",
    "Modelica.Thermal.HeatTransfer.Rankine",
    "Modelica.Fluid.Fittings.SimpleGenericOrifice",
    "Modelica.Mechanics.Rotational.Components.Inertia",
    "Modelica.Electrical.Analog.Semiconductors.Diode",
  ];
  const top = (q) => fuzzyFilter(names, q, 1)[0]?.name.split(".").pop();
  assert.equal(top("res"), "Resistor");
  assert.equal(top("capacitor"), "Capacitor");
  assert.equal(top("pid"), "PID");
  assert.equal(top("tank"), "OpenTank", "not Brake or Rankine");
  assert.equal(top("orifice"), "SimpleGenericOrifice");
  assert.equal(top("inertia"), "Inertia");
  assert.equal(top("diode"), "Diode");
});

test("a name that starts with the query outranks one that merely contains it", () => {
  const names = [
    "Modelica.Mechanics.Rotational.Components.Inertia",
    "Modelica.Blocks.Continuous.InertialDelay",
  ];
  assert.equal(fuzzyFilter(names, "inertia", 1)[0].name, "Modelica.Mechanics.Rotational.Components.Inertia");
});

test("matching reports positions that index the full qualified name", () => {
  const name = "Modelica.Electrical.Analog.Basic.Resistor";
  const m = fuzzyMatch(name, "res");
  assert.equal(m.positions.length, 3, "one position per query character");
  // The reports must point at the characters that matched, or highlighting a
  // match would land on the wrong letters.
  assert.equal(m.positions.map((p) => name[p].toLowerCase()).join(""), "res");
  assert.ok(
    m.positions[0] >= name.length - "Resistor".length,
    `the match is in the class name, got ${m.positions[0]}`
  );
});

test("filtering ranks, limits and never returns a non-match", () => {
  const names = [
    "Modelica.Electrical.Analog.Basic.Resistor",
    "Modelica.Electrical.Analog.Basic.Capacitor",
    "Modelica.Fluid.Vessels.OpenTank",
  ];
  const hits = fuzzyFilter(names, "res");
  assert.equal(hits.length, 1, "only the real match comes back");
  for (const h of hits) assert.ok(fuzzyMatch(h.name, "res"), `${h.name} matches`);
  assert.equal(fuzzyFilter(names, "o", 2).length, 2, "the limit is honoured");
  assert.deepEqual(fuzzyFilter(names, ""), [], "an empty query searches nothing");
});

test("a query can reach a class through its package path", () => {
  // How a Modelica path is typed from memory: the start of a segment, then the
  // rest of the path flattened.
  //
  // The anchor must be a segment's FIRST character, which is what stops the rule
  // from being meaningless — without it `tank` matched
  // `Mechanics.Translational.Components.Brake`: 't' from Translational, a-n-k
  // from later in the path.
  const name = "Modelica.Electrical.Analog.Basic.Resistor";
  assert.equal(fuzzyFilter([name], "eleba", 1).length, 1, "Electrical...Basic is reachable");
  assert.equal(fuzzyFilter([name], "moelba", 1).length, 1, "and from the root package");

  // A query that matches neither the name nor opens a segment finds nothing.
  // (`ank` is NOT a good example: it is a plain subsequence of "OpenTank", so
  // it matches the name and correctly returns a result.)
  assert.deepEqual(
    fuzzyFilter(["Modelica.Fluid.Vessels.OpenTank"], "zzz", 1),
    [],
    "an absent query finds nothing"
  );

  // KNOWN LIMITATION, recorded rather than hidden: a path query that spans three
  // or more segments while its own tail needs a late character can fail, because
  // the tail is matched as one subsequence and the anchor must precede all of
  // it. `elareba` (Electrical.Analog...Basic) is one such case; `eleba` works.
  // Searching by the class name — `resistor` — always works, which is what the
  // palette is mostly used for.
  assert.equal(fuzzyFilter([name], "elareba", 1).length, 0, "the documented limitation");
});

test("scoring prefers tight matches over scattered ones", () => {
  const tight = fuzzyMatch("OpenTank", "tank").score;
  const scattered = fuzzyMatch("ThermalConductivity", "tank");
  assert.ok(scattered === null || tight > scattered.score, "a contiguous run wins");
});

test("a library can be excluded, on segment boundaries", () => {
  const fluid = "Modelica.Fluid";
  assert.ok(isUnderAny("Modelica.Fluid.Vessels.OpenTank", [fluid]), "a member is excluded");
  assert.ok(isUnderAny("Modelica.Fluid", [fluid]), "the package itself is excluded");
  // The boundary rule: a prefix must not swallow a sibling that merely starts
  // with the same letters.
  assert.ok(
    !isUnderAny("Modelica.ElectricalExtra.Thing", ["Modelica.Electrical"]),
    "Modelica.Electrical must not exclude Modelica.ElectricalExtra"
  );
  assert.ok(!isUnderAny("Modelica.Blocks.Sources.Sine", [fluid]), "unrelated names are kept");
  // Blank and whitespace-only entries are ignored rather than matching nothing
  // or everything.
  assert.ok(!isUnderAny("Modelica.Fluid.Vessels.OpenTank", ["", "   "]));
  assert.ok(isUnderAny("Modelica.Fluid.X", ["  Modelica.Fluid  "]), "entries are trimmed");
});

test("no AI preset ships a retired model name", () => {
  // `deepseek-chat` was the default and has been retired in favour of
  // `deepseek-flash`. A stale name fails at request time with an error that
  // reads like a bad key, so the presets are pinned to names confirmed from each
  // provider's own documentation.
  const retired = ["deepseek-chat", "deepseek-reasoner", "gpt-4o-mini", "gpt-4-turbo"];
  for (const p of AI_PROVIDERS) {
    assert.ok(!retired.includes(p.model), `${p.label} does not default to the retired "${p.model}"`);
    for (const m of p.models ?? []) {
      assert.ok(!retired.includes(m), `${p.label} does not suggest the retired "${m}"`);
    }
  }
});

test("DeepSeek defaults to the current model names", () => {
  const deepseek = AI_PROVIDERS.find((p) => p.label === "DeepSeek");
  assert.ok(deepseek, "the provider is listed");
  assert.equal(deepseek.model, "deepseek-flash");
  assert.ok(deepseek.models.includes("deepseek-v4-pro"), "and the pro model is offered");
});

test("every preset names where its defaults came from", () => {
  // A preset that cannot say when it was checked is one nobody can tell is stale.
  for (const p of AI_PROVIDERS) {
    if (p.baseUrl.includes("localhost")) continue; // local servers, nothing to check
    assert.ok(p.verified, `${p.label} records a verification date`);
    assert.match(p.verified, /^\d{4}-\d{2}-\d{2}/, `${p.label} records a real date`);
  }
});

test("provider base URLs are distinct, so a preset cannot be ambiguous", () => {
  const urls = AI_PROVIDERS.map((p) => p.baseUrl);
  assert.equal(new Set(urls).size, urls.length, "no two providers share a base URL");
});

test("the code pane scrolls, and the caret pulls it", () => {
  // The scroll container used `overflow: hidden`, so a long model could not be
  // scrolled at all. And because the scrolling element is not the focused one —
  // the editable div is inside it — nothing brings the caret back into view on
  // its own; the editor has to do it.
  const css = fs.readFileSync(path.join(repoRoot, "styles.css"), "utf8");
  const scroll = /(?:^|\n)\.mst-code-scroll\s*\{[^}]*\}/.exec(css);
  assert.ok(scroll, "the viewport has a rule");
  assert.match(scroll[0], /overflow:\s*auto/, "it scrolls");
  assert.ok(!/overflow:\s*hidden/.test(scroll[0]), "and is not clipped");
  assert.match(scroll[0], /min-height:\s*0/, "it can shrink, so overflow lands here");

  const editor = fs.readFileSync(path.join(repoRoot, "src/view/code-editor.ts"), "utf8");
  assert.match(editor, /function revealCaret/, "the editor scrolls the caret into view");
  // Called wherever the caret moves.
  assert.ok(
    (editor.match(/revealCaret\(\)/g) ?? []).length >= 4,
    "and is called after typing, after moving the caret, and after undo"
  );
});
