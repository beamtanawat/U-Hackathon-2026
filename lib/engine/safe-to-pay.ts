import type { EvaluationRequest, FinancialAssessment } from "../domain/types";

export function evaluateSafeToPay(request: EvaluationRequest): FinancialAssessment {
  const fields = {
    availableBalance: request.availableBalance.value,
    essentialObligations: request.essentialObligations.value,
    debtDue: request.debtDue.value,
    protectedBuffer: request.protectedBuffer.value,
    amount: request.amount.value,
  };
  const missingFields = Object.entries(fields)
    .filter(([, value]) => value === null)
    .map(([field]) => field);

  if (missingFields.length > 0) {
    return {
      status: "review",
      safeToSpendBefore: null,
      safeToSpendAfter: null,
      postTransactionBalance: null,
      affectedCommitments: [],
      reasonCodes: ["MISSING_FINANCIAL_CONTEXT"],
      missingFields,
    };
  }

  const availableBalance = fields.availableBalance as number;
  const mandatoryObligations =
    (fields.essentialObligations as number) + (fields.debtDue as number);
  const protectedBuffer = fields.protectedBuffer as number;
  const amount = fields.amount as number;
  const safeToSpendBefore = Math.max(
    0,
    availableBalance - mandatoryObligations - protectedBuffer,
  );
  const postTransactionBalance = availableBalance - amount;
  const safeToSpendAfter = safeToSpendBefore - amount;

  if (postTransactionBalance < mandatoryObligations) {
    return {
      status: "high_risk",
      safeToSpendBefore,
      safeToSpendAfter,
      postTransactionBalance,
      affectedCommitments: ["mandatory_obligations", "protected_buffer"],
      reasonCodes: ["MANDATORY_OBLIGATIONS_AT_RISK"],
      missingFields: [],
    };
  }

  if (postTransactionBalance < mandatoryObligations + protectedBuffer) {
    return {
      status: "review",
      safeToSpendBefore,
      safeToSpendAfter,
      postTransactionBalance,
      affectedCommitments: ["protected_buffer"],
      reasonCodes: ["USES_PROTECTED_BUFFER"],
      missingFields: [],
    };
  }

  return {
    status: "safe",
    safeToSpendBefore,
    safeToSpendAfter,
    postTransactionBalance,
    affectedCommitments: [],
    reasonCodes: ["WITHIN_SAFE_TO_SPEND"],
    missingFields: [],
  };
}
