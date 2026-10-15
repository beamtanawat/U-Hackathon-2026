export type FinancialStatus = "safe" | "review" | "high_risk";
export type TrustStatus = "low" | "review" | "high" | "unknown";
export type Provenance = "host-provided" | "user-provided" | "derived" | "simulated" | "unavailable";
export type ProviderStatus = "completed" | "not_run" | "unavailable";
export type AiRoute = "none" | "qwen" | "qwen_jev";

export interface AssessmentReason {
  code: string;
  message: string;
}

export interface EvidenceIndicator {
  id: string;
  kind: string;
  evidence: string;
  provenance: Provenance;
}

export interface AuthoritativeAssessment {
  financial: {
    status: FinancialStatus;
    safeToSpendBefore: number;
    safeToSpendAfter: number;
    transactionAmount: number;
    reasons: AssessmentReason[];
    missingFields: string[];
  };
  trust: {
    status: TrustStatus;
    indicators: EvidenceIndicator[];
    missingFields: string[];
  };
}

export interface TransactionContext {
  walletType: "spending" | "crypto";
  transferMode: "u_tag" | "on_chain";
  asset: string;
  network: string | null;
  recipient: {
    kind: "u_tag" | "wallet";
    identifier?: string;
    fingerprint?: string;
    known: boolean | null;
    provenance: Provenance;
  };
  message?: string;
  rawDestination?: string;
  availableBalance?: number;
}

export interface ProviderContext {
  financialStatus: FinancialStatus;
  financialReasonCodes: string[];
  trustStatus: TrustStatus;
  trustIndicators: Array<Pick<EvidenceIndicator, "id" | "kind" | "provenance">>;
  missingFields: string[];
  walletType: TransactionContext["walletType"];
  transferMode: TransactionContext["transferMode"];
  asset: string;
  network: string | null;
  recipientKnown: boolean | null;
  recipientProvenance: Provenance;
}

export interface ProviderRequest {
  system: string;
  context: ProviderContext;
}

export interface QwenProvider {
  analyze(request: ProviderRequest, signal: AbortSignal): Promise<string>;
}

export interface JevProvider {
  verify(request: JevVerificationRequest, signal: AbortSignal): Promise<JevDecision>;
}

export interface ExplanationReason {
  category: "financial" | "trust" | "missing_context";
  text: string;
  evidenceIds: string[];
}

export interface MissingContextQuestion {
  field: string;
  question: string;
}

export interface SuggestedIndicator {
  kind: string;
  evidenceIds: string[];
}

export interface ExplanationOutput {
  summary: string;
  reasons: ExplanationReason[];
  nextStep: string;
  missingContextQuestions: MissingContextQuestion[];
  suggestedIndicators: SuggestedIndicator[];
}

export interface Explanation extends ExplanationOutput {
  source: "qwen" | "fallback";
  review: {
    status: "not_run" | "consistent" | "suggested_escalation" | "unavailable";
  };
}

export interface QwenIndicator {
  type: string;
  evidenceId: string;
  evidence: string;
  provenance: Provenance;
}

export interface QwenReview {
  model: "qwen/qwen3.5-9b";
  provider: "openrouter";
  reviewStatus: "completed";
  indicators: QwenIndicator[];
  missingContext: string[];
  contradictions: string[];
  suggestedEscalation: boolean;
  reasoningSummary: string;
}

export interface QwenAnalysis {
  explanation: ExplanationOutput;
  review: QwenReview;
}

export interface JevVerificationRequest {
  context: ProviderContext;
  qwenSuggestedEscalation: boolean;
  qwenIndicators: Array<Pick<QwenIndicator, "type" | "evidenceId" | "provenance">>;
}

export interface JevDecision {
  model: "typesafe/jev-1.14";
  provider: "openrouter";
  decisionStatus: "completed";
  reviewProbability: number;
  suggestedEscalation: boolean;
}

export interface UsageEvent {
  provider: "openrouter";
  model: "qwen/qwen3.5-9b" | "typesafe/jev-1.14";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number | null;
}

export type UsageReporter = (event: UsageEvent) => void;

export interface ComparisonResult {
  providerStatus: { qwen: ProviderStatus; jev: ProviderStatus };
  supportedAgreement: string[];
  differingFindings: Array<{ provider: "qwen"; type: string }>;
  qwenSupportedIndicators: Array<{ type: string; evidenceId: string; provenance: Provenance }>;
  unsupportedClaims: Array<{ provider: "qwen"; type: string; evidenceId: string }>;
  missingEvidence: string[];
  contradictions: string[];
  suggestedEscalation: boolean;
  jevVerification: "not_run" | "supports_review" | "does_not_support_review" | "unavailable";
}

export interface AiDecisionSupport {
  authoritativeAssessment: AuthoritativeAssessment;
  explanation: Explanation;
  qwenReview: QwenReview | null;
  jevDecision: JevDecision | null;
  comparison: ComparisonResult;
}
