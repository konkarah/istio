#!/bin/bash
# deploy.sh
# Run this once to deploy the entire stack to minikube from scratch.
# Usage: chmod +x deploy.sh && ./deploy.sh

set -e  # exit on any error

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   Microservices Demo — K8s + Istio Deploy    ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── STEP 1: Check prerequisites ───────────────────────────────────────────────
echo "▶ Checking prerequisites..."
command -v minikube  >/dev/null || { echo "❌ minikube not found. brew install minikube"; exit 1; }
command -v kubectl   >/dev/null || { echo "❌ kubectl not found. brew install kubectl"; exit 1; }
command -v istioctl  >/dev/null || { echo "❌ istioctl not found. brew install istioctl"; exit 1; }
echo "✅ Prerequisites OK"

# ── STEP 2: Start minikube ────────────────────────────────────────────────────
echo ""
echo "▶ Starting minikube..."
minikube start --memory=4096 --cpus=4 2>/dev/null || echo "  (minikube already running)"
echo "✅ Minikube running"

# ── STEP 3: Install Istio ─────────────────────────────────────────────────────
echo ""
echo "▶ Installing Istio (demo profile)..."
istioctl install --set profile=demo -y
echo "✅ Istio installed"

# ── STEP 4: Install observability addons ─────────────────────────────────────
echo ""
echo "▶ Installing observability addons (Prometheus, Jaeger, Grafana, Kiali)..."
BASE=https://raw.githubusercontent.com/istio/istio/release-1.21/samples/addons
kubectl apply -f $BASE/prometheus.yaml
kubectl apply -f $BASE/jaeger.yaml
kubectl apply -f $BASE/grafana.yaml
kubectl apply -f $BASE/kiali.yaml
echo "✅ Addons applied — waiting for them to be ready..."
kubectl rollout status deployment/prometheus -n istio-system --timeout=120s
kubectl rollout status deployment/jaeger     -n istio-system --timeout=120s
kubectl rollout status deployment/grafana    -n istio-system --timeout=120s
kubectl rollout status deployment/kiali      -n istio-system --timeout=120s
echo "✅ All addons ready"

# ── STEP 5: Enable Jaeger tracing at 100% ────────────────────────────────────
echo ""
echo "▶ Configuring Istio to send 100% of traces to Jaeger..."
kubectl apply -f k8s-istio/04-telemetry.yaml

# Patch the mesh config to point Envoy at the Zipkin/Jaeger collector
kubectl get configmap istio -n istio-system -o yaml | \
  grep -q "zipkin" || \
  kubectl patch configmap istio -n istio-system --type merge -p '{
    "data": {
      "mesh": "defaultConfig:\n  tracing:\n    zipkin:\n      address: zipkin.istio-system:9411\nenableTracing: true\n"
    }
  }' 2>/dev/null || true
echo "✅ Tracing configured"

# ── STEP 6: Build images inside minikube ─────────────────────────────────────
echo ""
echo "▶ Building Docker images inside minikube..."
eval $(minikube docker-env)
docker build -t ms-user-service:latest     -f user-service/Dockerfile    . --quiet
docker build -t ms-product-service:latest  -f product-service/Dockerfile . --quiet
docker build -t ms-order-service:latest    -f order-service/Dockerfile   . --quiet
docker build -t ms-api-gateway:latest      -f api-gateway/Dockerfile     . --quiet
echo "✅ Images built"

# ── STEP 7: Deploy microservices ──────────────────────────────────────────────
echo ""
echo "▶ Deploying microservices to K8s..."
kubectl apply -f k8s-istio/00-namespace.yaml
kubectl apply -f k8s-istio/01-services.yaml
kubectl apply -f k8s-istio/02-istio-gateway.yaml
kubectl apply -f k8s-istio/03-istio-traffic-policy.yaml
echo "✅ Manifests applied"

# ── STEP 8: Wait for pods ─────────────────────────────────────────────────────
echo ""
echo "▶ Waiting for all pods to be ready (2/2)..."
kubectl rollout status deployment/user-service    -n microservices --timeout=120s
kubectl rollout status deployment/product-service -n microservices --timeout=120s
kubectl rollout status deployment/order-service   -n microservices --timeout=120s
kubectl rollout status deployment/api-gateway     -n microservices --timeout=120s
echo "✅ All pods running"

# ── STEP 9: Get gateway URL ───────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║              DEPLOY COMPLETE ✅              ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo "1. Start the minikube tunnel in a dedicated terminal:"
echo "   minikube service istio-ingressgateway -n istio-system --url"
echo "   → Use the SECOND URL printed (port 80, e.g. http://127.0.0.1:59043)"
echo ""
echo "2. Run the traffic loop (replace PORT with your second URL's port):"
echo "   export GW=http://127.0.0.1:PORT"
echo "   while true; do"
echo "     curl -s \$GW/users > /dev/null"
echo "     curl -s \$GW/products > /dev/null"
echo "     curl -s \$GW/orders/ORD-001 > /dev/null"
echo "     echo \"tick \$(date +%H:%M:%S)\""
echo "     sleep 1"
echo "   done"
echo ""
echo "3. Open dashboards (each in its own terminal):"
echo "   istioctl dashboard kiali"
echo "   istioctl dashboard jaeger"
echo "   istioctl dashboard grafana"
echo "   istioctl dashboard prometheus"
