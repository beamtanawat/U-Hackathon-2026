# Frontend AI Integration (Ete)

## Endpoint and lifecycle

Call `POST /api/evaluate` with JSON. The route validates the request, obtains the authoritative assessment first, then deterministically selects no AI, Qwen only, or Qwen followed by conditional Jev verification.

The authoritative engine is not connected in the production export yet. Until Archay wires it, the endpoint returns `503 engine_unavailable`; the fictional test harness does not alter this behavior.

Recommended UI states:

1. **Loading:** disable repeat submission and show “Checking affordability and recipient signals…”
2. **Success (`200`):** render `assessment` as the decision result and `ai` as supporting explanation/review.
3. **Invalid request (`400`):** retain user input and show a correctable validation message.
4. **Engine unavailable (`503`):** block the result view; no authoritative decision exists.
5. **AI provider unavailable (`200`):** keep the authoritative result visible and use the returned deterministic fallback/availability metadata.

## Request

```json
{
  "financialContext": {
    "profileId": "fictional-demo"
  },
  "transaction": {
    "walletType": "spending",
    "transferMode": "u_tag",
    "asset": "THB",
    "network": null,
    "recipient": {
      "kind": "u_tag",
      "identifier": "@fictional-friend",
      "known": true,
      "provenance": "simulated"
    }
  }
}
```

`financialContext` is intentionally opaque until the engine team publishes its contract. The route passes it only to the deterministic engine. Do not derive UI behavior from its temporary fixture fields.

Transaction constraints:

| Field | Type / values | Required |
| --- | --- | --- |
| `walletType` | `spending \| crypto` | yes |
| `transferMode` | `u_tag \| on_chain` | yes |
| `asset` | non-empty string | yes |
| `network` | string or `null` | yes |
| `recipient.kind` | `u_tag \| wallet` | yes |
| `recipient.identifier` | string | no |
| `recipient.fingerprint` | string | no |
| `recipient.known` | boolean or `null` | yes |
| `recipient.provenance` | `host-provided \| user-provided \| derived \| simulated \| unavailable` | yes |
| `message` | string | no |
| `rawDestination` | string | no |
| `availableBalance` | number | no |

## Exact success response schema

```ts
type EvaluateResponse = {
  assessment: {
    financial: {
      status: "safe" | "review" | "high_risk";
      safeToSpendBefore: number;
      safeToSpendAfter: number;
      transactionAmount: number;
      reasons: Array<{ code: string; message: string }>;
      missingFields: string[];
    };
    trust: {
      status: "low" | "review" | "high" | "unknown";
      indicators: Array<{
        id: string;
        kind: string;
        evidence: string;
        provenance: "host-provided" | "user-provided" | "derived" | "simulated" | "unavailable";
      }>;
      missingFields: string[];
    };
  };
  ai: {
    explanation: {
      summary: string;
      reasons: Array<{
        category: "financial" | "trust" | "missing_context";
        text: string;
        evidenceIds: string[];
      }>;
      nextStep: string;
      missingContextQuestions: Array<{ field: string; question: string }>;
      suggestedIndicators: Array<{ kind: string; evidenceIds: string[] }>;
      source: "qwen" | "fallback";
      review: { status: "not_run" | "consistent" | "suggested_escalation" | "unavailable" };
    };
    qwenReview: null | {
      model: "qwen/qwen3.5-9b";
      provider: "openrouter";
      reviewStatus: "completed";
      indicators: Array<{
        type: string;
        evidenceId: string;
        evidence: string;
        provenance: "host-provided" | "user-provided" | "derived" | "simulated" | "unavailable";
      }>;
      missingContext: string[];
      contradictions: string[];
      suggestedEscalation: boolean;
      reasoningSummary: string;
    };
    jevDecision: null | {
      model: "typesafe/jev-1.14";
      provider: "openrouter";
      decisionStatus: "completed";
      reviewProbability: number;
      suggestedEscalation: boolean;
    };
    comparison: {
      providerStatus: {
        qwen: "completed" | "not_run" | "unavailable";
        jev: "completed" | "not_run" | "unavailable";
      };
      supportedAgreement: string[];
      differingFindings: Array<{ provider: "qwen"; type: string }>;
      qwenSupportedIndicators: Array<{
        type: string;
        evidenceId: string;
        provenance: "host-provided" | "user-provided" | "derived" | "simulated" | "unavailable";
      }>;
      unsupportedClaims: Array<{ provider: "qwen"; type: string; evidenceId: string }>;
      missingEvidence: string[];
      contradictions: string[];
      suggestedEscalation: boolean;
      jevVerification: "not_run" | "supports_review" | "does_not_support_review" | "unavailable";
    };
  };
};
```

## Rendering rules

- `assessment.financial.status` and `assessment.trust.status` are authoritative. AI fields must never replace or relabel them.
- `explanation.source === "qwen"` means the Qwen3.5-9B response passed structural and evidence validation.
- `explanation.source === "fallback"` means deterministic local copy is being shown. Do not label it as AI-verified.
- `qwenReview === null` plus `comparison.providerStatus.qwen === "unavailable"` means primary analysis did not complete; it does not mean safe.
- `jevDecision === null` with Jev `not_run` is expected for normal/contextual routes; Jev is only eligible on uncertain evidence after valid Qwen output.
- Show `missingContextQuestions` separately as optional prompts, not as reasons or failures.
- Treat `comparison.supportedAgreement` as evidence consistently cited by Qwen's explanation and review, not a vote or confidence score.
- Show `unsupportedClaims` only in diagnostics unless product explicitly designs a user-facing treatment.

## Exact migration notice for Ete

This is a required attribution migration, not a visual-only rename.

| Legacy field/value | Current field/value | Action |
| --- | --- | --- |
| `ai.explanation.source: "ubot"` | `ai.explanation.source: "qwen"` | Replace the legacy branch and label it Qwen3.5-9B. Never alias `qwen` back to `ubot`. |
| `comparison.providerStatus.ubot` | `comparison.providerStatus.qwen` | Rename the primary status key. |
| `comparison.providerStatus.qwen` | `comparison.providerStatus.jev` | The old secondary-Qwen key now represents Jev and must be renamed. |
| Qwen reviewer model `qwen/qwen3.5-27b` | `qwen/qwen3.5-9b` | Update literal types, labels, snapshots, and analytics dimensions. |
| no typed verifier result | `ai.jevDecision` | Add as nullable; do not treat `null` as safe or as an error by itself. |
| no verifier comparison state | `comparison.jevVerification` | Add the four-value union from the response schema above. |

The outer `{ assessment, ai }` envelope, authoritative `assessment`, `ai.explanation`, `ai.qwenReview`, HTTP statuses, and error envelope remain compatible. Remove exhaustive assumptions that `qwenReview === null` implies provider failure: on a normal zero-call route it is `null` with both provider statuses `not_run`.

Expected provider states:

| Route | Explanation source | Qwen status | Jev status |
| --- | --- | --- | --- |
| normal | `fallback` | `not_run` | `not_run` |
| contextual success | `qwen` | `completed` | `not_run` |
| uncertain success | `qwen` | `completed` | `completed` |
| Qwen unavailable | `fallback` | `unavailable` | `not_run` |
| Jev unavailable after valid Qwen | `qwen` | `completed` | `unavailable` |

## Proven fictional scenarios

The reusable fixtures in `tests/fixtures/demo-scenarios.ts` cover:

| Scenario | Financial | Trust | Expected emphasis |
| --- | --- | --- | --- |
| A — safe U-Tag | `safe` | `low` | commitments remain covered |
| B — sufficient balance, insufficient safe-to-spend | `review` | `low` | available balance is not the safe-to-spend result |
| C — suspicious crypto with explicit evidence | `safe` | `high` | affordability does not cancel recipient risk |

Scenario A proves zero-call routing. Scenarios B and C prove Qwen-only routing and Qwen fallback. Separate unit coverage proves uncertain-evidence Qwen→Jev routing. All provider outages preserve the exact engine assessment.

## Error envelope

```json
{
  "error": {
    "code": "invalid_request | assessment_unavailable | engine_unavailable",
    "message": "Safe user-facing text without provider or engine internals."
  }
}
```

| HTTP | Code | Meaning |
| --- | --- | --- |
| `400` | `invalid_request` | malformed JSON or unsupported request shape |
| `503` | `assessment_unavailable` | injected engine failed or produced unusable output |
| `503` | `engine_unavailable` | production engine has not been connected |
