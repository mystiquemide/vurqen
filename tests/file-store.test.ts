import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileStore } from "../src/store/file-store";
import { IntentSchema, ObservationSchema } from "../src/core/schemas";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

describe("FileStore", () => {
  it("persists runs, observations, reconciliations, and stable receipts", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vurqen-store-"));
    temporaryDirectories.push(directory);
    const store = new FileStore(directory);
    const run = await store.createRun("bingx", "replay", "2026-08-30T00:00:00.000Z");
    const intent = IntentSchema.parse({
      id: "intent_store",
      runId: run.id,
      provider: "bingx",
      mode: "replay",
      symbol: "BTC-USDT",
      side: "BUY",
      orderType: "LIMIT",
      quantity: "0.001",
      clientOrderId: "vq_store",
      createdAt: "2026-08-30T00:00:00.000Z",
    });
    await store.addIntent(intent);
    await store.setRunStatus(run.id, "INTENT_RECORDED", { intentId: intent.id });
    await store.addObservation(
      ObservationSchema.parse({
        id: "obs_store",
        runId: run.id,
        source: "REPLAY",
        eventType: "ORDER_HISTORY_LOOKUP",
        receivedAt: "2026-08-30T00:00:01.000Z",
        payloadHash: "c".repeat(64),
        payload: { found: false },
      }),
    );

    const receipt = await store.buildReceipt(run.id, "bingx", "replay");
    const receiptAgain = await store.buildReceipt(run.id, "bingx", "replay");

    expect(receipt.receiptId).toBe(`receipt_${run.id}`);
    expect(receipt.evidenceDigest).toBe(receiptAgain.evidenceDigest);
    expect(receipt.createdAt).toBe(receiptAgain.createdAt);
    expect(JSON.parse(await readFile(store.path, "utf8")).intents).toHaveLength(1);
  });
});
