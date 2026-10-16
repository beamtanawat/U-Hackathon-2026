import { describe, expect, it, vi } from "vitest";

import { createTranscribeHandlers, ELEVENLABS_STT_URL } from "../../lib/api/transcribe-handler";

const KEY = "test-placeholder-eleven";
const live = { ELEVENLABS_STT_MODE: "live", ELEVENLABS_API_KEY: KEY };
const audio = (bytes = 4_000, type = "audio/webm") => new Blob([new Uint8Array(bytes)], { type });
const post = (blob: Blob | null, ip = "203.0.113.9") => {
  const form = new FormData();
  if (blob) form.append("audio", blob, "recording");
  return new Request("http://localhost/api/transcribe", { method: "POST", headers: { "x-forwarded-for": ip }, body: form });
};
const eleven = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("/api/transcribe (ElevenLabs STT, mocked)", () => {
  it("is off by default: GET reports disabled and POST makes no call", async () => {
    const fetchImpl = vi.fn();
    for (const env of [{}, { ELEVENLABS_API_KEY: KEY }, { ELEVENLABS_STT_MODE: "live" }]) {
      const { GET, POST } = createTranscribeHandlers({ env, fetchImpl });
      expect((await (await GET()).json()).enabled).toBe(false);
      const res = await POST(post(audio()));
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("stt_disabled");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("forwards valid audio to scribe_v2 with the key only in the header and returns only text", async () => {
    const fetchImpl = eleven(200, { text: "  Set my emergency buffer to 4000 baht. ", language_code: "eng", language_probability: 0.98, words: [{ text: "Set" }] });
    const { GET, POST } = createTranscribeHandlers({ env: live, fetchImpl });
    expect((await (await GET()).json()).enabled).toBe(true);
    const res = await POST(post(audio()));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ text: "Set my emergency buffer to 4000 baht.", language: "eng" });
    expect(text).not.toContain(KEY);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ELEVENLABS_STT_URL);
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe(KEY);
    const sent = init.body as FormData;
    expect(sent.get("model_id")).toBe("scribe_v2");
    expect(sent.get("language_code")).toBeNull();
    expect((sent.get("file") as Blob).size).toBe(4_000);
  });

  it.each([
    ["missing file", null, 400, "invalid_audio"],
    ["empty recording", audio(200), 400, "empty_audio"],
    ["oversized recording", audio(5 * 1024 * 1024 + 1), 413, "audio_too_large"],
    ["non-audio upload", audio(4_000, "text/plain"), 415, "unsupported_audio"],
  ])("rejects %s without calling ElevenLabs", async (_label, blob, status, code) => {
    const fetchImpl = vi.fn();
    const res = await createTranscribeHandlers({ env: live, fetchImpl }).POST(post(blob));
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(code);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, 502, "stt_not_configured"],
    [429, 429, "stt_rate_limited"],
    [500, 502, "stt_unavailable"],
  ])("maps ElevenLabs HTTP %i to %i %s without leaking the upstream body", async (upstream, status, code) => {
    const res = await createTranscribeHandlers({ env: live, fetchImpl: eleven(upstream, { detail: "secret upstream detail" }) }).POST(post(audio()));
    const text = await res.text();
    expect(res.status).toBe(status);
    expect(JSON.parse(text).error.code).toBe(code);
    expect(text).not.toContain("secret upstream detail");
  });

  it("maps a timeout to 504", async () => {
    const fetchImpl = vi.fn(async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); });
    const res = await createTranscribeHandlers({ env: live, fetchImpl }).POST(post(audio()));
    expect(res.status).toBe(504);
  });

  it("reports an empty transcript as 422", async () => {
    const res = await createTranscribeHandlers({ env: live, fetchImpl: eleven(200, { text: "   " }) }).POST(post(audio()));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("empty_transcript");
  });

  it("applies a per-client cooldown, a rate limit and an hourly budget", async () => {
    let t = 0;
    const fetchImpl = eleven(200, { text: "hello" });
    const { POST } = createTranscribeHandlers({ env: live, fetchImpl, now: () => t, maxPerHour: 2 });
    expect((await POST(post(audio()))).status).toBe(200);
    expect((await (await POST(post(audio()))).json()).error.code).toBe("cooldown");
    t += 4_000;
    expect((await POST(post(audio()))).status).toBe(200);
    t += 4_000;
    expect((await (await POST(post(audio()))).json()).error.code).toBe("budget_exhausted");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
