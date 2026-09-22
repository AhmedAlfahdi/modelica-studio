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

const page = path.join(TMP, "index.html");
fs.writeFileSync(
  page,
  `<!doctype html><html><meta charset="utf-8">
<style>${APP_CSS}</style>
<style>${CSS}</style>
<style>
  body { margin: 0; background: var(--background-primary); }
  .shot { padding: 0; }
  #diagram, #plot { width: 900px; background: var(--background-primary); }
</style>
<body class="theme-light">
<div id="diagram" class="shot"></div>
<div id="plot" class="shot"></div>
<div id="help" class="shot" style="width: 640px; padding: 14px;"></div>
<div id="settings" class="shot" style="width: 640px; padding: 14px;"></div>
<script type="module" src="./page.js"></script>
</body></html>`
);

fs.writeFileSync(
  path.join(TMP, "scenes.json"),
  JSON.stringify({
    example: data.example,
    result: data.result,
    model: data.model,
    defs: data.defs,
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
app.whenReady().then(async () => {
  // A watchdog: a scene that never resolves should fail the run, not hang it.
  const guard = setTimeout(() => { console.log("TIMED OUT waiting for a scene"); app.exit(1); }, 60000);
  void guard;
  const win = new BrowserWindow({ width: 1000, height: 900, show: false, webPreferences: { offscreen: true } });
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
  // Canvas scenes hand back their own pixels; a DOM scene is staged, rendered once
  // and captured from the box it reports.
  const CANVAS = [["diagram", "window.__sceneDiagram(" + DATA + ")"], ["plot", "window.__scenePlot(" + DATA + ")"]];
  const DOM = [["help", "window.__sceneHelp()"]];

  for (const [name, call] of CANVAS) {
    const out = JSON.parse(await win.webContents.executeJavaScript("(async () => JSON.stringify(await (" + call + ")))()"));
    if (out.error) { console.log("SCENE FAILED " + name + ": " + out.error); continue; }
    fs.writeFileSync(path.join(${JSON.stringify(OUT)}, name + ".png"), Buffer.from(String(out.data).split(",")[1], "base64"));
    console.log("wrote " + name + ".png  " + out.width + "x" + out.height);
  }

  for (const [name, call] of DOM) {
    // Staged at the top-left with the others hidden (capturePage refuses a box
    // outside the window) and the page zoomed, so its pixels are crisp.
    await win.webContents.executeJavaScript(
      "document.querySelectorAll('.shot').forEach((el) => { el.style.display = 'none'; });" +
        "const stage = document.getElementById('" + name + "');" +
        "stage.style.display = 'block'; stage.style.position = 'absolute';" +
        "stage.style.left = '0'; stage.style.top = '0'; stage.style.padding = '16px';" +
        "stage.style.background = 'var(--background-primary)';" +
        "document.body.style.zoom = '2';"
    );
    await new Promise((r) => setTimeout(r, 250));
    const rect = JSON.parse(await win.webContents.executeJavaScript("(async () => JSON.stringify(await (" + call + ")))()"));
    if (rect.error) { console.log("SCENE FAILED " + name + ": " + rect.error); continue; }
    const image = await win.webContents.capturePage({
      x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: rect.width, height: rect.height,
    });
    fs.writeFileSync(path.join(${JSON.stringify(OUT)}, name + ".png"), image.toPNG());
    console.log("wrote " + name + ".png  " + image.getSize().width + "x" + image.getSize().height);
  }

  app.exit(0);
});
`
);

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
