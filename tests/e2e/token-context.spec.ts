import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("uh-onboarding-v2", "complete"));
});

const openCrypto = async (page: Page) => {
  await page.goto("/");
  await page.locator('[data-go="wallets"]').first().click();
  await page.locator('[data-wtab="crypto"]').click();
  await expect(page.locator('[data-tour="crypto"]')).toBeVisible();
};
const mockDetails = (page: Page, body: unknown, delay = 0) => page.route("**/api/crypto-details?symbols=*", async (route) => {
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
});

const ARB = {
  symbol: "ARB",
  market: { status: "ok", priceUsd: 0.82, change24hUsd: -0.03, change1hPct: 0.2, change24hPct: -3.53, change7dPct: 4.8, high24hUsd: 0.87, low24hUsd: 0.8, sparkline7d: [0.76, 0.78, 0.77, 0.81, 0.82], updatedAt: "2026-10-16T05:00:00Z" },
  unlock: { status: "ok", date: "2026-11-16T00:00:00Z", amount: 92_000_000, valueToMarketCapPct: 1.8, allocations: [{ name: "Team", amount: 60_000_000 }], updatedAt: "2026-10-15T00:00:00Z" },
};
const USDC = { symbol: "USDC", market: { status: "ok", priceUsd: 1, change24hUsd: 0.001, change1hPct: -0.02, change24hPct: 0.1, change7dPct: 0.05, high24hUsd: 1.01, low24hUsd: 0.99, sparkline7d: [0.999, 1, 1.001], updatedAt: "2026-10-16T05:00:00Z" }, unlock: { status: "not_covered" } };

test("live crypto details are disabled honestly while holdings and Safe-to-Spend separation remain", async ({ page, request }) => {
  const response = await request.get("/api/crypto-details?symbols=USDC,ARB");
  expect(response.status()).toBe(200);
  expect((await response.json()).status).toBe("disabled");
  await openCrypto(page);
  for (const symbol of ["USDC", "ARB", "OP", "SUI", "APT", "STRK", "TIA", "ENA"]) await expect(page.locator('[data-tour="crypto"]')).toContainText(symbol);
  await expect(page.getByTestId("crypto-details-status")).toContainText("Live price and unlock details are disabled");
  await expect(page.locator('[data-token-state="disabled"]')).toHaveCount(8);
  await expect(page.getByText("crypto is not counted in Safe-to-Spend")).toBeVisible();
});

test("loading is non-blocking and does not hide holdings", async ({ page }) => {
  await mockDetails(page, { status: "disabled", tokens: {} }, 1_000);
  await openCrypto(page);
  await expect(page.getByTestId("crypto-details-status")).toContainText("Loading price and unlock details");
  await expect(page.locator('[data-token-state="loading"]')).toHaveCount(8);
  await expect(page.locator('[data-tour="crypto"]')).toContainText("ARB");
});

test("expanded details show USD price, positive and negative changes, 7-day chart, and upcoming unlock", async ({ page }) => {
  await mockDetails(page, { status: "ok", currency: "usd", sources: { market: "CoinGecko", unlocks: "Tokenomist" }, tokens: { USDC, ARB } });
  await openCrypto(page);
  await expect(page.locator('[data-token="ARB"] summary')).toContainText("$0.82");
  await expect(page.locator('[data-token="ARB"] summary [data-change="negative"]')).toContainText("−3.53%");
  await page.locator('[data-token="ARB"] summary').click();
  const detail = page.getByTestId("token-detail-ARB");
  await expect(detail.getByRole("img", { name: "ARB 7-day price chart" })).toBeVisible();
  await expect(detail.getByText("+4.80%", { exact: true })).toHaveAttribute("data-change", "positive");
  await expect(detail.getByText("−3.53%", { exact: true })).toHaveAttribute("data-change", "negative");
  await expect(detail).toContainText("Upcoming Unlock");
  await expect(detail).toContainText("16 Nov 2026");
  await expect(detail).toContainText("92,000,000 ARB");
  await expect(detail).toContainText("CoinGecko");
  await expect(detail).toContainText("Tokenomist");
  await expect(detail).not.toContainText(/Max supply|Circulating|Latest raise|Unlocked percentage/i);
  await page.locator('[data-tour="crypto"]').screenshot({ path: "test-results/crypto-details-desktop.png", animations: "disabled" });
  await page.locator('[data-token="ARB"] summary').click();
  await expect(detail).toBeHidden();
});

test("USDC keeps market details but clearly reports no Tokenomist unlock schedule", async ({ page }) => {
  await mockDetails(page, { status: "ok", tokens: { USDC } });
  await openCrypto(page);
  await page.locator('[data-token="USDC"] summary').click();
  const detail = page.getByTestId("token-detail-USDC");
  await expect(detail).toContainText("$1.00");
  await expect(detail).toContainText("Tokenomist has no upcoming unlock schedule for USDC");
});

test("one provider can fail without breaking the wallet or the other provider", async ({ page }) => {
  await mockDetails(page, { status: "partial", tokens: { ARB: { ...ARB, unlock: { status: "unavailable" } } } });
  await openCrypto(page);
  await page.locator('[data-token="ARB"] summary').click();
  await expect(page.getByTestId("token-detail-ARB")).toContainText("Upcoming unlock data is unavailable");
  await expect(page.getByTestId("token-detail-ARB")).toContainText("$0.82");
  await expect(page.getByText("crypto is not counted in Safe-to-Spend")).toBeVisible();
});

test("crypto detail chart and affordance fit a 390px wallet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockDetails(page, { status: "ok", tokens: { USDC, ARB } });
  await openCrypto(page);
  await page.locator('[data-token="ARB"] summary').click();
  const wallet = await page.locator('[data-tour="crypto"]').boundingBox();
  const detail = await page.getByTestId("token-detail-ARB").boundingBox();
  expect(wallet && detail).toBeTruthy();
  expect(detail!.x).toBeGreaterThanOrEqual(wallet!.x);
  expect(detail!.x + detail!.width).toBeLessThanOrEqual(wallet!.x + wallet!.width);
  await page.locator('[data-tour="crypto"]').screenshot({ path: "test-results/crypto-details-390.png", animations: "disabled" });
});
