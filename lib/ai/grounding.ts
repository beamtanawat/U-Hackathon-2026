import type { AuthoritativeAssessment, ExplanationOutput } from "./types";

export const GROUNDING_LIMITS = {
  summary: 400,
  nextStep: 240,
  reasonText: 300,
  reasons: 6,
  questions: 4,
  questionText: 200,
} as const;

// Qwen never receives monetary values, so any digit in its prose is invented.
const DIGIT = /\d/;

const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bguarantee/i, "guarantee_claim"],
  [/\b(definitely|certainly|100\s?%|risk[- ]?free|no risk|zero risk|(completely|totally|perfectly|absolutely) safe)\b/i, "certainty_claim"],
  [/\b(is|are)\s+(definitely\s+)?(a\s+)?(scam|scammer|fraud|fraudster)s?\b/i, "fraud_certainty_claim"],
  [/\bsafe to (pay|send|proceed|transfer)\b/i, "safe_to_pay_claim"],
  [/\b(go ahead|proceed now|send (it )?now|transfer (it )?now|pay now)\b/i, "pressure_to_proceed"],
  [/\bI (have |will )?(sent|send|transferred|transfer|executed|execute|blocked|block|approved|approve)\b/i, "action_claim"],
];

const SAFE_CLAIM = /\b(is|looks|seems|appears|remains)\s+(fine|safe|okay|ok)\b/i;

/**
 * Deterministic checks on Qwen prose. Evidence IDs are checked separately in
 * comparison.ts; these rules catch invented numbers, guarantees, fraud
 * certainty, claims that contradict a non-Safe status, and oversized output.
 */
export function checkGrounding(explanation: ExplanationOutput, assessment: AuthoritativeAssessment): string[] {
  const violations = new Set<string>();
  const texts: Array<[string, string, number]> = [
    ["summary", explanation.summary, GROUNDING_LIMITS.summary],
    ["nextStep", explanation.nextStep, GROUNDING_LIMITS.nextStep],
    ...explanation.reasons.map((reason, index): [string, string, number] => [`reasons[${index}]`, reason.text, GROUNDING_LIMITS.reasonText]),
    ...explanation.missingContextQuestions.map((question, index): [string, string, number] => [`missingContextQuestions[${index}]`, question.question, GROUNDING_LIMITS.questionText]),
  ];
  if (explanation.reasons.length > GROUNDING_LIMITS.reasons) violations.add("too_many_reasons");
  if (explanation.missingContextQuestions.length > GROUNDING_LIMITS.questions) violations.add("too_many_questions");
  for (const [field, text, limit] of texts) {
    if (text.length > limit) violations.add(`${field}:too_long`);
    if (DIGIT.test(text)) violations.add(`${field}:invented_number`);
    for (const [pattern, code] of FORBIDDEN) if (pattern.test(text)) violations.add(`${field}:${code}`);
    if (assessment.financial.status !== "safe" && SAFE_CLAIM.test(text)) violations.add(`${field}:contradicts_financial_status`);
  }
  for (const [index, reason] of explanation.reasons.entries()) {
    if (reason.category === "trust" && reason.evidenceIds.length === 0) violations.add(`reasons[${index}]:trust_reason_without_evidence`);
  }
  return [...violations].sort();
}
