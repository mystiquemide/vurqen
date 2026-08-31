import { z } from "zod";

export const RunModeSchema = z.enum(["paper", "read_only", "replay"]);
export type RunMode = z.infer<typeof RunModeSchema>;

export const ProviderNameSchema = z.enum(["bingx", "weex"]);
export type ProviderName = z.infer<typeof ProviderNameSchema>;

export const OrderSideSchema = z.enum(["BUY", "SELL"]);
export const OrderTypeSchema = z.enum(["MARKET", "LIMIT"]);
export const PositionSideSchema = z.enum(["LONG", "SHORT"]);
export const OrderStatusSchema = z.enum([
  "NEW",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELED",
  "CANCELLED",
  "EXPIRED",
  "REJECTED",
  "UNKNOWN",
]);

export const RunStatusSchema = z.enum([
  "CREATED",
  "PREFLIGHT_PASSED",
  "INTENT_RECORDED",
  "ORDER_SUBMITTED",
  "OBSERVING",
  "RECONCILING",
  "RECONCILED",
  "INCIDENT",
  "UNKNOWN_BLOCKED",
  "PROVIDER_UNAVAILABLE",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunSchema = z.object({
  id: z.string(),
  provider: ProviderNameSchema,
  mode: RunModeSchema,
  status: RunStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  intentId: z.string().optional(),
  faultCount: z.number().int().nonnegative(),
});
export type Run = z.infer<typeof RunSchema>;

export const VerdictSchema = z.enum([
  "RECONCILED",
  "REJECTED",
  "PARTIALLY_FILLED",
  "UNKNOWN_BLOCKED",
  "PROVIDER_UNAVAILABLE",
]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const SourceSchema = z.enum(["REST", "WEBSOCKET", "LOCAL_FAULT", "REPLAY"]);
export type ObservationSource = z.infer<typeof SourceSchema>;

export const CreateRunInputSchema = z.object({
  provider: ProviderNameSchema.optional(),
  mode: RunModeSchema.optional(),
});

const PositiveDecimalSchema = z.string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "must be a decimal number")
  .refine((value) => /[1-9]/.test(value.replace(".", "")), "must be greater than zero");

function validateIntent(value: { orderType: z.infer<typeof OrderTypeSchema>; price?: string }, context: z.RefinementCtx): void {
  if (value.orderType === "LIMIT" && value.price === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["price"], message: "limit orders require a price" });
  }
}

const IntentFieldsSchema = z.object({
  symbol: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
  side: OrderSideSchema,
  orderType: OrderTypeSchema,
  positionSide: PositionSideSchema.default("LONG"),
  quantity: PositiveDecimalSchema,
  price: PositiveDecimalSchema.optional(),
  clientOrderId: z.string().trim().min(1).max(36).regex(/^[A-Za-z0-9._-]+$/).optional(),
  submit: z.boolean().optional().default(false),
});

export const IntentInputSchema = IntentFieldsSchema.superRefine(validateIntent);
export type IntentInput = z.infer<typeof IntentInputSchema>;

export const FaultInputSchema = z.object({
  type: z.enum(["drop_event", "duplicate_event"]),
  observationId: z.string().min(1).optional(),
});

export const ObservationInputSchema = z.object({
  source: z.enum(["REPLAY", "WEBSOCKET", "REST"]),
  eventType: z.string().trim().min(1).max(80),
  providerTimestamp: z.number().int().nonnegative().optional(),
  payload: z.unknown(),
  sequence: z.number().int().nonnegative().optional(),
});

export const PreflightCheckSchema = z.object({
  name: z.string(),
  status: z.enum(["PASS", "WARN", "FAIL", "SKIP"]),
  detail: z.string(),
  source: z.string().optional(),
});
export type PreflightCheck = z.infer<typeof PreflightCheckSchema>;

export const PreflightResultSchema = z.object({
  provider: ProviderNameSchema,
  mode: RunModeSchema,
  status: z.enum(["PASS", "WARN", "FAIL"]),
  checks: z.array(PreflightCheckSchema),
  checkedAt: z.string(),
});
export type PreflightResult = z.infer<typeof PreflightResultSchema>;

export const IntentSchema = IntentFieldsSchema.omit({ submit: true }).extend({
  id: z.string(),
  runId: z.string(),
  provider: ProviderNameSchema,
  mode: RunModeSchema,
  clientOrderId: z.string().trim().min(1).max(36).regex(/^[A-Za-z0-9._-]+$/),
  createdAt: z.string(),
}).superRefine(validateIntent);
export type Intent = z.infer<typeof IntentSchema>;

export const ObservationSchema = z.object({
  id: z.string(),
  runId: z.string(),
  source: SourceSchema,
  eventType: z.string(),
  providerTimestamp: z.number().int().nonnegative().optional(),
  receivedAt: z.string(),
  payloadHash: z.string().length(64),
  payload: z.unknown(),
  sequence: z.number().int().nonnegative().optional(),
  relatedIntentId: z.string().optional(),
  faultType: z.enum(["drop_event", "duplicate_event"]).optional(),
});
export type Observation = z.infer<typeof ObservationSchema>;

export const OrderSnapshotSchema = z.object({
  providerOrderId: z.string().optional(),
  clientOrderId: z.string().optional(),
  symbol: z.string(),
  side: OrderSideSchema.optional(),
  positionSide: z.enum(["BOTH", "LONG", "SHORT"]).optional(),
  orderType: OrderTypeSchema.optional(),
  status: OrderStatusSchema,
  originalQuantity: z.string().optional(),
  executedQuantity: z.string().optional(),
  price: z.string().optional(),
  providerTimestamp: z.number().int().nonnegative().optional(),
});
export type OrderSnapshot = z.infer<typeof OrderSnapshotSchema>;

export const ReconciliationSchema = z.object({
  id: z.string(),
  runId: z.string(),
  intentId: z.string(),
  verdict: VerdictSchema,
  localState: z.string(),
  providerState: z.string(),
  matchedFields: z.array(z.string()),
  mismatchedFields: z.array(z.string()),
  ruleResults: z.array(z.object({ name: z.string(), passed: z.boolean(), detail: z.string() })),
  createdAt: z.string(),
});
export type Reconciliation = z.infer<typeof ReconciliationSchema>;

export const AgentActionSchema = z.object({
  id: z.string(),
  runId: z.string(),
  action: z.enum([
    "inspect_market_stream",
    "inspect_order_history",
    "inspect_positions",
    "inspect_balance",
    "reconcile_order",
    "stop_unresolved_run",
  ]),
  reason: z.string(),
  inputEvidenceIds: z.array(z.string()),
  outputEvidenceIds: z.array(z.string()),
  createdAt: z.string(),
});
export type AgentAction = z.infer<typeof AgentActionSchema>;

export const IncidentSchema = z.object({
  id: z.string(),
  runId: z.string(),
  severity: z.enum(["INFO", "WARNING", "HIGH"]),
  verdict: VerdictSchema,
  trigger: z.string(),
  summary: z.string(),
  evidenceIds: z.array(z.string()),
  recommendedAction: z.string(),
  createdAt: z.string(),
});
export type Incident = z.infer<typeof IncidentSchema>;

export const AiExplanationSchema = z.object({
  headline: z.string().min(1).max(180),
  explanation: z.string().min(1).max(2000),
  nextAction: z.string().min(1).max(500),
  evidenceIds: z.array(z.string()),
});
export type AiExplanation = z.infer<typeof AiExplanationSchema>;

export const ReceiptSchema = z.object({
  schemaVersion: z.literal("1.0"),
  receiptId: z.string(),
  runId: z.string(),
  provider: ProviderNameSchema,
  mode: RunModeSchema,
  verdict: VerdictSchema,
  createdAt: z.string(),
  intent: IntentSchema,
  observations: z.array(ObservationSchema),
  reconciliation: ReconciliationSchema.optional(),
  incident: IncidentSchema.optional(),
  agentActions: z.array(AgentActionSchema),
  aiExplanation: AiExplanationSchema.optional(),
  evidenceDigest: z.string().length(64),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

export const BingxBalanceSchema = z.object({
  userId: z.string().optional(),
  asset: z.string(),
  balance: z.string(),
  equity: z.string().optional(),
  unrealizedProfit: z.string().optional(),
  realisedProfit: z.string().optional(),
  availableMargin: z.string().optional(),
  usedMargin: z.string().optional(),
  freezedMargin: z.string().optional(),
});

export const BingxPositionSchema = z.object({
  positionId: z.union([z.string(), z.number()]).optional(),
  symbol: z.string(),
  positionSide: z.string(),
  isolated: z.boolean().optional(),
  positionAmt: z.string(),
  availableAmt: z.string().optional(),
  unrealizedProfit: z.string().optional(),
  realisedProfit: z.string().optional(),
  initialMargin: z.string().optional(),
  liquidationPrice: z.union([z.string(), z.number()]).optional(),
  avgPrice: z.string().optional(),
  leverage: z.union([z.string(), z.number()]).optional(),
  positionValue: z.string().optional(),
  currency: z.string().optional(),
});

export const BingxContractSchema = z.object({
  contractId: z.union([z.string(), z.number()]).optional(),
  symbol: z.string(),
  quantityPrecision: z.number().optional(),
  pricePrecision: z.number().optional(),
  tradeMinQuantity: z.number().optional(),
  tradeMinUSDT: z.number().optional(),
  status: z.number().optional(),
  apiStateOpen: z.string().optional(),
  apiStateClose: z.string().optional(),
});

export const BingxOrderSchema = z.object({
  orderId: z.union([z.string(), z.number()]).optional(),
  orderID: z.union([z.string(), z.number()]).optional(),
  symbol: z.string(),
  side: z.string().optional(),
  positionSide: z.string().optional(),
  type: z.string().optional(),
  origQty: z.union([z.string(), z.number()]).optional(),
  quantity: z.union([z.string(), z.number()]).optional(),
  executedQty: z.union([z.string(), z.number()]).optional(),
  price: z.union([z.string(), z.number()]).optional(),
  stopPrice: z.union([z.string(), z.number()]).optional(),
  status: z.string().optional(),
  clientOrderId: z.string().optional(),
  clientOrderID: z.string().optional(),
  time: z.union([z.string(), z.number()]).optional(),
  updateTime: z.union([z.string(), z.number()]).optional(),
});

export const WeexBalanceSchema = z.object({
  asset: z.string(),
  balance: z.string(),
  availableBalance: z.string().optional(),
  frozen: z.string().optional(),
  unrealizePnl: z.string().optional(),
});

export const WeexPositionSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  asset: z.string().optional(),
  symbol: z.string(),
  side: z.string(),
  size: z.string(),
  leverage: z.union([z.string(), z.number()]).optional(),
  marginSize: z.string().optional(),
  unrealizePnl: z.string().optional(),
  liquidatePrice: z.string().optional(),
  createdTime: z.union([z.string(), z.number()]).optional(),
  updatedTime: z.union([z.string(), z.number()]).optional(),
});

export const WeexOrderSchema = z.object({
  orderId: z.union([z.string(), z.number()]).optional(),
  clientOrderId: z.string().optional(),
  symbol: z.string(),
  side: z.string().optional(),
  positionSide: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  time: z.union([z.string(), z.number()]).optional(),
  updateTime: z.union([z.string(), z.number()]).optional(),
  price: z.union([z.string(), z.number()]).optional(),
  origQty: z.union([z.string(), z.number()]).optional(),
  executedQty: z.union([z.string(), z.number()]).optional(),
});

export const WeexExchangeInfoSchema = z.object({
  assets: z.array(z.unknown()).optional(),
  rateLimits: z.array(z.unknown()).optional(),
  symbols: z.array(z.unknown()).optional(),
  maxPositionSize: z.union([z.string(), z.number()]).optional(),
  marketOpenLimitSize: z.union([z.string(), z.number()]).optional(),
}).passthrough();
