import { describe, expect, it, vi } from "vitest";

import { createCryptoDetailsHandler } from "../../lib/market/crypto-details-handler";

const TOKEN_KEY = "test-tokenomist-key";
const PRICE_KEY = "test-coingecko-key";
const live = {
  TOKENOMIST_MODE: "live",
  TOKENOMIST_API_KEY: TOKEN_KEY,
  COINGECKO_MODE: "live",
  COINGECKO_API_KEY: PRICE_KEY,
};
const request = (symbols = "USDC,ARB") => new Request(`http://localhost/api/crypto-details?symbols=${symbols}`, { headers: { "x-forwarded-for": "203.0.113.30" } });
const market = [
  { id: "usd-coin", symbol: "usdc", current_price: 1, high_24h: 1.01, low_24h: 0.99, price_change_24h: 0.001, price_change_percentage_24h: 0.1, price_change_percentage_1h_in_currency: -0.02, price_change_percentage_7d_in_currency: 0.05, sparkline_in_7d: { price: [0.999, 1, 1.001] }, last_updated: "2026-10-16T05:00:00Z", market_cap: 99_000 },
  { id: "arbitrum", symbol: "arb", current_price: 0.82, high_24h: 0.87, low_24h: 0.8, price_change_24h: -0.03, price_change_percentage_24h: -3.53, price_change_percentage_1h_in_currency: 0.2, price_change_percentage_7d_in_currency: 4.8, sparkline_in_7d: { price: [0.76, 0.79, 0.82] }, last_updated: "2026-10-16T05:00:00Z", market_cap: 4_200_000_000 },
];
const unlocks = {
  status: true,
  metadata: { credit: { used: 2, limit: 100 } },
  data: [{ tokenId: "arbitrum", tokenSymbol: "ARB", releasedPercentage: 44, upcomingEvent: { unlockDate: "2026-11-16T00:00:00Z", cliffUnlocks: { cliffAmount: 92_000_000, cliffValue: 75_440_000, valueToMarketCap: 1.8, allocationBreakdown: [{ allocationName: "Team", standardAllocationName: "founderTeam", cliffAmount: 60_000_000 }] }, latestUpdateDate: "2026-10-15T00:00:00Z" } }],
};

describe("GET /api/crypto-details (mocked CoinGecko + Tokenomist)", () => {
  it("is disabled by default and makes no provider calls", async () => {
    const fetchImpl = vi.fn();
    const response = await createCryptoDetailsHandler({ env: {}, fetchImpl })(request());
    expect((await response.json()).status).toBe("disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("batches price and upcoming-unlock data, strips unrelated fields, and keeps USDC not covered", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("coingecko")) {
        expect((init?.headers as Record<string, string>)["x-cg-demo-api-key"]).toBe(PRICE_KEY);
        return Response.json(market);
      }
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe(TOKEN_KEY);
      return Response.json(unlocks);
    });
    const response = await createCryptoDetailsHandler({ env: live, fetchImpl })(request());
    const text = await response.text();
    const body = JSON.parse(text);

    expect(body.status).toBe("ok");
    expect(body.currency).toBe("usd");
    expect(body.tokens.ARB.market).toMatchObject({ status: "ok", priceUsd: 0.82, change24hUsd: -0.03, change24hPct: -3.53, change7dPct: 4.8, sparkline7d: [0.76, 0.79, 0.82] });
    expect(body.tokens.ARB.unlock).toMatchObject({ status: "ok", date: "2026-11-16T00:00:00Z", amount: 92_000_000, valueToMarketCapPct: 1.8, allocations: [{ name: "Team", amount: 60_000_000 }] });
    expect(body.tokens.USDC.unlock.status).toBe("not_covered");
    expect(text).not.toMatch(/market_cap|releasedPercentage|cliffValue|credit|test-tokenomist|test-coingecko/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("serves the available provider when the other one fails", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => String(input).includes("coingecko") ? Response.json(market) : new Response("provider detail", { status: 503 }));
    const text = await (await createCryptoDetailsHandler({ env: live, fetchImpl })(request("ARB"))).text();
    const body = JSON.parse(text);
    expect(body.status).toBe("partial");
    expect(body.tokens.ARB.market.status).toBe("ok");
    expect(body.tokens.ARB.unlock.status).toBe("unavailable");
    expect(text).not.toContain("provider detail");
  });

  it("caches both batched providers and rejects unsupported symbols before any call", async () => {
    let now = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => Response.json(String(input).includes("coingecko") ? market : unlocks));
    const handler = createCryptoDetailsHandler({ env: live, fetchImpl, now: () => now });
    await handler(request());
    now += 4 * 60_000;
    await handler(request("ARB"));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const bad = await handler(request("BTC"));
    expect(bad.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  describe("CoinGecko API tier and failures", () => {
    const priceOnly = (extra: Record<string, string>) => ({ COINGECKO_MODE: "live", COINGECKO_API_KEY: PRICE_KEY, ...extra });
    const marketFetch = (impl: () => Promise<Response>) => vi.fn(async (input: string | URL | Request, init?: RequestInit) => { void input; void init; return impl(); });

    it.each([
      ["demo (default)", {}, "https://api.coingecko.com/api/v3/coins/markets?", "x-cg-demo-api-key"],
      ["demo", { COINGECKO_API_TIER: "demo" }, "https://api.coingecko.com/api/v3/coins/markets?", "x-cg-demo-api-key"],
      ["pro", { COINGECKO_API_TIER: "pro" }, "https://pro-api.coingecko.com/api/v3/coins/markets?", "x-cg-pro-api-key"],
    ])("%s tier uses the matching host and header and returns prices with a 7-day chart", async (_label, extra, host, header) => {
      const fetchImpl = marketFetch(async () => Response.json(market));
      const text = await (await createCryptoDetailsHandler({ env: priceOnly(extra), fetchImpl })(request())).text();
      const body = JSON.parse(text);
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(url.startsWith(host)).toBe(true);
      expect(url).not.toContain(PRICE_KEY);
      expect(init.headers as Record<string, string>).toEqual({ [header]: PRICE_KEY, accept: "application/json" });
      expect(body.tokens.ARB.market).toMatchObject({ status: "ok", priceUsd: 0.82, sparkline7d: [0.76, 0.79, 0.82] });
      expect(body.tokens.USDC.market.priceUsd).toBe(1);
      expect(text).not.toContain(PRICE_KEY);
    });

    it.each([
      [401, "auth_failed"], [403, "auth_failed"], [400, "auth_failed"], [429, "rate_limited"], [500, "upstream_http"],
    ])("maps HTTP %i to %s without inventing prices or leaking the key", async (status, reason) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetchImpl = marketFetch(async () => Response.json({ status: { error_message: "secret detail" } }, { status }));
      const text = await (await createCryptoDetailsHandler({ env: priceOnly({}), fetchImpl })(request())).text();
      const body = JSON.parse(text);
      expect(body.tokens.ARB.market).toEqual({ status: "unavailable", reason });
      expect(text).not.toMatch(/priceUsd|secret detail/);
      const logged = warn.mock.calls.flat().join(" ");
      expect(logged).toContain(reason);
      expect(logged).toContain(`HTTP ${status}`);
      expect(logged).not.toContain(PRICE_KEY);
      warn.mockRestore();
    });

    it("maps a timeout and an invalid body", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const timeout = marketFetch(async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); });
      expect((await (await createCryptoDetailsHandler({ env: priceOnly({}), fetchImpl: timeout })(request())).json()).tokens.ARB.market.reason).toBe("timeout");
      const invalid = marketFetch(async () => Response.json({ not: "an array" }));
      expect((await (await createCryptoDetailsHandler({ env: priceOnly({}), fetchImpl: invalid })(request())).json()).tokens.ARB.market.reason).toBe("invalid_response");
      warn.mockRestore();
    });

    it("rejects an unknown tier without calling CoinGecko", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetchImpl = vi.fn();
      const body = await (await createCryptoDetailsHandler({ env: priceOnly({ COINGECKO_API_TIER: "enterprise" }), fetchImpl })(request())).json();
      expect(body.tokens.ARB.market.reason).toBe("misconfigured");
      expect(fetchImpl).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it("keeps the 5-minute cache: one upstream call for repeated requests", async () => {
      let t = 0;
      const fetchImpl = marketFetch(async () => Response.json(market));
      const handler = createCryptoDetailsHandler({ env: priceOnly({ COINGECKO_API_TIER: "pro" }), fetchImpl, now: () => t });
      await handler(request()); t += 4 * 60_000; await handler(request());
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      t += 2 * 60_000; await handler(request());
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
  });
});
