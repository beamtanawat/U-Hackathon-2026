# Financial and Trust Engine Integration (Archay)

Archay's deterministic engines are wired into `POST /api/evaluate` and are the only source of financial and trust status. This document describes the boundary as it exists in code:

| Concern | File |
| --- | --- |
| Canonical request and engine output schemas | `lib/domain/schemas.ts` (types in `lib/domain/types.ts`) |
| Safe-to-pay rules | `lib/engine/safe-to-pay.ts` (`evaluateSafeToPay`) |
| Scam-context trust model + critical rules | `lib/ml/risk-classifier.ts` (`assessTrust`), `lib/ml/model.json`, `lib/ml/extract-features.ts` |
| Wiring, validation, response | `lib/api/evaluate-handler.ts` |
| Engine → AI-layer / UI adapters | `lib/api/adapter.ts` |

Superseded: the earlier `AssessmentEngine.evaluate()` interface, the opaque `financialContext` input and the "production route returns `503 engine_unavailable`" stage are gone.

## The engine boundary

```ts
// lib/api/evaluate-handler.ts
export interface FinancialEngine {
  financial(request: EvaluationRequest): FinancialAssessment;
  trust(request: EvaluationRequest): TrustAssessment;
}
export const archayEngine: FinancialEngine = { financial: evaluateSafeToPay, trust: assessTrust };
```

`app/api/evaluate/route.ts` exports `POST = createEvaluateHandler()`, which uses `archayEngine` by default. Tests inject another engine with `createEvaluateHandler({ engine })`.

Both functions are **synchronous and pure**: they receive the already-validated canonical `EvaluationRequest` (see the field table in `docs/frontend-ai-integration.md`) and must not perform I/O.

Request handling order:

1. Rate limit, `Content-Type`, 8 KiB body cap, JSON parse (`lib/api/guards.ts`).
2. `evaluationRequestSchema.safeParse` — strict objects, `value === null` ⇔ `provenance === "unavailable"`, money in `[0, 1e12]`.
3. `engine.financial(input)` → parsed with `financialAssessmentSchema`.
4. `engine.trust(input)` → parsed with `trustAssessmentSchema`.
5. `toAuthoritativeAssessment` adapts both for the AI layer; `assertAuthoritativeAssessment` checks the result.
6. If steps 3–5 throw for any reason, the response is `503 assessment_unavailable` with no internal detail.
7. AI runs (or not) and the response is built. `assessment.financial` and `assessment.trust` are returned exactly as the engine produced them.

## Financial output

```ts
type FinancialAssessment = {
  status: "safe" | "review" | "high_risk";
  safeToSpendBefore: number | null;   // >= 0
  safeToSpendAfter: number | null;    // may be negative
  postTransactionBalance: number | null;
  affectedCommitments: string[];
  reasonCodes: string[];
  missingFields: string[];
};
```

Rules in `evaluateSafeToPay` (all amounts in `currency`):

| Condition (checked in order) | Status | `reasonCodes` | Numbers |
| --- | --- | --- | --- |
| Any of `availableBalance`, `essentialObligations`, `debtDue`, `protectedBuffer`, `amount`, `currency`, `asset` is `null` | `review` | `MISSING_FINANCIAL_CONTEXT` | all `null`; `missingFields` lists the nulls |
| `asset !== currency` | `review` | `CURRENCY_CONVERSION_UNAVAILABLE` | all `null`; `missingFields: ["exchangeRate"]` |
| `post < mandatory` | `high_risk` | `MANDATORY_OBLIGATIONS_AT_RISK` | `affectedCommitments: ["mandatory_obligations", "protected_buffer"]` |
| `post < mandatory + buffer` | `review` | `USES_PROTECTED_BUFFER` | `affectedCommitments: ["protected_buffer"]` |
| otherwise | `safe` | `WITHIN_SAFE_TO_SPEND` | `affectedCommitments: []` |

where `mandatory = essentialObligations + debtDue`, `post = availableBalance − amount`, `safeToSpendBefore = max(0, availableBalance − mandatory − buffer)`, and `safeToSpendAfter = post − mandatory − buffer` (unclamped; a negative value is the shortfall). No exchange rate is ever invented, and missing inputs are never estimated.

## Trust output

```ts
type TrustAssessment = {
  status: "not_assessed" | "low" | "review" | "high" | "unknown"; // assessTrust never returns "not_assessed"
  riskScore: number | null;     // logistic-regression score in [0, 1]
  indicators: string[];
  modelVersion: string | null;  // "scam-context-v1"
};
```

`assessTrust` combines two parts and takes the more severe status:

- **Model** (`lib/ml/model.json`, `scam-context-v1`): scores features from recipient history, amount vs `recentMedianAmount` and the context flags; thresholds give `low` / `review` / `high`. Indicators are the active binary features with positive coefficients.
- **Policy floor** (critical rules, applied whether or not the model runs): `high` for `guaranteedOrHighReturn`, `moveMoneyToProtect`, `advanceFeeOrPrize`, `romanceOrOnlineOnlyRelationship`, impersonation + urgency, unexpected contact + payment-method demand, or secrecy + new recipient; otherwise `review` if any context flag other than a new recipient is `true`.

If recipient history (`isNew`, `previousTransactionCount`), `amount` or a positive `recentMedianAmount` is unavailable, the model cannot run: `riskScore` and `modelVersion` are `null`, every supplied indicator is kept, and the status is the floor — or `unknown` (never `low`) when there is no signal at all. Context flags with `value: null` count as not present; they are never inferred.

## Adapter: what the AI layer and UI receive

`lib/api/adapter.ts` changes no status and adds no financial rule. Every number it emits is an engine output or simple arithmetic on request inputs the engine already used.

- `toAuthoritativeAssessment` produces the AI layer's `AuthoritativeAssessment`:
  - financial `reasons` are deterministic `{ code, message }` copy per reason code (for example "Balance after payment would be ฿5,600, which is ฿4,400 below must keep (฿10,000).");
  - each trust indicator becomes `{ id: "indicator-<kind>", kind, evidence, provenance }`, where `provenance` is copied from the request field that produced it (`recipient.isNew` for `new_recipient`, the matching `context.*` flag otherwise);
  - trust `missingFields` is `recipientHistory` and/or `recentMedianAmount` when `modelVersion` is `null`;
  - trust `not_assessed` would map to `unknown` (the AI layer has no such state).
- `buildBreakdown` returns `breakdown` (or `null` when the engine's numbers are `null`).
- `recommendActions`: trust `high`/`review` → `verify_recipient` + (`reduce_amount` if financially `high_risk`, else `cancel`); else missing financial fields → `postpone`; `high_risk` → `reduce_amount`, `postpone`; `review` → `reduce_amount`; `safe` → `proceed`.
- `toTransactionContext` gives the AI only non-identifying metadata (wallet type, transfer mode, asset, network, whether the recipient is known and its provenance). No balances, amounts, identifiers or messages.

## Invariants (covered by `npm test`)

- The AI layer works on a structured clone and cannot change `assessment` (`tests/api/evaluate-route.test.ts` "never lets AI output change the engine's assessment", `tests/unit/explanation.test.ts` "does not mutate authoritative financial values or statuses").
- Financial and trust statuses are independent: Scenario C is financially `review` and trust `high`.
- A trust indicator can be cited by an AI provider only by its `id` with the exact `provenance`.
- `tests/unit/demo-scenarios.test.ts` and `tests/api/evaluate-route.test.ts` check each scenario's `expectedAssessment` against the engines and the route.

## Demo scenarios

`examples/demo-scenarios/*.json` each hold `id`, `title`, `demoGoal`, `assumptions`, `request` and `expectedAssessment`. All values are fictional with provenance `simulated`.

| Scenario | Financial | Trust | Point |
| --- | --- | --- | --- |
| A — `scenario-a-safe-u-tag.json` (1,290 THB to a known U-Tag) | `safe`, safe-to-spend 5,500 → 4,210 | `low` (score ≈ 0.080) | commitments remain covered; no AI call needed |
| B — `scenario-b-insufficient-safe-to-spend.json` (12,900 THB) | `high_risk`, after −7,400 | `low` (score ≈ 0.606) | the balance covers the payment but safe-to-spend does not |
| C — `scenario-c-suspicious-crypto.json` (120 USDC to a new wallet) | `review`, `exchangeRate` missing | `high` (score ≈ 0.971; new recipient, urgency, secrecy, guaranteed return) | affordability cannot cancel recipient risk |

Full request/response pairs, produced by the real handler, are in `docs/frontend-ai-integration.md`.

## Changing the engine

- Keep `FinancialEngine` synchronous and its outputs valid against `financialAssessmentSchema` / `trustAssessmentSchema`; anything else becomes `503`.
- Add new reason codes to `financialReasons` in `lib/api/adapter.ts`, or they fall back to generic copy. New missing-field names get generic fallback questions unless `lib/ai/fallback.ts` is updated.
- New trust indicators need evidence copy in `INDICATOR_EVIDENCE` and a provenance mapping in `indicatorProvenance`.
- Update `expectedAssessment` in the scenario files and regenerate the examples in `docs/frontend-ai-integration.md`.
- Bump `ENGINE_VERSION` in `lib/api/evaluate-handler.ts` when rules or the model change.
