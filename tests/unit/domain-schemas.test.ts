import { describe, expect, it } from "vitest";

import { evaluationRequestSchema } from "../../lib/domain/schemas";
import type { EvaluationRequest } from "../../lib/domain/types";

const host = <T>(value: T) => ({ value, provenance: "host_provided" as const });
const user = <T>(value: T) => ({ value, provenance: "user_provided" as const });
const unavailable = () => ({ value: null, provenance: "unavailable" as const });

function validRequest(): EvaluationRequest {
  return {
    scenarioId: "safe-u-tag",
    walletType: host("spending"),
    transferMode: host("u_tag"),
    availableBalance: host(15_000),
    essentialObligations: user(6_000),
    debtDue: user(1_000),
    protectedBuffer: user(3_000),
    amount: user(500),
    asset: host("THB"),
    network: unavailable(),
    recipient: {
      kind: host("u_tag"),
      identifier: host("@demo-friend"),
      isNew: host(false),
      previousTransactionCount: host(4),
    },
    recentMedianAmount: host(450),
    context: {
      urgency: unavailable(),
      secrecyRequest: unavailable(),
      guaranteedOrHighReturn: unavailable(),
      impersonation: unavailable(),
      unexpectedContact: unavailable(),
      moveMoneyToProtect: unavailable(),
      advanceFeeOrPrize: unavailable(),
      romanceOrOnlineOnlyRelationship: unavailable(),
      paymentMethodDemand: unavailable(),
    },
  };
}

describe("evaluationRequestSchema", () => {
  it("accepts valid U-Tag and on-chain requests", () => {
    expect(evaluationRequestSchema.parse(validRequest()).transferMode.value).toBe("u_tag");

    const crypto = validRequest();
    crypto.transferMode = host("on_chain");
    crypto.walletType = host("crypto");
    crypto.asset = host("USDC");
    crypto.network = host("BNB Smart Chain");
    crypto.recipient.kind = host("wallet_address");
    crypto.recipient.identifier = host("destination:demo-001");

    expect(evaluationRequestSchema.parse(crypto).transferMode.value).toBe("on_chain");
  });

  it("rejects negative monetary inputs", () => {
    const request = validRequest();
    request.amount = user(-1);

    expect(() => evaluationRequestSchema.parse(request)).toThrow();
  });

  it("rejects an input with missing provenance", () => {
    const request = validRequest();
    request.availableBalance = { value: 15_000 } as EvaluationRequest["availableBalance"];

    expect(() => evaluationRequestSchema.parse(request)).toThrow();
  });

  it("preserves unknown semantic flags instead of treating them as false", () => {
    const parsed = evaluationRequestSchema.parse(validRequest());

    expect(parsed.context.urgency).toEqual({ value: null, provenance: "unavailable" });
  });
});
