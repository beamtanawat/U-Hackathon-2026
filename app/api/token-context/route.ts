import { createTokenContextHandler } from "../../../lib/market/token-context-handler";

// Server-only: TOKENOMIST_API_KEY is read from process.env and never sent to the browser.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createTokenContextHandler();
