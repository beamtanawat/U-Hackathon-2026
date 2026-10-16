import { provenanceSchema } from "../domain/schemas";
import type { ProviderRequest, QwenProvider, UsageEvent, UsageReporter } from "./types";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export const QWEN_MODEL = "qwen/qwen3.5-9b" as const;
export const QWEN_MAX_COMPLETION_TOKENS = 350;

const EXPLANATION_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    summary: { type: "string" },
    reasons: { type: "array", items: { type: "object", additionalProperties: false, properties: { category: { enum: ["financial", "trust", "missing_context"] }, text: { type: "string" }, evidenceIds: { type: "array", items: { type: "string" } } }, required: ["category", "text", "evidenceIds"] } },
    nextStep: { type: "string" },
    missingContextQuestions: { type: "array", items: { type: "object", additionalProperties: false, properties: { field: { type: "string" }, question: { type: "string" } }, required: ["field", "question"] } },
    suggestedIndicators: { type: "array", items: { type: "object", additionalProperties: false, properties: { kind: { type: "string" }, evidenceIds: { type: "array", items: { type: "string" } } }, required: ["kind", "evidenceIds"] } },
  },
  required: ["summary", "reasons", "nextStep", "missingContextQuestions", "suggestedIndicators"],
} as const;

const REVIEW_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    model: { type: "string" }, provider: { const: "openrouter" }, reviewStatus: { const: "completed" },
    indicators: { type: "array", items: { type: "object", additionalProperties: false, properties: { type: { type: "string" }, evidenceId: { type: "string" }, evidence: { type: "string" }, provenance: { enum: provenanceSchema.options } }, required: ["type", "evidenceId", "evidence", "provenance"] } },
    missingContext: { type: "array", items: { type: "string" } }, contradictions: { type: "array", items: { type: "string" } },
    suggestedEscalation: { type: "boolean" }, reasoningSummary: { type: "string" },
  },
  required: ["model", "provider", "reviewStatus", "indicators", "missingContext", "contradictions", "suggestedEscalation", "reasoningSummary"],
} as const;

export const QWEN_ANALYSIS_JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { explanation: EXPLANATION_SCHEMA, review: REVIEW_SCHEMA },
  required: ["explanation", "review"],
} as const;

export class OpenRouterError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) { super(message); this.name = "OpenRouterError"; this.status = status; }
}

function reportUsage(payload: unknown, onUsage?: UsageReporter): void {
  if (!onUsage || typeof payload !== "object" || payload === null) return;
  const usage = (payload as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return;
  const value = usage as Record<string, unknown>;
  const inputTokens = typeof value.prompt_tokens === "number" ? value.prompt_tokens : 0;
  const outputTokens = typeof value.completion_tokens === "number" ? value.completion_tokens : 0;
  const event: UsageEvent = {
    provider: "openrouter", model: QWEN_MODEL, inputTokens, outputTokens,
    totalTokens: typeof value.total_tokens === "number" ? value.total_tokens : inputTokens + outputTokens,
    costUsd: typeof value.cost === "number" ? value.cost : null,
  };
  try { onUsage(event); } catch { /* Observability must not affect decisions. */ }
}

export function createOpenRouterQwenProvider(options: { apiKey: string; fetchImpl?: typeof fetch; onUsage?: UsageReporter }): QwenProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async analyze(request, signal) {
      let response: Response;
      try {
        response = await fetchImpl(ENDPOINT, {
          method: "POST", signal,
          headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: QWEN_MODEL, stream: false, temperature: 0, max_completion_tokens: QWEN_MAX_COMPLETION_TOKENS,
            messages: [{ role: "system", content: request.system }, { role: "user", content: JSON.stringify(request.context) }],
            response_format: { type: "json_schema", json_schema: { name: "qwen_transaction_analysis", strict: true, schema: QWEN_ANALYSIS_JSON_SCHEMA } },
            provider: { require_parameters: true, allow_fallbacks: false },
          }),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new OpenRouterError("OpenRouter request failed");
      }
      if (!response.ok) throw new OpenRouterError(`OpenRouter request failed with HTTP ${response.status}`, response.status);
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new OpenRouterError("OpenRouter returned invalid response JSON"); }
      const responseModel = (payload as { model?: unknown }).model;
      if (typeof responseModel !== "string") throw new OpenRouterError("OpenRouter response is missing model attribution");
      if (responseModel !== QWEN_MODEL) throw new OpenRouterError("OpenRouter returned an unexpected model");
      const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.trim() === "") throw new OpenRouterError("OpenRouter response is missing content");
      reportUsage(payload, options.onUsage);
      try {
        const generated = JSON.parse(content) as { review?: unknown };
        if (generated && typeof generated === "object" && generated.review && typeof generated.review === "object" && !Array.isArray(generated.review)) {
          return JSON.stringify({ ...generated, review: { ...(generated.review as Record<string, unknown>), model: QWEN_MODEL, provider: "openrouter", reviewStatus: "completed" } });
        }
      } catch { /* Runtime validation handles malformed generated content. */ }
      return content;
    },
  };
}

export function createOpenRouterQwenProviderFromEnv(env: Record<string, string | undefined> = process.env, onUsage?: UsageReporter): QwenProvider | undefined {
  if (!env.OPENROUTER_API_KEY) return undefined;
  return createOpenRouterQwenProvider({ apiKey: env.OPENROUTER_API_KEY, onUsage });
}
