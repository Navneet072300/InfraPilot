"""
Deploy wizard API:
  GET  /api/deploy/scan          — scan a repo (detect language, Dockerfile, CI configs)
  POST /api/deploy/dockerfile    — return Dockerfile template for detected language
  POST /api/deploy/pipeline      — stream AI-generated CI/CD pipeline
  POST /api/deploy/commit        — commit one or more files to GitHub
  GET  /api/deploy/configs       — list saved deploy configs
  POST /api/deploy/configs       — save a deploy config
  DELETE /api/deploy/configs/:id — delete a saved deploy config
"""
import asyncio
import json
import logging

from fastapi import APIRouter, Cookie, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, desc

from config.unified_store import get_platform_setting
from core.security import decode_token
from db.database import get_session, is_db_available
from db.models import User, DeployConfig
from services.ai_service import AIService
from services.github_service import GitHubService
from services.pipeline_generator import (
    get_dockerfile, get_compose_file, get_multi_compose, build_deploy_prompt,
)

logger = logging.getLogger(__name__)
router = APIRouter()
ai = AIService()


# ── Auth helper ────────────────────────────────────────────────────────────────

async def _get_user_id(ip_session: str, authorization: str) -> int | None:
    token = ip_session or authorization.removeprefix("Bearer ").strip()
    if not token:
        return None
    payload = decode_token(token)
    if not payload:
        return None
    return int(payload.get("sub", 0)) or None


async def _get_gh() -> GitHubService:
    pat = await get_platform_setting("github.pat")
    username = await get_platform_setting("github.username")
    return GitHubService(pat=pat or None, username=username or None)


# ── Scan ───────────────────────────────────────────────────────────────────────

@router.get("/deploy/scan")
async def scan_repo(full_name: str):
    """
    Scan a GitHub repo and return:
    - language, framework
    - what's present: Dockerfile, docker-compose, CI configs
    - suggested port
    """
    if not full_name or "/" not in full_name:
        raise HTTPException(400, "full_name must be 'owner/repo'")

    gh = await _get_gh()
    if not gh._pat:
        raise HTTPException(403, "No GitHub PAT configured. Go to Settings → GitHub and add a token.")

    try:
        result = await asyncio.to_thread(_deep_scan, gh, full_name)
        return result
    except Exception as e:
        logger.error("deploy scan error: %s", e)
        raise HTTPException(500, str(e))


_LANG_INDICATORS = [
    ("package.json",     "Node.js"),
    ("requirements.txt", "Python"),
    ("pyproject.toml",   "Python"),
    ("go.mod",           "Go"),
    ("pom.xml",          "Java"),
    ("build.gradle",     "Java"),
    ("build.gradle.kts", "Java"),
    ("cargo.toml",       "Rust"),
    ("composer.json",    "PHP"),
    ("gemfile",          "Ruby"),
]

_SERVICE_DIRS = {
    "backend", "frontend", "admin", "api", "web", "worker",
    "app", "server", "client", "gateway", "service", "services",
}

_DEFAULT_PORTS = {
    "Node.js": 3000, "Python": 8000, "Go": 8080,
    "Java": 8080,   "Rust": 8080,   "Ruby": 3000, "PHP": 9000,
}


def _detect_lang(paths: set[str]) -> tuple[str, str, int, str]:
    """Detect language, framework, port, build_tool from a flat path set."""
    language, framework, build_tool = "Unknown", "", ""
    port = 8080

    for indicator, lang in _LANG_INDICATORS:
        if indicator in paths:
            language = lang
            port = _DEFAULT_PORTS.get(lang, 8080)
            break

    if language == "Node.js":
        if "next" in " ".join(paths):         framework = "Next.js"
        elif "express" in " ".join(paths):    framework = "Express"
        elif "vue" in " ".join(paths):        framework = "Vue.js"
        elif "react" in " ".join(paths):      framework = "React"
        else:                                 framework = "Node.js"
    elif language == "Python":
        joined = " ".join(paths)
        if "django" in joined:   framework = "Django"
        elif "fastapi" in joined: framework = "FastAPI"
        elif "flask" in joined:  framework = "Flask"
        else:                    framework = "Python"
    elif language == "Go":       framework = "Go"
    elif language == "Java":
        if "build.gradle" in paths or "build.gradle.kts" in paths:
            build_tool, framework = "Gradle", "Spring Boot (Gradle)"
        elif "pom.xml" in paths:
            build_tool, framework = "Maven", "Spring Boot (Maven)"
    elif language == "Rust":     framework = "Rust"
    elif language == "Ruby":     framework = "Rails" if "config/routes.rb" in paths else "Ruby"
    elif language == "PHP":      framework = "Laravel" if "artisan" in paths else "PHP"

    return language, framework, port, build_tool


def _deep_scan(gh: GitHubService, full_name: str) -> dict:
    """Synchronous GitHub scan — runs in a thread via asyncio.to_thread."""
    import re

    client = gh._client()
    repo = client.get_repo(full_name)
    tree = repo.get_git_tree(repo.default_branch, recursive=True).tree
    paths_lower = {item.path.lower() for item in tree}
    paths_orig  = {item.path for item in tree}

    has_dockerfile    = any("dockerfile" in p and "/" not in p.split("dockerfile")[0].rstrip("/") for p in paths_lower) or any(p == "dockerfile" for p in paths_lower)
    has_compose       = any(p in ("docker-compose.yml", "docker-compose.yaml") for p in paths_lower)
    has_jenkinsfile   = "jenkinsfile" in paths_lower
    has_github_actions = any(p.startswith(".github/workflows/") and p.endswith((".yml", ".yaml")) for p in paths_lower)
    has_gitlab_ci     = ".gitlab-ci.yml" in paths_lower

    # ── Root-level language detection ────────────────────────────────────────
    root_paths = {p for p in paths_lower if "/" not in p}
    language, framework, port, build_tool = _detect_lang(root_paths)

    # Try to read package.json / requirements for better framework detection
    try:
        if language == "Node.js" and "package.json" in paths_orig:
            raw = repo.get_contents("package.json").decoded_content.decode(errors="replace")
            pkg = json.loads(raw)
            deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
            if "next" in deps:                   framework = "Next.js"
            elif "express" in deps:              framework = "Express"
            elif "fastify" in deps:              framework = "Fastify"
            elif "nuxt" in deps:                 framework = "Nuxt.js"
            elif "vue" in deps:                  framework = "Vue.js"
            elif "react" in deps or "react-dom" in deps: framework = "React"
        elif language == "Python":
            req = next((p for p in paths_orig if p.lower() in ("requirements.txt", "pyproject.toml")), None)
            if req:
                raw = repo.get_contents(req).decoded_content.decode(errors="replace").lower()
                if "fastapi" in raw:   framework = "FastAPI"
                elif "django" in raw:  framework = "Django"
                elif "flask" in raw:   framework = "Flask"
    except Exception as exc:
        logger.warning("Framework detection failed: %s", exc)

    # Try existing Dockerfile for EXPOSE port
    if has_dockerfile:
        try:
            df_path = next((p for p in paths_orig if p.lower() == "dockerfile"), None)
            if df_path:
                df_content = repo.get_contents(df_path).decoded_content.decode(errors="replace")
                m = re.search(r"EXPOSE\s+(\d+)", df_content, re.IGNORECASE)
                if m:
                    port = int(m.group(1))
        except Exception:
            pass

    app_name = full_name.split("/")[-1].lower().replace("_", "-")

    # ── Multi-service detection ───────────────────────────────────────────────
    # Group paths by top-level dir
    dir_paths: dict[str, set[str]] = {}
    for item in tree:
        parts = item.path.split("/")
        if len(parts) > 1:
            d = parts[0].lower()
            if d not in dir_paths:
                dir_paths[d] = set()
            dir_paths[d].add("/".join(parts[1:]).lower())  # relative paths inside dir

    service_dirs = set(dir_paths.keys()) & _SERVICE_DIRS
    services = []
    port_counter = {port}

    for svc_name in sorted(service_dirs):
        svc_rel_paths = dir_paths[svc_name]
        svc_lang, svc_fw, svc_port, _ = _detect_lang(svc_rel_paths)

        # Try to read package.json inside the service dir for better detection
        try:
            if svc_lang == "Node.js":
                pkg_path = next((p for p in paths_orig if p.lower() == f"{svc_name}/package.json"), None)
                if pkg_path:
                    raw = repo.get_contents(pkg_path).decoded_content.decode(errors="replace")
                    pkg = json.loads(raw)
                    deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
                    if "next" in deps:      svc_fw = "Next.js"
                    elif "react" in deps:   svc_fw = "React"
                    elif "vue" in deps:     svc_fw = "Vue.js"
                    elif "express" in deps: svc_fw = "Express"
            elif svc_lang == "Python":
                req_path = next((p for p in paths_orig if p.lower() in (f"{svc_name}/requirements.txt", f"{svc_name}/pyproject.toml")), None)
                if req_path:
                    raw = repo.get_contents(req_path).decoded_content.decode(errors="replace").lower()
                    if "fastapi" in raw:   svc_fw = "FastAPI"
                    elif "django" in raw:  svc_fw = "Django"
                    elif "flask" in raw:   svc_fw = "Flask"
        except Exception:
            pass

        # Avoid duplicate ports
        while svc_port in port_counter:
            svc_port += 1
        port_counter.add(svc_port)

        services.append({
            "name":      svc_name,
            "path":      svc_name + "/",
            "language":  svc_lang if svc_lang != "Unknown" else language,
            "framework": svc_fw   if svc_fw   else framework,
            "port":      svc_port,
        })

    # Fall back: single root service
    if not services:
        services = [{
            "name":      app_name,
            "path":      ".",
            "language":  language,
            "framework": framework,
            "port":      port,
        }]

    return {
        "success":           True,
        "language":          language,
        "framework":         framework,
        "build_tool":        build_tool,
        "port":              port,
        "app_name":          app_name,
        "default_branch":    repo.default_branch,
        "private":           repo.private,
        "has_dockerfile":    has_dockerfile,
        "has_compose":       has_compose,
        "has_jenkinsfile":   has_jenkinsfile,
        "has_github_actions": has_github_actions,
        "has_gitlab_ci":     has_gitlab_ci,
        "services":          services,
    }


# ── Dockerfile template ────────────────────────────────────────────────────────

class DockerfileRequest(BaseModel):
    language: str
    framework: str = ""
    port: int = 8080


@router.post("/deploy/dockerfile")
async def generate_dockerfile(body: DockerfileRequest):
    content = get_dockerfile(body.language, body.framework, body.port)
    return {"content": content}


# ── docker-compose template ────────────────────────────────────────────────────

class ComposeRequest(BaseModel):
    services: list[dict] = []   # [{name, language, framework, port, path}]
    language: str = ""          # fallback for single-service
    framework: str = ""
    port: int = 8080
    app_name: str = "app"


@router.post("/deploy/compose")
async def generate_compose(body: ComposeRequest):
    if body.services:
        content = get_multi_compose(body.services, body.app_name)
    else:
        content = get_compose_file(body.language, body.framework, body.port, body.app_name)
    return {"content": content}


# ── Full deploy pipeline generation (streaming) ───────────────────────────────

class PipelineRequest(BaseModel):
    repo_full_name: str
    services: list[dict]           # [{name, language, framework, port, path}]
    ci_tool: str                   # github-actions | gitlab-ci | jenkins
    cd_tool: str                   # argocd | fluxcd | inline
    config_tool: str               # helm | kustomize
    vault: str = "none"            # none | hashicorp | infisical | aws-sm
    vault_deployed: bool = False
    registry: str = "ghcr"        # ghcr | docker-hub | ecr
    environments: list[str] = ["prod"]  # ['dev', 'staging', 'prod']
    app_name: str = "app"
    security_scans: list[str] = []  # ['trivy', 'gitleaks']


@router.post("/deploy/pipeline")
async def generate_pipeline(body: PipelineRequest):
    prompt = build_deploy_prompt(
        repo_full_name=body.repo_full_name,
        services=body.services,
        ci_tool=body.ci_tool,
        cd_tool=body.cd_tool,
        config_tool=body.config_tool,
        vault=body.vault,
        vault_deployed=body.vault_deployed,
        registry=body.registry,
        environments=body.environments,
        app_name=body.app_name,
        security_scans=body.security_scans,
    )

    async def stream():
        try:
            async for chunk in ai.stream_devops(prompt, tools=[body.ci_tool, body.cd_tool, body.config_tool], context=""):
                yield f"data: {json.dumps({'chunk': chunk, 'done': False})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            logger.error("Pipeline generation error: %s", e)
            yield f"data: {json.dumps({'error': str(e), 'done': True})}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Commit files to GitHub ─────────────────────────────────────────────────────

class CommitFile(BaseModel):
    path: str
    content: str


class CommitRequest(BaseModel):
    repo_full_name: str
    branch: str = "main"
    files: list[CommitFile]
    message: str = "ci: add InfraPilot-generated pipeline"


@router.post("/deploy/commit")
async def commit_files(body: CommitRequest):
    gh = await _get_gh()
    if not gh._pat:
        raise HTTPException(403, "No GitHub PAT configured. Go to Settings → GitHub and add a token.")

    repo_url = f"https://github.com/{body.repo_full_name}"
    files = [{"path": f.path, "content": f.content} for f in body.files]

    result = await asyncio.to_thread(
        gh.push_files, repo_url, files, body.message, body.branch
    )
    if not result.get("success"):
        raise HTTPException(500, result.get("error", "Commit failed"))
    return result


# ── Saved deploy configs ───────────────────────────────────────────────────────

class DeployConfigInput(BaseModel):
    repo_full_name: str
    branch: str = "main"
    language: str = ""
    framework: str = ""
    ci_tool: str = ""
    registry: str = ""
    secrets_manager: str = ""
    deploy_target: str = ""
    port: int = 8080


@router.get("/deploy/configs")
async def list_configs(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user_id = await _get_user_id(ip_session, authorization)
    if not user_id or not is_db_available():
        return {"configs": []}

    async with get_session() as session:
        result = await session.execute(
            select(DeployConfig)
            .where(DeployConfig.user_id == user_id)
            .order_by(desc(DeployConfig.updated_at))
        )
        rows = result.scalars().all()

    return {
        "configs": [
            {
                "id": r.id,
                "repo_full_name": r.repo_full_name,
                "branch": r.branch,
                "language": r.language,
                "framework": r.framework,
                "ci_tool": r.ci_tool,
                "registry": r.registry,
                "secrets_manager": r.secrets_manager,
                "deploy_target": r.deploy_target,
                "port": r.port,
                "updated_at": r.updated_at.isoformat(),
            }
            for r in rows
        ]
    }


@router.post("/deploy/configs", status_code=201)
async def save_config(
    body: DeployConfigInput,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user_id = await _get_user_id(ip_session, authorization)
    if not user_id or not is_db_available():
        raise HTTPException(401, "Not authenticated")

    async with get_session() as session:
        # Upsert: one config per repo per user
        result = await session.execute(
            select(DeployConfig).where(
                DeployConfig.user_id == user_id,
                DeployConfig.repo_full_name == body.repo_full_name,
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.branch = body.branch
            existing.language = body.language
            existing.framework = body.framework
            existing.ci_tool = body.ci_tool
            existing.registry = body.registry
            existing.secrets_manager = body.secrets_manager
            existing.deploy_target = body.deploy_target
            existing.port = body.port
            await session.commit()
            return {"id": existing.id}
        else:
            cfg = DeployConfig(
                user_id=user_id,
                repo_full_name=body.repo_full_name,
                branch=body.branch,
                language=body.language,
                framework=body.framework,
                ci_tool=body.ci_tool,
                registry=body.registry,
                secrets_manager=body.secrets_manager,
                deploy_target=body.deploy_target,
                port=body.port,
            )
            session.add(cfg)
            await session.commit()
            await session.refresh(cfg)
            return {"id": cfg.id}


@router.delete("/deploy/configs/{config_id}", status_code=204)
async def delete_config(
    config_id: int,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user_id = await _get_user_id(ip_session, authorization)
    if not user_id or not is_db_available():
        raise HTTPException(401, "Not authenticated")

    async with get_session() as session:
        result = await session.execute(
            select(DeployConfig).where(
                DeployConfig.id == config_id,
                DeployConfig.user_id == user_id,
            )
        )
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, "Config not found")
        await session.delete(row)
        await session.commit()
