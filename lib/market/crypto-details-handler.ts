import { clientKey, createRateLimiter } from "../api/guards";

const COINGECKO_URL = "https://api.coingecko.com/api/v3/coins/markets";
const TOKENOMIST_UPCOMING_URL = "https://api.tokenomist.ai/v5/unlock/events/upcoming?page=1&pageSize=250";
const MARKET_TTL_MS = 5 * 60_000;
const UNLOCK_TTL_MS = 6 * 3_600_000;
const PROVIDER_TIMEOUT_MS = 5_000;

export const CRYPTO_IDS: Record<string, string> = {
  USDC: "usd-coin",
  ARB: "arbitrum",
  OP: "optimism",
  SUI: "sui",
  APT: "aptos",
  STRK: "starknet",
  TIA: "celestia",
  ENA: "ethena",
};

type ProviderStatus = "ok" | "disabled" | "unavailable";
type MarketEntry = {
  status: "ok";
  priceUsd: number;
  change24hUsd: number | null;
  change1hPct: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  high24hUsd: number | null;
  low24hUsd: number | null;
  sparkline7d: number[];
  updatedAt: string | null;
};
type UnlockEntry = {
  status: "ok";
  date: string;
  amount: number | null;
  valueToMarketCapPct: number | null;
  allocations: Array<{ name: string; amount: number | null }>;
  updatedAt: string | null;
};

export interface CryptoDetailsDependencies {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  rateLimit?: { limit: number; windowMs: number };
}

const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const date = (value: unknown): string | null => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": status === 200 ? "public, s-maxage=300, stale-while-revalidate=3600" : "no-store" } });

async function timedFetch(fetchImpl: typeof fetch, url: string, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try { return await fetchImpl(url, { headers, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

export function createCryptoDetailsHandler(dependencies: CryptoDetailsDependencies = {}) {
  const env = dependencies.env ?? process.env;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? Date.now;
  const limiter = createRateLimiter({ ...(dependencies.rateLimit ?? { limit: 30, windowMs: 60_000 }), now });
  let marketCache: { at: number; entries: Record<string, MarketEntry> } | null = null;
  let unlockCache: { at: number; entries: Record<string, UnlockEntry> } | null = null;
  let marketInflight: Promise<Record<string, MarketEntry>> | null = null;
  let unlockInflight: Promise<Record<string, UnlockEntry>> | null = null;

  async function markets(): Promise<{ status: ProviderStatus; entries: Record<string, MarketEntry> }> {
    const key = env.COINGECKO_API_KEY;
    if (env.COINGECKO_MODE !== "live" || !key) return { status: "disabled", entries: {} };
    const time = now();
    if (marketCache && time - marketCache.at < MARKET_TTL_MS) return { status: "ok", entries: marketCache.entries };
    if (!marketInflight) {
      const query = new URLSearchParams({ ids: Object.values(CRYPTO_IDS).join(","), vs_currency: "usd", sparkline: "true", price_change_percentage: "1h,24h,7d", precision: "full" });
      marketInflight = timedFetch(fetchImpl, `${COINGECKO_URL}?${query}`, { "x-cg-demo-api-key": key, accept: "application/json" }).then(async (response) => {
        if (!response.ok) throw new Error("market_unavailable");
        const body: unknown = await response.json();
        if (!Array.isArray(body)) throw new Error("invalid_market_response");
        const entries: Record<string, MarketEntry> = {};
        for (const raw of body) {
          if (!raw || typeof raw !== "object") continue;
          const item = raw as Record<string, unknown>;
          const symbol = Object.keys(CRYPTO_IDS).find((candidate) => CRYPTO_IDS[candidate] === item.id && candidate.toLowerCase() === String(item.symbol).toLowerCase());
          const priceUsd = finite(item.current_price);
          if (!symbol || priceUsd === null || priceUsd < 0) continue;
          const sparkline = (item.sparkline_in_7d as { price?: unknown } | undefined)?.price;
          entries[symbol] = {
            status: "ok", priceUsd,
            change24hUsd: finite(item.price_change_24h),
            change1hPct: finite(item.price_change_percentage_1h_in_currency),
            change24hPct: finite(item.price_change_percentage_24h),
            change7dPct: finite(item.price_change_percentage_7d_in_currency),
            high24hUsd: finite(item.high_24h), low24hUsd: finite(item.low_24h),
            sparkline7d: Array.isArray(sparkline) ? sparkline.map(finite).filter((v): v is number => v !== null).slice(-200) : [],
            updatedAt: date(item.last_updated),
          };
        }
        marketCache = { at: now(), entries };
        return entries;
      }).finally(() => { marketInflight = null; });
    }
    try { return { status: "ok", entries: await marketInflight }; }
    catch { return marketCache ? { status: "ok", entries: marketCache.entries } : { status: "unavailable", entries: {} }; }
  }

  async function unlocks(): Promise<{ status: ProviderStatus; entries: Record<string, UnlockEntry> }> {
    const key = env.TOKENOMIST_API_KEY;
    if (env.TOKENOMIST_MODE !== "live" || !key) return { status: "disabled", entries: {} };
    const time = now();
    if (unlockCache && time - unlockCache.at < UNLOCK_TTL_MS) return { status: "ok", entries: unlockCache.entries };
    if (!unlockInflight) {
      unlockInflight = timedFetch(fetchImpl, TOKENOMIST_UPCOMING_URL, { "x-api-key": key, accept: "application/json" }).then(async (response) => {
        if (!response.ok) throw new Error("unlock_unavailable");
        const body = await response.json() as { status?: unknown; data?: unknown };
        if (body.status !== true || !Array.isArray(body.data)) throw new Error("invalid_unlock_response");
        const entries: Record<string, UnlockEntry> = {};
        for (const raw of body.data) {
          if (!raw || typeof raw !== "object") continue;
          const item = raw as Record<string, unknown>;
          const symbol = String(item.tokenSymbol ?? "").toUpperCase();
          if (!CRYPTO_IDS[symbol] || entries[symbol]) continue;
          const event = item.upcomingEvent as Record<string, unknown> | undefined;
          const unlockDate = date(event?.unlockDate);
          if (!event || !unlockDate) continue;
          const cliff = event.cliffUnlocks as Record<string, unknown> | undefined;
          const allocationBreakdown = cliff?.allocationBreakdown;
          const allocations = Array.isArray(allocationBreakdown) ? allocationBreakdown.slice(0, 5).map((allocation) => {
            const row = allocation && typeof allocation === "object" ? allocation as Record<string, unknown> : {};
            return { name: typeof row.allocationName === "string" ? row.allocationName.slice(0, 80) : "Allocation", amount: finite(row.cliffAmount) };
          }) : [];
          entries[symbol] = { status: "ok", date: unlockDate, amount: finite(cliff?.cliffAmount), valueToMarketCapPct: finite(cliff?.valueToMarketCap), allocations, updatedAt: date(event.latestUpdateDate) };
        }
        unlockCache = { at: now(), entries };
        return entries;
      }).finally(() => { unlockInflight = null; });
    }
    try { return { status: "ok", entries: await unlockInflight }; }
    catch { return unlockCache ? { status: "ok", entries: unlockCache.entries } : { status: "unavailable", entries: {} }; }
  }

  return async function cryptoDetails(request: Request): Promise<Response> {
    if (!limiter.take(clientKey(request)).allowed) return json({ error: { code: "rate_limited", message: "Too many requests." } }, 429);
    const raw = new URL(request.url).searchParams.get("symbols") ?? "";
    const symbols = [...new Set(raw.toUpperCase().split(",").map((value) => value.trim()).filter(Boolean))];
    if (!symbols.length || symbols.length > Object.keys(CRYPTO_IDS).length || symbols.some((symbol) => !CRYPTO_IDS[symbol])) {
      return json({ error: { code: "unsupported_symbol", message: "Only demo wallet tokens are supported." } }, 400);
    }
    const [market, unlock] = await Promise.all([markets(), unlocks()]);
    const anyOk = market.status === "ok" || unlock.status === "ok";
    const status = market.status === "disabled" && unlock.status === "disabled" ? "disabled"
      : anyOk && market.status === "ok" && unlock.status === "ok" ? "ok"
      : anyOk ? "partial" : "unavailable";
    const tokens = Object.fromEntries(symbols.map((symbol) => [symbol, {
      symbol,
      market: market.entries[symbol] ?? { status: market.status === "ok" ? "not_covered" : market.status },
      unlock: unlock.entries[symbol] ?? { status: unlock.status === "ok" ? "not_covered" : unlock.status },
    }]));
    return json({ status, currency: "usd", sources: { market: "CoinGecko", unlocks: "Tokenomist" }, tokens });
  };
}
