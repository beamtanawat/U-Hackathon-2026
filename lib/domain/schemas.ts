import { z } from "zod";

export const provenanceSchema = z.enum([
  "host_provided",
  "user_provided",
  "llm_extracted",
  "derived",
  "simulated",
  "unavailable",
]);

const sourced = <T extends z.ZodType>(value: T) =>
  z
    .object({
      value,
      provenance: provenanceSchema,
    })
    .strict();

export const sourcedMoneySchema = sourced(z.number().finite().nonnegative().nullable());
export const sourcedCountSchema = sourced(z.number().int().nonnegative().nullable());
export const sourcedTextSchema = sourced(z.string().min(1).nullable());
export const sourcedFlagSchema = sourced(z.boolean().nullable());

export const evaluationRequestSchema = z
  .object({
    scenarioId: z.string().min(1).optional(),
    walletType: sourced(z.enum(["crypto", "spending"]).nullable()),
    transferMode: sourced(z.enum(["u_tag", "on_chain"]).nullable()),
    availableBalance: sourcedMoneySchema,
    essentialObligations: sourcedMoneySchema,
    debtDue: sourcedMoneySchema,
    protectedBuffer: sourcedMoneySchema,
    amount: sourcedMoneySchema,
    asset: sourcedTextSchema,
    network: sourcedTextSchema,
    recipient: z
      .object({
        kind: sourced(z.enum(["u_tag", "wallet_address"]).nullable()),
        identifier: sourcedTextSchema,
        isNew: sourcedFlagSchema,
        previousTransactionCount: sourcedCountSchema,
      })
      .strict(),
    recentMedianAmount: sourcedMoneySchema,
    context: z
      .object({
        urgency: sourcedFlagSchema,
        secrecyRequest: sourcedFlagSchema,
        guaranteedOrHighReturn: sourcedFlagSchema,
        impersonation: sourcedFlagSchema,
        unexpectedContact: sourcedFlagSchema,
        moveMoneyToProtect: sourcedFlagSchema,
        advanceFeeOrPrize: sourcedFlagSchema,
        romanceOrOnlineOnlyRelationship: sourcedFlagSchema,
        paymentMethodDemand: sourcedFlagSchema,
      })
      .strict(),
  })
  .strict();

export const financialAssessmentSchema = z
  .object({
    status: z.enum(["safe", "review", "high_risk"]),
    safeToSpendBefore: z.number().finite().nonnegative().nullable(),
    safeToSpendAfter: z.number().finite().nullable(),
    postTransactionBalance: z.number().finite().nullable(),
    affectedCommitments: z.array(z.string()),
    reasonCodes: z.array(z.string()),
    missingFields: z.array(z.string()),
  })
  .strict();

export const trustAssessmentSchema = z
  .object({
    status: z.enum(["not_assessed", "low", "review", "high", "unknown"]),
    riskScore: z.number().min(0).max(1).nullable(),
    indicators: z.array(z.string()),
    modelVersion: z.string().nullable(),
  })
  .strict();

export const safetyAssessmentSchema = z
  .object({
    financial: financialAssessmentSchema,
    trust: trustAssessmentSchema,
  })
  .strict();
