import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
import { config, publicConfig } from "./config";
import { AgentController } from "./core/agent-controller";
import { digest, id, clientOrderId } from "./core/ids";
import {
  CreateRunInputSchema,
  FaultInputSchema,
  IntentInputSchema,
  IntentSchema,
  ObservationInputSchema,
  ObservationSchema,
} from "./core/schemas";
import { createExplainer, createProviders } from "./providers/factory";
import { ExchangeProvider } from "./providers/types";
import { FileStore } from "./store/file-store";

const MAX_BODY_BYTES = 1_000_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;

function safeError(error: unknown): string {
  if (error instanceof ZodError) return "Request validation failed";
  if (error instanceof Error) return error.message.slice(0, 300);
  return "Unexpected server error";
}

function statusForChecks(checks: Array<{ status: string }>): "PREFLIGHT_PASSED" | "PROVIDER_UNAVAILABLE" {
  return checks.some((check) => check.status === "FAIL") ? "PROVIDER_UNAVAILABLE" : "PREFLIGHT_PASSED";
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  if (total === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export type VurqenAppOptions = {
  store?: FileStore;
  providers?: Record<"bingx" | "weex", ExchangeProvider>;
  explainer?: ReturnType<typeof createExplainer>;
};

export class VurqenApp {
  readonly store: FileStore;
  readonly providers: Record<"bingx" | "weex", ExchangeProvider>;
  readonly explainer: ReturnType<typeof createExplainer>;
  private readonly requestCounts = new Map<string, { startedAt: number; count: number }>();

  constructor(options: VurqenAppOptions = {}) {
    if (config.requireApiToken && !config.apiToken) {
      throw new Error("VURQEN_API_TOKEN is required when NODE_ENV=production");
    }
    this.store = options.store ?? new FileStore(config.dataDir);
    this.providers = options.providers ?? createProviders();
    this.explainer = options.explainer === undefined ? createExplainer() : options.explainer;
  }

  createHttpServer() {
    const server = createServer((request, response) => {
      void this.handle(request, response);
    });
    server.requestTimeout = 20_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    return server;
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Cache-Control", "no-store");

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      if (!this.allowRequest(request)) {
        this.send(response, 429, { error: "Rate limit exceeded" });
        return;
      }
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const pathParts = url.pathname.split("/").filter(Boolean);
      const method = request.method ?? "GET";

      if (method === "GET" && url.pathname === "/api/health") {
        this.send(response, 200, { ok: true, ...publicConfig() });
        return;
      }

      if (method === "GET" && url.pathname === "/api") {
        this.send(response, 200, {
          name: "Vurqen",
          description: "Evidence-first incident response for exchange-connected AI trading workflows.",
          routes: [
            "GET /api/health",
            "POST /api/runs",
            "GET /api/runs/:runId/receipt.json",
            "POST /api/runs/:runId/preflight",
            "POST /api/runs/:runId/intents",
            "POST /api/runs/:runId/faults",
            "POST /api/runs/:runId/observations",
            "POST /api/runs/:runId/reconcile",
            "GET /api/incidents/:incidentId",
            "GET /api/incidents/:incidentId/receipt.json",
          ],
        });
        return;
      }

      if (method === "POST" && pathParts.length === 2 && pathParts[0] === "api" && pathParts[1] === "runs") {
        if (!this.authorized(request)) {
          this.send(response, 401, { error: "Authorization required" });
          return;
        }
        await this.createRun(request, response);
        return;
      }

      if (pathParts[0] === "api" && pathParts[1] === "runs" && pathParts[2]) {
        const runId = pathParts[2];
        if (method === "GET" && pathParts.length === 3) {
          if (!this.authorized(request)) {
            this.send(response, 401, { error: "Authorization required" });
            return;
          }
          await this.getRun(response, runId);
          return;
        }
        if (method === "POST" && pathParts[3] === "preflight") {
          if (!this.authorized(request)) {
            this.send(response, 401, { error: "Authorization required" });
            return;
          }
          await this.preflight(response, runId);
          return;
        }
        if (method === "POST" && pathParts[3] === "intents") {
          if (!this.authorized(request)) {
            this.send(response, 401, { error: "Authorization required" });
            return;
          }
          await this.createIntent(request, response, runId);
          return;
        }
        if (method === "POST" && pathParts[3] === "faults") {
          if (!this.authorized(request)) {
            this.send(response, 401, { error: "Authorization required" });
            return;
          }
          await this.applyFault(request, response, runId);
          return;
        }
        if (method === "POST" && pathParts[3] === "observations") {
          if (!this.authorized(request)) {
            this.send(response, 401, { error: "Authorization required" });
            return;
          }
          await this.addObservation(request, response, runId);
          return;
        }
        if (method === "POST" && pathParts[3] === "reconcile") {
          if (!this.authorized(request)) {
            this.send(response, 401, { error: "Authorization required" });
            return;
          }
          await this.reconcile(response, runId);
          return;
        }
        if (method === "GET" && pathParts.length === 4 && pathParts[3] === "receipt.json") {
          if (!this.authorized(request)) {
            this.send(response, 401, { error: "Authorization required" });
            return;
          }
          await this.getRunReceipt(response, runId);
          return;
        }
      }

      if (method === "GET" && pathParts[0] === "api" && pathParts[1] === "incidents" && pathParts[2]) {
        if (!this.authorized(request)) {
          this.send(response, 401, { error: "Authorization required" });
          return;
        }
        const incidentId = pathParts[2];
        if (pathParts[3] === "receipt.json") {
          await this.getReceipt(response, incidentId);
          return;
        }
        await this.getIncident(response, incidentId);
        return;
      }

      this.send(response, 404, { error: "Route not found" });
    } catch (error) {
      const message = safeError(error);
      const status = error instanceof ZodError || error instanceof SyntaxError || message.includes("too large") ? 400 : 500;
      this.send(response, status, { error: message });
    }
  }

  private providerFor(provider: string | undefined): ExchangeProvider {
    const selected = provider === "weex" || provider === "bingx" ? provider : config.provider;
    return this.providers[selected];
  }

  private authorized(request: IncomingMessage): boolean {
    if (!config.requireApiToken) return true;
    return request.headers.authorization === `Bearer ${config.apiToken}`;
  }

  private allowRequest(request: IncomingMessage): boolean {
    const key = request.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const current = this.requestCounts.get(key);
    if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
      this.requestCounts.set(key, { startedAt: now, count: 1 });
      return true;
    }
    if (current.count >= RATE_LIMIT_MAX_REQUESTS) return false;
    current.count += 1;
    return true;
  }

  private async createRun(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = CreateRunInputSchema.parse(await readJson(request));
    const providerName = input.provider ?? config.provider;
    const mode = input.mode ?? config.mode;
    const run = await this.store.createRun(providerName, mode);
    this.send(response, 201, { run });
  }

  private async getRun(response: ServerResponse, runId: string): Promise<void> {
    const run = await this.store.getRun(runId);
    if (!run) {
      this.send(response, 404, { error: "Run not found" });
      return;
    }
    this.send(response, 200, {
      run,
      intent: await this.store.getIntentForRun(runId),
      observations: await this.store.getObservations(runId),
      reconciliation: await this.store.getReconciliation(runId),
      incident: await this.store.getIncidentForRun(runId),
      agentActions: await this.store.getAgentActions(runId),
      aiExplanation: await this.store.getAiExplanation(runId),
    });
  }

  private async preflight(response: ServerResponse, runId: string): Promise<void> {
    const run = await this.store.getRun(runId);
    if (!run) {
      this.send(response, 404, { error: "Run not found" });
      return;
    }
    const provider = this.providerFor(run.provider);
    const checks = await provider.preflight(run.mode);
    const status = statusForChecks(checks);
    await this.store.setRunStatus(runId, status);
    this.send(response, 200, { run: await this.store.getRun(runId), provider: provider.name, mode: run.mode, checks });
  }

  private async createIntent(request: IncomingMessage, response: ServerResponse, runId: string): Promise<void> {
    const run = await this.store.getRun(runId);
    if (!run) {
      this.send(response, 404, { error: "Run not found" });
      return;
    }
    if (await this.store.getIntentForRun(runId)) {
      this.send(response, 409, { error: "Run already has an intent" });
      return;
    }

    const input = IntentInputSchema.parse(await readJson(request));
    const { submit, ...intentInput } = input;
    const intent = IntentSchema.parse({
      ...intentInput,
      id: id("intent"),
      runId,
      provider: run.provider,
      mode: run.mode,
      clientOrderId: input.clientOrderId ?? clientOrderId(),
      createdAt: new Date().toISOString(),
    });
    await this.store.addIntent(intent);
    await this.store.setRunStatus(runId, "INTENT_RECORDED", { intentId: intent.id });

    const provider = this.providerFor(run.provider);
    const observations = [];
    try {
      const market = await provider.captureMarketObservation(intent.symbol);
      observations.push(
        await this.store.addObservation({
          id: id("obs"),
          runId,
          source: "REST",
          eventType: "MARKET_SNAPSHOT",
          receivedAt: new Date().toISOString(),
          payloadHash: digest(market),
          payload: market,
          relatedIntentId: intent.id,
        }),
      );
    } catch (error) {
      const detail = safeError(error);
      observations.push(
        await this.store.addObservation({
          id: id("obs"),
          runId,
          source: "REST",
          eventType: "MARKET_SNAPSHOT_ERROR",
          receivedAt: new Date().toISOString(),
          payloadHash: digest({ error: detail }),
          payload: { error: detail },
          relatedIntentId: intent.id,
        }),
      );
    }

    try {
      const stream = await provider.captureStreamObservation(intent.symbol);
      observations.push(
        await this.store.addObservation({
          id: id("obs"),
          runId,
          source: "WEBSOCKET",
          eventType: "MARKET_STREAM",
          receivedAt: new Date().toISOString(),
          payloadHash: digest(stream),
          payload: stream,
          relatedIntentId: intent.id,
        }),
      );
    } catch (error) {
      const detail = safeError(error);
      observations.push(
        await this.store.addObservation({
          id: id("obs"),
          runId,
          source: "WEBSOCKET",
          eventType: "MARKET_STREAM_ERROR",
          receivedAt: new Date().toISOString(),
          payloadHash: digest({ error: detail }),
          payload: { error: detail },
          relatedIntentId: intent.id,
        }),
      );
    }

    let submission: unknown;
    if (submit) {
      if (run.mode !== "paper") throw new Error("Paper order submission requires paper mode");
      const result = await provider.submitPaperOrder(intent);
      submission = result.raw;
      observations.push(
        await this.store.addObservation({
          id: id("obs"),
          runId,
          source: "REST",
          eventType: "ORDER_SUBMITTED",
          receivedAt: new Date().toISOString(),
          payloadHash: digest(result.raw),
          payload: result.raw,
          relatedIntentId: intent.id,
        }),
      );
      await this.store.setRunStatus(runId, "OBSERVING");
    }

    this.send(response, 201, { run: await this.store.getRun(runId), intent, observations, submission });
  }

  private async applyFault(request: IncomingMessage, response: ServerResponse, runId: string): Promise<void> {
    const run = await this.store.getRun(runId);
    if (!run) {
      this.send(response, 404, { error: "Run not found" });
      return;
    }
    const input = FaultInputSchema.parse(await readJson(request));
    const observation = await this.store.addFaultObservation(runId, input.type, input.observationId);
    this.send(response, 201, { run: await this.store.getRun(runId), observation });
  }

  private async addObservation(request: IncomingMessage, response: ServerResponse, runId: string): Promise<void> {
    const run = await this.store.getRun(runId);
    if (!run) {
      this.send(response, 404, { error: "Run not found" });
      return;
    }
    if (run.mode !== "replay") {
      this.send(response, 403, { error: "Manual observations are available only in replay mode" });
      return;
    }
    const input = ObservationInputSchema.parse(await readJson(request));
    const observation = ObservationSchema.parse({
      ...input,
      id: id("obs"),
      runId,
      source: "REPLAY",
      receivedAt: new Date().toISOString(),
      payloadHash: digest(input.payload),
    });
    await this.store.addObservation(observation);
    this.send(response, 201, { observation });
  }

  private async reconcile(response: ServerResponse, runId: string): Promise<void> {
    const run = await this.store.getRun(runId);
    if (!run) {
      this.send(response, 404, { error: "Run not found" });
      return;
    }
    const intent = await this.store.getIntentForRun(runId);
    if (!intent) {
      this.send(response, 409, { error: "Create an intent before reconciliation" });
      return;
    }
    const provider = this.providerFor(run.provider);
    const controller = new AgentController(this.store, provider, this.explainer);
    this.send(response, 200, await controller.reconcile(runId));
  }

  private async getIncident(response: ServerResponse, incidentId: string): Promise<void> {
    const incident = await this.store.getIncident(incidentId);
    if (!incident) {
      this.send(response, 404, { error: "Incident not found" });
      return;
    }
    const run = await this.store.getRun(incident.runId);
    if (!run) {
      this.send(response, 500, { error: "Incident run not found" });
      return;
    }
    this.send(response, 200, {
      incident,
      run,
      receipt: await this.store.buildReceipt(run.id, run.provider, run.mode),
    });
  }

  private async getReceipt(response: ServerResponse, incidentId: string): Promise<void> {
    const incident = await this.store.getIncident(incidentId);
    if (!incident) {
      this.send(response, 404, { error: "Incident not found" });
      return;
    }
    const run = await this.store.getRun(incident.runId);
    if (!run) {
      this.send(response, 500, { error: "Incident run not found" });
      return;
    }
    const receipt = await this.store.buildReceipt(run.id, run.provider, run.mode);
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(`${JSON.stringify(receipt, null, 2)}\n`);
  }

  private async getRunReceipt(response: ServerResponse, runId: string): Promise<void> {
    const run = await this.store.getRun(runId);
    if (!run) {
      this.send(response, 404, { error: "Run not found" });
      return;
    }
    if (!await this.store.getIntentForRun(runId)) {
      this.send(response, 409, { error: "Create an intent before requesting a receipt" });
      return;
    }
    const receipt = await this.store.buildReceipt(run.id, run.provider, run.mode);
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(`${JSON.stringify(receipt, null, 2)}\n`);
  }

  private send(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(`${JSON.stringify(body)}\n`);
  }
}
