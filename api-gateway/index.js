// api-gateway/index.js
// Single entry point for all clients. Discovers internal services and proxies.
// In K8s mode: uses env var URLs directly (K8s DNS resolves them).
// In Docker mode: uses discover() via the DIY registry.

const express = require("express");
const { makeLogger } = require("../shared/logger");
const { requestLogger, getTracingHeaders, createMetrics } = require("../shared/middleware");

const K8S_MODE = process.env.K8S_MODE === "true";
const svc = K8S_MODE
  ? { register: async () => {}, startHeartbeat: () => {}, deregister: async () => {}, discover: async () => {} }
  : require("../shared/service-client");

const app = express();
app.use(express.json());

const SERVICE_NAME = "api-gateway";
const PORT = process.env.PORT || 3004;
const HOST = process.env.HOST || "localhost";
const logger = makeLogger(SERVICE_NAME);
const metrics = createMetrics(SERVICE_NAME);

app.use(requestLogger(SERVICE_NAME));
app.use(metrics.track);

async function getServiceUrl(name) {
  if (K8S_MODE) {
    const map = {
      "user-service":    process.env.USER_SERVICE_URL    || "http://user-service",
      "product-service": process.env.PRODUCT_SERVICE_URL || "http://product-service",
      "order-service":   process.env.ORDER_SERVICE_URL   || "http://order-service",
    };
    return map[name];
  }
  return svc.discover(name);
}

async function proxy(serviceName, path, req, res) {
  try {
    const baseUrl = await getServiceUrl(serviceName);
    const url     = `${baseUrl}${path}`;
    logger.info("proxying", { target: serviceName, method: req.method, path });

    const headers   = getTracingHeaders(req);
    const fetchRes  = await fetch(url, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
    });

    res.status(fetchRes.status).json(await fetchRes.json());
  } catch (err) {
    logger.error("proxy failed", { target: serviceName, error: err.message });
    res.status(503).json({ error: `${serviceName} is unavailable` });
  }
}

app.get("/health",  (req, res) =>
  res.json({ status: "ok", service: SERVICE_NAME, mode: K8S_MODE ? "k8s" : "docker" }));

app.get("/metrics", metrics.metricsHandler);

// Registry overview (Docker mode only — in K8s there is no registry)
app.get("/services", async (req, res) => {
  if (K8S_MODE) return res.json({ message: "No registry in K8s mode — K8s DNS handles discovery" });
  try {
    const r = await fetch(`${process.env.REGISTRY_URL || "http://localhost:3000"}/services`);
    res.json(await r.json());
  } catch {
    res.status(503).json({ error: "Registry unavailable" });
  }
});

app.get( "/users",        (req, res) => proxy("user-service",    "/users",                     req, res));
app.get( "/users/:id",    (req, res) => proxy("user-service",    `/users/${req.params.id}`,    req, res));
app.get( "/products",     (req, res) => proxy("product-service", "/products",                  req, res));
app.get( "/products/:id", (req, res) => proxy("product-service", `/products/${req.params.id}`, req, res));
app.get( "/orders",       (req, res) => proxy("order-service",   "/orders",                    req, res));
app.get( "/orders/:id",   (req, res) => proxy("order-service",   `/orders/${req.params.id}`,   req, res));
app.post("/orders",       (req, res) => proxy("order-service",   "/orders",                    req, res));

async function start() {
  app.listen(PORT, "0.0.0.0", async () => {
    logger.info("started", { port: PORT, host: HOST, mode: K8S_MODE ? "k8s" : "docker" });
    if (!K8S_MODE) {
      await svc.register(SERVICE_NAME, HOST, PORT);
      svc.startHeartbeat(SERVICE_NAME);
    }
  });
}

process.on("SIGTERM", async () => {
  if (!K8S_MODE) await svc.deregister(SERVICE_NAME);
  process.exit(0);
});

start();
