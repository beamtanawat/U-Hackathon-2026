import type { AuthoritativeAssessment, Explanation, ExplanationReason, MissingContextQuestion } from "./types";

const QUESTION_COPY: Record<string, string> = {
  recipientHistory: "Is this a recipient you have paid and independently verified before?",
  recipient: "Can you independently verify the recipient before deciding?",
  messageContext: "Was any reason or instruction supplied with this payment request?",
};

export function fallbackExplanation(assessment: AuthoritativeAssessment, reviewStatus: "not_run" | "unavailable"): Explanation {
  const reasons: ExplanationReason[] = assessment.financial.reasons.map((reason) => ({ category: "financial", text: reason.message, evidenceIds: [] }));
  reasons.push(...assessment.trust.indicators.map((indicator) => ({ category: "trust" as const, text: indicator.evidence, evidenceIds: [indicator.id] })));
  if (assessment.trust.indicators.length === 0 && assessment.trust.status === "unknown") {
    reasons.push({ category: "trust", text: "Recipient or transaction context is incomplete, so trust remains unknown.", evidenceIds: [] });
  }
  const fields = [...new Set([...assessment.financial.missingFields, ...assessment.trust.missingFields])];
  const missingContextQuestions: MissingContextQuestion[] = fields.map((field) => ({ field, question: QUESTION_COPY[field] ?? `Can you provide the missing ${field} context before deciding?` }));
  const summary = assessment.financial.status === "safe"
    ? "The authoritative assessment says required commitments remain covered after this transaction."
    : assessment.financial.status === "review"
      ? "The authoritative assessment recommends review because this transaction may affect protected money or goals."
      : "The authoritative assessment indicates this transaction would leave required commitments uncovered.";
  const nextStep = assessment.trust.status === "high"
    ? "Verify the recipient and request independently, or cancel the transaction."
    : assessment.financial.status === "high_risk"
      ? "Reduce or postpone the transaction, then review the authoritative assessment again."
      : "Review the amount and recipient, then decide whether to continue.";
  return { summary, reasons, nextStep, source: "fallback", review: { status: reviewStatus }, missingContextQuestions, suggestedIndicators: [] };
}
