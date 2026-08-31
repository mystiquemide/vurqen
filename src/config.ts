import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: process.env.VURQEN_ENV_FILE ?? path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export type RunMode = "paper" | "read_only" | "replay";
export type ProviderName = "bingx" | "weex";
export type AiProviderName = "gemini" | "groq" | "none";

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function runMode(value: string | undefined): RunMode {
  if (value === "read_only" || value === "replay") return value;
  return "paper";
}

function aiProvider(value: string | undefined): AiProviderName {
  if (value === "groq" || value === "none") return value;
  return "gemini";
}

const bingxApiKey = nonEmpty(process.env.BINGX_API_KEY);
const bingxSecretKey = nonEmpty(process.env.BINGX_SECRET_KEY);
const weexApiKey = nonEmpty(process.env.WEEX_API_KEY);
const weexSecretKey = nonEmpty(process.env.WEEX_SECRET_KEY);
const weexPassphrase = nonEmpty(process.env.WEEX_PASSPHRASE);
const genericAiKey = nonEmpty(process.env.AI_API_KEY);
const geminiKey = nonEmpty(process.env.GEMINI_API_KEY) ?? (aiProvider(process.env.AI_PROVIDER) === "gemini" ? genericAiKey : undefined);
const groqKey = nonEmpty(process.env.GROQ_API_KEY) ?? (aiProvider(process.env.AI_PROVIDER) === "groq" ? genericAiKey : undefined);

export const config = {
  port: Number(process.env.PORT ?? 8787),
  apiToken: nonEmpty(process.env.VURQEN_API_TOKEN),
  requireApiToken: process.env.NODE_ENV === "production" || Boolean(nonEmpty(process.env.VURQEN_API_TOKEN)),
  mode: runMode(process.env.VURQEN_MODE),
  dataDir: path.resolve(process.cwd(), process.env.VURQEN_DATA_DIR ?? "./data"),
  provider: (bingxApiKey && bingxSecretKey ? "bingx" : "weex") as ProviderName,
  bingx: {
    apiKey: bingxApiKey,
    secretKey: bingxSecretKey,
    environment: process.env.BINGX_ENV === "prod-live" ? "prod-live" : "prod-vst",
  },
  weex: {
    apiKey: weexApiKey,
    secretKey: weexSecretKey,
    passphrase: weexPassphrase,
    baseUrl: process.env.WEEX_BASE_URL ?? "https://api-contract.weex.com",
  },
  ai: {
    provider: aiProvider(process.env.AI_PROVIDER),
    model: process.env.AI_MODEL ?? "gemini-2.5-flash",
    geminiKey,
    groqKey,
  },
} as const;

export function hasBingxCredentials(): boolean {
  return Boolean(config.bingx.apiKey && config.bingx.secretKey);
}

export function hasWeexCredentials(): boolean {
  return Boolean(config.weex.apiKey && config.weex.secretKey && config.weex.passphrase);
}

export function publicConfig() {
  return {
    provider: config.provider,
    mode: config.mode,
    aiProvider: config.ai.provider,
    aiModel: config.ai.model,
    bingxEnvironment: config.bingx.environment,
    bingxConfigured: hasBingxCredentials(),
    weexConfigured: hasWeexCredentials(),
  };
}
