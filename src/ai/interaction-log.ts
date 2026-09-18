/**
 * A record of what was sent to the AI, what came back, and what happened to it.
 *
 * Kept because the prompt is the thing that most needs improving and the evidence
 * for how to improve it only exists at the moment of the exchange. The run log has
 * the compiler's verdict; it does not have the reply that provoked it, and by the
 * time a model has been repaired twice the original answer is gone.
 *
 * The signal worth reading is the REJECTIONS: a model that builds and is still not
 * what was asked for is a prompt problem, not a model problem. `summarise` groups
 * them, because a list of exchanges is not a conclusion.
 *
 * One rule that is not negotiable: the API key never reaches this file. It travels
 * in an authorization header rather than in the messages, so there is nothing to
 * redact in the normal course -- `redact` is there because "nothing to redact
 * today" is not a property a log of user content can rely on.
 */

export interface AiExchange {
  /** ISO timestamp, so a session can be read in order. */
  at: string;
  /** Which attempt this was within its generation. */
  attempt: number;
  /** The form that was asked for. `equations` outcomes are not diagram failures. */
  style: string;
  /** What the user asked for, verbatim. */
  prompt: string;
  /** The conversation as sent, so the prompt can be reviewed rather than guessed. */
  messages: Array<{ role: string; content: string }>;
  /** What the provider replied, verbatim, before anything was extracted from it. */
  reply: string;
  /** The Modelica pulled out of the reply, or null when there was none. */
  extracted: string | null;
  /**
   * What became of it.
   *
   * `rejected` is the one that matters: it BUILT and was still not usable, which
   * means the instruction did not say clearly enough what was wanted.
   */
  outcome: "ok" | "rejected" | "compile-error" | "no-source";
  /** The reason, in the checker's own words. */
  detail: string;
  /** How long the provider took, in milliseconds. */
  ms: number;
}

/** How many exchanges to keep. Beyond this the log is evidence nobody will read. */
export const MAX_EXCHANGES = 200;

/**
 * Remove anything that looks like a secret.
 *
 * Called on every field that goes into the file. The key is not among them today;
 * this exists so that it cannot quietly become one -- a prompt that quotes a key, a
 * provider that echoes an authorization header back in an error, or a future
 * request shape that puts it in the body.
 */
export function redact(text: string, secret: string | null | undefined): string {
  let out = text;
  if (secret && secret.length >= 8) {
    // Split so the replacement itself is not re-matched.
    out = out.split(secret).join("[REDACTED-KEY]");
  }
  // Bearer tokens and OpenAI-style keys, whatever the configured key is.
  out = out.replace(/\b(Bearer\s+)[A-Za-z0-9._\-]{12,}/gi, "$1[REDACTED]");
  out = out.replace(/\bsk-[A-Za-z0-9._\-]{12,}/g, "[REDACTED-KEY]");
  return out;
}

/** One exchange as a single line, so the file can be appended to and tailed. */
export function toLogLine(exchange: AiExchange, secret?: string | null): string {
  const scrub = (t: string) => redact(t, secret);
  const safe: AiExchange = {
    ...exchange,
    prompt: scrub(exchange.prompt),
    reply: scrub(exchange.reply),
    extracted: exchange.extracted === null ? null : scrub(exchange.extracted),
    detail: scrub(exchange.detail),
    messages: exchange.messages.map((m) => ({ role: m.role, content: scrub(m.content) })),
  };
  // One line by construction: JSON.stringify escapes the newlines inside strings,
  // so a multi-line reply cannot break the format.
  return JSON.stringify(safe);
}

/**
 * Read a log back.
 *
 * A line that cannot be parsed is dropped rather than thrown: the file is appended
 * to by a plugin that can be killed mid-write, and losing the last line must not
 * cost the reader the other 199.
 */
export function parseLog(text: string): { exchanges: AiExchange[]; skipped: number } {
  const exchanges: AiExchange[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as AiExchange;
      if (parsed && typeof parsed.at === "string") exchanges.push(parsed);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { exchanges, skipped };
}

/** Keep the most recent `max` lines, for trimming an oversized file. */
export function pruneLines(text: string, max = MAX_EXCHANGES): string {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length <= max) return text;
  return lines.slice(lines.length - max).join("\n") + "\n";
}

export interface LogSummary {
  total: number;
  /** Count per outcome, so a run of rejections is visible at a glance. */
  byOutcome: Record<string, number>;
  /** The rejection reasons, most common first. This is the actionable part. */
  rejections: Array<{ reason: string; count: number; examplePrompt: string }>;
  /** Replies that yielded no Modelica at all: an extraction or instruction fault. */
  emptyReplies: number;
}

/**
 * Group a log into what is worth acting on.
 *
 * A rejection is a model the COMPILER accepted, so the instruction is what is
 * wrong: it did not say the answer had to be a wired diagram, or had to be
 * time-dependent, or had to be in the form asked for. Those are the entries a
 * prompt change should be aimed at, and they are the ones a run log cannot show.
 */
export function summarise(exchanges: AiExchange[]): LogSummary {
  const byOutcome: Record<string, number> = {};
  const counts = new Map<string, { count: number; examplePrompt: string }>();
  let emptyReplies = 0;

  for (const e of exchanges) {
    byOutcome[e.outcome] = (byOutcome[e.outcome] ?? 0) + 1;
    if (e.outcome === "no-source") emptyReplies++;
    if (e.outcome !== "rejected") continue;
    // Grouped by the FIRST LINE of the reason: the checker's opening sentence is
    // the kind of problem, and the rest is the detail that differs per model.
    const reason = (e.detail.split("\n")[0] ?? "").trim() || "(no reason given)";
    const found = counts.get(reason);
    if (found) found.count++;
    else counts.set(reason, { count: 1, examplePrompt: e.prompt });
  }

  const rejections = [...counts.entries()]
    .map(([reason, v]) => ({ reason, count: v.count, examplePrompt: v.examplePrompt }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  return { total: exchanges.length, byOutcome, rejections, emptyReplies };
}

/** The summary as text, for the modal and the console. */
export function formatSummary(summary: LogSummary, recent: AiExchange[] = []): string {
  if (summary.total === 0) {
    return "No AI exchanges recorded yet. Turn the log on in settings, then generate a model.";
  }
  const lines: string[] = [];
  lines.push(`${summary.total} exchange${summary.total === 1 ? "" : "s"} recorded.`);
  const outcomes = Object.entries(summary.byOutcome)
    .map(([k, v]) => `${k}: ${v}`)
    .sort();
  lines.push(`  ${outcomes.join("   ")}`);

  if (summary.rejections.length) {
    lines.push("");
    lines.push("Rejected after building — the instruction, not the model:");
    for (const r of summary.rejections) {
      lines.push(`  ${r.count} × ${r.reason}`);
      lines.push(`       e.g. "${truncate(r.examplePrompt, 70)}"`);
    }
  } else if (summary.total > 0) {
    lines.push("");
    lines.push("Nothing was rejected after building.");
  }

  if (summary.emptyReplies) {
    lines.push("");
    lines.push(
      `${summary.emptyReplies} repl${summary.emptyReplies === 1 ? "y" : "ies"} contained no ` +
        `Modelica at all — an extraction fault or an instruction the model ignored.`
    );
  }

  if (recent.length) {
    lines.push("");
    lines.push("Most recent, newest last:");
    for (const e of recent) {
      const when = e.at.slice(11, 19);
      const first = (e.detail.split("\n")[0] ?? "").trim();
      lines.push(
        `  ${when}  ${e.style.padEnd(9)} attempt ${e.attempt}  ${e.outcome.padEnd(13)} ` +
          `${e.ms}ms${first ? `  ${truncate(first, 60)}` : ""}`
      );
    }
  }
  return lines.join("\n");
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}
