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
});
