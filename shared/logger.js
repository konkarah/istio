// shared/logger.js
// Structured JSON logger — every line is parseable by Grafana Loki / Datadog.

function log(level, service, msg, extra = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service,
    msg,
    ...extra,
  }));
}

function makeLogger(service) {
  return {
    info:  (msg, extra) => log("info",  service, msg, extra),
    warn:  (msg, extra) => log("warn",  service, msg, extra),
    error: (msg, extra) => log("error", service, msg, extra),
    debug: (msg, extra) => log("debug", service, msg, extra),
  };
}

module.exports = { makeLogger };
