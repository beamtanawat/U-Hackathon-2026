# U-HANDSHAKE MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a judge-ready simulation showing U-HANDSHAKE as an integration-ready financial decision-safety layer, centered on Safe-to-Pay Check with U-Bot explanations.

**Architecture:** A single Next.js application hosts a fictional-data U-Topia Reference Integration Preview and a typed `/api/evaluate` endpoint. The simulated host mirrors the beta's observed Crypto/Spending Wallet and U-Tag/on-chain Pay structure without claiming a live official integration. Deterministic TypeScript functions own all financial calculations. A lightweight, explainable ML classifier scores scam/context risk from engineered features; an LLM may propose semantic indicators, but deterministic policy owns provenance and the final merge. U-Bot receives the completed assessment and returns an explanation; a deterministic template is the fallback. Vercel is the primary deployment target; Docker is optional after the critical demo is stable.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind CSS, Zod, Vitest, Playwright for one critical demo flow, Vercel. Supabase is deferred unless persistent sessions become necessary.

**Spec:** [Application Direction](https://app.notion.com/p/3fa5a0f7b3a18046911ef66fac9d21ec?pvs=204)

## Global Constraints

- The demo simulates a host wallet; it must not move real money or imply custody.
- Safe-to-Pay is the only primary feature. Scam awareness is a conditional secondary branch.
- Financial status and scam/trust status must remain separate in types, logic, and UI.
- Financial math must be deterministic and testable; ML, LLM, and U-Bot must not calculate balances or make the final financial decision.
- ML is limited to scam/context risk scoring. The model must expose its probability, version, and contributing features.
- LLM correction may add a missed semantic indicator or escalate uncertainty; it must not silently downgrade ML risk.
- The complete demo must still work if U-Bot times out or returns invalid output.
- Do not add Supabase, Cloudflare, Avalanche, or Tokenomist to the critical path without a demonstrated requirement.
- Do not let Docker delay the Vercel deployment or the three judge scenarios.
- Label the host UI as Simulation / Integration Preview and never reuse real beta account data.
- Treat U-Topia API fields as unconfirmed until organizers explicitly provide their schema and access rules.
- Record input provenance as host-provided, user-provided, derived, simulated, or unavailable.

## Team Positions and Ownership

### 1. Frontend & Integration Lead — Ete

Working branch: `feature/ete-frontend-integration`

Owns the simulated host platform, visual decision flow, and final integration of all modules.

Files owned:

- `app/page.tsx`
- `app/layout.tsx`
- `app/globals.css`
- `components/simulator/*`
- `components/results/*`
- `lib/client/evaluate.ts`
- `tests/e2e/safe-to-pay.spec.ts`

Deliverables:

- Scenario selector and transaction confirmation flow.
- Before/after balance visualization.
- Separate Safe-to-Pay and scam-risk result panels.
- Loading, error, U-Bot fallback, and mobile-responsive states.
- One end-to-end test for the main insufficient-safe-to-spend scenario.

### 2. ML Risk & Financial Decision Lead — Archay

Working branch: `feature/archay-ml-risk-engine`

Owns the deterministic financial engine, the explainable scam-risk classifier, and the shared data contract. The MVP uses engineered transaction/context features and a small logistic-regression classifier rather than a deep model. Training happens offline; versioned coefficients are exported for TypeScript inference so the Vercel application does not require a separate Python service.

Files owned:

- `lib/domain/types.ts`
- `lib/domain/schemas.ts`
- `lib/engine/safe-to-pay.ts`
- `lib/ml/extract-features.ts`
- `lib/ml/risk-classifier.ts`
- `lib/ml/model.json`
- `ml/train.py`
- `ml/training-data.csv`
- `data/scenarios.ts`
- `tests/unit/safe-to-pay.test.ts`
- `tests/unit/risk-classifier.test.ts`

Deliverables:

- Formula for available balance, committed obligations, reserve, safe-to-spend, and post-purchase status.
- Explainable ML risk score based on new recipient, urgency, guaranteed-return language, amount-to-balance ratio, and other available context.
- Versioned model artifact with reproducible training script and a documented synthetic/curated-data limitation.
- Three canonical scenario fixtures with expected outputs.
- Unit tests covering financial boundaries, ML inference, missing optional context, and all three judge scenarios.
- A stable `SafetyAssessment` object consumed by both Frontend and AI.

### 3. AI & U-Bot Lead — Beam

Working branch: `feature/beam-ai-ubot`

Owns U-Bot integration as an explanation layer and its deterministic fallback.

Files owned:

- `app/api/evaluate/route.ts`
- `lib/ai/ubot-client.ts`
- `lib/ai/explanation-schema.ts`
- `lib/ai/fallback-explanation.ts`
- `lib/ai/prompts.ts`
- `lib/ai/risk-review.ts`
- `tests/unit/explanation.test.ts`
- `.env.example`

Deliverables:

- Server-side U-Bot adapter with timeout and environment configuration.
- Structured explanation schema: summary, key reasons, suggested next step, and disclaimer.
- Prompt that explains an existing `SafetyAssessment` without recomputing it.
- LLM consistency review that may append semantic indicators or mark the result for caution, but cannot reduce the ML score or alter financial values.
- Schema validation and deterministic fallback for timeout, invalid JSON, or unavailable API.
- API response compatible with the shared contract below.

### 4. Product, Business & Demo Lead — Bream

Working branch: `feature/bream-product-demo`

Owns competition alignment, API coordination, acceptance QA, and the judge story. This is an execution role, not only slide preparation.

Files owned:

- `README.md`
- `docs/integration-contract.md`
- `docs/demo-script.md`
- `docs/judge-qa.md`
- `docs/acceptance-checklist.md`

Deliverables:

- Confirm U-Bot credentials, endpoint, rate limits, and required API format with organizers.
- Define user-facing copy and acceptance criteria for the three scenarios.
- Write a 3–4 minute demo script centered on scenario 2, with scenario 3 as the conditional branch.
- Maintain a judge-question sheet covering practicality, integration, privacy, AI boundaries, and business value.
- Run acceptance QA on the deployed URL and record issues by severity.

## Shared Integration Contract

The ML Risk & Financial Decision Lead publishes these types first so all tracks can work in parallel:

```ts
export type EvaluationRequest = {
  scenarioId?: string;
  balance: number;
  committedExpenses: number;
  safetyReserve: number;
  amount: number;
  context?: {
    isNewRecipient?: boolean;
    hasUrgencyLanguage?: boolean;
    promisesGuaranteedReturns?: boolean;
  };
};

export type SafetyAssessment = {
  financial: {
    safeToSpend: number;
    postTransactionBalance: number;
    status: "safe" | "caution" | "unsafe";
    reasonCodes: string[];
  };
  trust: {
    status: "not_assessed" | "low" | "medium" | "high";
    probability?: number;
    indicators: string[];
    modelVersion?: string;
    llmReview?: "not_run" | "consistent" | "escalated" | "unavailable";
  };
};

export type EvaluationResponse = {
  assessment: SafetyAssessment;
  explanation: {
    summary: string;
    reasons: string[];
    nextStep: string;
    source: "ubot" | "fallback";
  };
};
```

## Execution Order

### Task 1: Scaffold and freeze the shared contract

Owner: ML Risk & Financial Decision Lead, with Frontend Lead reviewing.

- [ ] Create the Next.js TypeScript project and install only Zod, Vitest, and required test tooling.
- [ ] Add `lib/domain/types.ts` and `lib/domain/schemas.ts` using the contract above.
- [ ] Add a schema test that rejects negative monetary values and malformed status values.
- [ ] Run the schema test and confirm it fails before implementation.
- [ ] Implement the minimum schema required to pass.
- [ ] Run tests and commit: `chore: scaffold app and define evaluation contract`.

### Task 2: Build the financial engine and explainable ML risk classifier

Owner: ML Risk & Financial Decision Lead.

- [ ] Write failing tests for safe, insufficient-safe-to-spend, and suspicious-transfer scenarios.
- [ ] Implement `safeToSpend = max(0, balance - committedExpenses - safetyReserve)`.
- [ ] Classify the purchase without using AI.
- [ ] Define the scam-risk feature vector and keep it independent from financial status.
- [ ] Prepare a small labeled training dataset, clearly marking synthetic rows and avoiding claims of production accuracy.
- [ ] Train a logistic-regression baseline and export versioned coefficients/normalization metadata to `lib/ml/model.json`.
- [ ] Implement deterministic TypeScript inference returning probability, band, model version, and contributing indicators.
- [ ] Add boundary tests for exact safe-to-spend, zero amount, and omitted context.
- [ ] Add fixed-fixture tests proving exported-model inference is reproducible.
- [ ] Run unit tests and commit: `feat: add financial engine and explainable risk classifier`.

### Task 3: Build U-Bot adapter and fallback

Owner: AI & U-Bot Lead. May start with a mock `SafetyAssessment` while Task 2 is in progress.

- [ ] Write failing tests for valid U-Bot output, invalid output, timeout, and missing credentials.
- [ ] Implement structured prompt and Zod response validation.
- [ ] Implement an LLM consistency review that can only add indicators or escalate the trust result.
- [ ] Record whether the review was consistent, escalated, or unavailable without presenting it as ground truth.
- [ ] Implement a short timeout and deterministic fallback explanation.
- [ ] Ensure no raw credentials or unnecessary personal data enter logs or prompts.
- [ ] Run unit tests and commit: `feat: add ubot explanation adapter with fallback`.

### Task 4: Build the simulator UI

Owner: Frontend & Integration Lead. May use canonical mock responses until Tasks 2–3 land.

- [ ] Build the transaction input and three-scenario selector.
- [ ] Build the financial result panel with before/after values.
- [ ] Build a visually separate trust-risk panel shown only when context is supplied.
- [ ] Add loading, network error, and fallback-source states.
- [ ] Verify mobile and presentation-screen layouts.
- [ ] Commit: `feat: build safe-to-pay simulator experience`.

### Task 5: Integrate the single evaluation endpoint

Owner: AI & U-Bot Lead implements; Frontend and Engine Leads review.

- [ ] Add a route test asserting the response conforms to `EvaluationResponse`.
- [ ] Call the deterministic engine first.
- [ ] Pass only the completed assessment and necessary display context to U-Bot.
- [ ] Return a fallback explanation if U-Bot fails without changing the assessment.
- [ ] Connect the frontend client to `/api/evaluate`.
- [ ] Run all unit tests and commit: `feat: integrate evaluation and explanation pipeline`.

### Task 6: Deploy and prove the demo

Owner: Frontend Lead for deployment; Product/Business Lead for acceptance.

- [ ] Deploy the main branch to Vercel with server-side U-Bot environment variables.
- [ ] Run all three scenarios against the deployed URL.
- [ ] Add a Playwright test for scenario 2 and run it locally against the production build.
- [ ] Test once with U-Bot unavailable and confirm the full decision flow still completes.
- [ ] Record the deployed URL and verification result in `README.md`.
- [ ] Commit: `test: verify judge demo flow`.

### Task 7: Add Docker only if the critical path is complete

Owner: Frontend & Integration Lead.

- [ ] Confirm Tasks 1–6 are complete and the deployed demo is stable.
- [ ] Add `Dockerfile` and `.dockerignore` using a Next.js standalone production build.
- [ ] Build the image and run it locally with explicit environment variables.
- [ ] Document Docker as an alternative host integration package, not the primary judge demo.
- [ ] Commit: `chore: add optional portable container deployment`.

## Deadline Checkpoints — Asia/Bangkok

- **Tonight, first checkpoint:** Shared contract frozen; engine tests, UI shell, U-Bot mock/fallback, and API information request in progress.
- **Tonight, second checkpoint:** Three scenarios work end-to-end locally without requiring live U-Bot.
- **Tomorrow morning:** Live U-Bot connected if available; production deployment and scenario QA complete.
- **Before 12:00:** Feature freeze. Only critical fixes, copy, and presentation work afterward.
- **12:00–13:00:** Full timed rehearsal and judge Q&A.
- **13:00 onward:** Stable demo environment; no infrastructure migrations or optional feature additions.

## Review Focus

- Does scenario 2 immediately demonstrate a painkiller rather than generic budgeting education?
- Are financial and scam-risk judgments visibly and technically separate?
- Can judges understand the integration contract without assuming access to a real bank account?
- Does the demo finish successfully when U-Bot or the network fails?
- Is every optional technology kept outside the critical path?

## U-Topia Beta Integration Delta — 15 October 2026

Observed beta surfaces include Dashboard balances and spending history, Crypto/Spending Wallets, U-Tag and on-chain Pay, transactions, cards gated by identity verification, and transaction/security notifications.

The primary integration point is after recipient or destination and amount are known, but before final payment confirmation. The demo supports two reference adapter modes:

- U-Tag transfer: recipient/contact, amount, wallet context, Safe-to-Pay checkpoint.
- On-chain crypto: destination, asset/network, amount, checkpoint, then simulated confirmation.

Host data does not visibly include obligations, protected buffer, goals, urgency, secrecy, or guaranteed-return language. These fields must be user-provided, simulated, derived from confirmed data, or unavailable. The ML/LLM layer must not invent them.

API access remains unconfirmed. The Product/Business Lead must ask organizers about read-only balances/history, U-Tag metadata, a pre-confirmation payment-intent hook, sandbox rules, webhooks, authentication, rate limits, retention, and prohibited uses. KYC, cards, Swap, Top Up, and real transfers remain outside the critical path.

