import { createCryptoDetailsHandler } from "../../../lib/market/crypto-details-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createCryptoDetailsHandler();

export const GET = (request: Request) => handler(request);
