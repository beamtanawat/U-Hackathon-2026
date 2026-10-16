// One-shot coverage check: makes exactly ONE Tokenomist Token List v5 call for
// the given token slugs, prints a summary and saves the public tokenomics fields
// to tokenomist-coverage.local.json (gitignored). Never prints or saves the key.
// Usage (key stays in your own shell):
//   TOKENOMIST_API_KEY=... node scripts/tokenomist-coverage.mjs arbitrum,sui
import { writeFileSync } from "node:fs";

const key = process.env.TOKENOMIST_API_KEY;
if (!key) { console.error("TOKENOMIST_API_KEY is not set in this shell."); process.exit(1); }
const ids = (process.argv[2] ?? "usd-coin,usdc").split(",").map((s) => s.trim()).filter((s) => /^[a-z0-9-]{1,64}$/.test(s));
if (ids.length === 0) { console.error("No valid token slugs given."); process.exit(1); }
const res = await fetch(`https://api.tokenomist.ai/v5/token/list?tokenId=${ids.join(",")}`, { headers: { "x-api-key": key, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
console.log("HTTP", res.status);
const body = await res.json().catch(() => null);
if (!body || !Array.isArray(body.data)) { console.log("No token data", body && body.statusCode ? `(statusCode ${body.statusCode})` : ""); process.exit(0); }
// Fields documented in Token List v5. marketCap is deliberately not kept: it is price-derived.
const FIELDS = ["id", "name", "symbol", "listedMethod", "circulatingSupply", "maxSupply", "totalLockedAmount", "tbdLockedAmount", "unlockedAmount", "untrackedAmount", "hasStandardAllocation", "hasFundraising", "latestFundraisingRound", "hasBurn", "hasBuyback", "hasCommittedClaim", "websiteUrl", "lastUpdatedDate"];
const tokens = body.data.map((t) => Object.fromEntries(FIELDS.map((f) => [f, t?.[f] ?? null])));
console.log("status:", body.status, "| tokens returned:", tokens.length);
for (const t of tokens) console.log(`  ${t.symbol} (${t.id}) locked=${t.totalLockedAmount} unlocked=${t.unlockedAmount} max=${t.maxSupply} updated=${t.lastUpdatedDate}`);
console.log("not returned:", JSON.stringify(ids.filter((id) => !tokens.some((t) => t.id === id))));
console.log("credit:", JSON.stringify(body.metadata?.credit ?? null));
writeFileSync("tokenomist-coverage.local.json", JSON.stringify({ queryDate: body.metadata?.queryDate ?? null, requested: ids, tokens }, null, 2));
console.log("saved: tokenomist-coverage.local.json");
