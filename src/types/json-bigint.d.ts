declare module "json-bigint" {
  interface JsonBigOptions {
    storeAsString?: boolean;
  }

  interface JsonBigParser {
    parse(text: string): unknown;
    stringify(value: unknown): string;
  }

  function JSONBig(options?: JsonBigOptions): JsonBigParser;
  export = JSONBig;
}
