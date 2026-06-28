import logging

from fastapi import APIRouter
from pydantic import BaseModel

from config import settings, unified_store
from services.k8s_service import KubernetesService
from services.github_service import GitHubService
from services.vault_service import VaultService
from services.cloudflare_service import CloudflareService

logger = logging.getLogger(__name__)
router = APIRouter()


class ClusterInput(BaseModel):
    name: str
    environment: str
    connection_type: str
    api_url: str | None = None
    token: str | None = None
    kubeconfig: str | None = None
    active: bool = False


class PlatformConfigInput(BaseModel):
    clusters: list[ClusterInput] = []
    github: dict | None = None
    vault: dict | None = None
    cloudflare: dict | None = None
    argocd: dict | None = None
    selected_platforms: list[str] = []


@router.get("/platform/config")
async def get_config():
    clusters = await unified_store.list_clusters(masked=True)
    configured = bool(clusters)
    return {
        "configured": configured,
        "clusters": clusters,
        **settings.get_masked_config(),
    }


@router.post("/platform/config")
async def save_config(body: PlatformConfigInput):
    raw = body.model_dump(exclude_none=True)

    connections: dict[str, str] = {}

    # Test clusters
    for cluster in raw.get("clusters", []):
        try:
            svc = KubernetesService(cluster)
            result = await svc.health()
            connections[cluster["name"]] = "ok" if result["healthy"] else f"warn: {result.get('error', 'unreachable')}"
        except Exception as e:
            connections[cluster["name"]] = f"error: {e}"

    # Set first cluster as active if none are active
    clusters = raw.get("clusters", [])
    if clusters and not any(c.get("active") for c in clusters):
        clusters[0]["active"] = True

    # Test GitHub if provided
    if raw.get("github"):
        gh = GitHubService(
            pat=raw["github"].get("pat"),
            username=raw["github"].get("username"),
        )
        result = gh.validate()
        connections["github"] = "ok" if result["success"] else f"error: {result.get('error', 'auth failed')}"

    # Vault + Cloudflare are stubbed — always ok
    if raw.get("vault"):
        connections["vault"] = "ok (stubbed)"
    if raw.get("cloudflare"):
        connections["cloudflare"] = "ok (stubbed)"
    if raw.get("argocd"):
        connections["argocd"] = "ok (stubbed)"

    await unified_store.bulk_save_config(raw)
    logger.info("Platform config saved, connections: %s", {k: v for k, v in connections.items()})

    return {"saved": True, "connections": connections}


@router.post("/platform/test-cluster")
async def test_cluster(body: ClusterInput):
    try:
        svc = KubernetesService(body.model_dump())
        result = await svc.health()
        return result
    except Exception as e:
        return {"healthy": False, "configured": True, "cluster_name": body.name, "error": str(e)}


@router.post("/platform/test-github")
async def test_github(body: dict):
    gh = GitHubService(pat=body.get("pat"), username=body.get("username"))
    return gh.validate()


@router.post("/platform/test-vault")
async def test_vault(body: dict):
    vault = VaultService(body)
    return await vault.test_connection()


@router.post("/platform/test-cloudflare")
async def test_cloudflare(body: dict):
    cf = CloudflareService(body)
    return await cf.test_connection()


@router.delete("/platform/config")
async def reset_config():
    cfg_file = settings.CONFIG_FILE
    if cfg_file.exists():
        cfg_file.unlink()
    return {"reset": True}
