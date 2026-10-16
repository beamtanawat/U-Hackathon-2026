import { expect, test, type Page } from "@playwright/test";

/* Fake microphone + MediaRecorder: no real audio, no real ElevenLabs calls. */
async function fakeMic(page: Page, { deny = false } = {}) {
  await page.addInitScript((deny) => {
    localStorage.setItem("uh-onboarding-v2", "complete");
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia: async () => { if (deny) throw new DOMException("denied", "NotAllowedError"); return { getTracks: () => [{ stop() {} }] }; },
    } });
    class FakeRecorder {
      static isTypeSupported(t: string) { return t === "audio/webm;codecs=opus"; }
      state = "inactive"; mimeType = "audio/webm;codecs=opus";
      ondataavailable: ((e: { data: Blob }) => void) | null = null; onstop: (() => void) | null = null;
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob([new Uint8Array(3000)], { type: "audio/webm" }) }); this.onstop?.(); }
    }
    (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  }, deny);
}
async function mockStt(page: Page, reply: { status: number; body: unknown }) {
  const posts: string[] = [];
  await page.route("**/api/transcribe", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, maxSeconds: 15 }) });
    posts.push(route.request().headers()["content-type"] ?? "");
    return route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) });
  });
  return posts;
}

test("voice input stays discoverable but cannot call STT while disabled", async ({ page }) => {
  await fakeMic(page);
  const methods: string[] = [];
  await page.route("**/api/transcribe", (route) => {
    methods.push(route.request().method());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: false, maxSeconds: 15 }) });
  });
  await page.goto("/");
  await page.locator("#chatFab").click();
  await expect(page.locator("#chat-q")).toBeVisible();
  const mic = page.getByRole("button", { name: "Voice input unavailable" });
  await expect(mic).toBeVisible();
  await expect(mic).toBeDisabled();
  await expect(page.locator("#mic-status")).toContainText("isn’t active");
  expect(methods).toEqual(["GET"]);
});

test("push-to-talk fills the input; nothing is sent or changed until the user sends and confirms", async ({ page }) => {
  await fakeMic(page);
  const posts = await mockStt(page, { status: 200, body: { text: "Set my emergency buffer to 4000 baht.", language: "eng" } });
  await page.goto("/");
  await page.locator("#chatFab").click();
  const mic = page.getByRole("button", { name: "Speak to U-Bot" });
  await mic.click();
  const stop = page.getByRole("button", { name: "Stop recording" });
  await expect(stop).toHaveClass(/rec/);
  await expect(page.locator("#mic-status")).toContainText("Recording");
  const before = await page.locator("#chat-log .msg").count();
  await stop.click();
  await expect(page.locator("#chat-q")).toHaveValue("Set my emergency buffer to 4000 baht.");
  await expect(page.locator("#mic-status")).toContainText("press Send");
  expect(posts).toHaveLength(1);
  expect(posts[0]).toContain("multipart/form-data");
  expect(await page.locator("#chat-log .msg").count()).toBe(before);

  await page.locator("#chat-q").press("Enter");
  await expect(page.getByTestId("partition-preview").last()).toContainText("฿4,000");
  expect(await page.evaluate(() => sessionStorage.getItem("uh-partition-v1"))).toBeNull();
});

test("a Thai transcription goes through preview, Confirm and the API re-check", async ({ page }) => {
  await fakeMic(page);
  await mockStt(page, { status: 200, body: { text: "ตั้งเงินสำรองฉุกเฉินเป็น 4000 บาท", language: "tha" } });
  await page.goto("/");
  await page.locator('[data-scen="B"]').click();
  await page.locator("#nextbtn").click();
  await expect(page.locator("#cp .statusrow")).toContainText("High Risk");
  await page.locator("#chatFab").click();
  await page.getByRole("button", { name: "Speak to U-Bot" }).click();
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.locator("#chat-q")).toHaveValue("ตั้งเงินสำรองฉุกเฉินเป็น 4000 บาท");
  await page.locator("#chat-q").press("Enter");
  const card = page.getByTestId("partition-preview").last();
  await expect(card).toContainText("฿3,000");
  await expect(card).toContainText("฿4,000");
  expect(await page.evaluate(() => sessionStorage.getItem("uh-partition-v1"))).toBeNull();
  const [request, response] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith("/api/evaluate") && r.method() === "POST"),
    page.waitForResponse((r) => r.url().endsWith("/api/evaluate") && r.request().method() === "POST"),
    card.getByRole("button", { name: "Confirm change" }).click(),
  ]);
  expect(request.postDataJSON().protectedBuffer).toEqual({ value: 4000, provenance: "user_provided" });
  expect((await response.json()).breakdown.protectedBuffer).toBe(4000);
});

test("errors are short, and typing still works", async ({ page }) => {
  await fakeMic(page, { deny: true });
  await mockStt(page, { status: 200, body: { text: "unused" } });
  await page.goto("/");
  await page.locator("#chatFab").click();
  await page.getByRole("button", { name: "Speak to U-Bot" }).click();
  await expect(page.locator("#mic-status")).toContainText("Microphone access was blocked");
  await page.locator("#chat-q").fill("What is safe-to-spend?");
  await page.locator("#chat-q").press("Enter");
  await expect(page.locator("#chat-log .msg.bot").last()).toContainText("Safe-to-spend");
});

test("an STT failure shows the server message and leaves the input empty", async ({ page }) => {
  await fakeMic(page);
  await mockStt(page, { status: 429, body: { error: { code: "stt_rate_limited", message: "Voice input is busy right now. You can type instead." } } });
  await page.goto("/");
  await page.locator("#chatFab").click();
  await page.getByRole("button", { name: "Speak to U-Bot" }).click();
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.locator("#mic-status")).toContainText("Voice input is busy");
  await expect(page.locator("#chat-q")).toHaveValue("");
});

test("microphone and Send stay inside the U-Bot panel without overlap on desktop and mobile", async ({ page }) => {
  await fakeMic(page);
  await mockStt(page, { status: 200, body: { text: "unused" } });
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.locator("#chatFab").click();
    const chat = await page.locator("#chat").boundingBox();
    const mic = await page.locator("#mic-btn").boundingBox();
    const send = await page.locator('#chat-form button[type="submit"]').boundingBox();
    expect(chat && mic && send).toBeTruthy();
    expect(mic!.x + mic!.width).toBeLessThanOrEqual(send!.x);
    expect(mic!.x).toBeGreaterThanOrEqual(chat!.x);
    expect(send!.x + send!.width).toBeLessThanOrEqual(chat!.x + chat!.width);
    await page.locator("#chat").screenshot({ path: `test-results/voice-${viewport.width}.png`, animations: "disabled" });
  }
});
