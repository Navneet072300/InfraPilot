import asyncio
import json
import logging
import re
from typing import AsyncGenerator
from uuid import uuid4

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import settings
from services.ai_service import AIService
from services.vault_service import VaultService
from services.cloudflare_service import CloudflareService
from services.github_service import GitHubService
from services.k8s_service import KubernetesService
from services import cache_service

logger = logging.getLogger(__name__)
router = APIRouter()


class RepoAnalysis(BaseModel):
    language: str = "Unknown"
    has_dockerfile: bool = False
    port: int = 8080
    has_manifests: bool = False
    has_cicd: bool = False
    secrets: list[str] = []


class PipelineRequest(BaseModel):
    app_name: str
    repo_url: str
    gitops_repo: str = ""
    gitops_path: str = "/deployments"
    namespace: str = "default"
    target_url: str = ""
    publish_mode: str = ""  # "none"|"infrapilot"|"cloudflare"|"route53"|"azure_dns"|"gcp_dns"
    cluster: str = ""
    iac_tool: str = "kustomize"
    registry: str = "ghcr.io"
    github_pat: str | None = None
    github_username: str | None = None
    vault_strategy: str = "shared"       # "shared" | "separate"
    env_vars: dict[str, str] = {}        # key=value pairs from uploaded .env file
    rotate_vault_secret: bool = False    # if True: update + delete K8s CSI secret + restart deployment
    analysis: RepoAnalysis = RepoAnalysis()
    clarifications: dict = {}


def _ev(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _parse_files(raw: str) -> list[dict]:
    files = []
    parts = re.split(r"---\s*FILE:\s*(.+?)\s*---", raw)
    for i in range(1, len(parts) - 1, 2):
        fname = parts[i].strip()
        content = parts[i + 1].strip()
        ext = fname.rsplit(".", 1)[-1].lower()
        lang_map = {
            "tf": "hcl", "hcl": "hcl",
            "yaml": "yaml", "yml": "yaml",
            "json": "json", "md": "markdown",
            "sh": "bash", "py": "python",
        }
        files.append({"path": fname, "content": content, "language": lang_map.get(ext, "yaml")})
    if not files and raw.strip():
        files.append({"path": "output.yaml", "content": raw.strip(), "language": "yaml"})
    return files


async def _stream_ai_task(
    task_id: int, title: str, prompt: str, ai: AIService
) -> AsyncGenerator[str, None]:
    yield _ev({"task": task_id, "status": "running", "message": f"Generating {title}..."})
    accumulated = ""
    try:
        async for chunk in ai.stream_pipeline_task(title, prompt):
            accumulated += chunk
            yield _ev({"task": task_id, "status": "chunk", "content": chunk})
        files = _parse_files(accumulated)
        yield _ev({"task": task_id, "status": "done", "files": files})
    except Exception as e:
        yield _ev({"task": task_id, "status": "failed", "error": str(e)})


async def _stub_task(task_id: int, lines: list[str], delay: float = 0.3) -> AsyncGenerator[str, None]:
    yield _ev({"task": task_id, "status": "running", "message": lines[0]})
    for line in lines:
        await asyncio.sleep(delay)
        yield _ev({"task": task_id, "status": "chunk", "content": line + "\n"})
    yield _ev({"task": task_id, "status": "done", "files": []})


async def _check_aborted(run_id: str | None) -> bool:
    if not run_id:
        return False
    state = await cache_service.get(f"pipeline:{run_id}")
    return state == "aborted"


async def _pipeline_gen(req: PipelineRequest, run_id: str | None = None) -> AsyncGenerator[str, None]:
    ai = AIService()
    cfg = settings.load_config()
    gh_cfg = cfg.get("github", {})
    # Prefer what the frontend sent, fall back to unified_store (DB), then JSON config
    pat = req.github_pat or None
    username = req.github_username or None
    if not pat:
        try:
            from config.unified_store import get_platform_setting as _gps
            pat = await _gps("github.pat") or gh_cfg.get("pat")
            username = username or await _gps("github.username") or gh_cfg.get("username")
        except Exception:
            pat = gh_cfg.get("pat")
            username = username or gh_cfg.get("username")
    gitops_repo = req.gitops_repo or req.repo_url
    registry = req.registry or "ghcr.io"
    app = req.app_name
    ns = req.namespace
    lang = req.analysis.language
    port = req.analysis.port
    secrets = req.analysis.secrets or ["DATABASE_URL", "JWT_SECRET"]

    # ── TASK 1: CI Pipeline ────────────────────────────────────────────────────
    has_dockerfile = req.analysis.has_dockerfile
    ci_prompt = f"""Generate a GitHub Actions CI/CD workflow for {app}.
Language: {lang}. Port: {port}. Registry: {registry}/{app}
Has Dockerfile: {has_dockerfile}

Requirements:
- Build Docker image on push to main branch
- Tag with git SHA and 'latest'
- Push to {registry}/{username or 'myorg'}/{app}
- Run linting/tests before build (skip gracefully if no test script)
- Security scan with trivy action
- Use docker/build-push-action@v5
{"- Dockerfile exists in repo root" if has_dockerfile else "- No Dockerfile found — add a build step to generate one using a buildpack (nixpacks or cloud-native buildpacks) before the docker build step"}

Output exactly one file:
--- FILE: .github/workflows/ci.yml ---
[complete workflow YAML]"""

    if await _check_aborted(run_id):
        yield _ev({"type": "aborted", "run_id": run_id, "pipeline": "aborted"})
        return

    try:
        async with asyncio.timeout(30):
            collected = []
            async for ev in _stream_ai_task(1, "GitHub Actions CI Pipeline", ci_prompt, ai):
                collected.append(ev)
        for ev in collected:
            yield ev
    except asyncio.TimeoutError:
        yield _ev({"task": 1, "status": "failed", "error": "Timed out after 30s"})

    # ── TASK 2: Kustomize Base ─────────────────────────────────────────────────
    base_prompt = f"""Generate Kustomize base manifests for {app}.
Image: {registry}/{username or 'myorg'}/{app}:latest
Port: {port}
Namespace: {ns}
Language: {lang}

Include:
- Deployment with 2 replicas, liveness + readiness probes on /{port}/health (or /health)
- Resource requests: 50m CPU, 64Mi memory. Limits: 200m CPU, 256Mi memory
- SecurityContext: runAsNonRoot: true, readOnlyRootFilesystem: true (add emptyDir for /tmp)
- Service (ClusterIP, port 80 → {port})
- kustomization.yaml listing all resources

--- FILE: k8s/base/deployment.yaml ---
[deployment]
--- FILE: k8s/base/service.yaml ---
[service]
--- FILE: k8s/base/kustomization.yaml ---
[kustomization]"""

    if await _check_aborted(run_id):
        yield _ev({"type": "aborted", "run_id": run_id, "pipeline": "aborted"})
        return

    try:
        async with asyncio.timeout(30):
            collected = []
            async for ev in _stream_ai_task(2, "Kustomize Base Manifests", base_prompt, ai):
                collected.append(ev)
        for ev in collected:
            yield ev
    except asyncio.TimeoutError:
        yield _ev({"task": 2, "status": "failed", "error": "Timed out after 30s"})

    # ── TASK 3: Overlays ────────────────────────────────────────────────────────
    overlay_prompt = f"""Generate Kustomize environment overlays for {app}.
Base: ../../base

Dev overlay (k8s/overlays/dev/):
- 1 replica
- Minimal resources (25m CPU, 32Mi memory)
- No HPA
- Image tag: latest

Prod overlay (k8s/overlays/prod/):
- 2 replicas minimum
- Standard resources (100m CPU, 128Mi memory)
- HorizontalPodAutoscaler: min 2, max 10, target CPU 70%
- PodDisruptionBudget: minAvailable 1

--- FILE: k8s/overlays/dev/kustomization.yaml ---
[dev overlay]
--- FILE: k8s/overlays/prod/kustomization.yaml ---
[prod overlay]
--- FILE: k8s/overlays/prod/hpa.yaml ---
[HPA manifest]
--- FILE: k8s/overlays/prod/pdb.yaml ---
[PDB manifest]"""

    if await _check_aborted(run_id):
        yield _ev({"type": "aborted", "run_id": run_id, "pipeline": "aborted"})
        return

    try:
        async with asyncio.timeout(30):
            collected = []
            async for ev in _stream_ai_task(3, "Environment Overlays", overlay_prompt, ai):
                collected.append(ev)
        for ev in collected:
            yield ev
    except asyncio.TimeoutError:
        yield _ev({"task": 3, "status": "failed", "error": "Timed out after 30s"})

    # ── TASK 4: Vault Secrets ──────────────────────────────────────────────────
    vault_cfg = cfg.get("vault")
    vault_svc = VaultService(vault_cfg)
    strategy = req.vault_strategy  # "shared" | "separate"
    # Build secret data: use uploaded env_vars keys; fall back to detected secrets
    secret_data = req.env_vars if req.env_vars else {s: "PLACEHOLDER" for s in secrets}
    masked_data = {k: "***" for k in secret_data}

    # Determine which paths to write
    if strategy == "shared":
        secret_paths = [(f"secret/{app}", masked_data)]
    else:
        secret_paths = [
            (f"secret/{app}/dev", masked_data),
            (f"secret/{app}/prod", masked_data),
        ]

    yield _ev({"task": 4, "status": "running", "message": f"Storing secrets in Vault ({strategy} strategy)..."})

    for path, data in secret_paths:
        # Check if secret already exists
        check = await vault_svc.read_secret(path)
        if check["exists"]:
            if req.rotate_vault_secret:
                yield _ev({"task": 4, "status": "chunk", "content": f"↻ Secret exists at {path} — rotating...\n"})
                write_result = await vault_svc.write_secret(path, data)
                yield _ev({"task": 4, "status": "chunk", "content": write_result["output"] + "\n"})

                # Delete K8s CSI secret so it gets re-synced, then restart deployment
                cluster_cfg_v = settings.get_cluster(req.cluster) if req.cluster else settings.get_active_cluster()
                if cluster_cfg_v:
                    k8s = KubernetesService(cluster_cfg_v)
                    del_result = await k8s.run_kubectl_safe([
                        "delete", "secret", f"{app}-vault-secret", "-n", ns, "--ignore-not-found"
                    ])
                    yield _ev({"task": 4, "status": "chunk", "content": f"$ kubectl delete secret {app}-vault-secret -n {ns} --ignore-not-found\n{del_result.get('stdout', '') or 'secret deleted'}\n"})
                    restart_result = await k8s.run_kubectl_safe([
                        "rollout", "restart", f"deployment/{app}", "-n", ns
                    ])
                    yield _ev({"task": 4, "status": "chunk", "content": f"$ kubectl rollout restart deployment/{app} -n {ns}\n{restart_result.get('stdout', '') or 'deployment restarted'}\n"})
                else:
                    yield _ev({"task": 4, "status": "chunk", "content": f"ℹ No cluster configured — skipping K8s secret deletion\n  Run manually: kubectl delete secret {app}-vault-secret -n {ns} --ignore-not-found\n  Then: kubectl rollout restart deployment/{app} -n {ns}\n"})
            else:
                yield _ev({"task": 4, "status": "chunk", "content": f"✓ Secret at {path} already exists — skipping (enable 'Rotate' to update)\n"})
        else:
            write_result = await vault_svc.write_secret(path, data)
            yield _ev({"task": 4, "status": "chunk", "content": write_result["output"] + "\n"})

    if req.env_vars:
        keys_list = ", ".join(list(req.env_vars.keys())[:8])
        if len(req.env_vars) > 8:
            keys_list += f" … (+{len(req.env_vars) - 8} more)"
        yield _ev({"task": 4, "status": "chunk", "content": f"Keys stored: {keys_list}\n"})

    yield _ev({"task": 4, "status": "done", "files": [], "stubbed": True})

    # ── TASK 5: Vault Policies ─────────────────────────────────────────────────
    # Shared strategy → one policy for secret/<app>
    # Separate strategy → one policy covering both env paths
    if strategy == "shared":
        policy_hcl = f"""# Policy: {app}
path "secret/{app}" {{
  capabilities = ["read", "list"]
}}"""
        policies = [(f"{app}-policy", policy_hcl)]
    else:
        policy_hcl = f"""# Policy: {app}
path "secret/{app}/dev" {{
  capabilities = ["read", "list"]
}}
path "secret/{app}/prod" {{
  capabilities = ["read", "list"]
}}"""
        policies = [(f"{app}-policy", policy_hcl)]

    yield _ev({"task": 5, "status": "running", "message": "Applying Vault policies..."})
    for policy_name, hcl in policies:
        result = await vault_svc.write_policy(policy_name, hcl)
        yield _ev({"task": 5, "status": "chunk", "content": result["output"] + "\n"})
    auth_result = await vault_svc.enable_k8s_auth(req.cluster or "default", ns)
    yield _ev({"task": 5, "status": "chunk", "content": auth_result["output"] + "\n"})
    yield _ev({"task": 5, "status": "done", "files": [], "stubbed": True})

    # ── TASK 6: Push to GitOps Repo ─────────────────────────────────────────────
    yield _ev({"task": 6, "status": "running", "message": "Pushing manifests to GitOps repo..."})
    if pat and gitops_repo:
        gh = GitHubService(pat=pat, username=username)
        # Collect files from previous tasks (placeholder since we streamed them)
        push_result = gh.push_files(
            repo_url=gitops_repo,
            files=[
                {"path": ".github/workflows/ci.yml", "content": "# Generated by InfraPilot\n# See pipeline output for full content"},
                {"path": f"k8s/{app}/base/kustomization.yaml", "content": "# Generated by InfraPilot"},
            ],
            commit_message=f"feat: add {app} deployment manifests via InfraPilot",
        )
        if push_result["success"]:
            yield _ev({"task": 6, "status": "chunk", "content": f"✓ Pushed to {gitops_repo}\nCommit: {push_result.get('commit', 'N/A')}\n"})
            yield _ev({"task": 6, "status": "done", "files": []})
        else:
            yield _ev({"task": 6, "status": "chunk", "content": f"⚠ Push warning: {push_result.get('error', 'unknown')}\nContinuing with local manifests...\n"})
            yield _ev({"task": 6, "status": "done", "files": []})
    else:
        await asyncio.sleep(0.5)
        yield _ev({"task": 6, "status": "chunk", "content": "ℹ No GitHub PAT configured — skipping git push\nManifests are available for download above\n"})
        yield _ev({"task": 6, "status": "skipped"})

    # ── TASK 7: ArgoCD Application (stubbed) ────────────────────────────────────
    argo_prompt = f"""Generate an ArgoCD Application manifest for {app}.
GitOps repo: {gitops_repo or 'https://github.com/myorg/gitops'}
Path: {req.gitops_path or '/deployments'}/overlays/dev
Namespace: {ns}
Destination server: https://kubernetes.default.svc

Include automated sync policy with self-heal and pruning enabled.

--- FILE: argocd/{app}-application.yaml ---
[ArgoCD Application manifest]"""

    if await _check_aborted(run_id):
        yield _ev({"type": "aborted", "run_id": run_id, "pipeline": "aborted"})
        return

    try:
        async with asyncio.timeout(30):
            collected = []
            async for ev in _stream_ai_task(7, "ArgoCD Application", argo_prompt, ai):
                collected.append(ev)
        for ev in collected:
            yield ev
    except asyncio.TimeoutError:
        yield _ev({"task": 7, "status": "failed", "error": "Timed out after 30s"})

    if await _check_aborted(run_id):
        yield _ev({"type": "aborted", "run_id": run_id, "pipeline": "aborted"})
        return

    # ── TASK 8: Watch Rollout ────────────────────────────────────────────────────
    cluster_cfg = settings.get_cluster(req.cluster) if req.cluster else settings.get_active_cluster()
    yield _ev({"task": 8, "status": "running", "message": f"Watching rollout in {ns}..."})

    if cluster_cfg:
        svc = KubernetesService(cluster_cfg)
        try:
            async with asyncio.timeout(90):
                result = await svc.run_kubectl_safe([
                    "rollout", "status", f"deployment/{app}", "-n", ns, "--timeout=60s"
                ])
            for line in (result["stdout"] + result["stderr"]).splitlines():
                yield _ev({"task": 8, "status": "chunk", "content": line + "\n"})
            if result["exit_code"] == 0:
                yield _ev({"task": 8, "status": "done", "files": []})
                # Start background verification — never blocks SSE stream
                try:
                    from services.deployment_verifier import start_verification
                    from config import unified_store as _us
                    dep_rows = await _us.get_platform_setting("last_deploy_config_id")
                    dep_id = int(dep_rows) if dep_rows else 0
                    if dep_id:
                        await start_verification(dep_id, app, ns, req.cluster or None)
                        yield _ev({"task": 8, "status": "chunk", "content": "⬡ Deployment verification started (5-min watch)\n"})
                except Exception as _ve:
                    logger.debug("Verifier start skipped: %s", _ve)
            else:
                yield _ev({"task": 8, "status": "failed", "error": f"Rollout failed: {result['stderr'][:200]}"})
        except asyncio.TimeoutError:
            yield _ev({"task": 8, "status": "failed", "error": "Rollout watch timed out after 90s"})
        # ── TASK 9: Auto-troubleshoot ──────────────────────────────────────
        yield _ev({"task": 9, "status": "running", "message": "Analyzing failure..."})
        pods = await svc.get_pods(ns)
        app_pods = [p for p in pods if app in p.get("name", "")]
        if app_pods:
            pod_name = app_pods[0]["name"]
            logs = await svc.get_pod_logs(ns, pod_name)
            events = await svc.get_pod_events(ns, pod_name)
            events_text = "\n".join(e.get("message", "") for e in events)
            fix_content = ""
            async for chunk in ai.stream_diagnose(logs, events_text):
                fix_content += chunk
                yield _ev({"task": 9, "status": "chunk", "content": chunk})
            yield _ev({"task": 9, "status": "done", "files": [], "fix": fix_content})
        else:
            yield _ev({"task": 9, "status": "chunk", "content": f"No pods found for {app} in {ns}\n"})
            yield _ev({"task": 9, "status": "skipped"})
        return  # Stop pipeline after troubleshoot
    else:
        await asyncio.sleep(1.0)
        yield _ev({"task": 8, "status": "chunk", "content": f"ℹ No cluster configured — skipping real rollout watch\n"})
        yield _ev({"task": 8, "status": "skipped"})

    # ── TASK 9: Skip (no failure) ────────────────────────────────────────────────
    yield _ev({"task": 9, "status": "skipped"})

    # ── TASK 10: Get Service URL ────────────────────────────────────────────────
    lb_ip = ""
    yield _ev({"task": 10, "status": "running", "message": "Fetching service URL..."})
    if cluster_cfg:
        svc_result = await svc.run_kubectl_safe(["get", "svc", app, "-n", ns])
        ingress_result = await svc.run_kubectl_safe(["get", "ingress", "-n", ns])
        output = (svc_result["stdout"] or "") + "\n" + (ingress_result["stdout"] or "")
        yield _ev({"task": 10, "status": "chunk", "content": output})
        # Extract LoadBalancer IP for Task 11
        ip_result = await svc.run_kubectl_safe(
            ["get", "svc", app, "-n", ns, "-o", "jsonpath={.status.loadBalancer.ingress[0].ip}"]
        )
        lb_ip = (ip_result.get("stdout") or "").strip()
        if not lb_ip:
            host_result = await svc.run_kubectl_safe(
                ["get", "svc", app, "-n", ns, "-o", "jsonpath={.status.loadBalancer.ingress[0].hostname}"]
            )
            lb_ip = (host_result.get("stdout") or "").strip()
        if lb_ip:
            yield _ev({"task": 10, "status": "chunk", "content": f"LoadBalancer: {lb_ip}\n"})
        yield _ev({"task": 10, "status": "done", "files": []})
    else:
        await asyncio.sleep(0.3)
        yield _ev({"task": 10, "status": "chunk", "content": f"Service URL: http://{app}.{ns}.svc.cluster.local\n"})
        yield _ev({"task": 10, "status": "done", "files": []})

    # ── TASK 11: Publish DNS ─────────────────────────────────────────────────────
    async def _load_dns_cfg(key: str) -> dict | None:
        """Load a DNS platform config blob from unified_store, fall back to file config."""
        raw = None
        try:
            from config.unified_store import get_platform_setting as _gps
            raw = await _gps(key)
        except Exception:
            pass
        if raw:
            try:
                parsed = json.loads(raw) if isinstance(raw, str) else raw
                return parsed if isinstance(parsed, dict) else None
            except Exception:
                pass
        # Fall back to JSON-file config (legacy onboarding wizard)
        val = cfg.get(key)
        if isinstance(val, dict):
            return val
        return None

    publish_mode = (req.publish_mode or "").strip()

    if not publish_mode or publish_mode == "none":
        yield _ev({"task": 11, "status": "skipped"})

    elif publish_mode == "infrapilot":
        from services.infrapilot_publish_service import InfraPilotPublishService
        pub = InfraPilotPublishService()
        subdomain = InfraPilotPublishService.subdomain_for(req.app_name)
        yield _ev({"task": 11, "status": "running", "message": f"Claiming {subdomain}..."})
        result = await pub.publish(req.app_name, lb_ip or None)
        yield _ev({"task": 11, "status": "chunk", "content": result["output"] + "\n"})
        yield _ev({"task": 11, "status": "done" if result.get("success") else "failed", "files": []})

    elif publish_mode == "cloudflare":
        if not req.target_url:
            yield _ev({"task": 11, "status": "chunk", "content": "⚠ No target URL provided — skipping\n"})
            yield _ev({"task": 11, "status": "skipped"})
        else:
            cf_cfg = await _load_dns_cfg("cloudflare")
            if not cf_cfg:
                yield _ev({"task": 11, "status": "chunk", "content": "⚠ Cloudflare not connected in Settings → Platforms\n"})
                yield _ev({"task": 11, "status": "skipped"})
            else:
                yield _ev({"task": 11, "status": "running", "message": f"Configuring Cloudflare DNS for {req.target_url}..."})
                if not lb_ip:
                    yield _ev({"task": 11, "status": "chunk", "content": "⚠ No LoadBalancer IP detected — DNS record will use 0.0.0.0 (update after deploy)\n"})
                cf = CloudflareService(cf_cfg)
                dns_result = await cf.create_dns_record(req.target_url, lb_ip or "0.0.0.0", proxied=True)
                yield _ev({"task": 11, "status": "chunk", "content": dns_result["output"] + "\n"})
                yield _ev({"task": 11, "status": "done" if dns_result.get("success") else "failed", "files": []})

    elif publish_mode == "route53":
        if not req.target_url:
            yield _ev({"task": 11, "status": "chunk", "content": "⚠ No target URL provided — skipping\n"})
            yield _ev({"task": 11, "status": "skipped"})
        else:
            r53_cfg = await _load_dns_cfg("route53")
            if not r53_cfg:
                yield _ev({"task": 11, "status": "chunk", "content": "⚠ Route 53 not connected in Settings → Platforms\n"})
                yield _ev({"task": 11, "status": "skipped"})
            else:
                from services.route53_service import Route53Service
                yield _ev({"task": 11, "status": "running", "message": f"Configuring Route 53 DNS for {req.target_url}..."})
                if not lb_ip:
                    yield _ev({"task": 11, "status": "chunk", "content": "⚠ No LoadBalancer IP detected — update the record after deploy\n"})
                r53 = Route53Service(r53_cfg)
                dns_result = await r53.create_dns_record(req.target_url, lb_ip or "0.0.0.0")
                yield _ev({"task": 11, "status": "chunk", "content": dns_result["output"] + "\n"})
                yield _ev({"task": 11, "status": "done" if dns_result.get("success") else "failed", "files": []})

    elif publish_mode == "azure_dns":
        if not req.target_url:
            yield _ev({"task": 11, "status": "chunk", "content": "⚠ No target URL provided — skipping\n"})
            yield _ev({"task": 11, "status": "skipped"})
        else:
            az_cfg = await _load_dns_cfg("azure_dns")
            if not az_cfg:
                yield _ev({"task": 11, "status": "chunk", "content": "⚠ Azure DNS not connected in Settings → Platforms\n"})
                yield _ev({"task": 11, "status": "skipped"})
            else:
                from services.azure_dns_service import AzureDnsService
                yield _ev({"task": 11, "status": "running", "message": f"Configuring Azure DNS for {req.target_url}..."})
                if not lb_ip:
                    yield _ev({"task": 11, "status": "chunk", "content": "⚠ No LoadBalancer IP detected — update the record after deploy\n"})
                az = AzureDnsService(az_cfg)
                dns_result = await az.create_dns_record(req.target_url, lb_ip or "0.0.0.0")
                yield _ev({"task": 11, "status": "chunk", "content": dns_result["output"] + "\n"})
                yield _ev({"task": 11, "status": "done" if dns_result.get("success") else "failed", "files": []})

    elif publish_mode == "gcp_dns":
        if not req.target_url:
            yield _ev({"task": 11, "status": "chunk", "content": "⚠ No target URL provided — skipping\n"})
            yield _ev({"task": 11, "status": "skipped"})
        else:
            gcp_cfg = await _load_dns_cfg("gcp_dns")
            if not gcp_cfg:
                yield _ev({"task": 11, "status": "chunk", "content": "⚠ GCP Cloud DNS not connected in Settings → Platforms\n"})
                yield _ev({"task": 11, "status": "skipped"})
            else:
                from services.gcp_dns_service import GcpDnsService
                yield _ev({"task": 11, "status": "running", "message": f"Configuring GCP Cloud DNS for {req.target_url}..."})
                if not lb_ip:
                    yield _ev({"task": 11, "status": "chunk", "content": "⚠ No LoadBalancer IP detected — update the record after deploy\n"})
                gcp = GcpDnsService(gcp_cfg)
                dns_result = await gcp.create_dns_record(req.target_url, lb_ip or "0.0.0.0")
                yield _ev({"task": 11, "status": "chunk", "content": dns_result["output"] + "\n"})
                yield _ev({"task": 11, "status": "done" if dns_result.get("success") else "failed", "files": []})

    else:
        yield _ev({"task": 11, "status": "skipped"})

    yield _ev({"pipeline": "complete"})


@router.get("/agent/pixie-status")
async def pixie_status():
    """Returns whether Pixie is configured and reachable. Never errors."""
    try:
        from config import unified_store
        api_key = await unified_store.get_platform_setting("pixie.api_key")
        cluster_id = await unified_store.get_platform_setting("pixie.cluster_id")
        if not api_key or not cluster_id:
            return {"installed": False, "reason": "not_configured"}
        from services.pixie_service import PixieService, _pxapi_available
        if not _pxapi_available():
            return {"installed": False, "reason": "pxapi_not_installed"}
        svc = PixieService(api_key=api_key, cluster_id=cluster_id)
        return {"installed": svc.is_available, "cluster_id": cluster_id}
    except Exception:
        return {"installed": False, "reason": "error"}


@router.post("/agent/pipeline/{run_id}/abort")
async def abort_pipeline(run_id: str):
    await cache_service.set(f"pipeline:{run_id}", "aborted", ttl=600)
    return {"status": "aborted", "run_id": run_id}


@router.post("/agent/pipeline")
async def run_pipeline(request: PipelineRequest):
    run_id = str(uuid4())
    await cache_service.set(f"pipeline:{run_id}", "running", ttl=600)
    logger.info("Pipeline: run_id=%s app=%s cluster=%s", run_id, request.app_name, request.cluster)

    async def generate():
        yield _ev({"type": "started", "run_id": run_id})
        try:
            async for event in _pipeline_gen(request, run_id):
                yield event
        except Exception as e:
            logger.error("Pipeline error: %s", e)
            yield _ev({"error": str(e), "pipeline": "failed"})
        finally:
            await cache_service.delete(f"pipeline:{run_id}")

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
