# AI Integration: Qwen3.5-9B + Jev 1.14 (Beam)

The AI layer explains and double-checks the engine's assessment. It never decides: financial and trust statuses come only from Archay's deterministic engines (`docs/financial-engine-integration.md`), and the AI output is returned beside them under `ai` (`docs/frontend-ai-integration.md`).

There is **no U-Bot runtime dependency**. Both models are called through OpenRouter:

| Role | Model (pinned in code) | OpenRouter API | Limits |
| --- | --- | --- | --- |
| Primary: explanation + evidence review | `qwen/qwen3.5-9b` | `POST /api/v1/chat/completions` | 350 completion tokens, 12 s timeout, `temperature: 0`, strict JSON schema |
| Secondary: typed review decision | `typesafe/jev-1.14` | `POST /api/alpha/decisions` | 5 s timeout |

Code: `lib/ai/openrouter.ts` (Qwen), `lib/ai/jev.ts` (Jev), `lib/ai/explanation.ts` (routing and orchestration), `lib/ai/grounding.ts`, `lib/ai/comparison.ts`, `lib/ai/fallback.ts`, `lib/ai/prompt.ts`, `lib/ai/schema.ts`.

No client retries. Qwen requests set `provider: { require_parameters: true, allow_fallbacks: false }`, so OpenRouter cannot fail over to another provider or model. A response attributed to any other model is rejected.

## When paid AI runs (`lib/api/guards.ts`)

Paid AI is **off by default**. It is allowed only when both are set on the server:

```dotenv
AI_MODE=live
OPENROUTER_API_KEY=...        # server-side only; never NEXT_PUBLIC_*
AI_MAX_CALLS_PER_HOUR=20      # optional; default 20
```

Keep these in the git-ignored `.env.local`; `.env.example` lists them. Models cannot be changed from the environment.

Each response reports why AI did or did not run in `ai.mode`:

| `ai.mode` | When |
| --- | --- |
| `disabled` | `AI_MODE` is not `live`, or no `OPENROUTER_API_KEY`. |
| `client_opt_out` | AI is configured, but the request sent `x-uh-ai: off`. |
| `budget_exhausted` | AI is configured, but this route's calls would exceed `AI_MAX_CALLS_PER_HOUR`. Calls are reserved (0, 1 or 2 by route) before they run; the window resets hourly; the budget is per server instance. |
| `live` | Providers were called. |

In every mode other than `live`, no network call is made and the deterministic fallback explanation is returned.

## Routing (`selectAiRoute`)

The route uses only the authoritative assessment, and is reported as `ai.route` in every mode:

| `ai.route` | Condition | Paid calls |
| --- | --- | --- |
| `none` | financial `safe`, trust `low`, no trust indicators, no missing fields | 0 |
| `qwen_jev` | trust `unknown`, any missing field, or an indicator with `unavailable` provenance | Qwen, then Jev only if Qwen returned valid output (max 2) |
| `qwen` | everything else | 1 |

Demo scenarios: A → `none`, B → `qwen`, C → `qwen_jev` (exchange rate missing).

## What the models see

Providers receive only a sanitized `ProviderContext`: financial status and reason codes, trust status, indicator `id`/`kind`/`provenance`, missing-field names, wallet type, transfer mode, asset, network, whether the recipient is known and its provenance. **No balances, amounts, recipient identifiers, wallet addresses, messages or engine prose.** Jev additionally receives Qwen's escalation suggestion and indicator references (`type`, `evidenceId`, `provenance`).

The Qwen system prompt (`lib/ai/prompt.ts`) forbids inferring facts without a supplied evidence ID, recalculating money, changing a status, calling a transaction safe, or guaranteeing an outcome.

## When Qwen prose is shown

Qwen output is shown (`ai.explanation.source: "qwen"`) only if all of these pass; otherwise the deterministic fallback from `lib/ai/fallback.ts` is shown:

1. **Transport:** HTTP OK, model attribution is `qwen/qwen3.5-9b`, non-empty content, within 12 s.
2. **Structure:** `parseQwenAnalysis` validates the `{ explanation, review }` JSON.
3. **Evidence** (`compareAnalyses`): every cited evidence ID exists in the assessment; review indicators match its provenance exactly; missing-context questions name only fields that are actually missing; suggested indicators cite evidence. Failures are listed in `comparison.unsupportedClaims`.
4. **Grounding** (`checkGrounding`, `lib/ai/grounding.ts`), reported in `ai.grounding.violations` as `<field>:<code>`:
   - `invented_number` — any digit. Qwen never receives money values, so any number is invented.
   - `guarantee_claim`, `certainty_claim` ("definitely", "100%", "risk-free", "completely safe"…), `fraud_certainty_claim` ("is a scam"), `safe_to_pay_claim`, `pressure_to_proceed` ("go ahead", "pay now"), `action_claim` ("I sent / blocked / approved").
   - `contradicts_financial_status` — "is/looks/seems fine/safe/ok" when financial status is not `safe`.
   - `too_long` — summary > 400, nextStep > 240, reason > 300, question > 200 characters; `too_many_reasons` (> 6), `too_many_questions` (> 4).
   - `trust_reason_without_evidence` — a trust reason with no evidence ID.

`ai.grounding.accepted` is `true` only when Qwen produced output that passed both the evidence and grounding checks.

## Jev 1.14

Jev answers one typed question, `needs_review` (probability in [0, 1]), about the sanitized state. The result is accepted only with model `typesafe/jev-1.14` (or a versioned `typesafe/jev-1.14-*` response), `decisionStatus: "completed"`, a probability in [0, 1], and `suggestedEscalation === (reviewProbability >= 0.5)`. It is reported as `ai.jevDecision` and `ai.comparison.jevVerification` (`supports_review` / `does_not_support_review` / `unavailable` / `not_run`). Jev is advisory: it never changes the assessment or the explanation source.

## Failure behavior

Missing key, timeout, HTTP error (including `429`), invalid JSON, wrong model, schema failure or ungrounded prose are all isolated provider failures. The route still returns `200` with the unchanged assessment and the fallback explanation; `ai.comparison.providerStatus` shows `unavailable` for the failed provider. An engine failure, not an AI failure, is the only cause of `503`.

## Usage and cost

`ai.usage` lists the paid calls made for this request only:

```ts
{ provider: "openrouter"; model: "qwen/qwen3.5-9b" | "typesafe/jev-1.14";
  inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number | null }
```

It contains no prompt, response text, transaction data or key. Nothing is persisted or logged.

## Running locally

Requires Node ≥ 22.12.

```bash
npm ci
```

```bash
npm run dev
```

Open <http://localhost:3000> (the prototype; `/` serves `public/u-topia-handshake.html`) and call `POST /api/evaluate`. Without `.env.local` paid AI stays disabled.

```bash
npm test
```

Runs the Vitest unit and API suites (no network; providers are mocked).

```bash
npm run e2e:install
```

Installs Playwright's headless Chromium into `.playwright-browsers/` (once).

```bash
npm run test:e2e
```

Builds and starts the production server on `127.0.0.1:3107` with `AI_MODE=off` and an empty key, so E2E can never make paid calls.

Any live paid call needs explicit team approval and a key in `.env.local`.
