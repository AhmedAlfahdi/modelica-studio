/**
 * A measurement of how the two forms actually perform.
 *
 * The claim that a diagram is less reliable than equations was reasoned from
 * mechanism -- more components, more connections, more places for one mistake to
 * fail the whole compile -- and never measured. That is not a good enough basis
 * for choosing the default, so this runs the same prompts through both styles and
 * counts.
 *
 * It reports FACTS, not a score: whether the model compiled, how many attempts it
 * took, whether the approach had to fall back, and whether the result is a real
 * diagram. The judgement about which style to prefer belongs to whoever reads the
 * table.
 */

import type { SimulationBackend } from "../omc/backend";
import type { AiConfig, ChatMessage } from "./prompts";
import { generateModel, type GenerationOutcome } from "./generate";

export interface BenchPrompt {
  /** Short label for the table. */
  id: string;
  /** What a person would type. */
  prompt: string;
  /** Which family it belongs to, for grouping the results. */
  domain: string;
}

export interface BenchResult {
  id: string;
  domain: string;
  style: string;
  /** True when the run produced a model that compiled AND passed the checks. */
  ok: boolean;
  /** Why it stopped. */
  reason: string;
  /** How many model calls it took. */
  attempts: number;
  /** True when the style had to be abandoned for the other one. */
  fellBack: boolean;
  /** True when the final source is a wired diagram rather than equations. */
  isDiagram: boolean;
  /** Components declared, and how many are wired. */
  components: number;
  wired: number;
  seconds: number;
  /** One line about the failure, for the table. */
  note: string;
}

/**
 * The prompts to measure.
 *
 * Chosen to span the two families the discussion turned on: domains whose
 * components have few pins and obvious wiring, and domains whose components carry
 * requirements that a class list cannot convey -- a fluid model needs an inner
 * System and a Medium, a multibody model needs an inner World, and neither is
 * visible from the list of class names.
 */
export const BENCH_PROMPTS: BenchPrompt[] = [
  // Robust: two-pin components, wiring is unambiguous.
  { id: "divider", domain: "electrical", prompt: "a resistor divider across a 12 V supply, two equal resistors" },
  { id: "rc", domain: "electrical", prompt: "an RC circuit charging from 5 V through a 1 kOhm resistor into a 1 uF capacitor" },
  { id: "spring", domain: "mechanical", prompt: "a 2 kg mass on a spring of stiffness 200 N/m with a damper of 5 Ns/m" },
  { id: "heating", domain: "thermal", prompt: "a thermal capacitance heated by a constant power source and losing heat to ambient" },
  // Fragile: the requirements are not in the class list.
  { id: "tank", domain: "fluid", prompt: "a water tank draining through a pipe into a lower reservoir" },
  { id: "valve", domain: "fluid", prompt: "water flowing from a source through a valve into a tank" },
  { id: "pendulum", domain: "multibody", prompt: "a pendulum with a 1 kg bob half a metre from a revolute joint" },
  { id: "control", domain: "control", prompt: "a PID controller regulating a first order plant to a setpoint of 1" },
];

export interface BenchOptions {
  config: AiConfig;
  backend: SimulationBackend;
  /** The installation brief, built once and reused. */
  environment: string;
  getKey: () => string | null;
  /** Build the conversation for one attempt, exactly as the studio does. */
  buildMessages: (
    prompt: string,
    current: string | undefined,
    failure: string,
    style: "visual" | "equations"
  ) => ChatMessage[];
  /** Send a conversation to the provider. */
  send: (messages: ChatMessage[]) => Promise<string>;
  settings: {
    startTime: number;
    stopTime: number;
    numberOfIntervals: number;
    tolerance: number;
    solver: string;
  };
  prompts?: BenchPrompt[];
  styles?: Array<"visual" | "equations">;
  /** Progress, so a long run can be watched. */
  onProgress?: (line: string) => void;
  isCancelled?: () => boolean;
}

/**
 * Run every prompt through every style.
 *
 * Serial rather than parallel: the point is to measure each run under the same
 * conditions, and concurrent requests to one provider can be rate limited, which
 * would show up as a failure the style did not cause.
 */
export async function runBenchmark(opts: BenchOptions): Promise<BenchResult[]> {
  const prompts = opts.prompts ?? BENCH_PROMPTS;
  const styles = opts.styles ?? (["visual", "equations"] as const);
  const results: BenchResult[] = [];

  for (const item of prompts) {
    for (const style of styles) {
      if (opts.isCancelled?.()) return results;
      opts.onProgress?.(`${item.id} / ${style} — asking…`);
      const started = Date.now();

      let outcome: GenerationOutcome | null = null;
      let note = "";
      try {
        outcome = await generateModel({
          prompt: item.prompt,
          environment: opts.environment,
          getKey: opts.getKey,
          config: { ...opts.config, style },
          backend: opts.backend,
          settings: opts.settings,
          send: opts.send,
          buildMessages: opts.buildMessages as never,
        });
      } catch (err) {
        note = (err instanceof Error ? err.message : String(err)).slice(0, 120);
      }

      const source = outcome?.source ?? "";
      const shape = describeShape(source);
      const result: BenchResult = {
        id: item.id,
        domain: item.domain,
        style,
        ok: !!outcome?.ok,
        reason: outcome?.reason ?? "threw",
        attempts: outcome?.attempts.length ?? 0,
        fellBack: !!outcome && outcome.style !== style,
        isDiagram: shape.components >= 2,
        components: shape.components,
        wired: shape.wired,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        note: note || (outcome?.ok ? "" : outcome?.message ?? "").slice(0, 120),
      };
      results.push(result);
      opts.onProgress?.(
        `${item.id} / ${style} — ${result.ok ? "ok" : result.reason}, ${result.attempts} attempt(s), ${result.seconds}s` +
          (result.isDiagram ? `, diagram ${result.wired}/${result.components} wired` : ", equations")
      );
    }
  }

  return results;
}

/** How many library components the source declares, and how many are wired. */
export function describeShape(source: string): { components: number; wired: number } {
  const body = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const declared = [...body.matchAll(/^\s*(?:redeclare\s+)?Modelica\.[\w.]+\s+(\w+)/gm)].map((m) => m[1]);
  const connected = new Set<string>();
  for (const call of body.matchAll(/connect\s*\(([^)]*)\)/g)) {
    for (const name of call[1].matchAll(/\b([A-Za-z_]\w*)\s*\./g)) connected.add(name[1]);
  }
  return {
    components: declared.length,
    wired: declared.filter((n) => connected.has(n)).length,
  };
}

/** The results as a plain-text table, for reading in a console. */
export function formatBenchmark(results: BenchResult[]): string {
  if (!results.length) return "(no results)";
  const head = ["prompt", "domain", "style", "ok", "tries", "fell back", "shape", "s", "note"];
  const rows = results.map((r) => [
    r.id,
    r.domain,
    r.style,
    r.ok ? "yes" : "NO",
    String(r.attempts),
    r.fellBack ? "yes" : "",
    r.isDiagram ? `${r.wired}/${r.components} wired` : "equations",
    String(r.seconds),
    r.note,
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  const out = [line(head), widths.map((w) => "-".repeat(w)).join("  ")];
  for (const r of rows) out.push(line(r));
  out.push("");
  out.push(summariseBenchmark(results));
  return out.join("\n");
}

/** The counts the decision needs, per style. */
export function summariseBenchmark(results: BenchResult[]): string {
  const styles = [...new Set(results.map((r) => r.style))];
  const parts: string[] = [];
  for (const style of styles) {
    const of = results.filter((r) => r.style === style);
    const ok = of.filter((r) => r.ok);
    const diagrams = ok.filter((r) => r.isDiagram);
    const wired = ok.filter((r) => r.isDiagram && r.wired === r.components);
    // A run that fell back is not evidence for the style it started with.
    const own = of.filter((r) => !r.fellBack);
    const ownOk = own.filter((r) => r.ok);
    parts.push(
      `${style}: ${ok.length}/${of.length} compiled` +
        (own.length !== of.length ? ` (${ownOk.length}/${own.length} without falling back)` : "") +
        `, ${diagrams.length} as a diagram, ${wired.length} fully wired` +
        `, median ${median(of.map((r) => r.attempts))} attempt(s)`
    );
  }
  // Per domain, since that is the question: which domains suit which form.
  const domains = [...new Set(results.map((r) => r.domain))];
  for (const domain of domains) {
    const of = results.filter((r) => r.domain === domain);
    parts.push(
      `  ${domain}: ${of.filter((r) => r.ok).length}/${of.length} compiled` +
        ` | ` +
        styles
          .map((s) => {
            const sub = of.filter((r) => r.style === s);
            return `${s} ${sub.filter((r) => r.ok).length}/${sub.length}`;
          })
          .join(", ")
    );
  }
  return parts.join("\n");
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
