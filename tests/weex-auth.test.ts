import { describe, expect, it } from "vitest";
import { buildWeexQuery, weexSignature } from "../src/providers/weex-auth";
import { gzipSync } from "node:zlib";
import { decodeWebSocketMessage } from "../src/providers/websocket";

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
});
