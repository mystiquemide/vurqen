import { describe, expect, it } from "vitest";
import { id } from "../src/core/ids";
import { reconcileOrder } from "../src/core/reconciliation";
import { Intent, IntentSchema, Observation, ObservationSchema, OrderSnapshot } from "../src/core/schemas";

function intent(overrides: Partial<Intent> = {}): Intent {
  return IntentSchema.parse({
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
    ...overrides,
  });
}

function observation(overrides: Partial<Observation> = {}): Observation {
  return ObservationSchema.parse({
    id: id("obs"),
    runId: "run_test",
    source: "REST",
    eventType: "MARKET_SNAPSHOT",
    receivedAt: "2026-08-30T00:00:01.000Z",
    payloadHash: "a".repeat(64),
    payload: { symbol: "BTC-USDT" },
    relatedIntentId: "intent_test",
    ...overrides,
  });
}

function snapshot(overrides: Partial<OrderSnapshot> = {}): OrderSnapshot {
  return {
    providerOrderId: "9007199254740993123",
    clientOrderId: "vq_test_order",
    symbol: "BTC-USDT",
    side: "BUY",
    orderType: "LIMIT",
    status: "FILLED",
    originalQuantity: "0.001",
    executedQuantity: "0.001",
    price: "60000",
    ...overrides,
  };
}

describe("reconcileOrder", () => {
  it("blocks when authoritative provider state is missing", () => {
    const result = reconcileOrder(intent(), [observation()], undefined, "2026-08-30T00:00:02.000Z");

    expect(result.verdict).toBe("UNKNOWN_BLOCKED");
    expect(result.incident?.recommendedAction).toContain("Do not retry");
    expect(result.reconciliation.mismatchedFields).toContain("providerOrderState");
  });

  it("reconciles a matching filled order", () => {
    const result = reconcileOrder(intent(), [observation()], snapshot(), "2026-08-30T00:00:02.000Z");

    expect(result.verdict).toBe("RECONCILED");
    expect(result.incident).toBeUndefined();
    expect(result.reconciliation.mismatchedFields).toEqual([]);
  });

  it("keeps a partial fill visible", () => {
    const result = reconcileOrder(
      intent(),
      [observation()],
      snapshot({ status: "PARTIALLY_FILLED", executedQuantity: "0.0004" }),
      "2026-08-30T00:00:02.000Z",
    );

    expect(result.verdict).toBe("PARTIALLY_FILLED");
  });

  it("blocks a provider intent mismatch", () => {
    const result = reconcileOrder(
      intent(),
      [observation()],
      snapshot({ symbol: "ETH-USDT" }),
      "2026-08-30T00:00:02.000Z",
    );

    expect(result.verdict).toBe("UNKNOWN_BLOCKED");
    expect(result.reconciliation.mismatchedFields).toContain("symbol");
  });

  it("records controlled duplicate faults while accepting matching provider state", () => {
    const result = reconcileOrder(
      intent(),
      [observation({ source: "LOCAL_FAULT", faultType: "duplicate_event" })],
      snapshot(),
      "2026-08-30T00:00:02.000Z",
    );

    expect(result.verdict).toBe("RECONCILED");
    expect(result.reconciliation.ruleResults.find((rule) => rule.name === "stream_integrity")?.passed).toBe(false);
  });
});
