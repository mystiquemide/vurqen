import * as crypto from "node:crypto";
import JSONBig from "json-bigint";
import { stableStringify } from "../core/ids";

const JSONBigParse = JSONBig({ storeAsString: true });

export type WeexRequestOptions = {
  baseUrl: string;
  apiKey?: string;
  secretKey?: string;
  passphrase?: string;
  method: "GET" | "POST" | "DELETE";
  requestPath: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  authenticated?: boolean;
};

export function buildWeexQuery(query: Record<string, string | number | boolean | undefined> = {}): string {
  return Object.keys(query)
    .filter((key) => query[key] !== undefined)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(String(query[key]))}`)
    .join("&");
}

export function weexSignature(
  secretKey: string,
  timestamp: string,
  method: string,
  requestPath: string,
  queryString: string,
  body: string,
): string {
  const message = timestamp + method.toUpperCase() + requestPath + (queryString ? `?${queryString}` : "") + body;
  return crypto.createHmac("sha256", secretKey).update(message).digest("base64");
}

export async function fetchWeex(options: WeexRequestOptions): Promise<unknown> {
  const queryString = buildWeexQuery(options.query);
  const body = options.body ? stableStringify(options.body) : "";
  const url = `${options.baseUrl}${options.requestPath}${queryString ? `?${queryString}` : ""}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Vurqen/0.1",
  };

  if (options.authenticated) {
    if (!options.apiKey || !options.secretKey || !options.passphrase) {
      throw new Error("WEEX credentials are not configured");
    }
    const timestamp = String(Date.now());
    headers["ACCESS-KEY"] = options.apiKey;
    headers["ACCESS-PASSPHRASE"] = options.passphrase;
    headers["ACCESS-TIMESTAMP"] = timestamp;
    headers["ACCESS-SIGN"] = weexSignature(options.secretKey, timestamp, options.method, options.requestPath, queryString, body);
  }

  const response = await fetch(url, {
    method: options.method,
    headers,
    body: options.method === "GET" ? undefined : body || undefined,
    signal: AbortSignal.timeout(10000),
  });
  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = JSONBigParse.parse(raw);
  } catch {
    throw new Error(`WEEX returned non-JSON response with HTTP ${response.status}`);
  }

  if (!response.ok) {
    const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
    throw new Error(`WEEX HTTP ${response.status}: ${String(record?.msg ?? record?.errorMessage ?? "request failed").slice(0, 300)}`);
  }
  const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  if (record?.success === false) {
    throw new Error(`WEEX order rejected ${String(record.errorCode ?? "unknown")}: ${String(record.errorMessage ?? "request failed").slice(0, 300)}`);
  }
  if (typeof record?.code === "number" && record.code !== 0) {
    throw new Error(`WEEX error ${record.code}: ${String(record.msg ?? "request failed").slice(0, 300)}`);
  }
  return parsed;
}
