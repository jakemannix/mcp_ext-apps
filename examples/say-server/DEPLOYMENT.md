# Say Server - GCP Cloud Run Deployment

This document describes how to deploy the Say Server MCP application to Google Cloud Run with session-sticky load balancing.

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐     ┌─────────────┐
│   Client    │────▶│  Load Balancer   │────▶│  Serverless NEG │────▶│  Cloud Run  │
│             │     │  (HTTP, IP-based)│     │                 │     │  say-server │
└─────────────┘     └──────────────────┘     └─────────────────┘     └─────────────┘
                            │
                            ▼
                    Session Affinity
                    (mcp-session-id header)
```

## Prerequisites

- GCP Project with billing enabled
- `gcloud` CLI installed and authenticated
- Docker (for local builds)

## Current Deployment

- **Project**: `mcp-apps-say-server`
- **Region**: `us-east1`
- **Service URL**: `https://say-server-109024344223.us-east1.run.app`
- **Load Balancer IP**: `34.160.77.67`

## Session Stickiness Configuration

MCP's Streamable HTTP transport uses the `mcp-session-id` header for stateful sessions. The load balancer is configured to route requests with the same session ID to the same Cloud Run instance:

```bash
# Backend service configuration
gcloud compute backend-services describe say-server-backend --global --format=json | jq '{
  sessionAffinity,
  localityLbPolicy,
  consistentHash
}'
```

Returns:
```json
{
  "sessionAffinity": "HEADER_FIELD",
  "localityLbPolicy": "RING_HASH",
  "consistentHash": {
    "httpHeaderName": "mcp-session-id"
  }
}
```

## Deployment Steps

### 1. Set Project

```bash
export PROJECT_ID=mcp-apps-say-server
gcloud config set project $PROJECT_ID
```

### 2. Enable APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  compute.googleapis.com
```

### 3. Build and Push Docker Image

```bash
cd examples/say-server

# Build for linux/amd64
docker build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/$PROJECT_ID/cloud-run-source-deploy/say-server:latest .

# Configure docker auth
gcloud auth configure-docker us-east1-docker.pkg.dev --quiet

# Push
docker push us-east1-docker.pkg.dev/$PROJECT_ID/cloud-run-source-deploy/say-server:latest
```

### 4. Deploy to Cloud Run

```bash
gcloud run deploy say-server \
  --image us-east1-docker.pkg.dev/$PROJECT_ID/cloud-run-source-deploy/say-server:latest \
  --region us-east1 \
  --memory 4Gi \
  --cpu 2 \
  --timeout 300 \
  --concurrency 10 \
  --min-instances 0 \
  --max-instances 10 \
  --no-cpu-throttling \
  --ingress all
```

### 5. Set Up Load Balancer with Session Affinity

```bash
# Create serverless NEG
gcloud compute network-endpoint-groups create say-server-neg \
  --region=us-east1 \
  --network-endpoint-type=serverless \
  --cloud-run-service=say-server

# Create backend service
gcloud compute backend-services create say-server-backend \
  --global \
  --load-balancing-scheme=EXTERNAL_MANAGED

# Add NEG to backend
gcloud compute backend-services add-backend say-server-backend \
  --global \
  --network-endpoint-group=say-server-neg \
  --network-endpoint-group-region=us-east1

# Configure session affinity (requires import/export for consistentHash)
gcloud compute backend-services describe say-server-backend --global --format=json | \
  jq 'del(.id, .kind, .selfLink, .creationTimestamp, .fingerprint) + {
    "sessionAffinity": "HEADER_FIELD",
    "localityLbPolicy": "RING_HASH",
    "protocol": "HTTPS",
    "consistentHash": {"httpHeaderName": "mcp-session-id"}
  }' > /tmp/backend.json

gcloud compute backend-services import say-server-backend \
  --global \
  --source=/tmp/backend.json \
  --quiet

# Create URL map
gcloud compute url-maps create say-server-lb \
  --default-service=say-server-backend \
  --global

# Create HTTP proxy
gcloud compute target-http-proxies create say-server-proxy \
  --url-map=say-server-lb \
  --global

# Reserve static IP
gcloud compute addresses create say-server-ip \
  --global \
  --ip-version=IPV4

# Create forwarding rule
gcloud compute forwarding-rules create say-server-forwarding \
  --global \
  --target-http-proxy=say-server-proxy \
  --address=say-server-ip \
  --ports=80 \
  --load-balancing-scheme=EXTERNAL_MANAGED
```

## Access & Authentication

### Current Issue: Org Policy Restrictions

Anthropic's GCP org policies prevent:
- `allUsers` or `allAuthenticatedUsers` IAM bindings
- Service account key creation

This means the service requires authentication.

### Authenticated Access (Works Now)

```bash
# Via gcloud proxy (recommended for testing)
gcloud run services proxy say-server \
  --region=us-east1 \
  --port=8888 \
  --project=mcp-apps-say-server

# Then access at http://127.0.0.1:8888/mcp
curl -X POST http://127.0.0.1:8888/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

### Requirements for Public Access

To enable unauthenticated public access, one of:

1. **Org Policy Exception** - Request IT to allow `allUsers` for this project:
   - Policy: `constraints/iam.allowedPolicyMemberDomains`
   - Need exception to add `allUsers` to Cloud Run invoker role

2. **External Project** - Deploy to a GCP project outside Anthropic's org

3. **MCP OAuth Auth** - Implement OAuth in the server:
   ```python
   from mcp.server.fastmcp import FastMCP, AuthSettings

   mcp = FastMCP(
       "Say Demo",
       auth=AuthSettings(
           issuer_url="https://accounts.google.com",
           required_scopes=["openid", "email"],
       ),
       token_verifier=...,  # Configure token verification
   )
   ```

## Files

- `server.py` - Self-contained MCP server (runs with `uv run server.py`)
- `Dockerfile` - Cloud Run container definition
- `.gcloudignore` - Excludes unnecessary files from upload
- `mcp-app.html` - UI served as MCP resource

## Updating the Deployment

```bash
# Rebuild and push
docker build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/mcp-apps-say-server/cloud-run-source-deploy/say-server:latest .
docker push us-east1-docker.pkg.dev/mcp-apps-say-server/cloud-run-source-deploy/say-server:latest

# Deploy new revision
gcloud run deploy say-server \
  --image us-east1-docker.pkg.dev/mcp-apps-say-server/cloud-run-source-deploy/say-server:latest \
  --region us-east1 \
  --project mcp-apps-say-server
```

## Cleanup

```bash
# Delete all resources
gcloud compute forwarding-rules delete say-server-forwarding --global --quiet
gcloud compute target-http-proxies delete say-server-proxy --global --quiet
gcloud compute url-maps delete say-server-lb --global --quiet
gcloud compute backend-services delete say-server-backend --global --quiet
gcloud compute network-endpoint-groups delete say-server-neg --region=us-east1 --quiet
gcloud compute addresses delete say-server-ip --global --quiet
gcloud run services delete say-server --region=us-east1 --quiet
```
