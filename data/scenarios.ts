import scenarioA from "../examples/demo-scenarios/scenario-a-safe-u-tag.json";
import scenarioB from "../examples/demo-scenarios/scenario-b-insufficient-safe-to-spend.json";
import scenarioC from "../examples/demo-scenarios/scenario-c-suspicious-crypto.json";
import { evaluationRequestSchema } from "../lib/domain/schemas";
import type { EvaluationRequest } from "../lib/domain/types";

// The JSON files under examples/demo-scenarios are the single canonical source
// for Scenario A/B/C; every layer (engine, API, frontend E2E) reads them.
export const scenarios = {
  safeUTag: evaluationRequestSchema.parse(scenarioA.request),
  insufficientSafeToSpend: evaluationRequestSchema.parse(scenarioB.request),
  suspiciousCrypto: evaluationRequestSchema.parse(scenarioC.request),
} satisfies Record<string, EvaluationRequest>;
