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
from services.pipeline_generator import get_dockerfile, build_pipeline_prompt

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


def _deep_scan(gh: GitHubService, full_name: str) -> dict:
    """Synchronous GitHub scan — runs in a thread via asyncio.to_thread."""
    client = gh._client()
    repo = client.get_repo(full_name)
    tree = repo.get_git_tree(repo.default_branch, recursive=True).tree
    paths = {item.path.lower() for item in tree}
    paths_original = {item.path for item in tree}

    # ── File presence ────────────────────────────────────────────────────────
    has_dockerfile = any("dockerfile" in p for p in paths)
    has_compose = any(p in ("docker-compose.yml", "docker-compose.yaml") for p in paths)
    has_jenkinsfile = "jenkinsfile" in paths
    has_github_actions = any(p.startswith(".github/workflows/") and p.endswith((".yml", ".yaml")) for p in paths)
    has_gitlab_ci = ".gitlab-ci.yml" in paths

    # ── Language detection ───────────────────────────────────────────────────
    language = "Unknown"
    framework = ""
    port = 8080
    build_tool = ""

    lang_indicators = [
        ("package.json",      "Node.js"),
        ("requirements.txt",  "Python"),
        ("pyproject.toml",    "Python"),
        ("go.mod",            "Go"),
        ("pom.xml",           "Java"),
        ("build.gradle",      "Java"),
        ("build.gradle.kts",  "Java"),
        ("cargo.toml",        "Rust"),
        ("composer.json",     "PHP"),
        ("gemfile",           "Ruby"),
        ("*.csproj",          ".NET"),
    ]
    for indicator, lang in lang_indicators:
        if indicator.startswith("*"):
            ext = indicator[1:]
            if any(p.endswith(ext) for p in paths):
                language = lang
                break
        elif indicator in paths:
            language = lang
            break

    # ── Framework + port detection ───────────────────────────────────────────
    try:
        if language == "Node.js" and "package.json" in paths_original:
            raw = repo.get_contents("package.json").decoded_content.decode(errors="replace")
            pkg = json.loads(raw)
            deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
            if "next" in deps:
                framework = "Next.js"
                port = 3000
            elif "express" in deps:
                framework = "Express"
                port = 3000
            elif "fastify" in deps:
                framework = "Fastify"
                port = 3000
            elif "nuxt" in deps:
                framework = "Nuxt.js"
                port = 3000
            elif "vue" in deps:
                framework = "Vue.js"
                port = 3000
            elif "react" in deps or "react-dom" in deps:
                framework = "React"
                port = 3000
            else:
                framework = "Node.js"
                port = 3000

        elif language == "Python":
            port = 8000
            req_file = next((p for p in paths_original if p.lower() in ("requirements.txt", "pyproject.toml")), None)
            if req_file:
                raw = repo.get_contents(req_file).decoded_content.decode(errors="replace").lower()
                if "django" in raw:
                    framework = "Django"
                elif "fastapi" in raw:
                    framework = "FastAPI"
                elif "flask" in raw:
                    framework = "Flask"
                else:
                    framework = "Python"

        elif language == "Go":
            port = 8080
            framework = "Go"

        elif language == "Java":
            port = 8080
            if "build.gradle" in paths or "build.gradle.kts" in paths:
                build_tool = "Gradle"
                framework = "Spring Boot (Gradle)"
            elif "pom.xml" in paths:
                build_tool = "Maven"
                framework = "Spring Boot (Maven)"

        elif language == "Rust":
            port = 8080
            framework = "Rust"

        elif language == "Ruby":
            port = 3000
            framework = "Rails" if "config/routes.rb" in paths else "Ruby"

        elif language == "PHP":
            port = 9000
            framework = "Laravel" if "artisan" in paths else "PHP"

    except Exception as exc:
        logger.warning("Framework detection failed: %s", exc)

    # Try existing Dockerfile for port
    if has_dockerfile:
        try:
            import re
            df_path = next(p for p in paths_original if p.lower() == "dockerfile")
            df_content = repo.get_contents(df_path).decoded_content.decode(errors="replace")
            m = re.search(r"EXPOSE\s+(\d+)", df_content, re.IGNORECASE)
            if m:
                port = int(m.group(1))
        except Exception:
            pass

    app_name = full_name.split("/")[-1].lower().replace("_", "-")

    return {
        "success": True,
        "language": language,
        "framework": framework,
        "build_tool": build_tool,
        "port": port,
        "app_name": app_name,
        "default_branch": repo.default_branch,
        "private": repo.private,
        "has_dockerfile": has_dockerfile,
        "has_compose": has_compose,
        "has_jenkinsfile": has_jenkinsfile,
        "has_github_actions": has_github_actions,
        "has_gitlab_ci": has_gitlab_ci,
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


# ── Pipeline generation (streaming) ───────────────────────────────────────────

class PipelineRequest(BaseModel):
    repo_full_name: str
    branch: str = "main"
    language: str
    framework: str = ""
    ci_tool: str       # github-actions | jenkins | gitlab-ci
    registry: str      # ghcr | ecr | docker-hub | none
    secrets_manager: str  # native | vault | infisical | aws-sm | none
    deploy_target: str    # kubernetes | docker-ssh | ecs | build-only
    has_dockerfile: bool = True
    port: int = 8080
    app_name: str = "app"


@router.post("/deploy/pipeline")
async def generate_pipeline(body: PipelineRequest):
    prompt, _ = build_pipeline_prompt(
        repo_full_name=body.repo_full_name,
        branch=body.branch,
        language=body.language,
        framework=body.framework,
        ci_tool=body.ci_tool,
        registry=body.registry,
        secrets_manager=body.secrets_manager,
        deploy_target=body.deploy_target,
        has_dockerfile=body.has_dockerfile,
        port=body.port,
        app_name=body.app_name,
    )

    async def stream():
        try:
            async for chunk in ai.stream_devops(prompt, tools=[body.ci_tool], context=""):
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
