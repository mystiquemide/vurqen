const baseUrl = (process.env.WEB_BASE_URL ?? "http://127.0.0.1:4173").replace(/\/$/, "");
const routes = [
  "/",
  "/run/new",
  "/run/example",
  "/incidents/example",
  "/run/example/receipt",
  "/favicon.png",
  "/vurqen-mark.png",
  "/images/vurqen-monitor.jpg",
  "/images/vurqen-workbench.jpg",
];

for (const route of routes) {
  const response = await fetch(`${baseUrl}${route}`, { headers: { Accept: route.includes(".") ? "*/*" : "text/html" } });
  if (response.status !== 200) throw new Error(`${route} returned HTTP ${response.status}`);
}

if (process.env.CHECK_API === "1") {
  const response = await fetch(`${baseUrl}/api/health`, { headers: { Accept: "application/json" } });
  if (response.status !== 200) throw new Error(`/api/health returned HTTP ${response.status}`);
}

console.log(`Vurqen web smoke passed for ${routes.length} routes`);
