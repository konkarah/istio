// order-service/index.js
// In K8s mode: uses USER_SERVICE_URL / PRODUCT_SERVICE_URL env vars directly.
// In Docker mode: calls discover() to find services via the DIY registry.

const express = require("express");
const { makeLogger } = require("../shared/logger");
const { requestLogger, getTracingHeaders, createMetrics } = require("../shared/middleware");

const K8S_MODE = process.env.K8S_MODE === "true";
const svc = K8S_MODE
  ? { register: async () => {}, startHeartbeat: () => {}, deregister: async () => {}, discover: async () => {} }
  : require("../shared/service-client");

const app = express();
app.use(express.json());

const SERVICE_NAME = "order-service";
const PORT = process.env.PORT || 3003;
const HOST = process.env.HOST || "localhost";
const logger = makeLogger(SERVICE_NAME);
const metrics = createMetrics(SERVICE_NAME);

app.use(requestLogger(SERVICE_NAME));
app.use(metrics.track);

// Returns base URL for a service — K8s uses env vars, Docker uses discover()
async function getServiceUrl(name) {
  if (K8S_MODE) {
    const map = {
      "user-service":    process.env.USER_SERVICE_URL    || "http://user-service",
      "product-service": process.env.PRODUCT_SERVICE_URL || "http://product-service",
    };
    return map[name];
  }
  return svc.discover(name);
}

const orders = {
  "ORD-001": { id: "ORD-001", userId: 1, productId: 101, quantity: 1, status: "delivered" },
  "ORD-002": { id: "ORD-002", userId: 2, productId: 102, quantity: 2, status: "pending"   },
  "ORD-003": { id: "ORD-003", userId: 1, productId: 104, quantity: 1, status: "shipped"   },
};

app.get("/health", (req, res) =>
  res.json({ status: "ok", service: SERVICE_NAME, mode: K8S_MODE ? "k8s" : "docker" }));

app.get("/metrics", metrics.metricsHandler);

app.get("/orders", (req, res) => {
  logger.info("listing orders", { count: Object.keys(orders).length });
  res.json(Object.values(orders));
});

// Enriched order — fetches user + product data from their services
app.get("/orders/:id", async (req, res) => {
  const order = orders[req.params.id];
  if (!order) {
    logger.warn("order not found", { orderId: req.params.id });
    return res.status(404).json({ error: "Order not found" });
  }

  try {
    const userUrl    = await getServiceUrl("user-service");
    const productUrl = await getServiceUrl("product-service");
    const headers    = getTracingHeaders(req); // forward trace headers for Jaeger

    const [userRes, productRes] = await Promise.all([
      fetch(`${userUrl}/users/${order.userId}`,          { headers }),
      fetch(`${productUrl}/products/${order.productId}`, { headers }),
    ]);

    const user    = await userRes.json();
    const product = await productRes.json();

    logger.info("order enriched", { orderId: order.id, userId: order.userId });
    res.json({ ...order, user, product });
  } catch (err) {
    logger.error("enrich failed", { orderId: req.params.id, error: err.message });
    res.status(503).json({ error: "Could not fetch dependencies", detail: err.message });
  }
});

app.post("/orders", async (req, res) => {
  const { userId, productId, quantity } = req.body;
  if (!userId || !productId || !quantity)
    return res.status(400).json({ error: "userId, productId, quantity required" });

  try {
    const userUrl    = await getServiceUrl("user-service");
    const productUrl = await getServiceUrl("product-service");
    const headers    = getTracingHeaders(req);

    const [userRes, productRes] = await Promise.all([
      fetch(`${userUrl}/users/${userId}`,          { headers }),
      fetch(`${productUrl}/products/${productId}`, { headers }),
    ]);

    if (!userRes.ok)    return res.status(404).json({ error: "User not found" });
    if (!productRes.ok) return res.status(404).json({ error: "Product not found" });

    const id = `ORD-${String(Object.keys(orders).length + 1).padStart(3, "0")}`;
    orders[id] = { id, userId, productId, quantity, status: "pending" };
    logger.info("order created", { orderId: id });
    res.status(201).json(orders[id]);
  } catch (err) {
    logger.error("create failed", { error: err.message });
    res.status(503).json({ error: "Could not validate services", detail: err.message });
  }
});

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
