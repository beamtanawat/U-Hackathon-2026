import { describe, expect, it } from "vitest";
import { z } from "zod";

import scenarioA from "../../examples/demo-scenarios/scenario-a-safe-u-tag.json";
import scenarioB from "../../examples/demo-scenarios/scenario-b-protected-buffer.json";
import scenarioC from "../../examples/demo-scenarios/scenario-c-suspicious-crypto.json";
import manifest from "../../examples/demo-scenarios/manifest.json";
import {
  evaluationRequestSchema,
  safetyAssessmentSchema,
} from "../../lib/domain/schemas";
import { evaluateSafeToPay } from "../../lib/engine/safe-to-pay";
import { assessTrust } from "../../lib/ml/risk-classifier";

const demoScenarioSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    title: z.string().min(1),
    demoGoal: z.string().min(1),
    request: evaluationRequestSchema,
    expectedAssessment: safetyAssessmentSchema,
  })
  .strict();

const scenarios = [scenarioA, scenarioB, scenarioC];

describe("judge demo scenarios", () => {
  it("publishes a manifest in the intended A/B/C order", () => {
    expect(manifest).toEqual({
      schemaVersion: 1,
      scenarios: [
        "scenario-a-safe-u-tag.json",
        "scenario-b-protected-buffer.json",
        "scenario-c-suspicious-crypto.json",
      ],
    });
  });

  it.each(scenarios)("keeps $id synchronized with both decision engines", (input) => {
    const scenario = demoScenarioSchema.parse(input);
    const financial = evaluateSafeToPay(scenario.request);
    const trust = assessTrust(scenario.request);

    expect(financial).toEqual(scenario.expectedAssessment.financial);
    expect(trust.status).toBe(scenario.expectedAssessment.trust.status);
    expect(trust.indicators).toEqual(scenario.expectedAssessment.trust.indicators);
    expect(trust.modelVersion).toBe(scenario.expectedAssessment.trust.modelVersion);
    expect(trust.riskScore).toBeCloseTo(
      scenario.expectedAssessment.trust.riskScore ?? 0,
      12,
    );
  });
});
