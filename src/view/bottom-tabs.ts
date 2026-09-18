/**
 * The results tab strip.
 *
 * Two tabs, both always present: the plot and the run log. There was a third,
 * `source`, which was not a view of the results at all — it was a shortcut into
 * code mode, and since the toolbar already has a Code tab it read as a second,
 * duplicate way to do the same thing. It is gone.
 *
 * Removing it also removed the strip's dependence on the editor mode. The mode was
 * consulted for exactly one reason: to hide the source tab in code mode, where it
 * would have been a no-op. With that gone the visible tabs are a constant, so what
 * remains here is the guard that the active tab is one that exists.
 */

/** The tabs the results pane can show. */
export type ResultsTab = "plot" | "log";

/** Every tab, in the order they are drawn. */
export const RESULTS_TABS: ResultsTab[] = ["plot", "log"];

/**
 * The tab that is active after one is clicked.
 *
 * Idempotent, and never returns a tab outside `RESULTS_TABS`: an unknown id leaves
 * the strip as it was rather than selecting something that is not there. That
 * guard is the whole function now — it used to be a state machine coupled to the
 * editor mode, and the fault it was written for was a strip that could end up with
 * nothing selected and no way back.
 */
export function resultsTabState(current: ResultsTab, clicked: ResultsTab): ResultsTab {
  return RESULTS_TABS.includes(clicked) ? clicked : current;
}

/** The label a tab shows. */
export function tabLabel(tab: ResultsTab): string {
  return tab === "plot" ? "Plot" : "Run log";
}
