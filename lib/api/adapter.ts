import type { EvaluationRequest, FinancialAssessment, Provenance, TrustAssessment } from "../domain/types";
import type { AssessmentReason, AuthoritativeAssessment, EvidenceIndicator, TransactionContext } from "../ai/types";

/**
 * Adapters between Archay's authoritative engine output, Beam's AI layer and
 * the frontend. Nothing here changes a status or introduces a financial rule:
 * every number is either an engine output or simple arithmetic on the
 * request inputs the engine already used.
 */

export type RecommendedAction = "proceed" | "reduce_amount" | "verify_recipient" | "postpone" | "cancel";

export interface FinancialBreakdown {
  currency: string;
  availableBalance: number;
  essentialObligations: number;
  debtDue: number;
  mandatoryObligations: number;
  protectedBuffer: number;
  amount: number;
  postTransactionBalance: number;
  safeToSpendBefore: number;
  safeToSpendAfter: number;
  shortfallVsMandatory: number;
  bufferUsed: number;
  maxSafeAmount: number;
}

const MONEY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatMoney(value: number, currency: string): string {
  const sign = value < 0 ? "−" : "";
  return currency === "THB" ? `${sign}฿${MONEY.format(Math.abs(value))}` : `${sign}${MONEY.format(Math.abs(value))} ${currency}`;
}

/** Display values derived from the request and the engine's assessment; null when the engine did not assess. */
export function buildBreakdown(request: EvaluationRequest, financial: FinancialAssessment): FinancialBreakdown | null {
  if (financial.postTransactionBalance === null || financial.safeToSpendBefore === null || financial.safeToSpendAfter === null) return null;
  const currency = request.currency.value as string;
  const availableBalance = request.availableBalance.value as number;
  const essentialObligations = request.essentialObligations.value as number;
  const debtDue = request.debtDue.value as number;
  const protectedBuffer = request.protectedBuffer.value as number;
  const amount = request.amount.value as number;
  const mandatoryObligations = essentialObligations + debtDue;
  const post = financial.postTransactionBalance;
  return {
    currency,
    availableBalance,
    essentialObligations,
    debtDue,
    mandatoryObligations,
    protectedBuffer,
    amount,
    postTransactionBalance: post,
    safeToSpendBefore: financial.safeToSpendBefore,
    safeToSpendAfter: financial.safeToSpendAfter,
    shortfallVsMandatory: Math.max(0, mandatoryObligations - post),
    bufferUsed: Math.min(protectedBuffer, Math.max(0, mandatoryObligations + protectedBuffer - post)),
    maxSafeAmount: financial.safeToSpendBefore,
  };
}

const FIELD_LABEL: Record<string, string> = {
  availableBalance: "available balance",
  essentialObligations: "essential obligations",
  debtDue: "debt and BNPL due",
  protectedBuffer: "protected buffer",
  amount: "amount",
  currency: "balance currency",
  asset: "payment asset",
  exchangeRate: "exchange rate",
};

export function financialReasons(request: EvaluationRequest, financial: FinancialAssessment, breakdown: FinancialBreakdown | null): AssessmentReason[] {
  const code = financial.reasonCodes[0] ?? "UNSPECIFIED";
  if (code === "CURRENCY_CONVERSION_UNAVAILABLE") {
    return [
      { code, message: `This payment is in ${request.asset.value} but your balance and obligations are in ${request.currency.value}.` },
      { code, message: "No approved exchange rate is available, so affordability was not calculated. Nothing was converted or estimated." },
    ];
  }
  if (code === "MISSING_FINANCIAL_CONTEXT" || breakdown === null) {
    const missing = financial.missingFields.map((field) => FIELD_LABEL[field] ?? field).join(", ");
    return [
      { code: code ?? "MISSING_FINANCIAL_CONTEXT", message: `Safe-to-spend needs your ${missing}, so it was not calculated.` },
      { code: code ?? "MISSING_FINANCIAL_CONTEXT", message: "Nothing was estimated or filled in." },
    ];
  }
  const m = (value: number) => formatMoney(value, breakdown.currency);
  if (financial.status === "high_risk") {
    return [
      { code, message: `Balance after payment would be ${m(breakdown.postTransactionBalance)}, which is ${m(breakdown.shortfallVsMandatory)} below must keep (${m(breakdown.mandatoryObligations)}).` },
      { code, message: `Your protected buffer (${m(breakdown.protectedBuffer)}) would be fully used.` },
      { code, message: `The most you can pay and keep everything covered: ${m(breakdown.maxSafeAmount)}.` },
    ];
  }
  if (financial.status === "review") {
    return [
      { code, message: `Balance after payment (${m(breakdown.postTransactionBalance)}) still covers must keep (${m(breakdown.mandatoryObligations)}).` },
      { code, message: `It uses ${m(breakdown.bufferUsed)} of your ${m(breakdown.protectedBuffer)} protected buffer.` },
      { code, message: `Paying ${m(breakdown.maxSafeAmount)} or less keeps the full buffer.` },
    ];
  }
  return [
    { code, message: `Balance after payment (${m(breakdown.postTransactionBalance)}) stays above must keep plus buffer (${m(breakdown.mandatoryObligations + breakdown.protectedBuffer)}).` },
    { code, message: `Safe-to-spend after payment: ${m(breakdown.safeToSpendAfter)}.` },
  ];
}

const INDICATOR_EVIDENCE: Record<string, string> = {
  new_recipient: "The recipient has no previous transfers from this wallet.",
  urgency: "The supplied context says the request pressures you to act quickly.",
  secrecy_request: "The supplied context says you were asked to keep the payment secret.",
  guaranteed_or_high_return: "The supplied context promises a guaranteed or unusually high return.",
  impersonation: "The supplied context says the requester claims to be someone else.",
  unexpected_contact: "The supplied context says the contact was unexpected.",
  move_money_to_protect: "The supplied context asks you to move money to keep it safe.",
  advance_fee_or_prize: "The supplied context asks for a fee to release a prize or payment.",
  romance_or_online_only_relationship: "The supplied context involves an online-only relationship.",
  payment_method_demand: "The supplied context demands a specific payment method.",
};

function indicatorProvenance(request: EvaluationRequest, kind: string): Provenance {
  if (kind === "new_recipient") return request.recipient.isNew.provenance;
  const key = {
    urgency: "urgency", secrecy_request: "secrecyRequest", guaranteed_or_high_return: "guaranteedOrHighReturn",
    impersonation: "impersonation", unexpected_contact: "unexpectedContact", move_money_to_protect: "moveMoneyToProtect",
    advance_fee_or_prize: "advanceFeeOrPrize", romance_or_online_only_relationship: "romanceOrOnlineOnlyRelationship",
    payment_method_demand: "paymentMethodDemand",
  }[kind] as keyof EvaluationRequest["context"] | undefined;
  return key ? request.context[key].provenance : "derived";
}

export function trustIndicators(request: EvaluationRequest, trust: TrustAssessment): EvidenceIndicator[] {
  return trust.indicators.map((kind) => ({
    id: `indicator-${kind}`,
    kind,
    evidence: INDICATOR_EVIDENCE[kind] ?? "A supplied context signal was present.",
    provenance: indicatorProvenance(request, kind),
  }));
}

function trustMissingFields(request: EvaluationRequest, trust: TrustAssessment): string[] {
  if (trust.modelVersion !== null) return [];
  const missing: string[] = [];
  if (request.recipient.isNew.value === null || request.recipient.previousTransactionCount.value === null) missing.push("recipientHistory");
  if (request.recentMedianAmount.value === null || request.recentMedianAmount.value === 0) missing.push("recentMedianAmount");
  return missing;
}

/** Archay's engine output in the shape Beam's AI layer validates. */
export function toAuthoritativeAssessment(request: EvaluationRequest, financial: FinancialAssessment, trust: TrustAssessment): AuthoritativeAssessment {
  const breakdown = buildBreakdown(request, financial);
  return {
    financial: {
      status: financial.status,
      safeToSpendBefore: financial.safeToSpendBefore,
      safeToSpendAfter: financial.safeToSpendAfter,
      transactionAmount: financial.postTransactionBalance === null ? null : request.amount.value,
      reasons: financialReasons(request, financial, breakdown),
      missingFields: [...financial.missingFields],
    },
    trust: {
      // The AI layer has no "not assessed" state; the engine never emits it.
      status: trust.status === "not_assessed" ? "unknown" : trust.status,
      indicators: trustIndicators(request, trust),
      missingFields: trustMissingFields(request, trust),
    },
  };
}

/** Non-identifying transaction metadata for the AI layer (no identifiers, balances or messages). */
export function toTransactionContext(request: EvaluationRequest): TransactionContext {
  const isNew = request.recipient.isNew.value;
  return {
    walletType: request.walletType.value,
    transferMode: request.transferMode.value,
    asset: request.asset.value,
    network: request.network.value,
    recipient: {
      kind: request.recipient.kind.value === "wallet_address" ? "wallet" : "u_tag",
      known: isNew === null ? null : !isNew,
      provenance: request.recipient.isNew.provenance,
    },
  };
}

/** Suggested next steps; the UI always offers all five actions and the user decides. */
export function recommendActions(financial: FinancialAssessment, trust: TrustAssessment): RecommendedAction[] {
  if (trust.status === "high" || trust.status === "review") {
    return financial.status === "high_risk" ? ["verify_recipient", "reduce_amount"] : ["verify_recipient", "cancel"];
  }
  if (financial.missingFields.length > 0) return ["postpone"];
  if (financial.status === "high_risk") return ["reduce_amount", "postpone"];
  if (financial.status === "review") return ["reduce_amount"];
  return ["proceed"];
}
