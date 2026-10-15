# Frontend Integration: `POST /api/evaluate` (Ete)

This is the contract the prototype (`public/u-topia-handshake.html`, served at `/`) uses today. It is written from the code, not from a plan:

| Concern | Source of truth |
| --- | --- |
| Request schema, provenance rule, limits | `lib/domain/schemas.ts` |
| Response envelope | `lib/api/evaluate-handler.ts` |
| Breakdown, reason copy, recommended actions | `lib/api/adapter.ts` |
| Size cap, rate limit, paid-AI gating | `lib/api/guards.ts` |
| AI output types | `lib/ai/types.ts` |

The endpoint is a **simulation**: it evaluates a proposed payment and never moves money. Every success response carries `"simulation": true`.

Superseded: the earlier `{ financialContext, transaction }` request and the `503 engine_unavailable` production response no longer exist. The route is wired to Archay's engines (`app/api/evaluate/route.ts` → `createEvaluateHandler()`).

## Calling the endpoint

```http
POST /api/evaluate
Content-Type: application/json
x-uh-ai: off            (optional — skip paid AI for this request)
```

- `Content-Type` must be `application/json`, otherwise `415`.
- The body may be at most **8 KiB** (8192 bytes), otherwise `413`. The server stops reading as soon as the cap is passed.
- Each client (first `x-forwarded-for` address, else `x-real-ip`) gets **20 requests per 60 seconds** per server instance, otherwise `429` with `Retry-After`.
- `x-uh-ai: off` only matters when paid AI is configured on the server; the response then reports `ai.mode: "client_opt_out"`. The prototype sends it when its "AI down" toggle is on.
- Every response has `Cache-Control: no-store`.

Recommended UI states:

1. **Loading:** disable repeat submission.
2. **`200`:** render `assessment` as the decision; `breakdown`, `reasons`, `recommendedActions` as its explanation; `ai` as optional supporting text.
3. **`400`:** keep the user's input and show a correctable message (`error.issues` gives field paths).
4. **`413` / `415`:** client bug; log it.
5. **`429`:** wait `Retry-After` seconds and let the user retry.
6. **`503 assessment_unavailable`:** no authoritative result exists; do not show any status.

## Request

Every evidence field is a **sourced value**: `{ "value": ..., "provenance": ... }`.

- `provenance` is one of `host_provided`, `user_provided`, `llm_extracted`, `derived`, `simulated`, `unavailable`.
- **`value` is `null` if and only if `provenance` is `"unavailable"`.** `{ "value": 100, "provenance": "unavailable" }` and `{ "value": null, "provenance": "simulated" }` are both rejected with `400`.
- Objects are strict: unknown keys are rejected.

| Field | `value` type (or `null`) | Limits |
| --- | --- | --- |
| `scenarioId` | plain string, optional, not sourced | `^[a-z0-9-]{1,64}$` |
| `walletType` | `"crypto" \| "spending"` | |
| `transferMode` | `"u_tag" \| "on_chain"` | |
| `currency` | asset code — unit of balance, obligations, debt and buffer (e.g. `THB`) | `^[A-Z0-9]{2,12}$` |
| `availableBalance` | number | finite, ≥ 0, ≤ 1,000,000,000,000 |
| `essentialObligations` | number | same |
| `debtDue` | number | same |
| `protectedBuffer` | number | same |
| `amount` | number — in `asset` units | finite, > 0, ≤ 1,000,000,000,000 |
| `asset` | asset code — unit of `amount` and `recentMedianAmount` | `^[A-Z0-9]{2,12}$` |
| `network` | string | `^[A-Za-z0-9 ._()-]{1,48}$` |
| `recipient.kind` | `"u_tag" \| "wallet_address"` | |
| `recipient.identifier` | string | 1–128 chars |
| `recipient.isNew` | boolean | |
| `recipient.previousTransactionCount` | integer | 0–1,000,000 |
| `recentMedianAmount` | number | finite, ≥ 0, ≤ 1,000,000,000,000 |
| `context.*` (9 flags) | boolean | `urgency`, `secrecyRequest`, `guaranteedOrHighReturn`, `impersonation`, `unexpectedContact`, `moveMoneyToProtect`, `advanceFeeOrPrize`, `romanceOrOnlineOnlyRelationship`, `paymentMethodDemand` |

All fields above except `scenarioId` are required keys; send `{ "value": null, "provenance": "unavailable" }` when a value is unknown. Do not guess: missing financial inputs produce an honest `review` with `missingFields`, never an estimate.

If `asset` differs from `currency` (e.g. a USDC payment against THB obligations), affordability is **not** calculated: no exchange rate is approved, so financial status is `review` with `missingFields: ["exchangeRate"]` and `breakdown: null`.

## Success response (`200`)

```ts
type Provenance = "host_provided" | "user_provided" | "llm_extracted" | "derived" | "simulated" | "unavailable";
type ProviderStatus = "completed" | "not_run" | "unavailable";

type EvaluateResponse = {
  simulation: true;
  engineVersion: string; // "safe-to-pay-rules v1 + scam-context-v1"

  // Authoritative engine output, unchanged. Statuses come only from here.
  assessment: {
    financial: {
      status: "safe" | "review" | "high_risk";
      safeToSpendBefore: number | null;      // null when not assessable
      safeToSpendAfter: number | null;       // unclamped: negative = shortfall vs obligations + buffer
      postTransactionBalance: number | null;
      affectedCommitments: string[];         // "mandatory_obligations" | "protected_buffer"
      reasonCodes: string[];                 // see docs/financial-engine-integration.md
      missingFields: string[];
    };
    trust: {
      status: "not_assessed" | "low" | "review" | "high" | "unknown"; // engine never emits "not_assessed"
      riskScore: number | null;              // 0..1, null when the model could not run
      indicators: string[];                  // e.g. "new_recipient", "urgency"
      modelVersion: string | null;           // "scam-context-v1", null when the model could not run
    };
  };

  // Display values derived from the request and the engine output; null when not assessed.
  breakdown: null | {
    currency: string;
    availableBalance: number; essentialObligations: number; debtDue: number;
    mandatoryObligations: number;            // essentialObligations + debtDue ("must keep")
    protectedBuffer: number; amount: number;
    postTransactionBalance: number; safeToSpendBefore: number; safeToSpendAfter: number;
    shortfallVsMandatory: number;            // max(0, mandatory − post)
    bufferUsed: number;
    maxSafeAmount: number;                   // = safeToSpendBefore
  };

  // Deterministic user-facing copy.
  reasons: {
    financial: Array<{ code: string; message: string }>;
    trust: Array<{ id: string; kind: string; evidence: string; provenance: Provenance }>; // id = "indicator-<kind>"
  };
  missingContext: {
    financial: string[];                     // e.g. ["exchangeRate"], ["amount", "currency"]
    trust: string[];                         // "recipientHistory" | "recentMedianAmount" when the model could not run
  };
  recommendedActions: Array<"proceed" | "reduce_amount" | "verify_recipient" | "postpone" | "cancel">;

  // Supporting AI layer. Never changes anything above.
  ai: {
    mode: "disabled" | "live" | "budget_exhausted" | "client_opt_out";
    route: "none" | "qwen" | "qwen_jev";
    explanation: {
      summary: string;
      reasons: Array<{ category: "financial" | "trust" | "missing_context"; text: string; evidenceIds: string[] }>;
      nextStep: string;
      missingContextQuestions: Array<{ field: string; question: string }>;
      suggestedIndicators: Array<{ kind: string; evidenceIds: string[] }>;
      source: "qwen" | "fallback";
      review: { status: "not_run" | "consistent" | "suggested_escalation" | "unavailable" };
    };
    grounding: { accepted: boolean; violations: string[] }; // accepted is false whenever Qwen produced nothing
    qwenReview: null | {
      model: "qwen/qwen3.5-9b"; provider: "openrouter"; reviewStatus: "completed";
      indicators: Array<{ type: string; evidenceId: string; evidence: string; provenance: Provenance }>;
      missingContext: string[]; contradictions: string[];
      suggestedEscalation: boolean; reasoningSummary: string;
    };
    jevDecision: null | {
      model: "typesafe/jev-1.14"; provider: "openrouter"; decisionStatus: "completed";
      reviewProbability: number; suggestedEscalation: boolean; // true iff reviewProbability >= 0.5
    };
    comparison: {
      providerStatus: { qwen: ProviderStatus; jev: ProviderStatus };
      supportedAgreement: string[];
      differingFindings: Array<{ provider: "qwen"; type: string }>;
      qwenSupportedIndicators: Array<{ type: string; evidenceId: string; provenance: Provenance }>;
      unsupportedClaims: Array<{ provider: "qwen"; type: string; evidenceId: string }>;
      missingEvidence: string[];
      contradictions: string[];
      suggestedEscalation: boolean;
      jevVerification: "not_run" | "supports_review" | "does_not_support_review" | "unavailable";
    };
    usage: Array<{
      provider: "openrouter"; model: "qwen/qwen3.5-9b" | "typesafe/jev-1.14";
      inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number | null;
    }>; // this request's paid calls only; [] when no provider ran
  };
};
```

## Rendering rules

- `assessment.financial.status` and `assessment.trust.status` are the decision. AI fields must never replace, relabel or soften them.
- Financial and trust are independent: an affordable payment can still be High trust risk, and vice versa.
- When `breakdown` is `null`, show the `reasons.financial` messages and `missingContext.financial`, never a computed number.
- The UI always offers all five actions; `recommendedActions` only highlights some. The user decides.
- `ai.explanation.source === "fallback"` is deterministic copy built from the assessment. Do not label it as AI.
- `ai.explanation.source === "qwen"` means Qwen3.5-9B prose passed schema validation, evidence/provenance checks and the grounding rules (`ai.grounding.accepted === true`).
- `ai.route` is what the assessment *would* use; `ai.mode` says whether paid AI was allowed. With `mode !== "live"` and `route !== "none"`, Qwen reports `unavailable` and the fallback is shown. Use `mode` to explain why (disabled / budget / opt-out), not to signal an error.
- `qwenReview === null` never means safe. `jevDecision === null` is normal unless `route === "qwen_jev"` and Qwen completed.
- Show `missingContextQuestions` as optional prompts, not as reasons or failures.
- Keep `unsupportedClaims`, `grounding.violations` and `usage` in the integration inspector / diagnostics.

Expected AI states:

| Situation | `mode` | `route` | `explanation.source` | Qwen | Jev |
| --- | --- | --- | --- | --- | --- |
| Safe, Low, no indicators | any | `none` | `fallback` (`review.status: not_run`) | `not_run` | `not_run` |
| AI off / budget / opt-out, any other route | not `live` | `qwen` or `qwen_jev` | `fallback` (`unavailable`) | `unavailable` | `not_run` |
| Live, contextual, Qwen accepted | `live` | `qwen` | `qwen` | `completed` | `not_run` |
| Live, uncertain, both completed | `live` | `qwen_jev` | `qwen` | `completed` | `completed` |
| Live, Qwen failed or rejected by grounding | `live` | `qwen` or `qwen_jev` | `fallback` | `unavailable` or `completed` | `not_run` or `completed` |
| Live, Jev failed after valid Qwen | `live` | `qwen_jev` | `qwen` | `completed` | `unavailable` |

## Errors

```json
{ "error": { "code": "invalid_request", "message": "Request body does not match the evaluation contract.",
             "issues": [{ "path": "amount.provenance", "message": "value must be null if and only if provenance is unavailable" }] } }
```

| HTTP | `error.code` | Meaning |
| --- | --- | --- |
| `400` | `invalid_request` | Not valid JSON, or does not match the schema. Schema errors include up to 10 `issues` with `path` and `message`; submitted values are never echoed. |
| `413` | `payload_too_large` | Body over 8192 bytes. |
| `415` | `unsupported_media_type` | `Content-Type` is not `application/json`. |
| `429` | `rate_limited` | Over 20 requests/minute for this client; honour `Retry-After`. |
| `503` | `assessment_unavailable` | The engine threw or produced output that failed validation. No result is shown. |

AI provider failures are never errors: they return `200` with the fallback explanation.

## Demo scenarios: real request/response pairs

Each request is the `request` object from `examples/demo-scenarios/*.json` (listed in `manifest.json`). Each response was produced on 2026-10-15 by calling `createEvaluateHandler({ env: {} })` directly in a plain Node script — no test runner, no network, paid AI disabled — so `ai.mode` is `"disabled"`. Regenerate these if the engine, adapter or scenarios change.

### Scenario A — Safe U-Tag purchase (`examples/demo-scenarios/scenario-a-safe-u-tag.json`)

Assumptions (from the scenario file):

- All values are fictional demo data with provenance "simulated"; none is verified user history.
- Profile (balance 18,500 THB; essentials 7,200; debt/BNPL 2,800; protected buffer 3,000) is taken from Ete's prototype PROFILE so every layer shows one user.
- recentMedianAmount 2,500 THB is an assumed simulated baseline, not observed history; it only feeds the trust model's unusual-amount feature.
- Recipient @coffee-lab with 6 previous transfers is a simulated contact.

Request:

```json
{
  "scenarioId": "safe-u-tag",
  "walletType": { "value": "spending", "provenance": "simulated" },
  "transferMode": { "value": "u_tag", "provenance": "simulated" },
  "currency": { "value": "THB", "provenance": "simulated" },
  "availableBalance": { "value": 18500, "provenance": "simulated" },
  "essentialObligations": { "value": 7200, "provenance": "simulated" },
  "debtDue": { "value": 2800, "provenance": "simulated" },
  "protectedBuffer": { "value": 3000, "provenance": "simulated" },
  "amount": { "value": 1290, "provenance": "simulated" },
  "asset": { "value": "THB", "provenance": "simulated" },
  "network": { "value": null, "provenance": "unavailable" },
  "recipient": {
    "kind": { "value": "u_tag", "provenance": "simulated" },
    "identifier": { "value": "@coffee-lab", "provenance": "simulated" },
    "isNew": { "value": false, "provenance": "simulated" },
    "previousTransactionCount": { "value": 6, "provenance": "simulated" }
  },
  "recentMedianAmount": { "value": 2500, "provenance": "simulated" },
  "context": {
    "urgency": { "value": null, "provenance": "unavailable" },
    "secrecyRequest": { "value": null, "provenance": "unavailable" },
    "guaranteedOrHighReturn": { "value": null, "provenance": "unavailable" },
    "impersonation": { "value": null, "provenance": "unavailable" },
    "unexpectedContact": { "value": null, "provenance": "unavailable" },
    "moveMoneyToProtect": { "value": null, "provenance": "unavailable" },
    "advanceFeeOrPrize": { "value": null, "provenance": "unavailable" },
    "romanceOrOnlineOnlyRelationship": { "value": null, "provenance": "unavailable" },
    "paymentMethodDemand": { "value": null, "provenance": "unavailable" }
  }
}
```

Response (`200`, AI disabled):

```json
{
  "simulation": true,
  "engineVersion": "safe-to-pay-rules v1 + scam-context-v1",
  "assessment": {
    "financial": {
      "status": "safe",
      "safeToSpendBefore": 5500,
      "safeToSpendAfter": 4210,
      "postTransactionBalance": 17210,
      "affectedCommitments": [],
      "reasonCodes": ["WITHIN_SAFE_TO_SPEND"],
      "missingFields": []
    },
    "trust": {
      "status": "low",
      "riskScore": 0.07962913284580567,
      "indicators": [],
      "modelVersion": "scam-context-v1"
    }
  },
  "breakdown": {
    "currency": "THB",
    "availableBalance": 18500,
    "essentialObligations": 7200,
    "debtDue": 2800,
    "mandatoryObligations": 10000,
    "protectedBuffer": 3000,
    "amount": 1290,
    "postTransactionBalance": 17210,
    "safeToSpendBefore": 5500,
    "safeToSpendAfter": 4210,
    "shortfallVsMandatory": 0,
    "bufferUsed": 0,
    "maxSafeAmount": 5500
  },
  "reasons": {
    "financial": [
      {
        "code": "WITHIN_SAFE_TO_SPEND",
        "message": "Balance after payment (฿17,210) stays above must keep plus buffer (฿13,000)."
      },
      { "code": "WITHIN_SAFE_TO_SPEND", "message": "Safe-to-spend after payment: ฿4,210." }
    ],
    "trust": []
  },
  "missingContext": { "financial": [], "trust": [] },
  "recommendedActions": ["proceed"],
  "ai": {
    "mode": "disabled",
    "route": "none",
    "explanation": {
      "summary": "The authoritative assessment says required commitments remain covered after this transaction.",
      "reasons": [
        {
          "category": "financial",
          "text": "Balance after payment (฿17,210) stays above must keep plus buffer (฿13,000).",
          "evidenceIds": []
        },
        {
          "category": "financial",
          "text": "Safe-to-spend after payment: ฿4,210.",
          "evidenceIds": []
        }
      ],
      "nextStep": "Review the amount and recipient, then decide whether to continue.",
      "source": "fallback",
      "review": { "status": "not_run" },
      "missingContextQuestions": [],
      "suggestedIndicators": []
    },
    "grounding": { "accepted": false, "violations": [] },
    "qwenReview": null,
    "jevDecision": null,
    "comparison": {
      "providerStatus": { "qwen": "not_run", "jev": "not_run" },
      "supportedAgreement": [],
      "differingFindings": [],
      "qwenSupportedIndicators": [],
      "unsupportedClaims": [],
      "missingEvidence": [],
      "contradictions": [],
      "suggestedEscalation": false,
      "jevVerification": "not_run"
    },
    "usage": []
  }
}
```

### Scenario B — Balance is enough, Safe-to-Spend is not (`examples/demo-scenarios/scenario-b-insufficient-safe-to-spend.json`)

Assumptions (from the scenario file):

- All values are fictional demo data with provenance "simulated"; none is verified user history.
- Profile (balance 18,500 THB; essentials 7,200; debt/BNPL 2,800; protected buffer 3,000) is taken from Ete's prototype PROFILE so every layer shows one user.
- recentMedianAmount 2,500 THB is an assumed simulated baseline, not observed history. With a baseline below about 2,300 THB the unusual-amount feature would move trust to Review or High; the financial High Risk result does not depend on it.
- Recipient @phone-store with 1 previous transfer is a simulated contact.

Request:

```json
{
  "scenarioId": "balance-enough-safe-to-spend-not-enough",
  "walletType": { "value": "spending", "provenance": "simulated" },
  "transferMode": { "value": "u_tag", "provenance": "simulated" },
  "currency": { "value": "THB", "provenance": "simulated" },
  "availableBalance": { "value": 18500, "provenance": "simulated" },
  "essentialObligations": { "value": 7200, "provenance": "simulated" },
  "debtDue": { "value": 2800, "provenance": "simulated" },
  "protectedBuffer": { "value": 3000, "provenance": "simulated" },
  "amount": { "value": 12900, "provenance": "simulated" },
  "asset": { "value": "THB", "provenance": "simulated" },
  "network": { "value": null, "provenance": "unavailable" },
  "recipient": {
    "kind": { "value": "u_tag", "provenance": "simulated" },
    "identifier": { "value": "@phone-store", "provenance": "simulated" },
    "isNew": { "value": false, "provenance": "simulated" },
    "previousTransactionCount": { "value": 1, "provenance": "simulated" }
  },
  "recentMedianAmount": { "value": 2500, "provenance": "simulated" },
  "context": {
    "urgency": { "value": null, "provenance": "unavailable" },
    "secrecyRequest": { "value": null, "provenance": "unavailable" },
    "guaranteedOrHighReturn": { "value": null, "provenance": "unavailable" },
    "impersonation": { "value": null, "provenance": "unavailable" },
    "unexpectedContact": { "value": null, "provenance": "unavailable" },
    "moveMoneyToProtect": { "value": null, "provenance": "unavailable" },
    "advanceFeeOrPrize": { "value": null, "provenance": "unavailable" },
    "romanceOrOnlineOnlyRelationship": { "value": null, "provenance": "unavailable" },
    "paymentMethodDemand": { "value": null, "provenance": "unavailable" }
  }
}
```

Response (`200`, AI disabled):

```json
{
  "simulation": true,
  "engineVersion": "safe-to-pay-rules v1 + scam-context-v1",
  "assessment": {
    "financial": {
      "status": "high_risk",
      "safeToSpendBefore": 5500,
      "safeToSpendAfter": -7400,
      "postTransactionBalance": 5600,
      "affectedCommitments": ["mandatory_obligations", "protected_buffer"],
      "reasonCodes": ["MANDATORY_OBLIGATIONS_AT_RISK"],
      "missingFields": []
    },
    "trust": {
      "status": "low",
      "riskScore": 0.605911176817072,
      "indicators": [],
      "modelVersion": "scam-context-v1"
    }
  },
  "breakdown": {
    "currency": "THB",
    "availableBalance": 18500,
    "essentialObligations": 7200,
    "debtDue": 2800,
    "mandatoryObligations": 10000,
    "protectedBuffer": 3000,
    "amount": 12900,
    "postTransactionBalance": 5600,
    "safeToSpendBefore": 5500,
    "safeToSpendAfter": -7400,
    "shortfallVsMandatory": 4400,
    "bufferUsed": 3000,
    "maxSafeAmount": 5500
  },
  "reasons": {
    "financial": [
      {
        "code": "MANDATORY_OBLIGATIONS_AT_RISK",
        "message": "Balance after payment would be ฿5,600, which is ฿4,400 below must keep (฿10,000)."
      },
      {
        "code": "MANDATORY_OBLIGATIONS_AT_RISK",
        "message": "Your protected buffer (฿3,000) would be fully used."
      },
      {
        "code": "MANDATORY_OBLIGATIONS_AT_RISK",
        "message": "The most you can pay and keep everything covered: ฿5,500."
      }
    ],
    "trust": []
  },
  "missingContext": { "financial": [], "trust": [] },
  "recommendedActions": ["reduce_amount", "postpone"],
  "ai": {
    "mode": "disabled",
    "route": "qwen",
    "explanation": {
      "summary": "The authoritative assessment indicates this transaction would leave required commitments uncovered.",
      "reasons": [
        {
          "category": "financial",
          "text": "Balance after payment would be ฿5,600, which is ฿4,400 below must keep (฿10,000).",
          "evidenceIds": []
        },
        {
          "category": "financial",
          "text": "Your protected buffer (฿3,000) would be fully used.",
          "evidenceIds": []
        },
        {
          "category": "financial",
          "text": "The most you can pay and keep everything covered: ฿5,500.",
          "evidenceIds": []
        }
      ],
      "nextStep": "Reduce or postpone the transaction, then review the authoritative assessment again.",
      "source": "fallback",
      "review": { "status": "unavailable" },
      "missingContextQuestions": [],
      "suggestedIndicators": []
    },
    "grounding": { "accepted": false, "violations": [] },
    "qwenReview": null,
    "jevDecision": null,
    "comparison": {
      "providerStatus": { "qwen": "unavailable", "jev": "not_run" },
      "supportedAgreement": [],
      "differingFindings": [],
      "qwenSupportedIndicators": [],
      "unsupportedClaims": [],
      "missingEvidence": [],
      "contradictions": [],
      "suggestedEscalation": false,
      "jevVerification": "not_run"
    },
    "usage": []
  }
}
```

### Scenario C — Suspicious crypto transfer (`examples/demo-scenarios/scenario-c-suspicious-crypto.json`)

Assumptions (from the scenario file):

- All values are fictional demo data with provenance "simulated"; none is verified user history.
- Profile (balance 18,500 THB; essentials 7,200; debt/BNPL 2,800; protected buffer 3,000) is taken from Ete's prototype PROFILE so every layer shows one user.
- 120 USDC is compared against THB obligations; no exchange rate is approved, so affordability is Review with exchangeRate missing.
- recentMedianAmount 40 USDC is an assumed simulated crypto-wallet baseline.
- Urgency, secrecy and guaranteed-return flags are supplied by the scenario's fictional message, not inferred by ML or an LLM.
- destination:demo-risk-001 is a placeholder, not a real wallet address.

Request:

```json
{
  "scenarioId": "new-destination-crypto",
  "walletType": { "value": "crypto", "provenance": "simulated" },
  "transferMode": { "value": "on_chain", "provenance": "simulated" },
  "currency": { "value": "THB", "provenance": "simulated" },
  "availableBalance": { "value": 18500, "provenance": "simulated" },
  "essentialObligations": { "value": 7200, "provenance": "simulated" },
  "debtDue": { "value": 2800, "provenance": "simulated" },
  "protectedBuffer": { "value": 3000, "provenance": "simulated" },
  "amount": { "value": 120, "provenance": "simulated" },
  "asset": { "value": "USDC", "provenance": "simulated" },
  "network": { "value": "XNet (fictional)", "provenance": "simulated" },
  "recipient": {
    "kind": { "value": "wallet_address", "provenance": "simulated" },
    "identifier": { "value": "destination:demo-risk-001", "provenance": "simulated" },
    "isNew": { "value": true, "provenance": "simulated" },
    "previousTransactionCount": { "value": 0, "provenance": "simulated" }
  },
  "recentMedianAmount": { "value": 40, "provenance": "simulated" },
  "context": {
    "urgency": { "value": true, "provenance": "simulated" },
    "secrecyRequest": { "value": true, "provenance": "simulated" },
    "guaranteedOrHighReturn": { "value": true, "provenance": "simulated" },
    "impersonation": { "value": null, "provenance": "unavailable" },
    "unexpectedContact": { "value": null, "provenance": "unavailable" },
    "moveMoneyToProtect": { "value": null, "provenance": "unavailable" },
    "advanceFeeOrPrize": { "value": null, "provenance": "unavailable" },
    "romanceOrOnlineOnlyRelationship": { "value": null, "provenance": "unavailable" },
    "paymentMethodDemand": { "value": null, "provenance": "unavailable" }
  }
}
```

Response (`200`, AI disabled):

```json
{
  "simulation": true,
  "engineVersion": "safe-to-pay-rules v1 + scam-context-v1",
  "assessment": {
    "financial": {
      "status": "review",
      "safeToSpendBefore": null,
      "safeToSpendAfter": null,
      "postTransactionBalance": null,
      "affectedCommitments": [],
      "reasonCodes": ["CURRENCY_CONVERSION_UNAVAILABLE"],
      "missingFields": ["exchangeRate"]
    },
    "trust": {
      "status": "high",
      "riskScore": 0.9709041650641165,
      "indicators": ["new_recipient", "urgency", "secrecy_request", "guaranteed_or_high_return"],
      "modelVersion": "scam-context-v1"
    }
  },
  "breakdown": null,
  "reasons": {
    "financial": [
      {
        "code": "CURRENCY_CONVERSION_UNAVAILABLE",
        "message": "This payment is in USDC but your balance and obligations are in THB."
      },
      {
        "code": "CURRENCY_CONVERSION_UNAVAILABLE",
        "message": "No approved exchange rate is available, so affordability was not calculated. Nothing was converted or estimated."
      }
    ],
    "trust": [
      {
        "id": "indicator-new_recipient",
        "kind": "new_recipient",
        "evidence": "The recipient has no previous transfers from this wallet.",
        "provenance": "simulated"
      },
      {
        "id": "indicator-urgency",
        "kind": "urgency",
        "evidence": "The supplied context says the request pressures you to act quickly.",
        "provenance": "simulated"
      },
      {
        "id": "indicator-secrecy_request",
        "kind": "secrecy_request",
        "evidence": "The supplied context says you were asked to keep the payment secret.",
        "provenance": "simulated"
      },
      {
        "id": "indicator-guaranteed_or_high_return",
        "kind": "guaranteed_or_high_return",
        "evidence": "The supplied context promises a guaranteed or unusually high return.",
        "provenance": "simulated"
      }
    ]
  },
  "missingContext": { "financial": ["exchangeRate"], "trust": [] },
  "recommendedActions": ["verify_recipient", "cancel"],
  "ai": {
    "mode": "disabled",
    "route": "qwen_jev",
    "explanation": {
      "summary": "Affordability could not be fully checked because some financial context is missing, so the result is marked Review. No values were estimated.",
      "reasons": [
        {
          "category": "financial",
          "text": "This payment is in USDC but your balance and obligations are in THB.",
          "evidenceIds": []
        },
        {
          "category": "financial",
          "text": "No approved exchange rate is available, so affordability was not calculated. Nothing was converted or estimated.",
          "evidenceIds": []
        },
        {
          "category": "trust",
          "text": "The recipient has no previous transfers from this wallet.",
          "evidenceIds": ["indicator-new_recipient"]
        },
        {
          "category": "trust",
          "text": "The supplied context says the request pressures you to act quickly.",
          "evidenceIds": ["indicator-urgency"]
        },
        {
          "category": "trust",
          "text": "The supplied context says you were asked to keep the payment secret.",
          "evidenceIds": ["indicator-secrecy_request"]
        },
        {
          "category": "trust",
          "text": "The supplied context promises a guaranteed or unusually high return.",
          "evidenceIds": ["indicator-guaranteed_or_high_return"]
        }
      ],
      "nextStep": "Verify the recipient and request independently, or cancel the transaction.",
      "source": "fallback",
      "review": { "status": "unavailable" },
      "missingContextQuestions": [
        {
          "field": "exchangeRate",
          "question": "Can you provide the missing exchangeRate context before deciding?"
        }
      ],
      "suggestedIndicators": []
    },
    "grounding": { "accepted": false, "violations": [] },
    "qwenReview": null,
    "jevDecision": null,
    "comparison": {
      "providerStatus": { "qwen": "unavailable", "jev": "not_run" },
      "supportedAgreement": [],
      "differingFindings": [],
      "qwenSupportedIndicators": [],
      "unsupportedClaims": [],
      "missingEvidence": [],
      "contradictions": [],
      "suggestedEscalation": false,
      "jevVerification": "not_run"
    },
    "usage": []
  }
}
```
