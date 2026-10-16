import { describe, expect, it } from "vitest";

import type { EvaluationRequest } from "../../lib/domain/types";
import { evaluateSafeToPay } from "../../lib/engine/safe-to-pay";

const simulated = <T>(value: T) => ({ value, provenance: "simulated" as const });
const unknown = () => ({ value: null, provenance: "unavailable" as const });

function request(overrides: Partial<EvaluationRequest> = {}): EvaluationRequest {
  return {
    scenarioId: "test",
    walletType: simulated("spending"),
    transferMode: simulated("u_tag"),
    currency: simulated("THB"),
    availableBalance: simulated(10_000),
    essentialObligations: simulated(4_000),
    debtDue: simulated(1_000),
    protectedBuffer: simulated(2_000),
    amount: simulated(1_000),
    asset: simulated("THB"),
    network: unknown(),
    recipient: {
      kind: simulated("u_tag"),
      identifier: simulated("@demo"),
      isNew: simulated(false),
      previousTransactionCount: simulated(3),
    },
    recentMedianAmount: simulated(700),
    context: {
      urgency: unknown(),
      secrecyRequest: unknown(),
      guaranteedOrHighReturn: unknown(),
      impersonation: unknown(),
      unexpectedContact: unknown(),
      moveMoneyToProtect: unknown(),
      advanceFeeOrPrize: unknown(),
      romanceOrOnlineOnlyRelationship: unknown(),
      paymentMethodDemand: unknown(),
    },
    ...overrides,
  };
}

describe("evaluateSafeToPay", () => {
  it("returns safe when the transaction stays within safe-to-spend", () => {
    expect(evaluateSafeToPay(request())).toEqual({
      status: "safe",
      safeToSpendBefore: 3_000,
      safeToSpendAfter: 2_000,
      postTransactionBalance: 9_000,
      affectedCommitments: [],
      reasonCodes: ["WITHIN_SAFE_TO_SPEND"],
      missingFields: [],
    });
  });

  it("keeps the exact safe-to-spend boundary safe", () => {
    const result = evaluateSafeToPay(request({ amount: simulated(3_000) }));

    expect(result.status).toBe("safe");
    expect(result.safeToSpendAfter).toBe(0);
  });

  it("returns review when the transaction consumes the protected buffer", () => {
    const result = evaluateSafeToPay(request({ amount: simulated(4_000) }));

    expect(result.status).toBe("review");
    expect(result.affectedCommitments).toEqual(["protected_buffer"]);
    expect(result.reasonCodes).toEqual(["USES_PROTECTED_BUFFER"]);
  });

  it("returns high risk when mandatory obligations are no longer covered", () => {
    const result = evaluateSafeToPay(request({ amount: simulated(6_000) }));

    expect(result.status).toBe("high_risk");
    expect(result.affectedCommitments).toEqual(["mandatory_obligations", "protected_buffer"]);
    expect(result.reasonCodes).toEqual(["MANDATORY_OBLIGATIONS_AT_RISK"]);
  });

  it("returns high risk with a negative post-transaction balance", () => {
    const result = evaluateSafeToPay(request({ amount: simulated(12_000) }));

    expect(result.status).toBe("high_risk");
    expect(result.postTransactionBalance).toBe(-2_000);
  });

  it("reports the true shortfall when the balance already misses obligations plus buffer", () => {
    const result = evaluateSafeToPay(request({ availableBalance: simulated(5_000), amount: simulated(100) }));

    expect(result.safeToSpendBefore).toBe(0);
    expect(result.safeToSpendAfter).toBe(-2_100);
    expect(result.status).toBe("high_risk");
  });

  it("returns review without values when amount and balance use different units", () => {
    expect(evaluateSafeToPay(request({ asset: simulated("USDC") }))).toEqual({
      status: "review",
      safeToSpendBefore: null,
      safeToSpendAfter: null,
      postTransactionBalance: null,
      affectedCommitments: [],
      reasonCodes: ["CURRENCY_CONVERSION_UNAVAILABLE"],
      missingFields: ["exchangeRate"],
    });
  });

  it("treats an unknown currency as missing financial context", () => {
    const result = evaluateSafeToPay(request({ currency: unknown() }));

    expect(result.status).toBe("review");
    expect(result.missingFields).toEqual(["currency"]);
  });

  it("returns review and names missing financial inputs", () => {
    const result = evaluateSafeToPay(request({ protectedBuffer: unknown() }));

    expect(result).toEqual({
      status: "review",
      safeToSpendBefore: null,
      safeToSpendAfter: null,
      postTransactionBalance: null,
      affectedCommitments: [],
      reasonCodes: ["MISSING_FINANCIAL_CONTEXT"],
      missingFields: ["protectedBuffer"],
    });
  });
});
