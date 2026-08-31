import { config } from "./config";
import { VurqenApp } from "./app";

const app = new VurqenApp();
const server = app.createHttpServer();

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Vurqen API listening on http://0.0.0.0:${config.port}`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
