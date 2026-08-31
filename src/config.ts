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
  if (value === undefined || value === "paper") return "paper";
  if (value === "read_only" || value === "replay") return value;
  throw new Error("VURQEN_MODE must be paper, read_only, or replay");
}

function aiProvider(value: string | undefined): AiProviderName {
  if (value === undefined || value === "gemini") return "gemini";
  if (value === "groq" || value === "none") return value;
  throw new Error("AI_PROVIDER must be gemini, groq, or none");
}

function bingxEnvironment(value: string | undefined): "prod-vst" | "prod-live" {
  if (value === undefined || value === "prod-vst") return "prod-vst";
  if (value === "prod-live") return "prod-live";
  throw new Error("BINGX_ENV must be prod-vst or prod-live");
}

function port(value: string | undefined): number {
  const parsed = Number(value ?? 8787);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return parsed;
}

function baseUrl(value: string | undefined): string {
  const raw = nonEmpty(value) ?? "https://api-contract.weex.com";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("WEEX_BASE_URL must be a valid HTTPS URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("WEEX_BASE_URL must be a valid HTTPS URL without credentials or query parameters");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function corsOrigin(value: string | undefined): string | undefined {
  const raw = nonEmpty(value);
  if (!raw) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("VURQEN_CORS_ORIGIN must be an absolute HTTP or HTTPS origin");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("VURQEN_CORS_ORIGIN must be an absolute HTTP or HTTPS origin without credentials or a path");
  }
  return parsed.origin;
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
  port: port(process.env.PORT),
  apiToken: nonEmpty(process.env.VURQEN_API_TOKEN),
  requireApiToken: process.env.NODE_ENV === "production" || Boolean(nonEmpty(process.env.VURQEN_API_TOKEN)),
  corsOrigin: corsOrigin(process.env.VURQEN_CORS_ORIGIN),
  mode: runMode(process.env.VURQEN_MODE),
  dataDir: path.resolve(process.cwd(), nonEmpty(process.env.VURQEN_DATA_DIR) ?? "./data"),
  provider: (bingxApiKey && bingxSecretKey ? "bingx" : "weex") as ProviderName,
  bingx: {
    apiKey: bingxApiKey,
    secretKey: bingxSecretKey,
    environment: bingxEnvironment(process.env.BINGX_ENV),
  },
  weex: {
    apiKey: weexApiKey,
    secretKey: weexSecretKey,
    passphrase: weexPassphrase,
    baseUrl: baseUrl(process.env.WEEX_BASE_URL),
  },
  ai: {
    provider: aiProvider(process.env.AI_PROVIDER),
    model: nonEmpty(process.env.AI_MODEL) ?? "gemini-2.5-flash",
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
    aiConfigured: Boolean(config.ai.geminiKey || config.ai.groqKey),
    bingxEnvironment: config.bingx.environment,
    bingxConfigured: hasBingxCredentials(),
    weexConfigured: hasWeexCredentials(),
  };
}
