import { type AddressInfo } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VurqenApp } from "../src/app";
import { digest } from "../src/core/ids";
import { OrderSnapshot, PreflightCheck, RunMode } from "../src/core/schemas";
import { FileStore } from "../src/store/file-store";
import { ExchangeProvider } from "../src/providers/types";

class FakeProvider implements ExchangeProvider {
  readonly name = "bingx" as const;
  readonly environment = "prod-vst" as const;
  readonly configured = true;
  snapshot: OrderSnapshot | undefined = undefined;
  captureDelayMs = 0;
  lookupDelayMs = 0;
  submitError: Error | undefined;
  lookupCalls = 0;
  marketCaptureCalls = 0;
  streamCaptureCalls = 0;

  private async delay(milliseconds: number): Promise<void> {
    if (milliseconds > 0) await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }

  async preflight(_mode: RunMode): Promise<PreflightCheck[]> {
    return [{ name: "fake", status: "PASS", detail: "fake provider" }];
  }

  async getOrderSnapshot() {
    this.lookupCalls += 1;
    await this.delay(this.lookupDelayMs);
    return this.snapshot;
  }

  async validateOrder() {
    return { raw: { accepted: true } };
  }

  async submitPaperOrder() {
    if (this.submitError) throw this.submitError;
    return { raw: { accepted: true, paper: true } };
  }

  async captureMarketObservation(symbol: string) {
    this.marketCaptureCalls += 1;
    await this.delay(this.captureDelayMs);
    return { symbol, price: "60000", capturedAt: "2026-08-30T00:00:00.000Z" };
  }

  async captureStreamObservation(symbol: string) {
    this.streamCaptureCalls += 1;
    return { symbol, price: "60000", stream: true, capturedAt: "2026-08-30T00:00:00.000Z" };
  }
}

const directories: string[] = [];
const servers: Array<ReturnType<VurqenApp["createHttpServer"]>> = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  while (directories.length) {
    const directory = directories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

async function start(app: VurqenApp): Promise<string> {
  const server = app.createHttpServer();
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function jsonRequest(base: string, route: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${route}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  return { response, body: await response.json() };
}

describe("Vurqen HTTP API", () => {
  it("runs a replay fault through reconciliation and exposes a stable receipt", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vurqen-app-"));
    directories.push(directory);
    const app = new VurqenApp({
      store: new FileStore(directory),
      providers: { bingx: new FakeProvider(), weex: new FakeProvider() },
      explainer: {
        name: "gemini",
        explain: async () => ({
          headline: "Retry blocked",
          explanation: "The provider state was not found.",
          nextAction: "Retry immediately.",
          evidenceIds: [],
        }),
      },
    });
    const base = await start(app);

    const created = await jsonRequest(base, "/api/runs", {
      method: "POST",
      body: JSON.stringify({ provider: "bingx", mode: "replay" }),
    });
    expect(created.response.status).toBe(201);
    const landing = await jsonRequest(base, "/");
    expect(landing.response.status).toBe(200);
    expect(landing.body.api).toBe("/api");
    expect(created.response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(created.response.headers.get("access-control-allow-headers")).toContain("Authorization");
    const runId = created.body.run.id as string;

    const intent = await jsonRequest(base, `/api/runs/${runId}/intents`, {
      method: "POST",
      body: JSON.stringify({ symbol: "BTC-USDT", side: "BUY", orderType: "LIMIT", quantity: "0.001", price: "60000" }),
    });
    expect(intent.response.status).toBe(201);
    expect(intent.body.observations).toEqual([]);

    const replayObservation = await jsonRequest(base, `/api/runs/${runId}/observations`, {
      method: "POST",
      body: JSON.stringify({ source: "REPLAY", eventType: "MARKET_SNAPSHOT", payload: { symbol: "BTC-USDT", price: "60000" } }),
    });
    expect(replayObservation.response.status).toBe(201);

    const fault = await jsonRequest(base, `/api/runs/${runId}/faults`, {
      method: "POST",
      body: JSON.stringify({ type: "drop_event" }),
    });
    expect(fault.response.status).toBe(201);

    const reconciled = await jsonRequest(base, `/api/runs/${runId}/reconcile`, { method: "POST", body: "{}" });
    expect(reconciled.response.status).toBe(200);
    expect(reconciled.body.reconciliation.verdict).toBe("UNKNOWN_BLOCKED");
    expect(reconciled.body.incident.recommendedAction).toContain("Do not retry");
    expect(reconciled.body.aiExplanation.nextAction).toContain("Do not retry");

    const incidentId = reconciled.body.incident.id as string;
    const firstReceipt = await fetch(`${base}/api/incidents/${incidentId}/receipt.json`);
    const secondReceipt = await fetch(`${base}/api/incidents/${incidentId}/receipt.json`);
    expect(firstReceipt.status).toBe(200);
    expect(await firstReceipt.text()).toBe(await secondReceipt.text());
    const receipt = JSON.parse(await fetch(`${base}/api/incidents/${incidentId}/receipt.json`).then((response) => response.text()));
    expect(receipt.evidenceDigest).toBe(digest({
      schemaVersion: "1.0",
      receiptId: receipt.receiptId,
      runId,
      provider: "bingx",
      mode: "replay",
      verdict: "UNKNOWN_BLOCKED",
      createdAt: receipt.createdAt,
      intent: receipt.intent,
      observations: receipt.observations,
      reconciliation: receipt.reconciliation,
      incident: receipt.incident,
      agentActions: receipt.agentActions,
      aiExplanation: receipt.aiExplanation,
    }));
  });

  it("reconciles a replay order state without contacting the provider", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vurqen-app-"));
    directories.push(directory);
    const provider = new FakeProvider();
    const app = new VurqenApp({
      store: new FileStore(directory),
      providers: { bingx: provider, weex: provider },
      explainer: {
        name: "gemini",
        explain: async () => ({
          headline: "Unknown state",
          explanation: "The provider state is not available yet.",
          nextAction: "Do not retry.",
          evidenceIds: [],
        }),
      },
    });
    const base = await start(app);
    const created = await jsonRequest(base, "/api/runs", {
      method: "POST",
      body: JSON.stringify({ provider: "bingx", mode: "replay" }),
    });
    const runId = created.body.run.id as string;
    const intent = await jsonRequest(base, `/api/runs/${runId}/intents`, {
      method: "POST",
      body: JSON.stringify({ symbol: "BTC-USDT", side: "BUY", orderType: "MARKET", quantity: "0.001" }),
    });
    const replayState = await jsonRequest(base, `/api/runs/${runId}/observations`, {
      method: "POST",
      body: JSON.stringify({
        source: "REPLAY",
        eventType: "ORDER_STATE",
        payload: {
          symbol: "BTC-USDT",
          clientOrderId: intent.body.intent.clientOrderId,
          side: "BUY",
          positionSide: "LONG",
          orderType: "MARKET",
          status: "FILLED",
          originalQuantity: "0.001",
        },
      }),
    });
    expect(replayState.response.status).toBe(201);

    const reconciled = await jsonRequest(base, `/api/runs/${runId}/reconcile`, { method: "POST", body: "{}" });

    expect(reconciled.response.status).toBe(200);
    expect(reconciled.body.reconciliation.verdict).toBe("RECONCILED");
    expect(provider.lookupCalls).toBe(0);
  });

  it("serializes concurrent intent creation for one run", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vurqen-app-"));
    directories.push(directory);
    const provider = new FakeProvider();
    provider.captureDelayMs = 25;
    const app = new VurqenApp({
      store: new FileStore(directory),
      providers: { bingx: provider, weex: provider },
      explainer: undefined,
    });
    const base = await start(app);
    const created = await jsonRequest(base, "/api/runs", {
      method: "POST",
      body: JSON.stringify({ provider: "bingx", mode: "replay" }),
    });
    const runId = created.body.run.id as string;
    const payload = JSON.stringify({ symbol: "BTC-USDT", side: "BUY", orderType: "MARKET", quantity: "0.001" });

    const responses = await Promise.all([
      jsonRequest(base, `/api/runs/${runId}/intents`, { method: "POST", body: payload }),
      jsonRequest(base, `/api/runs/${runId}/intents`, { method: "POST", body: payload }),
    ]);
    const state = JSON.parse(await readFile(app.store.path, "utf8")) as { intents: unknown[] };

    expect(responses.map((item) => item.response.status).sort()).toEqual([201, 409]);
    expect(state.intents).toHaveLength(1);
  });

  it("serializes concurrent reconciliation for one run", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vurqen-app-"));
    directories.push(directory);
    const provider = new FakeProvider();
    provider.lookupDelayMs = 25;
    const app = new VurqenApp({
      store: new FileStore(directory),
      providers: { bingx: provider, weex: provider },
      explainer: undefined,
    });
    const base = await start(app);
    const created = await jsonRequest(base, "/api/runs", {
      method: "POST",
      body: JSON.stringify({ provider: "bingx", mode: "read_only" }),
    });
    const runId = created.body.run.id as string;
    const intent = await jsonRequest(base, `/api/runs/${runId}/intents`, {
      method: "POST",
      body: JSON.stringify({ symbol: "BTC-USDT", side: "BUY", orderType: "MARKET", quantity: "0.001" }),
    });
    provider.snapshot = {
      clientOrderId: intent.body.intent.clientOrderId,
      symbol: "BTC-USDT",
      side: "BUY",
      orderType: "MARKET",
      status: "FILLED",
      originalQuantity: "0.001",
      positionSide: "LONG",
    };

    const responses = await Promise.all([
      jsonRequest(base, `/api/runs/${runId}/reconcile`, { method: "POST", body: "{}" }),
      jsonRequest(base, `/api/runs/${runId}/reconcile`, { method: "POST", body: "{}" }),
    ]);
    const state = JSON.parse(await readFile(app.store.path, "utf8")) as { reconciliations: unknown[]; incidents: unknown[] };

    expect(responses.map((item) => item.response.status)).toEqual([200, 200]);
    expect(responses.map((item) => item.body.reconciliation.verdict)).toEqual(["RECONCILED", "RECONCILED"]);
    expect(state.reconciliations).toHaveLength(1);
    expect(state.incidents).toHaveLength(0);
  });

  it("blocks the run when paper-order submission has an unknown outcome", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vurqen-app-"));
    directories.push(directory);
    const provider = new FakeProvider();
    provider.submitError = new Error("provider connection lost");
    const app = new VurqenApp({
      store: new FileStore(directory),
      providers: { bingx: provider, weex: provider },
      explainer: undefined,
    });
    const base = await start(app);
    const created = await jsonRequest(base, "/api/runs", {
      method: "POST",
      body: JSON.stringify({ provider: "bingx", mode: "paper" }),
    });
    const runId = created.body.run.id as string;

    const response = await jsonRequest(base, `/api/runs/${runId}/intents`, {
      method: "POST",
      body: JSON.stringify({ symbol: "BTC-USDT", side: "BUY", orderType: "MARKET", quantity: "0.001", submit: true }),
    });
    const state = JSON.parse(await readFile(app.store.path, "utf8")) as {
      runs: Array<{ status: string }>;
      observations: Array<{ eventType: string }>;
    };

    expect(response.response.status).toBe(502);
    expect(state.runs[0]?.status).toBe("UNKNOWN_BLOCKED");
    expect(state.observations.map((item) => item.eventType)).toContain("ORDER_SUBMISSION_ERROR");
  });

  it("retries authoritative lookup after an unknown reconciliation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vurqen-app-"));
    directories.push(directory);
    const provider = new FakeProvider();
    const app = new VurqenApp({
      store: new FileStore(directory),
      providers: { bingx: provider, weex: provider },
      explainer: {
        name: "gemini",
        explain: async () => ({
          headline: "Unknown state",
          explanation: "The provider state is not available yet.",
          nextAction: "Do not retry.",
          evidenceIds: [],
        }),
      },
    });
    const base = await start(app);
    const created = await jsonRequest(base, "/api/runs", {
      method: "POST",
      body: JSON.stringify({ provider: "bingx", mode: "read_only" }),
    });
    const runId = created.body.run.id as string;
    const intent = await jsonRequest(base, `/api/runs/${runId}/intents`, {
      method: "POST",
      body: JSON.stringify({ symbol: "BTC-USDT", side: "BUY", orderType: "MARKET", quantity: "0.001" }),
    });

    const first = await jsonRequest(base, `/api/runs/${runId}/reconcile`, { method: "POST", body: "{}" });
    provider.snapshot = {
      clientOrderId: intent.body.intent.clientOrderId,
      symbol: "BTC-USDT",
      side: "BUY",
      orderType: "MARKET",
      status: "FILLED",
      originalQuantity: "0.001",
      positionSide: "LONG",
    };
    const second = await jsonRequest(base, `/api/runs/${runId}/reconcile`, { method: "POST", body: "{}" });
    const state = JSON.parse(await readFile(app.store.path, "utf8")) as { reconciliations: unknown[]; incidents: unknown[] };

    expect(first.body.reconciliation.verdict).toBe("UNKNOWN_BLOCKED");
    expect(second.body.reconciliation.verdict).toBe("RECONCILED");
    expect(second.body.aiExplanation).toBeUndefined();
    expect(state.reconciliations).toHaveLength(1);
    expect(state.incidents).toHaveLength(0);
  });
});
