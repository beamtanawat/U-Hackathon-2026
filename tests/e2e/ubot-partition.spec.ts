import { expect, test, type Page } from "@playwright/test";

const isEvaluate = (url: string, method: string) => url.endsWith("/api/evaluate") && method === "POST";

async function skipTour(page: Page) {
  await page.addInitScript(() => localStorage.setItem("uh-onboarding-v2", "complete"));
}
async function say(page: Page, text: string) {
  await page.locator("#chat-q").fill(text);
  await page.locator("#chat-q").press("Enter");
}
const overlap = (a: { x: number; y: number; width: number; height: number } | null, b: typeof a) =>
  !!a && !!b && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test("U-Bot head sits on the right edge, mid-screen, and opens and closes by mouse and keyboard", async ({ page }) => {
  await skipTour(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const head = page.getByRole("button", { name: "Open U-Bot Simulation assistant" });
  const box = await head.boundingBox();
  expect(box && box.x + box.width > 1440 - 120 && box.y > 900 * 0.3 && box.y + box.height < 900 * 0.7).toBe(true);
  await head.click();
  await expect(page.getByRole("region", { name: "U-Bot Simulation assistant" })).toBeVisible();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#chat")).toBeHidden();
  await expect(head).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#chat")).toBeVisible();
});

test("a partition change needs confirmation; Cancel leaves everything unchanged", async ({ page }) => {
  await skipTour(page);
  await page.goto("/");
  await page.locator("#chatFab").click();
  await say(page, "Set my emergency buffer to 4,000 baht");
  const card = page.getByTestId("partition-preview").last();
  await expect(card).toContainText("฿3,000");
  await expect(card).toContainText("฿4,000");
  expect(await page.evaluate(() => sessionStorage.getItem("uh-partition-v1"))).toBeNull();
  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#chat-log")).toContainText("Cancelled. Nothing changed.");
  expect(await page.evaluate(() => sessionStorage.getItem("uh-partition-v1"))).toBeNull();
});

test("unsupported or ambiguous requests get a clarification, never a change", async ({ page }) => {
  await skipTour(page);
  await page.goto("/");
  await page.locator("#chatFab").click();
  await say(page, "set my buffer to 100 USD");
  await expect(page.locator("#chat-log .msg.bot").last()).toContainText("Thai baht only");
  await say(page, "set my debt to 0");
  await expect(page.locator("#chat-log .msg.bot").last()).toContainText("can't be edited");
  await expect(page.getByTestId("partition-preview")).toHaveCount(0);
});

test("confirming re-runs the open Safe-to-Pay check through the real API", async ({ page }) => {
  await skipTour(page);
  await page.goto("/");
  await page.locator('[data-scen="B"]').click();
  await page.locator("#nextbtn").click();
  await expect(page.locator("#cp .statusrow")).toContainText("High Risk");

  await page.locator("#chatFab").click();
  await say(page, "Set my emergency buffer to 4,000 baht");
  const card = page.getByTestId("partition-preview").last();
  const [request, response] = await Promise.all([
    page.waitForRequest((r) => isEvaluate(r.url(), r.method())),
    page.waitForResponse((r) => isEvaluate(r.url(), r.request().method())),
    card.getByRole("button", { name: "Confirm change" }).click(),
  ]);
  const sent = request.postDataJSON();
  expect(sent.protectedBuffer).toEqual({ value: 4000, provenance: "user_provided" });
  expect(sent.scenarioId).toBeUndefined();
  const body = await response.json();
  expect(body.breakdown.protectedBuffer).toBe(4000);
  await expect(page.locator("#chat-log")).toContainText(`Safe-to-Pay API result: Money ${body.assessment.financial.status === "high_risk" ? "High Risk" : "Safe"}`);

  await page.locator("#chat-log").getByRole("button", { name: "Undo" }).first().click();
  await expect(page.locator("#chat-log")).toContainText("Undone. Emergency buffer ฿3,000");
});

test("the Wallet Partition shows the edit as a labelled simulation and keeps crypto separate", async ({ page }) => {
  await skipTour(page);
  await page.goto("/");
  await page.locator("#chatFab").click();
  await say(page, "Reserve 2,000 baht more for bills");
  await page.getByTestId("partition-preview").last().getByRole("button", { name: "Confirm change" }).click();
  await page.keyboard.press("Escape");
  await page.locator('[data-go="wallets"]').first().click();
  await page.locator('[data-wtab="spending"]').click();
  const partition = page.getByRole("list", { name: "Wallet Partition" });
  await expect(partition).toContainText("Reserved for bills");
  await expect(partition).toContainText("฿9,200");
  await expect(partition).toContainText("Crypto holdings");
  await expect(partition).toContainText("not counted in Safe-to-Spend");
  await expect(page.getByTestId("partition-edited")).toBeVisible();
});

test("tour spotlights real elements, reaches Crypto and U-Bot, and Escape closes it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Safe-to-Pay tour" });
  const next = dialog.getByRole("button", { name: "Next" });
  for (let i = 0; i < 3; i += 1) await next.click();
  await expect(dialog).toContainText("Crypto Wallet");
  await expect(page.locator('[data-tour="crypto"]')).toBeVisible();
  await next.click();
  await expect(dialog).toContainText("Meet U-Bot");
  const head = await page.locator("#chatFab").boundingBox();
  // The spotlight animates between targets; wait until it encloses the U-Bot head.
  await expect.poll(async () => {
    const spot = await page.locator("#tour-spot").boundingBox();
    return !!spot && !!head && spot.x <= head.x && spot.y <= head.y && spot.x + spot.width >= head.x + head.width && spot.y + spot.height >= head.y + head.height;
  }).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "How it works" }).first().click();
  await expect(dialog).toContainText("Step 1 of 8");
});

test("mobile: U-Bot never covers navigation or the payment button, and hides behind the result sheet", async ({ page }) => {
  await skipTour(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const head = page.locator("#chatFab");
  expect(overlap(await head.boundingBox(), await page.locator(".navwrap").boundingBox())).toBe(false);
  for (const value of ['[data-testid="safe-spend-discovery"]', '[data-tour="balance"] .amt-lg', '[data-tour="balance"] .split2']) {
    expect(overlap(await head.boundingBox(), await page.locator(value).boundingBox())).toBe(false);
  }
  await page.locator('[data-scen="B"]').click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect(overlap(await head.boundingBox(), await page.locator("#nextbtn").boundingBox())).toBe(false);
  await page.locator("#nextbtn").click();
  await expect(page.locator("#cp .statusrow")).toContainText("High Risk");
  await expect(head).toBeHidden();
});
