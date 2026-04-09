// registry/index.js
// The DIY service phonebook — used in Docker Compose mode only.
// In Kubernetes, CoreDNS replaces this entirely.

const express = require("express");
const { makeLogger } = require("../shared/logger");
const { requestLogger, createMetrics } = require("../shared/middleware");

const app = express();
app.use(express.json());

const SERVICE_NAME = "registry";
const PORT = process.env.PORT || 3000;
const logger = makeLogger(SERVICE_NAME);
const metrics = createMetrics(SERVICE_NAME);

app.use(requestLogger(SERVICE_NAME));
app.use(metrics.track);

const registry = {};
const HEARTBEAT_TIMEOUT = 30_000;

app.post("/register", (req, res) => {
  const { name, host, port } = req.body;
  if (!name || !host || !port)
    return res.status(400).json({ error: "name, host, port required" });
  registry[name] = { host, port, lastHeartbeat: Date.now() };
  logger.info("registered", { name, host, port });
  res.json({ message: `${name} registered` });
});

app.put("/heartbeat", (req, res) => {
  const { name } = req.body;
  if (!registry[name])
    return res.status(404).json({ error: `${name} not registered` });
  registry[name].lastHeartbeat = Date.now();
  logger.debug("heartbeat", { name });
  res.json({ message: "ok" });
});

app.get("/discover/:name", (req, res) => {
  const service = registry[req.params.name];
  if (!service) {
    logger.warn("not found", { name: req.params.name });
    return res.status(404).json({ error: `'${req.params.name}' not found` });
  }
  logger.info("discovered", { name: req.params.name });
  res.json({ host: service.host, port: service.port });
});

app.get("/services",  (req, res) => res.json(registry));
app.get("/health",    (req, res) => res.json({ status: "ok", service: SERVICE_NAME }));
app.get("/metrics",   metrics.metricsHandler);

app.delete("/deregister", (req, res) => {
  const { name } = req.body;
  if (!registry[name])
    return res.status(404).json({ error: `${name} not registered` });
  delete registry[name];
  logger.info("deregistered", { name });
  res.json({ message: `${name} deregistered` });
});

// Remove services that stopped sending heartbeats
setInterval(() => {
  const now = Date.now();
  for (const [name, info] of Object.entries(registry)) {
    if (now - info.lastHeartbeat > HEARTBEAT_TIMEOUT) {
      logger.warn("removing stale service", { name });
      delete registry[name];
    }
  }
}, 10_000);

app.listen(PORT, "0.0.0.0", () => logger.info("started", { port: PORT }));
