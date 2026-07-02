"""
Deployment tracking: monitors CI runs, streams logs, AI-powered fix suggestions.
Supports GitHub Actions (GitLab CI / Jenkins stubs ready to extend).
"""
from __future__ import annotations

import asyncio
import base64
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


# ── GitHub file helpers ───────────────────────────────────────────────────────

async def _fetch_repo_file(
    client: httpx.AsyncClient, repo: str, path: str, branch: str, hdrs: dict
) -> str | None:
    """Return decoded text of a file from the GitHub Contents API, or None."""
    try:
        resp = await client.get(
            f"{GH_API}/repos/{repo}/contents/{path}?ref={branch}", headers=hdrs
        )
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, dict) and data.get("content"):
                return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
    except Exception:
        pass
    return None


async def _list_workflow_files(
    client: httpx.AsyncClient, repo: str, branch: str, hdrs: dict
) -> list[str]:
    """Return paths of all YAML files under .github/workflows/."""
    try:
        resp = await client.get(
            f"{GH_API}/repos/{repo}/contents/.github/workflows?ref={branch}", headers=hdrs
        )
        if resp.status_code == 200:
            return [
                f["path"] for f in resp.json()
                if isinstance(f, dict) and f.get("name", "").endswith((".yml", ".yaml"))
            ]
    except Exception:
        pass
    return []


def _parse_ai_json(text: str) -> dict | None:
    """Try three increasingly lenient strategies to extract a JSON object."""
    text = text.strip()
    # 1. Direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # 2. Markdown code-fence: ```json { ... } ```
    m = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", text)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    # 3. Outermost { ... } in the entire text
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass
    return None


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
    dep = await _get_dep(dep_id, uid)
    hdrs = await _gh_headers()

    branch = dep.branch or "main"
    repo = dep.repo_full_name
    logs = req.logs
    logs_lower = logs.lower()

    # ── Determine which repo files are relevant to this failure ──────────────
    files_to_fetch: list[str] = []

    async with httpx.AsyncClient(timeout=15.0) as client:
        if dep.ci_tool == "github-actions":
            wf_paths = await _list_workflow_files(client, repo, branch, hdrs)
            files_to_fetch.extend(wf_paths[:4])
        elif dep.ci_tool == "gitlab-ci":
            files_to_fetch.append(".gitlab-ci.yml")
        elif dep.ci_tool == "jenkins":
            files_to_fetch.append("Jenkinsfile")

        if any(k in logs_lower for k in ("docker", "dockerfile", "container", "image")):
            files_to_fetch += ["Dockerfile", "frontend/Dockerfile", "backend/Dockerfile"]

        if any(k in logs_lower for k in ("npm", "yarn", "node_modules", "package")):
            files_to_fetch += ["package.json", "frontend/package.json"]
        if any(k in logs_lower for k in ("pip", "python", "requirements", "setuptools")):
            files_to_fetch += ["requirements.txt", "backend/requirements.txt", "pyproject.toml"]
        if any(k in logs_lower for k in ("go ", "golang", "go.mod", "go.sum")):
            files_to_fetch.append("go.mod")
        if any(k in logs_lower for k in ("gradle", "maven", "java", "pom.xml")):
            files_to_fetch += ["pom.xml", "build.gradle"]
        if any(k in logs_lower for k in ("cargo", "rust")):
            files_to_fetch.append("Cargo.toml")

        files_to_fetch += ["docker-compose.yml", "docker-compose.yaml"]
        files_to_fetch = list(dict.fromkeys(files_to_fetch))  # dedupe, preserve order

        fetch_results = await asyncio.gather(
            *[_fetch_repo_file(client, repo, p, branch, hdrs) for p in files_to_fetch],
            return_exceptions=True,
        )

    # Build file context block (only files that actually exist)
    file_sections = []
    for path, content in zip(files_to_fetch, fetch_results):
        if isinstance(content, str) and content.strip():
            file_sections.append(f"=== {path} ===\n{content}")
    file_context = "\n\n".join(file_sections) if file_sections else "(No relevant files could be fetched from GitHub)"

    # Extract key error lines for emphasis
    error_lines = [
        line for line in logs.splitlines()
        if re.search(r"error|fail|fatal|exception|cannot|denied|not found|invalid|exit code\s+[^0]", line, re.I)
    ]
    key_errors = "\n".join(error_lines[-40:]) if error_lines else "(see full logs)"

    deploy_ctx = "\n".join([
        f"- Repository:     {repo}",
        f"- Branch:         {branch}",
        f"- CI Tool:        {dep.ci_tool or 'unknown'}",
        f"- Deploy Target:  {dep.deploy_target or 'unknown'}",
        f"- Language:       {dep.language or 'unknown'}",
        f"- Framework:      {dep.framework or 'unknown'}",
        f"- Registry:       {dep.registry or 'unknown'}",
    ])

    prompt = f"""You are a principal DevOps/SRE engineer with 10+ years of experience in CI/CD, Docker, Kubernetes, and cloud infrastructure. A pipeline job has failed and you must find the exact root cause and produce a working fix.

DEPLOYMENT CONTEXT:
{deploy_ctx}

FAILED JOB: {req.job_name or "unknown"}

CURRENT REPOSITORY FILE CONTENTS (read from GitHub — these are the real files):
{file_context}

FULL FAILURE LOGS (last 8 000 chars):
{logs[-8000:]}

EXTRACTED ERROR LINES:
{key_errors}

YOUR TASK:
1. Pinpoint the EXACT root cause by referencing the precise log line or file content that reveals the problem.
2. Classify the failure:
   - TRANSIENT (network blip, rate-limit, flaky test) → severity="warning", files=[], explain in manual_steps
   - MISSING CONFIG (env var, GitHub secret, missing service) → severity="config", files=[], list exact steps in manual_steps
   - FIXABLE BY CODE CHANGE (wrong Dockerfile, broken workflow step, bad dependency, wrong build command) → severity="error", provide complete fixed file(s)
3. When producing file fixes:
   - Start from the CURRENT FILE CONTENT shown above — do not invent new structure
   - Make ONLY the minimal surgical change needed; preserve everything else
   - Return the COMPLETE file — no "..." ellipsis, no "# rest unchanged", no truncation
   - If fixing a workflow file keep ALL existing jobs, steps, and configuration intact
4. If multiple files need changes, include all of them.

RESPOND WITH ONLY THIS JSON (no markdown fences, no prose before/after):
{{
  "diagnosis": "Precise technical explanation referencing the exact failing log line and why it failed",
  "fix_summary": "One sentence: what specific change fixes it",
  "severity": "error|warning|config",
  "root_cause_line": "The single most diagnostic log line",
  "files": [
    {{
      "path": "exact/repo-relative/path",
      "content": "COMPLETE corrected file content — never truncate",
      "change_description": "What changed and why this fixes the error"
    }}
  ],
  "manual_steps": []
}}"""

    try:
        ai = AIService()
        full = ""
        async for chunk in ai.stream_devops(prompt):
            full += chunk

        parsed = _parse_ai_json(full)
        if parsed:
            return {
                "diagnosis": parsed.get("diagnosis", ""),
                "fix_summary": parsed.get("fix_summary", ""),
                "severity": parsed.get("severity", "error"),
                "root_cause_line": parsed.get("root_cause_line", ""),
                "files": parsed.get("files", []),
                "manual_steps": parsed.get("manual_steps", []),
            }
        # Fallback: treat raw text as diagnosis
        return {
            "diagnosis": full.strip() or "No analysis returned.",
            "fix_summary": "",
            "severity": "error",
            "root_cause_line": "",
            "files": [],
            "manual_steps": [],
        }
    except Exception as e:
        logger.error("Analyze failure error: %s", e)
        return {
            "diagnosis": f"Analysis error: {e}",
            "fix_summary": "",
            "severity": "error",
            "root_cause_line": "",
            "files": [],
            "manual_steps": [],
        }


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
