import { describe, expect, it, vi } from "vitest";

import { createTokenContextHandler } from "../../lib/market/token-context-handler";

const KEY = "test-placeholder-key";
const live = { TOKENOMIST_MODE: "live", TOKENOMIST_API_KEY: KEY };
const get = (symbol = "USDC", ip = "203.0.113.5") =>
  new Request(`http://localhost/api/token-context?symbol=${symbol}`, { headers: { "x-forwarded-for": ip } });

const okBody = {
  status: true,
  metadata: { queryDate: "2026-10-16T05:00:00Z", credit: { used: 3, limit: 1000 } },
  data: [{ id: "usd-coin", name: "USD Coin", symbol: "USDC", circulatingSupply: 1000, maxSupply: null, totalLockedAmount: 0, unlockedAmount: 1000, marketCap: 123, lastUpdatedDate: "2026-10-15T00:00:00Z" }],
};
const respond = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("GET /api/token-context (Tokenomist, server-side)", () => {
  it("is disabled by default and makes no network call, even when a key exists", async () => {
    const fetchImpl = vi.fn();
    for (const env of [{}, { TOKENOMIST_API_KEY: KEY }, { TOKENOMIST_MODE: "live" }]) {
      const body = await (await createTokenContextHandler({ env, fetchImpl })(get())).json();
      expect(body.status).toBe("disabled");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns tokenomics only (no price or market cap) and sends the key only as a header", async () => {
    const fetchImpl = respond(200, okBody);
    const response = await createTokenContextHandler({ env: live, fetchImpl })(get());
    const text = await response.text();
    const body = JSON.parse(text);

    expect(body.status).toBe("ok");
    expect(body.kind).toBe("tokenomics, not a price");
    expect(body.token).toEqual({ id: "usd-coin", name: "USD Coin", symbol: "USDC", circulatingSupply: 1000, maxSupply: null, lockedAmount: 0, unlockedAmount: 1000, lastUpdated: "2026-10-15T00:00:00Z" });
    expect(text).not.toContain(KEY);
    expect(text).not.toMatch(/"(marketCap|price|referencePrice|credit)"/);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.tokenomist.ai/v5/token/list?tokenId=usd-coin%2Cusdc");
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
    expect(response.headers.get("cache-control")).toContain("s-maxage=21600");
  });

  it("caches for hours and shares one in-flight call", async () => {
    let t = 0;
    const fetchImpl = respond(200, okBody);
    const handler = createTokenContextHandler({ env: live, fetchImpl, now: () => t });
    await Promise.all([handler(get()), handler(get("USDC", "198.51.100.1"))]);
    t += 5 * 3_600_000;
    await handler(get());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t += 2 * 3_600_000;
    await handler(get());
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects symbols outside the demo allow-list without calling Tokenomist", async () => {
    const fetchImpl = vi.fn();
    const response = await createTokenContextHandler({ env: live, fetchImpl })(get("BTC"));
    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports not_covered when Tokenomist has no matching token", async () => {
    const body = await (await createTokenContextHandler({ env: live, fetchImpl: respond(200, { status: true, data: [] }) })(get())).json();
    expect(body.status).toBe("not_covered");
    expect(body.token).toBeUndefined();
  });

  it("pauses after a 429 quota error until resetAt and makes no further calls", async () => {
    let t = Date.parse("2026-10-16T05:00:00Z");
    const fetchImpl = respond(429, { status: false, statusCode: 429, metadata: { credit: { resetAt: "2026-10-16T07:00:00Z" } } });
    const handler = createTokenContextHandler({ env: live, fetchImpl, now: () => t });
    expect((await (await handler(get())).json()).reason).toBe("quota_exhausted");
    t += 3_600_000;
    expect((await (await handler(get())).json()).status).toBe("unavailable");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t += 2 * 3_600_000;
    await handler(get());
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("serves the last good result as stale when Tokenomist later fails", async () => {
    let t = 0;
    let fail = false;
    const fetchImpl = vi.fn(async () => (fail ? new Response("down", { status: 503 }) : new Response(JSON.stringify(okBody), { status: 200 })));
    const handler = createTokenContextHandler({ env: live, fetchImpl, now: () => t });
    await handler(get());
    fail = true;
    t += 7 * 3_600_000;
    const body = await (await handler(get())).json();
    expect(body.status).toBe("stale");
    expect(body.token.symbol).toBe("USDC");
  });

  it("maps auth failure, timeout and invalid responses to unavailable without leaking details", async () => {
    const cases: Array<[typeof fetch, string]> = [
      [respond(401, { message: "bad key" }) as unknown as typeof fetch, "not_configured"],
      [vi.fn(async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }) as unknown as typeof fetch, "timeout"],
      [respond(200, { unexpected: true }) as unknown as typeof fetch, "invalid_response"],
    ];
    for (const [fetchImpl, reason] of cases) {
      const text = await (await createTokenContextHandler({ env: live, fetchImpl })(get())).text();
      expect(JSON.parse(text)).toMatchObject({ status: "unavailable", reason });
      expect(text).not.toContain(KEY);
      expect(text).not.toContain("bad key");
    }
  });

  it("enforces the daily call budget", async () => {
    let t = 0;
    const fetchImpl = respond(200, okBody);
    const handler = createTokenContextHandler({ env: live, fetchImpl, now: () => t, maxCallsPerDay: 1 });
    await handler(get());
    t += 7 * 3_600_000;
    const body = await (await handler(get())).json();
    expect(body.status).toBe("stale");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
