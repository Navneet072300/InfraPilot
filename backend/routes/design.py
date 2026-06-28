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
    budget: int = 1000
    region: str = "us-east-1"
    compliance: list[str] = []


DESIGN_SYSTEM = (
    "You are an expert cloud architect specializing in AWS, Kubernetes, and modern DevOps. "
    "Return a JSON object (and ONLY valid JSON — no markdown fences, no preamble) with this exact structure:\n"
    "{\n"
    '  "diagram_nodes": [\n'
    '    {"id": "alb-1", "type": "alb", "label": "Application Load Balancer", "x": 400, "y": 50, "costPerMonth": 20}\n'
    "  ],\n"
    '  "diagram_edges": [\n'
    '    {"id": "e1", "source": "alb-1", "target": "eks-1", "label": ""}\n'
    "  ],\n"
    '  "terraform_outline": "# Terraform outline\\nresource \\"aws_lb\\" ...",\n'
    '  "k8s_manifests": "# Kubernetes manifests\\napiVersion: ...",\n'
    '  "cicd_pipeline": "# CI/CD Pipeline\\nname: Deploy ...",\n'
    '  "cost_breakdown": [\n'
    '    {"service": "EKS", "monthly": 150, "description": "Managed Kubernetes"}\n'
    "  ]\n"
    "}\n\n"
    "Node types must be one of: alb, eks, rds, redis, s3, cloudfront, ec2, vpc, igw, nat.\n"
    "Place nodes at reasonable x,y coordinates (canvas is 900x600). "
    "Include 6-10 nodes with realistic costs. "
    "Return ONLY the JSON object, no other text."
)


async def stream_design(request: DesignRequest):
    compliance_str = ", ".join(request.compliance) if request.compliance else "none"
    prompt = (
        f"{request.requirements}\n\n"
        f"Region: {request.region} | Budget: ${request.budget}/month | Compliance: {compliance_str}"
    )

    try:
        async for text in ai.stream_generate(DESIGN_SYSTEM, prompt, max_tokens=4096):
            yield f"data: {json.dumps({'chunk': text, 'done': False})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"
    except Exception as e:
        logger.error("Design stream error: %s", e)
        yield f"data: {json.dumps({'error': str(e), 'done': True})}\n\n"


@router.post("/design")
async def design(request: DesignRequest):
    logger.info("Design: requirements=%s", request.requirements[:80])
    return StreamingResponse(
        stream_design(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
