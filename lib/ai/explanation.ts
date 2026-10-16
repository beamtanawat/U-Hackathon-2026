import { compareAnalyses } from "./comparison";
import { fallbackExplanation } from "./fallback";
import { checkGrounding } from "./grounding";
import { QWEN_SYSTEM_PROMPT } from "./prompt";
import { parseQwenAnalysis } from "./schema";
import type { AiDecisionSupport, AiRoute, AuthoritativeAssessment, JevDecision, JevProvider, JevVerificationRequest, ProviderContext, ProviderRequest, ProviderStatus, QwenAnalysis, QwenProvider, TransactionContext } from "./types";

export const QWEN_TIMEOUT_MS = 12_000;
export const JEV_TIMEOUT_MS = 5_000;

function providerContext(assessment: AuthoritativeAssessment, transaction: TransactionContext): ProviderContext {
  return {
    financialStatus: assessment.financial.status,
    financialReasonCodes: assessment.financial.reasons.map((reason) => reason.code),
    trustStatus: assessment.trust.status,
    trustIndicators: assessment.trust.indicators.map(({ id, kind, provenance }) => ({ id, kind, provenance })),
    missingFields: [...new Set([...assessment.financial.missingFields, ...assessment.trust.missingFields])],
    walletType: transaction.walletType, transferMode: transaction.transferMode, asset: transaction.asset,
    network: transaction.network, recipientKnown: transaction.recipient.known, recipientProvenance: transaction.recipient.provenance,
  };
}

export function buildQwenRequest(assessment: AuthoritativeAssessment, transaction: TransactionContext): ProviderRequest {
  return { system: QWEN_SYSTEM_PROMPT, context: providerContext(assessment, transaction) };
}

export function selectAiRoute(assessment: AuthoritativeAssessment): AiRoute {
  if (assessment.financial.status === "safe" && assessment.trust.status === "low" && assessment.trust.indicators.length === 0) return "none";
  return "jev_qwen";
}

async function withinTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("provider timeout")); }, timeoutMs); });
  try { return await Promise.race([operation(controller.signal), timeout]); }
  finally { if (timer) clearTimeout(timer); }
}

async function runQwen(provider: QwenProvider | undefined, request: ProviderRequest, timeoutMs: number, route: AiRoute): Promise<{ output: QwenAnalysis | null; status: ProviderStatus }> {
  if (route === "none") return { output: null, status: "not_run" };
  if (!provider) return { output: null, status: "unavailable" };
  try { return { output: parseQwenAnalysis(await withinTimeout((signal) => provider.analyze(request, signal), timeoutMs)), status: "completed" }; }
  catch { return { output: null, status: "unavailable" }; }
}

async function runJev(provider: JevProvider | undefined, request: JevVerificationRequest, timeoutMs: number): Promise<{ output: JevDecision | null; status: ProviderStatus }> {
  if (!provider) return { output: null, status: "unavailable" };
  try {
    const output = await withinTimeout((signal) => provider.verify(request, signal), timeoutMs);
    if (output.model !== "typesafe/jev-1.14" || output.provider !== "openrouter" || output.decisionStatus !== "completed"
      || !Number.isFinite(output.reviewProbability) || output.reviewProbability < 0 || output.reviewProbability > 1
      || output.suggestedEscalation !== (output.reviewProbability >= 0.5)) throw new Error("invalid Jev decision");
    return { output, status: "completed" };
  }
  catch { return { output: null, status: "unavailable" }; }
}

export async function runAiAnalysis(
  input: { assessment: AuthoritativeAssessment; transaction: TransactionContext },
  options: { qwenProvider?: QwenProvider; jevProvider?: JevProvider; qwenTimeoutMs?: number; jevTimeoutMs?: number } = {},
): Promise<AiDecisionSupport> {
  const authoritativeAssessment = structuredClone(input.assessment);
  const route = selectAiRoute(authoritativeAssessment);
  const request = buildQwenRequest(authoritativeAssessment, input.transaction);
  let jev: { output: JevDecision | null; status: ProviderStatus } = { output: null, status: "not_run" };
  if (route === "jev_qwen") {
    jev = await runJev(options.jevProvider, { context: request.context }, options.jevTimeoutMs ?? JEV_TIMEOUT_MS);
  }
  const qwen = await runQwen(options.qwenProvider, request, options.qwenTimeoutMs ?? QWEN_TIMEOUT_MS, route);
  const comparison = compareAnalyses(authoritativeAssessment, qwen.output, jev.output, { qwen: qwen.status, jev: jev.status });
  const violations = qwen.output ? checkGrounding(qwen.output.explanation, authoritativeAssessment) : [];
  const accepted = qwen.output !== null && comparison.unsupportedClaims.length === 0 && violations.length === 0;
  const explanation = accepted && qwen.output
    ? { ...qwen.output.explanation, source: "qwen" as const, review: { status: (comparison.suggestedEscalation ? "suggested_escalation" : "consistent") as "suggested_escalation" | "consistent" } }
    : fallbackExplanation(authoritativeAssessment, qwen.status === "not_run" ? "not_run" : "unavailable");
  return { authoritativeAssessment, explanation, grounding: { accepted, violations }, qwenReview: qwen.output?.review ?? null, jevDecision: jev.output, comparison };
}
