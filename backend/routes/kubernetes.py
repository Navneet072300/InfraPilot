import hashlib
import json
import logging

from fastapi import APIRouter, Cookie, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import unified_store
from services import cache_service, audit_service
from services.k8s_service import KubernetesService, KUBECTL_ALLOWED

logger = logging.getLogger(__name__)
router = APIRouter()


async def _get_service(cluster: str | None) -> KubernetesService:
    if cluster:
        cfg = await unified_store.get_cluster(cluster)
    else:
        cfg = await unified_store.get_active_cluster()
    if not cfg:
        raise HTTPException(status_code=404, detail="Cluster not configured")
    return KubernetesService(cfg)


@router.get("/k8s/health")
async def cluster_health(cluster: str | None = Query(None)):
    if not await unified_store.is_configured():
        return {"healthy": False, "configured": False, "cluster_name": cluster or "none"}

    cache_key = f"health:{cluster or 'active'}"
    cached = await cache_service.get(cache_key)
    if cached:
        return cached

    svc = await _get_service(cluster)
    result = await svc.health()
    await cache_service.set(cache_key, result, ttl=cache_service.TTL_HEALTH)
    return result


@router.get("/k8s/clusters")
async def list_clusters():
    clusters = await unified_store.list_clusters(masked=False)
    return {
        "clusters": [
            {
                "name": c["name"],
                "environment": c.get("environment", "dev"),
                "active": c.get("active", False),
            }
            for c in clusters
        ]
    }


@router.get("/k8s/namespaces")
async def list_namespaces(cluster: str | None = Query(None)):
    if not await unified_store.is_configured():
        return {"namespaces": ["default"]}

    cache_key = f"ns:{cluster or 'active'}"
    cached = await cache_service.get(cache_key)
    if cached:
        return cached

    try:
        svc = await _get_service(cluster)
        ns = await svc.get_namespaces()
        result = {"namespaces": ns}
        await cache_service.set(cache_key, result, ttl=cache_service.TTL_NAMESPACES)
        return result
    except Exception as e:
        return {"namespaces": ["default"], "error": str(e)}


@router.get("/k8s/pods")
async def list_pods(
    cluster: str | None = Query(None),
    namespace: str = Query("default"),
):
    cache_key = f"pods:{cluster or 'active'}:{namespace}"
    cached = await cache_service.get(cache_key)
    if cached:
        return cached

    svc = await _get_service(cluster)
    pods = await svc.get_pods(namespace)
    result = {"pods": pods, "namespace": namespace}
    await cache_service.set(cache_key, result, ttl=cache_service.TTL_PODS)
    return result


@router.get("/k8s/pod/logs")
async def pod_logs(
    pod: str,
    cluster: str | None = Query(None),
    namespace: str = Query("default"),
    lines: int = Query(200),
):
    svc = await _get_service(cluster)
    logs = await svc.get_pod_logs(namespace, pod, lines)
    return {"logs": logs, "pod": pod}


@router.get("/k8s/pod/events")
async def pod_events(
    pod: str,
    cluster: str | None = Query(None),
    namespace: str = Query("default"),
):
    svc = await _get_service(cluster)
    events = await svc.get_pod_events(namespace, pod)
    return {"events": events, "pod": pod}


@router.get("/k8s/nodes")
async def list_nodes(cluster: str | None = Query(None)):
    cache_key = f"nodes:{cluster or 'active'}"
    cached = await cache_service.get(cache_key)
    if cached:
        return cached

    try:
        svc = await _get_service(cluster)
        nodes = await svc.get_nodes()
        result = {"nodes": nodes}
        await cache_service.set(cache_key, result, ttl=cache_service.TTL_OVERVIEW)
        return result
    except Exception as e:
        return {"nodes": [], "error": str(e)}


@router.get("/k8s/events")
async def list_events(
    cluster: str | None = Query(None),
    namespace: str = Query("default"),
):
    try:
        svc = await _get_service(cluster)
        events = await svc.get_events(namespace)
        return {"events": events, "namespace": namespace}
    except Exception as e:
        return {"events": [], "error": str(e)}


@router.get("/k8s/overview")
async def cluster_overview(cluster: str | None = Query(None)):
    if not await unified_store.is_configured():
        return {
            "configured": False,
            "cluster_name": "none",
            "nodes": [],
            "pod_counts": {"running": 0, "pending": 0, "failed": 0, "total": 0},
            "warning_events": [],
        }

    cache_key = f"overview:{cluster or 'active'}"
    cached = await cache_service.get(cache_key)
    if cached:
        return cached

    try:
        svc = await _get_service(cluster)
        result = await svc.get_overview()
        await cache_service.set(cache_key, result, ttl=cache_service.TTL_OVERVIEW)
        return result
    except Exception as e:
        return {
            "configured": True,
            "error": str(e),
            "nodes": [],
            "pod_counts": {"running": 0, "pending": 0, "failed": 0, "total": 0},
            "warning_events": [],
        }


@router.get("/k8s/describe")
async def describe_resource(
    kind: str = Query("pod"),
    name: str = Query(...),
    namespace: str = Query("default"),
    cluster: str | None = Query(None),
):
    try:
        svc = await _get_service(cluster)
        result = await svc.run_kubectl_safe(["describe", f"{kind}/{name}", "-n", namespace])
        stdout = result.get("stdout", "") or ""
        stderr = result.get("stderr", "") or ""
        return {"output": stdout or stderr}
    except Exception as e:
        return {"output": "", "error": str(e)}


@router.get("/k8s/resources")
async def all_resources(
    cluster: str | None = Query(None),
    namespace: str = Query("default"),
):
    try:
        svc = await _get_service(cluster)
        result = await svc.get_all_resources(namespace)
        return result
    except Exception as e:
        return {"pods": [], "services": [], "deployments": [], "statefulsets": [], "daemonsets": [], "replicasets": [], "error": str(e)}


@router.get("/k8s/node-metrics")
async def node_metrics(cluster: str | None = Query(None)):
    try:
        svc = await _get_service(cluster)
        metrics = await svc.get_node_metrics()
        return {"metrics": metrics}
    except Exception as e:
        return {"metrics": [], "error": str(e)}


class KubectlRequest(BaseModel):
    cluster: str | None = None
    command: list[str]
    confirmed: bool = False


def _extract_namespace(cmd: list[str]) -> str:
    for i, part in enumerate(cmd):
        if part in ("-n", "--namespace") and i + 1 < len(cmd):
            return cmd[i + 1]
    return "default"


@router.post("/k8s/kubectl")
async def run_kubectl(body: KubectlRequest, request: Request):
    svc = await _get_service(body.cluster)
    namespace = _extract_namespace(body.command)

    async def generate():
        result = await svc.run_kubectl_safe(body.command)
        stdout = result.get("stdout", "") or ""
        stderr = result.get("stderr", "") or ""
        exit_code = result.get("exit_code", 0)

        if stdout:
            for line in stdout.splitlines():
                yield f"data: {json.dumps({'line': line, 'type': 'stdout'})}\n\n"
        if stderr:
            for line in stderr.splitlines():
                yield f"data: {json.dumps({'line': line, 'type': 'stderr'})}\n\n"
        yield f"data: {json.dumps({'done': True, 'exit_code': exit_code})}\n\n"

        # Audit log — never log stdout content, only hash
        output_hash = hashlib.sha256(stdout.encode()).hexdigest()
        cmd_display = body.command[:3]  # first 3 tokens only
        await audit_service.log(
            user_id=None,
            user_email="api",
            action="kubectl_execute",
            resource=f"{body.cluster or 'active'}:{' '.join(cmd_display)}",
            ip_address=request.client.host if request.client else "",
            status="success" if exit_code == 0 else "failed",
            details=json.dumps({
                "cluster": body.cluster,
                "command": cmd_display,
                "namespace": namespace,
                "exit_code": exit_code,
                "confirmed": body.confirmed,
                "output_lines": len(stdout.splitlines()),
                "output_hash": output_hash,
            }),
        )

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
