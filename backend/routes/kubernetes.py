import json
import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import unified_store
from services import cache_service
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


@router.post("/k8s/kubectl")
async def run_kubectl(body: KubectlRequest):
    svc = await _get_service(body.cluster)

    async def generate():
        result = await svc.run_kubectl_safe(body.command)
        if result["stdout"]:
            for line in result["stdout"].splitlines():
                data = json.dumps({"line": line, "type": "stdout"})
                yield f"data: {data}\n\n"
        if result["stderr"]:
            for line in result["stderr"].splitlines():
                data = json.dumps({"line": line, "type": "stderr"})
                yield f"data: {data}\n\n"
        yield f"data: {json.dumps({'done': True, 'exit_code': result['exit_code']})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
