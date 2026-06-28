import json
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

CONFIG_FILE = Path(os.getenv("CONFIG_FILE", "config/platforms.json"))


def _mask(value: str | None, visible: int = 4) -> str | None:
    if not value:
        return value
    if len(value) <= visible:
        return "***"
    return value[:visible] + "***"


def _mask_cluster(c: dict) -> dict:
    out = {k: v for k, v in c.items()}
    if "token" in out:
        out["token"] = _mask(out["token"])
    if "kubeconfig" in out:
        out["kubeconfig"] = "***[kubeconfig]***"
    return out


def load_config() -> dict:
    if not CONFIG_FILE.exists():
        return {}
    try:
        return json.loads(CONFIG_FILE.read_text())
    except Exception as e:
        logger.error("Failed to load config: %s", e)
        return {}


def save_config(config: dict) -> None:
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(config, indent=2))
    logger.info("Platform config saved (credentials not logged)")


def is_configured() -> bool:
    cfg = load_config()
    return bool(cfg.get("clusters"))


def get_cluster(name: str) -> dict | None:
    cfg = load_config()
    for c in cfg.get("clusters", []):
        if c["name"] == name:
            return c
    return None


def get_active_cluster() -> dict | None:
    cfg = load_config()
    clusters = cfg.get("clusters", [])
    for c in clusters:
        if c.get("active"):
            return c
    return clusters[0] if clusters else None


def get_masked_config() -> dict:
    cfg = load_config()
    out: dict[str, Any] = {}

    if "clusters" in cfg:
        out["clusters"] = [_mask_cluster(c) for c in cfg["clusters"]]

    for platform in ("github", "vault", "cloudflare", "argocd"):
        if platform in cfg:
            p = dict(cfg[platform])
            for key in ("pat", "token", "password", "api_key", "kubeconfig"):
                if key in p:
                    p[key] = _mask(str(p[key]))
            p["configured"] = True
            out[platform] = p

    out["selected_platforms"] = cfg.get("selected_platforms", [])
    out["configured"] = is_configured()
    return out
