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

  if (request.currency.value === null) missingFields.push("currency");
  if (request.asset.value === null) missingFields.push("asset");

  if (missingFields.length > 0) {
    return unassessable("MISSING_FINANCIAL_CONTEXT", missingFields);
  }

  // Never compare amounts in different units and never invent an exchange rate.
  if (request.asset.value !== request.currency.value) {
    return unassessable("CURRENCY_CONVERSION_UNAVAILABLE", ["exchangeRate"]);
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
  // Unclamped: a negative value is the shortfall against obligations plus buffer.
  const safeToSpendAfter = postTransactionBalance - mandatoryObligations - protectedBuffer;

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

function unassessable(reasonCode: string, missingFields: string[]): FinancialAssessment {
  return {
    status: "review",
    safeToSpendBefore: null,
    safeToSpendAfter: null,
    postTransactionBalance: null,
    affectedCommitments: [],
    reasonCodes: [reasonCode],
    missingFields,
  };
}
