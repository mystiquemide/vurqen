import { type AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VurqenApp } from "../src/app";
import { digest } from "../src/core/ids";
import { PreflightCheck, RunMode } from "../src/core/schemas";
import { FileStore } from "../src/store/file-store";
import { ExchangeProvider } from "../src/providers/types";

class FakeProvider implements ExchangeProvider {
  readonly name = "bingx" as const;
  readonly environment = "prod-vst" as const;
  readonly configured = true;
  private snapshot: undefined = undefined;

  async preflight(_mode: RunMode): Promise<PreflightCheck[]> {
    return [{ name: "fake", status: "PASS", detail: "fake provider" }];
  }

  async getOrderSnapshot() {
    return this.snapshot;
  }

  async validateOrder() {
    return { raw: { accepted: true } };
  }

  async submitPaperOrder() {
    return { raw: { accepted: true, paper: true } };
  }

  async captureMarketObservation(symbol: string) {
    return { symbol, price: "60000", capturedAt: "2026-08-30T00:00:00.000Z" };
  }

  async captureStreamObservation(symbol: string) {
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
          nextAction: "Inspect authoritative provider records.",
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
    const runId = created.body.run.id as string;

    const intent = await jsonRequest(base, `/api/runs/${runId}/intents`, {
      method: "POST",
      body: JSON.stringify({ symbol: "BTC-USDT", side: "BUY", orderType: "LIMIT", quantity: "0.001", price: "60000" }),
    });
    expect(intent.response.status).toBe(201);

    const fault = await jsonRequest(base, `/api/runs/${runId}/faults`, {
      method: "POST",
      body: JSON.stringify({ type: "drop_event" }),
    });
    expect(fault.response.status).toBe(201);

    const reconciled = await jsonRequest(base, `/api/runs/${runId}/reconcile`, { method: "POST", body: "{}" });
    expect(reconciled.response.status).toBe(200);
    expect(reconciled.body.reconciliation.verdict).toBe("UNKNOWN_BLOCKED");
    expect(reconciled.body.incident.recommendedAction).toContain("Do not retry");

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
});
