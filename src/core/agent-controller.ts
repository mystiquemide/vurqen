import { digest, id } from "./ids";
import {
  AgentAction,
  AgentActionSchema,
  Incident,
  Intent,
  Observation,
  OrderSnapshot,
  OrderSnapshotSchema,
  Reconciliation,
  ReconciliationSchema,
  Verdict,
} from "./schemas";
import { reconcileOrder } from "./reconciliation";
import { FileStore } from "../store/file-store";
import { IncidentExplainer } from "../providers/ai";
import { ExchangeProvider } from "../providers/types";

function now(): string {
  return new Date().toISOString();
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300);
  return "Unknown provider error";
}

function action(
  runId: string,
  actionName: AgentAction["action"],
  reason: string,
  inputEvidenceIds: string[],
  outputEvidenceIds: string[],
): AgentAction {
  return AgentActionSchema.parse({
    id: id("act"),
    runId,
    action: actionName,
    reason,
    inputEvidenceIds,
    outputEvidenceIds,
    createdAt: now(),
  });
}

function providerUnavailableReconciliation(intent: Intent, detail: string): Reconciliation {
  return ReconciliationSchema.parse({
    id: id("rec"),
    runId: intent.runId,
    intentId: intent.id,
    verdict: "PROVIDER_UNAVAILABLE",
    localState: "PROVIDER_QUERY_FAILED",
    providerState: "UNAVAILABLE",
    matchedFields: [],
    mismatchedFields: ["providerState"],
    ruleResults: [
      { name: "authoritative_provider_state", passed: false, detail },
    ],
    createdAt: now(),
  });
}

function providerUnavailableIncident(intent: Intent, observation: Observation, detail: string): Incident {
  return {
    id: id("inc"),
    runId: intent.runId,
    severity: "HIGH",
    verdict: "PROVIDER_UNAVAILABLE",
    trigger: "provider_query_failed",
    summary: detail,
    evidenceIds: [observation.id],
    recommendedAction: "Do not retry. Wait for provider availability and reconcile from authoritative records.",
    createdAt: now(),
  };
}

function replayOrderSnapshot(observations: Observation[]): OrderSnapshot | undefined {
  for (const observation of [...observations].reverse()) {
    if (observation.source !== "REPLAY" || observation.eventType !== "ORDER_STATE") continue;
    const parsed = OrderSnapshotSchema.safeParse(observation.payload);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

function safeNextAction(verdict: Verdict, incident: Incident | undefined, proposed: string): string {
  if (incident?.recommendedAction) return incident.recommendedAction;
  if (verdict === "REJECTED") return "Review the provider rejection before submitting a new intent.";
  if (verdict === "PARTIALLY_FILLED") return "Review the partial fill before taking further action.";
  return proposed;
}

export class AgentController {
  constructor(
    private readonly store: FileStore,
    private readonly provider: ExchangeProvider,
    private readonly explainer?: IncidentExplainer,
  ) {}

  async reconcile(runId: string) {
    const run = await this.store.getRun(runId);
    const intent = await this.store.getIntentForRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    if (!intent) throw new Error(`Run ${runId} has no intent`);

    const existingReconciliation = await this.store.getReconciliation(runId);
    if (existingReconciliation) {
      return this.finish(runId, intent, existingReconciliation, await this.store.getIncidentForRun(runId));
    }

    await this.store.setRunStatus(runId, "RECONCILING");
    const beforeObservations = await this.store.getObservations(runId);
    const needsProviderLookup = run.mode !== "replay" && (beforeObservations.some((observation) => observation.faultType) || beforeObservations.length === 0);
    const lookupAction = action(
      runId,
      "inspect_order_history",
      run.mode === "replay"
        ? "Use the supplied replay order state without contacting an exchange."
        : needsProviderLookup
          ? "Local observations are incomplete or faulted. Query authoritative provider order history before continuing."
          : "Verify the recorded intent against authoritative provider order history.",
      beforeObservations.map((observation) => observation.id),
      [],
    );
    await this.store.addAgentAction(lookupAction);

    let providerSnapshot: OrderSnapshot | undefined;
    let lookupObservation: Observation;
    if (run.mode === "replay") {
      providerSnapshot = replayOrderSnapshot(beforeObservations);
      lookupObservation = await this.store.addObservation({
        id: id("obs"),
        runId,
        source: "REPLAY",
        eventType: "REPLAY_ORDER_STATE_LOOKUP",
        receivedAt: now(),
        payloadHash: digest({ found: Boolean(providerSnapshot), snapshot: providerSnapshot ?? null }),
        payload: { found: Boolean(providerSnapshot), snapshot: providerSnapshot ?? null },
        relatedIntentId: intent.id,
      });
    } else {
      try {
        providerSnapshot = await this.provider.getOrderSnapshot(intent);
        lookupObservation = await this.store.addObservation({
          id: id("obs"),
          runId,
          source: "REST",
          eventType: "ORDER_HISTORY_LOOKUP",
          receivedAt: now(),
          payloadHash: digest({ found: Boolean(providerSnapshot), snapshot: providerSnapshot ?? null }),
          payload: { found: Boolean(providerSnapshot), snapshot: providerSnapshot ?? null },
          relatedIntentId: intent.id,
        });
      } catch (error) {
        const detail = safeError(error);
        lookupObservation = await this.store.addObservation({
          id: id("obs"),
          runId,
          source: "REST",
          eventType: "ORDER_HISTORY_ERROR",
          receivedAt: now(),
          payloadHash: digest({ error: detail }),
          payload: { error: detail },
          relatedIntentId: intent.id,
        });
        const reconciliation = providerUnavailableReconciliation(intent, detail);
        const incident = providerUnavailableIncident(intent, lookupObservation, detail);
        await this.store.addAgentAction(
          action(runId, "stop_unresolved_run", "The provider query failed, so the run must stop without a retry.", [lookupObservation.id], [lookupObservation.id]),
        );
        await this.store.addReconciliation(reconciliation);
        await this.store.addIncident(incident);
        await this.store.setRunStatus(runId, "PROVIDER_UNAVAILABLE");
        return this.finish(runId, intent, reconciliation, incident);
      }
    }

    const afterLookup = await this.store.getObservations(runId);
    const reconcileAction = action(
      runId,
      "reconcile_order",
      "Compare the canonical intent with the provider order state and all local observations.",
      afterLookup.map((observation) => observation.id),
      [lookupObservation.id],
    );
    await this.store.addAgentAction(reconcileAction);

    const result = reconcileOrder(intent, afterLookup, providerSnapshot);
    await this.store.addReconciliation(result.reconciliation);
    if (result.incident) await this.store.addIncident(result.incident);

    const status = this.statusFor(result.verdict);
    await this.store.setRunStatus(runId, status);

    let aiError: string | undefined;
    if (this.explainer && (result.incident || result.verdict !== "RECONCILED")) {
      try {
        const explanation = await this.explainer.explain({
          intent,
          observations: afterLookup,
          reconciliation: result.reconciliation,
          incident: result.incident,
        });
        await this.store.setAiExplanation(runId, {
          ...explanation,
          nextAction: safeNextAction(result.verdict, result.incident, explanation.nextAction),
        });
      } catch (error) {
        aiError = safeError(error);
      }
    }

    return this.finish(runId, intent, result.reconciliation, result.incident, aiError);
  }

  private statusFor(verdict: Verdict) {
    switch (verdict) {
      case "RECONCILED":
        return "RECONCILED" as const;
      case "PROVIDER_UNAVAILABLE":
        return "PROVIDER_UNAVAILABLE" as const;
      case "UNKNOWN_BLOCKED":
        return "UNKNOWN_BLOCKED" as const;
      default:
        return "INCIDENT" as const;
    }
  }

  private async finish(
    runId: string,
    intent: Intent,
    reconciliation: Reconciliation,
    incident?: Incident,
    aiError?: string,
  ) {
    const run = await this.store.getRun(runId);
    const observations = await this.store.getObservations(runId);
    const agentActions = await this.store.getAgentActions(runId);
    const aiExplanation = await this.store.getAiExplanation(runId);
    return {
      run,
      intent,
      observations,
      reconciliation,
      incident,
      agentActions,
      aiExplanation,
      aiError,
      receipt: await this.store.buildReceipt(runId, run!.provider, run!.mode),
    };
  }
}
