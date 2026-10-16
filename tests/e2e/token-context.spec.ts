import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("uh-onboarding-v2", "complete"));
});

test("Tokenomist is off by default: endpoint reports disabled and the wallet shows nothing extra", async ({ page, request }) => {
  const res = await request.get("/api/token-context?symbol=USDC");
  expect(res.status()).toBe(200);
  expect((await res.json()).status).toBe("disabled");
  await page.goto("/");
  await page.locator('[data-go="wallets"]').first().click();
  await page.locator('[data-wtab="crypto"]').click();
  await expect(page.locator('[data-tour="crypto"]')).toBeVisible();
  await expect(page.getByTestId("token-context")).toHaveCount(0);
});

test("when live data exists it is labelled as Tokenomist tokenomics, not a price", async ({ page }) => {
  await page.route("**/api/token-context?symbol=USDC", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ status: "ok", symbol: "USDC", source: "Tokenomist", kind: "tokenomics, not a price", token: { id: "usd-coin", name: "USD Coin", symbol: "USDC", circulatingSupply: 1000, maxSupply: null, lockedAmount: 0, unlockedAmount: 1000, lastUpdated: "2026-10-15T00:00:00Z" } }),
  }));
  await page.goto("/");
  await page.locator('[data-go="wallets"]').first().click();
  await page.locator('[data-wtab="crypto"]').click();
  const line = page.getByTestId("token-context");
  await expect(line).toContainText("Tokenomist");
  await expect(line).toContainText("circulating supply 1,000 USDC");
  await expect(line).toContainText("not a price");
});

for (const [status, text] of [["not_covered", "doesn’t track USDC"], ["unavailable", "unavailable right now"]] as const) {
  test(`${status}: the wallet says so honestly and still works`, async ({ page }) => {
    await page.route("**/api/token-context?symbol=USDC", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ status, symbol: "USDC", source: "Tokenomist", kind: "tokenomics, not a price" }),
    }));
    await page.goto("/");
    await page.locator('[data-go="wallets"]').first().click();
    await page.locator('[data-wtab="crypto"]').click();
    const line = page.getByTestId("token-context");
    await expect(line).toContainText(text);
    await expect(line).not.toContainText(/supply|price:/i);
    await expect(page.getByText("crypto is not counted in Safe-to-Spend")).toBeVisible();
  });
}

test("unsupported symbols are rejected", async ({ request }) => {
  expect((await request.get("/api/token-context?symbol=BTC")).status()).toBe(400);
});
