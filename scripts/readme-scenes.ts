/**
 * The page side of the README images.
 *
 * Each scene renders a real component — the editor, the embed's plot, the Help
 * window, the settings rows — into the page and reports the box to capture. The only
 * thing supplied is data: the class definitions the Node side resolved, the model,
 * and the result OpenModelica returned. Nothing here is a mock-up of the UI.
 */

import { SchematicEditor } from "../src/view/editor";
import { drawPlot, plotThemeFrom } from "../src/view/plot";
import { currentTheme } from "../src/render/theme";
import { HelpModal } from "../src/view/help-modal";

/** Everything the Node side resolved, handed over as data. */
interface SceneData {
  example: { name: string; description: string; stopTime: number; series: string[] };
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

const canvasShot = (host: HTMLElement, canvas: HTMLCanvasElement) => ({
  data: canvas.toDataURL("image/png"),
  width: canvas.width,
  height: canvas.height,
  cssWidth: host.clientWidth,
});

/** The diagram, drawn by the editor with the library's own icons. */
window.__sceneDiagram = (data) => {
  try {
    const host = document.getElementById("diagram")!;
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
    const visible = ["mass1.s", "mass2.s"];
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


