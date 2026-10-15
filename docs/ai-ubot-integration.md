# AI Integration Handoff

## Final provider architecture

| Role | Model | OpenRouter API | Enforced limit |
| --- | --- | --- | --- |
| Primary explanation and evidence review | `qwen/qwen3.5-9b` | `POST /api/v1/chat/completions` | 350 completion tokens; 12-second timeout |
| Conditional typed verification | `typesafe/jev-1.14` | `POST /api/alpha/decisions` | 5-second timeout |

Both IDs and API surfaces are documented by OpenRouter: [Qwen3.5-9B](https://openrouter.ai/qwen/qwen3.5-9b/providers), [Jev](https://openrouter.ai/docs/guides/community/jev), and [chat-completions API](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion).

Jev is advisory only. A `needs_review` probability of at least `0.5` is surfaced as a review recommendation and never changes the deterministic assessment.

The implementation performs no client retries, and Qwen requests set `provider.allow_fallbacks: false` to disable OpenRouter provider failover. Routing permits zero, one, or two calls, never more than two.

## Deterministic routing

`selectAiRoute` uses only the authoritative assessment:

- `none`: financial `safe`, trust `low`, no trust indicators, and no missing fields. No external AI runs.
- `qwen`: any contextual assessment with complete evidence. Qwen runs once; Jev does not run.
- `qwen_jev`: trust is `unknown`, context is missing, or an indicator has `unavailable` provenance. Qwen runs first. Jev runs once only after a structurally valid Qwen response exists.

If Qwen fails on an uncertain route, Jev is not called. This prevents a secondary typed decision from replacing the primary analysis and keeps the maximum at two calls.

## Safety boundary

- The deterministic engine runs first and its assessment is returned unchanged.
- AI receives only statuses, reason codes, evidence IDs/kinds/provenance, missing-field names, and non-identifying transfer metadata.
- Balances, amounts, recipient identifiers, fingerprints, wallet addresses, raw messages, and engine prose are excluded from provider inputs.
- Qwen output passes strict JSON-schema generation, runtime structural validation, and evidence/provenance validation.
- Unsupported Qwen claims force deterministic fallback and never change an authoritative status.
- Jev receives sanitized state plus Qwen indicator references. Its typed probability is advisory and never changes financial or trust values.
- Missing credentials, timeout, malformed output, network failure, and HTTP errors remain isolated provider failures.

## Attribution and frontend compatibility

Canonical attribution is accurate:

- `ai.explanation.source`: `"qwen" | "fallback"`
- `ai.qwenReview.model`: `qwen/qwen3.5-9b`
- `ai.jevDecision.model`: `typesafe/jev-1.14`
- `ai.comparison.providerStatus`: `{ qwen, jev }`

The request, `assessment`, `ai.explanation`, `ai.qwenReview`, comparison evidence fields, fallback behavior, and structured errors remain in the existing envelope. Required Ete migration:

1. Replace the legacy `source === "ubot"` branch with `source === "qwen"`.
2. Replace legacy provider status keys `ubot/qwen` with `qwen/jev`.
3. Accept additive `ai.jevDecision` and `comparison.jevVerification` fields.

No compatibility adapter falsely reports Qwen as U-Bot.

## Usage and cost tracking

`createEvaluateHandler` accepts an optional `onUsage` callback. Successful OpenRouter responses emit only:

```ts
{
  provider: "openrouter";
  model: "qwen/qwen3.5-9b" | "typesafe/jev-1.14";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number | null;
}
```

The callback receives no transaction, recipient, evidence, prompt, response text, or API key. Callback failures are isolated from the assessment path. The repository does not persist or log these events by default.

## Environment

```dotenv
OPENROUTER_API_KEY=
```

Models are pinned in code. Legacy `OPENROUTER_MODEL` overrides are ignored so local configuration cannot silently select a different model. Keep the key server-side in ignored `.env.local`; never expose it through `NEXT_PUBLIC_*`.

## Validation status and blockers

Mocked tests cover routing, call count/order, both transports, token cap, separate timeouts, no retries including HTTP `429`, privacy-safe usage events, evidence validation, fallback, attribution, assessment immutability, and route responses.

Paid live calls have not been made. The remaining integration blockers are the real authoritative engine, application scaffold/build, Ete’s schema migration, and an explicitly authorized live smoke test.
