import { z } from "zod";

import type { EvaluationRequest, TrustAssessment } from "../domain/types";
import { extractRiskFeatures } from "./extract-features";
import defaultModel from "./model.json";

const finiteNumber = z.number().finite();
const transformSchema = z
  .object({
    type: z.literal("standardize"),
    mean: finiteNumber,
    scale: finiteNumber.positive(),
  })
  .strict();

const modelArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    modelType: z.literal("logistic_regression"),
    modelVersion: z.string().min(1),
    featureOrder: z.array(z.string().min(1)).min(1),
    transforms: z.record(z.string(), transformSchema),
    coefficients: z.array(finiteNumber),
    intercept: finiteNumber,
    link: z.literal("sigmoid"),
    thresholds: z
      .object({
        review: finiteNumber.min(0).max(1),
        highRisk: finiteNumber.min(0).max(1),
      })
      .strict(),
    goldenVectors: z.array(
      z.object({
        caseId: z.string().min(1),
        features: z.record(z.string(), finiteNumber),
        score: finiteNumber.min(0).max(1),
      }),
    ),
  })
  .passthrough()
  .superRefine((artifact, context) => {
    if (artifact.featureOrder.length !== artifact.coefficients.length) {
      context.addIssue({
        code: "custom",
        path: ["coefficients"],
        message: "coefficients must match featureOrder length",
      });
    }
    if (new Set(artifact.featureOrder).size !== artifact.featureOrder.length) {
      context.addIssue({
        code: "custom",
        path: ["featureOrder"],
        message: "featureOrder must contain unique names",
      });
    }
    if (artifact.thresholds.review >= artifact.thresholds.highRisk) {
      context.addIssue({
        code: "custom",
        path: ["thresholds"],
        message: "review threshold must be below highRisk threshold",
      });
    }
  });

export type ModelArtifact = z.infer<typeof modelArtifactSchema>;

export function validateModelArtifact(input: unknown): ModelArtifact {
  return modelArtifactSchema.parse(input);
}

const sigmoid = (value: number) =>
  value >= 0
    ? 1 / (1 + Math.exp(-value))
    : Math.exp(value) / (1 + Math.exp(value));

export function scoreRiskFeatures(
  features: Record<string, number>,
  artifact: ModelArtifact,
): number {
  const logit = artifact.featureOrder.reduce((total, feature, index) => {
    const value = features[feature];
    if (!Number.isFinite(value)) {
      throw new Error(`missing or invalid feature: ${feature}`);
    }
    return total + value * artifact.coefficients[index];
  }, artifact.intercept);
  return sigmoid(logit);
}

export function classifyRiskScore(
  score: number,
  artifact: ModelArtifact,
): "low" | "review" | "high" {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error("risk score must be between 0 and 1");
  }
  if (score >= artifact.thresholds.highRisk) return "high";
  if (score >= artifact.thresholds.review) return "review";
  return "low";
}

const indicatorNames: Record<string, string> = {
  is_new_recipient: "new_recipient",
  urgency: "urgency",
  secrecy_request: "secrecy_request",
  guaranteed_or_high_return: "guaranteed_or_high_return",
  impersonation: "impersonation",
  unexpected_contact: "unexpected_contact",
  move_money_to_protect: "move_money_to_protect",
  advance_fee_or_prize: "advance_fee_or_prize",
  romance_or_online_only_relationship: "romance_or_online_only_relationship",
  payment_method_demand: "payment_method_demand",
};

export function assessTrust(
  request: EvaluationRequest,
  inputArtifact: unknown = defaultModel,
): TrustAssessment {
  const artifact = validateModelArtifact(inputArtifact);
  const extracted = extractRiskFeatures(request, artifact);
  if (extracted === null) {
    return {
      status: "unknown",
      riskScore: null,
      indicators: [],
      modelVersion: null,
    };
  }

  const riskScore = scoreRiskFeatures(extracted.values, artifact);
  const indicators = artifact.featureOrder
    .map((feature, index) => ({ feature, coefficient: artifact.coefficients[index] }))
    .filter(
      ({ feature, coefficient }) =>
        indicatorNames[feature] !== undefined &&
        coefficient > 0 &&
        extracted.values[feature] === 1,
    )
    .map(({ feature }) => indicatorNames[feature]);

  return {
    status: classifyRiskScore(riskScore, artifact),
    riskScore,
    indicators,
    modelVersion: artifact.modelVersion,
  };
}
