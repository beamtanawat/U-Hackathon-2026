# U-Topia Native Safe-to-Pay UI Design

Date: 2026-10-16
Branch: `feature/ui-clarity-onboarding`
Baseline: `origin/integration/safe-to-pay-mvp` at `7f26603`

## Goal

Make U-HANDSHAKE feel like a native Safe-to-Pay checkpoint inside U-Topia rather than a separate product. The host wallet remains visually dominant. The feature becomes visible when it is useful: after the user enters a recipient and amount and before the simulated payment outcome.

The implementation remains a fictional-data simulation. It does not move money and must not imply an official or production U-Topia integration.

## Reference findings

### Observed in U-Topia

- A white, spacious application shell with the U-Topia logo on the left and compact account actions on the right.
- A centered pill navigation containing Dashboard, Wallets, Pay, Card, and Profile. The same top-navigation pattern remains on mobile.
- Orange is used for the active navigation state. Primary actions use a restrained blue-to-navy treatment.
- Surfaces use large rounded corners, thin neutral borders, restrained shadows, and generous whitespace.
- Dashboard content centers on the wallet balance and familiar wallet actions instead of a dense feature dashboard.
- Pay is presented as two simple native list cards: Send to U-Tag and Send Crypto.
- Payment subflows use a centered narrow column, circular Back control, rounded fields, concise labels, and a single dominant action.
- The observed notification prompt uses a centered rounded dialog, short explanatory copy, and two clear actions. This is the closest host-native reference for onboarding.

### Design inferences

- Safe-to-Pay should use the same shell, content widths, field shapes, buttons, and card language as the observed payment screens.
- First-time onboarding should extend the observed notification-dialog pattern rather than introduce a landing page.
- Purple may identify the added feature, but only as a restrained accent and short-lived motion. It must not replace U-Topia's orange navigation or blue primary actions.

## Experience architecture

The main journey is:

`Dashboard -> Pay -> U-Tag or Crypto -> Recipient and amount -> Safe-to-Pay -> User decision -> Simulated outcome`

Safe-to-Pay is not added as a top-level navigation destination. The Dashboard only supports feature discovery. The Pay flow remains the primary integration point.

## Host shell and responsive behavior

- Preserve the five-item top pill navigation at desktop, tablet, and mobile sizes.
- Keep the mobile header compact by hiding nonessential account text while retaining recognizable account actions.
- Keep host pages sparse and centered, with the existing balance, wallet actions, and Pay choices recognizable.
- Replace the oversized Dashboard partition presentation with one compact `Safe to spend` summary inside or immediately adjacent to the existing balance context.
- Provide a visible `How it works` control near that summary.
- Keep the simulation disclosure and scenario controls, but style them as a compact demo utility rather than primary product navigation.
- At narrow widths, A/B/C remain visible as equal controls and Stage controls move to a clearly labeled second row. Nothing depends on a clipped horizontal swipe strip.

## First-time onboarding

Use a host-native dialog with at most three steps:

1. **Meet Safe-to-Pay** — an extra check before payment, clearly labeled as a simulation.
2. **Know what's really available** — a simple fictional Balance versus Safe to Spend comparison.
3. **Check. Understand. Decide.** — `Pay -> Safe-to-Pay -> Your decision`.

Controls include Close, Skip, Back, Next, and Get Started. `How it works` reopens the same dialog.

Completion is stored only as a versioned boolean-like localStorage flag. Storage failures are caught and do not block the application. No financial values or identifiers are persisted. Resetting demo state does not reset onboarding; the visible `How it works` control is the replay mechanism.

`Get Started` opens the U-Topia Pay chooser so the introduction leads directly into the feature's real insertion point. It does not jump to a standalone feature page.

Accessibility requirements:

- `role="dialog"`, an accessible name, and modal semantics.
- Initial focus on the most appropriate dialog control.
- Contained Tab and Shift+Tab navigation.
- Escape, Close, Skip, and Get Started all dismiss safely.
- Restore focus to the element that opened the dialog.
- Prevent background scrolling while open.
- Preserve visible focus states and practical touch targets.
- Disable nonessential transitions under `prefers-reduced-motion`.

## Safe-to-Pay checkpoint

The checkpoint uses a centered U-Topia payment-review layout. Following the approved simplification, information order is:

1. Payment amount and recipient.
2. Maximum safe payment and a single purple meter showing safe-to-spend remaining after payment relative to that amount. The meter fills once over 650ms, with no movement for reduced-motion users. Overspending leaves the meter empty and is stated numerically; a missing exchange rate shows an unavailable amount without a meter.
3. Financial verdict, one-sentence impact, and balance after payment.
4. Collapsed `View impact details` with balance comparison and Before/After partitions.
5. Recommended action and neutral secondary actions. High recipient risk appears before these actions; low risk stays below.
6. Collapsed `Technical details` for judge inspection.

The financial and trust results remain independent. Status meaning is expressed through text and icons as well as color.

The checkpoint receives a short purple perimeter highlight when a result first appears. The motion lasts approximately 1–1.5 seconds and settles to a subtle purple feature border. It runs again when Scenario B changes from High Risk to Safe. It does not run continuously and is disabled for reduced-motion users. U-Topia's blue primary button remains the dominant action.

Back and Cancel remain visible. The user is never routed to a separate U-HANDSHAKE product surface.

Back from the checkpoint returns to the current transaction's preceding amount or wallet-check step rather than unexpectedly returning to Dashboard. Cancel exits the transaction to the Pay chooser.

## Scenario behavior

### Scenario A

- Preserve the U-Tag payment journey.
- Use the authoritative API result.
- Communicate that the payment is within Safe to Spend without suggesting that financial safety verifies recipient identity.

### Scenario B

- Show the canonical values returned by the backend: balance ฿18,500, obligations ฿7,200, debt ฿2,800, protected buffer ฿3,000, Safe to Spend ฿5,500, payment ฿12,900, post-payment balance ฿5,600, and must-keep shortfall ฿4,400.
- Make the core message immediately legible: the wallet balance covers the payment, but Safe to Spend does not.
- Present `Reduce amount` as the recommended action.
- Reducing to the recommended amount calls `POST /api/evaluate` again. The browser does not calculate the new status locally.
- Show the API-returned Safe result, then allow the simulated outcome.

### Scenario C

- Show Financial Review when an exchange rate is unavailable and do not invent a conversion.
- Show recipient/trust High Risk separately, using only provided evidence.
- Keep Verify Recipient, Postpone, and Cancel discoverable.
- When the recipient checklist is complete, make its action neutral white and label it `Review checklist`, with a check icon. Promote Proceed to the blue primary action with a short purple focus outline, label it `Continue despite risks`, and state `Checklist completed. Risk signals remain.` Completion does not change the assessment or recommend sending.
- Proceed with High recipient risk opens the Confirm step before any simulated payment. Back preserves the checklist, Cancel exits to Pay, and only `Confirm simulated payment` creates the simulated outcome.
- Label recipient history as simulated and avoid claims of verified fraud or guaranteed safety.

## Technical boundaries

The implementation targets the existing frontend and tests:

- `public/u-topia-handshake.html`
- `tests/e2e/safe-to-pay.spec.ts`

No new UI framework or component dependency will be added. The following backend areas are out of scope and must remain unchanged:

- `lib/domain/*`
- `lib/engine/*`
- `lib/ml/*`
- `lib/ai/*`
- `lib/api/*`
- `app/api/*`

Existing API schemas, financial rules, trust rules, scenarios, currency behavior, AI routing, evidence grounding, and cost controls remain authoritative.

## Verification

Playwright coverage will include first visit, Close, Skip, Get Started, persistence after reload, `How it works`, Escape, focus restoration, small-screen behavior, and Scenario B after dismissal. Existing A/B/C and failure-state coverage remains intact.

Manual responsive checks cover 1440x900, 768x1024, 390x844, and approximately 320px. Required before/after and scenario screenshots are stored in an untracked local output directory.

Final regression commands:

- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run test:e2e`

Paid AI remains disabled. No OpenRouter request, real transaction, push, merge, or deployment is permitted.

## Acceptance

The result is ready for review when U-Topia remains recognizable before the feature, Safe-to-Pay is understandable within seconds at the checkpoint, onboarding is optional and accessible, all scenarios use the real local API, all target viewports remain coherent, and the full regression suite passes.
