/**
 * Provider configuration and prompt construction.
 *
 * Deliberately free of any Obsidian import so it can be exercised in a plain
 * Node process, and so the request shape can be tested without a network.
 */

import type { LibraryIndex } from "../modelica/library";

export interface AiConfig {
  /**
   * Name of the secret holding the API key, as stored in Obsidian's own
   * keychain — NOT the key itself.
   *
   * The value never reaches `data.json`. Obsidian's SecretStorage keeps secrets
   * in local storage keyed to the vault, so they stay out of vault backups,
   * sync services and version control, and the same secret can be reused by any
   * other plugin that wants it. This field is only the label to look up.
   *
   * Empty disables the feature.
   */
  secretName: string;
  /**
   * Legacy field: a plaintext key from before secret storage was used.
   *
   * Still declared so the value can be found and migrated. It is cleared by
   * `migrateLegacyKey` and must never be read for a request.
   *
   * @deprecated use {@link secretName}
   */
  apiKey?: string;
  /** Base URL without the trailing path. */
  baseUrl: string;
  model: string;
  temperature: number;
  /** Optional extra instruction prepended to every request. */
  systemPrompt: string;
  /**
   * Model ids fetched from the provider, if they have ever been fetched.
   *
   * Preferred over the built-in suggestions when present: they are the
   * provider's own answer rather than a list compiled into the plugin, which is
   * what went stale when `deepseek-chat` was retired.
   */
  models?: string[];
}

export const AI_DEFAULTS: AiConfig = {
  secretName: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  temperature: 0.2,
  systemPrompt: "",
};

/** Providers worth offering by name, so the URL does not have to be recalled. */
/**
 * Secret name used when migrating a key that predates the keychain.
 *
 * Namespaced and in kebab-case: SecretStorage requires lowercase alphanumeric
 * with optional dashes, and the namespace stops it colliding with a secret
 * another plugin created.
 */
export const LEGACY_SECRET_NAME = "modelica-studio-api-key";

export interface AiProvider {
  label: string;
  baseUrl: string;
  /** Default model. Kept first in the suggestions. */
  model: string;
  /**
   * Other models worth offering, as `id` or `id — note`.
   *
   * A static list of model names goes stale, and stale is worse than absent: a
   * retired name fails at request time with a provider error, which is what
   * happened when `deepseek-chat` was retired in favour of `deepseek-flash`.
   * So these are only a fallback — the settings page can ask the provider for
   * its current list, and that is the authoritative answer.
   */
  models?: string[];
  /** Where the defaults were last confirmed. Shown in the settings page. */
  verified?: string;
}

/**
 * Known providers, with the defaults confirmed from each provider's own
 * documentation on 2026-09-16. Anything not confirmed is marked so rather than
 * presented as fact.
 */
export const AI_PROVIDERS: AiProvider[] = [
  {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.6-terra",
    models: ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.1", "gpt-5.4-mini"],
    verified: "2026-09-16",
  },
  {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-flash",
    models: ["deepseek-flash", "deepseek-v4-pro"],
    verified: "2026-09-16",
  },
  {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-v4.1-flash",
    models: [
      "deepseek/deepseek-v4.1-flash",
      "openai/gpt-5.6-terra",
      "openai/gpt-6-astra",
      "anthropic/claude-sonnet-4.5",
      "google/gemini-3.7-flash",
      "x-ai/grok-4.6",
    ],
    verified: "2026-09-16",
  },
  {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
    // Only the featured model could be confirmed; Groq's model table is
    // paginated and the rest of the ids move often. Ask the provider.
    models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
    verified: "2026-09-16 (partial)",
  },
  {
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5-coder",
    models: ["qwen2.5-coder", "llama3.2", "mistral"],
  },
  {
    label: "llama.cpp (local)",
    baseUrl: "http://localhost:8080/v1",
    model: "local-model",
    models: ["local-model"],
  },
];

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/* ---- readiness ---- */

/**
 * True when a request has everything it needs.
 *
 * The key is passed in rather than read from the config, because the config
 * holds a secret NAME and only Obsidian's keychain can resolve it to a value.
 */
export function aiReady(cfg: AiConfig, apiKey: string | null | undefined): boolean {
  return Boolean(apiKey && apiKey.trim() && cfg.baseUrl.trim() && cfg.model.trim());
}

/** The configured secret name, or an empty string. */
export function secretNameOf(cfg: AiConfig): string {
  return cfg.secretName?.trim() ?? "";
}

/**
 * Whether a legacy plaintext key is still sitting in the settings.
 *
 * Such a key predates the use of Obsidian's keychain and is stored unencrypted
 * in `data.json`, so it wants migrating out.
 */
export function legacyKeyOf(cfg: AiConfig): string {
  return cfg.apiKey?.trim() ?? "";
}

/* ---- prompt construction ---- */

/**
 * A short list of library classes matching the request.
 *
 * Sending the whole 4,788-class index would swamp the context and cost real
 * money. Sending the handful whose names relate to what was asked is what makes
 * the difference between the model inventing `Modelica.Fluid.Pump` and using the
 * class that exists.
 */
export function relevantClasses(library: LibraryIndex | undefined, request: string, limit = 40): string[] {
  if (!library) return [];
  const words = request
    .split(/[^A-Za-z]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    for (const def of library.listPlaceable(w, 12)) {
      if (seen.has(def.name)) continue;
      seen.add(def.name);
      out.push(def.name);
      if (out.length >= limit) return out;
    }
  }
  if (out.length < limit) {
    for (const def of library.listPlaceable("", limit)) {
      if (seen.has(def.name)) continue;
      seen.add(def.name);
      out.push(def.name);
      if (out.length >= limit) break;
    }
  }
  return out;
}

const BASE_RULES = `You write Modelica models for the Modelica Standard Library (MSL) 4.1.0.

Rules:
- Use fully qualified MSL class names, e.g. Modelica.Electrical.Analog.Basic.Resistor.
- Output ONE complete model: "model <Name> ... end <Name>;"
- The model must be self-contained. If it uses physical components, include an "inner Modelica.Fluid.System" or World component where MSL requires one.
- Every declared variable and component must be used, or OpenModelica reports it.
- Every connector must be connected, or the model will not compile.
- Prefer a parameter for anything a user would want to change.
- Do not include a "within" clause and do not include an experiment annotation.
- Reply with the Modelica source in a single fenced code block and nothing else.`;

export interface GenerateRequest {
  /** What the user asked for. */
  prompt: string;
  /** The model currently in the editor, if any. */
  current?: string;
  /** Compiler or parser diagnostics to fix, if the user is asking for a repair. */
  diagnostics?: string;
  library?: LibraryIndex;
  /** User's standing extra instructions. */
  systemPrompt?: string;
  /**
   * What the AI needs to know about this installation.
   *
   * Built by `ai/context.ts`: the OpenModelica version, the indexed libraries,
   * the run settings a simulation will actually use, the user's exclusions, and
   * the log of failed runs. Without it the model writes for a machine it cannot
   * see — inventing class names, setting parameters this MSL version does not
   * have, and adding `experiment` annotations that fight the plugin's settings.
   */
  environment?: string;
  /** Classes relevant to the request, as text grouped by package. */
  availableClasses?: string;
}

export function buildMessages(req: GenerateRequest): ChatMessage[] {
  const parts: string[] = [BASE_RULES];
  if (req.systemPrompt?.trim()) {
    parts.push(`Additional instructions from the user:\n${req.systemPrompt.trim()}`);
  }

  // The environment goes in the SYSTEM message: it is a standing constraint on
  // every answer, not part of the request being made.
  if (req.environment?.trim()) parts.push(req.environment.trim());

  if (req.availableClasses?.trim()) {
    parts.push(req.availableClasses.trim());
  } else {
    const names = relevantClasses(req.library, req.prompt);
    if (names.length) {
      parts.push(
        `Library classes that may be relevant (these exist on this machine; use them rather than inventing names):\n` +
          names.map((n) => `- ${n}`).join("\n")
      );
    }
  }

  const user: string[] = [req.prompt.trim()];
  if (req.current?.trim()) {
    user.push(`The model currently in the editor is:\n\n\`\`\`modelica\n${req.current.trim()}\n\`\`\``);
  }
  if (req.diagnostics?.trim()) {
    // The FULL output, not a summary. OpenModelica's first line is usually a file
    // path or "Internal error"; what is actually wrong comes several lines later.
    user.push(
      `It currently fails to simulate. The complete output was:\n\n\`\`\`\n${req.diagnostics.trim()}\n\`\`\`\n\n` +
        `Fix the cause, not the symptom: do not delete the equation or variable that is failing, ` +
        `make it correct.`
    );
  }

  return [
    { role: "system", content: parts.join("\n\n") },
    { role: "user", content: user.join("\n\n") },
  ];
}

/**
 * Pull Modelica source out of a reply.
 *
 * Models are asked to fence their answer, but a reply that is already pure
 * Modelica is common enough to accept rather than reject.
 */
export function extractModelica(reply: string): string {
  const fenced = [...reply.matchAll(/```(?:modelica|mo|)\s*\n([\s\S]*?)```/g)];
  if (fenced.length) {
    // The longest block is the model; a reply may also fence a usage example.
    const best = fenced.map((m) => m[1]).sort((a, b) => b.length - a.length)[0];
    return best.trim();
  }
  const trimmed = reply.trim();
  if (/^\s*(model|block|record|package|connector)\s+\w+/m.test(trimmed)) return trimmed;
  return "";
}

/** Model name declared by a source, or undefined. */
export function modelNameOf(source: string): string | undefined {
  const m = /^\s*(?:model|block|package|record|connector)\s+([A-Za-z_]\w*)/m.exec(source);
  return m?.[1];
}
