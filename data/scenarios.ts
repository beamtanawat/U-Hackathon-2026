import type { EvaluationRequest } from "../lib/domain/types";

const simulated = <T>(value: T) => ({ value, provenance: "simulated" as const });
const unavailable = () => ({ value: null, provenance: "unavailable" as const });

const emptyContext: EvaluationRequest["context"] = {
  urgency: unavailable(),
  secrecyRequest: unavailable(),
  guaranteedOrHighReturn: unavailable(),
  impersonation: unavailable(),
  unexpectedContact: unavailable(),
  moveMoneyToProtect: unavailable(),
  advanceFeeOrPrize: unavailable(),
  romanceOrOnlineOnlyRelationship: unavailable(),
  paymentMethodDemand: unavailable(),
};

export const scenarios: Record<string, EvaluationRequest> = {
  safeUTag: {
    scenarioId: "safe-u-tag",
    walletType: simulated("spending"),
    transferMode: simulated("u_tag"),
    availableBalance: simulated(15_000),
    essentialObligations: simulated(6_000),
    debtDue: simulated(1_000),
    protectedBuffer: simulated(3_000),
    amount: simulated(500),
    asset: simulated("THB"),
    network: unavailable(),
    recipient: {
      kind: simulated("u_tag"),
      identifier: simulated("@demo-friend"),
      isNew: simulated(false),
      previousTransactionCount: simulated(5),
    },
    recentMedianAmount: simulated(600),
    context: emptyContext,
  },
  insufficientSafeToSpend: {
    scenarioId: "balance-enough-safe-to-spend-not-enough",
    walletType: simulated("spending"),
    transferMode: simulated("u_tag"),
    availableBalance: simulated(15_000),
    essentialObligations: simulated(7_000),
    debtDue: simulated(2_000),
    protectedBuffer: simulated(4_000),
    amount: simulated(3_500),
    asset: simulated("THB"),
    network: unavailable(),
    recipient: {
      kind: simulated("u_tag"),
      identifier: simulated("@demo-merchant"),
      isNew: simulated(false),
      previousTransactionCount: simulated(2),
    },
    recentMedianAmount: simulated(900),
    context: emptyContext,
  },
  suspiciousCrypto: {
    scenarioId: "new-destination-crypto",
    walletType: simulated("crypto"),
    transferMode: simulated("on_chain"),
    availableBalance: simulated(5_000),
    essentialObligations: simulated(1_500),
    debtDue: simulated(500),
    protectedBuffer: simulated(1_000),
    amount: simulated(2_500),
    asset: simulated("USDC"),
    network: simulated("BNB Smart Chain"),
    recipient: {
      kind: simulated("wallet_address"),
      identifier: simulated("destination:demo-risk-001"),
      isNew: simulated(true),
      previousTransactionCount: simulated(0),
    },
    recentMedianAmount: simulated(250),
    context: {
      ...emptyContext,
      urgency: simulated(true),
      guaranteedOrHighReturn: simulated(true),
    },
  },
};
