import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCanonical, encodeQueryValues, fetchSigned, validateParams } from "../src/providers/bingx-auth";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BingX authentication helpers", () => {
  it("sorts canonical parameters in ASCII order", () => {
    expect(buildCanonical({ symbol: "BTC-USDT", timestamp: 1700, recvWindow: 5000 })).toBe(
      "recvWindow=5000&symbol=BTC-USDT&timestamp=1700",
    );
  });

  it("encodes structured query values only for transmission", () => {
    expect(encodeQueryValues({ batchOrders: "[{\"symbol\":\"BTC-USDT\"}]", timestamp: 1700 }, "sig")).toBe(
      "batchOrders=%5B%7B%22symbol%22%3A%22BTC-USDT%22%7D%5D&timestamp=1700&signature=sig",
    );
  });

  it("rejects signed parameter injection characters", () => {
    expect(() => validateParams({ symbol: "BTC-USDT&side=SELL" })).toThrow(/parameter injection/i);
  });

  it("rejects unsuccessful HTTP responses even when the body code is zero", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ code: 0, msg: "server failure" }), { status: 500 })),
    );

    await expect(fetchSigned("prod-vst", "key", "secret", "GET", "/test")).rejects.toThrow(/HTTP 500/);
  });
});
