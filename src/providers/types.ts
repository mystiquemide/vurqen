import { Intent, OrderSnapshot, PreflightCheck, ProviderName, RunMode } from "../core/schemas";

export type ProviderEnvironment = "prod-vst" | "prod-live" | "paper" | "public";

export type ProviderOrderResult = {
  raw: unknown;
  snapshot?: OrderSnapshot;
};

export interface ExchangeProvider {
  readonly name: ProviderName;
  readonly environment: ProviderEnvironment;
  readonly configured: boolean;
  preflight(mode: RunMode): Promise<PreflightCheck[]>;
  getOrderSnapshot(intent: Intent): Promise<OrderSnapshot | undefined>;
  validateOrder(intent: Intent): Promise<ProviderOrderResult>;
  submitPaperOrder(intent: Intent): Promise<ProviderOrderResult>;
  captureMarketObservation(symbol: string): Promise<unknown>;
  captureStreamObservation(symbol: string): Promise<unknown>;
}
