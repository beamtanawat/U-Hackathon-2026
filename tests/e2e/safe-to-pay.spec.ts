import { expect, test, type Page, type Request } from "@playwright/test";

import { readFileSync } from "node:fs";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../examples/demo-scenarios/${name}`, import.meta.url), "utf8"));
const scenarioA = fixture("scenario-a-safe-u-tag.json");
const scenarioB = fixture("scenario-b-insufficient-safe-to-spend.json");
const scenarioC = fixture("scenario-c-suspicious-crypto.json");

const isEvaluate = (request: Request) => request.url().endsWith("/api/evaluate") && request.method() === "POST";

async function runCheck(page: Page, scenario: "A" | "B" | "C") {
  await page.goto("/");
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
  await expect(cp.locator(".statusrow")).toContainText("High Risk");
  await expect(cp.locator(".statusrow")).toContainText("Low");
  await expect(cp.locator(".vtext")).toContainText("฿4,400 less");
  await expect(cp).toContainText("฿5,500");
  await expect(cp).toContainText("Rules-engine explanation");
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
});

test("Scenario C: trust High and affordability Review without an invented exchange rate", async ({ page }) => {
  const { request, response } = await runCheck(page, "C");
  expect(request.postDataJSON()).toEqual(scenarioC.request);
  const body = await response.json();
  expect(body.assessment.financial.missingFields).toEqual(["exchangeRate"]);
  expect(body.breakdown).toBeNull();
  const cp = page.locator("#cp");
  await expect(cp.locator(".statusrow")).toContainText("Review");
  await expect(cp.locator(".statusrow")).toContainText("High");
  await expect(cp).toContainText("No exchange rate is available");
  await expect(cp).toContainText("Guaranteed or high return");
  await expect(cp).toContainText("not verified");
  await expect(page.locator("body")).not.toContainText("฿33");
});

test("API failures are shown honestly instead of a fabricated result", async ({ page }) => {
  await page.route("**/api/evaluate", (route) => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: "rate_limited", message: "Too many" } }) }));
  await runCheck(page, "B");
  const cp = page.locator("#cp");
  await expect(cp).toContainText("Too many checks in a short time");
  await expect(cp).toContainText("rate_limited");
  await expect(cp.locator(".statusrow")).toHaveCount(0);
});
