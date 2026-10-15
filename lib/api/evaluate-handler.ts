import { runAiAnalysis, selectAiRoute } from "../ai/explanation";
import { createOpenRouterJevProviderFromEnv } from "../ai/jev";
import { createOpenRouterQwenProviderFromEnv } from "../ai/openrouter";
import { assertAuthoritativeAssessment } from "../ai/schema";
import type { JevProvider, QwenProvider, UsageEvent, UsageReporter } from "../ai/types";
import { evaluationRequestSchema, financialAssessmentSchema, trustAssessmentSchema } from "../domain/schemas";
import type { EvaluationRequest, FinancialAssessment, TrustAssessment } from "../domain/types";
import { evaluateSafeToPay } from "../engine/safe-to-pay";
import { assessTrust } from "../ml/risk-classifier";
import { buildBreakdown, recommendActions, toAuthoritativeAssessment, toTransactionContext } from "./adapter";
import { aiEnabledByEnv, clientKey, createAiBudget, createRateLimiter, readJsonBody, RequestError, type AiMode } from "./guards";

export const ENGINE_VERSION = "safe-to-pay-rules v1 + scam-context-v1";
const ROUTE_CALLS = { none: 0, qwen: 1, qwen_jev: 2 } as const;

export interface FinancialEngine {
  financial(request: EvaluationRequest): FinancialAssessment;
  trust(request: EvaluationRequest): TrustAssessment;
}

export const archayEngine: FinancialEngine = { financial: evaluateSafeToPay, trust: assessTrust };

export interface EvaluateDependencies {
  engine?: FinancialEngine;
  env?: Record<string, string | undefined>;
  /** Injected providers (tests). When omitted they are created from env only if AI_MODE=live. */
  qwenProvider?: QwenProvider;
  jevProvider?: JevProvider;
  rateLimit?: { limit: number; windowMs: number };
  maxAiCallsPerHour?: number;
  now?: () => number;
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function error(status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return json({ error: { code, message, ...extra } }, status, headers);
}

export function createEvaluateHandler(dependencies: EvaluateDependencies = {}): (request: Request) => Promise<Response> {
  const env = dependencies.env ?? process.env;
  const engine = dependencies.engine ?? archayEngine;
  const limiter = createRateLimiter({ ...(dependencies.rateLimit ?? { limit: 20, windowMs: 60_000 }), now: dependencies.now });
  const budget = createAiBudget({ maxCallsPerHour: dependencies.maxAiCallsPerHour ?? (Number(env.AI_MAX_CALLS_PER_HOUR) || 20), now: dependencies.now });
  const injected = dependencies.qwenProvider !== undefined || dependencies.jevProvider !== undefined;
  const aiConfigured = injected ? dependencies.qwenProvider !== undefined : aiEnabledByEnv(env);
  // Providers are built per request so each response reports only its own usage.
  const providersFor = (onUsage: UsageReporter): { qwenProvider?: QwenProvider; jevProvider?: JevProvider } => injected
    ? { qwenProvider: dependencies.qwenProvider, jevProvider: dependencies.jevProvider }
    : { qwenProvider: createOpenRouterQwenProviderFromEnv(env, onUsage), jevProvider: createOpenRouterJevProviderFromEnv(env, onUsage) };

  return async function evaluate(request: Request): Promise<Response> {
    const slot = limiter.take(clientKey(request));
    if (!slot.allowed) {
      return error(429, "rate_limited", "Too many evaluation requests. Try again shortly.", {}, { "Retry-After": String(slot.retryAfterSeconds) });
    }

    let body: unknown;
    try { body = await readJsonBody(request); }
    catch (cause) {
      if (cause instanceof RequestError) return error(cause.status, cause.code, cause.message);
      return error(400, "invalid_request", "Request body must be valid JSON.");
    }

    const parsed = evaluationRequestSchema.safeParse(body);
    if (!parsed.success) {
      // Report where validation failed, never the submitted values.
      const issues = parsed.error.issues.slice(0, 10).map((issue) => ({ path: issue.path.join("."), message: issue.message }));
      return error(400, "invalid_request", "Request body does not match the evaluation contract.", { issues });
    }
    const input = parsed.data;

    let financial: FinancialAssessment;
    let trust: TrustAssessment;
    let authoritative;
    try {
      financial = financialAssessmentSchema.parse(engine.financial(input));
      trust = trustAssessmentSchema.parse(engine.trust(input));
      authoritative = toAuthoritativeAssessment(input, financial, trust);
      assertAuthoritativeAssessment(authoritative);
    } catch {
      return error(503, "assessment_unavailable", "The authoritative assessment could not be produced.");
    }

    const route = selectAiRoute(authoritative);
    let mode: AiMode = aiConfigured ? "live" : "disabled";
    if (aiConfigured && request.headers.get("x-uh-ai") === "off") mode = "client_opt_out";
    else if (aiConfigured && !budget.reserve(ROUTE_CALLS[route])) mode = "budget_exhausted";
    const usage: UsageEvent[] = [];
    const providers = mode === "live" ? providersFor((event) => usage.push(event)) : {};
    const analysis = await runAiAnalysis({ assessment: authoritative, transaction: toTransactionContext(input) }, providers);
    const { authoritativeAssessment, ...ai } = analysis;

    return json({
      simulation: true,
      engineVersion: ENGINE_VERSION,
      assessment: { financial, trust },
      breakdown: buildBreakdown(input, financial),
      reasons: { financial: authoritativeAssessment.financial.reasons, trust: authoritativeAssessment.trust.indicators },
      missingContext: { financial: financial.missingFields, trust: authoritativeAssessment.trust.missingFields },
      recommendedActions: recommendActions(financial, trust),
      ai: { mode, route, ...ai, usage },
    });
  };
}
