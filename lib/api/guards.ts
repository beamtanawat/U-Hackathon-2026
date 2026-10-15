/** Request-size, rate and paid-AI budget controls for POST /api/evaluate. */

export const MAX_BODY_BYTES = 8 * 1024;

export class RequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/** Reads at most MAX_BODY_BYTES; stops streaming as soon as the cap is exceeded. */
export async function readJsonBody(request: Request, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) throw new RequestError(415, "unsupported_media_type", "Content-Type must be application/json.");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestError(413, "payload_too_large", `Request body must be at most ${maxBytes} bytes.`);
  if (!request.body) throw new RequestError(400, "invalid_request", "Request body must be valid JSON.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new RequestError(413, "payload_too_large", `Request body must be at most ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new RequestError(400, "invalid_request", "Request body must be valid JSON."); }
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "anonymous";
}

/**
 * Fixed-window limiter. In-memory, so on serverless it is per instance: it
 * bounds abuse of one warm instance, not global traffic.
 */
export function createRateLimiter(options: { limit: number; windowMs: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();
  return {
    take(key: string): { allowed: boolean; retryAfterSeconds: number } {
      const time = now();
      if (windows.size > 10_000) for (const [k, w] of windows) if (time - w.start >= options.windowMs) windows.delete(k);
      const current = windows.get(key);
      if (!current || time - current.start >= options.windowMs) {
        windows.set(key, { start: time, count: 1 });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      if (current.count >= options.limit) {
        return { allowed: false, retryAfterSeconds: Math.ceil((current.start + options.windowMs - time) / 1000) };
      }
      current.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

/** Caps paid provider calls per hour (per instance). Calls are reserved before they run. */
export function createAiBudget(options: { maxCallsPerHour: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  let windowStart = now();
  let used = 0;
  return {
    reserve(calls: number): boolean {
      const time = now();
      if (time - windowStart >= 3_600_000) { windowStart = time; used = 0; }
      if (calls === 0) return true;
      if (used + calls > options.maxCallsPerHour) return false;
      used += calls;
      return true;
    },
  };
}

export type AiMode = "disabled" | "live" | "budget_exhausted" | "client_opt_out";

/** Paid AI runs only when AI_MODE=live and a key is configured. The default is disabled. */
export function aiEnabledByEnv(env: Record<string, string | undefined>): boolean {
  return env.AI_MODE === "live" && Boolean(env.OPENROUTER_API_KEY);
}
