import { describe, expect, it } from "vitest";
import { GeminiExplainer, GroqExplainer } from "../src/providers/ai";
import { IntentSchema, ObservationSchema, ReconciliationSchema } from "../src/core/schemas";

const intent = IntentSchema.parse({
  id: "intent_test",
  runId: "run_test",
  provider: "bingx",
  mode: "paper",
  symbol: "BTC-USDT",
  side: "BUY",
  orderType: "LIMIT",
  quantity: "0.001",
  price: "60000",
  clientOrderId: "vq_test_order",
  createdAt: "2026-08-30T00:00:00.000Z",
});

const observation = ObservationSchema.parse({
  id: "obs_test",
  runId: "run_test",
  source: "REST",
  eventType: "ORDER_HISTORY_LOOKUP",
  receivedAt: "2026-08-30T00:00:01.000Z",
  payloadHash: "b".repeat(64),
  payload: { found: false },
});

const reconciliation = ReconciliationSchema.parse({
  id: "rec_test",
  runId: "run_test",
  intentId: "intent_test",
  verdict: "UNKNOWN_BLOCKED",
  localState: "ORDER_UNCONFIRMED",
  providerState: "NOT_FOUND",
  matchedFields: [],
  mismatchedFields: ["providerOrderState"],
  ruleResults: [{ name: "authoritative_provider_state", passed: false, detail: "No order" }],
  createdAt: "2026-08-30T00:00:02.000Z",
});

const context = { intent, observations: [observation], reconciliation };

describe("AI explainers", () => {
  it("validates Gemini JSON output", async () => {
    const explainer = new GeminiExplainer("key", "gemini-2.5-flash", async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      headline: "Retry blocked",
                      explanation: "The provider did not return authoritative order state.",
                      nextAction: "Inspect the provider account before continuing.",
                      evidenceIds: ["obs_test"],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(explainer.explain(context)).resolves.toMatchObject({ headline: "Retry blocked" });
  });

  it("validates Groq JSON output", async () => {
    const explainer = new GroqExplainer("key", "test-model", async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  headline: "Retry blocked",
                  explanation: "The provider did not return authoritative order state.",
                  nextAction: "Inspect the provider account before continuing.",
                  evidenceIds: ["obs_test"],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(explainer.explain(context)).resolves.toMatchObject({ headline: "Retry blocked" });
  });

  it("rejects an explanation that invents an evidence ID", async () => {
    const explainer = new GeminiExplainer("key", "gemini-2.5-flash", async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ headline: "Bad", explanation: "Bad", nextAction: "Stop", evidenceIds: ["invented"] }) }] } }],
        }),
        { status: 200 },
      ),
    );

    await expect(explainer.explain(context)).rejects.toThrow(/unknown evidence ID/);
  });
});
