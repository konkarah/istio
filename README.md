# Microservices Demo — Service Registration, Discovery & Observability

A complete microservices learning project built with Node.js/Express.
Runs in two modes from the same codebase:

- **Docker Compose** — DIY registry, manual discovery, Jaeger + Prometheus + Grafana
- **Kubernetes + Istio** — K8s DNS, Envoy sidecars, Kiali + Jaeger + Prometheus + Grafana

---

## Architecture

```
Client
  │
  ▼
api-gateway          ← single entry point (port 3004 / Istio IngressGateway)
  │
  ├── user-service    ← returns user data
  ├── product-service ← returns product catalogue
  └── order-service   ← calls user + product, returns enriched orders
       ├── user-service
       └── product-service
```

In Docker Compose, a DIY `registry` service acts as the phonebook.
In Kubernetes, CoreDNS replaces the registry entirely.

---

## Project Structure

```
.
├── shared/
│   ├── logger.js           structured JSON logging
│   ├── middleware.js        request logging, tracing headers, /metrics
│   └── service-client.js   register/discover/heartbeat (Docker mode only)
├── registry/               DIY phonebook — Docker Compose only
├── user-service/
├── product-service/
├── order-service/
├── api-gateway/
├── k8s-istio/
│   ├── 00-namespace.yaml       enables Istio sidecar injection
│   ├── 01-services.yaml        Deployments + Services (port name: http required)
│   ├── 02-istio-gateway.yaml   IngressGateway + routing rules
│   ├── 03-istio-traffic-policy.yaml  mTLS, retries, circuit breaking
│   ├── 04-telemetry.yaml       100% trace sampling to Jaeger
│   └── 05-mesh-config.yaml     points Envoy sidecars at Jaeger collector
├── observability/
│   ├── prometheus.yml          scrape config for all services
│   └── grafana-datasource.yml  auto-wires Prometheus into Grafana
└── docker-compose.yml
```

---

## Option A — Docker Compose (local, no Kubernetes needed)

### Run

```bash
docker compose up --build
```

### URLs

| URL | What |
|-----|------|
| http://localhost:3004 | API Gateway |
| http://localhost:3000/services | Registry — see all registered services |
| http://localhost:16686 | Jaeger — distributed traces |
| http://localhost:9090 | Prometheus — raw metrics |
| http://localhost:3100 | Grafana — dashboards (login: admin / admin) |

### Generate traffic

```bash
while true; do
  curl -s http://localhost:3004/users > /dev/null
  curl -s http://localhost:3004/products > /dev/null
  curl -s http://localhost:3004/orders/ORD-001 > /dev/null
  curl -s http://localhost:3004/orders/ORD-002 > /dev/null
  curl -s -X POST http://localhost:3004/orders \
    -H "Content-Type: application/json" \
    -d '{"userId":1,"productId":102,"quantity":1}' > /dev/null
  echo "tick $(date +%H:%M:%S)"
  sleep 1
done
```

### What to look for

**Jaeger** → Service: `api-gateway` → Find Traces → click any trace

**Prometheus** → query `request_total` → Graph tab

**Grafana** → Dashboards → add panel → Prometheus datasource → query `request_total`

---

## Option B — Kubernetes + Istio (full production setup)

### One-time prerequisites

```bash
# Install tools
brew install minikube istioctl

# Start cluster
minikube start --memory=4096 --cpus=4

# Install Istio
istioctl install --set profile=demo -y

# Install observability addons
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.21/samples/addons/prometheus.yaml
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.21/samples/addons/jaeger.yaml
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.21/samples/addons/grafana.yaml
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.21/samples/addons/kiali.yaml

# Wait for all addons to be ready
kubectl rollout status deployment/prometheus -n istio-system
kubectl rollout status deployment/jaeger -n istio-system
kubectl rollout status deployment/grafana -n istio-system
kubectl rollout status deployment/kiali -n istio-system
```

### Every time you deploy (fresh or after code changes)

```bash
# Step 1 — point Docker at minikube's daemon
eval $(minikube docker-env)

# Step 2 — build images (must use ms- prefix to match 01-services.yaml)
docker build -t ms-user-service:latest     -f user-service/Dockerfile .
docker build -t ms-product-service:latest  -f product-service/Dockerfile .
docker build -t ms-order-service:latest    -f order-service/Dockerfile .
docker build -t ms-api-gateway:latest      -f api-gateway/Dockerfile .

# Step 3 — apply K8s manifests
kubectl apply -f k8s-istio/00-namespace.yaml
kubectl apply -f k8s-istio/01-services.yaml
kubectl apply -f k8s-istio/02-istio-gateway.yaml
kubectl apply -f k8s-istio/03-istio-traffic-policy.yaml
kubectl apply -f k8s-istio/04-telemetry.yaml
kubectl apply -f k8s-istio/05-mesh-config.yaml

# Step 4 — wait for all 8 pods to be 2/2 Running
kubectl get pods -n microservices -w
# Press Ctrl+C once all show 2/2 Running with 0 restarts

# Step 5 — restart pods to pick up mesh config (only needed after 05-mesh-config changes)
kubectl rollout restart deployment -n microservices
kubectl rollout status deployment -n microservices
```

### Get the gateway URL

```bash
# Terminal 1 — KEEP THIS OPEN (minikube tunnel)
minikube service istio-ingressgateway -n istio-system --url
# You'll see 5 URLs. The SECOND one (port 80) is your gateway.
# Example output:
#   http://127.0.0.1:59042  ← port 15021 (health check) — NOT this one
#   http://127.0.0.1:59043  ← port 80 (HTTP) — USE THIS ONE
#   http://127.0.0.1:59044  ← port 443
#   ...
```

To confirm which port is correct:
```bash
kubectl get service istio-ingressgateway -n istio-system
# Look for 80:XXXXX/TCP in the PORT(S) column
# The minikube URL mapping to port 80 is your gateway
```

### Generate traffic (Terminal 2)

```bash
export GW=http://127.0.0.1:59043   # replace with your port 80 URL

while true; do
  curl -s $GW/users > /dev/null
  curl -s $GW/products > /dev/null
  curl -s $GW/orders > /dev/null
  curl -s $GW/orders/ORD-001 > /dev/null
  curl -s $GW/orders/ORD-002 > /dev/null
  curl -s -X POST $GW/orders \
    -H "Content-Type: application/json" \
    -d '{"userId":1,"productId":102,"quantity":1}' > /dev/null
  echo "tick $(date +%H:%M:%S)"
  sleep 1
done
```

### Open dashboards (one per terminal)

```bash
istioctl dashboard kiali       # service graph, live traffic, health
istioctl dashboard jaeger      # distributed traces
istioctl dashboard grafana     # metric dashboards
istioctl dashboard prometheus  # raw metric queries
```

### What to look for in each dashboard

**Kiali**
1. Left sidebar → Graph
2. Namespace dropdown → select `microservices`
3. Top right → change `Last 1m` to `Last 5m`
4. You'll see: `istio-ingressgateway → order-service → user-service + product-service`
5. Click any arrow to see request rate, error %, and latency on that edge
6. Left sidebar → Distributed Tracing → links directly to Jaeger

**Jaeger**
1. Service dropdown → select `istio-ingressgateway`
2. Click Find Traces
3. Click any trace to see the full timeline across all services
4. Each coloured bar = one service's processing time

**Prometheus**
1. Query box → type `istio_requests_total` → Execute → Graph tab
2. Try: `rate(istio_requests_total[1m])` for requests per second
3. Try: `istio_request_duration_milliseconds_bucket` for latency

**Grafana**
1. Left sidebar → Dashboards → Browse → Istio folder
2. Open Istio Service Dashboard
3. Service dropdown → select `order-service.microservices.svc.cluster.local`
4. See: request rate, error rate, p50/p99 latency as live graphs

### Stopping and resuming

```bash
# Stop (preserves everything)
minikube stop

# Resume next time
minikube start
eval $(minikube docker-env)
# Re-run the minikube service tunnel command to get fresh ports
minikube service istio-ingressgateway -n istio-system --url
```

### Teardown

```bash
kubectl delete namespace microservices
minikube stop
```

---

## How K8S_MODE works

Every service checks `process.env.K8S_MODE` at startup:

| | Docker Compose (`K8S_MODE=false`) | Kubernetes (`K8S_MODE=true`) |
|--|--|--|
| Registration | `register()` on startup | skipped |
| Heartbeat | sent every 10s | skipped |
| Discovery | `discover("user-service")` | env var URL direct |
| Deregister | on SIGTERM | skipped |
| Who handles discovery | your `registry` service | K8s CoreDNS |
| Who handles health | nothing (Docker restarts) | liveness + readiness probes |
| Who handles encryption | nothing (plain HTTP) | Istio mTLS (automatic) |
| Who handles retries | you'd write it | Istio VirtualService YAML |

## Common issues

**Pods CrashLoopBackOff**
```bash
kubectl logs -n microservices deployment/user-service -c user-service
kubectl logs -n microservices deployment/user-service -c istio-proxy | tail -20
```

**404 from gateway**
```bash
# Confirm you're using the port 80 URL, not port 15021
kubectl get service istio-ingressgateway -n istio-system
istioctl analyze -n microservices
```

**No traces in Jaeger**
```bash
# Confirm telemetry config is applied
kubectl get telemetry -n istio-system
# Restart pods to pick up config
kubectl rollout restart deployment -n microservices
```

**Kiali graph empty**
- Wait 2 minutes after starting traffic loop
- Change time range from `Last 1m` to `Last 5m`
- Click the refresh button top right


![alt text](<Screenshot 2026-04-09 at 12.02.54 PM.png>) ![alt text](<Screenshot 2026-04-09 at 12.03.02 PM.png>) ![alt text](<Screenshot 2026-04-09 at 12.03.07 PM.png>) ![alt text](<Screenshot 2026-04-09 at 12.04.22 PM.png>)![alt text](<Screenshot 2026-04-09 at 11.47.54 AM-1.png>)