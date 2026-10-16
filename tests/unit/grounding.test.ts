import { describe, expect, it } from "vitest";

import { runAiAnalysis } from "../../lib/ai/explanation";
import { checkGrounding } from "../../lib/ai/grounding";
import type { AuthoritativeAssessment, ExplanationOutput, QwenProvider, TransactionContext } from "../../lib/ai/types";

const review: AuthoritativeAssessment = {
  financial: { status: "review", safeToSpendBefore: 5_500, safeToSpendAfter: -100, transactionAmount: 5_600, reasons: [{ code: "USES_PROTECTED_BUFFER", message: "Uses part of the protected buffer." }], missingFields: [] },
  trust: { status: "low", indicators: [], missingFields: [] },
};
const transaction: TransactionContext = {
  walletType: "spending", transferMode: "u_tag", asset: "THB", network: null,
  recipient: { kind: "u_tag", known: true, provenance: "simulated" },
};
const clean: ExplanationOutput = {
  summary: "This payment would use part of your protected buffer, so it needs a closer look.",
  reasons: [{ category: "financial", text: "Your commitments stay covered but the buffer shrinks.", evidenceIds: [] }],
  nextStep: "Consider reducing the amount or waiting until after payday.",
  missingContextQuestions: [],
  suggestedIndicators: [],
};
const qwenReview = { model: "qwen/qwen3.5-9b", provider: "openrouter", reviewStatus: "completed", indicators: [], missingContext: [], contradictions: [], suggestedEscalation: false, reasoningSummary: "Consistent." };
const qwen = (explanation: ExplanationOutput): QwenProvider => ({
  async analyze() { return JSON.stringify({ explanation, review: qwenReview }); },
});

describe("Qwen grounding guard", () => {
  it("accepts grounded prose", () => {
    expect(checkGrounding(clean, review)).toEqual([]);
  });

  it.each([
    ["This transfer is guaranteed safe.", "summary:guarantee_claim"],
    ["Your balance after is 999,999 THB.", "summary:invented_number"],
    ["This recipient is a scam.", "summary:fraud_certainty_claim"],
    ["It is safe to pay this person.", "summary:safe_to_pay_claim"],
    ["Everything looks fine.", "summary:contradicts_financial_status"],
    ["I have transferred the money.", "summary:action_claim"],
    ["x".repeat(401), "summary:too_long"],
  ])("rejects %s", (summary, violation) => {
    expect(checkGrounding({ ...clean, summary }, review)).toContain(violation);
  });

  it("rejects a trust reason without evidence", () => {
    const output = { ...clean, reasons: [{ category: "trust" as const, text: "The recipient seems risky.", evidenceIds: [] }] };
    expect(checkGrounding(output, review)).toContain("reasons[0]:trust_reason_without_evidence");
  });

  it("falls back to the deterministic explanation when Qwen prose is ungrounded", async () => {
    const result = await runAiAnalysis(
      { assessment: review, transaction },
      { qwenProvider: qwen({ ...clean, summary: "This transfer is guaranteed safe. Your balance after is 999,999 THB.", nextStep: "Proceed now." }) },
    );
    expect(result.explanation.source).toBe("fallback");
    expect(result.grounding.accepted).toBe(false);
    expect(result.grounding.violations).toEqual(expect.arrayContaining(["summary:guarantee_claim", "summary:invented_number", "nextStep:pressure_to_proceed"]));
    expect(result.authoritativeAssessment).toEqual(review);
  });

  it("uses grounded Qwen prose", async () => {
    const result = await runAiAnalysis({ assessment: review, transaction }, { qwenProvider: qwen(clean) });
    expect(result.explanation.source).toBe("qwen");
    expect(result.grounding).toEqual({ accepted: true, violations: [] });
  });
});
