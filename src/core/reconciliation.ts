import {
  Incident,
  Intent,
  Observation,
  OrderSnapshot,
  Reconciliation,
  Verdict,
} from "./schemas";
import { id } from "./ids";

export type RuleResult = {
  name: string;
  passed: boolean;
  detail: string;
};

export type ReconciliationResult = {
  verdict: Verdict;
  reconciliation: Reconciliation;
  incident?: Incident;
};

function normalizeNumber(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined;
  const [whole, fraction = ""] = trimmed.split(".");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
}

function sameNumber(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return false;
  return normalizeNumber(left) === normalizeNumber(right);
}

function canonicalSymbol(symbol: string): string {
  return symbol.replaceAll("-", "").toUpperCase();
}

function canonicalStatus(status: OrderSnapshot["status"]): OrderSnapshot["status"] {
  return status === "CANCELLED" ? "CANCELED" : status;
}

function hasStreamGap(observations: Observation[]): boolean {
  return observations.some((observation) => observation.faultType === "drop_event");
}

function hasDuplicateObservation(observations: Observation[]): boolean {
  return observations.some((observation) => observation.faultType === "duplicate_event");
}

function incidentFor(
  intent: Intent,
  observations: Observation[],
  verdict: Verdict,
  trigger: string,
  summary: string,
  recommendedAction: string,
  createdAt: string,
): Incident {
  return {
    id: id("inc"),
    runId: intent.runId,
    severity: verdict === "UNKNOWN_BLOCKED" ? "HIGH" : "WARNING",
    verdict,
    trigger,
    summary,
    evidenceIds: observations.map((observation) => observation.id),
    recommendedAction,
    createdAt,
  };
}

export function reconcileOrder(
  intent: Intent,
  observations: Observation[],
  providerSnapshot: OrderSnapshot | undefined,
  now = new Date().toISOString(),
): ReconciliationResult {
  const rules: RuleResult[] = [];
  const matchedFields: string[] = [];
  const mismatchedFields: string[] = [];

  const streamGap = hasStreamGap(observations);
  const duplicateObservation = hasDuplicateObservation(observations);

  rules.push({
    name: "stream_integrity",
    passed: !streamGap && !duplicateObservation,
    detail: streamGap
      ? "A local stream observation was dropped. REST reconciliation is required."
      : duplicateObservation
        ? "A duplicate local stream observation was recorded and deduplicated."
        : "No local stream fault was recorded.",
  });

  if (!providerSnapshot) {
    rules.push({
      name: "authoritative_provider_state",
      passed: false,
      detail: "No authoritative provider order state was found.",
    });

    const reconciliation: Reconciliation = {
      id: id("rec"),
      runId: intent.runId,
      intentId: intent.id,
      verdict: "UNKNOWN_BLOCKED",
      localState: streamGap || duplicateObservation ? "STREAM_UNCERTAIN" : "ORDER_UNCONFIRMED",
      providerState: "NOT_FOUND",
      matchedFields,
      mismatchedFields: ["providerOrderState"],
      ruleResults: rules,
      createdAt: now,
    };

    return {
      verdict: "UNKNOWN_BLOCKED",
      reconciliation,
      incident: incidentFor(
        intent,
        observations,
        "UNKNOWN_BLOCKED",
        "authoritative_state_missing",
        "The exchange state cannot prove whether this intent was accepted.",
        "Do not retry this intent. Inspect the provider account manually before continuing.",
        now,
      ),
    };
  }

  const snapshotStatus = canonicalStatus(providerSnapshot.status);

  const comparisons: Array<[string, boolean, string]> = [
    [
      "symbol",
      canonicalSymbol(providerSnapshot.symbol) === canonicalSymbol(intent.symbol),
      `Provider symbol ${providerSnapshot.symbol} was compared with intent ${intent.symbol}.`,
    ],
    [
      "clientOrderId",
      providerSnapshot.clientOrderId?.toLowerCase() === intent.clientOrderId.toLowerCase(),
      providerSnapshot.clientOrderId
        ? `Provider client order ID ${providerSnapshot.clientOrderId} was compared with ${intent.clientOrderId}.`
        : "Provider did not return the client order ID.",
    ],
    [
      "side",
      providerSnapshot.side === intent.side,
      providerSnapshot.side ? "Order side was compared with the intent." : "Provider did not return the order side.",
    ],
    [
      "orderType",
      providerSnapshot.orderType === intent.orderType,
      providerSnapshot.orderType ? "Order type was compared with the intent." : "Provider did not return the order type.",
    ],
    [
      "quantity",
      sameNumber(providerSnapshot.originalQuantity, intent.quantity),
      providerSnapshot.originalQuantity
        ? "Provider quantity was compared with the intent."
        : "Provider did not return the original quantity.",
    ],
  ];

  if (intent.orderType === "LIMIT") {
    comparisons.push([
      "price",
      sameNumber(providerSnapshot.price, intent.price),
      providerSnapshot.price ? "Provider price was compared with the intent." : "Provider did not return the limit price.",
    ]);
  }

  if (intent.provider === "weex" || intent.provider === "bingx") {
    comparisons.push([
      "positionSide",
      providerSnapshot.positionSide === intent.positionSide,
      providerSnapshot.positionSide
        ? "Provider position side was compared with the intent."
        : "Provider did not return the position side.",
    ]);
  }

  for (const [name, passed, detail] of comparisons) {
    rules.push({ name: `match_${name}`, passed, detail });
    (passed ? matchedFields : mismatchedFields).push(name);
  }

  rules.push({
    name: "provider_status",
    passed: snapshotStatus !== "UNKNOWN",
    detail: `Provider returned terminal or observable status ${snapshotStatus}.`,
  });

  const mismatch = mismatchedFields.length > 0;
  let verdict: Verdict;
  if (mismatch || snapshotStatus === "UNKNOWN") {
    verdict = "UNKNOWN_BLOCKED";
  } else if (snapshotStatus === "REJECTED") {
    verdict = "REJECTED";
  } else if (snapshotStatus === "PARTIALLY_FILLED") {
    verdict = "PARTIALLY_FILLED";
  } else {
    verdict = "RECONCILED";
  }

  const reconciliation: Reconciliation = {
    id: id("rec"),
    runId: intent.runId,
    intentId: intent.id,
    verdict,
    localState: streamGap || duplicateObservation ? "STREAM_REPAIRED" : "OBSERVED",
    providerState: snapshotStatus,
    matchedFields,
    mismatchedFields,
    ruleResults: rules,
    createdAt: now,
  };

  if (verdict === "UNKNOWN_BLOCKED") {
    return {
      verdict,
      reconciliation,
      incident: incidentFor(
        intent,
        observations,
        verdict,
        mismatch ? "provider_intent_mismatch" : "provider_state_unknown",
        "Provider evidence does not match the recorded intent closely enough to continue.",
        "Do not retry this intent. Resolve the mismatch from authoritative provider records.",
        now,
      ),
    };
  }

  return { verdict, reconciliation };
}
