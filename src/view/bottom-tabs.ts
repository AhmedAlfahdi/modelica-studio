/**
 * The results tab strip, as a state machine.
 *
 * Reported as "the link logic takes me in circular logic", and the cause was that
 * clicking a tab could switch the editor MODE without updating which tab is
 * active. Source switches to code mode; code mode hides the Source tab. Clicking
 * it therefore left the strip with nothing selected, and the obvious way back —
 * click Source again — was the tab that had just disappeared.
 *
 * That is a state machine with three states and a coupling to a second one, which
 * is small enough to check exhaustively rather than reason about. Extracted from
 * the view for exactly that reason.
 */

/** The tabs the results pane can show. */
export type ResultsTab = "plot" | "source" | "log";

/** The editor modes those tabs interact with. */
export type EditorMode = "diagram" | "code";

export interface ResultsTabState {
  /** The mode after the click. */
  mode: EditorMode;
  /** The tab that is active after the click. */
  tab: ResultsTab;
  /** The tabs that are actually in the strip after the click. */
  visibleTabs: ResultsTab[];
}

/**
 * What clicking a tab does.
 *
 * The rule the bug was missing: **the active tab must always be one that exists**.
 * `source` is not a third view of the results — it is a shortcut into code mode —
 * so clicking it changes the mode and leaves the active tab somewhere visible
 * rather than on itself.
 */
export function resultsTabState(
  mode: EditorMode,
  current: ResultsTab,
  clicked: ResultsTab
): ResultsTabState {
  // Source is available only where switching to code is meaningful. In code mode
  // the source is already on screen, so the tab is removed rather than left as a
  // no-op that appears to do nothing.
  const visibleTabs: ResultsTab[] =
    mode === "code" ? ["plot", "log"] : ["plot", "source", "log"];

  if (clicked === "source" && mode === "diagram") {
    // A shortcut, not a view: the mode changes AND the active tab moves to one
    // that survives the change. Leaving it on `source` is what stranded the strip.
    return { mode: "code", tab: "plot", visibleTabs: ["plot", "log"] };
  }

  // The invariant, applied on every call rather than only on the click: the active
  // tab must be one that exists. The exhaustive test found a second way to strand
  // the strip that a click-only fix would have missed -- the mode can change
  // without a tab being clicked at all, leaving `source` active in code mode.
  // Falling back to the first visible tab is what makes that impossible.
  if (!visibleTabs.includes(clicked)) {
    const next = visibleTabs.includes(current) ? current : visibleTabs[0];
    return { mode, tab: next, visibleTabs };
  }
  return { mode, tab: clicked, visibleTabs };
}

/** The tabs to draw for a mode, in order. */
export function tabsForMode(mode: EditorMode): ResultsTab[] {
  return mode === "code" ? ["plot", "log"] : ["plot", "source", "log"];
}

/** The label a tab shows. Source is named for what it does, not where it goes. */
export function tabLabel(tab: ResultsTab): string {
  return tab === "plot" ? "Plot" : tab === "source" ? "Source" : "Run log";
}
