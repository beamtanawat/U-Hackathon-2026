import assert from "node:assert/strict";
import test from "node:test";

import { createEvaluateHandler } from "../../app/api/evaluate/route.ts";
import type { ComparisonResult, QwenProvider } from "../../lib/ai/types.ts";
import { DEMO_SCENARIOS, type DemoScenario } from "../fixtures/demo-scenarios.ts";

type ProviderMode = "success" | "qwen_unavailable";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/evaluate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function expectedComparison(scenario: DemoScenario, qwenCompleted: boolean): ComparisonResult {
  const qwenRan = scenario.id !== "safe-u-tag";
  const kinds = qwenCompleted ? scenario.supportedIndicatorKinds : [];
  return {
    providerStatus: { qwen: !qwenRan ? "not_run" : qwenCompleted ? "completed" : "unavailable", jev: "not_run" },
    supportedAgreement: [...kinds],
    differingFindings: [],
    qwenSupportedIndicators: qwenCompleted ? scenario.qwen.indicators.map(({ type, evidenceId, provenance }) => ({ type, evidenceId, provenance })) : [],
    unsupportedClaims: [],
    missingEvidence: [],
    contradictions: qwenCompleted ? scenario.qwen.contradictions : [],
    suggestedEscalation: kinds.length > 0,
    jevVerification: "not_run",
  };
}

function assertExactKeys(value: unknown, expected: readonly string[], label: string): asserts value is Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} keys`);
}

function assertCompleteResponseShape(value: unknown): void {
  assertExactKeys(value, ["assessment", "ai"], "response");
  assertExactKeys(value.assessment, ["financial", "trust"], "assessment");
  assertExactKeys(value.ai, ["explanation", "qwenReview", "jevDecision", "comparison"], "ai");
  assertExactKeys(value.ai.explanation, ["summary", "reasons", "nextStep", "missingContextQuestions", "suggestedIndicators", "source", "review"], "explanation");
  if (value.ai.qwenReview !== null) assertExactKeys(value.ai.qwenReview, ["model", "provider", "reviewStatus", "indicators", "missingContext", "contradictions", "suggestedEscalation", "reasoningSummary"], "qwenReview");
  assertExactKeys(value.ai.comparison, ["providerStatus", "supportedAgreement", "differingFindings", "qwenSupportedIndicators", "unsupportedClaims", "missingEvidence", "contradictions", "suggestedEscalation", "jevVerification"], "comparison");
  assertExactKeys(value.ai.comparison.providerStatus, ["qwen", "jev"], "comparison.providerStatus");
}

for (const scenario of DEMO_SCENARIOS) {
  for (const mode of ["success", "qwen_unavailable"] as const satisfies readonly ProviderMode[]) {
    test(`${scenario.id}: canonical immutable response with ${mode}`, async () => {
      const fixtureBefore = structuredClone(scenario);
      let providerCalls = 0;
      const qwenProvider: QwenProvider = {
        async analyze() {
          providerCalls += 1;
          if (mode === "qwen_unavailable") throw new Error("fictional Qwen outage");
          return JSON.stringify({ explanation: scenario.explanation, review: scenario.qwen });
        },
      };
      const handler = createEvaluateHandler({
        engine: { async evaluate(request) { assert.deepEqual(request, scenario.request); return structuredClone(scenario.assessment); } },
        qwenProvider,
        env: {},
      });

      const response = await handler(jsonRequest(scenario.request));
      const body: unknown = await response.json();
      const qwenRan = scenario.id !== "safe-u-tag";
      const qwenCompleted = qwenRan && mode === "success";

      assert.equal(response.status, 200);
      assert.equal(providerCalls, qwenRan ? 1 : 0);
      assertCompleteResponseShape(body);
      assert.deepEqual(body, {
        assessment: scenario.assessment,
        ai: {
          explanation: qwenCompleted
            ? { ...scenario.explanation, source: "qwen", review: { status: scenario.supportedIndicatorKinds.length > 0 ? "suggested_escalation" : "consistent" } }
            : scenario.fallback,
          qwenReview: qwenCompleted ? scenario.qwen : null,
          jevDecision: null,
          comparison: expectedComparison(scenario, qwenCompleted),
        },
      });
      assert.deepEqual(scenario, fixtureBefore, "the handler must not mutate reusable fixtures");
    });
  }
}

test("fictional harness cannot replace the production default route", async () => {
  const route = await import("../../app/api/evaluate/route.ts");
  assert.notEqual(route.POST, createEvaluateHandler);
});
