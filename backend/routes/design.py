import json
import logging
import re

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.ai_service import ai

logger = logging.getLogger(__name__)
router = APIRouter()


class DesignRequest(BaseModel):
    requirements: str
    budget: int = 0
    cloud_provider: str = "aws"
    compliance: list[str] = []


DESIGN_SYSTEM = """You are a Principal Solutions Architect with 20+ years of experience.

CRITICAL: Respond ONLY with a raw JSON object. No markdown fences. No preamble. Start with { end with }.

CANVAS: 1400 × 900 pixels.

TWO NODE CATEGORIES:

1. CONTAINER nodes — cloud boundaries, regions, VPCs, AZs, subnets, security groups:
   {"id":"...", "type":"container", "label":"...", "x":N, "y":N, "width":N, "height":N, "depth":N, "costPerMonth":0}
   depth: 1=cloud boundary, 2=region, 3=VPC/VNet/VCN, 4=AZ/Zone/Fault Domain, 5=subnet/tier

2. SERVICE nodes — actual infrastructure components:
   {"id":"...", "type":"PICK_ONE", "label":"...", "x":N, "y":N, "costPerMonth":N}
   service types: loadbalancer | compute | database | cache | storage | cdn | network | gateway | queue | monitoring | dns | firewall | kubernetes | container

JSON SCHEMA:
{
  "diagram_nodes": [ ...container nodes first (outer→inner), then service nodes... ],
  "diagram_edges": [{"id":"e1","source":"node-id","target":"node-id","label":"HTTPS"}],
  "architecture_explanation": "Full multi-section string with \\n for newlines",
  "cost_breakdown": [{"service":"Name","monthly":N,"description":"details"}]
}

LAYOUT TEMPLATE — AWS 2-AZ architecture (adapt proportionally for user requirements):
Containers (define outer-to-inner order):
  cloud:   x:20,  y:20,  w:1100, h:840, depth:1  label:"AWS Cloud"
  region:  x:50,  y:80,  w:1040, h:750, depth:2  label:"us-east-1 Region"
  vpc:     x:90,  y:160, w:850,  h:630, depth:3  label:"Production VPC (10.0.0.0/16)"
  az-a:    x:120, y:220, w:380,  h:530, depth:4  label:"Availability Zone A"
  az-b:    x:540, y:220, w:380,  h:530, depth:4  label:"Availability Zone B"
  pub-a:   x:140, y:260, w:330,  h:120, depth:5  label:"Public Subnet A"
  app-a:   x:140, y:400, w:330,  h:130, depth:5  label:"App Subnet A"
  db-a:    x:140, y:550, w:330,  h:120, depth:5  label:"DB Subnet A"
  pub-b:   x:560, y:260, w:330,  h:120, depth:5  label:"Public Subnet B"
  app-b:   x:560, y:400, w:330,  h:130, depth:5  label:"App Subnet B"
  db-b:    x:560, y:550, w:330,  h:120, depth:5  label:"DB Subnet B"
  sec:     x:1150,y:80,  w:240,  h:380, depth:3  label:"Security & Monitoring"
Service nodes (absolute canvas coords, inside appropriate container):
  Internet Gateway: x:490, y:100 type:gateway
  ALB Node A:       x:250, y:295 type:loadbalancer  inside pub-a
  ALB Node B:       x:670, y:295 type:loadbalancer  inside pub-b
  App Server A:     x:250, y:445 type:compute        inside app-a
  App Server B:     x:670, y:445 type:compute        inside app-b
  RDS Primary:      x:670, y:590 type:database       inside db-b
  RDS Standby:      x:250, y:590 type:database       inside db-a
  CloudWatch:       x:1220,y:135 type:monitoring      inside sec
  AWS IAM:          x:1220,y:260 type:firewall        inside sec

CLOUD PROVIDER ADAPTATIONS:
- Azure: Subscription→ResourceGroup→VNet→[AvailabilitySet/Zone]→Subnets; add NSG, App Gateway, AKS
- GCP: Organization→Project→VPCNetwork→Region→Zones→Subnets; add Cloud Armor, GKE, CloudSQL
- Oracle: Tenancy→Compartment→VCN→[AD-1,AD-2]→Subnets; add LoadBalancer, ATP
- DigitalOcean: Account→Region→VPC→Droplets; simpler flat hierarchy with 1 container level
- Bare Metal: PhysicalDC→Rack/Network→ServerGroups; use compute/firewall/storage/network types
- System Architecture: No containers — pure flat service graph; use all 1400×900 canvas with services spread out
- Multi-Cloud: Side-by-side cloud containers (AWS on left x:20, Azure/GCP on right x:750+)

ADAPT based on user requirements:
- Add Redis cache node when caching mentioned
- Add Kafka/SQS queue node for event-driven patterns
- Add CDN node at top (y:-60 or above cloud boundary y:20)
- Kubernetes: use kubernetes type, add container nodes inside
- Add extra AZs/regions only if user specifies multi-region
- Microservices: more compute nodes per AZ with service mesh

SERVICE NODE POSITIONING RULES:
- Place nodes inside appropriate subnet boundary (check x,y is within container x→x+w, y→y+h)
- Minimum 100px horizontal gap between service nodes
- Internet-facing (CDN, DNS, Users) above cloud boundary: y < 20
- Gateway node: just inside region boundary, centered horizontally
- Monitoring/Security: always in the Security container (far right)

ARCHITECTURE EXPLANATION — use these exact ## section headers:
## Overview
## What You Will Implement
## Key Design Decisions
## Scalability & Reliability
## Security Posture
## Monthly Cost Estimate
## Trade-offs & What to Watch

COST BREAKDOWN: One row per billable component. monthly=0 means variable/included."""


def _extract_json(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        first_nl = text.find("\n")
        last_fence = text.rfind("```")
        if first_nl != -1 and last_fence > first_nl:
            text = text[first_nl + 1: last_fence].strip()
    if not text.startswith("{"):
        m = re.search(r'\{', text)
        if m:
            text = text[m.start():]
    last_brace = text.rfind("}")
    if last_brace != -1:
        text = text[: last_brace + 1]
    return text


async def stream_design(request: DesignRequest):
    provider_ctx = f"Cloud Provider: {request.cloud_provider.replace('_', ' ').title()}"
    prompt = f"{provider_ctx}\nRequirements: {request.requirements}"

    full = ""
    try:
        async for text in ai.stream_generate(DESIGN_SYSTEM, prompt, max_tokens=8000):
            full += text
            yield f"data: {json.dumps({'chunk': text, 'done': False})}\n\n"

        cleaned = _extract_json(full)
        logger.info("Design done: cloud=%s raw_len=%d starts=%s", request.cloud_provider, len(full), cleaned[:60])
        yield f"data: {json.dumps({'done': True, 'cleaned': cleaned})}\n\n"
    except Exception as e:
        logger.error("Design stream error: %s", e)
        yield f"data: {json.dumps({'error': str(e), 'done': True})}\n\n"


@router.post("/design")
async def design(request: DesignRequest):
    logger.info("Design: cloud=%s req=%s", request.cloud_provider, request.requirements[:80])
    return StreamingResponse(
        stream_design(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
