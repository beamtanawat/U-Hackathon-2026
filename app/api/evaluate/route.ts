import { createEvaluateHandler } from "../../../lib/api/evaluate-handler";

// Simulation only: evaluates a proposed payment; never moves money.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createEvaluateHandler();
