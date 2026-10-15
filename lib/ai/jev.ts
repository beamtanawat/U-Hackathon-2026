import { OpenRouterError } from "./openrouter";
import type { JevDecision, JevProvider, UsageEvent, UsageReporter } from "./types";

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
export const JEV_MODEL = "typesafe/jev-1.14" as const;

export function createOpenRouterJevProvider(options: { apiKey: string; fetchImpl?: typeof fetch; onUsage?: UsageReporter }): JevProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async verify(request, signal): Promise<JevDecision> {
      let response: Response;
      try {
        response = await fetchImpl(ENDPOINT, {
          method: "POST", signal,
          headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: JEV_MODEL,
            state: request,
            questions: {
              needs_review: {
                type: "noul",
                instructions: "Does the sanitized state support additional human review without changing the authoritative assessment?",
                criteria: {
                  true: "Missing context or evidence-backed risk makes independent review appropriate.",
                  false: "The supplied state does not support additional review.",
                },
              },
            },
          }),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new OpenRouterError("OpenRouter Jev request failed");
      }
      if (!response.ok) throw new OpenRouterError(`OpenRouter Jev request failed with HTTP ${response.status}`, response.status);
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new OpenRouterError("OpenRouter Jev returned invalid response JSON"); }
      const value = payload as { model?: unknown; answers?: { needs_review?: { type?: unknown; noul?: unknown } }; usage?: Record<string, unknown> };
      if (typeof value.model !== "string") throw new OpenRouterError("OpenRouter Jev response is missing model attribution");
      if (value.model !== JEV_MODEL && !value.model.startsWith(`${JEV_MODEL}-`)) throw new OpenRouterError("OpenRouter Jev returned an unexpected model");
      const answer = value.answers?.needs_review;
      if (answer?.type !== "noul" || typeof answer.noul !== "number" || answer.noul < 0 || answer.noul > 1) throw new OpenRouterError("OpenRouter Jev response is missing a valid decision");
      const usage = value.usage;
      if (usage && options.onUsage) {
        const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
        const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
        const event: UsageEvent = { provider: "openrouter", model: JEV_MODEL, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costUsd: typeof usage.cost === "number" ? usage.cost : null };
        try { options.onUsage(event); } catch { /* Observability must not affect decisions. */ }
      }
      return { model: JEV_MODEL, provider: "openrouter", decisionStatus: "completed", reviewProbability: answer.noul, suggestedEscalation: answer.noul >= 0.5 };
    },
  };
}

export function createOpenRouterJevProviderFromEnv(env: Record<string, string | undefined> = process.env, onUsage?: UsageReporter): JevProvider | undefined {
  if (!env.OPENROUTER_API_KEY) return undefined;
  return createOpenRouterJevProvider({ apiKey: env.OPENROUTER_API_KEY, onUsage });
}
