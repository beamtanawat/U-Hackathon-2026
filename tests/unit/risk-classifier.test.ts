import { describe, expect, it } from "vitest";

import { scenarios } from "../../data/scenarios";
import model from "../../lib/ml/model.json";
import { extractRiskFeatures } from "../../lib/ml/extract-features";
import {
  assessTrust,
  classifyRiskScore,
  scoreRiskFeatures,
  validateModelArtifact,
} from "../../lib/ml/risk-classifier";

describe("risk model inference", () => {
  it("matches every Python golden vector within 1e-9", () => {
    const artifact = validateModelArtifact(model);

    for (const vector of artifact.goldenVectors) {
      expect(scoreRiskFeatures(vector.features, artifact)).toBeCloseTo(vector.score, 9);
    }
  });

  it("keeps missing semantic context distinct from false and preserves provenance", () => {
    const extracted = extractRiskFeatures(scenarios.safeUTag);

    expect(extracted?.values.urgency).toBe(0);
    expect(extracted?.values.urgency_known).toBe(0);
    expect(extracted?.provenance.urgency).toBe("unavailable");
  });

  it("maps scores into low, review, and high bands", () => {
    const artifact = validateModelArtifact(model);

    expect(classifyRiskScore(artifact.thresholds.review - 0.01, artifact)).toBe("low");
    expect(classifyRiskScore(artifact.thresholds.review, artifact)).toBe("review");
    expect(classifyRiskScore(artifact.thresholds.highRisk, artifact)).toBe("high");
  });

  it("does not score when required recipient history is missing", () => {
    const request = structuredClone(scenarios.safeUTag);
    request.recipient.previousTransactionCount = {
      value: null,
      provenance: "unavailable",
    };

    expect(extractRiskFeatures(request)).toBeNull();
    expect(assessTrust(request)).toEqual({
      status: "unknown",
      riskScore: null,
      indicators: [],
      modelVersion: null,
    });
  });

  it("uses critical deterministic indicators when model inputs are incomplete", () => {
    const request = structuredClone(scenarios.suspiciousCrypto);
    request.recipient.previousTransactionCount = {
      value: null,
      provenance: "unavailable",
    };

    expect(assessTrust(request)).toEqual({
      status: "high",
      riskScore: null,
      indicators: expect.arrayContaining(["urgency", "guaranteed_or_high_return"]),
      modelVersion: null,
    });
  });

  it("returns explainable indicators for a suspicious scenario", () => {
    const result = assessTrust(scenarios.suspiciousCrypto);

    expect(result.status).toBe("high");
    expect(result.indicators).toEqual(
      expect.arrayContaining(["new_recipient", "urgency", "guaranteed_or_high_return"]),
    );
    expect(result.modelVersion).toBe("scam-context-v1");
  });

  it("rejects artifacts whose coefficients do not match their features", () => {
    const invalid = { ...model, coefficients: model.coefficients.slice(1) };

    expect(() => validateModelArtifact(invalid)).toThrow(/coefficients/i);
  });

  it("rejects artifacts missing a required continuous transform", () => {
    const invalid = {
      ...model,
      transforms: {
        recipient_tx_count_log1p: model.transforms.recipient_tx_count_log1p,
      },
    };

    expect(() => validateModelArtifact(invalid)).toThrow(/transform/i);
  });
});
