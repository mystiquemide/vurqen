import * as crypto from "crypto";
import JSONBig from "json-bigint";
const JSONBigParse = JSONBig({ storeAsString: true });

const ENV_URLS: Record<string, string[]> = {
  "prod-live": ["https://open-api.bingx.com", "https://open-api.bingx.pro"],
  "prod-vst": ["https://open-api-vst.bingx.com", "https://open-api-vst.bingx.pro"],
};

function isNetworkOrTimeout(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  if (e instanceof DOMException && e.name === "AbortError") return true;
  if (e instanceof Error && e.name === "TimeoutError") return true;
  return false;
}

/**
 * Reject parameter values containing query-string metacharacters to prevent
 * signed parameter pollution.
 */
function validateParams(params: Record<string, unknown>): void {
  const FORBIDDEN = /[&=?#\r\n]/;
  for (const [k, v] of Object.entries(params)) {
    const s = String(v);
    if (FORBIDDEN.test(s)) {
      throw new Error(
        `Parameter "${k}" contains forbidden character in value: "${s}". ` +
          "Possible parameter injection attempt.",
      );
    }
  }
}

/**
 * Build the canonical signing string: ASCII-sort all keys, join as key=value pairs.
 * Values must NOT be URL-encoded at this stage.
 */
function buildCanonical(params: Record<string, unknown>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
}

/**
 * URL-encode only the values in a query string when the canonical string
 * contains '[' or '{' (e.g. batch order arrays).
 */
function encodeQueryValues(params: Record<string, unknown>, signature: string): string {
  const pairs = Object.keys(params)
    .sort()
    .map((k) => {
      const v = String(params[k]);
      const needsEncoding = v.includes("[") || v.includes("{");
      return `${k}=${needsEncoding ? encodeURIComponent(v) : v}`;
    });
  pairs.push(`signature=${signature}`);
  return pairs.join("&");
}

/**
 * Make a signed BingX REST request.
 *
 * @param jsonBody - When true, sends POST body as application/json with
 *                   timestamp and signature embedded in the JSON object.
 *                   When false (default), uses application/x-www-form-urlencoded.
 */
async function fetchSigned(
  env: string,
  apiKey: string,
  secretKey: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, unknown> = {},
  jsonBody = false,
): Promise<unknown> {
  const baseUrls = ENV_URLS[env] ?? ENV_URLS["prod-live"];
  const timestamp = Date.now();
  const allParams = { ...params, timestamp };

  validateParams(allParams);

  const canonical = buildCanonical(allParams);

  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(canonical)
    .digest("hex");

  const needsValueEncoding = canonical.includes("[") || canonical.includes("{");

  for (const baseUrl of baseUrls) {
    try {
      let url: string;
      let body: string | undefined;
      let contentType: string | undefined;

      if (method === "POST" && jsonBody) {
        url = `${baseUrl}${path}`;
        body = JSON.stringify({ ...allParams, signature });
        contentType = "application/json";
      } else if (method === "POST") {
        url = `${baseUrl}${path}`;
        body = `${canonical}&signature=${signature}`;
        contentType = "application/x-www-form-urlencoded";
      } else {
        const query = needsValueEncoding
          ? encodeQueryValues(allParams, signature)
          : `${canonical}&signature=${signature}`;
        url = `${baseUrl}${path}?${query}`;
      }

      const res = await fetch(url, {
        method,
        headers: {
          "X-BX-APIKEY": apiKey,
          "X-SOURCE-KEY": "BX-AI-SKILL",
          ...(contentType ? { "Content-Type": contentType } : {}),
        },
        body,
        signal: AbortSignal.timeout(10000),
      });

      const raw = await res.text();
      let json: unknown;
      try {
        json = JSONBigParse.parse(raw);
      } catch {
        throw new Error(`BingX returned non-JSON response with HTTP ${res.status}`);
      }
      const record = json && typeof json === "object" ? json as Record<string, unknown> : undefined;
      if (!res.ok) {
        throw new Error(`BingX HTTP ${res.status}: ${String(record?.msg ?? "request failed").slice(0, 300)}`);
      }
      if (typeof record?.code !== "number") throw new Error("BingX response did not include a numeric result code");
      if (record.code !== 0) throw new Error(`BingX error ${record.code}: ${String(record.msg ?? "request failed").slice(0, 300)}`);
      return record.data;
    } catch (e) {
      if (!isNetworkOrTimeout(e) || baseUrl === baseUrls[baseUrls.length - 1]) throw e;
    }
  }
}

export { buildCanonical, encodeQueryValues, fetchSigned, validateParams };
