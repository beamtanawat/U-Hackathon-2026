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
 * Demo holdings → Tokenomist slugs. All slugs are fetched together in ONE
 * Token List call and cached, so one page load costs at most one credit.
 * Coverage check on 2026-10-16: "usd-coin,usdc" returned HTTP 200 with an
 * empty data array and tokenomist.ai/usd-coin and /usdc are 404, so USDC (a
 * stablecoin with no vesting) is not tracked. The other slugs below have a
 * public "Tokenomics & Vesting Schedule" page on tokenomist.ai.
 */
export const DEMO_TOKENS: Record<string, string[]> = {
  USDC: ["usd-coin", "usdc"],
  ARB: ["arbitrum"],
  OP: ["optimism"],
  SUI: ["sui"],
  APT: ["aptos"],
  STRK: ["starknet"],
  TIA: ["celestia"],
  ENA: ["ethena"],
};
const ALL_IDS = [...new Set(Object.values(DEMO_TOKENS).flat())];

const HOUR = 3_600_000;
export const TOKEN_CONTEXT_TTL_MS = 6 * HOUR;
/** When nothing requested is tracked, re-check at most daily to save credits. */
export const NOT_COVERED_TTL_MS = 24 * HOUR;
const ERROR_COOLDOWN_MS = 5 * 60_000;

type Status = "ok" | "not_covered" | "disabled" | "stale" | "unavailable";
interface Batch { tokens: TokenContext[]; fetchedAt: number }

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

const match = (batch: Batch, symbol: string) =>
  batch.tokens.find((t) => DEMO_TOKENS[symbol].includes(t.id) && t.symbol.toUpperCase() === symbol) ?? null;

export function createTokenContextHandler(dependencies: TokenContextDependencies = {}) {
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? Date.now;
  const limiter = createRateLimiter({ ...(dependencies.rateLimit ?? { limit: 30, windowMs: 60_000 }), now });
  const maxCallsPerDay = dependencies.maxCallsPerDay ?? (Number(env.TOKENOMIST_MAX_CALLS_PER_DAY) || 24);
  let cache: Batch | null = null;
  let inflight: Promise<Batch> | null = null;
  let pausedUntil = 0;
  let pauseReason = "";
  let day = { start: now(), calls: 0 };

  const base = { source: "Tokenomist", kind: "tokenomics, not a price" };
  /** One symbol's entry from a batch (or a status without a batch). */
  const entry = (symbol: string, status: Status, batch: Batch | null, extra: Record<string, unknown> = {}) => {
    const token = batch ? match(batch, symbol) : null;
    const s: Status = status === "ok" || status === "stale" ? (token ? status : "not_covered") : status;
    return { status: s, symbol, ...(token ? { token } : {}), ...(batch ? { fetchedAt: new Date(batch.fetchedAt).toISOString() } : {}), ...extra };
  };

  async function load(): Promise<{ status: Status; batch: Batch | null; extra?: Record<string, unknown>; cacheSeconds: number }> {
    const apiKey = env.TOKENOMIST_API_KEY;
    if (env.TOKENOMIST_MODE !== "live" || !apiKey) return { status: "disabled", batch: null, cacheSeconds: 300 };
    const t = now();
    if (cache && t - cache.fetchedAt < (cache.tokens.length ? TOKEN_CONTEXT_TTL_MS : NOT_COVERED_TTL_MS)) return { status: "ok", batch: cache, cacheSeconds: 21_600 };
    const fallback = (reason: string) => (cache ? { status: "stale" as Status, batch: cache, cacheSeconds: 0 } : { status: "unavailable" as Status, batch: null, extra: { reason }, cacheSeconds: 0 });
    if (t < pausedUntil) return fallback(pauseReason);
    if (t - day.start >= 24 * HOUR) day = { start: t, calls: 0 };
    if (!inflight && day.calls >= maxCallsPerDay) return fallback("daily_budget_exhausted");

    if (!inflight) {
      day.calls += 1;
      inflight = fetchTokenList(ALL_IDS, { apiKey, fetchImpl: dependencies.fetchImpl })
        .then((result) => (cache = { tokens: result.tokens, fetchedAt: now() }))
        .finally(() => { inflight = null; });
    }
    try {
      return { status: "ok", batch: await inflight, cacheSeconds: 21_600 };
    } catch (error) {
      const code = error instanceof TokenomistError ? error.code : "upstream_error";
      if (code === "quota_exhausted") {
        const reset = error instanceof TokenomistError && error.resetAt ? Date.parse(error.resetAt) : NaN;
        pausedUntil = Number.isFinite(reset) && reset > t ? reset : t + HOUR;
      } else {
        pausedUntil = t + (code === "unauthorized" ? HOUR : ERROR_COOLDOWN_MS);
      }
      pauseReason = code === "unauthorized" ? "not_configured" : code;
      return fallback(pauseReason);
    }
  }

  return async function tokenContext(request: Request): Promise<Response> {
    const slot = limiter.take(clientKey(request));
    if (!slot.allowed) return json({ error: { code: "rate_limited", message: "Too many requests." } }, 429, 0);

    const params = new URL(request.url).searchParams;
    const many = params.get("symbols");
    const symbols = (many ?? params.get("symbol") ?? "").toUpperCase().split(",").map((x) => x.trim()).filter(Boolean);
    if (symbols.length === 0 || symbols.length > ALL_IDS.length || symbols.some((x) => !DEMO_TOKENS[x])) {
      return json({ error: { code: "unsupported_symbol", message: "Only demo wallet tokens are supported." } }, 400, 0);
    }

    const { status, batch, extra, cacheSeconds } = await load();
    if (many === null) return json({ ...base, ...entry(symbols[0], status, batch, extra) }, 200, cacheSeconds);
    return json({ ...base, status, tokens: Object.fromEntries(symbols.map((x) => [x, entry(x, status, batch, extra)])) }, 200, cacheSeconds);
  };
}
