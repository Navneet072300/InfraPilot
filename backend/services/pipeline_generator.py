"""
Dockerfile templates and CI/CD pipeline prompt builder.
"""
from __future__ import annotations

# ── Dockerfile templates ───────────────────────────────────────────────────────

_DOCKERFILES: dict[str, str] = {
    "node": """\
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE {port}
CMD ["node", "src/index.js"]
""",
    "node-nextjs": """\
FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
USER nextjs
EXPOSE {port}
ENV PORT={port}
CMD ["node", "server.js"]
""",
    "node-react": """\
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY --from=builder /app/build /usr/share/nginx/html 2>/dev/null || true
EXPOSE {port}
CMD ["nginx", "-g", "daemon off;"]
""",
    "node-vue": """\
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE {port}
CMD ["nginx", "-g", "daemon off;"]
""",
    "python-fastapi": """\
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE {port}
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "{port}"]
""",
    "python-django": """\
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN python manage.py collectstatic --noinput
EXPOSE {port}
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:{port}", "--workers", "4"]
""",
    "python-flask": """\
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE {port}
CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:{port}", "--workers", "4"]
""",
    "go": """\
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o app .

FROM alpine:3.19
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /root/
COPY --from=builder /app/app .
EXPOSE {port}
CMD ["./app"]
""",
    "java-maven": """\
FROM maven:3.9-eclipse-temurin-21-alpine AS builder
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:resolve -q
COPY src ./src
RUN mvn package -DskipTests -q

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /app/target/*.jar app.jar
EXPOSE {port}
ENTRYPOINT ["java", "-jar", "app.jar"]
""",
    "java-gradle": """\
FROM gradle:8.5-jdk21-alpine AS builder
WORKDIR /app
COPY build.gradle settings.gradle ./
RUN gradle dependencies --no-daemon -q
COPY src ./src
RUN gradle build --no-daemon -x test -q

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /app/build/libs/*.jar app.jar
EXPOSE {port}
ENTRYPOINT ["java", "-jar", "app.jar"]
""",
    "rust": """\
FROM rust:1.75-alpine AS builder
RUN apk add --no-cache musl-dev
WORKDIR /app
COPY Cargo.* ./
RUN cargo fetch
COPY src ./src
RUN cargo build --release

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /app/target/release/app .
EXPOSE {port}
CMD ["./app"]
""",
    "php": """\
FROM php:8.3-fpm-alpine
RUN docker-php-ext-install pdo pdo_mysql opcache
WORKDIR /var/www/html
COPY . .
RUN if [ -f composer.json ]; then \\
    curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer && \\
    composer install --no-dev --optimize-autoloader; \\
fi
EXPOSE 9000
CMD ["php-fpm"]
""",
    "ruby": """\
FROM ruby:3.3-alpine
RUN apk add --no-cache build-base nodejs yarn postgresql-dev
WORKDIR /app
COPY Gemfile* ./
RUN bundle install --without development test
COPY . .
EXPOSE {port}
CMD ["bundle", "exec", "puma", "-C", "config/puma.rb"]
""",
    "generic": """\
FROM ubuntu:22.04
WORKDIR /app
COPY . .
EXPOSE {port}
CMD ["bash", "start.sh"]
""",
}


def get_dockerfile(language: str, framework: str, port: int) -> str:
    lang = language.lower()
    fw = (framework or "").lower()
    key = "generic"
    if lang == "node.js":
        if "next" in fw:       key = "node-nextjs"
        elif "react" in fw:    key = "node-react"
        elif "vue" in fw:      key = "node-vue"
        else:                  key = "node"
    elif lang == "python":
        if "django" in fw:     key = "python-django"
        elif "flask" in fw:    key = "python-flask"
        else:                  key = "python-fastapi"
    elif lang == "go":         key = "go"
    elif lang == "java":       key = "java-gradle" if "gradle" in fw else "java-maven"
    elif lang == "rust":       key = "rust"
    elif lang == "php":        key = "php"
    elif lang == "ruby":       key = "ruby"
    return _DOCKERFILES[key].replace("{port}", str(port))


# ── Multi-service docker-compose ───────────────────────────────────────────────

def get_compose_file(language: str, framework: str, port: int, app_name: str) -> str:
    """Single-service docker-compose.yml (used as fallback)."""
    safe = app_name.lower().replace("/", "-").replace("_", "-")
    env_key = "NODE_ENV" if language.lower() in ("node.js", "node") else "APP_ENV"
    db_hint = ""
    fw = (framework or "").lower()
    if any(x in fw for x in ("django", "rails", "spring", "laravel")):
        db_hint = f"""
  # db:
  #   image: postgres:16-alpine
  #   environment:
  #     POSTGRES_DB: {safe}
  #     POSTGRES_USER: app
  #     POSTGRES_PASSWORD: ${{DB_PASSWORD}}
  #   volumes:
  #     - db_data:/var/lib/postgresql/data
  #   networks:
  #     - {safe}-net
"""
    return f"""\
version: '3.8'

services:
  {safe}:
    build:
      context: .
      dockerfile: Dockerfile
    image: {safe}:latest
    container_name: {safe}
    ports:
      - "{port}:{port}"
    environment:
      - {env_key}=production
      # - DATABASE_URL=${{DATABASE_URL}}
      # - SECRET_KEY=${{SECRET_KEY}}
    restart: unless-stopped
    networks:
      - {safe}-net
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:{port}/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 20s
{db_hint}
networks:
  {safe}-net:
    driver: bridge

volumes:
  db_data:
"""


def get_multi_compose(services: list[dict], app_name: str) -> str:
    """Generate docker-compose.yml for multiple services."""
    safe_app = app_name.lower().replace("/", "-").replace("_", "-")
    svc_blocks = []
    ports_used: set[int] = set()

    for svc in services:
        name = svc["name"].lower().replace("_", "-")
        path = svc.get("path", ".").rstrip("/")
        port = int(svc.get("port", 8080))
        lang = svc.get("language", "").lower()
        fw = svc.get("framework", "").lower()

        # Avoid port conflicts
        host_port = port
        while host_port in ports_used:
            host_port += 1
        ports_used.add(host_port)

        env_key = "NODE_ENV" if lang in ("node.js", "node") else "APP_ENV"
        context = f"./{path}" if path != "." else "."
        dockerfile = "Dockerfile"

        svc_blocks.append(f"""\
  {name}:
    build:
      context: {context}
      dockerfile: {dockerfile}
    image: {name}:latest
    container_name: {safe_app}-{name}
    ports:
      - "{host_port}:{port}"
    environment:
      - {env_key}=production
      # - DATABASE_URL=${{DATABASE_URL}}
    restart: unless-stopped
    networks:
      - {safe_app}-net
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:{port}/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 20s""")

    services_yaml = "\n\n".join(svc_blocks)
    return f"""\
version: '3.8'

services:
{services_yaml}

  # db:
  #   image: postgres:16-alpine
  #   environment:
  #     POSTGRES_DB: {safe_app}
  #     POSTGRES_USER: app
  #     POSTGRES_PASSWORD: ${{DB_PASSWORD}}
  #   volumes:
  #     - db_data:/var/lib/postgresql/data
  #   networks:
  #     - {safe_app}-net

networks:
  {safe_app}-net:
    driver: bridge

volumes:
  db_data:
"""


# ── Registry / vault helpers ───────────────────────────────────────────────────

_REGISTRY_IMAGE = {
    "ghcr":       "ghcr.io/{repo}/{name}",
    "docker-hub": "{dockerhub_user}/{name}",
    "ecr":        "{aws_account}.dkr.ecr.{aws_region}.amazonaws.com/{name}",
}

_REGISTRY_AUTH = {
    "ghcr":       "GITHUB_TOKEN (no extra secret needed for GitHub Actions). Other CI: PAT with packages:write.",
    "docker-hub": "Secrets: DOCKERHUB_USERNAME, DOCKERHUB_TOKEN.",
    "ecr":        "Secrets: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION. Use aws-actions/amazon-ecr-login.",
}

_VAULT_NOTES = {
    "none":      "Native Kubernetes Secrets — never commit real values, set via kubectl or CI env vars.",
    "hashicorp": "HashiCorp Vault: vault-agent sidecar injection. Annotation: vault.hashicorp.com/agent-inject='true'. CI secrets: VAULT_ADDR, VAULT_TOKEN.",
    "infisical": "Infisical K8s operator: InfisicalSecret CRD syncs to K8s Secret. CI secret: INFISICAL_TOKEN.",
    "aws-sm":    "AWS Secrets Manager via External Secrets Operator: SecretStore + ExternalSecret CRDs. Use IRSA for auth.",
}

_VAULT_SETUP = {
    "hashicorp": "helm repo add hashicorp https://helm.releases.hashicorp.com && helm install vault hashicorp/vault -n vault --create-namespace",
    "infisical": "helm repo add infisical-helm-charts 'https://dl.cloudsmith.io/public/infisical/helm-charts/helm/charts/' && helm install infisical-standalone infisical-helm-charts/infisical-standalone -n infisical --create-namespace",
    "aws-sm":    "helm repo add external-secrets https://charts.external-secrets.io && helm install external-secrets external-secrets/external-secrets -n external-secrets --create-namespace",
}

_ENV_BRANCH: dict[str, str] = {
    "dev":     "dev",
    "staging": "staging",
    "prod":    "main",
}

_CI_FILE: dict[str, str] = {
    "github-actions": ".github/workflows/ci.yml",
    "gitlab-ci":      ".gitlab-ci.yml",
    "jenkins":        "Jenkinsfile",
}


def build_deploy_prompt(
    *,
    repo_full_name: str,
    services: list[dict],
    ci_tool: str,
    cd_tool: str,
    config_tool: str,
    vault: str,
    vault_deployed: bool,
    registry: str,
    environments: list[str],
    app_name: str,
) -> str:
    """
    Build the AI prompt for generating a full multi-service, multi-environment
    CI/CD pipeline (CI build + CD deploy + K8s manifests).
    """
    safe_app = app_name.lower().replace("/", "-").replace("_", "-")
    owner = repo_full_name.split("/")[0] if "/" in repo_full_name else "owner"
    repo_name = repo_full_name.split("/")[-1] if "/" in repo_full_name else repo_full_name

    # Build service image references
    svc_images = []
    for svc in services:
        name = svc["name"].lower().replace("_", "-")
        if registry == "ghcr":
            img = f"ghcr.io/{repo_full_name}/{name}"
        elif registry == "docker-hub":
            img = f"{{DOCKERHUB_USERNAME}}/{name}"
        elif registry == "ecr":
            img = f"{{AWS_ACCOUNT_ID}}.dkr.ecr.{{AWS_REGION}}.amazonaws.com/{name}"
        else:
            img = name
        svc_images.append({"name": name, "image": img, "port": svc.get("port", 8080), "path": svc.get("path", ".")})

    # Environment / branch mapping
    env_branches = {env: _ENV_BRANCH.get(env, env) for env in environments}

    # Service summary
    svc_summary = "\n".join(
        f"  - {s['name']}: {s.get('language','?')} / {s.get('framework','?')}, port {s.get('port',8080)}, path {s.get('path','.')}"
        for s in services
    )
    img_summary = "\n".join(f"  - {s['name']}: {s['image']}:$GIT_SHA" for s in svc_images)
    env_summary = "\n".join(f"  - {env} environment → triggered by push to '{branch}' branch" for env, branch in env_branches.items())

    # Vault notes
    vault_note = _VAULT_NOTES.get(vault, "")
    vault_setup = ""
    if vault != "none" and not vault_deployed:
        vault_setup = f"\nVault NOT yet deployed. Include one-time setup: {_VAULT_SETUP.get(vault, '')}"

    # Config tool detail
    if config_tool == "helm":
        config_desc = f"""HELM CHART at helm/:
- Chart.yaml: name={safe_app}, version=0.1.0
- values.yaml: base defaults (all services, replicas, images, ports)
- values-dev.yaml: overrides for dev (lower replicas, debug flags)
- values-staging.yaml: overrides for staging
- values-prod.yaml: overrides for prod (higher replicas, resource limits)
- templates/: one Deployment + Service per detected service, Ingress (commented), ConfigMap, HPA"""
    else:
        config_desc = f"""KUSTOMIZE at kustomize/:
- base/: base Deployment + Service for each service, kustomization.yaml
- overlays/dev/: patches — replicas=1, dev env vars, kustomization.yaml
- overlays/staging/: patches — replicas=2, staging env vars
- overlays/prod/: patches — replicas=3, production resource limits, kustomization.yaml"""

    # CD tool manifest requests
    if cd_tool == "argocd":
        cd_files = "- argocd/: one Application manifest per environment (application-dev.yaml, application-prod.yaml etc.), pointing to this repo's config dir + respective overlay/values file"
    elif cd_tool == "fluxcd":
        cd_files = "- flux/: one Kustomization or HelmRelease per environment, pointing to the config dir + overlay"
    else:
        cd_files = "- (CD is inline in CI — kubectl apply commands in the deploy job)"

    # CI file
    ci_file = _CI_FILE.get(ci_tool, "ci.yml")

    # Branch conditions per CI tool
    branch_list = list(env_branches.values())
    branches_str = ", ".join(branch_list)

    if ci_tool == "github-actions":
        trigger_desc = f"on.push.branches: [{branches_str}]. Each environment has a separate job with: if: github.ref == 'refs/heads/BRANCH'"
    elif ci_tool == "gitlab-ci":
        trigger_desc = f"Triggered on pushes to [{branches_str}]. Use only: [BRANCH] rules per job. Each env is a separate deploy stage."
    else:  # jenkins
        trigger_desc = f"Declarative Jenkinsfile with when {{ branch 'BRANCH' }} conditions for each deploy stage. Branches: [{branches_str}]."

    # Build multi-env context
    envs_desc = []
    for env, branch in env_branches.items():
        ns = f"{safe_app}-{env}" if env != "prod" else safe_app
        envs_desc.append(f"  - env='{env}': namespace={ns}, triggered by branch '{branch}', uses {config_tool} overlay/values for {env}")
    envs_detail = "\n".join(envs_desc)

    return f"""You are a senior DevOps engineer. Generate a complete, production-ready CI/CD pipeline for a multi-service application.

REPOSITORY: github.com/{repo_full_name}

SERVICES ({len(services)} detected):
{svc_summary}

DOCKER IMAGES (registry: {registry.upper()}):
{img_summary}
Registry auth: {_REGISTRY_AUTH.get(registry, '')}

ENVIRONMENTS & BRANCH STRATEGY:
{env_summary}
Note: {', '.join(env_branches.get('prod', 'main') and ['main branch is protected'] or [])}

CI TOOL: {ci_tool.upper().replace('-', ' ')}
CD TOOL: {cd_tool.upper()}
CONFIG TOOL: {config_tool.upper()}
VAULT/SECRETS: {vault.upper()} — {vault_note}{vault_setup}

FILES TO GENERATE (use EXACTLY --- FILE: path --- separator for every file):

1. {ci_file} — CI/CD pipeline:
   Triggers: {trigger_desc}
   Jobs structure:
   a) build-SERVICENAME job for EACH service: checkout → build Docker image from service path → push to registry (tag: $GIT_SHA and :ENV-latest)
   b) One deploy job per environment, gated by branch condition:
      - deploy-{list(environments)[0] if environments else 'dev'}: triggers on branch '{env_branches.get(list(environments)[0], 'dev')}' → deploys to {list(environments)[0]} namespace
      {f"- deploy-{list(environments)[1]}: triggers on branch '{env_branches.get(list(environments)[1], 'main')}' → deploys to {list(environments)[1]} namespace" if len(environments) > 1 else ""}
      {f"- deploy-{list(environments)[2]}: triggers on branch '{env_branches.get(list(environments)[2], 'main')}' → deploys to {list(environments)[2]} namespace" if len(environments) > 2 else ""}
   c) All required secrets listed as comments at the top

2. Kubernetes manifests — one folder per environment:
{envs_detail}
   Files per environment:
   - manifests/ENV/namespace.yaml: Namespace with label env=ENV
   - manifests/ENV/SERVICENAME-deployment.yaml: Deployment for each service (image from registry, env-specific replicas, resource requests/limits, readiness + liveness probes)
   - manifests/ENV/SERVICENAME-service.yaml: ClusterIP Service for each service
   - manifests/ENV/ingress.yaml: Ingress (host: ENV.{repo_name}.example.com or similar) — include even if commented

3. Config management ({config_tool}):
{config_desc}

4. CD resources ({cd_tool}):
{cd_files}

5. setup-guide.md:
   - Required secrets/tokens checklist (what to add, where)
   - One-time cluster setup steps
   - Branch strategy explanation (which branch deploys where)
   - How to trigger first run

ENVIRONMENT NAMESPACES:
{envs_detail}

VAULT INTEGRATION:
{vault_note}
{"Vault is already deployed." if vault_deployed and vault != "none" else ""}
{"Add vault annotations/CRDs to ALL Deployment manifests." if vault != "none" else "Use standard K8s Secrets with placeholder values (never commit real secrets)."}

CRITICAL RULES:
- Generate EVERY file completely — no truncation, no "... rest of file ..."
- Each service gets its own Deployment and Service manifest in each env folder
- The CI pipeline must have separate build jobs per service (they can be parallel)
- Branch conditions must be EXACT: dev branch → dev env, {env_branches.get('staging', 'staging') if 'staging' in environments else 'staging branch → staging env'}, main branch → prod
- Image tags: use git commit SHA for immutability (e.g., ${{{{ github.sha }}}} for GitHub Actions)
- No markdown fences inside file content
- Use the --- FILE: path --- separator without exception
"""
