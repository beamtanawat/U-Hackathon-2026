import { z } from "zod";

export const provenanceSchema = z.enum([
  "host_provided",
  "user_provided",
  "llm_extracted",
  "derived",
  "simulated",
  "unavailable",
]);

/** Upper bound for any monetary input; rejects absurd or overflow-prone values. */
export const MAX_MONEY = 1_000_000_000_000;
export const MAX_IDENTIFIER_LENGTH = 128;

// A value is null exactly when its provenance is "unavailable", so a caller
// cannot submit evidence that is simultaneously asserted and unavailable.
const sourced = <T extends z.ZodType>(value: T) =>
  z
    .object({
      value,
      provenance: provenanceSchema,
    })
    .strict()
    .superRefine((input, context) => {
      if (((input as { value: unknown }).value === null) !== (input.provenance === "unavailable")) {
        context.addIssue({
          code: "custom",
          path: ["provenance"],
          message: "value must be null if and only if provenance is unavailable",
        });
      }
    });

const money = z.number().finite().nonnegative().max(MAX_MONEY);
const assetCode = z.string().regex(/^[A-Z0-9]{2,12}$/, "asset codes are 2-12 uppercase letters or digits");

export const sourcedMoneySchema = sourced(money.nullable());
export const sourcedAmountSchema = sourced(money.positive().nullable());
export const sourcedCountSchema = sourced(z.number().int().nonnegative().max(1_000_000).nullable());
export const sourcedTextSchema = sourced(z.string().min(1).max(MAX_IDENTIFIER_LENGTH).nullable());
export const sourcedAssetSchema = sourced(assetCode.nullable());
export const sourcedNetworkSchema = sourced(
  z.string().regex(/^[A-Za-z0-9 ._()-]{1,48}$/, "network names are 1-48 plain characters").nullable(),
);
export const sourcedFlagSchema = sourced(z.boolean().nullable());

export const evaluationRequestSchema = z
  .object({
    scenarioId: z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
    walletType: sourced(z.enum(["crypto", "spending"]).nullable()),
    transferMode: sourced(z.enum(["u_tag", "on_chain"]).nullable()),
    /** Currency of availableBalance, obligations, debt and buffer (for example THB). */
    currency: sourcedAssetSchema,
    availableBalance: sourcedMoneySchema,
    essentialObligations: sourcedMoneySchema,
    debtDue: sourcedMoneySchema,
    protectedBuffer: sourcedMoneySchema,
    amount: sourcedAmountSchema,
    /** Unit of amount and recentMedianAmount. */
    asset: sourcedAssetSchema,
    network: sourcedNetworkSchema,
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
