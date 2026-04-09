// shared/middleware.js
// Request logging, Jaeger tracing header forwarding, and simple Prometheus metrics.

const { makeLogger } = require("./logger");

// B3 + W3C headers that Istio/Jaeger use to link spans across services
const TRACING_HEADERS = [
  "x-request-id",
  "x-b3-traceid",
  "x-b3-spanid",
  "x-b3-parentspanid",
  "x-b3-sampled",
  "x-b3-flags",
  "x-ot-span-context",
  "traceparent",
  "tracestate",
  "baggage",
];

// ── REQUEST LOGGER ────────────────────────────────────────────────────────────
// Logs every request as structured JSON and attaches tracing headers to req.
function requestLogger(serviceName) {
  const logger = makeLogger(serviceName);
  return (req, res, next) => {
    const start = Date.now();

    // Collect tracing headers so route handlers can forward them
    req.tracingHeaders = {};
    for (const h of TRACING_HEADERS) {
      if (req.headers[h]) req.tracingHeaders[h] = req.headers[h];
    }

    res.on("finish", () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 500 ? "error"
                  : res.statusCode >= 400 ? "warn"
                  : "info";
      logger[level]("request", {
        method:     req.method,
        path:       req.path,
        status:     res.statusCode,
        durationMs: duration,
        traceId:    req.headers["x-b3-traceid"] || req.headers["traceparent"] || null,
        requestId:  req.headers["x-request-id"] || null,
      });
    });

    next();
  };
}

// ── TRACING HEADER FORWARDER ─────────────────────────────────────────────────
// Call this when making fetch() calls to other services so Jaeger can
// link spans into one complete trace across all services.
function getTracingHeaders(req) {
  return {
    "Content-Type": "application/json",
    ...req.tracingHeaders,
  };
}

// ── SIMPLE METRICS ────────────────────────────────────────────────────────────
// Exposes GET /metrics in Prometheus text format.
// In production use the prom-client npm package for richer metrics.
function createMetrics(serviceName) {
  const counts    = {};
  const durations = {};

  function track(req, res, next) {
    const start = Date.now();
    res.on("finish", () => {
      const key = `${req.method} ${req.route?.path || req.path} ${res.statusCode}`;
      counts[key] = (counts[key] || 0) + 1;
      if (!durations[key]) durations[key] = [];
      durations[key].push(Date.now() - start);
      if (durations[key].length > 100) durations[key].shift();
    });
    next();
  }

  function metricsHandler(req, res) {
    let out = `# Metrics for ${serviceName}\n`;
    for (const [key, count] of Object.entries(counts)) {
      const avg = durations[key]
        ? Math.round(durations[key].reduce((a, b) => a + b, 0) / durations[key].length)
        : 0;
      out += `request_total{route="${key}"} ${count}\n`;
      out += `request_duration_avg_ms{route="${key}"} ${avg}\n`;
    }
    res.set("Content-Type", "text/plain").send(out);
  }

  return { track, metricsHandler };
}

module.exports = { requestLogger, getTracingHeaders, createMetrics };
