import {
  Intent,
  OrderSnapshot,
  PreflightCheck,
  RunMode,
  WeexBalanceSchema,
  WeexExchangeInfoSchema,
  WeexOrderSchema,
  WeexPositionSchema,
} from "../core/schemas";
import { fetchWeex } from "./weex-auth";
import { ExchangeProvider, ProviderOrderResult } from "./types";
import { captureWeexTicker } from "./websocket";

type WeexConfig = {
  apiKey?: string;
  secretKey?: string;
  passphrase?: string;
  baseUrl: string;
};

function safeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300);
  return "Unknown provider error";
}

function weexSymbol(symbol: string): string {
  return symbol.replaceAll("-", "").toUpperCase();
}

function timestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function dataFrom(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const record = raw as Record<string, unknown>;
  return record.data ?? raw;
}

function asString(value: string | number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function defaultPositionSide(intent: Intent): "LONG" | "SHORT" {
  return intent.positionSide;
}

function snapshotFrom(raw: unknown): OrderSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const candidate = dataFrom(raw);
  if (!candidate || typeof candidate !== "object") return undefined;
  const parsed = WeexOrderSchema.safeParse(candidate);
  if (!parsed.success) return undefined;
  const record = parsed.data;
  const statusRaw = typeof record.status === "string" ? record.status.toUpperCase() : "UNKNOWN";
  const status = ["NEW", "PARTIALLY_FILLED", "FILLED", "CANCELED", "CANCELLED", "EXPIRED", "REJECTED"].includes(statusRaw)
    ? (statusRaw === "CANCELLED" ? "CANCELED" : statusRaw)
    : "UNKNOWN";
  const side = record.side === "BUY" || record.side === "SELL" ? record.side : undefined;
  const orderType = record.type === "MARKET" || record.type === "LIMIT" ? record.type : undefined;
  const positionSide = record.positionSide === "LONG" || record.positionSide === "SHORT" ? record.positionSide : undefined;
  const providerOrderId = asString(record.orderId);

  return {
    providerOrderId,
    clientOrderId: record.clientOrderId,
    symbol: record.symbol.toUpperCase(),
    side,
    orderType,
    positionSide,
    status: status as OrderSnapshot["status"],
    originalQuantity: asString(record.origQty),
    executedQuantity: asString(record.executedQty),
    price: asString(record.price),
    providerTimestamp: timestamp(record.updateTime ?? record.time),
  };
}

export class WeexProvider implements ExchangeProvider {
  readonly name = "weex" as const;
  readonly environment = "paper" as const;
  readonly configured: boolean;

  private readonly config: WeexConfig;

  constructor(config: WeexConfig) {
    this.config = config;
    this.configured = Boolean(config.apiKey && config.secretKey && config.passphrase);
  }

  private async request(
    method: "GET" | "POST" | "DELETE",
    requestPath: string,
    query: Record<string, string | number | boolean | undefined> = {},
    body?: Record<string, unknown>,
    authenticated = true,
  ): Promise<unknown> {
    return fetchWeex({
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      secretKey: this.config.secretKey,
      passphrase: this.config.passphrase,
      method,
      requestPath,
      query,
      body,
      authenticated,
    });
  }

  async getBalance(): Promise<unknown> {
    const data = dataFrom(await this.request("GET", "/capi/v3/sim/balance"));
    return WeexBalanceSchema.array().parse(data);
  }

  async getPositions(): Promise<unknown> {
    const data = dataFrom(await this.request("GET", "/capi/v3/sim/position/allPosition"));
    return WeexPositionSchema.array().parse(data);
  }

  async getOrderHistory(symbol?: string): Promise<unknown> {
    const data = dataFrom(await this.request("GET", "/capi/v3/sim/order/history", {
      limit: 500,
      page: 0,
      symbol: symbol ? weexSymbol(symbol) : undefined,
    }));
    return WeexOrderSchema.array().parse(data);
  }

  async getExchangeInfo(symbol?: string): Promise<unknown> {
    const data = dataFrom(await this.request(
      "GET",
      "/capi/v3/market/exchangeInfo",
      { symbol: symbol ? weexSymbol(symbol) : undefined },
      undefined,
      false,
    ));
    return WeexExchangeInfoSchema.parse(data);
  }

  async preflight(mode: RunMode): Promise<PreflightCheck[]> {
    const checks: PreflightCheck[] = [
      {
        name: "provider_environment",
        status: "PASS",
        detail: `WEEX provider is configured for paper endpoints in ${mode} mode.`,
        source: "configuration",
      },
      {
        name: "credentials",
        status: this.configured ? "PASS" : "FAIL",
        detail: this.configured ? "WEEX credentials are configured server-side." : "WEEX credentials are not available yet.",
        source: "configuration",
      },
    ];

    try {
      const info = await this.getExchangeInfo("BTCUSDT");
      checks.push({
        name: "public_exchange_info",
        status: info ? "PASS" : "FAIL",
        detail: "WEEX returned public contract metadata.",
        source: "WEEX /capi/v3/market/exchangeInfo",
      });
    } catch (error) {
      checks.push({
        name: "public_exchange_info",
        status: "FAIL",
        detail: safeError(error),
        source: "WEEX /capi/v3/market/exchangeInfo",
      });
    }

    if (!this.configured) return checks;

    try {
      await this.getBalance();
      checks.push({
        name: "paper_balance",
        status: "PASS",
        detail: "WEEX returned a paper balance response.",
        source: "WEEX /capi/v3/sim/balance",
      });
    } catch (error) {
      checks.push({
        name: "paper_balance",
        status: "FAIL",
        detail: safeError(error),
        source: "WEEX /capi/v3/sim/balance",
      });
    }

    return checks;
  }

  async getOrderSnapshot(intent: Intent): Promise<OrderSnapshot | undefined> {
    const raw = await this.getOrderHistory(intent.symbol);
    const orders = Array.isArray(raw) ? raw : [];
    const matching = orders.find(
      (order) => typeof order === "object" && order !== null &&
        String((order as Record<string, unknown>).clientOrderId ?? "").toLowerCase() === intent.clientOrderId.toLowerCase(),
    );
    return snapshotFrom(matching);
  }

  async validateOrder(intent: Intent): Promise<ProviderOrderResult> {
    if (intent.mode !== "paper") {
      throw new Error("WEEX order validation is available only in paper mode");
    }
    const exchangeInfo = await this.getExchangeInfo(intent.symbol);
    return {
      raw: {
        validated: true,
        exchangeInfo,
        symbol: weexSymbol(intent.symbol),
        side: intent.side,
        orderType: intent.orderType,
      },
    };
  }

  async submitPaperOrder(intent: Intent): Promise<ProviderOrderResult> {
    if (intent.mode !== "paper") {
      throw new Error("WEEX paper orders require paper mode");
    }
    const raw = await this.request("POST", "/capi/v3/sim/order", undefined, {
      symbol: weexSymbol(intent.symbol),
      side: intent.side,
      positionSide: defaultPositionSide(intent),
      type: intent.orderType,
      ...(intent.orderType === "LIMIT" ? { timeInForce: "GTC", price: intent.price } : {}),
      quantity: intent.quantity,
      newClientOrderId: intent.clientOrderId,
    });
    return { raw, snapshot: snapshotFrom(raw) };
  }

  async captureMarketObservation(symbol: string): Promise<unknown> {
    return this.request(
      "GET",
      "/capi/v3/market/exchangeInfo",
      { symbol: weexSymbol(symbol) },
      undefined,
      false,
    );
  }

  async captureStreamObservation(symbol: string): Promise<unknown> {
    return captureWeexTicker(symbol);
  }
}
