/**
 * Render the README's screenshots.
 *
 * Every image is produced from the plugin's OWN code and the library's own icons —
 * the editor draws the diagram, the plot draws the simulated result, the Help window
 * and the settings tab are the real DOM with the real stylesheet. Nothing is mocked
 * up in an image editor, so an image cannot show a capability the plugin does not
 * have, and regenerating them after a change is one command:
 *
 *     node scripts/readme-images.mjs
 *
 * The model is the built-in `MassSpringDamper` example ("two masses coupled by a
 * spring and damper"), so the pictures describe something a reader can open in the
 * plugin and run themselves. The simulation is REAL: `omc` compiles and runs it, and
 * the plot shows the numbers that came back.
 *
 * Rendered at 2x device scale, because a README is read on screens that have one.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "images");
const TMP = fs.mkdtempSync(path.join(ROOT, ".readme-images-"));
const ESCALE = 2;

/* ------------------------------------------------------------------ */
/* Bundles                                                              */
/* ------------------------------------------------------------------ */

const EMPTY = path.join(TMP, "empty.ts");
fs.writeFileSync(EMPTY, "export default {};\nexport const spawn = () => {};\n");
const NODE_MODULES = ["node:child_process", "node:crypto", "node:fs", "node:path", "node:os", "node:util", "node:events", "node:stream", "node:url"];

function bundle(entry, outfile, platform) {
  const args = [
    "esbuild",
    entry,
    "--bundle",
    "--format=esm",
    `--platform=${platform}`,
    "--target=chrome120",
    `--outfile=${outfile}`,
    "--log-level=error",
    `--alias:obsidian=${path.join(ROOT, "test/helpers/obsidian-stub.ts")}`,
  ];
  if (platform === "browser") for (const m of NODE_MODULES) args.push(`--alias:${m}=${EMPTY}`);
  execFileSync("npx", args, { cwd: ROOT, stdio: "pipe" });
  return outfile;
}

/* ------------------------------------------------------------------ */
/* The model, and a real simulation of it                               */
/* ------------------------------------------------------------------ */

const LIB = path.join(TMP, "lib");
// The plugin's code runs in a renderer, where `window` exists: the backend reads
// `window.navigator.hardwareConcurrency` for its default parallel-job count. This
// script runs that same code in Node, so the global it reaches for is provided here
// rather than guarded for in the plugin -- a bare `globalThis` in the source is itself
// a finding of the review this plugin has to pass. `test/helpers/build.mjs` does the
// same for the test suites.
globalThis.window ??= globalThis;
const nodeBundle = bundle("scripts/readme-images-entry.ts", path.join(TMP, "node.mjs"), "node");
const { buildSceneData } = await import(nodeBundle);

const roots = fs
  .readdirSync(path.join(process.env.HOME ?? "", ".openmodelica/libraries"))
  .filter((d) => /^Modelica 4\.1\.0|^ModelicaServices 4\.1\.0/.test(d))
  .map((d) => path.join(process.env.HOME ?? "", ".openmodelica/libraries", d));

console.log("simulating the example with the local OpenModelica…");
const data = await buildSceneData({ roots });
console.log(`  ${data.example.name}: ${data.result.time.length} samples, ${data.result.series.length} variables, ${Object.keys(data.defs).length} classes resolved`);

/* ------------------------------------------------------------------ */
/* The page: real components, real stylesheet                           */
/* ------------------------------------------------------------------ */

const CSS = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const APP_CSS = fs.existsSync("/tmp/app.css") ? fs.readFileSync("/tmp/app.css", "utf8") : "";
const PLUGIN = bundle("scripts/readme-scenes.ts", path.join(TMP, "page.js"), "browser");
const THEME_VARS = `
.theme-light { --color-accent: hsl(254, 80%, 68%); --color-accent-2: hsl(254, 80%, 76%);
  --text-accent: var(--color-accent); --text-accent-hover: var(--color-accent-2);
  --color-base-40: hsl(0, 0%, 40%); --background-modifier-border-focus: var(--color-base-40); }`;

/**
 * The icon shapes, handed to the page before it loads.
 *
 * The page renders the real view, and the view calls `setIcon` for every button; the
 * stub standing in for Obsidian has no icon table of its own, so without this the
 * toolbar came out as a row of empty squares -- which is exactly what the first
 * icon-only screenshot showed. The table is vendored (Lucide, ISC) so regenerating
 * the images does not depend on another checkout being present.
 */
const ICONS = fs.readFileSync(path.join(ROOT, "scripts/readme-icons.json"), "utf8");

const page = path.join(TMP, "index.html");
fs.writeFileSync(
  page,
  `<!doctype html><html><meta charset="utf-8">
<style>${APP_CSS}</style>
<style>${CSS}</style>
<style>
  body { margin: 0; background: var(--background-primary); }
  .shot { padding: 0; }
  #diagram, #plot, #embed, #embedPlot { width: 900px; background: var(--background-primary); }
  #studio { width: 1040px; background: var(--background-primary); color: var(--text-normal); }
</style>
<body class="theme-light">
<script>window.__ICON_SVGS__ = ${ICONS};</script>
<div id="diagram" class="shot"></div>
<div id="plot" class="shot"></div>
<div id="embed" class="shot"></div>
<div id="embedPlot" class="shot"></div>
<div id="studio" class="shot"></div>
<div id="hover" class="shot" style="width: 900px;"></div>
<div id="sweep" class="shot" style="width: 900px;"></div>
<div id="help" class="shot" style="width: 640px; padding: 14px;"></div>
<div id="settings" class="shot" style="width: 640px; padding: 14px;"></div>
<script type="module" src="./page.js"></script>
</body></html>`
);

fs.writeFileSync(path.join(TMP, "app.css"), APP_CSS);
fs.writeFileSync(path.join(TMP, "plugin.css"), CSS);
fs.writeFileSync(path.join(TMP, "theme.css"), THEME_VARS);
fs.writeFileSync(
  path.join(TMP, "scenes.json"),
  JSON.stringify({
    example: data.example,
    result: data.result,
    family: data.family,
    currentLabel: data.currentLabel,
    model: data.model,
    defs: data.defs,
    palette: data.palette,
  })
);

const runner = path.join(TMP, "shot.cjs");
fs.writeFileSync(
  runner,
  `const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
// 2x, so the images are crisp on the screens a README is read on. The canvas
// components read the same ratio and size their buffers with it.
app.commandLine.appendSwitch("force-device-scale-factor", "${ESCALE}");
app.disableHardwareAcceleration();
const SCENES = JSON.parse(fs.readFileSync(path.join(__dirname, "scenes.json"), "utf8"));

/** Crop a whole-window capture down to the scene's own box.
 *
 * capturePage ignores the rect it is given in this Electron version and returns the
 * whole window, at a device ratio only the result reveals: the ratio of the image to
 * the page's own CSS width.
 */
async function cropToScene(win, image, rect) {
  const cssWidth = await win.webContents.executeJavaScript("window.innerWidth");
  const ratio = cssWidth > 0 ? image.getSize().width / cssWidth : 1;
  const size = image.getSize();
  return image.crop({
    x: Math.max(0, Math.round(rect.x * ratio)),
    y: Math.max(0, Math.round(rect.y * ratio)),
    width: Math.min(Math.round(rect.width * ratio), size.width),
    height: Math.min(Math.round(rect.height * ratio), size.height),
  });
}
app.whenReady().then(async () => {
  // A watchdog: a scene that never resolves should fail the run, not hang it.
  const guard = setTimeout(() => { console.log("TIMED OUT waiting for a scene"); app.exit(1); }, 60000);
  void guard;
  // Shown, and not offscreen. Both alternatives fail for the images that matter here:
  // in offscreen mode capturePage returns an empty surface for anything drawn into a
  // canvas, and a hidden window refuses the capture altogether (UnknownVizError). The
  // window is never focused and closes when the run ends.
  const win = new BrowserWindow({ width: 1000, height: 900, show: true, focusable: false });
  const errors = [];
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2 && !/Security Warning/.test(message)) errors.push(String(message));
  });
  await win.loadFile(path.join(__dirname, "index.html"));
  await new Promise((r) => setTimeout(r, 900));
  if (errors.length) console.log("ERRORS " + JSON.stringify(errors).slice(0, 600));
  // The call, with the data INLINE: the page cannot see this file's variables, and a
  // function serialised with toString() would carry their names without their values.
  const DATA = JSON.stringify(SCENES);
  // Canvas scenes hand back their own pixels at the ratio the editor gave them, once
  // per theme: the editor and the plot read the theme from the page, so switching the
  // body class is what switches the drawing.
  const CANVAS = [
    ["diagram", "window.__sceneDiagram(" + DATA + ")"],
    ["plot", "window.__scenePlot(" + DATA + ")"],
    ["hover", "window.__sceneHover(" + DATA + ")"],
    ["sweep", "window.__sceneSweep(" + DATA + ")"],
  ];
  const DOM_SCENES = [
    // The whole studio first: it is the largest scene, and the window is sized to
    // each one before its capture, so the order only matters for what is left on
    // screen if a later scene fails.
    ["studio", "window.__sceneStudio(" + DATA + ")"],
    ["embed", "window.__sceneEmbed(" + DATA + ")"],
    ["embedPlot", "window.__sceneEmbedPlot(" + DATA + ")"],
  ];
  for (const theme of ["light", "dark"]) {
    win.setContentSize(1000, 900);
    await win.webContents.executeJavaScript("document.body.className = 'theme-" + theme + "'");
    await new Promise((r) => setTimeout(r, 200));
    for (const [name, call] of CANVAS) {
      const out = JSON.parse(await win.webContents.executeJavaScript("(async () => JSON.stringify(await (" + call + ")))()"));
      if (out.error) { console.log("SCENE FAILED " + name + ": " + out.error); continue; }
      fs.writeFileSync(
        path.join(${JSON.stringify(OUT)}, name + "-" + theme + ".png"),
        Buffer.from(String(out.data).split(",")[1], "base64")
      );
      console.log("wrote " + name + "-" + theme + ".png  " + out.width + "x" + out.height);
    }
  }

  // Scenes that are DOM rather than canvas: staged at the top-left with the others
  // hidden, because capturePage refuses a box outside the window. After the canvas
  // passes, since sizing the window to a DOM scene changes what the canvas scenes
  // would measure.
  for (const theme of ["light", "dark"]) {
    win.setContentSize(1000, 900);
    await win.webContents.executeJavaScript("document.body.className = 'theme-" + theme + "'");
    await new Promise((r) => setTimeout(r, 200));
    for (const [name, call] of DOM_SCENES) {
      const staged = await win.webContents.executeJavaScript(
        "(() => { try {" +
          "document.querySelectorAll('.shot').forEach((el) => { el.style.display = 'none'; });" +
          "const stage = document.getElementById('" + name + "');" +
          "if (!stage) return 'no element #' + '" + name + "';" +
          "stage.style.display = 'block'; stage.style.position = 'absolute';" +
          "stage.style.left = '0'; stage.style.top = '0';" +
          "stage.style.background = 'var(--background-primary)';" +
          "return 'ok'; } catch (e) { return String(e); } })()"
      );
      if (staged !== "ok") { console.log("SCENE STAGE FAILED " + name + ": " + staged); continue; }
      await new Promise((r) => setTimeout(r, 200));
      const rect = JSON.parse(await win.webContents.executeJavaScript(
        "(async () => { try { return JSON.stringify(await (" + call + ")); } catch (e) { return JSON.stringify({ error: String(e && e.stack || e) }); } })()"
      ));
      if (rect.error) { console.log("SCENE FAILED " + name + ": " + rect.error); continue; }
      await new Promise((r) => setTimeout(r, 400));
      // Inspect the LIVE element rather than calling the scene again, which would
      // rebuild it and measure an empty one.
      const live = JSON.parse(await win.webContents.executeJavaScript(
        "JSON.stringify((() => { const el = document.getElementById('" + name + "');" +
          " return { children: el.children.length, text: (el.textContent || '').slice(0, 50) }; })())"
      ));
      const cv = JSON.parse(await win.webContents.executeJavaScript(
        "JSON.stringify((() => { const c = document.getElementById('" + name + "').querySelector('canvas');" +
          " return c ? { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight } : null; })())"
      ));
      console.log("  " + name + ": " + live.children + " children, canvas=" + JSON.stringify(cv) + ", text=" + JSON.stringify(live.text));
      // The window is sized to the scene and the WHOLE window captured: a rect passed
      // to capturePage is not interpreted in the same space as getBoundingClientRect
      // here (a 820x300 box came back as 2050x750 and clipped the bottom), and the
      // scene is staged at the top-left, so the window and the content agree.
      let image;
      try {
        win.setContentSize(Math.ceil(rect.width), Math.ceil(rect.height) + 6);
        await new Promise((r) => setTimeout(r, 350));
        image = await win.webContents.capturePage();
        // The whole window comes back, so it is cropped to the scene's own box.
        image = await cropToScene(win, image, rect);
      } catch (err) {
        console.log("SCENE CAPTURE FAILED " + name + "-" + theme + ": " + err);
        continue;
      }
      const png = image.toPNG();
      if (png.length < 12000) {
        console.log("SCENE BLANK " + name + "-" + theme + ": only " + png.length + " bytes");
        continue;
      }
      fs.writeFileSync(path.join(${JSON.stringify(OUT)}, name + "-" + theme + ".png"), png);
      console.log("wrote " + name + "-" + theme + ".png  " + image.getSize().width + "x" + image.getSize().height + "  " + Math.round(png.length / 1024) + " KB");
    }
  }

  // The Help panel, in a page of its own: markup taken from the app page and rendered
  // where nothing hides it. Obsidian's modal CSS and the tab strip keep an inactive
  // panel unpainted even with its display forced, which is how a blank 3 KB image
  // reached the README once. (Note for future edits: this whole runner is a template
  // literal, so a backtick anywhere in here -- even in a comment -- ends it early.)
  // Wrapped: a scene that fails should leave the other images written and say so, not
  // take the run down (which is what happened here -- the Help capture kept killing the
  // generator after every other image had been written).
  let helpScene = { error: "" };
  try {
    helpScene = JSON.parse(await win.webContents.executeJavaScript("(async () => JSON.stringify(await (window.__sceneHelp())))()"));
  } catch (err) {
    helpScene = { error: String(err) };
  }
  if (helpScene.error) {
    console.log("SCENE FAILED help: " + helpScene.error);
  } else {
    const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
    const helpPage = path.join(__dirname, "help.html");
    fs.writeFileSync(
      helpPage,
      '<!doctype html><html><meta charset="utf-8">' +
        "<style>" + read("app.css") + "</style>" +
        "<style>" + read("plugin.css") + "</style>" +
        "<style>" + read("theme.css") + " body { margin: 0; padding: 16px; width: 620px; background: var(--background-primary); color: var(--text-normal); }</style>" +
        '<body class="theme-light">' +
        "<script>window.__ICON_SVGS__ = " + ${JSON.stringify(ICONS)} + ";</script>" +
        helpScene.html +
        "</body></html>"
    );
    await win.loadFile(helpPage);
    await new Promise((r) => setTimeout(r, 400));
    const rect = JSON.parse(
      await win.webContents.executeJavaScript(
        "JSON.stringify((() => { const el = document.querySelector('.modelica-studio-help-panel');" +
          " const r = el.getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(r.width) + 32, height: Math.ceil(r.height) + 32 }; })())"
      )
    );
    // The window is left at the size the canvas passes used, big enough for the panel,
    // and the capture takes the panel's own rect. Sizing the window FROM that rect fed
    // back on itself -- a narrower window reflows the panel taller -- and the window
    // does not take the size asked for exactly, so both were dead ends.
    win.setContentSize(1000, 1000);
    await new Promise((r) => setTimeout(r, 300));
    for (const theme of ["light", "dark"]) {
      await win.webContents.executeJavaScript("document.body.className = 'theme-" + theme + "'");
      await new Promise((r) => setTimeout(r, 300));
      // Awaited: cropToScene became async when the ratio handling moved into it, and
      // the call here was left without one -- so every run of this script ended with
      // "image.toPNG is not a function" and a non-zero exit, after the Help images had
      // stopped being written at all. (No backticks in this comment: this whole runner
      // is a template literal, and one would end it here.)
      const image = await cropToScene(win, await win.webContents.capturePage(), rect);
      const png = image.toPNG();
      if (png.length < 12000) {
        console.log("SCENE BLANK help-" + theme + ": only " + png.length + " bytes");
        continue;
      }
      fs.writeFileSync(path.join(${JSON.stringify(OUT)}, "help-" + theme + ".png"), png);
      console.log("wrote help-" + theme + ".png  " + image.getSize().width + "x" + image.getSize().height + "  " + Math.round(png.length / 1024) + " KB");
    }
  }

  app.exit(0);
});
`
);

// The runner is generated from a template literal, so a stray backtick anywhere in
// it -- even inside a comment -- silently ends the template and produces a syntax
// error that points at the wrong line. Check the file that was actually written.
execFileSync(process.execPath, ["--check", runner], { stdio: "pipe" });

fs.mkdirSync(OUT, { recursive: true });
console.log("rendering…");
// The Electron on this machine, by the name it is installed under rather than
// through npx, which would try to fetch one.
try {
  execFileSync(process.env.ELECTRON_BIN ?? "electron43", [runner], { cwd: ROOT, stdio: "inherit" });
} catch (err) {
  console.error("the renderer failed; its output is above");
  process.exitCode = 1;
  throw err;
}
fs.rmSync(TMP, { recursive: true, force: true });
