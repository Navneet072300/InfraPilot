import json
import logging
import time

from fastapi import APIRouter, Cookie, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, desc

from db.database import get_session, is_db_available
from db.models import User, GenerateSession
from core.security import decode_token
from services.ai_service import AIService

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


# ── Generate ───────────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    prompt: str
    tools: list[str] = ["Kubernetes"]
    context: list[str] = []
    cluster: str | None = None
    namespace: str | None = None


@router.post("/generate")
async def generate(request: GenerateRequest):
    logger.info("Generate: prompt=%s tools=%s context=%s", request.prompt[:80], request.tools, request.context)

    context_str = ", ".join(request.context) if request.context else ""

    async def stream():
        start = time.time()
        total = 0
        try:
            async for chunk in ai.stream_devops(request.prompt, request.tools, context_str):
                total += len(chunk)
                yield f"data: {json.dumps({'chunk': chunk, 'done': False})}\n\n"

            elapsed = round(time.time() - start, 1)
            yield f"data: {json.dumps({'done': True, 'elapsed': elapsed, 'lines': max(20, total // 40), 'cost_estimate': '$127/month'})}\n\n"
        except Exception as e:
            logger.error("Generate error: %s", e)
            yield f"data: {json.dumps({'error': str(e), 'done': True})}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Session history ────────────────────────────────────────────────────────────

class SaveSessionRequest(BaseModel):
    title: str
    prompt: str
    tools: list[str] = []
    context: list[str] = []
    files: list[dict] = []
    meta: dict = {}


@router.post("/generate/sessions", status_code=201)
async def save_session(
    body: SaveSessionRequest,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user_id = await _get_user_id(ip_session, authorization)
    if not user_id or not is_db_available():
        raise HTTPException(401, "Not authenticated")

    # Keep title short
    title = body.title[:200] or body.prompt[:80]

    async with get_session() as session:
        s = GenerateSession(
            user_id=user_id,
            title=title,
            prompt=body.prompt,
            tools=json.dumps(body.tools),
            context=json.dumps(body.context),
            files_json=json.dumps(body.files),
            meta_json=json.dumps(body.meta),
        )
        session.add(s)
        await session.commit()
        await session.refresh(s)

    return {"id": s.id, "title": s.title, "created_at": s.created_at.isoformat()}


@router.get("/generate/sessions")
async def list_sessions(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user_id = await _get_user_id(ip_session, authorization)
    if not user_id or not is_db_available():
        return {"sessions": []}

    async with get_session() as session:
        result = await session.execute(
            select(GenerateSession)
            .where(GenerateSession.user_id == user_id)
            .order_by(desc(GenerateSession.created_at))
            .limit(100)
        )
        rows = result.scalars().all()

    return {
        "sessions": [
            {
                "id": r.id,
                "title": r.title,
                "prompt": r.prompt,
                "tools": json.loads(r.tools or "[]"),
                "context": json.loads(r.context or "[]"),
                "files": json.loads(r.files_json or "[]"),
                "meta": json.loads(r.meta_json or "{}"),
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ]
    }


@router.delete("/generate/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: int,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    user_id = await _get_user_id(ip_session, authorization)
    if not user_id or not is_db_available():
        raise HTTPException(401, "Not authenticated")

    async with get_session() as session:
        result = await session.execute(
            select(GenerateSession)
            .where(GenerateSession.id == session_id, GenerateSession.user_id == user_id)
        )
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, "Session not found")
        await session.delete(row)
        await session.commit()
