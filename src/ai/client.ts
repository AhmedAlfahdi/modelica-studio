/**
 * The HTTP side of AI assistance.
 *
 * Talks to any OpenAI-compatible chat-completions endpoint, so the user brings
 * their own provider and key: OpenAI, OpenRouter, Groq, a local Ollama or
 * llama.cpp server, anything that speaks the same request shape.
 *
 * Kept apart from `prompts.ts` so the request shape can be tested without
 * Obsidian and without a network. The key lives in the plugin's own settings
 * file: it is never logged, never attached to an error message, and only ever
 * sent to the endpoint the user configured.
 */

import { requestUrl } from "obsidian";
import { DEFAULT_TIMEOUT_SECONDS, aiReady, secretNameOf } from "./prompts";
import { withTimeout } from "./deadline";
import type { AiConfig, ChatMessage } from "./prompts";

export * from "./prompts";

export class AiError extends Error {
  constructor(
    message: string,
    /** HTTP status when the failure came from the provider. */
    readonly status?: number
  ) {
    super(message);
    this.name = "AiError";
  }
}

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/**
 * Send a chat request and return the assistant's text.
 *
 * `requestUrl` rather than `fetch`: it is Obsidian's own HTTP helper and is not
 * subject to the renderer's CORS policy, which is what lets a local llama.cpp
 * server be reached at all.
 */
export async function chat(
  cfg: AiConfig,
  messages: ChatMessage[],
  /**
   * Resolves the API key. It comes from Obsidian's keychain, which only the app
   * can reach, so it is resolved here rather than read from the config — the
   * config holds the secret's NAME.
   */
  getKey: () => string | null,
  signal?: AbortSignal
): Promise<string> {
  const apiKey = getKey();
  if (!aiReady(cfg, apiKey)) {
    throw new AiError(
      secretNameOf(cfg)
        ? `The secret "${secretNameOf(cfg)}" is empty or missing. Choose a secret in the plugin settings.`
        : "No API key configured. Choose one in the plugin settings under AI assistance."
    );
  }

  const body: Record<string, unknown> = {
    model: cfg.model.trim(),
    temperature: cfg.temperature,
    messages,
  };
  // DeepSeek reasons at high effort by default, which is a long wait for a task
  // the compiler checks anyway -- and it silently disables `temperature`. Sending
  // the switch explicitly is the difference between seconds and minutes.
  // "off" is the one that needs saying: the provider thinks at high effort unless
  // told not to. Any other level is passed through as `reasoning_effort`, which is
  // the provider's own parameter name.
  const thinking = cfg.thinking ?? "off";
  const deepseek = /(^|\.)deepseek\.com/i.test(cfg.baseUrl);
  if (thinking === "off") {
    // ONLY to the provider the field belongs to. The default preset points at
    // OpenAI, whose API rejects an unrecognised request argument outright with a
    // 400 -- so a fresh install's first request could fail as though the plugin
    // were broken. DeepSeek is the one that needs to be told: it reasons at high
    // effort (and silently ignores `temperature`) unless the switch says otherwise.
    if (deepseek) body.thinking = { type: "disabled" };
  } else {
    // `reasoning_effort` is the parameter both providers document by that name.
    body.reasoning_effort = thinking;
  }

  const timeoutMs = Math.max(5, cfg.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
  let response;
  try {
    response = await withTimeout(
      requestUrl({
        url: endpoint(cfg.baseUrl),
        method: "POST",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${apiKey!.trim()}` },
        body: JSON.stringify(body),
        throw: false,
      }),
      timeoutMs,
      () => {
        // The request cannot be aborted -- Obsidian's helper takes no signal --
        // so the timer makes it FAIL rather than hang. The abandoned request
        // finishes into nothing.
        const seconds = Math.round(timeoutMs / 1000);
        // The thinking level is named when it is the likely cause, because it is
        // the one setting that turns seconds into minutes and the remedy is a
        // setting the reader can change. Sending them to "check the provider" when
        // the answer is one dropdown away is the same mistake as calling a timeout
        // a refusal.
        const level = cfg.thinking ?? "off";
        const blame =
          level === "off"
            ? "It may be a slow model, a long prompt, or a provider that is not responding."
            : `Reasoning is set to "${level}", which asks the provider to think at length ` +
              `before answering -- that alone can exceed this timeout.`;
        return new AiError(
          `${cfg.model} did not reply within ${seconds} s. ${blame} Raise the timeout in ` +
            `settings, set Thinking to Off, or choose a faster model.`
        );
      },
      signal
    );
  } catch (err) {
    if (err instanceof AiError) throw err;
    // A cancellation is reported as one, and checked BEFORE the network case:
    // aborting makes `withTimeout` reject with a plain Error, which would
    // otherwise be wrapped as "could not reach the provider" and send the reader
    // to check a connection that was working.
    if (signal?.aborted) throw new AiError("Stopped.");
    // Network-level failure: no response at all.
    throw new AiError(
      `Could not reach ${cfg.baseUrl}. Check the URL and your connection. (${String(err)})`
    );
  }

  if (signal?.aborted) throw new AiError("Stopped.");

  if (response.status < 200 || response.status >= 300) {
    throw new AiError(describeHttpError(response.status, response.text), response.status);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    throw new AiError("The provider returned a response that was not JSON.");
  }

  const text = extractContent(parsed);
  if (!text) throw new AiError("The provider returned an empty completion.");
  return text;
}

/**
 * Ask the provider which models it currently offers.
 *
 * The authoritative answer, and the reason the settings page can offer a
 * refresh: a curated list of model names goes stale silently, and a retired
 * name fails at request time with an error that reads like a bad key. Every
 * OpenAI-compatible provider exposes `GET /models`.
 */
export async function listModels(cfg: AiConfig, apiKey: string): Promise<string[]> {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/models`;
  let response;
  try {
    // The same deadline `chat` uses. `requestUrl` takes no AbortSignal and applies
    // no timeout of its own, so an endpoint that accepts the connection and never
    // answers left this promise pending for the session -- and the settings button
    // is renamed "Asking…" and disabled until it settles.
    const timeoutMs = Math.max(5, cfg.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
    response = await withTimeout(
      requestUrl({
        url,
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        throw: false,
      }),
      timeoutMs,
      () =>
        new AiError(
          `The model list did not arrive within ${Math.round(timeoutMs / 1000)} s. ` +
            "Check the base URL, or raise the timeout in settings."
        )
    );
  } catch (err) {
    if (err instanceof AiError) throw err;
    throw new AiError(`Could not reach ${url}. (${String(err)})`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new AiError(describeHttpError(response.status, response.text), response.status);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    throw new AiError("The provider returned a model list that was not JSON.");
  }

  const data = (parsed as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new AiError("The provider returned no model list at /models.");
  }
  const ids: string[] = [];
  for (const entry of data) {
    const id =
      typeof entry === "string"
        ? entry
        : ((entry as { id?: unknown; name?: unknown }).id ??
           (entry as { name?: unknown }).name);
    if (typeof id === "string" && id.trim()) ids.push(id.trim());
  }
  // Offer the models before the embeddings and the audio ones, which no chat
  // request can use.
  return [...new Set(ids)].sort((a, b) => {
    const rank = (n: string) => (/embed|whisper|tts|audio|moderation|image|dall/i.test(n) ? 1 : 0);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
}

/** Turn a provider error into something a user can act on. */
function describeHttpError(status: number, body: string): string {
  let detail = body.slice(0, 400);
  try {
    const j = JSON.parse(body) as { error?: { message?: string }; message?: string };
    detail = j.error?.message ?? j.message ?? detail;
  } catch {
    // Not JSON; the raw text is the best available description.
  }
  const hint =
    status === 401
      ? " The API key was rejected."
      : status === 404
        ? " The model or base URL may be wrong."
        : status === 429
          ? " Rate limited or out of quota."
          : "";
  return `Provider error ${status}: ${detail}${hint}`;
}

function extractContent(parsed: unknown): string {
  const choices = (parsed as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  // Some providers return content as an array of parts.
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : ((p as { text?: string }).text ?? "")))
      .join("");
  }
  return "";
}

