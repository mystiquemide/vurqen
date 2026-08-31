import { describe, expect, it } from "vitest";
import { buildCanonical, encodeQueryValues, validateParams } from "../src/providers/bingx-auth";

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
});
