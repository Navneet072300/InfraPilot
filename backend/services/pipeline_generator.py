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
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY . .
EXPOSE {port}
# TODO: replace this with your actual start command
CMD ["echo", "No start command configured — edit this Dockerfile"]
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
    "hashicorp": (
        "HashiCorp Vault + CSI Secrets Store driver (secrets-store.csi.x-k8s.io). "
        "SecretProviderClass CRD per overlay — only field that differs per env is vaultKubernetesMountPath: "
        "'kubernetes' for prod, 'kubernetes-dev' for dev/staging. "
        "Deployment mounts BOTH CSI volumes (vault-secrets + vault-ghcr-secrets); K8s Secrets are NOT created until pod mounts them. "
        "Separate KV paths per env: secret/data/<app>/prod and secret/data/<app>/dev. "
        "CRITICAL: alias_name_source=serviceaccount_name in Vault role (NOT UID — UID changes on SA recreate)."
    ),
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
    safe_app = app_name.lower().replace("/", "-").replace("_", "-")
    repo_name = repo_full_name.split("/")[-1] if "/" in repo_full_name else repo_full_name

    # ── Image references ──────────────────────────────────────────────────────
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
        svc_images.append({
            "name": name, "image": img,
            "port": svc.get("port", 8080),
            "path": svc.get("path", "."),
            "role": svc.get("role", "backend"),
            "endpoint_url": svc.get("endpoint_url", "") or svc.get("endpoint_path", ""),
        })

    # ── Env / branch mapping ──────────────────────────────────────────────────
    env_branches = {env: _ENV_BRANCH.get(env, env) for env in environments}
    branch_list = list(env_branches.values())
    branches_str = ", ".join(branch_list)

    # ── Config folder name ────────────────────────────────────────────────────
    config_dir = "helm" if config_tool == "helm" else "k8s"

    # ── Summaries ─────────────────────────────────────────────────────────────
    from urllib.parse import urlparse as _urlparse

    def _parse_url(raw: str) -> tuple[str, str]:
        """Return (host, path) from a URL like https://api.myapp.com/v1"""
        raw = raw.strip()
        if not raw:
            return ("", "")
        if not raw.startswith("http"):
            raw = "https://" + raw
        p = _urlparse(raw)
        host = p.netloc or p.path.split("/")[0]
        path = p.path if p.path else "/"
        if not path:
            path = "/"
        return (host, path)

    def _ep(s: dict) -> str:
        url = s.get("endpoint_url", "") or s.get("endpoint_path", "")
        if not url:
            return " (no public URL — worker/internal)"
        host, path = _parse_url(url)
        return f", public-url {url} (host: {host}, path: {path})"

    svc_summary = "\n".join(
        f"  - {s['name']} [{s.get('role','backend')}]: {s.get('language','?')} / {s.get('framework','?')}"
        f", container-port {s.get('port',8080)}, src {s.get('path','.')}{_ep(s)}"
        for s in services
    )

    # Ingress routing table — host-based rules for Kubernetes Ingress + TLS
    public_svcs = [s for s in services if s.get("endpoint_url") or s.get("endpoint_path")]
    if public_svcs:
        ingress_rows = []
        for s in public_svcs:
            url = s.get("endpoint_url", "") or s.get("endpoint_path", "")
            host, path = _parse_url(url)
            ingress_rows.append(
                f"  host: {host or '(set your domain)'}, path: {path} → {s['name']}:{s.get('port',8080)}"
            )
        ingress_routes = "\n".join(ingress_rows)
    else:
        ingress_routes = "  (no public URLs provided — use placeholder hosts, user will configure DNS later)"
    img_summary = "\n".join(f"  - {s['name']}: {s['image']}:$GIT_SHA" for s in svc_images)
    env_summary = "\n".join(
        f"  - {env} → branch '{branch}' → namespace {safe_app if env == 'prod' else f'{safe_app}-{env}'}"
        for env, branch in env_branches.items()
    )

    # ── Vault notes ───────────────────────────────────────────────────────────
    vault_note = _VAULT_NOTES.get(vault, "")
    vault_setup = ""
    if vault != "none" and not vault_deployed:
        vault_setup = f"\nVault NOT yet deployed — include one-time setup: {_VAULT_SETUP.get(vault, '')}"

    # ── Vault CSI detail (hashicorp) ──────────────────────────────────────────
    vault_csi_detail = ""
    if vault == "hashicorp":
        spc_per_env = "\n".join(
            f"  {env}/secret-provider-class.yaml: vaultKubernetesMountPath: '{'kubernetes' if env == 'prod' else 'kubernetes-dev'}'"
            for env in environments
        )
        vault_csi_detail = f"""
VAULT CSI SECRETS STORE PATTERN (use this, NOT vault-agent sidecar):
SecretProviderClass per overlay (only vaultKubernetesMountPath differs):
{spc_per_env}

SecretProviderClass spec:
  apiVersion: secrets-store.csi.x-k8s.io/v1
  kind: SecretProviderClass
  spec:
    provider: vault
    secretObjects:
    - secretName: <service>-secret
      type: Opaque
      data: [{{key: DATABASE_URL, objectName: DATABASE_URL}}, ...]
    parameters:
      vaultAddress: 'https://vault.iamsaif.ai'
      roleName: '<service>'
      vaultKubernetesMountPath: 'kubernetes'   # 'kubernetes-dev' for dev/staging overlays
      objects: |
        - objectName: 'DATABASE_URL'
          secretPath: 'secret/data/<service>/<env>'   # SEPARATE PATH PER ENV
          secretKey: 'DATABASE_URL'

GHCR pull secret (also per overlay, ghcr-secret-provider-class.yaml):
  secretObjects[0].secretName: ghcr-credentials
  secretObjects[0].type: kubernetes.io/dockerconfigjson
  secretObjects[0].data[0].key: .dockerconfigjson
  parameters.objects: objectName: dockerconfigjson, secretPath: secret/data/ghcr, secretKey: dockerconfigjson

Deployment MUST include BOTH CSI volumes (K8s Secret only created when pod mounts volume):
  volumeMounts:
  - {{name: vault-secrets,      mountPath: /mnt/vault-secrets,      readOnly: true}}
  - {{name: vault-ghcr-secrets, mountPath: /mnt/vault-ghcr-secrets, readOnly: true}}
  volumes:
  - name: vault-secrets
    csi: {{driver: secrets-store.csi.k8s.io, readOnly: true, volumeAttributes: {{secretProviderClass: 'vault-<service>'}}}}
  - name: vault-ghcr-secrets
    csi: {{driver: secrets-store.csi.k8s.io, readOnly: true, volumeAttributes: {{secretProviderClass: 'vault-ghcr'}}}}
  envFrom: [{{secretRef: {{name: <service>-secret}}}}]
  imagePullSecrets: [{{name: ghcr-credentials}}]

CRITICAL VAULT RULES:
- Field is 'vaultKubernetesMountPath' NOT 'kubernetesMountPath' (wrong key silently ignored)
- alias_name_source=serviceaccount_name in Vault role (NOT UID)
- KV paths SEPARATE per env: secret/data/<service>/prod vs secret/data/<service>/dev
"""

    # ── CI trigger desc ───────────────────────────────────────────────────────
    ci_file = _CI_FILE.get(ci_tool, "ci.yml")
    if ci_tool == "github-actions":
        trigger_desc = f"on.push.branches: [{branches_str}]. Separate deploy job per env, each gated by: if: github.ref == 'refs/heads/BRANCH'"
    elif ci_tool == "gitlab-ci":
        trigger_desc = f"Push triggers on [{branches_str}]. Use only: [BRANCH] rules per job/stage."
    else:
        trigger_desc = f"Declarative Jenkinsfile. when {{ branch 'BRANCH' }} per stage. Branches: [{branches_str}]."

    # ── Config section (folder-naming is critical) ────────────────────────────
    if config_tool == "helm":
        base_deployments = "\n".join(
            f"helm/templates/{s['name']}-deployment.yaml — Deployment with CSI volume mounts, secretRef, imagePullSecrets" if vault == "hashicorp"
            else f"helm/templates/{s['name']}-deployment.yaml — Deployment"
            for s in services
        )
        base_services = "\n".join(f"helm/templates/{s['name']}-service.yaml — ClusterIP Service" for s in services)
        staging_values = "helm/values-staging.yaml — staging overrides: replicas=2\n" if "staging" in environments else ""
        spc_template = "\nhelm/templates/secret-provider-class.yaml — SecretProviderClass (vaultKubernetesMountPath from values per env)\nhelm/templates/ghcr-secret-provider-class.yaml — GHCR pull secret via CSI" if vault == "hashicorp" else ""
        config_section = f"""\
helm/Chart.yaml — name={safe_app}, version=0.1.0
helm/values.yaml — base defaults: image tags, replicas, ports, service config
helm/values-dev.yaml — dev overrides: replicas=1, debug=true, lower resource limits
{staging_values}helm/values-prod.yaml — prod overrides: replicas=3, higher resource limits, production flags
helm/templates/_helpers.tpl — name/label helpers
helm/templates/namespace.yaml
helm/templates/serviceaccount.yaml — SA that matches Vault role bound_service_account_names
helm/templates/configmap.yaml — non-secret config
{base_deployments}
{base_services}
helm/templates/ingress.yaml — Ingress with path-based routing per INGRESS ROUTING table above, TLS commented by default{spc_template}"""
    else:
        # kustomize → k8s/
        base_deployments = "\n".join(
            f"k8s/base/{s['name']}-deployment.yaml — Deployment with CSI volume mounts, secretRef: <service>-secret, imagePullSecrets: ghcr-credentials"
            for s in services
        )
        base_services = "\n".join(f"k8s/base/{s['name']}-service.yaml — ClusterIP Service" for s in services)
        overlay_blocks = []
        for env in environments:
            auth_path = "kubernetes" if env == "prod" else "kubernetes-dev"
            env_spc = f"k8s/overlays/{env}/secret-provider-class.yaml — vaultKubernetesMountPath: '{auth_path}'"
            env_ghcr = f"k8s/overlays/{env}/ghcr-secret-provider-class.yaml — same pattern, GHCR dockerconfigjson"
            env_kust = f"k8s/overlays/{env}/kustomization.yaml — resources: [../../base, secret-provider-class.yaml, ghcr-secret-provider-class.yaml]"
            if vault != "hashicorp":
                overlay_blocks.append(
                    f"k8s/overlays/{env}/kustomization.yaml — resources: [../../base], patches for replicas/env-vars"
                )
            else:
                overlay_blocks.append(f"{env_spc}\n{env_ghcr}\n{env_kust}")
        overlays_section = "\n\n".join(overlay_blocks)
        config_section = f"""\
k8s/base/namespace.yaml — Namespace
k8s/base/serviceaccount.yaml — ServiceAccount (name must match Vault role bound_service_account_names)
k8s/base/configmap.yaml — non-secret config (DB host, ports, feature flags)
{base_deployments}
{base_services}
k8s/base/ingress.yaml — Ingress with path-based routing per INGRESS ROUTING table above, TLS commented by default
k8s/base/kustomization.yaml — lists all base resources

{overlays_section}"""

    # ── CD section ────────────────────────────────────────────────────────────
    if cd_tool == "argocd":
        argocd_files = []
        for env in environments:
            suffix = "" if env == "prod" else f"-{env}"
            if config_tool == "kustomize":
                path_ref = f"path: k8s/overlays/{env}"
            else:
                path_ref = f"path: helm, targetRevision + values: values-{env}.yaml"
            argocd_files.append(f"argocd/application{suffix}.yaml — ArgoCD Application → {path_ref}, branch {env_branches[env]}")
        cd_section = "\n".join(argocd_files)
    elif cd_tool == "fluxcd":
        flux_files = []
        for env in environments:
            kind = "HelmRelease" if config_tool == "helm" else "Kustomization"
            flux_files.append(f"flux/{kind.lower()}-{env}.yaml — FluxCD {kind} for {env} from {config_dir}/{'overlays/' + env if config_tool == 'kustomize' else ''}")
        cd_section = "\n".join(flux_files)
    else:
        cd_section = "(Inline deploy — kubectl apply -k k8s/overlays/ENV in CI deploy jobs)"

    # ── Env namespace detail ──────────────────────────────────────────────────
    envs_detail = "\n".join(
        f"  {env}: namespace={safe_app if env == 'prod' else f'{safe_app}-{env}'}, branch={env_branches[env]}, "
        f"vault_auth_path={'kubernetes' if env == 'prod' else 'kubernetes-dev'}"
        for env in environments
    )

    return f"""You are a senior DevOps engineer. Generate a complete, production-ready CI/CD pipeline for a multi-service application.

REPOSITORY: github.com/{repo_full_name}

SERVICES ({len(services)}):
{svc_summary}

INGRESS ROUTING (use these exact hosts and paths in every Ingress resource — one rule per service):
{ingress_routes}
Generate host-based Ingress rules (spec.rules[].host). Add TLS block with secretName per host (commented out — user enables after DNS is set). Workers with no public URL must NOT appear in Ingress.

DOCKER IMAGES (registry: {registry.upper()}):
{img_summary}
Registry auth: {_REGISTRY_AUTH.get(registry, '')}

ENVIRONMENTS & BRANCH STRATEGY:
{env_summary}
main branch is protected — production changes only via merge.

CI TOOL: {ci_tool.upper().replace('-', ' ')}
CD TOOL: {cd_tool.upper()}
CONFIG TOOL: {config_tool.upper()} (folder: {config_dir}/)
VAULT/SECRETS: {vault.upper()} — {vault_note}{vault_setup}

FILES TO GENERATE (use EXACTLY --- FILE: path --- separator, no exceptions):

1. {ci_file} — CI/CD pipeline
   Triggers: {trigger_desc}
   Build jobs (run in parallel, one per service):
{chr(10).join(f"   - build-{s['name']}: checkout → build Docker from {s['path']} → push {s['image']}:$GIT_SHA" for s in svc_images)}
   Deploy jobs (one per environment, gated by branch):
{chr(10).join(f"   - deploy-{env}: if branch == {branch} → apply to namespace {safe_app if env == 'prod' else f'{safe_app}-{env}'}" for env, branch in env_branches.items())}
   All required secrets listed as comments at top of file.

2. Config manifests ({config_tool} — FOLDER MUST BE NAMED '{config_dir}/'):
{config_section}

3. CD resources ({cd_tool}):
{cd_section}

4. setup-guide.md — checklist including:
   - Vault policy + role creation (both auth/kubernetes and auth/kubernetes-dev mounts)
   - vault kv put using SEPARATE paths: secret/data/<app>/prod and secret/data/<app>/dev
   - Branch strategy table: dev→dev ns, staging→staging ns, main→prod ns
   - How to verify: kubectl describe pod + check events for CSI mount errors

ENVIRONMENT DETAILS:
{envs_detail}
{vault_csi_detail}
CRITICAL RULES:
- Config folder: USE '{config_dir}/' — NEVER 'manifests/' or 'kustomize/'
- kustomize structure: k8s/base/ + k8s/overlays/{{env}}/ (NOT flat manifests/ENV/)
- Generate EVERY file completely — no truncation, no '...'
- Each service has its own Deployment + Service in base (or helm/templates/)
- SecretProviderClass ONLY in overlays (vaultKubernetesMountPath differs per env)
- Branch conditions exact: {', '.join(f'{b}→{e}' for e, b in env_branches.items())}
- Image tags: git SHA (e.g. ${{{{ github.sha }}}} for GitHub Actions)
- No markdown fences inside file content
- Use --- FILE: path --- separator for every file without exception
"""
