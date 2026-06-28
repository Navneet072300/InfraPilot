# InfraPilot v2

AI-native DevOps workspace. From a GitHub repo URL to a live Kubernetes deployment — CI pipeline, manifests, secrets, and DNS — in a single pipeline run.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS v4 |
| Backend | FastAPI + Anthropic Python SDK (SSE streaming) |
| AI | Claude claude-sonnet-4-6 |
| K8s | kubernetes Python client + kubectl subprocess |
| Git | PyGithub (Contents API) |
| Stubs | HashiCorp Vault, Cloudflare DNS (realistic mocks) |

## Dev Setup

### Prerequisites
- Python 3.11+
- Node.js 20+
- kubectl (for real cluster commands)
- An Anthropic API key

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # add your ANTHROPIC_API_KEY
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev                        # http://localhost:5173
```

The Vite dev server proxies `/api` to `http://localhost:8000`.

## First Run

On first launch, InfraPilot checks `GET /api/platform/config`. If no cluster is configured, it redirects to `/onboarding`.

The onboarding wizard collects:
1. **Platforms** — cloud, CI/CD, GitOps, secrets, monitoring, registry, CDN
2. **Clusters** — bearer token or kubeconfig paste, test connection
3. **Credentials** — GitHub PAT, stubbed Vault/Cloudflare
4. **Summary** — launch

Config is persisted to `backend/config/platforms.json`.

## Connecting a Real Cluster

### Option A — Bearer token + API URL
In the onboarding wizard, choose **Bearer Token + API URL** and paste:
- **API Server URL**: `kubectl cluster-info | grep 'Kubernetes control plane'`
- **Token**: `kubectl create token default -n default`

### Option B — Kubeconfig paste
Copy the relevant cluster/user/context blocks from `~/.kube/config` and paste into the kubeconfig textarea.

### EKS example
```bash
aws eks update-kubeconfig --region us-east-1 --name my-cluster
kubectl config view --raw --minify | pbcopy   # paste into wizard
```

## Environment Variables

```
ANTHROPIC_API_KEY=sk-ant-...       # required
CONFIG_FILE=config/platforms.json  # optional override
```

## Security Notes

- Credentials are **never logged**. All `GET /api/platform/config` responses mask values as `first4***`.
- kubectl commands use a strict whitelist: `get`, `describe`, `logs`, `rollout`, `apply`, `top`, `version`, `cluster-info`.
- PROD cluster actions show a confirmation dialog before execution.
- Stubbed services (Vault, Cloudflare) are clearly labeled `[STUBBED]` in the UI.

## Modes

| Mode | Description |
|------|-------------|
| **Pipeline** | Hero feature — git repo → live URL. 11-step orchestration with AI generation, real K8s rollout, auto-troubleshoot |
| **Generate** | Natural language → IaC files (Terraform, Kustomize, Helm, Ansible) |
| **Diagnose** | Paste logs or pull live pod data → AI root cause analysis + diff |
| **Design** | Architecture diagrams with React Flow, cost estimates, Terraform output |
| **Monitor** | Live cluster health (30s polling), cost anomalies, drift detection |

## Project Structure

```
InfraPilot/
├── backend/
│   ├── config/
│   │   └── platforms.json          # cluster + credential config
│   ├── routes/
│   │   ├── agent.py                # pipeline SSE orchestration
│   │   ├── generate.py             # /api/generate SSE
│   │   ├── diagnose.py             # /api/diagnose SSE
│   │   ├── kubernetes.py           # /api/k8s/* cluster queries
│   │   ├── github.py               # /api/github/* repo analysis
│   │   └── platform.py             # /api/platform/* config CRUD
│   ├── services/
│   │   ├── ai_service.py           # Anthropic streaming wrapper
│   │   ├── k8s_service.py          # kubectl subprocess + python client
│   │   ├── github_service.py       # PyGithub repo analysis + push
│   │   ├── vault_service.py        # [STUBBED] HashiCorp Vault
│   │   └── cloudflare_service.py   # [STUBBED] Cloudflare DNS
│   └── main.py
└── frontend/
    └── src/
        ├── components/
        │   ├── layout/             # Sidebar, TopBar, AppLayout
        │   ├── modes/              # PipelineMode, GenerateMode, ...
        │   └── shared/             # CodeBlock, TaskList, ClusterToggle
        ├── hooks/                  # useStream, useAgent, useKubernetes
        ├── store/                  # appStore, clusterStore, platformStore
        └── types/                  # shared TypeScript interfaces
```
