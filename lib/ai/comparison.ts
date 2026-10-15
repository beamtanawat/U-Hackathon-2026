import type { AuthoritativeAssessment, ComparisonResult, JevDecision, ProviderStatus, QwenAnalysis } from "./types";

export function compareAnalyses(
  assessment: AuthoritativeAssessment,
  qwen: QwenAnalysis | null,
  jev: JevDecision | null,
  providerStatus: { qwen: ProviderStatus; jev: ProviderStatus },
): ComparisonResult {
  const evidence = new Map(assessment.trust.indicators.map((indicator) => [indicator.id, indicator]));
  const unsupportedClaims: ComparisonResult["unsupportedClaims"] = [];
  const explanationSupported = new Set<string>();
  const reviewSupported = new Set<string>();
  const missingFields = new Set([...assessment.financial.missingFields, ...assessment.trust.missingFields]);
  for (const reason of qwen?.explanation.reasons ?? []) {
    for (const evidenceId of reason.evidenceIds) if (!evidence.has(evidenceId)) unsupportedClaims.push({ provider: "qwen", type: `${reason.category}_reason`, evidenceId });
  }
  for (const question of qwen?.explanation.missingContextQuestions ?? []) {
    if (!missingFields.has(question.field)) unsupportedClaims.push({ provider: "qwen", type: "missing_context", evidenceId: question.field });
  }
  for (const indicator of qwen?.explanation.suggestedIndicators ?? []) {
    if (indicator.evidenceIds.length === 0 || indicator.evidenceIds.some((id) => !evidence.has(id))) unsupportedClaims.push({ provider: "qwen", type: indicator.kind, evidenceId: indicator.evidenceIds.find((id) => !evidence.has(id)) ?? "missing" });
    else explanationSupported.add(indicator.kind);
  }
  const qwenSupportedIndicators: ComparisonResult["qwenSupportedIndicators"] = [];
  for (const indicator of qwen?.review.indicators ?? []) {
    const source = evidence.get(indicator.evidenceId);
    if (!source || source.provenance !== indicator.provenance) unsupportedClaims.push({ provider: "qwen", type: indicator.type, evidenceId: indicator.evidenceId });
    else {
      reviewSupported.add(indicator.type);
      qwenSupportedIndicators.push({ type: indicator.type, evidenceId: indicator.evidenceId, provenance: source.provenance });
    }
  }
  const supportedAgreement = [...explanationSupported].filter((kind) => reviewSupported.has(kind)).sort();
  const differingKinds = new Set([...explanationSupported].filter((kind) => !reviewSupported.has(kind)).concat([...reviewSupported].filter((kind) => !explanationSupported.has(kind))));
  return {
    providerStatus,
    supportedAgreement,
    differingFindings: [...differingKinds].sort().map((type) => ({ provider: "qwen" as const, type })),
    qwenSupportedIndicators,
    unsupportedClaims,
    missingEvidence: unsupportedClaims.map((claim) => claim.evidenceId),
    contradictions: qwen?.review.contradictions ?? [],
    suggestedEscalation: explanationSupported.size > 0 || reviewSupported.size > 0,
    jevVerification: providerStatus.jev === "unavailable" ? "unavailable" : !jev ? "not_run" : jev.suggestedEscalation ? "supports_review" : "does_not_support_review",
  };
}
