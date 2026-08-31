import {
  BingxBalanceSchema,
  BingxContractSchema,
  BingxOrderSchema,
  BingxPositionSchema,
  Intent,
  OrderSnapshot,
  PreflightCheck,
  RunMode,
} from "../core/schemas";
import { fetchSigned } from "./bingx-auth";
import { ExchangeProvider, ProviderOrderResult } from "./types";
import { captureBingxTicker } from "./websocket";

type BingxConfig = {
  apiKey?: string;
  secretKey?: string;
  environment: "prod-vst" | "prod-live";
};

function safeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300);
  return "Unknown provider error";
}

function orderType(intent: Intent): "MARKET" | "LIMIT" {
  return intent.orderType;
}

function toTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function toSnapshot(raw: unknown): OrderSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const candidate = record.order && typeof record.order === "object" ? record.order : raw;
  const parsed = BingxOrderSchema.safeParse(candidate);
  if (!parsed.success) return undefined;
  const order = parsed.data;
  const rawProviderOrderId = order.orderID !== undefined ? String(order.orderID) : order.orderId !== undefined ? String(order.orderId) : undefined;
  const providerOrderId = rawProviderOrderId || undefined;
  const status = order.status?.toUpperCase();
  const normalizedStatus = status === "CANCELLED" ? "CANCELED" : status;
  const allowedStatuses = ["NEW", "PARTIALLY_FILLED", "FILLED", "CANCELED", "EXPIRED", "REJECTED"] as const;
  const safeStatus = allowedStatuses.includes(normalizedStatus as (typeof allowedStatuses)[number])
    ? (normalizedStatus as (typeof allowedStatuses)[number])
    : "UNKNOWN";
  const asString = (value: string | number | undefined): string | undefined => value === undefined ? undefined : String(value);

  return {
    providerOrderId,
    clientOrderId: order.clientOrderId ?? order.clientOrderID,
    symbol: order.symbol,
    side: order.side === "BUY" || order.side === "SELL" ? order.side : undefined,
    orderType: order.type === "MARKET" || order.type === "LIMIT" ? order.type : undefined,
    status: safeStatus,
    originalQuantity: asString(order.origQty ?? order.quantity),
    executedQuantity: asString(order.executedQty),
    price: asString(order.price),
    providerTimestamp: toTimestamp(order.updateTime ?? order.time),
  };
}

export class BingxProvider implements ExchangeProvider {
  readonly name = "bingx" as const;
  readonly environment: "prod-vst" | "prod-live";
  readonly configured: boolean;

  private readonly apiKey?: string;
  private readonly secretKey?: string;

  constructor(config: BingxConfig) {
    this.apiKey = config.apiKey;
    this.secretKey = config.secretKey;
    this.environment = config.environment;
    this.configured = Boolean(this.apiKey && this.secretKey);
  }

  private requireCredentials(): { apiKey: string; secretKey: string } {
    if (!this.apiKey || !this.secretKey) {
      throw new Error("BingX credentials are not configured");
    }
    return { apiKey: this.apiKey, secretKey: this.secretKey };
  }

  private async request(
    method: "GET" | "POST" | "DELETE",
    requestPath: string,
    params: Record<string, unknown> = {},
    jsonBody = false,
  ): Promise<unknown> {
    const credentials = this.requireCredentials();
    return fetchSigned(this.environment, credentials.apiKey, credentials.secretKey, method, requestPath, params, jsonBody);
  }

  async getBalance(): Promise<unknown> {
    const data = await this.request("GET", "/openApi/swap/v3/user/balance", { recvWindow: 5000 });
    return BingxBalanceSchema.array().parse(data);
  }

  async getPositions(symbol?: string): Promise<unknown> {
    const data = await this.request("GET", "/openApi/swap/v2/user/positions", symbol ? { symbol, recvWindow: 5000 } : { recvWindow: 5000 });
    return BingxPositionSchema.array().parse(data);
  }

  async getContracts(symbol?: string): Promise<unknown> {
    const data = await this.request(
      "GET",
      "/openApi/swap/v2/quote/contracts",
      symbol ? { symbol, recvWindow: 5000 } : { recvWindow: 5000 },
    );
    const array = Array.isArray(data) ? data : [data];
    return BingxContractSchema.array().parse(array);
  }

  async getOrderHistory(symbol?: string): Promise<unknown> {
    const data = await this.request(
      "GET",
      "/openApi/swap/v2/trade/allOrders",
      symbol ? { symbol, limit: 500, recvWindow: 5000 } : { limit: 500, recvWindow: 5000 },
    );
    const array = Array.isArray(data) ? data : [];
    return BingxOrderSchema.array().parse(array);
  }

  async preflight(mode: RunMode): Promise<PreflightCheck[]> {
    const checks: PreflightCheck[] = [
      {
        name: "provider_environment",
        status: mode === "paper" && this.environment !== "prod-vst" ? "FAIL" : mode === "replay" || mode === "read_only" || this.environment === "prod-vst" ? "PASS" : "WARN",
        detail: mode === "paper" && this.environment !== "prod-vst"
          ? `Paper mode cannot use the ${this.environment} environment.`
          : `BingX environment is ${this.environment}.`,
        source: "configuration",
      },
      {
        name: "credentials",
        status: this.configured ? "PASS" : "FAIL",
        detail: this.configured ? "BingX API credentials are configured server-side." : "BingX API credentials are missing.",
        source: "configuration",
      },
    ];

    if (!this.configured) return checks;

    try {
      await this.getBalance();
      checks.push({
        name: "account_balance",
        status: "PASS",
        detail: "BingX returned an account balance response.",
        source: "BingX /openApi/swap/v3/user/balance",
      });
    } catch (error) {
      checks.push({
        name: "account_balance",
        status: "FAIL",
        detail: safeError(error),
        source: "BingX /openApi/swap/v3/user/balance",
      });
    }

    try {
      const contracts = (await this.getContracts("BTC-USDT")) as unknown[];
      checks.push({
        name: "symbol_contract",
        status: contracts.length > 0 ? "PASS" : "FAIL",
        detail: contracts.length > 0 ? "BTC-USDT contract metadata is available." : "BTC-USDT contract metadata was empty.",
        source: "BingX /openApi/swap/v2/quote/contracts",
      });
    } catch (error) {
      checks.push({
        name: "symbol_contract",
        status: "FAIL",
        detail: safeError(error),
        source: "BingX /openApi/swap/v2/quote/contracts",
      });
    }

    return checks;
  }

  async getOrderSnapshot(intent: Intent): Promise<OrderSnapshot | undefined> {
    const data = await this.getOrderHistory(intent.symbol);
    const orders = BingxOrderSchema.array().parse(data);
    const matching = orders.find(
      (order) => order.clientOrderId?.toLowerCase() === intent.clientOrderId.toLowerCase(),
    );
    return toSnapshot(matching);
  }

  async validateOrder(intent: Intent): Promise<ProviderOrderResult> {
    if (intent.mode === "paper" && this.environment !== "prod-vst") {
      throw new Error("BingX paper order validation requires the prod-vst environment");
    }
    const raw = await this.request(
      "POST",
      "/openApi/swap/v2/trade/order/test",
      {
        clientOrderId: intent.clientOrderId,
        positionSide: "BOTH",
        quantity: Number(intent.quantity),
        recvWindow: 5000,
        side: intent.side,
        symbol: intent.symbol,
        type: orderType(intent),
        ...(intent.price ? { price: Number(intent.price), timeInForce: "GTC" } : {}),
      },
    );
    return { raw, snapshot: toSnapshot(raw) };
  }

  async submitPaperOrder(intent: Intent): Promise<ProviderOrderResult> {
    if (this.environment !== "prod-vst") {
      throw new Error("BingX paper orders require the prod-vst environment");
    }
    const raw = await this.request(
      "POST",
      "/openApi/swap/v2/trade/order",
      {
        clientOrderId: intent.clientOrderId,
        positionSide: "BOTH",
        quantity: Number(intent.quantity),
        recvWindow: 5000,
        side: intent.side,
        symbol: intent.symbol,
        type: orderType(intent),
        ...(intent.price ? { price: Number(intent.price), timeInForce: "GTC" } : {}),
      },
    );
    return { raw, snapshot: toSnapshot(raw) };
  }

  async captureMarketObservation(symbol: string): Promise<unknown> {
    return this.request("GET", "/openApi/swap/v2/quote/ticker", { symbol, recvWindow: 5000 });
  }

  async captureStreamObservation(symbol: string): Promise<unknown> {
    return captureBingxTicker(symbol);
  }
}
