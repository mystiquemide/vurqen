import { createHash, randomUUID } from "node:crypto";

export function id(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function clientOrderId(): string {
  const compact = randomUUID().replaceAll("-", "").slice(0, 24);
  return `vq_${compact}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function digest(value: unknown): string {
  return sha256(stableStringify(value));
}
