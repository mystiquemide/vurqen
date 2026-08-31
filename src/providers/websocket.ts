import { gunzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

export function decodeWebSocketMessage(data: WebSocket.RawData): unknown {
  const buffer = Buffer.isBuffer(data)
    ? data
    : Array.isArray(data)
      ? Buffer.concat(data)
      : typeof data === "string"
        ? Buffer.from(data, "utf8")
        : Buffer.from(data as ArrayBuffer);
  let text: string;
  try {
    text = gunzipSync(buffer).toString("utf8");
  } catch {
    text = buffer.toString("utf8");
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function closeSocket(socket: WebSocket): void {
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
}

export function captureBingxTicker(symbol: string, timeoutMs = 8_000): Promise<unknown> {
  const normalizedSymbol = symbol.includes("-") ? symbol.toUpperCase() : `${symbol.slice(0, -4).toUpperCase()}-${symbol.slice(-4).toUpperCase()}`;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket("wss://open-api-swap.bingx.com/swap-market", {
      handshakeTimeout: timeoutMs,
    });
    let settled = false;
    const timer = setTimeout(() => finish(new Error("BingX WebSocket observation timed out")), timeoutMs);
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeSocket(socket);
      if (error) reject(error);
      else resolve(value);
    };

    socket.on("open", () => {
      socket.send(JSON.stringify({ id: randomUUID(), reqType: "sub", dataType: `${normalizedSymbol}@ticker` }));
    });
    socket.on("message", (data) => {
      const message = decodeWebSocketMessage(data);
      if (typeof message === "string") {
        if (message.toLowerCase() === "ping") socket.send("Pong");
        return;
      }
      if (!message || typeof message !== "object") return;
      const record = message as Record<string, unknown>;
      if (record.ping !== undefined) {
        socket.send(JSON.stringify({ pong: record.ping }));
        return;
      }
      if (record.data && record.dataType) finish(undefined, message);
    });
    socket.on("error", (error) => finish(error instanceof Error ? error : new Error("BingX WebSocket error")));
    socket.on("close", () => {
      if (!settled) finish(new Error("BingX WebSocket closed before an observation arrived"));
    });
  });
}

export function captureWeexTicker(symbol: string, timeoutMs = 8_000): Promise<unknown> {
  const normalizedSymbol = symbol.replaceAll("-", "").toUpperCase();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket("wss://ws-contract.weex.com/v3/ws/public", {
      handshakeTimeout: timeoutMs,
      headers: { "User-Agent": "Vurqen/0.1" },
    });
    let settled = false;
    const timer = setTimeout(() => finish(new Error("WEEX WebSocket observation timed out")), timeoutMs);
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeSocket(socket);
      if (error) reject(error);
      else resolve(value);
    };

    socket.on("open", () => {
      socket.send(JSON.stringify({ method: "SUBSCRIBE", params: [`${normalizedSymbol}@ticker`], id: 1 }));
    });
    socket.on("message", (data) => {
      const message = decodeWebSocketMessage(data);
      if (!message || typeof message !== "object") return;
      const record = message as Record<string, unknown>;
      if (record.event === "ping" || record.type === "ping") {
        socket.send(JSON.stringify({ method: "PONG", id: 1 }));
        return;
      }
      if (record.d && record.e === "ticker") finish(undefined, message);
    });
    socket.on("error", (error) => finish(error instanceof Error ? error : new Error("WEEX WebSocket error")));
    socket.on("close", () => {
      if (!settled) finish(new Error("WEEX WebSocket closed before an observation arrived"));
    });
  });
}
