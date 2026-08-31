import { afterEach, describe, expect, it, vi } from "vitest";
import { IntentSchema } from "../src/core/schemas";
import { BingxProvider } from "../src/providers/bingx";
import { WeexProvider } from "../src/providers/weex";

const intent = IntentSchema.parse({
  id: "intent_provider",
  runId: "run_provider",
  provider: "bingx",
  mode: "paper",
  symbol: "BTC-USDT",
  side: "BUY",
  orderType: "LIMIT",
  quantity: "0.001",
  price: "60000",
  clientOrderId: "vq_provider",
  createdAt: "2026-08-30T00:00:00.000Z",
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BingX provider", () => {
  it("submits a paper order through the VST endpoint", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe("https://open-api-vst.bingx.com/openApi/swap/v2/trade/order");
      expect(String(init?.body)).toContain("signature=");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["X-SOURCE-KEY"]).toBe("BX-AI-SKILL");
      return new Response(
        JSON.stringify({
          code: 0,
          msg: "",
          data: {
            orderID: "9007199254740993123",
            symbol: "BTC-USDT",
            side: "BUY",
            positionSide: "BOTH",
            type: "LIMIT",
            origQty: "0.001",
            executedQty: "0",
            price: "60000",
            status: "NEW",
            clientOrderId: "vq_provider",
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new BingxProvider({ apiKey: "test-api", secretKey: "test-secret", environment: "prod-vst" });
    const result = await provider.submitPaperOrder(intent);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.snapshot).toMatchObject({
      providerOrderId: "9007199254740993123",
      clientOrderId: "vq_provider",
      status: "NEW",
    });
  });

  it("refuses paper order submission against the live environment", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new BingxProvider({ apiKey: "test-api", secretKey: "test-secret", environment: "prod-live" });

    await expect(provider.submitPaperOrder(intent)).rejects.toThrow(/prod-vst/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unwraps the live VST order response shape", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          code: 0,
          msg: "",
          data: {
            order: {
              orderID: "9007199254740993124",
              symbol: "BTC-USDT",
              side: "BUY",
              type: "LIMIT",
              quantity: 0.001,
              status: "NEW",
              clientOrderID: "vq_provider",
            },
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new BingxProvider({ apiKey: "test-api", secretKey: "test-secret", environment: "prod-vst" });

    const result = await provider.validateOrder(intent);

    expect(result.snapshot).toMatchObject({ providerOrderId: "9007199254740993124", status: "NEW" });
  });
});

describe("WEEX provider", () => {
  it("fails credential preflight when private access is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ symbols: [] }), { status: 200 })));
    const provider = new WeexProvider({ baseUrl: "https://api-contract.weex.com" });

    const checks = await provider.preflight("paper");

    expect(checks.find((check) => check.name === "credentials")?.status).toBe("FAIL");
  });

  it("validates through public exchange information without placing an order", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      return new Response(JSON.stringify({ symbols: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new WeexProvider({ apiKey: "test-api", secretKey: "test-secret", passphrase: "test-pass", baseUrl: "https://api-contract.weex.com" });
    const weexIntent = IntentSchema.parse({ ...intent, provider: "weex" });

    await expect(provider.validateOrder(weexIntent)).resolves.toMatchObject({ raw: { validated: true } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses an explicit short hedge position for a sell paper order", async () => {
    let body: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ success: true, orderId: "702345678901234567", clientOrderId: "vq_provider" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new WeexProvider({ apiKey: "test-api", secretKey: "test-secret", passphrase: "test-pass", baseUrl: "https://api-contract.weex.com" });
    const weexIntent = IntentSchema.parse({ ...intent, provider: "weex", side: "SELL", positionSide: "SHORT" });

    await provider.submitPaperOrder(weexIntent);

    expect(body?.positionSide).toBe("SHORT");
  });
});
