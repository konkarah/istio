// shared/service-client.js
// Used by services in Docker Compose mode only.
// In K8s mode (K8S_MODE=true) none of these functions are called.

const REGISTRY_URL = process.env.REGISTRY_URL || "http://localhost:3000";

async function register(name, host, port) {
  const res = await fetch(`${REGISTRY_URL}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, host, port }),
  });
  if (!res.ok) throw new Error(`Registration failed: ${await res.text()}`);
  console.log(JSON.stringify({ level: "info", service: name, msg: "registered with registry" }));
}

function startHeartbeat(name, intervalMs = 10_000) {
  setInterval(async () => {
    try {
      await fetch(`${REGISTRY_URL}/heartbeat`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    } catch (err) {
      console.log(JSON.stringify({ level: "warn", service: name, msg: "heartbeat failed", error: err.message }));
    }
  }, intervalMs);
}

async function discover(name) {
  const res = await fetch(`${REGISTRY_URL}/discover/${name}`);
  if (!res.ok) throw new Error(`Service '${name}' not found in registry`);
  const { host, port } = await res.json();
  return `http://${host}:${port}`;
}

async function deregister(name) {
  try {
    await fetch(`${REGISTRY_URL}/deregister`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  } catch (err) {
    console.log(JSON.stringify({ level: "warn", service: name, msg: "deregister failed", error: err.message }));
  }
}

module.exports = { register, startHeartbeat, discover, deregister };
