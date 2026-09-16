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
import { aiReady, secretNameOf } from "./prompts";
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

  let response;
  try {
    response = await requestUrl({
      url: endpoint(cfg.baseUrl),
      method: "POST",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${apiKey!.trim()}` },
      body: JSON.stringify({
        model: cfg.model.trim(),
        temperature: cfg.temperature,
        messages,
      }),
      throw: false,
    });
  } catch (err) {
    // Network-level failure: no response at all.
    throw new AiError(
      `Could not reach ${cfg.baseUrl}. Check the URL and your connection. (${String(err)})`
    );
  }

  if (signal?.aborted) throw new AiError("Cancelled.");

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
