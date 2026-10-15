# Financial Engine Integration (Archay)

## Required boundary

Implement the `AssessmentEngine` interface exported from `app/api/evaluate/route.ts`:

```ts
export interface AssessmentEngine {
  evaluate(request: EvaluationRequest): Promise<AuthoritativeAssessment>;
}
```

Then bind the production route through the existing dependency-injection seam:

```ts
export const POST = createEvaluateHandler({
  engine: assessmentEngine,
  qwenProvider,
  jevProvider,
});
```

Do not accept an assessment from the HTTP caller. The route must obtain it from the injected authoritative engine.

## Input contract

```ts
interface EvaluationRequest {
  financialContext: Record<string, unknown>;
  transaction: TransactionContext;
}
```

The route validates and normalizes `transaction` before engine invocation. `financialContext` remains opaque to the AI layer and must be finalized by the engine team. Current fictional fixture keys such as `scenarioId` and `fixture` are test-only and are not a proposed production schema.

The engine may inspect transaction fields including amounts, recipient identifiers, raw destinations, and messages. The AI layer creates a separate minimized context and excludes those sensitive values.

## Required output

Return exactly the `AuthoritativeAssessment` shape from `lib/ai/types.ts`:

```ts
interface AuthoritativeAssessment {
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
}
```

Integration expectations:

- Financial and trust statuses are independent. A financially affordable transfer can still have `trust.status: "high"`.
- `safeToSpendAfter` is the engine result, not necessarily `safeToSpendBefore - transactionAmount`; define and test the engine's exact rule.
- `reasons[].code` must be stable for provider context and UI logic. `message` is user-facing fallback copy.
- Each trust indicator needs a stable unique `id`. Models can cite only these IDs.
- `evidence` must state the supplied or derived fact without inventing source data.
- `provenance` must describe the evidence source accurately.
- List unavailable inputs in the relevant `missingFields`; do not silently assume them.

## Missing context

The AI layer combines financial and trust `missingFields` into a de-duplicated provider context. Deterministic fallback copy currently has tailored questions for:

- `recipientHistory`
- `recipient`
- `messageContext`

Other fields receive generic copy. Coordinate before introducing a field that requires precise user-facing wording.

Missing context should normally produce the engine's explicit conservative status rather than an exception. Throw only when no trustworthy assessment can be produced.

## Error behavior

- If `evaluate()` rejects, the route returns `503 assessment_unavailable` with no internal error text.
- If the assessment cannot be consumed by the AI orchestration, the route also returns `503 assessment_unavailable`.
- AI provider failures do not fail a valid engine assessment. The route returns `200`, preserves the assessment unchanged, and supplies deterministic fallback metadata.
- The production export continues returning `503 engine_unavailable` until the real engine is deliberately bound.

The engine should not log secrets or embed credentials, raw wallet addresses, private identifiers, or unrestricted transaction messages in thrown errors.

## Comparison boundary

The dual-provider comparison is advisory only. It may:

- match provider findings to an engine evidence ID and exact provenance;
- report provider agreement/differences;
- reject unsupported claims;
- surface contradictions and a supported escalation suggestion.

It must never change financial values, financial status, trust status, reason codes, or evidence. The route returns a structured clone of the engine assessment and the integration suite verifies it is unchanged in all provider availability states.

## Contract-confirmation checklist

- Finalize `financialContext` input fields and units.
- Confirm currency/asset precision and rounding rules.
- Confirm whether `safeToSpendAfter` can be negative or is clamped.
- Confirm stable financial reason codes.
- Confirm trust indicator taxonomy, evidence-ID uniqueness, and provenance rules.
- Confirm required behavior when financial or trust context is incomplete.
- Provide an engine module that implements `AssessmentEngine` so the production route can be wired and application E2E tests can begin.
