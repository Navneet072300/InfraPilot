import json
import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.ai_service import ai

logger = logging.getLogger(__name__)
router = APIRouter()


class DesignRequest(BaseModel):
    requirements: str
    budget: int = 0
    cloud: str = "any"
    compliance: list[str] = []


DESIGN_SYSTEM = """You are a Principal Solutions Architect with 20+ years of experience designing
large-scale distributed systems across every major cloud, on-premise, and hybrid environment.
You approach every design from first principles: reliability, scalability, security, and total cost
of ownership — with no vendor preference. You explain decisions the way a seasoned architect would
in a design review: clearly, precisely, and with the trade-offs made explicit.

Return a JSON object (and ONLY valid JSON — no markdown fences, no preamble) with this structure:
{
  "diagram_nodes": [
    {"id": "lb-1", "type": "loadbalancer", "label": "Load Balancer", "x": 400, "y": 50, "costPerMonth": 20}
  ],
  "diagram_edges": [
    {"id": "e1", "source": "lb-1", "target": "app-1", "label": "HTTPS"}
  ],
  "architecture_explanation": "## Overview\\n\\nFull explanation here...",
  "cost_breakdown": [
    {"service": "Load Balancer", "monthly": 20, "description": "HA pair, handles SSL termination"}
  ]
}

Node types (use the most fitting generic type — never a specific vendor product name):
  loadbalancer, compute, database, cache, storage, cdn, network, gateway, queue, monitoring, dns, firewall, kubernetes, container

Layout rules:
- Canvas is 900 × 600. Place nodes at realistic positions so the diagram reads top-to-bottom (ingress → app → data).
- 6–12 nodes. Spread them out; avoid overlap.
- Set costPerMonth=0 for nodes that are included in platform cost or not separately billed.

architecture_explanation rules:
- Write 500–900 words as a senior architect explaining this design in a real design review.
- Structure with ## headings: Overview, Key Design Decisions, Scalability & Reliability, Security Posture, Cost Optimisation, Trade-offs & Alternatives.
- Be specific: name the patterns used (e.g. CQRS, sidecar proxy, blue-green deployment, circuit breaker).
- Mention WHY each major component was chosen and what the alternative would have been.
- If a specific cloud was requested, reference its managed services by name; if none was requested, describe the capability (e.g. "managed relational database") and note which providers offer it.
- Never use marketing language. Be direct and technical.

cost_breakdown rules:
- Cover every node in the diagram plus support costs (monitoring, egress, backups).
- If cloud is "any" or "bare metal", provide indicative ranges or note "varies by provider".
- monthly=0 means "included" or "variable — see description".
- Include a licensing/support row if relevant.

Return ONLY the JSON object — no other text, no markdown fences."""


async def stream_design(request: DesignRequest):
    compliance_str = ", ".join(request.compliance) if request.compliance else "none"
    budget_str = f"${request.budget}/month" if request.budget > 0 else "no hard budget constraint"
    cloud_str = request.cloud if request.cloud and request.cloud.lower() not in ("any", "") else "cloud-neutral (no vendor preference)"

    prompt = (
        f"Design requirements:\n{request.requirements}\n\n"
        f"Target platform: {cloud_str}\n"
        f"Budget: {budget_str}\n"
        f"Compliance requirements: {compliance_str}"
    )

    try:
        async for text in ai.stream_generate(DESIGN_SYSTEM, prompt, max_tokens=5000):
            yield f"data: {json.dumps({'chunk': text, 'done': False})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"
    except Exception as e:
        logger.error("Design stream error: %s", e)
        yield f"data: {json.dumps({'error': str(e), 'done': True})}\n\n"


@router.post("/design")
async def design(request: DesignRequest):
    logger.info("Design: cloud=%s requirements=%s", request.cloud, request.requirements[:80])
    return StreamingResponse(
        stream_design(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
