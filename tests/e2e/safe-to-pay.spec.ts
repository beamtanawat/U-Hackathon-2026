import { expect, test, type Page, type Request } from "@playwright/test";

import { readFileSync } from "node:fs";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../examples/demo-scenarios/${name}`, import.meta.url), "utf8"));
const scenarioA = fixture("scenario-a-safe-u-tag.json");
const scenarioB = fixture("scenario-b-insufficient-safe-to-spend.json");
const scenarioC = fixture("scenario-c-suspicious-crypto.json");

const isEvaluate = (request: Request) => request.url().endsWith("/api/evaluate") && request.method() === "POST";

async function dismissOnboarding(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Meet Safe-to-Pay" });
  if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Skip" }).click();
}

async function runCheck(page: Page, scenario: "A" | "B" | "C") {
  await page.goto("/");
  await dismissOnboarding(page);
  await page.locator(`[data-scen="${scenario}"]`).first().click();
  if (scenario === "C") {
    await page.locator("#f-ack1").check();
    await page.locator("#f-ack2").check();
  }
  const [request, response] = await Promise.all([
    page.waitForRequest(isEvaluate),
    page.waitForResponse((r) => isEvaluate(r.request())),
    page.locator("#nextbtn").click(),
  ]);
  return { request, response };
}

test("onboarding appears on a clean first visit and Close dismisses it", async ({ page }) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Meet Safe-to-Pay" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close introduction" }).click();
  await expect(dialog).toBeHidden();
});

test("onboarding Skip persists across reloads", async ({ page }) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Meet Safe-to-Pay" });
  await dialog.getByRole("button", { name: "Skip" }).click();
  await page.reload();
  await expect(dialog).toBeHidden();
});

test("onboarding Back and Next lead Get Started to the Pay chooser", async ({ page }) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Meet Safe-to-Pay" });
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog).toContainText("Know what's really available");
  await dialog.getByRole("button", { name: "Back" }).click();
  await expect(dialog).toContainText("Meet Safe-to-Pay");
  await dialog.getByRole("button", { name: "Next" }).click();
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog).toContainText("Check. Understand. Decide.");
  await dialog.getByRole("button", { name: "Get Started" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Pay", exact: true })).toBeVisible();
});

test("How it works reopens onboarding without clearing the active scenario", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("uh-onboarding-v1", "complete"));
  await page.goto("/");
  await page.locator('[data-scen="B"]').click();
  await expect(page.locator("#f-amount")).toHaveValue("12900");
  const opener = page.getByRole("button", { name: "How it works" }).first();
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Meet Safe-to-Pay" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close introduction" }).click();
  await expect(page.locator("#f-amount")).toHaveValue("12900");
});

test("onboarding Escape restores focus to How it works", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("uh-onboarding-v1", "complete"));
  await page.goto("/");
  const opener = page.getByRole("button", { name: "How it works" }).first();
  await opener.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Meet Safe-to-Pay" })).toBeHidden();
  await expect(opener).toBeFocused();
});

test("onboarding traps keyboard focus inside the dialog", async ({ page }) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Meet Safe-to-Pay" });
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Tab");
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
});

test("onboarding survives a storage failure", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error("storage unavailable"); };
    Storage.prototype.setItem = () => { throw new Error("storage unavailable"); };
  });
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Meet Safe-to-Pay" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Skip" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Welcome!" })).toBeVisible();
});

test("Scenario B works after onboarding dismissal", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("dialog", { name: "Meet Safe-to-Pay" }).getByRole("button", { name: "Skip" }).click();
  await page.locator('[data-scen="B"]').click();
  const responsePromise = page.waitForResponse((response) => isEvaluate(response.request()));
  await page.locator("#nextbtn").click();
  expect((await responsePromise).status()).toBe(200);
  await expect(page.locator("#cp .statusrow")).toContainText("High Risk");
});

test("host shell keeps Safe to Spend as compact Dashboard discovery", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("uh-onboarding-v1", "complete"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Total Balance" })).toBeVisible();
  await expect(page.locator('[data-testid="safe-spend-discovery"]')).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Money partition" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "How it works" }).first()).toBeVisible();
});

test("narrow viewport keeps top navigation and every demo control visible", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("uh-onboarding-v1", "complete"));
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const nav = await page.locator(".navwrap").boundingBox();
    const content = await page.locator("#page").boundingBox();
    expect(nav && content && nav.y + nav.height <= content.y).toBe(true);
    for (const scenario of ["A", "B", "C"]) await expect(page.locator(`[data-scen="${scenario}"]`)).toBeVisible();
    await expect(page.locator(".stage > summary")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
});

test("Reset Demo returns to Dashboard without reopening onboarding", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("uh-onboarding-v1", "complete"));
  await page.goto("/");
  await page.locator('[data-scen="B"]').click();
  await page.locator(".stage > summary").click();
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByRole("heading", { name: "Welcome!" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Meet Safe-to-Pay" })).toBeHidden();
});

test("Scenario B: the real API decides High Risk, the user reduces, then proceeds (simulated)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  const { request, response } = await runCheck(page, "B");

  // The frontend sends exactly the canonical fixture request.
  expect(request.postDataJSON()).toEqual(scenarioB.request);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.assessment.financial).toEqual(scenarioB.expectedAssessment.financial);

  // The UI renders the authoritative result.
  const cp = page.locator("#cp");
  const financial = cp.locator('[aria-labelledby="fin-h"]');
  await expect(cp.locator(".statusrow")).toContainText("High Risk");
  await expect(cp.locator(".statusrow")).toContainText("Low");
  await expect(cp.locator(".vtext")).toContainText("฿4,400 less");
  await expect(financial).toContainText("Financial check");
  await expect(financial).toContainText("Balance");
  await expect(financial).toContainText("฿18,500");
  await expect(financial).toContainText("Safe to Spend");
  await expect(financial).toContainText("฿5,500");
  await expect(financial).toContainText("Payment");
  await expect(financial).toContainText("฿12,900");
  await expect(financial).toContainText("After payment");
  await expect(financial).toContainText("฿5,600");
  await expect(financial).toContainText("฿4,400 short");
  await expect(cp).toContainText("Rules-engine explanation");
  await expect(cp).toHaveClass(/feature-pulse/);
  const technical = cp.locator("details.details");
  await expect(technical.locator("summary")).toContainText("Technical details");
  await expect(technical).not.toHaveAttribute("open", "");
  await expect(page.locator("#inspector .insp-toggle")).toBeVisible();
  await expect(page.locator(".flow-top .back")).toBeVisible();
  await expect(cp.locator('[data-act="cancel"]')).toBeVisible();
  await expect(page.locator("body")).not.toContainText("U-Bot");
  await page.screenshot({ path: "test-results/scenario-b-1-high-risk.png", animations: "disabled" });

  // Suggested action: pay the engine's maximum safe amount; the API re-evaluates it.
  const [reduced, reducedResponse] = await Promise.all([
    page.waitForRequest(isEvaluate),
    page.waitForResponse((r) => isEvaluate(r.request())),
    cp.locator(".primary-act").click(),
  ]);
  expect(reduced.postDataJSON().amount).toEqual({ value: 5500, provenance: "user_provided" });
  expect((await reducedResponse.json()).assessment.financial.status).toBe("safe");
  await expect(cp.locator(".statusrow")).toContainText("Safe");
  await expect(cp).toContainText("Amount reduced from ฿12,900 to ฿5,500");

  // Proceed only simulates the transfer.
  await cp.locator('[data-act="proceed"]').first().click();
  await expect(cp).toContainText("Simulated payment sent");
  await expect(cp).toContainText("No real money was moved");
  await expect(cp).toContainText("฿18,500");
  await expect(cp).toContainText("฿13,000");
  await page.screenshot({ path: "test-results/scenario-b-2-outcome.png", animations: "disabled" });

  expect(consoleErrors).toEqual([]);
});

test("Scenario A: Safe with no AI call needed", async ({ page }) => {
  const { request, response } = await runCheck(page, "A");
  expect(request.postDataJSON()).toEqual(scenarioA.request);
  const body = await response.json();
  expect(body.assessment.financial.status).toBe("safe");
  expect(body.ai.route).toBe("none");
  await expect(page.locator("#cp .statusrow")).toContainText("Safe");
  await expect(page.locator("#cp [aria-label='Recipient check']")).toContainText("No recipient risk signals");
  await expect(page.locator("#cp")).not.toContainText("Verified recipient");
});

test("Scenario C: trust High and affordability Review without an invented exchange rate", async ({ page }) => {
  const { request, response } = await runCheck(page, "C");
  expect(request.postDataJSON()).toEqual(scenarioC.request);
  const body = await response.json();
  expect(body.assessment.financial.missingFields).toEqual(["exchangeRate"]);
  expect(body.breakdown).toBeNull();
  const cp = page.locator("#cp");
  const financial = cp.locator('[aria-labelledby="fin-h"]');
  const recipient = cp.locator('[aria-labelledby="trust-h"]');
  await expect(financial.getByRole("heading", { name: "Financial check" })).toBeVisible();
  await expect(recipient.getByRole("heading", { name: /Recipient check/ })).toBeVisible();
  await expect(cp.locator(".statusrow")).toContainText("Review");
  await expect(cp.locator(".statusrow")).toContainText("High");
  await expect(financial).toContainText("Review");
  await expect(financial).toContainText("No exchange rate is available");
  await expect(recipient).toContainText("High");
  await expect(recipient).toContainText("Guaranteed or high return");
  await expect(recipient).toContainText("not verified");
  await expect(page.locator("body")).not.toContainText("฿33");
});

test("checkpoint Back returns to the transaction and Cancel returns to Pay", async ({ page }) => {
  await runCheck(page, "B");
  await page.locator(".flow-top .back").click();
  await expect(page.locator("#f-amount")).toHaveValue("12900");
  await page.locator('[data-scen="B"]').click();
  const responsePromise = page.waitForResponse((response) => isEvaluate(response.request()));
  await page.locator("#nextbtn").click();
  await responsePromise;
  await page.locator('#cp [data-act="cancel"]').click();
  await expect(page.getByRole("heading", { name: "Pay", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Send to U-tag/ })).toBeVisible();
});

test("checkpoint pulse respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await runCheck(page, "B");
  const cp = page.locator("#cp");
  await expect(cp).toHaveClass(/feature-pulse/);
  expect(await cp.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
});

test("checkpoint actions do not overlap financial or recipient content", async ({ page }) => {
  await runCheck(page, "B");
  const financial = await page.locator("#cp .fin").boundingBox();
  const actions = await page.locator("#cp .actions2").boundingBox();
  const recipient = await page.locator("#cp .trust").boundingBox();
  expect(financial && actions && actions.y >= financial.y + financial.height - 1).toBe(true);
  expect(actions && recipient && recipient.y >= actions.y + actions.height - 1).toBe(true);
});

test("visual regression mobile header and Help avoid wallet content", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("uh-onboarding-v1", "complete"));
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");
  await expect(page.locator(".user .avatar")).toBeVisible();
  await expect(page.locator(".textsize")).toBeHidden();
  const logo = await page.locator(".logo").boundingBox();
  expect(logo && logo.height < 45).toBe(true);
  const help = await page.locator("#chatFab").boundingBox();
  const discovery = await page.locator('[data-testid="safe-spend-discovery"]').boundingBox();
  const overlaps = help && discovery && help.x < discovery.x + discovery.width && help.x + help.width > discovery.x && help.y < discovery.y + discovery.height && help.y + help.height > discovery.y;
  expect(overlaps).toBe(false);
});

test("visual regression simulation notice leaves the viewport on scroll", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("uh-onboarding-v1", "complete"));
  await page.goto("/");
  await page.evaluate(() => window.scrollTo(0, 900));
  expect(await page.locator(".simbar").evaluate((node) => node.getBoundingClientRect().bottom <= 0)).toBe(true);
});

test("API failures are shown honestly instead of a fabricated result", async ({ page }) => {
  await page.route("**/api/evaluate", (route) => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: "rate_limited", message: "Too many" } }) }));
  await runCheck(page, "B");
  const cp = page.locator("#cp");
  await expect(cp).toContainText("Too many checks in a short time");
  await expect(cp).toContainText("rate_limited");
  await expect(cp.locator(".statusrow")).toHaveCount(0);
});
