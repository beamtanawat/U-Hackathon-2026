import type { EvaluationRequest } from "../../app/api/evaluate/route.ts";
import type { AuthoritativeAssessment, Explanation, ExplanationOutput, QwenReview } from "../../lib/ai/types.ts";

export interface DemoScenario {
  id: "safe-u-tag" | "protected-buffer" | "suspicious-crypto";
  title: string;
  request: EvaluationRequest;
  assessment: AuthoritativeAssessment;
  explanation: ExplanationOutput;
  qwen: QwenReview;
  fallback: Explanation;
  supportedIndicatorKinds: string[];
}

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    id: "safe-u-tag",
    title: "safe U-Tag transfer",
    request: {
      financialContext: { scenarioId: "safe-u-tag", fixture: true },
      transaction: {
        walletType: "spending",
        transferMode: "u_tag",
        asset: "THB",
        network: null,
        recipient: { kind: "u_tag", identifier: "@fictional-friend", known: true, provenance: "simulated" },
      },
    },
    assessment: {
      financial: {
        status: "safe",
        safeToSpendBefore: 5_000,
        safeToSpendAfter: 4_500,
        transactionAmount: 500,
        reasons: [{ code: "commitments_covered", message: "Required commitments remain covered after this transfer." }],
        missingFields: [],
      },
      trust: { status: "low", indicators: [], missingFields: [] },
    },
    explanation: {
      summary: "The authoritative assessment marks this transfer safe.",
      reasons: [{ category: "financial", text: "Required commitments remain covered after this transfer.", evidenceIds: [] }],
      nextStep: "Confirm the amount and recipient before continuing.",
      missingContextQuestions: [],
      suggestedIndicators: [],
    },
    qwen: {
      model: "qwen/qwen3.5-9b",
      provider: "openrouter",
      reviewStatus: "completed",
      indicators: [],
      missingContext: [],
      contradictions: [],
      suggestedEscalation: false,
      reasoningSummary: "No supplied evidence supports escalation.",
    },
    fallback: {
      summary: "The authoritative assessment says required commitments remain covered after this transaction.",
      reasons: [{ category: "financial", text: "Required commitments remain covered after this transfer.", evidenceIds: [] }],
      nextStep: "Review the amount and recipient, then decide whether to continue.",
      source: "fallback",
      review: { status: "not_run" },
      missingContextQuestions: [],
      suggestedIndicators: [],
    },
    supportedIndicatorKinds: [],
  },
  {
    id: "protected-buffer",
    title: "balance sufficient but safe-to-spend insufficient",
    request: {
      financialContext: { scenarioId: "protected-buffer", fixture: true },
      transaction: {
        walletType: "spending",
        transferMode: "u_tag",
        asset: "THB",
        network: null,
        recipient: { kind: "u_tag", identifier: "@fictional-shop", known: true, provenance: "simulated" },
        availableBalance: 10_000,
      },
    },
    assessment: {
      financial: {
        status: "review",
        safeToSpendBefore: 900,
        safeToSpendAfter: 0,
        transactionAmount: 1_200,
        reasons: [{ code: "protected_buffer_exceeded", message: "The balance is sufficient, but the transfer exceeds safe-to-spend funds." }],
        missingFields: [],
      },
      trust: { status: "low", indicators: [], missingFields: [] },
    },
    explanation: {
      summary: "The authoritative assessment recommends reviewing this transfer.",
      reasons: [{ category: "financial", text: "The balance is sufficient, but the transfer exceeds safe-to-spend funds.", evidenceIds: [] }],
      nextStep: "Reduce or postpone the amount before continuing.",
      missingContextQuestions: [],
      suggestedIndicators: [],
    },
    qwen: {
      model: "qwen/qwen3.5-9b",
      provider: "openrouter",
      reviewStatus: "completed",
      indicators: [],
      missingContext: [],
      contradictions: [],
      suggestedEscalation: false,
      reasoningSummary: "The financial result requires review; no supplied trust evidence supports escalation.",
    },
    fallback: {
      summary: "The authoritative assessment recommends review because this transaction may affect protected money or goals.",
      reasons: [{ category: "financial", text: "The balance is sufficient, but the transfer exceeds safe-to-spend funds.", evidenceIds: [] }],
      nextStep: "Review the amount and recipient, then decide whether to continue.",
      source: "fallback",
      review: { status: "unavailable" },
      missingContextQuestions: [],
      suggestedIndicators: [],
    },
    supportedIndicatorKinds: [],
  },
  {
    id: "suspicious-crypto",
    title: "suspicious crypto transfer with explicit evidence",
    request: {
      financialContext: { scenarioId: "suspicious-crypto", fixture: true },
      transaction: {
        walletType: "crypto",
        transferMode: "on_chain",
        asset: "USDC",
        network: "avalanche",
        recipient: { kind: "wallet", fingerprint: "fictional:9f31", known: false, provenance: "simulated" },
        message: "Fictional urgent-return request for deterministic engine inspection.",
        rawDestination: "fictional-wallet-address",
      },
    },
    assessment: {
      financial: {
        status: "safe",
        safeToSpendBefore: 6_000,
        safeToSpendAfter: 5_000,
        transactionAmount: 1_000,
        reasons: [{ code: "commitments_covered", message: "Required commitments remain covered after this transfer." }],
        missingFields: [],
      },
      trust: {
        status: "high",
        indicators: [
          { id: "urgent-request", kind: "urgency_pressure", evidence: "The supplied request pressures the sender to act immediately.", provenance: "simulated" },
          { id: "new-wallet", kind: "new_recipient", evidence: "The supplied destination has no verified prior history.", provenance: "simulated" },
        ],
        missingFields: [],
      },
    },
    explanation: {
      summary: "The amount is affordable, but the authoritative trust result is high risk.",
      reasons: [
        { category: "financial", text: "Required commitments remain covered after this transfer.", evidenceIds: [] },
        { category: "trust", text: "The request applies urgency pressure.", evidenceIds: ["urgent-request"] },
        { category: "trust", text: "The destination is not verified.", evidenceIds: ["new-wallet"] },
      ],
      nextStep: "Stop and verify the request and destination through an independent channel.",
      missingContextQuestions: [],
      suggestedIndicators: [
        { kind: "urgency_pressure", evidenceIds: ["urgent-request"] },
        { kind: "new_recipient", evidenceIds: ["new-wallet"] },
      ],
    },
    qwen: {
      model: "qwen/qwen3.5-9b",
      provider: "openrouter",
      reviewStatus: "completed",
      indicators: [
        { type: "urgency_pressure", evidenceId: "urgent-request", evidence: "The request applies urgency pressure.", provenance: "simulated" },
        { type: "new_recipient", evidenceId: "new-wallet", evidence: "The destination is not verified.", provenance: "simulated" },
      ],
      missingContext: [],
      contradictions: [],
      suggestedEscalation: true,
      reasoningSummary: "Two supplied indicators support independent verification before transfer.",
    },
    fallback: {
      summary: "The authoritative assessment says required commitments remain covered after this transaction.",
      reasons: [
        { category: "financial", text: "Required commitments remain covered after this transfer.", evidenceIds: [] },
        { category: "trust", text: "The supplied request pressures the sender to act immediately.", evidenceIds: ["urgent-request"] },
        { category: "trust", text: "The supplied destination has no verified prior history.", evidenceIds: ["new-wallet"] },
      ],
      nextStep: "Verify the recipient and request independently, or cancel the transaction.",
      source: "fallback",
      review: { status: "unavailable" },
      missingContextQuestions: [],
      suggestedIndicators: [],
    },
    supportedIndicatorKinds: ["new_recipient", "urgency_pressure"],
  },
] as const;
