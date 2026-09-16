/**
 * Provider configuration and prompt construction.
 *
 * Deliberately free of any Obsidian import so it can be exercised in a plain
 * Node process, and so the request shape can be tested without a network.
 */

import type { LibraryIndex } from "../modelica/library";

export interface AiConfig {
  /** Empty disables the feature. */
  apiKey: string;
  /** Base URL without the trailing path. */
  baseUrl: string;
  model: string;
  temperature: number;
  /** Optional extra instruction prepended to every request. */
  systemPrompt: string;
}

export const AI_DEFAULTS: AiConfig = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  temperature: 0.2,
  systemPrompt: "",
};

/** Providers worth offering by name, so the URL does not have to be recalled. */
export const AI_PROVIDERS: Array<{ label: string; baseUrl: string; model: string }> = [
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-3.5-sonnet" },
  { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", model: "qwen2.5-coder" },
  { label: "llama.cpp (local)", baseUrl: "http://localhost:8080/v1", model: "local-model" },
];

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
}

export function buildMessages(req: GenerateRequest): ChatMessage[] {
  const parts: string[] = [BASE_RULES];
  if (req.systemPrompt?.trim()) {
    parts.push(`Additional instructions from the user:\n${req.systemPrompt.trim()}`);
  }

  const names = relevantClasses(req.library, req.prompt);
  if (names.length) {
    parts.push(
      `Library classes that may be relevant (these exist on this machine; use them rather than inventing names):\n` +
        names.map((n) => `- ${n}`).join("\n")
    );
  }

  const user: string[] = [req.prompt.trim()];
  if (req.current?.trim()) {
    user.push(`The model currently in the editor is:\n\n\`\`\`modelica\n${req.current.trim()}\n\`\`\``);
  }
  if (req.diagnostics?.trim()) {
    user.push(`It currently fails to compile with:\n\n\`\`\`\n${req.diagnostics.trim()}\n\`\`\``);
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
