import { defineConfig } from "@playwright/test";

const PORT = 3107;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Chromium headless shell installed under .playwright-browsers (see test:e2e).
    headless: true,
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    // Production build + server, exactly what Vercel runs.
    command: `npx next build && npx next start -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    timeout: 240_000,
    reuseExistingServer: false,
    // Paid AI is impossible in E2E: no key and AI_MODE off.
    env: { AI_MODE: "off", OPENROUTER_API_KEY: "", TOKENOMIST_MODE: "off", TOKENOMIST_API_KEY: "", ELEVENLABS_STT_MODE: "off", ELEVENLABS_API_KEY: "", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
