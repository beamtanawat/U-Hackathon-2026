import { clientKey, createAiBudget, createRateLimiter } from "./guards";

/**
 * POST /api/transcribe — push-to-talk speech-to-text for U-Bot.
 * Forwards one short recording to ElevenLabs (scribe_v2, auto language) and
 * returns only the text. Off unless ELEVENLABS_STT_MODE=live and a key are set.
 * Audio is never stored or logged. Limits are per server instance, not global.
 */
export const ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
export const STT_MODEL = "scribe_v2";
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
export const MIN_AUDIO_BYTES = 1_000;
export const STT_TIMEOUT_MS = 15_000;
export const MAX_TRANSCRIPT_CHARS = 1_000;
const AUDIO_TYPE = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|aac|x-m4a|m4a)(;.*)?$/i;

export interface TranscribeDependencies {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  rateLimit?: { limit: number; windowMs: number };
  cooldownMs?: number;
  maxPerHour?: number;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status);

export function sttEnabled(env: Record<string, string | undefined>): boolean {
  return env.ELEVENLABS_STT_MODE === "live" && Boolean(env.ELEVENLABS_API_KEY);
}

export function createTranscribeHandlers(dependencies: TranscribeDependencies = {}) {
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? Date.now;
  const limiter = createRateLimiter({ ...(dependencies.rateLimit ?? { limit: 6, windowMs: 60_000 }), now });
  const budget = createAiBudget({ maxCallsPerHour: dependencies.maxPerHour ?? (Number(env.ELEVENLABS_STT_MAX_PER_HOUR) || 30), now });
  const cooldownMs = dependencies.cooldownMs ?? 3_000;
  const lastCall = new Map<string, number>();
  const busy = new Set<string>();

  /** GET: lets the page show the microphone only when voice input is enabled. */
  async function GET(): Promise<Response> {
    return json({ enabled: sttEnabled(env), maxSeconds: 15 });
  }

  async function POST(request: Request): Promise<Response> {
    const apiKey = env.ELEVENLABS_API_KEY;
    if (!sttEnabled(env) || !apiKey) return fail(503, "stt_disabled", "Voice input is off in this demo. You can type instead.");

    const client = clientKey(request);
    if (!limiter.take(client).allowed) return fail(429, "rate_limited", "Too many voice requests. Try again in a minute.");
    const t = now();
    if (busy.has(client) || t - (lastCall.get(client) ?? -Infinity) < cooldownMs) return fail(429, "cooldown", "Please wait a moment before trying again.");

    if (!/^multipart\/form-data/i.test(request.headers.get("content-type") ?? "")) return fail(415, "unsupported_media_type", "Send audio as multipart/form-data.");
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES + 64 * 1024) return fail(413, "audio_too_large", "Recording is too long.");

    let audio: FormDataEntryValue | null;
    try { audio = (await request.formData()).get("audio"); }
    catch { return fail(400, "invalid_audio", "Could not read the recording."); }
    if (!(audio instanceof Blob)) return fail(400, "invalid_audio", "No recording was sent.");
    if (audio.size > MAX_AUDIO_BYTES) return fail(413, "audio_too_large", "Recording is too long.");
    if (audio.size < MIN_AUDIO_BYTES) return fail(400, "empty_audio", "Didn't catch that. Try again.");
    if (!AUDIO_TYPE.test(audio.type)) return fail(415, "unsupported_audio", "This audio format isn't supported.");

    if (!budget.reserve(1)) return fail(429, "budget_exhausted", "Voice input is busy right now. You can type instead.");
    busy.add(client);
    lastCall.set(client, t);

    const form = new FormData();
    form.append("model_id", STT_MODEL);
    form.append("tag_audio_events", "false");
    form.append("file", audio, "recording." + (audio.type.split("/")[1]?.split(";")[0] ?? "webm"));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await (dependencies.fetchImpl ?? fetch)(ELEVENLABS_STT_URL, { method: "POST", headers: { "xi-api-key": apiKey }, body: form, signal: controller.signal });
      } catch (error) {
        return error instanceof Error && error.name === "AbortError"
          ? fail(504, "stt_timeout", "Transcription took too long. You can type instead.")
          : fail(502, "stt_unavailable", "Voice input is unavailable. You can type instead.");
      }
      if (response.status === 401 || response.status === 403) return fail(502, "stt_not_configured", "Voice input isn't set up correctly. You can type instead.");
      if (response.status === 429) return fail(429, "stt_rate_limited", "Voice input is busy right now. You can type instead.");
      if (!response.ok) return fail(502, "stt_unavailable", "Voice input is unavailable. You can type instead.");
      let body: unknown;
      try { body = await response.json(); } catch { return fail(502, "stt_unavailable", "Voice input is unavailable. You can type instead."); }
      const text = typeof (body as { text?: unknown })?.text === "string" ? (body as { text: string }).text.replace(/\s+/g, " ").trim().slice(0, MAX_TRANSCRIPT_CHARS) : "";
      if (!text) return fail(422, "empty_transcript", "Didn't catch that. Try again or type instead.");
      const language = (body as { language_code?: unknown }).language_code;
      return json({ text, language: typeof language === "string" ? language.slice(0, 8) : null });
    } finally {
      clearTimeout(timer);
      busy.delete(client);
    }
  }

  return { GET, POST };
}
