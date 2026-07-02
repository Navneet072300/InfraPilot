"""
Dockerfile templates and CI/CD pipeline prompt builder.
Templates are deterministic; pipelines are AI-generated from these prompts.
"""
from __future__ import annotations

# ── Dockerfile templates ───────────────────────────────────────────────────────

_DOCKERFILES: dict[str, str] = {
    # Node.js – generic (Express / Fastify / Koa)
    "node": """\
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE {port}
CMD ["node", "src/index.js"]
""",
    # Node.js – Next.js (standalone output)
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
    # Python – FastAPI
    "python-fastapi": """\
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE {port}
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "{port}"]
""",
    # Python – Django
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
    # Python – Flask
    "python-flask": """\
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE {port}
CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:{port}", "--workers", "4"]
""",
    # Go
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
    # Java – Maven
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
    # Java – Gradle
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
    # Rust
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
    # PHP
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
    # Ruby
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
    # Generic fallback
    "generic": """\
FROM ubuntu:22.04
WORKDIR /app
COPY . .
EXPOSE {port}
CMD ["bash", "start.sh"]
""",
}


def get_dockerfile(language: str, framework: str, port: int) -> str:
    """Return the best-fit Dockerfile template for the given language/framework."""
    lang = language.lower()
    fw = (framework or "").lower()

    key = "generic"
    if lang == "node.js":
        key = "node-nextjs" if "next" in fw else "node"
    elif lang == "python":
        if "django" in fw:
            key = "python-django"
        elif "fastapi" in fw or "fast" in fw:
            key = "python-fastapi"
        elif "flask" in fw:
            key = "python-flask"
        else:
            key = "python-fastapi"  # best generic Python default
    elif lang == "go":
        key = "go"
    elif lang == "java":
        key = "java-gradle" if "gradle" in fw else "java-maven"
    elif lang == "rust":
        key = "rust"
    elif lang == "php":
        key = "php"
    elif lang == "ruby":
        key = "ruby"

    return _DOCKERFILES[key].replace("{port}", str(port))


# ── docker-compose template ────────────────────────────────────────────────────

def get_compose_file(language: str, framework: str, port: int, app_name: str) -> str:
    """Return a docker-compose.yml for the given stack."""
    lang = language.lower()
    fw = (framework or "").lower()
    safe_name = app_name.lower().replace("/", "-").replace("_", "-")

    # Decide if we should add a database service hint
    db_hint = ""
    if "django" in fw or "rails" in fw or "spring" in fw or "laravel" in fw:
        db_hint = """
  # db:
  #   image: postgres:16-alpine
  #   environment:
  #     POSTGRES_DB: {name}
  #     POSTGRES_USER: app
  #     POSTGRES_PASSWORD: ${{DB_PASSWORD}}
  #   volumes:
  #     - db_data:/var/lib/postgresql/data
  #   networks:
  #     - {name}-net
""".format(name=safe_name)

    env_key = "NODE_ENV" if lang in ("node.js", "node", "javascript", "typescript") else "APP_ENV"

    return f"""\
version: '3.8'

services:
  {safe_name}:
    build:
      context: .
      dockerfile: Dockerfile
    image: {safe_name}:latest
    container_name: {safe_name}
    ports:
      - "{port}:{port}"
    environment:
      - {env_key}=production
      # Add your environment variables here — never commit real secrets
      # - DATABASE_URL=${{DATABASE_URL}}
      # - SECRET_KEY=${{SECRET_KEY}}
    restart: unless-stopped
    networks:
      - {safe_name}-net
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:{port}/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 20s
{db_hint}
  # redis:
  #   image: redis:7-alpine
  #   restart: unless-stopped
  #   networks:
  #     - {safe_name}-net

networks:
  {safe_name}-net:
    driver: bridge

volumes:
  db_data:
"""


# ── CD pipeline prompt builder (ArgoCD / FluxCD / Jenkins) ────────────────────

_CD_REGISTRY_IMAGE = {
    "ghcr":       "ghcr.io/{{REPO_FULL_NAME}}/{{APP_NAME}}",
    "docker-hub": "{{DOCKERHUB_USERNAME}}/{{APP_NAME}}",
    "ecr":        "{{AWS_ACCOUNT_ID}}.dkr.ecr.{{AWS_REGION}}.amazonaws.com/{{APP_NAME}}",
    "none":       "{{APP_NAME}}",
}

_CD_REGISTRY_AUTH = {
    "ghcr":       "GitHub Actions: use GITHUB_TOKEN (no extra secret). Other CI: use PAT with packages:write scope.",
    "docker-hub": "Secrets needed: DOCKERHUB_USERNAME, DOCKERHUB_TOKEN.",
    "ecr":        "Secrets: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION. Use aws-actions/amazon-ecr-login.",
    "none":       "No registry push — build only.",
}

_VAULT_NOTES = {
    "none":      "Use native Kubernetes Secrets (created manually or via CI env vars). Never commit secret values to git.",
    "hashicorp": (
        "HashiCorp Vault integration. Use vault-agent sidecar injection: add "
        "vault.hashicorp.com/agent-inject: 'true' annotation to Deployment pods. "
        "Secrets: VAULT_ADDR, VAULT_TOKEN for CI."
    ),
    "infisical": (
        "Infisical integration. Install infisical-k8s-operator and add an InfisicalSecret CRD "
        "that maps Infisical project secrets to a Kubernetes Secret. Secret: INFISICAL_TOKEN for CI."
    ),
    "aws-sm":    (
        "AWS Secrets Manager via External Secrets Operator (ESO). Deploy a SecretStore pointing to "
        "AWS SM, then ExternalSecret CRDs that sync secrets as K8s Secrets. Use IRSA or static creds."
    ),
}

_VAULT_SETUP = {
    "hashicorp": "Install Vault: helm repo add hashicorp https://helm.releases.hashicorp.com && helm install vault hashicorp/vault -n vault --create-namespace",
    "infisical": "Install Infisical operator: helm repo add infisical-helm-charts 'https://dl.cloudsmith.io/public/infisical/helm-charts/helm/charts/' && helm install infisical-standalone infisical-helm-charts/infisical-standalone -n infisical --create-namespace",
    "aws-sm":    "Install External Secrets Operator: helm repo add external-secrets https://charts.external-secrets.io && helm install external-secrets external-secrets/external-secrets -n external-secrets --create-namespace",
    "none":      "",
}


def build_cd_prompt(
    *,
    repo_full_name: str,
    branch: str,
    language: str,
    framework: str,
    cd_tool: str,
    config_tool: str,
    vault: str,
    vault_deployed: bool,
    registry: str,
    port: int,
    app_name: str,
) -> str:
    """Build prompt for generating a full CD pipeline with Helm/Kustomize + optional vault."""
    safe_name = app_name.lower().replace("/", "-").replace("_", "-")
    image_base = _CD_REGISTRY_IMAGE.get(registry, "{{REGISTRY}}/{{APP_NAME}}")
    image_base = image_base.replace("{{REPO_FULL_NAME}}", repo_full_name).replace("{{APP_NAME}}", safe_name)

    vault_note = _VAULT_NOTES.get(vault, "")
    vault_setup = "" if vault_deployed or vault == "none" else f"\nVault not yet deployed — include setup steps: {_VAULT_SETUP.get(vault, '')}"

    # Decide CI wrapper (ArgoCD/FluxCD need a separate CI step to build+push)
    needs_ci_workflow = cd_tool in ("argocd", "fluxcd")

    if cd_tool == "jenkins":
        files_list = f"""FILES TO GENERATE (use --- FILE: path --- separator for each):
1. Jenkinsfile — full declarative pipeline: checkout → build Docker image → push to registry → deploy via {config_tool} to Kubernetes
2. {config_tool}/  — complete {config_tool} chart/manifests (see details below)
3. setup-guide.md — checklist of secrets, one-time setup steps, how to trigger first run"""
    elif cd_tool == "argocd":
        files_list = f"""FILES TO GENERATE (use --- FILE: path --- separator for each):
1. .github/workflows/build-push.yml — CI: checkout → build → push image to registry (tag with git SHA)
2. argocd/application.yaml — ArgoCD Application manifest pointing to this repo's {config_tool}/ directory, branch {branch}
3. {config_tool}/  — complete {config_tool} chart/manifests (see details below)
4. setup-guide.md — checklist of secrets, ArgoCD install steps, app registration steps"""
    else:  # fluxcd
        files_list = f"""FILES TO GENERATE (use --- FILE: path --- separator for each):
1. .github/workflows/build-push.yml — CI: checkout → build → push image to registry (tag with git SHA)
2. flux/kustomization.yaml or flux/helmrelease.yaml — FluxCD resource pointing to {config_tool}/ in this repo
3. {config_tool}/  — complete {config_tool} chart/manifests (see details below)
4. setup-guide.md — checklist of secrets, Flux bootstrap steps, how to trigger reconciliation"""

    if config_tool == "helm":
        config_detail = f"""HELM CHART (helm/):
- Chart.yaml: name={safe_name}, version=0.1.0, appVersion=1.0.0
- values.yaml: image.repository={image_base}, image.tag=latest, replicaCount=2, service.port={port}, resources.requests.cpu=100m, resources.requests.memory=128Mi
- templates/deployment.yaml: standard Deployment with readinessProbe on /{port}, liveness probe, resource limits, env from ConfigMap + Secret
- templates/service.yaml: ClusterIP Service on port {port}
- templates/ingress.yaml: Ingress (commented out by default, show example)
- templates/configmap.yaml: non-secret config
- templates/secret.yaml: placeholder Secret (with vault annotations if vault!='none')"""
    else:  # kustomize
        config_detail = f"""KUSTOMIZE (kustomize/):
- base/deployment.yaml: Deployment with 2 replicas, image {image_base}:latest, port {port}, resource limits, probes
- base/service.yaml: ClusterIP Service port {port}
- base/kustomization.yaml: lists base resources
- overlays/production/kustomization.yaml: sets image tag to latest, increases replicas to 3, adds production labels
- overlays/staging/kustomization.yaml: sets replicas to 1, staging labels"""

    return f"""You are a senior DevOps engineer. Generate a production-ready CD pipeline setup.

PROJECT
- Repo: github.com/{repo_full_name}  Branch: {branch}
- Language: {language}  Framework: {framework or 'not detected'}
- App port: {port}  App name: {safe_name}
- Docker image: {image_base}:$GIT_SHA

CD TOOL: {cd_tool.upper()}
CONFIG TOOL: {config_tool}
REGISTRY: {registry.upper()} — {_CD_REGISTRY_AUTH.get(registry, '')}
VAULT / SECRETS: {vault.upper()} — {vault_note}{vault_setup}

{files_list}

{config_detail}

VAULT INTEGRATION:
{vault_note}
{f"Vault is already deployed and reachable." if vault_deployed and vault != "none" else ""}
{"Add appropriate annotations/CRDs to deployment manifests for secret injection." if vault != "none" else "Use standard K8s Secrets with placeholder values."}

OUTPUT FORMAT — use EXACTLY this separator for every file, no exceptions:
--- FILE: relative/path/to/file ---
[complete file content, no truncation]

Generate ALL files completely. Do not truncate or skip any file. No markdown fences inside file content.
"""


# ── CI/CD pipeline prompt builder ─────────────────────────────────────────────

_REGISTRY_NOTES = {
    "ghcr": "GitHub Container Registry (ghcr.io). Auth: docker/login-action with GITHUB_TOKEN — no extra secret needed.",
    "ecr": "AWS ECR. Auth: aws-actions/configure-aws-credentials + aws-actions/amazon-ecr-login. Secrets needed: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, ECR_REPOSITORY.",
    "docker-hub": "Docker Hub. Auth: docker login with DOCKERHUB_USERNAME and DOCKERHUB_TOKEN secrets.",
    "none": "No registry push. Build image locally only (for validation / local deploy).",
}

_SECRETS_NOTES = {
    "native": {
        "github-actions": "Use GitHub Secrets (${{ secrets.SECRET_NAME }}). List ALL secrets as comments at the top of the file so the user knows what to add in Settings → Secrets.",
        "jenkins": "Use Jenkins Credentials (withCredentials block). List credential IDs as comments so the user knows what to add in Jenkins → Manage Credentials.",
        "gitlab-ci": "Use GitLab CI/CD Variables ($VARIABLE_NAME). List ALL variables as comments.",
    },
    "vault": "Use HashiCorp Vault. Add a vault-login step before secret retrieval using VAULT_ADDR and VAULT_TOKEN secrets.",
    "infisical": "Use Infisical. Install the Infisical CLI and run `infisical run --env=prod -- <command>`. Use INFISICAL_TOKEN secret.",
    "aws-sm": "Use AWS Secrets Manager. Use `aws secretsmanager get-secret-value` to retrieve secrets and export as environment variables.",
    "none": "No external secrets needed. Hardcode only non-sensitive config; leave placeholders for anything sensitive.",
}

_DEPLOY_NOTES = {
    "kubernetes": "Deploy to Kubernetes using kubectl. Secret: KUBE_CONFIG (base64-encoded kubeconfig). Steps: decode kubeconfig → kubectl set image deployment/APP-NAME CONTAINER=IMAGE:TAG → kubectl rollout status.",
    "docker-ssh": "Deploy to a remote Docker host via SSH. Secrets: DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_KEY. Steps: SSH in → docker pull → docker stop old container → docker run new container.",
    "ecs": "Deploy to AWS ECS. After pushing to ECR, run: aws ecs update-service --cluster CLUSTER_NAME --service SERVICE_NAME --force-new-deployment.",
    "build-only": "Build and push image only — no deployment step. Add a comment: '# Add your deploy step here'.",
}

_CICD_FILE_MAP = {
    "github-actions": ".github/workflows/ci-cd.yml",
    "jenkins": "Jenkinsfile",
    "gitlab-ci": ".gitlab-ci.yml",
}


def build_pipeline_prompt(
    *,
    repo_full_name: str,
    branch: str,
    language: str,
    framework: str,
    ci_tool: str,
    registry: str,
    secrets_manager: str,
    deploy_target: str,
    has_dockerfile: bool,
    port: int,
    app_name: str,
) -> tuple[str, str]:
    """
    Build the AI prompt for generating a CI/CD pipeline.
    Returns (prompt, output_filename).
    """
    output_file = _CICD_FILE_MAP.get(ci_tool, "pipeline.yml")
    owner = repo_full_name.split("/")[0] if "/" in repo_full_name else "owner"

    # Resolve secrets note (native is CI-tool specific)
    if secrets_manager == "native":
        secrets_note = _SECRETS_NOTES["native"].get(ci_tool, "Use the native secrets mechanism of the CI tool.")
    else:
        secrets_note = _SECRETS_NOTES.get(secrets_manager, "")

    dockerfile_note = (
        "A Dockerfile already exists at the repo root."
        if has_dockerfile
        else "A Dockerfile will be added to the repo root before this pipeline runs."
    )

    registry_image = {
        "ghcr": f"ghcr.io/{repo_full_name}",
        "ecr": f"<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/{app_name}",
        "docker-hub": f"<DOCKERHUB_USERNAME>/{app_name}",
        "none": app_name,
    }.get(registry, app_name)

    prompt = f"""Generate a complete, production-ready {_ci_tool_label(ci_tool)} CI/CD pipeline.

PROJECT
- Repo: github.com/{repo_full_name}  Branch: {branch}
- Language: {language}  Framework: {framework or 'none detected'}
- App port: {port}  App name: {app_name}
- {dockerfile_note}

PIPELINE REQUIREMENTS

1. TRIGGER
{_trigger_rules(ci_tool, branch)}

2. BUILD DOCKER IMAGE
   Image tag: {registry_image}:$GIT_SHA (use the commit SHA as tag, also tag :latest)

3. CONTAINER REGISTRY — {registry.upper()}
   {_REGISTRY_NOTES.get(registry, '')}

4. SECRETS MANAGEMENT — {secrets_manager.upper()}
   {secrets_note}

5. DEPLOY — {deploy_target.upper()}
   {_DEPLOY_NOTES.get(deploy_target, '')}

OUTPUT
Generate ONLY the file {output_file}. No extra explanation, no markdown fences around the file.
Use EXACTLY this output format so InfraPilot can extract it:
--- FILE: {output_file} ---
[complete file content]

Also append a brief --- FILE: setup-guide.md --- with:
- Required secrets/credentials checklist (exactly what the user needs to set up)
- One-time setup steps (e.g. create ECR repo, add kubeconfig secret)
- How to trigger the first pipeline run
"""
    return prompt, output_file


def _ci_tool_label(ci_tool: str) -> str:
    return {
        "github-actions": "GitHub Actions",
        "jenkins": "Jenkins (declarative pipeline)",
        "gitlab-ci": "GitLab CI",
    }.get(ci_tool, ci_tool)


def _trigger_rules(ci_tool: str, branch: str) -> str:
    if ci_tool == "github-actions":
        return f"   push to {branch} + pull_request against {branch}"
    if ci_tool == "jenkins":
        return f"   SCM polling or webhook on branch {branch} + PR builds"
    if ci_tool == "gitlab-ci":
        return f"   push to {branch} + merge request pipelines"
    return f"   push to {branch}"
