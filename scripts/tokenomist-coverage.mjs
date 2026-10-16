// One-shot coverage check: makes exactly ONE Tokenomist Token List call for the
// demo wallet's token slugs and prints which are covered. Never prints the key.
// Usage (key stays in your own shell):  TOKENOMIST_API_KEY=... node scripts/tokenomist-coverage.mjs
const key = process.env.TOKENOMIST_API_KEY;
if (!key) { console.error("TOKENOMIST_API_KEY is not set in this shell."); process.exit(1); }
const ids = ["usd-coin", "usdc"];
const res = await fetch(`https://api.tokenomist.ai/v5/token/list?tokenId=${ids.join(",")}`, { headers: { "x-api-key": key, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
console.log("HTTP", res.status);
const body = await res.json().catch(() => null);
if (!body || !Array.isArray(body.data)) { console.log("No token data", body && body.statusCode ? `(statusCode ${body.statusCode})` : ""); process.exit(0); }
console.log("covered:", JSON.stringify(body.data.map((t) => ({ id: t.id, symbol: t.symbol, name: t.name, lastUpdatedDate: t.lastUpdatedDate }))));
console.log("credit:", JSON.stringify(body.metadata?.credit ?? null));
