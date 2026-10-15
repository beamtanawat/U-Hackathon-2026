import assert from "node:assert/strict";
import test from "node:test";

import { JEV_TIMEOUT_MS, QWEN_TIMEOUT_MS, runAiAnalysis, selectAiRoute } from "../../lib/ai/explanation.ts";
import type { AuthoritativeAssessment, JevProvider, ProviderRequest, QwenProvider, TransactionContext } from "../../lib/ai/types.ts";

const transaction: TransactionContext = {
  walletType: "crypto",
  transferMode: "on_chain",
  asset: "USDC",
  network: "avalanche",
  recipient: { kind: "wallet", known: false, provenance: "simulated", identifier: "secret@example.com" },
  message: "secret raw message",
  rawDestination: "0xsecret",
  availableBalance: 99_999,
};

const normal: AuthoritativeAssessment = {
  financial: { status: "safe", safeToSpendBefore: 1_000, safeToSpendAfter: 900, transactionAmount: 100, reasons: [{ code: "covered", message: "Commitments remain covered." }], missingFields: [] },
  trust: { status: "low", indicators: [], missingFields: [] },
};

const contextual: AuthoritativeAssessment = {
  ...normal,
  financial: { ...normal.financial, status: "review", reasons: [{ code: "buffer_reduced", message: "Protected funds may be affected." }] },
};

const uncertain: AuthoritativeAssessment = {
  ...normal,
  trust: { status: "unknown", indicators: [], missingFields: ["recipientHistory"] },
};

const qwenAnalysis = {
  explanation: {
    summary: "Review the authoritative assessment.",
    reasons: [{ category: "financial", text: "Protected funds may be affected.", evidenceIds: [] }],
    nextStep: "Review the amount and recipient.",
    missingContextQuestions: [],
    suggestedIndicators: [],
  },
  review: {
    model: "qwen/qwen3.5-9b",
    provider: "openrouter",
    reviewStatus: "completed",
    indicators: [],
    missingContext: [],
    contradictions: [],
    suggestedEscalation: false,
    reasoningSummary: "No supplied evidence supports escalation.",
  },
};

function qwenProvider(onCall: (request: ProviderRequest) => void = () => undefined): QwenProvider {
  return { async analyze(request) { onCall(request); return JSON.stringify(qwenAnalysis); } };
}

function jevProvider(onCall: () => void = () => undefined): JevProvider {
  return {
    async verify() {
      onCall();
      return { model: "typesafe/jev-1.14", provider: "openrouter", decisionStatus: "completed", reviewProbability: 0.8, suggestedEscalation: true };
    },
  };
}

test("selects deterministic risk routes", () => {
  assert.equal(selectAiRoute(normal), "none");
  assert.equal(selectAiRoute(contextual), "qwen");
  assert.equal(selectAiRoute(uncertain), "qwen_jev");
  assert.equal(selectAiRoute({ ...contextual, trust: { ...contextual.trust, indicators: [{ id: "u", kind: "urgency", evidence: "Supplied urgency.", provenance: "unavailable" }] } }), "qwen_jev");
});

test("normal transactions make no external AI calls", async () => {
  let calls = 0;
  const result = await runAiAnalysis({ assessment: normal, transaction }, {
    qwenProvider: qwenProvider(() => { calls += 1; }),
    jevProvider: jevProvider(() => { calls += 1; }),
  });

  assert.equal(calls, 0);
  assert.equal(result.explanation.source, "fallback");
  assert.deepEqual(result.comparison.providerStatus, { qwen: "not_run", jev: "not_run" });
});

test("contextual transactions make one Qwen call with accurate attribution", async () => {
  let qwenCalls = 0;
  let jevCalls = 0;
  const result = await runAiAnalysis({ assessment: contextual, transaction }, {
    qwenProvider: qwenProvider(() => { qwenCalls += 1; }),
    jevProvider: jevProvider(() => { jevCalls += 1; }),
  });

  assert.equal(qwenCalls, 1);
  assert.equal(jevCalls, 0);
  assert.equal(result.explanation.source, "qwen");
  assert.equal(result.qwenReview?.model, "qwen/qwen3.5-9b");
  assert.equal(result.jevDecision, null);
  assert.deepEqual(result.comparison.providerStatus, { qwen: "completed", jev: "not_run" });
});

test("uncertain evidence makes at most two ordered calls and conditionally runs Jev", async () => {
  const order: string[] = [];
  const result = await runAiAnalysis({ assessment: uncertain, transaction }, {
    qwenProvider: qwenProvider(() => { order.push("qwen"); }),
    jevProvider: jevProvider(() => { order.push("jev"); }),
  });

  assert.deepEqual(order, ["qwen", "jev"]);
  assert.equal(result.explanation.source, "qwen");
  assert.equal(result.jevDecision?.model, "typesafe/jev-1.14");
  assert.deepEqual(result.comparison.providerStatus, { qwen: "completed", jev: "completed" });
});

test("does not call Jev when Qwen fails", async () => {
  let jevCalls = 0;
  const failingQwen: QwenProvider = { async analyze() { throw new Error("Qwen unavailable"); } };
  const result = await runAiAnalysis({ assessment: uncertain, transaction }, {
    qwenProvider: failingQwen,
    jevProvider: jevProvider(() => { jevCalls += 1; }),
  });

  assert.equal(jevCalls, 0);
  assert.equal(result.explanation.source, "fallback");
  assert.deepEqual(result.authoritativeAssessment, uncertain);
  assert.deepEqual(result.comparison.providerStatus, { qwen: "unavailable", jev: "not_run" });
});

test("Jev failure does not discard valid Qwen analysis", async () => {
  const failingJev: JevProvider = { async verify() { throw new Error("Jev unavailable"); } };
  const result = await runAiAnalysis({ assessment: uncertain, transaction }, {
    qwenProvider: qwenProvider(),
    jevProvider: failingJev,
  });

  assert.equal(result.explanation.source, "qwen");
  assert.equal(result.qwenReview?.model, "qwen/qwen3.5-9b");
  assert.equal(result.jevDecision, null);
  assert.deepEqual(result.comparison.providerStatus, { qwen: "completed", jev: "unavailable" });
  assert.equal(result.comparison.jevVerification, "unavailable");
});

test("enforces provider timeout constants", () => {
  assert.equal(QWEN_TIMEOUT_MS, 12_000);
  assert.equal(JEV_TIMEOUT_MS, 5_000);
});
