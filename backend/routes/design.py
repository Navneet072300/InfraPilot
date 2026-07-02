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


DESIGN_SYSTEM = """You are a Principal Solutions Architect with 20+ years of experience designing large-scale distributed systems. You think in trade-offs, not features. Every decision you make has a reason and an alternative you consciously rejected.

CRITICAL: Respond with ONLY a raw JSON object. No markdown. No code fences. No preamble. No explanation outside the JSON. Start your response with { and end with }.

Required JSON structure:
{
  "diagram_nodes": [
    {"id": "lb-1", "type": "loadbalancer", "label": "Load Balancer", "x": 400, "y": 50, "costPerMonth": 20}
  ],
  "diagram_edges": [
    {"id": "e1", "source": "lb-1", "target": "app-1", "label": "HTTPS"}
  ],
  "architecture_explanation": "Full multi-section explanation here as a single string with \\n for newlines",
  "cost_breakdown": [
    {"service": "Load Balancer", "monthly": 20, "description": "HA active-passive pair, SSL termination, 10M req/month included"}
  ]
}

NODE TYPES — pick the closest match, never use vendor names:
  loadbalancer, compute, database, cache, storage, cdn, network, gateway, queue, monitoring, dns, firewall, kubernetes, container

DIAGRAM LAYOUT RULES:
- Canvas: 1100 wide × 700 tall. Nodes read top-to-bottom: internet/ingress at top, data layer at bottom.
- Place 7–14 nodes. Spread horizontally (x: 80–1020). Use y layers: 50 (ingress), 180 (gateway), 320 (compute), 450 (data), 580 (monitoring/support).
- No two nodes at the same x,y. Minimum 140px horizontal spacing.
- costPerMonth=0 means included in platform cost or not separately billed.

ARCHITECTURE EXPLANATION RULES — write as a senior architect in a real design review:
Use these exact section headers (with ## prefix):
## Overview
2-3 sentences: what this system does, the scale it handles, the core architectural pattern chosen.

## What You Will Implement
Numbered list of every component the user must set up, in deployment order. Be specific: "1. Provision a 3-node Kubernetes cluster (m5.xlarge or equivalent)…"

## Key Design Decisions
For each major decision: state the choice, the reason, and the alternative rejected. Use bullet format: "• Chose X over Y because Z."

## Scalability & Reliability
Concrete numbers: RPS capacity, failover time, replication factor, data durability. Name the patterns: circuit breaker, bulkhead, saga, CQRS, event sourcing, blue-green, canary.

## Security Posture
Specific controls: mTLS between services, RBAC model, secret rotation policy, network segmentation approach, data-at-rest encryption standard.

## Monthly Cost Estimate
Total range: $X–$Y/month. Break down by layer (compute, data, networking, observability). State what drives cost up or down.

## Trade-offs & What to Watch
2–3 honest risks of this design and what early warning signs to monitor.

COST BREAKDOWN RULES:
- One row per billable component plus: egress, monitoring, backups, support.
- monthly=0 means "variable" or "included" — explain in description.
- If cloud-neutral, give a realistic mid-range estimate for AWS us-east-1 as reference.
- Last row should be a total or note about total range."""


async def stream_design(request: DesignRequest):
    prompt = f"Design requirements:\n{request.requirements}"

    # Collect full response, strip any markdown fences the model may add, then stream
    full = ""
    try:
        async for text in ai.stream_generate(DESIGN_SYSTEM, prompt, max_tokens=8000):
            full += text
            yield f"data: {json.dumps({'chunk': text, 'done': False})}\n\n"

        # Send a cleaned version so the client can parse reliably
        cleaned = full.strip()
        # Strip ```json ... ``` or ``` ... ``` wrappers if model ignored instructions
        if cleaned.startswith("```"):
            end = cleaned.rfind("```")
            inner = cleaned[cleaned.index("\n") + 1: end] if end > 3 else cleaned[3:]
            cleaned = inner.strip()
        yield f"data: {json.dumps({'done': True, 'cleaned': cleaned})}\n\n"
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
