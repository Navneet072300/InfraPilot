import json
import logging
import time

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.ai_service import AIService

logger = logging.getLogger(__name__)
router = APIRouter()
ai = AIService()


class GenerateRequest(BaseModel):
    prompt: str
    tools: list[str] = ["Kubernetes"]
    context: list[str] = []
    cluster: str | None = None
    namespace: str | None = None


@router.post("/generate")
async def generate(request: GenerateRequest):
    logger.info("Generate: prompt=%s tools=%s context=%s", request.prompt[:80], request.tools, request.context)

    # Build cloud/platform context string so AI knows which provider to target
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
