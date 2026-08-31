import { config, hasBingxCredentials, hasWeexCredentials } from "../config";
import { BingxProvider } from "./bingx";
import { FallbackExplainer, GeminiExplainer, GroqExplainer, IncidentExplainer } from "./ai";
import { ExchangeProvider } from "./types";
import { WeexProvider } from "./weex";

export function createProviders(): Record<"bingx" | "weex", ExchangeProvider> {
  return {
    bingx: new BingxProvider({
      apiKey: config.bingx.apiKey,
      secretKey: config.bingx.secretKey,
      environment: config.bingx.environment,
    }),
    weex: new WeexProvider({
      apiKey: config.weex.apiKey,
      secretKey: config.weex.secretKey,
      passphrase: config.weex.passphrase,
      baseUrl: config.weex.baseUrl,
    }),
  };
}

export function createExplainer(): IncidentExplainer | undefined {
  const fallback = config.ai.groqKey ? new GroqExplainer(config.ai.groqKey) : undefined;
  if (config.ai.provider === "none") return undefined;
  if (config.ai.provider === "groq" && config.ai.groqKey) return new FallbackExplainer(new GroqExplainer(config.ai.groqKey), undefined);
  if (config.ai.geminiKey) {
    const primary = new GeminiExplainer(config.ai.geminiKey, config.ai.model);
    return new FallbackExplainer(primary, fallback);
  }
  return fallback;
}

export function providerReadiness() {
  return {
    activeProvider: config.provider,
    bingx: hasBingxCredentials(),
    weex: hasWeexCredentials(),
    ai: config.ai.provider,
    aiModel: config.ai.model,
  };
}
