import type { AuthoritativeAssessment, ExplanationOutput, ExplanationReason, MissingContextQuestion, Provenance, QwenAnalysis, QwenIndicator, QwenReview, SuggestedIndicator } from "./types.ts";

const PROVENANCE = new Set<Provenance>(["host-provided", "user-provided", "derived", "simulated", "unavailable"]);
const CATEGORIES = new Set<ExplanationReason["category"]>(["financial", "trust", "missing_context"]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || expected.some((key) => !Object.hasOwn(value, key))) throw new Error(`${label} has unexpected fields`);
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
  return value;
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be a string array`);
  return [...value];
}

function json(raw: string): unknown {
  try { return JSON.parse(raw); } catch { throw new Error("provider returned invalid JSON"); }
}

export function assertAuthoritativeAssessment(value: unknown): asserts value is AuthoritativeAssessment {
  const assessment = record(value, "assessment");
  exactKeys(assessment, ["financial", "trust"], "assessment");
  const financial = record(assessment.financial, "assessment.financial");
  exactKeys(financial, ["status", "safeToSpendBefore", "safeToSpendAfter", "transactionAmount", "reasons", "missingFields"], "assessment.financial");
  if (financial.status !== "safe" && financial.status !== "review" && financial.status !== "high_risk") throw new Error("invalid financial status");
  for (const field of ["safeToSpendBefore", "safeToSpendAfter", "transactionAmount"] as const) {
    if (typeof financial[field] !== "number" || !Number.isFinite(financial[field])) throw new Error(`invalid financial ${field}`);
  }
  if (!Array.isArray(financial.reasons)) throw new Error("financial reasons must be an array");
  for (const [index, item] of financial.reasons.entries()) {
    const reason = record(item, `financial.reasons[${index}]`);
    exactKeys(reason, ["code", "message"], `financial.reasons[${index}]`);
    string(reason.code, `financial.reasons[${index}].code`);
    string(reason.message, `financial.reasons[${index}].message`);
  }
  strings(financial.missingFields, "financial.missingFields");

  const trust = record(assessment.trust, "assessment.trust");
  exactKeys(trust, ["status", "indicators", "missingFields"], "assessment.trust");
  if (trust.status !== "low" && trust.status !== "review" && trust.status !== "high" && trust.status !== "unknown") throw new Error("invalid trust status");
  if (!Array.isArray(trust.indicators)) throw new Error("trust indicators must be an array");
  const evidenceIds = new Set<string>();
  for (const [index, item] of trust.indicators.entries()) {
    const indicator = record(item, `trust.indicators[${index}]`);
    exactKeys(indicator, ["id", "kind", "evidence", "provenance"], `trust.indicators[${index}]`);
    const id = string(indicator.id, `trust.indicators[${index}].id`);
    if (evidenceIds.has(id)) throw new Error("duplicate indicator evidence ID");
    evidenceIds.add(id);
    string(indicator.kind, `trust.indicators[${index}].kind`);
    string(indicator.evidence, `trust.indicators[${index}].evidence`);
    const provenance = string(indicator.provenance, `trust.indicators[${index}].provenance`) as Provenance;
    if (!PROVENANCE.has(provenance)) throw new Error("invalid indicator provenance");
  }
  strings(trust.missingFields, "trust.missingFields");
}

function parseExplanationValue(value: Record<string, unknown>): ExplanationOutput {
  const reasons = Array.isArray(value.reasons) ? value.reasons.map((item, index): ExplanationReason => {
    const reason = record(item, `reasons[${index}]`);
    const category = string(reason.category, `reasons[${index}].category`) as ExplanationReason["category"];
    if (!CATEGORIES.has(category)) throw new Error("invalid reason category");
    return { category, text: string(reason.text, `reasons[${index}].text`), evidenceIds: strings(reason.evidenceIds, `reasons[${index}].evidenceIds`) };
  }) : (() => { throw new Error("reasons must be an array"); })();
  const missingContextQuestions = Array.isArray(value.missingContextQuestions) ? value.missingContextQuestions.map((item, index): MissingContextQuestion => {
    const question = record(item, `missingContextQuestions[${index}]`);
    return { field: string(question.field, "question field"), question: string(question.question, "question") };
  }) : (() => { throw new Error("missingContextQuestions must be an array"); })();
  const suggestedIndicators = Array.isArray(value.suggestedIndicators) ? value.suggestedIndicators.map((item, index): SuggestedIndicator => {
    const indicator = record(item, `suggestedIndicators[${index}]`);
    return { kind: string(indicator.kind, "indicator kind"), evidenceIds: strings(indicator.evidenceIds, "indicator evidenceIds") };
  }) : (() => { throw new Error("suggestedIndicators must be an array"); })();
  return { summary: string(value.summary, "summary"), reasons, nextStep: string(value.nextStep, "nextStep"), missingContextQuestions, suggestedIndicators };
}

function parseQwenReviewValue(value: Record<string, unknown>): QwenReview {
  if (value.provider !== "openrouter" || value.reviewStatus !== "completed") throw new Error("invalid Qwen provider metadata");
  if (value.model !== "qwen/qwen3.5-9b") throw new Error("invalid Qwen model attribution");
  const indicators = Array.isArray(value.indicators) ? value.indicators.map((item, index): QwenIndicator => {
    const indicator = record(item, `indicators[${index}]`);
    const provenance = string(indicator.provenance, "indicator provenance") as Provenance;
    if (!PROVENANCE.has(provenance)) throw new Error("invalid indicator provenance");
    return {
      type: string(indicator.type, "indicator type"),
      evidenceId: string(indicator.evidenceId, "indicator evidenceId"),
      evidence: string(indicator.evidence, "indicator evidence"),
      provenance,
    };
  }) : (() => { throw new Error("indicators must be an array"); })();
  if (typeof value.suggestedEscalation !== "boolean") throw new Error("suggestedEscalation must be boolean");
  return {
    model: "qwen/qwen3.5-9b", provider: "openrouter", reviewStatus: "completed", indicators,
    missingContext: strings(value.missingContext, "missingContext"),
    contradictions: strings(value.contradictions, "contradictions"),
    suggestedEscalation: value.suggestedEscalation,
    reasoningSummary: string(value.reasoningSummary, "reasoningSummary"),
  };
}

export function parseQwenAnalysis(raw: string): QwenAnalysis {
  const value = record(json(raw), "Qwen analysis");
  exactKeys(value, ["explanation", "review"], "Qwen analysis");
  return {
    explanation: parseExplanationValue(record(value.explanation, "Qwen explanation")),
    review: parseQwenReviewValue(record(value.review, "Qwen review")),
  };
}
