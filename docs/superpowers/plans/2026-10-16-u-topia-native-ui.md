# U-Topia Native Safe-to-Pay UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the existing U-HANDSHAKE simulator so Safe-to-Pay and first-time onboarding look and behave like native U-Topia features while preserving the authoritative API and all three demo scenarios.

**Architecture:** Keep the existing single-file HTML/CSS/JavaScript frontend and add behavior through its current state/render/event-delegation pattern. Extend the existing Playwright suite before each production change, use the local Next.js API for scenario assertions, and store only a versioned onboarding-completion flag in localStorage.

**Tech Stack:** Next.js 16, vanilla HTML/CSS/JavaScript, Playwright 1.64, Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-16-u-topia-native-ui-design.md`

## Global Constraints

- Preserve the U-Topia host shell and make Safe-to-Pay a Pay-flow checkpoint, not a separate application or navigation destination.
- Use orange for host navigation, blue-to-navy for host primary actions, and purple only for the transient Safe-to-Pay perimeter highlight and restrained feature accents.
- Keep onboarding to three steps and persist only the versioned key `uh-onboarding-v1`; storage errors must not block the interface.
- Reset Demo does not clear onboarding completion; `How it works` is the replay mechanism.
- Do not add a UI framework or any new dependency.
- Do not modify `lib/domain/*`, `lib/engine/*`, `lib/ml/*`, `lib/ai/*`, `lib/api/*`, or `app/api/*`.
- All payment outcomes remain simulated and all financial/trust values come from `POST /api/evaluate`.
- Paid AI remains off. Do not call OpenRouter, push, merge, deploy, or perform a real transaction.

## Review Focus

- localStorage throws during read or write: onboarding still opens, dismisses, and never blocks the application; covered in Task 1.
- Keyboard-only onboarding use: focus enters the dialog, loops inside it, Escape dismisses it, and focus returns to the opener; covered in Task 1.
- A 320px-wide viewport: the top navigation, all A/B/C controls, Stage controls, and dialog actions remain visible without horizontal overflow; covered in Tasks 2 and 4.
- Scenario B after onboarding dismissal: the canonical request is sent, Reduce Amount sends a second request for ฿5,500, and the API-returned Safe result is rendered; covered in Task 3.
- Scenario C with no exchange rate: Financial Review and Trust High remain distinct and no invented THB conversion appears; covered in Task 3.

---

### Task 1: Baseline evidence and accessible first-time onboarding

**Files:**
- Modify: `tests/e2e/safe-to-pay.spec.ts`
- Modify: `public/u-topia-handshake.html`
- Local untracked output: `artifacts/ui-review/before/`

**Interfaces:**
- Consumes: the existing page render cycle, delegated click handler, and `uh-zoom` guarded localStorage pattern.
- Produces: `openOnboarding(opener)`, `closeOnboarding({ complete, restoreFocus })`, `renderOnboarding()`, `uh-onboarding-v1`, and visible `[data-act="howItWorks"]` reopen controls used by later tasks.

- [ ] **Step 1: Install the locked dependencies and capture the unmodified desktop/mobile Dashboard baseline**

Run: `npm ci`

Run a Playwright capture at 1440x900 and 390x844 into `artifacts/ui-review/before/` without committing the images.

Expected: two readable baseline PNGs showing the existing Dashboard and demo controls.

- [ ] **Step 2: Add failing onboarding behavior tests**

Add independent Playwright tests proving:

- a clean first visit shows a dialog titled `Meet Safe-to-Pay`;
- Close and Skip dismiss it;
- Next/Back navigate the three steps and Get Started dismisses it;
- Get Started opens the U-Topia Pay chooser;
- completion persists after reload;
- `How it works` reopens it without clearing demo state;
- Escape dismisses it and returns focus to the opener;
- Tab/Shift+Tab remain inside the dialog;
- a localStorage getter/setter failure does not block opening or dismissal;
- Scenario B can start after dismissal.

- [ ] **Step 3: Run the onboarding tests to verify RED**

Run: `npx playwright test tests/e2e/safe-to-pay.spec.ts --grep "onboarding|How it works|storage failure"`

Expected: FAIL because the dialog and controls do not exist.

- [ ] **Step 4: Implement the minimal accessible onboarding behavior**

In `public/u-topia-handshake.html`, add the three-step host-native dialog markup/styles, the versioned persistence helpers, state transitions, focus containment/restoration, Escape handling, scroll containment, Close/Skip/Back/Next/Get Started actions, and `How it works` reopen control. Catch localStorage reads and writes independently.

- [ ] **Step 5: Run onboarding tests to verify GREEN**

Run: `npx playwright test tests/e2e/safe-to-pay.spec.ts --grep "onboarding|How it works|storage failure"`

Expected: all selected tests PASS with no console errors.

- [ ] **Step 6: Run the full E2E file and commit**

Run: `npx playwright test tests/e2e/safe-to-pay.spec.ts`

Expected: onboarding tests and the four existing scenario/failure tests PASS.

Commit: `feat: add accessible Safe-to-Pay onboarding`

### Task 2: Reference-faithful host shell, Dashboard discovery, and demo controls

**Files:**
- Modify: `tests/e2e/safe-to-pay.spec.ts`
- Modify: `public/u-topia-handshake.html`

**Interfaces:**
- Consumes: Task 1 `How it works` action and onboarding state; the existing `renderNav()`, `renderStrip()`, and `dashboard()` functions.
- Produces: a persistent top pill navigation, compact `Safe to spend` Dashboard discovery row, and responsive A/B/C plus Stage controls used throughout the final demo.

- [ ] **Step 1: Add failing host-shell and narrow-width tests**

Add Playwright assertions that:

- Dashboard contains the wallet balance, one compact Safe to Spend discovery treatment, and a visible `How it works` control but no standalone `Money partition` section;
- the five-item top navigation remains above the content at 390x844;
- A, B, C, and Stage controls are all visible at 390px and 320px;
- `document.documentElement.scrollWidth` does not exceed `clientWidth` at either narrow width;
- Reset Demo returns to Dashboard without reopening onboarding.

- [ ] **Step 2: Run the new shell tests to verify RED**

Run: `npx playwright test tests/e2e/safe-to-pay.spec.ts --grep "host shell|narrow viewport|Reset Demo"`

Expected: FAIL on the current bottom navigation, clipped controls, or oversized Dashboard partition section.

- [ ] **Step 3: Implement the native shell and responsive demo utility**

Update the existing CSS/render functions to preserve the U-Topia top pill navigation at every target width, simplify the Dashboard to one compact Safe to Spend discovery treatment, quiet non-host visual branding, and lay out A/B/C plus Stage controls without horizontal clipping. Keep the simulation disclosure clear and retain all controls.

- [ ] **Step 4: Run shell tests to verify GREEN**

Run: `npx playwright test tests/e2e/safe-to-pay.spec.ts --grep "host shell|narrow viewport|Reset Demo"`

Expected: all selected tests PASS at 390px and 320px.

- [ ] **Step 5: Run the full E2E file and commit**

Run: `npx playwright test tests/e2e/safe-to-pay.spec.ts`

Expected: the full file PASS with no horizontal-overflow assertion or prior-flow regression.

Commit: `feat: align simulator shell with U-Topia`

### Task 3: Native Safe-to-Pay checkpoint and authoritative scenario journeys

**Files:**
- Modify: `tests/e2e/safe-to-pay.spec.ts`
- Modify: `public/u-topia-handshake.html`

**Interfaces:**
- Consumes: the existing `runCheck()`, `toView()`, `resultView()`, `actionBar()`, `renderCP()`, and `POST /api/evaluate` contract; Task 2 host shell and responsive controls.
- Produces: a host-native checkpoint hierarchy, independently labeled financial/trust panels, collapsed technical details, transient `.feature-pulse` presentation state, and unchanged authoritative A/B/C interactions.

- [ ] **Step 1: Strengthen failing checkpoint behavior tests**

Extend the real-API Playwright tests to prove:

- Scenario B renders Balance ฿18,500, Safe to Spend ฿5,500, Payment ฿12,900, After payment ฿5,600, and shortfall ฿4,400 in the financial section;
- `Reduce amount` sends a second `POST /api/evaluate` with `{ value: 5500, provenance: "user_provided" }`, then renders the API-returned Safe result and the reduced-from message;
- Scenario A renders Safe without conflating it with recipient identity;
- Scenario C exposes separate `Financial check` and `Recipient check` sections, keeps Review and High distinct, and renders no invented ฿33 conversion;
- technical details are collapsed by default and the integration inspector remains reachable;
- Back and Cancel remain visible at the checkpoint;
- Back returns to the active transaction's preceding amount or wallet-check step, while Cancel returns to the Pay chooser rather than Dashboard;
- reduced-motion mode does not apply a running perimeter animation.

- [ ] **Step 2: Run the strengthened scenario tests to verify RED**

Run: `npx playwright test tests/e2e/safe-to-pay.spec.ts --grep "Scenario A|Scenario B|Scenario C|checkpoint"`

Expected: at least the new hierarchy, action-label, collapsed-details, or reduced-motion assertion FAILS against the baseline.

- [ ] **Step 3: Implement the checkpoint hierarchy and restrained feature motion**

Refine the existing checkpoint markup and CSS so financial verdict, plain-language explanation, Balance versus Safe to Spend, impact, recommendation, separate trust result, and collapsed technical details appear in that order. Add the 1–1.5 second purple perimeter highlight only when a result appears and again after Scenario B becomes Safe; settle to a subtle border and suppress animation under `prefers-reduced-motion`. Keep host blue primary actions and all API-driven behavior.

- [ ] **Step 4: Run scenario tests to verify GREEN**

Run: `npx playwright test tests/e2e/safe-to-pay.spec.ts --grep "Scenario A|Scenario B|Scenario C|checkpoint"`

Expected: all selected tests PASS and request payloads remain identical to fixtures except the explicit Scenario B reduction.

- [ ] **Step 5: Run the full E2E file and commit**

Run: `npx playwright test tests/e2e/safe-to-pay.spec.ts`

Expected: all E2E tests PASS without console errors.

Commit: `feat: refine native Safe-to-Pay checkpoint`

### Task 4: Responsive visual evidence, detector audit, and full regression

**Files:**
- Modify if a verified defect requires it: `tests/e2e/safe-to-pay.spec.ts`
- Modify if a verified defect requires it: `public/u-topia-handshake.html`
- Local untracked output: `artifacts/ui-review/after/`

**Interfaces:**
- Consumes: the complete frontend and test interfaces from Tasks 1–3.
- Produces: required review screenshots, responsive evidence, Impeccable detector output, and final regression evidence.

- [ ] **Step 1: Capture and inspect the required screenshots**

Capture untracked images for Dashboard desktop/mobile, native checkpoint, Scenario B High Risk, Scenario B Safe after reduction, Scenario B outcome, Scenario C financial/trust separation, onboarding desktop/mobile, and before/after comparison at 1440x900, 768x1024, 390x844, and approximately 320px where relevant.

Expected: no clipped scenario chip, hidden Stage control, horizontal overflow, overlapping label, off-screen dialog action, or detached-looking Safe-to-Pay surface.

- [ ] **Step 2: Add a failing regression test for each defect found, then fix RED-to-GREEN**

Run the smallest relevant Playwright grep before and after each fix.

Expected: every production correction is preceded by a test that fails for the observed defect and passes after the correction.

- [ ] **Step 3: Run the Impeccable mechanical detector once**

Run: `C:\Users\Arc\.codex\plugins\cache\openai-curated-remote\impeccable\4.3.1\skills\impeccable\scripts\impeccable.cmd detect --json public/u-topia-handshake.html`

Expected: inspect every reported issue; fix Important accessibility/responsive defects through RED-to-GREEN tests and record any low-risk visual false positive.

- [ ] **Step 4: Run full regression verification**

Run: `npm test`

Expected: all Vitest tests PASS.

Run: `npm run typecheck`

Expected: TypeScript exits 0.

Run: `npm run build`

Expected: production build exits 0 with paid AI disabled.

Run: `npm run test:e2e`

Expected: all Playwright tests PASS and required screenshots exist in the untracked review directory.

- [ ] **Step 5: Verify scope and commit final fixes**

Run: `git diff --name-only 7f26603...HEAD` and `git status --short`

Expected: backend paths are untouched; committed code changes are limited to the approved frontend/tests/docs; screenshot artifacts remain untracked or ignored; no push, merge, or deployment occurred.

Commit if Task 4 produced verified fixes: `fix: polish responsive Safe-to-Pay experience`
