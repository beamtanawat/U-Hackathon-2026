import { z } from "zod";

/**
 * Server-only Tokenomist client (https://docs.tokenomist.ai).
 * Tokenomist supplies tokenomics (supply, unlocks); it is NOT a price or FX
 * source, so no price field is read or returned here.
 */
export const TOKENOMIST_BASE_URL = "https://api.tokenomist.ai";
export const TOKENOMIST_TIMEOUT_MS = 5_000;

const nullableNumber = z.number().finite().nullable().optional();

const tokenSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  symbol: z.string().min(1).max(40),
  circulatingSupply: nullableNumber,
  maxSupply: nullableNumber,
  totalLockedAmount: z.number().finite().optional(),
  unlockedAmount: z.number().finite().optional(),
  lastUpdatedDate: z.string().max(40).optional(),
});

const tokenListSchema = z.object({
  status: z.boolean(),
  data: z.array(z.unknown()).max(500),
  metadata: z
    .object({
      queryDate: z.string().optional(),
      credit: z.object({ used: z.number().optional(), limit: z.number().optional(), resetAt: z.string().optional() }).partial().optional(),
    })
    .partial()
    .optional(),
});

export interface TokenContext {
  id: string;
  name: string;
  symbol: string;
  circulatingSupply: number | null;
  maxSupply: number | null;
  lockedAmount: number | null;
  unlockedAmount: number | null;
  lastUpdated: string | null;
}

export interface TokenListResult {
  tokens: TokenContext[];
  credit: { used: number | null; limit: number | null; resetAt: string | null };
}

export type TokenomistErrorCode = "unauthorized" | "quota_exhausted" | "timeout" | "upstream_error" | "invalid_response";

export class TokenomistError extends Error {
  constructor(readonly code: TokenomistErrorCode, readonly resetAt: string | null = null) {
    // Never include the key, URL query or upstream body in the message.
    super(`Tokenomist request failed: ${code}`);
  }
}

/** One GET /v5/token/list call filtered by tokenId. No retries. */
export async function fetchTokenList(
  tokenIds: string[],
  options: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<TokenListResult> {
  const ids = tokenIds.filter((id) => /^[a-z0-9-]{1,64}$/.test(id));
  if (ids.length === 0) return { tokens: [], credit: { used: null, limit: null, resetAt: null } };
  const url = `${TOKENOMIST_BASE_URL}/v5/token/list?tokenId=${encodeURIComponent(ids.join(","))}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TOKENOMIST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, { method: "GET", headers: { "x-api-key": options.apiKey, accept: "application/json" }, signal: controller.signal });
  } catch (error) {
    throw new TokenomistError(error instanceof Error && error.name === "AbortError" ? "timeout" : "upstream_error");
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) throw new TokenomistError("unauthorized");
  if (response.status === 429) {
    // Docs: match on the status code; resetAt may be absent.
    let resetAt: string | null = null;
    try { const body = await response.json(); resetAt = typeof body?.metadata?.credit?.resetAt === "string" ? body.metadata.credit.resetAt : null; } catch { /* ignore */ }
    throw new TokenomistError("quota_exhausted", resetAt);
  }
  if (!response.ok) throw new TokenomistError("upstream_error");

  let body: unknown;
  try { body = await response.json(); } catch { throw new TokenomistError("invalid_response"); }
  const parsed = tokenListSchema.safeParse(body);
  if (!parsed.success || !parsed.data.status) throw new TokenomistError("invalid_response");

  const tokens: TokenContext[] = [];
  for (const item of parsed.data.data) {
    const token = tokenSchema.safeParse(item);
    if (!token.success) continue;
    const t = token.data;
    tokens.push({
      id: t.id,
      name: t.name,
      symbol: t.symbol,
      circulatingSupply: t.circulatingSupply ?? null,
      maxSupply: t.maxSupply ?? null,
      lockedAmount: t.totalLockedAmount ?? null,
      unlockedAmount: t.unlockedAmount ?? null,
      lastUpdated: t.lastUpdatedDate ?? null,
    });
  }
  const credit = parsed.data.metadata?.credit;
  return { tokens, credit: { used: credit?.used ?? null, limit: credit?.limit ?? null, resetAt: credit?.resetAt ?? null } };
}
