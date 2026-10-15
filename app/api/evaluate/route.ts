import { runAiAnalysis } from "../../../lib/ai/explanation";
import { createOpenRouterJevProviderFromEnv } from "../../../lib/ai/jev";
import { createOpenRouterQwenProviderFromEnv } from "../../../lib/ai/openrouter";
import { assertAuthoritativeAssessment } from "../../../lib/ai/schema";
import type { AuthoritativeAssessment, JevProvider, Provenance, QwenProvider, TransactionContext, UsageReporter } from "../../../lib/ai/types";

export interface EvaluationRequest {
  financialContext: Record<string, unknown>;
  transaction: TransactionContext;
}

export interface AssessmentEngine {
  evaluate(request: EvaluationRequest): Promise<AuthoritativeAssessment>;
}

interface Dependencies {
  engine: AssessmentEngine;
  qwenProvider?: QwenProvider;
  jevProvider?: JevProvider;
  onUsage?: UsageReporter;
  env?: Record<string, string | undefined>;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PROVENANCE = new Set<Provenance>(["host-provided", "user-provided", "derived", "simulated", "unavailable"]);

function parseRequest(value: unknown): EvaluationRequest {
  if (!object(value) || !object(value.financialContext) || !object(value.transaction)) throw new Error("missing request fields");
  const transaction = value.transaction;
  if (transaction.walletType !== "spending" && transaction.walletType !== "crypto") throw new Error("invalid walletType");
  if (transaction.transferMode !== "u_tag" && transaction.transferMode !== "on_chain") throw new Error("invalid transferMode");
  if (typeof transaction.asset !== "string" || transaction.asset.trim() === "") throw new Error("invalid asset");
  if (transaction.network !== null && typeof transaction.network !== "string") throw new Error("invalid network");
  if (!object(transaction.recipient)) throw new Error("invalid recipient");
  const recipient = transaction.recipient;
  if (recipient.kind !== "u_tag" && recipient.kind !== "wallet") throw new Error("invalid recipient kind");
  if (recipient.known !== true && recipient.known !== false && recipient.known !== null) throw new Error("invalid recipient known state");
  if (typeof recipient.provenance !== "string" || !PROVENANCE.has(recipient.provenance as Provenance)) throw new Error("invalid recipient provenance");
  for (const field of ["identifier", "fingerprint"] as const) {
    if (recipient[field] !== undefined && typeof recipient[field] !== "string") throw new Error(`invalid recipient ${field}`);
  }
  const identifier = typeof recipient.identifier === "string" ? recipient.identifier : undefined;
  const fingerprint = typeof recipient.fingerprint === "string" ? recipient.fingerprint : undefined;
  for (const field of ["message", "rawDestination"] as const) {
    if (transaction[field] !== undefined && typeof transaction[field] !== "string") throw new Error(`invalid ${field}`);
  }
  if (transaction.availableBalance !== undefined && typeof transaction.availableBalance !== "number") throw new Error("invalid availableBalance");
  const message = typeof transaction.message === "string" ? transaction.message : undefined;
  const rawDestination = typeof transaction.rawDestination === "string" ? transaction.rawDestination : undefined;
  return {
    financialContext: { ...value.financialContext },
    transaction: {
      walletType: transaction.walletType,
      transferMode: transaction.transferMode,
      asset: transaction.asset,
      network: transaction.network,
      recipient: {
        kind: recipient.kind,
        ...(identifier === undefined ? {} : { identifier }),
        ...(fingerprint === undefined ? {} : { fingerprint }),
        known: recipient.known,
        provenance: recipient.provenance as Provenance,
      },
      ...(message === undefined ? {} : { message }),
      ...(rawDestination === undefined ? {} : { rawDestination }),
      ...(transaction.availableBalance === undefined ? {} : { availableBalance: transaction.availableBalance }),
    },
  };
}

export function createEvaluateHandler(dependencies: Dependencies): (request: Request) => Promise<Response> {
  const env = dependencies.env ?? process.env;
  const qwenProvider = dependencies.qwenProvider ?? createOpenRouterQwenProviderFromEnv(env, dependencies.onUsage);
  const jevProvider = dependencies.jevProvider ?? createOpenRouterJevProviderFromEnv(env, dependencies.onUsage);
  return async function evaluate(request: Request): Promise<Response> {
    let body: unknown;
    try { body = await request.json(); }
    catch { return json({ error: { code: "invalid_request", message: "Request body must be valid JSON." } }, 400); }
    let input: EvaluationRequest;
    try { input = parseRequest(body); }
    catch { return json({ error: { code: "invalid_request", message: "Request body does not match the evaluation contract." } }, 400); }
    let assessment: AuthoritativeAssessment;
    try {
      assessment = await dependencies.engine.evaluate(input);
      assertAuthoritativeAssessment(assessment);
    }
    catch { return json({ error: { code: "assessment_unavailable", message: "The authoritative assessment could not be produced." } }, 503); }
    let analysis;
    try {
      analysis = await runAiAnalysis(
        { assessment, transaction: input.transaction },
        { qwenProvider, jevProvider },
      );
    } catch {
      return json({ error: { code: "assessment_unavailable", message: "The authoritative assessment could not be produced." } }, 503);
    }
    const { authoritativeAssessment, ...ai } = analysis;
    return json({ assessment: authoritativeAssessment, ai });
  };
}

export async function POST(_request: Request): Promise<Response> {
  return json({ error: { code: "engine_unavailable", message: "The authoritative assessment engine is not connected." } }, 503);
}
