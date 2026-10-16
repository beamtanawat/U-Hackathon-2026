import assert from "node:assert/strict";
import { test } from "vitest";

import { createOpenRouterQwenProvider, createOpenRouterQwenProviderFromEnv, OpenRouterError } from "../../lib/ai/openrouter";
import type { ProviderRequest, UsageEvent } from "../../lib/ai/types";

const request: ProviderRequest = {
  system: "Review only supplied evidence.",
  context: {
    financialStatus: "review", financialReasonCodes: ["buffer_reduced"],
    trustStatus: "high", trustIndicators: [{ id: "signal-urgency", kind: "urgency", provenance: "user_provided" }],
    missingFields: [], walletType: "crypto", transferMode: "on_chain", asset: "USDC", network: "avalanche", recipientKnown: false, recipientProvenance: "simulated",
  },
};

test("sends the default Qwen model with bearer auth and strict structured output", async () => {
  let capturedUrl = ""; let capturedInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (input, init) => { capturedUrl = String(input); capturedInit = init; return Response.json({ model: "qwen/qwen3.5-9b", choices: [{ message: { content: "{\"reviewStatus\":\"completed\"}" } }] }); };
  const provider = createOpenRouterQwenProvider({ apiKey: "test-key", fetchImpl });
  await provider.analyze(request, new AbortController().signal);
  assert.equal(capturedUrl, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(new Headers(capturedInit?.headers).get("authorization"), "Bearer test-key");
  const body = JSON.parse(String(capturedInit?.body));
  assert.equal(body.model, "qwen/qwen3.5-9b");
  assert.equal(body.max_completion_tokens, 350);
  assert.equal(body.response_format.type, "json_schema"); assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.provider.require_parameters, true);
  assert.equal(body.provider.allow_fallbacks, false);
  assert.equal(body.stream, false);
});

test("does not permit model substitution", async () => {
  let model = "";
  const fetchImpl: typeof fetch = async (_input, init) => { model = JSON.parse(String(init?.body)).model; return Response.json({ model: "qwen/qwen3.5-9b", choices: [{ message: { content: "{}" } }] }); };
  await createOpenRouterQwenProvider({ apiKey: "test-key", fetchImpl }).analyze(request, new AbortController().signal);
  assert.equal(model, "qwen/qwen3.5-9b");
});

test("returns only the assistant message content", async () => {
  const fetchImpl: typeof fetch = async () => Response.json({ model: "qwen/qwen3.5-9b", choices: [{ message: { content: "{\"ok\":true}" } }] });
  assert.equal(await createOpenRouterQwenProvider({ apiKey: "test-key", fetchImpl }).analyze(request, new AbortController().signal), "{\"ok\":true}");
});

test("rejects a response that reports a different model", async () => {
  const fetchImpl: typeof fetch = async () => Response.json({
    model: "another/model",
    choices: [{ message: { content: JSON.stringify({ ...request, model: "another/model" }) } }],
  });
  const provider = createOpenRouterQwenProvider({ apiKey: "test-key", fetchImpl });

  await assert.rejects(provider.analyze(request, new AbortController().signal), /unexpected model/i);
});

test("rejects a response with missing model attribution", async () => {
  const fetchImpl: typeof fetch = async () => Response.json({ choices: [{ message: { content: "{}" } }] });
  const provider = createOpenRouterQwenProvider({ apiKey: "test-key", fetchImpl });

  await assert.rejects(provider.analyze(request, new AbortController().signal), /model attribution/i);
});

test("stamps reviewer metadata from the configured transport instead of trusting model text", async () => {
  const fetchImpl: typeof fetch = async () => Response.json({
    model: "qwen/qwen3.5-9b",
    choices: [{ message: { content: JSON.stringify({ explanation: {}, review: { model: "another/model", provider: "other", reviewStatus: "skipped" } }) } }],
  });
  const provider = createOpenRouterQwenProvider({ apiKey: "test-key", fetchImpl });

  const output = JSON.parse(await provider.analyze(request, new AbortController().signal));
  assert.equal(output.review.model, "qwen/qwen3.5-9b");
  assert.equal(output.review.provider, "openrouter");
  assert.equal(output.review.reviewStatus, "completed");
});

for (const status of [401, 429, 503]) {
  test(`reports OpenRouter HTTP ${status} without response-body or key leakage`, async () => {
    const fetchImpl: typeof fetch = async () => new Response("secret provider details", { status });
    const provider = createOpenRouterQwenProvider({ apiKey: "super-secret-key", fetchImpl });
    await assert.rejects(provider.analyze(request, new AbortController().signal), (error: unknown) => {
      assert.ok(error instanceof OpenRouterError); assert.equal(error.status, status);
      assert.doesNotMatch(error.message, /secret provider details|super-secret-key/); return true;
    });
  });
}

test("rejects a response with missing assistant content", async () => {
  const fetchImpl: typeof fetch = async () => Response.json({ model: "qwen/qwen3.5-9b", choices: [{ message: {} }] });
  await assert.rejects(createOpenRouterQwenProvider({ apiKey: "test-key", fetchImpl }).analyze(request, new AbortController().signal), /missing content/i);
});

test("returns no reviewer when OPENROUTER_API_KEY is absent", () => {
  assert.equal(createOpenRouterQwenProviderFromEnv({}), undefined);
});

test("records only token and cost metadata and does not retry failures", async () => {
  const events: UsageEvent[] = [];
  let calls = 0;
  const successFetch: typeof fetch = async () => Response.json({
    model: "qwen/qwen3.5-9b",
    choices: [{ message: { content: "{}" } }],
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, cost: 0.00000132 },
  });
  await createOpenRouterQwenProvider({ apiKey: "test-key", fetchImpl: successFetch, onUsage: (event) => events.push(event) }).analyze(request, new AbortController().signal);
  assert.deepEqual(events, [{ provider: "openrouter", model: "qwen/qwen3.5-9b", inputTokens: 10, outputTokens: 4, totalTokens: 14, costUsd: 0.00000132 }]);
  assert.doesNotMatch(JSON.stringify(events), /USDC|avalanche|buffer_reduced/i);

  const failingFetch: typeof fetch = async () => { calls += 1; return new Response("private", { status: 429 }); };
  await assert.rejects(createOpenRouterQwenProvider({ apiKey: "test-key", fetchImpl: failingFetch }).analyze(request, new AbortController().signal));
  assert.equal(calls, 1);
});
