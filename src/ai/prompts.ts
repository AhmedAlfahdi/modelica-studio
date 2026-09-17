/**
 * Provider configuration and prompt construction.
 *
 * Deliberately free of any Obsidian import so it can be exercised in a plain
 * Node process, and so the request shape can be tested without a network.
 */

import type { LibraryIndex } from "../modelica/library";

/**
 * Whether to let a DeepSeek model reason before answering.
 *
 * DeepSeek V4 enables thinking mode by default at "high" effort, which means the
 * model writes a long chain of thought BEFORE its answer. For writing a Modelica
 * model that is mostly latency: the extra reasoning buys little on a task whose
 * correctness is checked by a compiler a second later, and it is the difference
 * between a reply in seconds and one in minutes. It also silently disables
 * `temperature`, which the provider accepts and ignores.
 *
 * Left as a setting because it is the user's call, and because other providers
 * either ignore the parameter or do not have it.
 */
export type ThinkingMode = "default" | "disabled";

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
  /**
   * Whether to disable the provider's reasoning pass. "default" leaves the
   * provider alone, which for DeepSeek means high-effort thinking.
   */
  thinking?: ThinkingMode;
  /**
   * How long to wait for a reply, in seconds. A request that hangs with no
   * deadline hangs forever.
   */
  timeoutSeconds?: number;
}

/** Default wait for a reply. A long model in thinking mode can genuinely take a while. */
export const DEFAULT_TIMEOUT_SECONDS = 120;

export const AI_DEFAULTS: AiConfig = {
  secretName: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.6-terra",
  temperature: 0.2,
  systemPrompt: "",
  // DeepSeek reasons at high effort unless told not to, which is mostly waiting
  // for a job the compiler checks anyway.
  thinking: "disabled",
  timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
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

const BASE_RULES = `You write Modelica for the Modelica Standard Library (MSL) 4.1.0.

## Shape of the answer
- Output ONE complete model: "model <Name> ... end <Name>;"
- Reply with the Modelica source in a single fenced code block and nothing else.
- Do not include a "within" clause, and do not include an experiment annotation: the tool that runs this applies its own run settings.

## Choose the form by the subject: a diagram where the structure IS the answer
This tool draws a schematic from the components you declare. A model built from
library components becomes a picture the reader can inspect, wire by wire, and
that picture is the main reason to use Modelica at all. So:

**Build a DIAGRAM when the request names a domain whose structure is the point.**
Any of these means components, not free equations:
- electrical: circuits, sources, loads, filters, machines, rectifiers, drives
- fluid: tanks, pipes, orifices, valves, pumps, loops, heat exchangers
- thermal: capacitances, conductors, walls, radiating surfaces
- rotational and translational mechanics: a mass on a spring, a gearbox, a
  drivetrain, a linkage — anything a reader would draw as blocks joined by rods
- control: a setpoint, a controller, a plant, feedback

**Write EQUATIONS when there is no structure to draw.** A point mass thrown at an
angle, population growth, a pure transfer function, a state machine's logic: these
have nothing to wire, and forcing them into components produces a pile of
primitives. Use equations there — but do NOT reach for them just because a domain
COULD be written that way. der(h) = v is shorter than a Translational assembly,
and it is still the wrong answer when the reader asked for a mechanism.

## When you build a diagram
- Declare a component for every part, using its full MSL path.
- Give EVERY component a Placement(transformation(extent={{x1,y1},{x2,y2}})),
  so it lands on the canvas rather than at the origin.
- **Lay them out.** Place components on a grid about 200 units apart along the
  signal path, left to right. Two components at the same coordinates are drawn on
  top of each other, which looks like one block and cannot be wired by hand.
  A component is 20 units half-width, so extents of {{-10,-10},{10,10}} around
  each chosen centre are enough.
- **Connect every pin.** A declared component with no connect is a broken
  model and an unfinished diagram. If a pin genuinely has nothing to attach to,
  attach a Ground (electrical) or a Fixed (mechanical).
- Include the reference the domain needs: Modelica.Electrical.Analog.Basic.Ground
  for a circuit, an inner Modelica.Fluid.System or inner Modelica.Mechanics.MultiBody.World
  where the fluid or multibody libraries require one.

## Worked example of the form
A request for "a resistor divider across 10 V" is answered like this, and not
with v = i*R equations:

    Modelica.Electrical.Analog.Sources.ConstantVoltage source(V = 10)
      annotation(Placement(transformation(extent = {{-60, -10}, {-40, 10}})));
    Modelica.Electrical.Analog.Basic.Resistor r1(R = 100)
      annotation(Placement(transformation(extent = {{-20, 30}, {0, 50}})));
    Modelica.Electrical.Analog.Basic.Resistor r2(R = 100)
      annotation(Placement(transformation(extent = {{20, -10}, {40, 10}})));
    Modelica.Electrical.Analog.Basic.Ground ground
      annotation(Placement(transformation(extent = {{-60, -50}, {-40, -30}})));
  equation
    connect(source.p, r1.p);
    connect(r1.n, r2.p);
    connect(r2.n, source.n);
    connect(source.n, ground.p);

Every component has a position, every pin is connected, and the result is a
circuit a reader can see. That is the target.

## Every name must exist
- Declare every name you use. A model that uses m or g without a declaration
  fails to compile: "Variable m not found in scope".
- Use fully qualified MSL class names, e.g.
  Modelica.Electrical.Analog.Basic.Resistor.
- Do not invent classes, parameters or attributes. If you are unsure a parameter
  exists on a class, leave it out rather than guess.

## Declarations
- "parameter" declares a value fixed for the run. The ONLY attributes a parameter
  may carry are quantity, unit, displayUnit, min, max, start and fixed. Never put
  fixed = true on a parameter.
- "start" and "fixed" belong to a VARIABLE and describe its initial value.
- Give every variable a unit where one exists, and every parameter a comment
  saying what it is.
- An equation model that starts at rest needs fixed = true on its states, not on
  its parameters.

## Equations must balance
- The number of equations must equal the number of unknowns, in EVERY branch of
  an if. An if-equation SELECTS between equations; it does not add them, so an
  assignment inside a branch to a variable that already has an equation makes the
  model over-determined.
- Do not write an equation for a variable twice.
- A connect() contributes equations; two connects to the same pin double-count.

## Avoid mode switching where a smooth law will do
Friction, backlash, diodes and valves tempt you into a Boolean mode with when and
reinit. That produces models that are over-determined in one mode and
under-determined in the other, and it is hard to simulate. Use a regularised law
instead: tanh(v/v_eps) for friction, for example. It needs no event, no mode
variable and no reinit, and it approaches the ideal answer as the regularisation
scale goes to zero.

## Check before answering
- Every name used appears in a declaration.
- If this is a diagram: every component has a Placement, no two share a position,
  and every pin appears in a connect.
- If this is equations: the count matches the unknown count in every branch.
- No fixed = true on a parameter.`;

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
