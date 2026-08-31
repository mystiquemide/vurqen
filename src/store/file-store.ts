import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AgentAction,
  AgentActionSchema,
  Incident,
  IncidentSchema,
  Intent,
  IntentSchema,
  Observation,
  ObservationSchema,
  Receipt,
  ReceiptSchema,
  Reconciliation,
  ReconciliationSchema,
  Run,
  RunSchema,
  RunStatus,
} from "../core/schemas";
import { digest, id } from "../core/ids";

type StoreState = {
  runs: Run[];
  intents: Intent[];
  observations: Observation[];
  reconciliations: Reconciliation[];
  incidents: Incident[];
  agentActions: AgentAction[];
  aiExplanations: Array<{ runId: string; value: unknown }>;
};

const StoreStateSchema = {
  parse(value: unknown): StoreState {
    if (!value || typeof value !== "object") throw new Error("Stored state must be an object");
    const record = value as Record<string, unknown>;
    return {
      runs: Array.isArray(record.runs) ? record.runs.map((item) => RunSchema.parse(item)) : [],
      intents: Array.isArray(record.intents) ? record.intents.map((item) => IntentSchema.parse(item)) : [],
      observations: Array.isArray(record.observations) ? record.observations.map((item) => ObservationSchema.parse(item)) : [],
      reconciliations: Array.isArray(record.reconciliations)
        ? record.reconciliations.map((item) => ReconciliationSchema.parse(item))
        : [],
      incidents: Array.isArray(record.incidents) ? record.incidents.map((item) => IncidentSchema.parse(item)) : [],
      agentActions: Array.isArray(record.agentActions) ? record.agentActions.map((item) => AgentActionSchema.parse(item)) : [],
      aiExplanations: Array.isArray(record.aiExplanations)
        ? record.aiExplanations.map((item) => {
            const entry = item as { runId?: unknown; value?: unknown };
            if (typeof entry.runId !== "string") throw new Error("Invalid stored AI explanation run ID");
            return { runId: entry.runId, value: entry.value };
          })
        : [],
    };
  },
};

function emptyState(): StoreState {
  return { runs: [], intents: [], observations: [], reconciliations: [], incidents: [], agentActions: [], aiExplanations: [] };
}

export class FileStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string, fileName = "state.json") {
    this.filePath = path.join(dataDir, fileName);
  }

  get path(): string {
    return this.filePath;
  }

  private async load(): Promise<StoreState> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return StoreStateSchema.parse(JSON.parse(raw));
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
      if (code === "ENOENT") return emptyState();
      throw error;
    }
  }

  private async save(state: StoreState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }

  private async mutate<T>(operation: (state: StoreState) => T | Promise<T>): Promise<T> {
    let result!: T;
    const next = this.writeQueue.then(async () => {
      const state = await this.load();
      result = await operation(state);
      await this.save(state);
    });
    this.writeQueue = next.catch(() => undefined);
    await next;
    return result;
  }

  async createRun(provider: Run["provider"], mode: Run["mode"], now = new Date().toISOString()): Promise<Run> {
    return this.mutate((state) => {
      const run = RunSchema.parse({
        id: id("run"),
        provider,
        mode,
        status: "CREATED" satisfies RunStatus,
        createdAt: now,
        updatedAt: now,
        faultCount: 0,
      });
      state.runs.push(run);
      return run;
    });
  }

  async getRun(runId: string): Promise<Run | undefined> {
    const state = await this.load();
    return state.runs.find((run) => run.id === runId);
  }

  async setRunStatus(runId: string, status: RunStatus, patch: Partial<Pick<Run, "intentId" | "faultCount">> = {}): Promise<Run> {
    return this.mutate((state) => {
      const run = state.runs.find((item) => item.id === runId);
      if (!run) throw new Error(`Run ${runId} not found`);
      const updated = RunSchema.parse({ ...run, ...patch, status, updatedAt: new Date().toISOString() });
      Object.assign(run, updated);
      return run;
    });
  }

  async addIntent(intent: Intent): Promise<Intent> {
    return this.mutate((state) => {
      const validated = IntentSchema.parse(intent);
      state.intents.push(validated);
      return validated;
    });
  }

  async getIntent(intentId: string): Promise<Intent | undefined> {
    const state = await this.load();
    return state.intents.find((intent) => intent.id === intentId);
  }

  async getIntentForRun(runId: string): Promise<Intent | undefined> {
    const state = await this.load();
    return state.intents.find((intent) => intent.runId === runId);
  }

  async addObservation(observation: Observation): Promise<Observation> {
    return this.mutate((state) => {
      const validated = ObservationSchema.parse(observation);
      state.observations.push(validated);
      return validated;
    });
  }

  async getObservations(runId: string): Promise<Observation[]> {
    const state = await this.load();
    return state.observations.filter((observation) => observation.runId === runId);
  }

  async addFaultObservation(runId: string, fault: "drop_event" | "duplicate_event", observationId?: string): Promise<Observation> {
    return this.mutate((state) => {
      const candidates = state.observations.filter(
        (observation) =>
          observation.runId === runId &&
          observation.source !== "LOCAL_FAULT" &&
          !observation.eventType.startsWith("ORDER_HISTORY"),
      );
      const source = candidates.find((observation) => observation.id === observationId) ?? candidates.at(-1);
      if (!source) throw new Error("No provider observation is available for the requested fault");

      const faultObservation = ObservationSchema.parse({
        ...source,
        id: id("obs"),
        source: "LOCAL_FAULT",
        receivedAt: new Date().toISOString(),
        faultType: fault,
      });
      state.observations.push(faultObservation);
      const run = state.runs.find((item) => item.id === runId);
      if (run) {
        run.faultCount += 1;
        run.updatedAt = new Date().toISOString();
      }
      return faultObservation;
    });
  }

  async addReconciliation(reconciliation: Reconciliation): Promise<Reconciliation> {
    return this.mutate((state) => {
      const validated = ReconciliationSchema.parse(reconciliation);
      const existingIndex = state.reconciliations.findIndex((item) => item.runId === validated.runId);
      if (existingIndex >= 0) state.reconciliations[existingIndex] = validated;
      else state.reconciliations.push(validated);
      return validated;
    });
  }

  async getReconciliation(runId: string): Promise<Reconciliation | undefined> {
    const state = await this.load();
    return state.reconciliations.find((reconciliation) => reconciliation.runId === runId);
  }

  async addIncident(incident: Incident): Promise<Incident> {
    return this.mutate((state) => {
      const validated = IncidentSchema.parse(incident);
      const existingIndex = state.incidents.findIndex((item) => item.runId === validated.runId);
      if (existingIndex >= 0) state.incidents[existingIndex] = validated;
      else state.incidents.push(validated);
      return validated;
    });
  }

  async getIncidentForRun(runId: string): Promise<Incident | undefined> {
    const state = await this.load();
    return state.incidents.find((incident) => incident.runId === runId);
  }

  async clearIncidentForRun(runId: string): Promise<void> {
    await this.mutate((state) => {
      state.incidents = state.incidents.filter((incident) => incident.runId !== runId);
    });
  }

  async getIncident(incidentId: string): Promise<Incident | undefined> {
    const state = await this.load();
    return state.incidents.find((incident) => incident.id === incidentId);
  }

  async addAgentAction(action: AgentAction): Promise<AgentAction> {
    return this.mutate((state) => {
      const validated = AgentActionSchema.parse(action);
      state.agentActions.push(validated);
      return validated;
    });
  }

  async getAgentActions(runId: string): Promise<AgentAction[]> {
    const state = await this.load();
    return state.agentActions.filter((action) => action.runId === runId);
  }

  async setAiExplanation(runId: string, value: unknown): Promise<void> {
    await this.mutate((state) => {
      state.aiExplanations = state.aiExplanations.filter((item) => item.runId !== runId);
      state.aiExplanations.push({ runId, value });
    });
  }

  async clearAiExplanation(runId: string): Promise<void> {
    await this.mutate((state) => {
      state.aiExplanations = state.aiExplanations.filter((item) => item.runId !== runId);
    });
  }

  async getAiExplanation(runId: string): Promise<unknown | undefined> {
    const state = await this.load();
    return state.aiExplanations.find((item) => item.runId === runId)?.value;
  }

  async buildReceipt(runId: string, provider: Receipt["provider"], mode: Receipt["mode"]): Promise<Receipt> {
    const run = await this.getRun(runId);
    const intent = await this.getIntentForRun(runId);
    if (!run || !intent) throw new Error("Receipt requires a run and intent");
    const observations = await this.getObservations(runId);
    const reconciliation = await this.getReconciliation(runId);
    const incident = await this.getIncidentForRun(runId);
    const agentActions = await this.getAgentActions(runId);
    const aiValue = await this.getAiExplanation(runId);
    const receiptWithoutDigest = {
      schemaVersion: "1.0" as const,
      receiptId: `receipt_${runId}`,
      runId,
      provider,
      mode,
      verdict: incident?.verdict ?? reconciliation?.verdict ?? "UNKNOWN_BLOCKED",
      createdAt: incident?.createdAt ?? reconciliation?.createdAt ?? run.updatedAt,
      intent,
      observations,
      reconciliation,
      incident,
      agentActions,
      aiExplanation: aiValue,
    };
    const receipt = ReceiptSchema.parse({
      ...receiptWithoutDigest,
      evidenceDigest: digest(receiptWithoutDigest),
    });
    return receipt;
  }
}
