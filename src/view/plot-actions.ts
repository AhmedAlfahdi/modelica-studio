/**
 * The results bar: the row of controls above the plot.
 *
 * Its own module because it is the surface that keeps being reported wrong — the
 * legend, the deltas, the scale panel, the divider that borrowed the pane grip's
 * class, the dropdown that lost its arrow, two fields drawn by two different
 * stylesheets. Every one of those was diagnosed from a screenshot, because no
 * test could build the row: it was 140 lines of closures inside a 4,400-line
 * view, and nothing could mount that.
 *
 * So it takes a host instead of closing over one. `test/plot-actions.test.mjs`
 * renders this into a real DOM with the real `styles.css` and asserts what the
 * browser computes — which field wins the cascade, whether the arrow is drawn,
 * what a menu holds, what a click does.
 */

import { Menu, setIcon } from "obsidian";
import { noLabelTooltip } from "./a11y";

/**
 * Everything the bar needs to ask or tell the view.
 *
 * Deliberately narrow: each member is one thing the row does, so a test can
 * supply them as plain functions and read back what was called.
 */
export interface PlotActionHost {
  /** The span shown in the field. */
  stopTime(): number;
  /** Record a new span for this model and run again — what changing it means. */
  applyStopTime(seconds: number): void;
  /** Whether there is a result; the groups below exist only when there is. */
  hasResult(): boolean;
  /** The parameters that can actually be swept, in the model's own order. */
  sweepParameters(): string[];
  /** The last sweep asked for, so the fields survive a re-render. */
  sweepField(): { parameter: string; values: string };
  setSweepField(field: { parameter: string; values: string }): void;
  /** How many runs are being compared with the one on screen. */
  familyCount(): number;
  /** Whether the cursor readout shows differences. */
  deltasOn(): boolean;
  toggleScalePanel(): void;
  openFullScreen(): void;
  autoScale(): void;
  toggleDeltas(): void;
  runSweep(parameter: string, values: string): void;
  keepAsBefore(): void;
  copyFigure(): void;
  saveFigure(): void;
  clearFamily(): void;
}

/** A button in the row. `cls` extras are appended to the shared button class. */
function button(parent: HTMLElement, text: string, cls = ""): HTMLButtonElement {
  return parent.createEl("button", {
    cls: `modelica-studio-btn${cls ? " " + cls : ""}`,
    text,
  });
}

/**
 * Build the actions row, replacing whatever was in `parent`.
 *
 * The three groups are three subjects: how the plot is scaled, what is being
 * compared, and getting a picture out. The sweep controls are what this row is
 * mostly FOR, so `Sweep` is the one accented button in it.
 */
export function buildPlotActions(parent: HTMLElement, host: PlotActionHost): void {
  parent.empty();

  // Simulation time lives here rather than in the settings tab: it is part of
  // asking the question, not of configuring the plugin, and changing it means
  // running again — which is what this row is for.
  const time = parent.createDiv({ cls: "modelica-studio-time" });
  time.createSpan({ cls: "modelica-studio-muted", text: "t_end" });
  const endInput = time.createEl("input", {
    type: "number",
    cls: "modelica-studio-time-input",
    attr: { step: "any", min: "0", "aria-label": "Simulation stop time in seconds" },
  });
  endInput.value = String(host.stopTime());
  const apply = () => {
    const v = Number(endInput.value);
    if (!Number.isFinite(v) || v <= 0) {
      endInput.value = String(host.stopTime());
      return;
    }
    host.applyStopTime(v);
  };
  endInput.addEventListener("change", apply);
  endInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      apply();
    }
  });
  time.createSpan({ cls: "modelica-studio-muted", text: "s" });

  if (!host.hasResult()) return;

  // How the plot is scaled. One subject, so one box with shared edges: as three
  // separate buttons they read as three unrelated actions.
  // Deliberately unnamed. Obsidian's handler is delegated on `[aria-label]`, so a
  // named container pops its own label up whenever the pointer crosses anything
  // inside it -- and the flag that switches that off is read from the COMPUTED
  // style, so it silences every tooltip in the subtree as well. A name on a plain
  // div is not exposed by screen readers anyway; the buttons inside say what they
  // are. (Verified in the app bundle: `getComputedStyle(e).getPropertyValue(
  // "--no-tooltip")`.)
  const scale = parent.createDiv({ cls: "modelica-studio-group is-segmented" });
  button(scale, "Scale").addEventListener("click", () => host.toggleScalePanel());
  button(scale, "Full screen").addEventListener("click", () => host.openFullScreen());
  button(scale, "Auto scale").addEventListener("click", () => host.autoScale());

  // What is being compared. The family fields and the delta toggle belong to the
  // same question — what happens when a number changes — so the toggle is inside
  // this box rather than floating between the groups, where a wrap left it
  // stranded at the end of a line with nothing to say which box it belonged to.
  // Unnamed for the same reason as the scale group: the controls inside carry
  // their own names, and a name here would raise a tooltip over the open list.
  const family = parent.createDiv({ cls: "modelica-studio-group modelica-studio-family" });
  const field = host.sweepField();
  const names = host.sweepParameters();

  // The theme's own `dropdown` class is worn for its arrow: app.css sets
  // `appearance: none` on every `select` and draws the chevron as a background
  // image on `.dropdown` alone, so a bare select is a box with no sign that it
  // opens. Only its padding is answered for here, in the stylesheet.
  const param = family.createEl("select", { cls: "modelica-studio-family-param dropdown" });
  // Silenced, but still named for a screen reader: what this opens is a native
  // popup, drawn above everything in the page, so a tooltip for it was reported
  // as a box peeking out from behind the open list. It has no children, so the
  // inherited flag costs nothing else.
  noLabelTooltip(param, "Parameter to sweep");
  for (const n of names.length ? names : ["—"]) param.createEl("option", { text: n, value: n });
  param.disabled = names.length === 0;
  // Restored from the last sweep, because this row is rebuilt after every run: a
  // field that empties itself loses the only record of what was asked for, which
  // is what you want to look at WHILE reading the curves.
  if (names.includes(field.parameter)) param.value = field.parameter;
  else if (names.length) host.setSweepField({ ...field, parameter: names[0] });
  param.addEventListener("change", () => host.setSweepField({ ...host.sweepField(), parameter: param.value }));

  const values = family.createEl("input", {
    type: "text",
    cls: "modelica-studio-family-values",
    attr: {
      placeholder: "100, 200, 400",
      // A tooltip, not just a name: this is where the form of the answer is
      // explained, including the step form and how many values a sweep needs.
      "aria-label": "Values to sweep over — two or more, e.g. 100, 200, 400 or 0:0.5:2",
    },
  });
  values.value = field.values;
  values.addEventListener("input", () => host.setSweepField({ ...host.sweepField(), values: values.value }));

  const sweep = button(family, "Sweep", "mod-cta");
  sweep.setAttribute(
    "aria-label",
    "Run once for each value and draw them together — a sweep needs at least two values"
  );
  sweep.addEventListener("click", () => host.runSweep(param.value, values.value));

  const keep = button(family, "Keep as before");
  keep.setAttribute("aria-label", "Draw this run dashed behind the next one");
  keep.addEventListener("click", () => host.keepAsBefore());

  // A toggle has to LOOK toggled: the delta button did its work invisibly, which
  // read as a button that does nothing. It is filled rather than ringed — a
  // coloured ring on a two-letter button was the loudest thing in the row, beside
  // the button that actually runs the sweep.
  const hasFamily = host.familyCount() > 0;
  const on = host.deltasOn();
  const deltas = button(family, "Δ vs", `${on ? "is-active" : ""}${hasFamily ? "" : " is-idle"}`.trim());
  deltas.setAttribute("aria-pressed", on ? "true" : "false");
  deltas.setAttribute(
    "aria-label",
    hasFamily
      ? "Show how far each swept curve is from the run on screen, at the cursor"
      : "Differences are shown when there is a family to compare with — sweep a parameter, or Keep as before"
  );
  deltas.addEventListener("click", () => host.toggleDeltas());

  if (hasFamily) {
    button(family, "Clear family").addEventListener("click", () => host.clearFamily());
  }

  // Getting a picture out is what you do AFTER reading the plot, so this is the
  // quietest control in the row — and it is one menu rather than two buttons,
  // because every control here is plot height in a pane that is short.
  //
  // Not in a box of its own: a lone icon button does not need one, and the box
  // was what pushed it onto a line by itself in a narrow pane.
  const more = parent.createEl("button", { cls: "modelica-studio-btn is-quiet" });
  setIcon(more, "more-horizontal");
  more.setAttribute("aria-label", "Copy or save the plot as a picture");
  more.addEventListener("click", (ev) => {
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle("Copy image").setIcon("clipboard-copy").onClick(() => host.copyFigure())
    );
    menu.addItem((item) =>
      item.setTitle("Save image…").setIcon("save").onClick(() => host.saveFigure())
    );
    // Anchored to the button, so the menu appears where it was asked for.
    menu.showAtMouseEvent(ev);
  });
}
