import { describe, expect, it } from "vitest";

import scenarioA from "../../examples/demo-scenarios/scenario-a-safe-u-tag.json";
import scenarioB from "../../examples/demo-scenarios/scenario-b-insufficient-safe-to-spend.json";
import { createEvaluateHandler } from "../../lib/api/evaluate-handler";
import type { JevProvider, QwenProvider } from "../../lib/ai/types";

const post = (body: unknown, ip: string) =>
  new Request("http://localhost/api/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
const user = <T>(value: T) => ({ value, provenance: "user_provided" as const });

describe("scenario coverage beyond A/B/C", () => {
  it("keeps a Safe payment Safe while the recipient is High risk (financial and trust are independent)", async () => {
    const request = structuredClone(scenarioA.request) as Record<string, any>;
    delete request.scenarioId;
    request.recipient.identifier = user("@new-contact");
    request.recipient.isNew = { value: true, provenance: "simulated" };
    request.recipient.previousTransactionCount = { value: 0, provenance: "simulated" };
    request.context.urgency = user(true);
    request.context.secrecyRequest = user(true);

    const body = await (await createEvaluateHandler({ env: {} })(post(request, "198.51.100.71"))).json();
    expect(body.assessment.financial.status).toBe("safe");
    expect(body.assessment.trust.status).toBe("high");
    expect(body.recommendedActions).toEqual(["verify_recipient", "cancel"]);
  });

  it("re-evaluates Scenario B with a U-Bot partition edit sent as user-provided values", async () => {
    const request = structuredClone(scenarioB.request) as Record<string, any>;
    delete request.scenarioId;
    request.protectedBuffer = user(4_000);

    const body = await (await createEvaluateHandler({ env: {} })(post(request, "198.51.100.72"))).json();
    expect(body.assessment.financial.status).toBe("high_risk");
    expect(body.breakdown.protectedBuffer).toBe(4_000);
    expect(body.breakdown.maxSafeAmount).toBe(4_500);
  });

  it("lets a larger buffer turn Scenario A's payment into Review, decided by the engine", async () => {
    const request = structuredClone(scenarioA.request) as Record<string, any>;
    delete request.scenarioId;
    request.protectedBuffer = user(7_500);

    const body = await (await createEvaluateHandler({ env: {} })(post(request, "198.51.100.73"))).json();
    expect(body.breakdown.safeToSpendBefore).toBe(1_000);
    expect(body.assessment.financial.status).toBe("review");
  });
});

describe("Jev primary / Qwen secondary agreement and disagreement (mocked, no paid calls)", () => {
  const qwen = (suggestedEscalation: boolean): QwenProvider => ({
    async analyze() {
      return JSON.stringify({
        explanation: { summary: "This payment needs a closer look before you decide.", reasons: [], nextStep: "Review the details and choose what to do.", missingContextQuestions: [], suggestedIndicators: [] },
        review: { model: "qwen/qwen3.5-9b", provider: "openrouter", reviewStatus: "completed", indicators: [], missingContext: [], contradictions: [], suggestedEscalation, reasoningSummary: "Reviewed." },
      });
    },
  });
  const jev = (reviewProbability: number): JevProvider => ({
    async verify() {
      return { model: "typesafe/jev-1.14", provider: "openrouter", decisionStatus: "completed", reviewProbability, suggestedEscalation: reviewProbability >= 0.5 };
    },
  });

  it.each([
    ["agree on review", 0.9, true, "supports_review"],
    ["disagree: Jev escalates, Qwen does not", 0.9, false, "supports_review"],
    ["disagree: Jev does not escalate", 0.1, true, "does_not_support_review"],
  ])("%s without changing the engine result", async (_label, probability, qwenEscalates, verification) => {
    const handler = createEvaluateHandler({ env: {}, qwenProvider: qwen(qwenEscalates), jevProvider: jev(probability) });
    const body = await (await handler(post(scenarioB.request, "198.51.100.74"))).json();

    expect(body.ai.route).toBe("jev_qwen");
    expect(body.ai.comparison.providerStatus).toEqual({ qwen: "completed", jev: "completed" });
    expect(body.ai.comparison.jevVerification).toBe(verification);
    expect(body.ai.jevDecision.reviewProbability).toBe(probability);
    expect(body.ai.qwenReview.suggestedEscalation).toBe(qwenEscalates);
    expect(body.assessment.financial).toEqual(scenarioB.expectedAssessment.financial);
    expect(body.ai.explanation.source).toBe("qwen");
  });
});
