"""
Unified data store — uses PostgreSQL when DATABASE_URL is set, JSON file otherwise.
All functions are async for consistency.
"""
import logging
import os

logger = logging.getLogger(__name__)

_USE_DB = bool(os.getenv("DATABASE_URL"))


def _mask(value: str | None, visible: int = 4) -> str | None:
    if not value:
        return value
    if len(value) <= visible:
        return "***"
    return value[:visible] + "***"


def _mask_cluster(c: dict) -> dict:
    out = dict(c)
    if out.get("token"):
        out["token"] = _mask(out["token"])
    if out.get("kubeconfig"):
        out["kubeconfig"] = "***[kubeconfig]***"
    return out


# ─── DB helpers ──────────────────────────────────────────────────────────────

def _cluster_row_to_dict(c) -> dict:
    return {
        "name": c.name,
        "environment": c.environment,
        "connection_type": c.connection_type,
        "api_url": c.api_url or "",
        "token": c.token or "",
        "kubeconfig": c.kubeconfig or "",
        "active": c.is_active,
    }


async def _db_session():
    from db.database import AsyncSessionLocal
    if AsyncSessionLocal is None:
        return None
    return AsyncSessionLocal()


# ─── Public API ──────────────────────────────────────────────────────────────

async def list_clusters(masked: bool = False) -> list[dict]:
    if _USE_DB:
        from db.database import AsyncSessionLocal
        if AsyncSessionLocal:
            async with AsyncSessionLocal() as session:
                from db.repository import ClusterRepository
                repo = ClusterRepository(session)
                clusters = await repo.list_all()
                result = [_cluster_row_to_dict(c) for c in clusters]
                return [_mask_cluster(c) for c in result] if masked else result

    # JSON fallback
    from config.settings import load_config
    clusters = load_config().get("clusters", [])
    return [_mask_cluster(c) for c in clusters] if masked else clusters


async def get_cluster(name: str) -> dict | None:
    if _USE_DB:
        from db.database import AsyncSessionLocal
        if AsyncSessionLocal:
            async with AsyncSessionLocal() as session:
                from db.repository import ClusterRepository
                repo = ClusterRepository(session)
                c = await repo.get_by_name(name)
                return _cluster_row_to_dict(c) if c else None

    from config.settings import get_cluster as _json_get
    return _json_get(name)


async def get_active_cluster() -> dict | None:
    if _USE_DB:
        from db.database import AsyncSessionLocal
        if AsyncSessionLocal:
            async with AsyncSessionLocal() as session:
                from db.repository import ClusterRepository
                repo = ClusterRepository(session)
                c = await repo.get_active()
                return _cluster_row_to_dict(c) if c else None

    from config.settings import get_active_cluster as _json_active
    return _json_active()


async def is_configured() -> bool:
    clusters = await list_clusters()
    return bool(clusters)


async def create_cluster(data: dict) -> dict:
    if _USE_DB:
        from db.database import AsyncSessionLocal
        if AsyncSessionLocal:
            async with AsyncSessionLocal() as session:
                from db.repository import ClusterRepository
                repo = ClusterRepository(session)
                # If this is the first cluster, make it active
                existing = await repo.list_all()
                if not existing:
                    data["is_active"] = True
                db_data = {k: v for k, v in data.items()}
                if "active" in db_data:
                    db_data["is_active"] = db_data.pop("active")
                c = await repo.create(db_data)
                return _cluster_row_to_dict(c)

    # JSON fallback
    from config.settings import load_config, save_config
    cfg = load_config()
    clusters = cfg.get("clusters", [])
    if not clusters:
        data["active"] = True
    # Prevent duplicate names
    clusters = [c for c in clusters if c["name"] != data["name"]]
    clusters.append(data)
    cfg["clusters"] = clusters
    save_config(cfg)
    return data


async def update_cluster(name: str, updates: dict) -> dict | None:
    # Never overwrite token/kubeconfig with masked placeholders
    for field in ("token", "kubeconfig", "api_url"):
        val = updates.get(field, "")
        if val and ("***" in str(val) or val == ""):
            updates.pop(field, None)

    if _USE_DB:
        from db.database import AsyncSessionLocal
        if AsyncSessionLocal:
            async with AsyncSessionLocal() as session:
                from db.repository import ClusterRepository
                repo = ClusterRepository(session)
                db_updates = dict(updates)
                if "active" in db_updates:
                    db_updates["is_active"] = db_updates.pop("active")
                c = await repo.update(name, db_updates)
                return _cluster_row_to_dict(c) if c else None

    # JSON fallback
    from config.settings import load_config, save_config
    cfg = load_config()
    clusters = cfg.get("clusters", [])
    updated = None
    for i, c in enumerate(clusters):
        if c["name"] == name:
            clusters[i] = {**c, **updates}
            updated = clusters[i]
            break
    if updated:
        cfg["clusters"] = clusters
        save_config(cfg)
    return updated


async def delete_cluster(name: str) -> bool:
    if _USE_DB:
        from db.database import AsyncSessionLocal
        if AsyncSessionLocal:
            async with AsyncSessionLocal() as session:
                from db.repository import ClusterRepository
                repo = ClusterRepository(session)
                deleted = await repo.delete(name)
                if deleted:
                    # If we deleted the active cluster, activate the first remaining one
                    remaining = await repo.list_all()
                    if remaining and not any(c.is_active for c in remaining):
                        await repo.set_active(remaining[0].name)
                return deleted

    from config.settings import load_config, save_config
    cfg = load_config()
    clusters = cfg.get("clusters", [])
    new_clusters = [c for c in clusters if c["name"] != name]
    if len(new_clusters) == len(clusters):
        return False
    # If deleted was active, mark first as active
    if new_clusters and not any(c.get("active") for c in new_clusters):
        new_clusters[0]["active"] = True
    cfg["clusters"] = new_clusters
    save_config(cfg)
    return True


async def set_active_cluster(name: str) -> bool:
    if _USE_DB:
        from db.database import AsyncSessionLocal
        if AsyncSessionLocal:
            async with AsyncSessionLocal() as session:
                from db.repository import ClusterRepository
                repo = ClusterRepository(session)
                cluster = await repo.get_by_name(name)
                if not cluster:
                    return False
                await repo.set_active(name)
                return True

    from config.settings import load_config, save_config
    cfg = load_config()
    clusters = cfg.get("clusters", [])
    found = False
    for c in clusters:
        c["active"] = c["name"] == name
        if c["name"] == name:
            found = True
    if found:
        save_config(cfg)
    return found


async def get_platform_setting(key: str) -> str | None:
    if _USE_DB:
        from db.database import AsyncSessionLocal
        if AsyncSessionLocal:
            async with AsyncSessionLocal() as session:
                from db.repository import SettingsRepository
                repo = SettingsRepository(session)
                return await repo.get(key)

    from config.settings import load_config
    cfg = load_config()
    # Flatten nested config keys like "github.pat"
    if "." in key:
        section, field = key.split(".", 1)
        return cfg.get(section, {}).get(field)
    return cfg.get(key)


async def set_platform_setting(key: str, value: str) -> None:
    if _USE_DB:
        from db.database import AsyncSessionLocal
        if AsyncSessionLocal:
            async with AsyncSessionLocal() as session:
                from db.repository import SettingsRepository
                repo = SettingsRepository(session)
                await repo.set(key, value)
                return

    from config.settings import load_config, save_config
    cfg = load_config()
    if "." in key:
        section, field = key.split(".", 1)
        if section not in cfg:
            cfg[section] = {}
        cfg[section][field] = value
    else:
        cfg[key] = value
    save_config(cfg)


async def bulk_save_config(raw: dict) -> None:
    """Save entire platform config (used by onboarding wizard)."""
    if _USE_DB:
        from db.database import AsyncSessionLocal
        if AsyncSessionLocal:
            async with AsyncSessionLocal() as session:
                from db.repository import ClusterRepository, SettingsRepository
                cluster_repo = ClusterRepository(session)
                settings_repo = SettingsRepository(session)

                # Upsert clusters
                for cluster_data in raw.get("clusters", []):
                    existing = await cluster_repo.get_by_name(cluster_data["name"])
                    db_data = {k: v for k, v in cluster_data.items()}
                    if "active" in db_data:
                        db_data["is_active"] = db_data.pop("active")
                    if existing:
                        for k, v in db_data.items():
                            if hasattr(existing, k):
                                setattr(existing, k, v)
                    else:
                        session.add(__import__("db.models", fromlist=["Cluster"]).Cluster(**db_data))

                # Save platform settings
                for platform in ("github", "vault", "cloudflare", "argocd"):
                    if platform in raw:
                        for field, value in raw[platform].items():
                            if value:
                                await settings_repo.set(f"{platform}.{field}", str(value))

                if raw.get("selected_platforms"):
                    import json
                    await settings_repo.set(
                        "selected_platforms", json.dumps(raw["selected_platforms"])
                    )
                await session.commit()
            return

    # JSON fallback
    from config.settings import save_config
    save_config(raw)
