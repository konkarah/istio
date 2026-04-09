// user-service/index.js
// K8S_MODE=true  → skips registry entirely, K8s DNS handles discovery
// K8S_MODE=false → registers with DIY registry on startup (Docker Compose)

const express = require("express");
const { makeLogger } = require("../shared/logger");
const { requestLogger, createMetrics } = require("../shared/middleware");

const K8S_MODE = process.env.K8S_MODE === "true";
const svc = K8S_MODE
  ? { register: async () => {}, startHeartbeat: () => {}, deregister: async () => {} }
  : require("../shared/service-client");

const app = express();
app.use(express.json());

const SERVICE_NAME = "user-service";
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "localhost";
const logger = makeLogger(SERVICE_NAME);
const metrics = createMetrics(SERVICE_NAME);

app.use(requestLogger(SERVICE_NAME));
app.use(metrics.track);

const users = {
  1: { id: 1, name: "Alice Kariuki",  email: "alice@example.com", plan: "pro"  },
  2: { id: 2, name: "Brian Mutai",    email: "brian@example.com", plan: "free" },
  3: { id: 3, name: "Carol Wanjiku",  email: "carol@example.com", plan: "pro"  },
};

app.get("/health", (req, res) =>
  res.json({ status: "ok", service: SERVICE_NAME, mode: K8S_MODE ? "k8s" : "docker" }));

app.get("/metrics", metrics.metricsHandler);

app.get("/users", (req, res) => {
  logger.info("listing users", { count: Object.keys(users).length });
  res.json(Object.values(users));
});

app.get("/users/:id", (req, res) => {
  const user = users[req.params.id];
  if (!user) {
    logger.warn("user not found", { userId: req.params.id });
    return res.status(404).json({ error: "User not found" });
  }
  logger.info("user fetched", { userId: user.id });
  res.json(user);
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
