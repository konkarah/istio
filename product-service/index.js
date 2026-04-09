// product-service/index.js
const express = require("express");
const { makeLogger } = require("../shared/logger");
const { requestLogger, createMetrics } = require("../shared/middleware");

const K8S_MODE = process.env.K8S_MODE === "true";
const svc = K8S_MODE
  ? { register: async () => {}, startHeartbeat: () => {}, deregister: async () => {} }
  : require("../shared/service-client");

const app = express();
app.use(express.json());

const SERVICE_NAME = "product-service";
const PORT = process.env.PORT || 3002;
const HOST = process.env.HOST || "localhost";
const logger = makeLogger(SERVICE_NAME);
const metrics = createMetrics(SERVICE_NAME);

app.use(requestLogger(SERVICE_NAME));
app.use(metrics.track);

const products = {
  101: { id: 101, name: "Laptop Pro",                  price: 120000, category: "electronics", stock: 14 },
  102: { id: 102, name: "Wireless Mouse",              price: 2500,   category: "electronics", stock: 80 },
  103: { id: 103, name: "Standing Desk",               price: 35000,  category: "furniture",   stock: 6  },
  104: { id: 104, name: "Noise Cancelling Headphones", price: 18000,  category: "electronics", stock: 23 },
};

app.get("/health", (req, res) =>
  res.json({ status: "ok", service: SERVICE_NAME, mode: K8S_MODE ? "k8s" : "docker" }));

app.get("/metrics", metrics.metricsHandler);

app.get("/products", (req, res) => {
  logger.info("listing products", { count: Object.keys(products).length });
  res.json(Object.values(products));
});

app.get("/products/:id", (req, res) => {
  const product = products[req.params.id];
  if (!product) {
    logger.warn("product not found", { productId: req.params.id });
    return res.status(404).json({ error: "Product not found" });
  }
  logger.info("product fetched", { productId: product.id });
  res.json(product);
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
