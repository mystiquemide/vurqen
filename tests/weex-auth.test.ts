import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWeexQuery, fetchWeex, weexSignature } from "../src/providers/weex-auth";
import { gzipSync } from "node:zlib";
import { decodeWebSocketMessage } from "../src/providers/websocket";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WEEX authentication helpers", () => {
  it("sorts and encodes query parameters", () => {
    expect(buildWeexQuery({ symbol: "BTCUSDT", limit: 20 })).toBe("limit=20&symbol=BTCUSDT");
  });

  it("matches the documented REST signature structure", () => {
    expect(weexSignature("secret", "1591089508404", "GET", "/api/v3/market/depth", "symbol=BTCUSDT&limit=20", "")).toBe(
      "74UazbPZpLIfsdaGjiRcR5N/ZumxpVcWCRkJEKhuPJs=",
    );
  });

  it("decodes plain and compressed V3 ticker messages", () => {
    const message = JSON.stringify({ e: "ticker", d: [{ p: "78606.4" }] });
    expect(decodeWebSocketMessage(Buffer.from(message))).toEqual(JSON.parse(message));
    expect(decodeWebSocketMessage(gzipSync(Buffer.from(message)))).toEqual(JSON.parse(message));
  });

  it("rejects an unsuccessful order response returned with HTTP 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ success: false, errorCode: "INVALID_ORDER", errorMessage: "bad order" }), { status: 200 }),
      ),
    );

    await expect(
      fetchWeex({
        baseUrl: "https://api-contract.weex.com",
        apiKey: "key",
        secretKey: "secret",
        passphrase: "passphrase",
        method: "POST",
        requestPath: "/capi/v3/sim/order",
        body: { symbol: "BTCUSDT" },
        authenticated: true,
      }),
    ).rejects.toThrow(/bad order/);
  });
});
