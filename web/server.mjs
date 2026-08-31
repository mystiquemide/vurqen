import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webPort = Number(process.env.WEB_PORT ?? 4173);
const apiBase = new URL(process.env.VURQEN_API_URL ?? "http://127.0.0.1:8787");
const apiToken = process.env.VURQEN_API_TOKEN?.trim();
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(process.env.WEB_DIST_DIR ?? path.join(scriptDirectory, "dist"));
const maxProxyBodyBytes = 1_000_000;

if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65_535) throw new Error("WEB_PORT must be an integer between 1 and 65535");
if (apiBase.protocol !== "http:" && apiBase.protocol !== "https:") throw new Error("VURQEN_API_URL must use HTTP or HTTPS");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function setSecurityHeaders(response, cacheControl = "no-store") {
  response.setHeader("Cache-Control", cacheControl);
  response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; script-src 'self'; frame-ancestors 'none'");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
}

async function readRequestBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxProxyBodyBytes) throw new Error("Proxy request body is too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function apiUrl(pathname, search) {
  const basePath = apiBase.pathname.replace(/\/$/, "");
  return new URL(`${basePath}${pathname}${search}`, apiBase.origin);
}

async function proxyApi(request, response, url) {
  const method = request.method ?? "GET";
  const headers = {
    accept: request.headers.accept ?? "application/json",
  };
  if (request.headers["content-type"]) headers["content-type"] = request.headers["content-type"];
  if (apiToken) headers.authorization = `Bearer ${apiToken}`;

  const body = method === "GET" || method === "HEAD" ? undefined : await readRequestBody(request);
  const upstream = await fetch(apiUrl(url.pathname, url.search), { method, headers, body });
  const responseBody = Buffer.from(await upstream.arrayBuffer());

  setSecurityHeaders(response);
  response.statusCode = upstream.status;
  const contentType = upstream.headers.get("content-type");
  if (contentType) response.setHeader("Content-Type", contentType);
  response.end(responseBody);
}

async function serveStatic(request, response, url) {
  const decodedPath = decodeURIComponent(url.pathname);
  const candidate = path.resolve(distRoot, `.${decodedPath}`);
  if (candidate !== distRoot && !candidate.startsWith(`${distRoot}${path.sep}`)) {
    setSecurityHeaders(response);
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Invalid path");
    return;
  }

  let filePath = candidate;
  try {
    const fileStats = await stat(filePath);
    if (fileStats.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {
    filePath = path.join(distRoot, "index.html");
  }

  try {
    const body = await readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const cacheControl = url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-store";
    setSecurityHeaders(response, cacheControl);
    response.writeHead(200, { "Content-Type": contentTypes[extension] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    setSecurityHeaders(response);
    response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Frontend build is unavailable. Run npm run build first.");
  }
}

const server = createServer((request, response) => {
  void (async () => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        await proxyApi(request, response, url);
        return;
      }
      await serveStatic(request, response, url);
    } catch (error) {
      setSecurityHeaders(response);
      response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Web proxy request failed" }));
    }
  })();
});

server.listen(webPort, "0.0.0.0", () => {
  console.log(`Vurqen web listening on http://0.0.0.0:${webPort}`);
  console.log(`API proxy target: ${apiBase.origin}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
