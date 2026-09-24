/**
 * The page side of the README images.
 *
 * Each scene renders a real component — the editor, the embed's plot, the Help
 * window, the settings rows — into the page and reports the box to capture. The only
 * thing supplied is data: the class definitions the Node side resolved, the model,
 * and the result OpenModelica returned. Nothing here is a mock-up of the UI.
 */

import { SchematicEditor } from "../src/view/editor";
import { drawPlot, plotThemeFrom, seriesColor } from "../src/view/plot";
import { currentTheme } from "../src/render/theme";
import { HelpModal } from "../src/view/help-modal";
import { EmbeddedDiagram } from "../src/view/embed";
import { overlayResults } from "../src/view/family";
import { DEFAULT_SETTINGS } from "../src/settings-merge";

/** Everything the Node side resolved, handed over as data. */
interface SceneData {
  example: { name: string; description: string; stopTime: number; series: string[] };
  family: Array<{ label: string; result: SceneData["result"] }>;
  currentLabel: string;
  result: {
    time: number[];
    series: { name: string; values: number[]; unit?: string }[];
    compileMs: number;
    simulateMs: number;
    reusedBinary: boolean;
    warnings: string[];
  };
  model: Parameters<typeof SchematicEditor>[1];
  defs: Record<string, Parameters<ConstructorParameters<typeof SchematicEditor>[2]["lookup"]>[0]>;
}

declare global {
  interface Window {
    __sceneDiagram: (data: SceneData) => unknown;
    __scenePlot: (data: SceneData) => unknown;
    __sceneEmbed: (data: SceneData) => unknown;
    __sceneEmbedPlot: (data: SceneData) => unknown;
    __sceneHover: (data: SceneData) => unknown;
    __sceneSweep: (data: SceneData) => unknown;
    __sceneHelp: () => unknown;
    __SCENES__: SceneData;
  }
}

// 2x, so the images are crisp on the screens a README is read on. The editor reads
// this to size its backing store, and Electron's capturePage follows it, so both the
// canvas scenes and the DOM ones come out at twice the CSS size.
Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });

const box = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return { x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(r.width), height: Math.ceil(r.height) };
};
const fail = (err: unknown) => ({ error: String(err instanceof Error ? err.message : err) });

/**
 * Crop a canvas to the ink it holds, with a margin.
 *
 * A diagram is wider than it is tall and the pane it is drawn in is not, so fitting the
 * view left a band of empty grid above and below the model — the picture was correct
 * and looked unfinished. Cropping to what was actually drawn frames it, and the axe
 * labels and legends come along because they are ink too.
 */
function cropToInk(canvas: HTMLCanvasElement, pad = 40) {
  const ctx = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  const bg = [data[0], data[1], data[2]];
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      // 60, not 10: the canvas is covered in a faint grid, and a threshold that low
      // counted every gridline as content and cropped nothing at all.
      if (Math.abs(data[o] - bg[0]) + Math.abs(data[o + 1] - bg[1]) + Math.abs(data[o + 2] - bg[2]) < 60) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { canvas, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight };
  const box = {
    x: Math.max(0, minX - pad),
    y: Math.max(0, minY - pad),
    width: Math.min(w - Math.max(0, minX - pad), maxX - minX + 1 + 2 * pad),
    height: Math.min(h - Math.max(0, minY - pad), maxY - minY + 1 + 2 * pad),
  };
  const out = document.createElement("canvas");
  out.width = box.width;
  out.height = box.height;
  const octx = out.getContext("2d")!;
  octx.fillStyle = getComputedStyle(document.body).backgroundColor;
  octx.fillRect(0, 0, out.width, out.height);
  octx.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  return { canvas: out, cssWidth: out.width, cssHeight: out.height };
}

const canvasShot = (host: HTMLElement, canvas: HTMLCanvasElement) => {
  const cropped = cropToInk(canvas);
  void host;
  return {
    data: cropped.canvas.toDataURL("image/png"),
    width: cropped.canvas.width,
    height: cropped.canvas.height,
    cssWidth: cropped.cssWidth,
  };
};

/** The diagram, drawn by the editor with the library's own icons. */
window.__sceneDiagram = (data) => {
  try {
    const host = document.getElementById("diagram")!;
    // Cleared first: the same scene is rendered twice, once per theme.
    host.textContent = "";
    host.style.height = "340px";
    const editor = new SchematicEditor(host, data.model, {
      lookup: (n) => data.defs[n],
      onChange: () => {},
      onSelectionChange: () => {},
      onStatus: () => {},
      display: () => ({ labelScale: 1, hoverParameters: false }),
    } as never);
    editor.resize();
    editor.zoomToFit();
    // Back off before cropping: a fit that fills the pane leaves the outer wire stubs
    // exactly on the edge, and cropping then clips them.
    editor.viewport.scale *= 0.9;
    editor.draw();
    return canvasShot(host, editor.canvasEl);
  } catch (err) {
    return fail(err);
  }
};

/**
 * The result, plotted.
 *
 * The same renderer the studio and an embedded block use, with the traces the
 * example names switched on and the rest off — the configuration a note opens with.
 */
window.__scenePlot = (data) => {
  try {
    const host = document.getElementById("plot")!;
    host.textContent = "";
    host.style.height = "360px";
    const canvas = document.createElement("canvas");
    const width = host.clientWidth || 900;
    const height = 320;
    // The plot draws itself at the device ratio, as the pane does.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    host.appendChild(canvas);
    const ctx = canvas.getContext("2d")!;
    const styles: Record<string, { color: string; visible: boolean }> = {};
    const colours = ["#c0392b", "#2980b9", "#27ae60", "#8e44ad"];
    // The two POSITIONS rather than the example's default position-and-velocity: the
    // point of this model is that the pair drifts while the gap between them settles,
    // and that is only visible with both masses on the plot.
    const visible = ["mass1.s", "coupling.s_rel"];
    data.result.series.forEach((s, i) => {
      styles[s.name] = { color: colours[i % colours.length], visible: visible.includes(s.name) };
    });
    drawPlot(ctx, width, height, data.result as never, {
      styles,
      view: { xMin: 0, xMax: data.example.stopTime },
      dpr,
      // `plotThemeFrom` takes a theme object, not a flag: passing `true` fell through
      // to the default and drew a light plot under a dark page.
      theme: plotThemeFrom(currentTheme()),
      readoutScale: 1,
      snapIntersections: true,
      snapTolerancePx: 7,
      cursorX: width * 0.42,
      currentLabel: data.example.name,
    } as never);
    return canvasShot(host, canvas);
  } catch (err) {
    return fail(err);
  }
};

/**
 * The Help window's connection section, as markup for its own page.
 *
 * Returns HTML rather than a box, and the runner renders it in a page of its own.
 * Extracting the panel inside the app page does not work: Obsidian's modal CSS and
 * the tab strip keep an inactive panel unpainted even with its `display` forced, so
 * the capture came out blank twice — 3 KB of nothing, which is how a blank image
 * reached the README once before a size check caught it.
 */
window.__sceneHelp = () => {
  try {
    const modal = new HelpModal(
      { vault: {}, workspace: { getLeavesOfType: () => [] } } as never,
      {
        manifest: { id: "modelica-studio", version: "0.3.4", author: "Ahmed N. Alfahdi" },
        settings: { modelFolder: "Modelica", modelFiles: {} },
        library: { size: 6127, allNames: () => [], packages: () => [] },
        libraryRootNames: () => ["Modelica 4.1.0"],
        saveSettings: async () => {},
        getView: () => null,
      } as never
    );
    modal.open();
    const panel = Array.from(modal.contentEl.querySelectorAll(".modelica-studio-help-panel")).find((p) =>
      p.textContent?.includes("How a connection is drawn")
    ) as HTMLElement | undefined;
    if (!panel) throw new Error("the connection panel was not rendered");
    panel.classList.remove("is-hidden");
    panel.style.display = "block";
    return { html: panel.outerHTML };
  } catch (err) {
    return fail(err);
  }
};



/**
 * The plugin's settings, as a fresh installation has them.
 *
 * Spread rather than listed: a scene that hand-writes the settings object goes stale
 * the moment a setting is added, and the failure is an exception in a section the
 * image does not even show (which is how the first settings screenshot died).
 */
const settings = () => JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as never;

/** A backend that returns a result the Node side already computed. */
const stubBackend = (result: unknown) =>
  ({
    simulate: async () => result,
    info: { available: true, label: "omc", detail: "OpenModelica 1.27.0" },
  }) as never;

/**
 * A block in a note, in its two modes.
 *
 * The real `EmbeddedDiagram`: its own toolbar, its own diagram, its own plot. The
 * simulation is the one the Node side ran — the page cannot spawn a compiler — so the
 * numbers are real and only the spawning is stubbed.
 */
async function embedScene(host: HTMLElement, data: SceneData, showPlot: boolean) {
  // `result` in the block's directive is what opens a note on the plot; that is also
  // what the README tells a reader to write, so the picture shows the real route.
  const source = showPlot ? `//@ time=${data.example.stopTime} result\n${data.example.source}` : data.example.source;
  host.textContent = "";
  // What the reader last chose wins over the directive (so a note does not reopen the
  // plot on every re-render), and the first scene here chose the diagram. Clear the
  // remembered choice so the second block starts where its directive says.
  try {
    localStorage.clear();
  } catch {
    /* no storage in this page */
  }
  // No fixed height: the block sizes its own canvas, and pinning the host clipped the
  // bottom of the diagram out of the screenshot.
  host.style.height = "";
  host.style.width = "820px";
  const embedded = new EmbeddedDiagram(
    {
      app: {} as never,
      library: { component: (n: string) => data.defs[n] as never },
      backend: stubBackend(data.result),
      settings: settings(),
      stopTimeFor: () => data.example.stopTime,
      showSetupHelp: () => {},
      // The embed reports what it cannot do instead of throwing; without a sink its
      // reasons vanish and the screenshot is simply blank.
      report: (message: string) => console.log("EMBED " + message),
    } as never,
    host,
    source,
    // `autoSimulate` true is what a block in a note does: it runs when the note opens.
    // With it false there is no result, so the plot pane has nothing to draw and the
    // block stays as tall as its toolbar.
    { showPlot, height: showPlot ? 300 : 280, autoSimulate: true, stopTime: data.example.stopTime },
    () => {}
  );
  // `mount()` is what builds the DOM and loads the model; the constructor only reads
  // the block's directive.
  embedded.mount();
  // The embed renders on its own schedule — it measures its container and draws from
  // there — so the scene waits for the element to have content rather than guessing a
  // delay and capturing an empty box.
  // Wait for a canvas that has actually been SIZED: `mount()` builds the toolbar
  // synchronously, and the diagram inside it is sized by a resize observer on a later
  // frame. Waiting for children alone captured the toolbar over an empty box.
  const waitFor = async (ready: () => boolean, ticks = 60) => {
    for (let i = 0; i < ticks; i++) {
      if (ready()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };

  // A block simulates when the note opens, and reveals the plot when the run finishes —
  // both the plugin's intended behaviour, and the reason a block that auto-simulates
  // cannot be photographed on its diagram without a click. One click back is the state
  // a reader is actually in when they go looking at the structure after seeing the
  // result, and the run's statistics stay in the toolbar.
  // Which pane is open is not just this block's `showPlot`: the reader's last choice is
  // remembered per model (so a note does not reopen the plot on every re-render), and
  // in this page that memory outlives the directive. Because the block also reveals the
  // plot by itself when a run finishes, whichever pane is wanted is settled by clicking
  // until the label has stopped changing for a few checks.
  await waitFor(() => /\d+\s*samples/.test(host.textContent ?? ""));
  // The label says what a click WILL DO, so the wanted pane is the one whose label
  // offers the OTHER: "Switch to diagram" means the plot is showing.
  const wanted = showPlot ? /switch to diagram/i : /switch to plot/i;
  const toggle = () => Array.from(host.querySelectorAll("button")).find((b) => /switch to/i.test(b.textContent ?? ""));
  let settled = 0;
  for (let i = 0; i < 60 && settled < 3; i++) {
    if (!wanted.test(toggle()?.textContent ?? "")) {
      toggle()?.click();
      settled = 0;
    } else {
      settled++;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const canvases = () => Array.from(host.querySelectorAll("canvas")).filter((c) => c.width > 2 && c.height > 2);
  for (let i = 0; i < 60; i++) {
    if (canvases().length >= (showPlot ? 2 : 1)) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise((r) => setTimeout(r, 250));
  return { ...box(host), children: host.children.length, text: (host.textContent ?? "").slice(0, 60) };
}

window.__sceneEmbed = async (data) => {
  try {
    return await embedScene(document.getElementById("embed")!, data, false);
  } catch (err) {
    return fail(err);
  }
};

window.__sceneEmbedPlot = async (data) => {
  try {
    return await embedScene(document.getElementById("embedPlot")!, data, true);
  } catch (err) {
    return fail(err);
  }
};

/**
 * The parameter popup, over a component on the canvas.
 *
 * Driven by a real `pointermove` at the component's own screen position rather than
 * by setting the editor's internals, so the picture is the one a pointer produces.
 */
window.__sceneHover = (data) => {
  try {
    const host = document.getElementById("hover")!;
    host.textContent = "";
    host.style.height = "340px";
    const editor = new SchematicEditor(host, data.model, {
      lookup: (n) => data.defs[n],
      onChange: () => {},
      onSelectionChange: () => {},
      onStatus: () => {},
      display: () => ({ labelScale: 1, hoverParameters: true }),
    } as never);
    editor.resize();
    editor.zoomToFit();
    editor.viewport.scale *= 0.9;
    editor.draw();

    // The component to rest on, at the middle of its own box, mapped through the
    // canvas's transform — the same mapping `toDiagram` inverts.
    const target = data.model.components.find((c) => c.className.includes("SpringDamper")) ?? data.model.components[0];
    const [x1, y1, x2, y2] = target.placement.extent;
    const t = editor.sceneTransform();
    const px = ((x1 + x2) / 2) * t.scale + t.x;
    const py = ((y1 + y2) / 2) * t.yScale + t.y;
    const rect = editor.canvasEl.getBoundingClientRect();
    const at = { clientX: rect.left + px, clientY: rect.top + py, bubbles: true };
    editor.canvasEl.dispatchEvent(new PointerEvent("pointerenter", at));
    editor.canvasEl.dispatchEvent(new PointerEvent("pointermove", at));
    editor.draw();
    return canvasShot(host, editor.canvasEl);
  } catch (err) {
    return fail(err);
  }
};

/**
 * A sweep: the same model over three values of one parameter, the run on screen
 * solid and the others dashed, with each one's distance from it at the cursor.
 */
window.__sceneSweep = (data) => {
  try {
    const host = document.getElementById("sweep")!;
    host.textContent = "";
    host.style.height = "320px";
    const canvas = document.createElement("canvas");
    const width = host.clientWidth || 900;
    const height = 320;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    host.appendChild(canvas);

    const { result, familyNames } = overlayResults(data.result, data.family.filter((f) => f.label !== data.currentLabel), data.currentLabel);
    const styles: Record<string, { color: string; visible: boolean; dashed?: boolean }> = {};
    const wanted = ["mass1.s", "mass2.s"];
    result.series.forEach((s, i) => {
      const base = s.name.split(" · ")[0];
      styles[s.name] = {
        color: seriesColor(wanted.indexOf(base) >= 0 ? wanted.indexOf(base) : i),
        visible: wanted.includes(base),
        dashed: familyNames.has(s.name),
      };
    });
    drawPlot(canvas.getContext("2d")!, width, height, result as never, {
      styles,
      view: { xMin: 0, xMax: data.example.stopTime },
      dpr,
      theme: plotThemeFrom(currentTheme()),
      readoutScale: 1,
      showDeltas: true,
      currentLabel: data.currentLabel,
      cursorX: width * 0.62,
    } as never);
    return canvasShot(host, canvas);
  } catch (err) {
    return fail(err);
  }
};
