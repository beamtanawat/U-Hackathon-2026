import assert from "node:assert/strict";
import test from "node:test";

import type { JevVerificationRequest, UsageEvent } from "../../lib/ai/types.ts";

const request: JevVerificationRequest = {
  context: {
    financialStatus: "review",
    financialReasonCodes: ["buffer_reduced"],
    trustStatus: "unknown",
    trustIndicators: [],
    missingFields: ["recipientHistory"],
    walletType: "crypto",
    transferMode: "on_chain",
    asset: "USDC",
    network: "avalanche",
    recipientKnown: false,
    recipientProvenance: "simulated",
  },
  qwenSuggestedEscalation: true,
  qwenIndicators: [],
};

test("uses the Jev 1.14 Decisions API and records privacy-safe usage", async () => {
  const { createOpenRouterJevProvider } = await import("../../lib/ai/jev.ts");
  let url = "";
  let body: Record<string, unknown> = {};
  const events: UsageEvent[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    url = String(input);
    body = JSON.parse(String(init?.body));
    return Response.json({
      model: "typesafe/jev-1.14-20261014",
      answers: { needs_review: { type: "noul", noul: 0.8 } },
      usage: { input_tokens: 42, output_tokens: 3, cost: 0.0000018 },
    });
  };

  const result = await createOpenRouterJevProvider({ apiKey: "test-key", fetchImpl, onUsage: (event) => events.push(event) })
    .verify(request, new AbortController().signal);

  assert.equal(url, "https://openrouter.ai/api/alpha/decisions");
  assert.equal(body.model, "typesafe/jev-1.14");
  assert.deepEqual(result, { model: "typesafe/jev-1.14", provider: "openrouter", decisionStatus: "completed", reviewProbability: 0.8, suggestedEscalation: true });
  assert.deepEqual(events, [{ provider: "openrouter", model: "typesafe/jev-1.14", inputTokens: 42, outputTokens: 3, totalTokens: 45, costUsd: 0.0000018 }]);
  assert.doesNotMatch(JSON.stringify(events), /recipientHistory|USDC|avalanche/i);
});

test("does not retry Jev failures", async () => {
  const { createOpenRouterJevProvider } = await import("../../lib/ai/jev.ts");
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls += 1; return new Response("private error", { status: 503 }); };
  const provider = createOpenRouterJevProvider({ apiKey: "test-key", fetchImpl });

  await assert.rejects(provider.verify(request, new AbortController().signal), /HTTP 503/);
  assert.equal(calls, 1);
});

test("rejects a Jev response with missing model attribution", async () => {
  const { createOpenRouterJevProvider } = await import("../../lib/ai/jev.ts");
  const fetchImpl: typeof fetch = async () => Response.json({
    answers: { needs_review: { type: "noul", noul: 0.8 } },
    usage: { input_tokens: 42, output_tokens: 3, cost: 0.0000018 },
  });

  await assert.rejects(
    createOpenRouterJevProvider({ apiKey: "test-key", fetchImpl }).verify(request, new AbortController().signal),
    /model attribution/i,
  );
});
