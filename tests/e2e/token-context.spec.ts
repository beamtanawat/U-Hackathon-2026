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
const mockContext = (page: Page, body: unknown) =>
  page.route("**/api/token-context?symbols=*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }));

const ARB = { id: "arbitrum", name: "Arbitrum", symbol: "ARB", circulatingSupply: 4_000, maxSupply: 10_000, lockedAmount: 3_500, tbdLockedAmount: 0, unlockedAmount: 6_000, untrackedAmount: 500, latestFundraisingRound: "Series B", hasBurn: false, hasBuyback: true, websiteUrl: "https://tokenomist.ai/arbitrum", lastUpdated: "2026-10-15T00:00:00Z" };

test("Tokenomist is off by default: endpoint reports disabled and the wallet lists tokens without extra data", async ({ page, request }) => {
  const res = await request.get("/api/token-context?symbols=USDC,ARB");
  expect(res.status()).toBe(200);
  expect((await res.json()).status).toBe("disabled");
  await openCrypto(page);
  for (const sym of ["USDC", "ARB", "OP", "SUI", "APT", "STRK", "TIA", "ENA"]) await expect(page.locator('[data-tour="crypto"]')).toContainText(sym);
  await expect(page.getByTestId("token-context")).toHaveCount(0);
  await expect(page.locator("details.tk")).toHaveCount(0);
  await expect(page.getByText("crypto is not counted in Safe-to-Spend")).toBeVisible();
});

test("live data shows unlock progress and key facts per token, labelled as tokenomics, not a price", async ({ page }) => {
  await mockContext(page, { status: "ok", source: "Tokenomist", kind: "tokenomics, not a price", tokens: { USDC: { status: "not_covered", symbol: "USDC" }, ARB: { status: "ok", symbol: "ARB", token: ARB } } });
  await openCrypto(page);
  await expect(page.getByTestId("token-context")).toContainText("doesn’t track USDC");
  const arb = page.locator('details.tk[data-token="ARB"]');
  await expect(arb).toHaveCount(1);
  await expect(page.locator('details.tk[data-token="OP"]')).toHaveCount(0);
  await arb.locator("summary").click();
  const detail = page.getByTestId("token-detail-ARB");
  await expect(detail).toContainText("60.0% unlocked");
  await expect(detail).toContainText("35.0% locked");
  await expect(detail).toContainText("Max supply");
  await expect(detail).toContainText("Latest raise: Series B");
  await expect(detail).toContainText("Has buybacks");
  await expect(detail).toContainText("not a price");
  await expect(detail).not.toContainText(/price:|market cap|\$/i);
  await expect(detail.getByRole("link", { name: "View unlock schedule" })).toHaveAttribute("href", "https://tokenomist.ai/arbitrum");
});

test("unavailable: the wallet says so honestly and still works", async ({ page }) => {
  await mockContext(page, { status: "unavailable", reason: "timeout", tokens: {} });
  await openCrypto(page);
  await expect(page.getByTestId("token-context")).toContainText("unavailable right now");
  await expect(page.locator("details.tk")).toHaveCount(0);
  await expect(page.getByText("crypto is not counted in Safe-to-Spend")).toBeVisible();
});

test("unsupported symbols are rejected", async ({ request }) => {
  expect((await request.get("/api/token-context?symbol=BTC")).status()).toBe(400);
  expect((await request.get("/api/token-context?symbols=ARB,BTC")).status()).toBe(400);
});
