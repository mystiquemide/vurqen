import { AddressInfo } from "node:net";
import { VurqenApp } from "../src/app";

const app = new VurqenApp();
const server = app.createHttpServer();

function stop(): void {
  server.close(() => process.exit(0));
}

async function request(label: string, base: string, route: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${route}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await response.json();
  console.log(`${label}: HTTP ${response.status}`);
  if (!response.ok) throw new Error(`${label} failed: ${body.error ?? "unknown error"}`);
  return body;
}

async function main(): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const health = await request("Test 1 health", base, "/api/health");
    console.log(`  provider=${health.provider} mode=${health.mode} ai=${health.aiProvider}/${health.aiModel}`);

    const created = await request("Test 2 create run", base, "/api/runs", {
      method: "POST",
      body: JSON.stringify({ provider: "bingx", mode: "read_only" }),
    });
    const runId = created.run.id as string;

    const preflight = await request("Test 3 BingX preflight", base, `/api/runs/${runId}/preflight`, { method: "POST", body: "{}" });
    console.log(`  checks=${preflight.checks.map((check: { name: string; status: string }) => `${check.name}:${check.status}`).join(",")}`);

    const intent = await request("Test 4 record intent", base, `/api/runs/${runId}/intents`, {
      method: "POST",
      body: JSON.stringify({ symbol: "BTC-USDT", side: "BUY", orderType: "LIMIT", quantity: "0.001", price: "1" }),
    });
    console.log(`  intent=${intent.intent.id} observations=${intent.observations.length}`);

    const fault = await request("Test 5 controlled fault", base, `/api/runs/${runId}/faults`, {
      method: "POST",
      body: JSON.stringify({ type: "drop_event" }),
    });
    console.log(`  fault=${fault.observation.faultType} source=${fault.observation.source}`);

    const reconciled = await request("Test 6 reconcile order", base, `/api/runs/${runId}/reconcile`, {
      method: "POST",
      body: "{}",
    });
    console.log(`  verdict=${reconciled.reconciliation.verdict} actions=${reconciled.agentActions.length} ai=${reconciled.aiExplanation ? "present" : "unavailable"}`);

    const incidentId = reconciled.incident?.id as string | undefined;
    if (!incidentId) throw new Error("Smoke run did not create an incident");
    const receipt = await request("Test 7 receipt", base, `/api/incidents/${incidentId}/receipt.json`);
    console.log(`  receipt=${receipt.receiptId} digestLength=${receipt.evidenceDigest.length}`);
  } finally {
    stop();
  }
}

void main().catch((error) => {
  console.error(`SMOKE_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  server.close(() => process.exit(1));
});
