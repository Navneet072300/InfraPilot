"""
Deployment tracking: monitors CI runs, streams logs, AI-powered fix suggestions.
Supports GitHub Actions (GitLab CI / Jenkins stubs ready to extend).
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import AsyncGenerator

import httpx
from fastapi import APIRouter, Cookie, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

from config import unified_store
from core.security import decode_token
from db.database import get_session, is_db_available
from db.models import DeployConfig
from services.ai_service import AIService

router = APIRouter()
logger = logging.getLogger(__name__)
GH_API = "https://api.github.com"


# ── Auth helper ───────────────────────────────────────────────────────────────

async def _user_id(ip_session: str, authorization: str) -> int:
    token = ip_session or authorization.removeprefix("Bearer ").strip()
    payload = decode_token(token)
    if not payload:
        raise HTTPException(401, "Not authenticated")
    return int(payload.get("sub", 0))


async def _gh_headers() -> dict:
    pat = await unified_store.get_platform_setting("github.pat")
    if not pat:
        raise HTTPException(400, "GitHub PAT not configured — add it in Settings → GitHub")
    return {"Authorization": f"Bearer {pat}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}


async def _get_dep(dep_id: int, user_id: int) -> DeployConfig:
    if not is_db_available():
        raise HTTPException(503, "Database unavailable")
    async with get_session() as session:
        result = await session.execute(
            select(DeployConfig).where(DeployConfig.id == dep_id, DeployConfig.user_id == user_id)
        )
        dep = result.scalar_one_or_none()
    if not dep:
        raise HTTPException(404, "Deployment not found")
    return dep


# ── Models ────────────────────────────────────────────────────────────────────

class SaveDeploymentRequest(BaseModel):
    repo_full_name: str
    branch: str = "main"
    ci_tool: str = ""
    cd_tool: str = ""
    config_tool: str = ""
    environments: list[str] = ["prod"]
    registry: str = "ghcr"
    vault: str = "none"
    deploy_target: str = ""   # aws-eks | gcp-gke | azure-aks | do-k8s | self-hosted | fly | railway | render | vercel
    app_name: str = ""


class AnalyzeRequest(BaseModel):
    logs: str           # raw failure log text (frontend sends it)
    job_name: str = ""


class ApplyFixRequest(BaseModel):
    files: list[dict]   # [{path, content}]
    message: str = "fix: apply InfraPilot AI suggestion"
    branch: str = ""


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.post("/deployments")
async def save_deployment(
    req: SaveDeploymentRequest,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    uid = await _user_id(ip_session, authorization)
    if not is_db_available():
        raise HTTPException(503, "Database unavailable")

    async with get_session() as session:
        existing = await session.execute(
            select(DeployConfig).where(
                DeployConfig.user_id == uid,
                DeployConfig.repo_full_name == req.repo_full_name,
            )
        )
        dep = existing.scalar_one_or_none()
        if dep:
            dep.ci_tool = req.ci_tool
            dep.deploy_target = req.deploy_target
            dep.branch = req.branch
            dep.registry = req.registry
            dep.secrets_manager = req.vault
        else:
            dep = DeployConfig(
                user_id=uid,
                repo_full_name=req.repo_full_name,
                branch=req.branch,
                ci_tool=req.ci_tool,
                deploy_target=req.deploy_target,
                language="", framework="",
                registry=req.registry,
                secrets_manager=req.vault,
            )
            session.add(dep)
        await session.commit()
        await session.refresh(dep)

    return {"id": dep.id, "repo_full_name": dep.repo_full_name}


@router.get("/deployments")
async def list_deployments(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    uid = await _user_id(ip_session, authorization)
    if not is_db_available():
        return {"deployments": []}

    async with get_session() as session:
        result = await session.execute(
            select(DeployConfig).where(DeployConfig.user_id == uid)
            .order_by(DeployConfig.updated_at.desc())
        )
        deps = result.scalars().all()

    return {
        "deployments": [
            {
                "id": d.id,
                "repo_full_name": d.repo_full_name,
                "branch": d.branch,
                "ci_tool": d.ci_tool,
                "deploy_target": d.deploy_target,
                "registry": d.registry,
                "secrets_manager": d.secrets_manager,
                "created_at": d.created_at.isoformat(),
                "updated_at": d.updated_at.isoformat(),
            }
            for d in deps
        ]
    }


@router.delete("/deployments/{dep_id}", status_code=204)
async def delete_deployment(
    dep_id: int,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    uid = await _user_id(ip_session, authorization)
    if not is_db_available():
        return
    async with get_session() as session:
        result = await session.execute(
            select(DeployConfig).where(DeployConfig.id == dep_id, DeployConfig.user_id == uid)
        )
        dep = result.scalar_one_or_none()
        if dep:
            await session.delete(dep)
            await session.commit()


# ── GitHub Actions: Runs ──────────────────────────────────────────────────────

@router.get("/deployments/{dep_id}/runs")
async def get_runs(
    dep_id: int,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    uid = await _user_id(ip_session, authorization)
    dep = await _get_dep(dep_id, uid)
    hdrs = await _gh_headers()

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{GH_API}/repos/{dep.repo_full_name}/actions/runs?per_page=10",
            headers=hdrs,
        )
        if resp.status_code == 404:
            return {"runs": [], "repo": dep.repo_full_name, "hint": "No Actions runs yet — push to a branch to trigger CI."}
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"GitHub API error: {resp.text[:200]}")
        data = resp.json()

    runs = []
    for r in data.get("workflow_runs", []):
        duration = None
        if r.get("created_at") and r.get("updated_at") and r.get("conclusion"):
            try:
                s = datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))
                e = datetime.fromisoformat(r["updated_at"].replace("Z", "+00:00"))
                duration = int((e - s).total_seconds())
            except Exception:
                pass
        runs.append({
            "id": r["id"],
            "name": r.get("name", ""),
            "head_branch": r.get("head_branch", ""),
            "head_sha": (r.get("head_sha") or "")[:7],
            "status": r.get("status", ""),
            "conclusion": r.get("conclusion"),
            "created_at": r.get("created_at", ""),
            "updated_at": r.get("updated_at", ""),
            "html_url": r.get("html_url", ""),
            "duration_s": duration,
            "actor": r.get("triggering_actor", {}).get("login", ""),
        })

    return {"runs": runs, "repo": dep.repo_full_name}


# ── GitHub Actions: Jobs ──────────────────────────────────────────────────────

@router.get("/deployments/{dep_id}/runs/{run_id}/jobs")
async def get_run_jobs(
    dep_id: int,
    run_id: int,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    uid = await _user_id(ip_session, authorization)
    dep = await _get_dep(dep_id, uid)
    hdrs = await _gh_headers()

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{GH_API}/repos/{dep.repo_full_name}/actions/runs/{run_id}/jobs",
            headers=hdrs,
        )
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, "GitHub API error")
        data = resp.json()

    jobs = []
    for j in data.get("jobs", []):
        steps = [
            {
                "name": s.get("name", ""),
                "status": s.get("status", ""),
                "conclusion": s.get("conclusion"),
                "number": s.get("number", 0),
                "started_at": s.get("started_at"),
                "completed_at": s.get("completed_at"),
            }
            for s in j.get("steps", [])
        ]
        jobs.append({
            "id": j["id"],
            "name": j.get("name", ""),
            "status": j.get("status", ""),
            "conclusion": j.get("conclusion"),
            "started_at": j.get("started_at"),
            "completed_at": j.get("completed_at"),
            "steps": steps,
        })

    return {"jobs": jobs}


# ── GitHub Actions: Log streaming ─────────────────────────────────────────────

@router.get("/deployments/{dep_id}/runs/{run_id}/logs/{job_id}")
async def stream_job_logs(
    dep_id: int,
    run_id: int,
    job_id: int,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    uid = await _user_id(ip_session, authorization)
    dep = await _get_dep(dep_id, uid)
    hdrs = await _gh_headers()

    def _clean(line: str) -> str:
        # Strip GitHub log timestamp prefix: 2024-01-01T00:00:00.0000000Z  some text
        return re.sub(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s*", "", line)

    async def generate() -> AsyncGenerator[str, None]:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            try:
                resp = await client.get(
                    f"{GH_API}/repos/{dep.repo_full_name}/actions/jobs/{job_id}/logs",
                    headers=hdrs,
                )
                if resp.status_code in (200, 302):
                    for raw_line in resp.text.splitlines():
                        clean = _clean(raw_line)
                        if clean:
                            yield f"data: {json.dumps({'line': clean})}\n\n"
                            await asyncio.sleep(0.003)
                else:
                    yield f"data: {json.dumps({'error': f'GitHub returned {resp.status_code}'})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield 'data: {"done": true}\n\n'

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── AI failure analysis ───────────────────────────────────────────────────────

@router.post("/deployments/{dep_id}/analyze")
async def analyze_failure(
    dep_id: int,
    req: AnalyzeRequest,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    uid = await _user_id(ip_session, authorization)
    await _get_dep(dep_id, uid)   # just auth-check

    job_ctx = f" (job: {req.job_name})" if req.job_name else ""
    prompt = f"""You are an expert DevOps/SRE engineer. A CI pipeline job{job_ctx} has failed.
Analyze the failure logs and respond with ONLY valid JSON — no markdown, no prose outside the JSON.

Logs (last 6000 chars):
{req.logs[-6000:]}

Required JSON format:
{{
  "diagnosis": "1-2 sentence plain-English explanation of what failed and root cause",
  "fix_summary": "one sentence describing the fix",
  "severity": "error|warning|config",
  "files": [
    {{
      "path": "relative/file/path",
      "content": "COMPLETE corrected file content — no truncation",
      "change_description": "what specifically changed"
    }}
  ]
}}

Rules:
- If it's an infra/environment issue that can't be fixed via code changes, set "files": []
- If you need to fix a Dockerfile, CI workflow, or config file, include it fully in "files"
- Only include files you are confident need changing
- Output ONLY the JSON object, nothing else"""

    try:
        ai = AIService()
        full = ""
        async for chunk in ai.stream_devops(prompt):
            full += chunk

        m = re.search(r'\{[\s\S]*\}', full)
        if not m:
            return {"diagnosis": full.strip(), "fix_summary": "", "severity": "error", "files": []}
        return json.loads(m.group())
    except Exception as e:
        logger.error("Analyze failure error: %s", e)
        return {"diagnosis": f"Analysis failed: {e}", "fix_summary": "", "severity": "error", "files": []}


# ── Apply AI fix ──────────────────────────────────────────────────────────────

@router.post("/deployments/{dep_id}/apply-fix")
async def apply_fix(
    dep_id: int,
    req: ApplyFixRequest,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    uid = await _user_id(ip_session, authorization)
    dep = await _get_dep(dep_id, uid)

    from services.github_service import GitHubService
    from config.unified_store import get_platform_setting

    pat = await get_platform_setting("github.pat")
    username = await get_platform_setting("github.username")
    if not pat:
        raise HTTPException(400, "GitHub PAT not configured")

    gh = GitHubService(pat=pat, username=username)
    branch = req.branch or dep.branch or "main"
    files = [{"path": f["path"], "content": f["content"]} for f in req.files]

    import asyncio as _asyncio
    result = await _asyncio.to_thread(
        gh.push_files,
        f"https://github.com/{dep.repo_full_name}",
        files,
        req.message,
        branch,
    )
    if not result.get("success"):
        raise HTTPException(500, result.get("error", "Commit failed"))

    return {"committed": True, "files": len(files), "branch": branch}
