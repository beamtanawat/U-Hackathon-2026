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
// status/data/metadata follow docs.tokenomist.ai Token List v5; credit is optional and may be absent.
console.log("status:", body.status, "| tokens returned:", body.data.length, "| metadata keys:", Object.keys(body.metadata ?? {}).join(",") || "none");
const covered = body.data.map((t) => ({ id: t.id, symbol: t.symbol, name: t.name, lastUpdatedDate: t.lastUpdatedDate }));
console.log("covered:", JSON.stringify(covered));
console.log("not returned:", JSON.stringify(ids.filter((id) => !covered.some((t) => t.id === id))));
console.log("credit:", JSON.stringify(body.metadata?.credit ?? null), body.metadata?.credit ? "" : "(field absent; optional per docs)");
