import logging
import os
from datetime import datetime, timedelta, timezone

import httpx

logger = logging.getLogger(__name__)

GRAFANA_URL = os.getenv("GRAFANA_URL", "http://grafana:3000")
GRAFANA_ADMIN_USER = os.getenv("GRAFANA_ADMIN_USER", "admin")
GRAFANA_ADMIN_PASSWORD = os.getenv("GRAFANA_ADMIN_PASSWORD", "admin")
PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus:9090")

_DEFAULT_DASHBOARD = {
    "id": None,
    "title": "InfraPilot Cluster Overview",
    "tags": ["infrapilot"],
    "timezone": "browser",
    "refresh": "30s",
    "time": {"from": "now-1h", "to": "now"},
    "panels": [
        {
            "id": 1, "type": "graph", "title": "CPU Usage",
            "gridPos": {"h": 8, "w": 12, "x": 0, "y": 0},
            "targets": [{"expr": 'sum(rate(container_cpu_usage_seconds_total[5m])) by (namespace)', "refId": "A"}],
        },
        {
            "id": 2, "type": "graph", "title": "Memory Usage",
            "gridPos": {"h": 8, "w": 12, "x": 12, "y": 0},
            "targets": [{"expr": 'sum(container_memory_working_set_bytes) by (namespace)', "refId": "A"}],
        },
        {
            "id": 3, "type": "stat", "title": "Pod Restarts",
            "gridPos": {"h": 4, "w": 8, "x": 0, "y": 8},
            "targets": [{"expr": 'sum(increase(kube_pod_container_status_restarts_total[1h]))', "refId": "A"}],
        },
        {
            "id": 4, "type": "piechart", "title": "Pod Status",
            "gridPos": {"h": 4, "w": 8, "x": 8, "y": 8},
            "targets": [{"expr": 'sum(kube_pod_status_phase) by (phase)', "refId": "A"}],
        },
    ],
}


def _admin_auth() -> tuple[str, str]:
    return (GRAFANA_ADMIN_USER, GRAFANA_ADMIN_PASSWORD)


async def setup_user(user_id: int) -> dict:
    """Create Grafana org + Prometheus datasource + default dashboard for user.

    Returns {"org_id": int, "dashboard_uid": str}.
    """
    async with httpx.AsyncClient(base_url=GRAFANA_URL, auth=_admin_auth(), timeout=15) as client:
        org_name = f"infrapilot-user-{user_id}"

        # Create or find org
        r = await client.post("/api/orgs", json={"name": org_name})
        if r.status_code == 200:
            org_id: int = r.json()["orgId"]
        elif r.status_code == 409:
            r2 = await client.get(f"/api/orgs/name/{org_name}")
            r2.raise_for_status()
            org_id = r2.json()["id"]
        else:
            r.raise_for_status()
            org_id = r.json()["orgId"]

        headers = {"X-Grafana-Org-Id": str(org_id)}

        # Provision Prometheus datasource (idempotent)
        await client.post(
            "/api/datasources",
            json={
                "name": "Prometheus",
                "type": "prometheus",
                "url": PROMETHEUS_URL,
                "access": "proxy",
                "isDefault": True,
            },
            headers=headers,
        )

        # Provision default dashboard
        dr = await client.post(
            "/api/dashboards/db",
            json={"dashboard": _DEFAULT_DASHBOARD, "overwrite": True, "folderId": 0},
            headers=headers,
        )
        dashboard_uid: str = dr.json().get("uid", "")
        logger.info("Grafana: setup_user user=%s org_id=%s dashboard=%s", user_id, org_id, dashboard_uid)
        return {"org_id": org_id, "dashboard_uid": dashboard_uid}


async def get_embed_url(user_id: int, org_id: int, dashboard_uid: str) -> dict:
    """Create a 1-hour service account token and return the Grafana embed URL.

    Returns {"embed_url": str, "token": str, "expires_at": str (ISO)}.
    """
    async with httpx.AsyncClient(base_url=GRAFANA_URL, auth=_admin_auth(), timeout=15) as client:
        headers = {"X-Grafana-Org-Id": str(org_id)}
        sa_name = f"ip-embed-{user_id}"

        # Create or find service account
        sa_r = await client.post("/api/serviceaccounts", json={"name": sa_name, "role": "Viewer"}, headers=headers)
        if sa_r.status_code in (200, 201):
            sa_id: int = sa_r.json()["id"]
        elif sa_r.status_code == 409:
            search_r = await client.get("/api/serviceaccounts/search?perpage=100", headers=headers)
            accounts = search_r.json().get("serviceAccounts", [])
            sa_id = next((s["id"] for s in accounts if s["name"] == sa_name), None)
            if sa_id is None:
                raise RuntimeError(f"Cannot find or create Grafana service account: {sa_name}")
        else:
            sa_r.raise_for_status()
            sa_id = sa_r.json()["id"]

        # Create token with 1-hour TTL
        token_name = f"embed-{int(datetime.now(timezone.utc).timestamp())}"
        token_r = await client.post(
            f"/api/serviceaccounts/{sa_id}/tokens",
            json={"name": token_name, "role": "Viewer", "secondsToLive": 3600},
            headers=headers,
        )
        token: str = token_r.json().get("key", "")

        expires_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        embed_url = (
            f"{GRAFANA_URL}/d/{dashboard_uid}"
            f"?orgId={org_id}&kiosk=tv&from=now-1h&to=now&refresh=30s"
        )
        return {"embed_url": embed_url, "token": token, "expires_at": expires_at}


async def teardown_user(user_id: int, org_id: int) -> None:
    """Delete the Grafana org and all its resources."""
    async with httpx.AsyncClient(base_url=GRAFANA_URL, auth=_admin_auth(), timeout=10) as client:
        r = await client.delete(f"/api/orgs/{org_id}")
        if r.is_success:
            logger.info("Grafana: teardown_user user=%s org_id=%s", user_id, org_id)
        else:
            logger.warning("Grafana teardown failed for org %s: %s", org_id, r.text)
