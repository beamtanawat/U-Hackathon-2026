import type { z } from "zod";

import type {
  evaluationRequestSchema,
  financialAssessmentSchema,
  provenanceSchema,
  safetyAssessmentSchema,
  trustAssessmentSchema,
} from "./schemas";

export type Provenance = z.infer<typeof provenanceSchema>;
export type EvaluationRequest = z.infer<typeof evaluationRequestSchema>;
export type FinancialAssessment = z.infer<typeof financialAssessmentSchema>;
export type TrustAssessment = z.infer<typeof trustAssessmentSchema>;
export type SafetyAssessment = z.infer<typeof safetyAssessmentSchema>;
