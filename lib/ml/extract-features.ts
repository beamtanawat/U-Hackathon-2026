import type { EvaluationRequest, Provenance } from "../domain/types";
import defaultModel from "./model.json";

type Transform = {
  type: "standardize";
  mean: number;
  scale: number;
};

type FeatureArtifact = {
  transforms: Record<string, Transform>;
};

export type ExtractedRiskFeatures = {
  values: Record<string, number>;
  provenance: Record<string, Provenance>;
};

const semanticInputs = {
  urgency: "urgency",
  secrecy_request: "secrecyRequest",
  guaranteed_or_high_return: "guaranteedOrHighReturn",
  impersonation: "impersonation",
  unexpected_contact: "unexpectedContact",
  move_money_to_protect: "moveMoneyToProtect",
  advance_fee_or_prize: "advanceFeeOrPrize",
  romance_or_online_only_relationship: "romanceOrOnlineOnlyRelationship",
  payment_method_demand: "paymentMethodDemand",
} as const;

const standardize = (value: number, transform: Transform) =>
  (value - transform.mean) / transform.scale;

export function extractRiskFeatures(
  request: EvaluationRequest,
  artifact: FeatureArtifact = defaultModel as FeatureArtifact,
): ExtractedRiskFeatures | null {
  const isNew = request.recipient.isNew.value;
  const transactionCount = request.recipient.previousTransactionCount.value;
  const amount = request.amount.value;
  const recentMedian = request.recentMedianAmount.value;

  if (
    isNew === null ||
    transactionCount === null ||
    amount === null ||
    recentMedian === null ||
    recentMedian <= 0
  ) {
    return null;
  }

  const countFeature = "recipient_tx_count_log1p";
  const ratioFeature = "amount_to_recent_median_ratio";
  const values: Record<string, number> = {
    is_new_recipient: Number(isNew),
    [countFeature]: standardize(
      Math.log1p(transactionCount),
      artifact.transforms[countFeature],
    ),
    [ratioFeature]: standardize(amount / recentMedian, artifact.transforms[ratioFeature]),
    context_present: 0,
  };
  const provenance: Record<string, Provenance> = {
    is_new_recipient: request.recipient.isNew.provenance,
    [countFeature]: "derived",
    [ratioFeature]: "derived",
    context_present: "derived",
  };

  let knownContextCount = 0;
  for (const [feature, inputName] of Object.entries(semanticInputs)) {
    const input = request.context[inputName as keyof EvaluationRequest["context"]];
    const known = input.value !== null;
    values[feature] = input.value === true ? 1 : 0;
    values[`${feature}_known`] = known ? 1 : 0;
    provenance[feature] = input.provenance;
    provenance[`${feature}_known`] = "derived";
    knownContextCount += Number(known);
  }
  values.context_present = Number(knownContextCount > 0);

  return { values, provenance };
}
