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

test("voice input is hidden while STT is disabled (default)", async ({ page }) => {
  await fakeMic(page);
  await page.goto("/");
  await page.locator("#chatFab").click();
  await expect(page.locator("#chat-q")).toBeVisible();
  await expect(page.locator("#mic-btn")).toBeHidden();
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

test("a Thai transcription goes through the same U-Bot command flow", async ({ page }) => {
  await fakeMic(page);
  await mockStt(page, { status: 200, body: { text: "ตั้งเงินสำรองฉุกเฉินเป็น 4000 บาท", language: "tha" } });
  await page.goto("/");
  await page.locator("#chatFab").click();
  await page.getByRole("button", { name: "Speak to U-Bot" }).click();
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.locator("#chat-q")).toHaveValue("ตั้งเงินสำรองฉุกเฉินเป็น 4000 บาท");
  await page.locator("#chat-q").press("Enter");
  await expect(page.getByTestId("partition-preview").last()).toContainText("฿4,000");
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
