import { clientKey, createRateLimiter } from "../api/guards";
import { fetchTokenList, TokenomistError, type TokenContext } from "./tokenomist";

/**
 * GET /api/token-context?symbol=USDC
 *
 * Off unless TOKENOMIST_MODE=live and TOKENOMIST_API_KEY are both set.
 * Only allow-listed demo symbols are looked up; results are cached for hours
 * in memory and at the CDN, calls are capped per day, quota errors pause
 * calls until the reset time, and no price or FX value is ever returned.
 */

/**
 * Demo holdings → candidate Tokenomist slugs. Coverage check on 2026-10-16:
 * the Token List call returned HTTP 200 with an empty data array for
 * "usd-coin,usdc", and tokenomist.ai/usd-coin and /usdc are 404 while a known
 * slug (/0x) resolves. USDC (a stablecoin with no vesting) is not tracked, so
 * the endpoint answers "not_covered" and the UI shows nothing.
 */
export const DEMO_TOKENS: Record<string, string[]> = { USDC: ["usd-coin", "usdc"] };

const HOUR = 3_600_000;
export const TOKEN_CONTEXT_TTL_MS = 6 * HOUR;
/** A token Tokenomist does not track is re-checked at most daily to save credits. */
export const NOT_COVERED_TTL_MS = 24 * HOUR;
const ERROR_COOLDOWN_MS = 5 * 60_000;

type Status = "ok" | "not_covered" | "disabled" | "stale" | "unavailable";
interface Entry { value: TokenContext | null; fetchedAt: number }

export interface TokenContextDependencies {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  maxCallsPerDay?: number;
  rateLimit?: { limit: number; windowMs: number };
}

function json(body: unknown, status: number, cacheSeconds: number): Response {
  const cache = cacheSeconds > 0 ? `public, s-maxage=${cacheSeconds}, stale-while-revalidate=86400` : "no-store";
  return Response.json(body, { status, headers: { "Cache-Control": cache } });
}

export function createTokenContextHandler(dependencies: TokenContextDependencies = {}) {
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? Date.now;
  const limiter = createRateLimiter({ ...(dependencies.rateLimit ?? { limit: 30, windowMs: 60_000 }), now });
  const maxCallsPerDay = dependencies.maxCallsPerDay ?? (Number(env.TOKENOMIST_MAX_CALLS_PER_DAY) || 24);
  const cache = new Map<string, Entry>();
  const inflight = new Map<string, Promise<Entry>>();
  let pausedUntil = 0;
  let pauseReason = "";
  let day = { start: now(), calls: 0 };

  const respond = (status: Status, symbol: string, extra: Record<string, unknown> = {}, cacheSeconds = 0) =>
    json({ status, symbol, source: "Tokenomist", kind: "tokenomics, not a price", ...extra }, 200, cacheSeconds);
  const fromEntry = (status: Status, symbol: string, entry: Entry, cacheSeconds: number) =>
    entry.value
      ? respond(status, symbol, { token: entry.value, fetchedAt: new Date(entry.fetchedAt).toISOString() }, cacheSeconds)
      : respond(status === "stale" ? "stale" : "not_covered", symbol, { fetchedAt: new Date(entry.fetchedAt).toISOString() }, cacheSeconds);

  return async function tokenContext(request: Request): Promise<Response> {
    const slot = limiter.take(clientKey(request));
    if (!slot.allowed) return json({ error: { code: "rate_limited", message: "Too many requests." } }, 429, 0);

    const symbol = (new URL(request.url).searchParams.get("symbol") ?? "").toUpperCase();
    const candidates = DEMO_TOKENS[symbol];
    if (!candidates) return json({ error: { code: "unsupported_symbol", message: "Only demo wallet tokens are supported." } }, 400, 0);

    const apiKey = env.TOKENOMIST_API_KEY;
    if (env.TOKENOMIST_MODE !== "live" || !apiKey) return respond("disabled", symbol, {}, 300);

    const t = now();
    const cached = cache.get(symbol);
    if (cached && t - cached.fetchedAt < (cached.value ? TOKEN_CONTEXT_TTL_MS : NOT_COVERED_TTL_MS)) return fromEntry(cached.value ? "ok" : "not_covered", symbol, cached, 21_600);

    if (t < pausedUntil) {
      return cached ? fromEntry("stale", symbol, cached, 0) : respond("unavailable", symbol, { reason: pauseReason });
    }
    if (t - day.start >= 24 * HOUR) day = { start: t, calls: 0 };
    if (day.calls >= maxCallsPerDay) {
      return cached ? fromEntry("stale", symbol, cached, 0) : respond("unavailable", symbol, { reason: "daily_budget_exhausted" });
    }

    let pending = inflight.get(symbol);
    if (!pending) {
      day.calls += 1;
      pending = fetchTokenList(candidates, { apiKey, fetchImpl: dependencies.fetchImpl })
        .then((result) => {
          const match = result.tokens.find((token) => token.symbol.toUpperCase() === symbol) ?? null;
          const entry = { value: match, fetchedAt: now() };
          cache.set(symbol, entry);
          return entry;
        })
        .finally(() => inflight.delete(symbol));
      inflight.set(symbol, pending);
    }

    try {
      const entry = await pending;
      return fromEntry(entry.value ? "ok" : "not_covered", symbol, entry, 21_600);
    } catch (error) {
      const code = error instanceof TokenomistError ? error.code : "upstream_error";
      if (code === "quota_exhausted") {
        const reset = error instanceof TokenomistError && error.resetAt ? Date.parse(error.resetAt) : NaN;
        pausedUntil = Number.isFinite(reset) && reset > t ? reset : t + HOUR;
      } else {
        pausedUntil = t + (code === "unauthorized" ? HOUR : ERROR_COOLDOWN_MS);
      }
      pauseReason = code === "unauthorized" ? "not_configured" : code;
      return cached ? fromEntry("stale", symbol, cached, 0) : respond("unavailable", symbol, { reason: pauseReason });
    }
  };
}
