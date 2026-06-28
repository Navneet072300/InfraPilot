import asyncio
import json
import logging
import re
import shlex
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.ai_service import ai

logger = logging.getLogger(__name__)
router = APIRouter()

# Process-scoped session store (survives for process lifetime)
_sessions: dict[str, dict] = {}

# ── AI Prompts ────────────────────────────────────────────────────────────────

SRE_DEEP_SYSTEM = """You are a Staff SRE with 15 years of experience across Kubernetes, AWS, GCP, Azure, and bare metal production systems.

Your diagnostic philosophy:
- Never assume one cause. Hypothesize multiple, then eliminate with evidence.
- A pod in ImagePullBackOff could be 6 different things. Do not commit to one until evidence rules out others.
- Other pods running is evidence. Recent deployments are evidence. Restart counts are evidence. Use all available context.
- Give exact commands with REAL values. Never write <your-namespace> when you have the actual namespace.
- Derive deployment name from pod name by stripping the two hash suffixes: backend-7d8f9b2c1-x9m4p → backend.

Output ONLY a valid JSON object (no markdown fences, no preamble, no trailing text after the closing brace):

{
  "severity": "critical|high|medium|low",
  "what_is_happening": "plain english paragraph, max 4 sentences, no commands. Must reference specific evidence from logs/events and explain what it points toward or away from.",
  "causes": [
    {
      "id": 1,
      "title": "short cause title",
      "confidence_percent": 45,
      "why": "2 sentences: why this might be the cause and what evidence from the logs supports or contradicts it",
      "check_description": "one sentence: what to run to verify this",
      "check_command": "exact kubectl/curl command with real pod name, namespace, and cluster substituted in",
      "if_confirmed": "one sentence: what to do next if this is confirmed as the cause",
      "if_ruled_out": "one sentence: what to check next if this is ruled out"
    }
  ],
  "recommended_order": "one opinionated paragraph explaining which cause to check first and why, based on the available evidence. Sound like a senior engineer telling a junior what to do.",
  "fix_steps": [
    {
      "step": 1,
      "title": "concise step title",
      "command": "exact command — use actual pod/deployment/namespace/cluster values, never placeholders",
      "expected_output": "exact text or pattern that indicates success",
      "if_different": "what to do if the output is not what we expected"
    }
  ],
  "prevention": [
    {
      "title": "prevention item title",
      "why": "one sentence: why this specific incident would have been caught or prevented",
      "implementation": "exact YAML, shell command, or code to implement — not a description",
      "effort": "5 min|30 min|2 hours|1 day"
    }
  ]
}

Rules:
- Generate 4-6 causes, ordered by confidence_percent descending.
- Every command must substitute real values from context — no angle brackets.
- what_is_happening must reference specific evidence (restart count, error message, status of other pods).
- fix_steps should reflect the most likely cause (highest confidence_percent).
- JSON must be valid — verify all commas and brackets before responding."""

SRE_CHAT_SYSTEM = """You are a Staff SRE continuing an interactive incident investigation.

You have full context of the original diagnosis, all causes identified, which ones are confirmed/ruled out, and all commands run so far.

Behavior:
- Be direct. No filler. "The secret doesn't exist" not "It seems there might be an issue with the secret."
- When you want to run a command, end your response with exactly this on its own line:
  COMMAND_REQUEST: kubectl get secret regcred -n production
  Only ONE command per response. Do not include the line if you don't want to run a command.
- Interpret command output immediately — tell what it means for the diagnosis, update your confidence.
- If the engineer says "just fix it" — outline exactly what you will do step by step, then ask for single confirmation.
- Never run destructive commands without explicit per-command confirmation.
- If you don't know something, say so. Never fabricate kubectl output.

Diagnosis context:
{diagnosis_context}

Confirmed causes: {confirmed_causes}
Ruled-out causes: {ruled_out_causes}
Commands run: {command_results}"""

RCA_SYSTEM = """You are a senior SRE writing a formal Root Cause Analysis document for a post-incident review.

Generate a professional RCA in Markdown with these exact sections:

# Root Cause Analysis Report

**Incident:** [descriptive title derived from the incident]
**Severity:** [severity level]
**Date:** [provided date]
**Affected Service:** [pod/deployment and namespace]
**Prepared by:** [provided name]

---

## Executive Summary

[2-3 sentences written for a non-technical manager. No commands. Plain English only.]

## Timeline

[Reconstruct a plausible timeline from the available evidence. Format as bullet points with timestamps. Include detection, investigation, resolution.]

## Root Cause

[Technical explanation in 1-2 paragraphs. What specifically failed and why.]

## Contributing Factors

- [Factor 1: what made this incident possible]
- [Factor 2: what monitoring/process wasn't in place]
- [Factor 3: if applicable]

## Resolution

[Steps taken to resolve, with exact commands used]

## Prevention

[3 specific prevention items — each with exact implementation code/YAML, not general advice]

## Action Items

| Action | Owner | Due Date | Status |
|--------|-------|----------|--------|
| [Specific actionable item] | TBD | TBD | Open |
| [Specific actionable item] | TBD | TBD | Open |
| [Specific actionable item] | TBD | TBD | Open |

---
*Generated by InfraPilot · {date}*"""


# ── Models ────────────────────────────────────────────────────────────────────

class DiagnoseRequest(BaseModel):
    logs: str = ""
    events: str = ""
    description: str = ""
    pod_name: str | None = None
    namespace: str | None = None
    cluster: str | None = None
    related_pods: str | None = None
    user_context: str | None = None
    user_expected_behavior: str | None = None


class ChatRequest(BaseModel):
    diagnosis_id: str
    message: str
    chat_history: list[dict] = []
    command_results: list[dict] = []


class RunCommandRequest(BaseModel):
    diagnosis_id: str
    command: str
    cluster: str | None = None
    confirmed: bool = False


class RCARequest(BaseModel):
    diagnosis_id: str
    user_name: str = "SRE Team"
    edits: dict = {}


class CauseStatusRequest(BaseModel):
    cause_id: int
    status: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ev(type_: str, **kwargs) -> str:
    return f"data: {json.dumps({'type': type_, **kwargs})}\n\n"


def _parse_json(raw: str) -> dict | None:
    stripped = raw.strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass
    m = re.search(r'\{[\s\S]*\}', stripped)
    if m:
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            pass
    return None


# ── Command whitelist ─────────────────────────────────────────────────────────

_NEVER = re.compile(
    r"kubectl.*(delete\s+(deployment|namespace|node|service|pv|pvc|clusterrole)"
    r"|exec\b|port-forward\b)",
    re.IGNORECASE,
)
_SAFE = re.compile(
    r"^kubectl\s+(get|describe|logs|top|rollout\s+status|version|cluster-info|run\s+netcheck)\b",
    re.IGNORECASE,
)
_WRITE = re.compile(
    r"^kubectl\s+(apply|patch|create|rollout\s+restart)\b",
    re.IGNORECASE,
)
_DELETE_POD = re.compile(r"^kubectl\s+delete\s+pod\s", re.IGNORECASE)


def _classify(cmd: str) -> tuple[str, bool]:
    """Returns (risk, allowed): risk is read|write|destructive."""
    if _NEVER.search(cmd):
        return "destructive", False
    if _DELETE_POD.match(cmd):
        return "destructive", True
    if _SAFE.match(cmd):
        return "read", True
    if _WRITE.match(cmd):
        return "write", True
    return "destructive", False


async def _get_k8s(cluster_name: str | None):
    from config import unified_store
    from services.k8s_service import KubernetesService
    cfg = await unified_store.get_cluster(cluster_name) if cluster_name else await unified_store.get_active_cluster()
    if not cfg:
        raise HTTPException(404, "Cluster not configured")
    return KubernetesService(cfg)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/diagnose")
async def diagnose(req: DiagnoseRequest):
    logger.info("Diagnose: pod=%s ns=%s cluster=%s", req.pod_name, req.namespace, req.cluster)

    context_lines = []
    if req.pod_name:
        context_lines.append(f"Pod: {req.pod_name}")
    if req.namespace:
        context_lines.append(f"Namespace: {req.namespace}")
    if req.cluster:
        context_lines.append(f"Cluster: {req.cluster}")

    parts = []
    if req.logs or req.description:
        parts.append(f"Logs / Events:\n{req.logs or req.description}")
    if req.events:
        parts.append(f"Kubernetes Events:\n{req.events}")
    if req.related_pods:
        parts.append(f"Related pods:\n{req.related_pods}")
    if req.user_context:
        parts.append(f"User context: {req.user_context}")
    if req.user_expected_behavior:
        parts.append(f"Expected behavior: {req.user_expected_behavior}")

    prompt = "\n".join(context_lines)
    if parts:
        prompt += "\n\n" + "\n\n".join(parts)

    async def stream():
        sid = str(uuid.uuid4())
        yield _ev("start", session_id=sid)

        buffer = ""
        try:
            async for chunk in ai.stream_generate(SRE_DEEP_SYSTEM, prompt, max_tokens=3000):
                buffer += chunk
        except Exception as e:
            logger.error("Diagnose AI error: %s", e)
            yield _ev("error", error=str(e))
            yield _ev("done", done=True, session_id=sid)
            return

        parsed = _parse_json(buffer)
        if not parsed:
            logger.warning("Diagnose: could not parse JSON, len=%d", len(buffer))
            parsed = {
                "severity": "high",
                "what_is_happening": buffer[:800] if buffer else "Analysis could not be structured.",
                "causes": [],
                "recommended_order": "",
                "fix_steps": [],
                "prevention": [],
            }

        session = {
            "id": sid,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "pod_name": req.pod_name,
            "namespace": req.namespace,
            "cluster": req.cluster,
            "logs": (req.logs or req.description or "")[:2000],
            "resolved": False,
            "cause_statuses": {},
            **parsed,
        }
        _sessions[sid] = session

        # Trim oldest if over 100
        if len(_sessions) > 100:
            del _sessions[next(iter(_sessions))]

        yield _ev(
            "analysis_header",
            severity=parsed.get("severity", "high"),
            what_is_happening=parsed.get("what_is_happening", ""),
            pod_name=req.pod_name,
            namespace=req.namespace,
            cluster=req.cluster,
        )

        for cause in parsed.get("causes", []):
            yield _ev("cause", cause=cause)
            await asyncio.sleep(0.18)

        yield _ev(
            "analysis",
            recommended_order=parsed.get("recommended_order", ""),
            fix_steps=parsed.get("fix_steps", []),
            prevention=parsed.get("prevention", []),
        )

        yield _ev("done", done=True, session_id=sid)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/diagnose/chat")
async def diagnose_chat(req: ChatRequest):
    session = _sessions.get(req.diagnosis_id, {})

    statuses = session.get("cause_statuses", {})
    confirmed = [c["title"] for c in session.get("causes", [])
                 if statuses.get(str(c["id"])) == "confirmed"]
    ruled_out = [c["title"] for c in session.get("causes", [])
                 if statuses.get(str(c["id"])) == "ruled_out"]

    cmd_str = "\n".join(
        f"$ {r.get('command', '')}\n{r.get('output', '')}"
        for r in req.command_results[-5:]
    ) if req.command_results else "None"

    diag_ctx = (
        f"Severity: {session.get('severity', 'unknown')}\n"
        f"Pod: {session.get('pod_name', 'N/A')} | Namespace: {session.get('namespace', 'default')} | Cluster: {session.get('cluster', 'N/A')}\n"
        f"What happened: {session.get('what_is_happening', 'Unknown')}\n"
        f"Original input (truncated): {session.get('logs', '')[:400]}"
    ) if session else "No diagnosis loaded."

    system = SRE_CHAT_SYSTEM.format(
        diagnosis_context=diag_ctx,
        confirmed_causes=", ".join(confirmed) or "None yet",
        ruled_out_causes=", ".join(ruled_out) or "None yet",
        command_results=cmd_str,
    )

    messages = req.chat_history[-20:] + [{"role": "user", "content": req.message}]

    async def stream():
        buffer = ""
        pending_cmd = None
        try:
            async for chunk in ai.stream_chat(system, messages, max_tokens=1024):
                if "COMMAND_REQUEST:" in (buffer + chunk):
                    combined = buffer + chunk
                    before, after = combined.split("COMMAND_REQUEST:", 1)
                    pending_cmd = after.strip().split("\n")[0].strip()
                    if before.strip():
                        # Emit the text before the command request
                        clean = before.rstrip()
                        if clean:
                            yield _ev("chunk", chunk=clean[len(buffer):] if len(clean) > len(buffer) else clean)
                    buffer = combined
                    break
                buffer += chunk
                yield _ev("chunk", chunk=chunk)
        except Exception as e:
            logger.error("Chat error: %s", e)
            yield _ev("error", error=str(e))

        if pending_cmd:
            yield _ev("command_request", command=pending_cmd)

        yield _ev("done", done=True)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/diagnose/run-command")
async def run_command(req: RunCommandRequest):
    if not req.confirmed:
        raise HTTPException(400, "confirmed must be true")

    risk, allowed = _classify(req.command.strip())
    if not allowed:
        raise HTTPException(403, f"Command not in allowlist: {req.command[:80]}")

    cluster_name = req.cluster
    if not cluster_name and req.diagnosis_id in _sessions:
        cluster_name = _sessions[req.diagnosis_id].get("cluster")

    async def stream():
        try:
            svc = await _get_k8s(cluster_name)
            parts = shlex.split(req.command.strip())
            if parts and parts[0].lower() == "kubectl":
                parts = parts[1:]

            result = await svc._kubectl(parts, timeout=30)
            output = result.get("stdout", "") or result.get("stderr", "")
            for line in output.split("\n"):
                if line.strip():
                    yield _ev("output", text=line)
            if result.get("exit_code", 0) != 0:
                yield _ev("error_code", code=result.get("exit_code", 1))
        except HTTPException as e:
            yield _ev("output", text=f"Error: {e.detail}")
        except Exception as e:
            logger.exception("run-command error")
            yield _ev("output", text=f"Error: {e}")

        yield _ev("done", done=True)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/diagnose/rca")
async def generate_rca(req: RCARequest):
    session = _sessions.get(req.diagnosis_id)
    if not session:
        raise HTTPException(404, "Session not found")

    confirmed_causes = [
        c["title"] for c in session.get("causes", [])
        if session.get("cause_statuses", {}).get(str(c["id"])) == "confirmed"
    ]
    prompt = (
        f"Severity: {session.get('severity', 'unknown')}\n"
        f"Pod: {session.get('pod_name', 'N/A')} | Namespace: {session.get('namespace', 'N/A')} | Cluster: {session.get('cluster', 'N/A')}\n"
        f"What happened: {session.get('what_is_happening', '')}\n"
        f"Root cause(s) confirmed: {', '.join(confirmed_causes) or 'Under investigation'}\n\n"
        f"Fix steps taken:\n{json.dumps(session.get('fix_steps', []), indent=2)}\n\n"
        f"Prevention items:\n{json.dumps(session.get('prevention', []), indent=2)}\n\n"
        f"User name: {req.user_name}\n"
        f"Date: {datetime.now(timezone.utc).strftime('%Y-%m-%d')}\n"
        + (f"\nEditor notes: {json.dumps(req.edits)}" if req.edits else "")
    )
    system = RCA_SYSTEM.replace("{date}", datetime.now(timezone.utc).strftime("%Y-%m-%d"))

    async def stream():
        try:
            async for chunk in ai.stream_generate(system, prompt, max_tokens=2000):
                yield _ev("chunk", chunk=chunk)
        except Exception as e:
            logger.error("RCA error: %s", e)
            yield _ev("error", error=str(e))
        yield _ev("done", done=True)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/diagnose/history")
async def get_history(limit: int = 10):
    items = sorted(_sessions.values(), key=lambda s: s.get("created_at", ""), reverse=True)[:limit]
    return {
        "sessions": [
            {
                "id": s["id"],
                "severity": s.get("severity", "high"),
                "pod_name": s.get("pod_name"),
                "namespace": s.get("namespace"),
                "cluster": s.get("cluster"),
                "issue_title": (s.get("causes") or [{}])[0].get("title", "Unknown"),
                "created_at": s.get("created_at"),
                "resolved": s.get("resolved", False),
            }
            for s in items
        ]
    }


@router.get("/diagnose/{session_id}")
async def get_session(session_id: str):
    s = _sessions.get(session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    return s


@router.put("/diagnose/{session_id}/cause-status")
async def update_cause_status(session_id: str, req: CauseStatusRequest):
    s = _sessions.get(session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    if req.status not in ("confirmed", "ruled_out", "investigating"):
        raise HTTPException(400, "Invalid status")
    s.setdefault("cause_statuses", {})[str(req.cause_id)] = req.status
    return {"ok": True}


@router.post("/diagnose/{session_id}/resolve")
async def resolve_session(session_id: str):
    s = _sessions.get(session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    s["resolved"] = True
    s["resolved_at"] = datetime.now(timezone.utc).isoformat()
    return {"ok": True}


# Keep the old runbook endpoint for backwards compat
@router.post("/runbook")
async def generate_runbook_compat(request: dict):
    """Legacy runbook endpoint — redirected to RCA."""
    from pydantic import BaseModel

    class _Req(BaseModel):
        severity: str = "high"
        root_cause: str = ""
        suggested_fix: str = ""
        prevention: str = ""
        original_logs: str = ""

    prompt = f"Severity: {request.get('severity', 'high')}\nRoot cause: {request.get('root_cause', '')}\nFix: {request.get('suggested_fix', '')}\nPrevention: {request.get('prevention', '')}"

    async def stream():
        try:
            async for chunk in ai.stream_generate(RCA_SYSTEM.replace("{date}", datetime.now(timezone.utc).strftime("%Y-%m-%d")), prompt, max_tokens=1500):
                yield f"data: {json.dumps({'chunk': chunk, 'done': False})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e), 'done': True})}\n\n"
            return
        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
