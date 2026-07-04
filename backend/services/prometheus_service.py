import os
import time
import logging
import httpx

logger = logging.getLogger(__name__)

PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus:9090")


async def query_range(
    user_id: int,
    query: str,
    start: float,
    end: float,
    step: str = "60s",
) -> dict:
    """Run a PromQL range query, always injecting {infrapilot_user="<user_id>"} label filter."""
    wrapped = f'{query}{{infrapilot_user="{user_id}"}}'
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(
                f"{PROMETHEUS_URL}/api/v1/query_range",
                params={"query": wrapped, "start": start, "end": end, "step": step},
            )
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            logger.warning("Prometheus query_range failed: %s", exc)
            return {"status": "error", "error": str(exc), "data": {"resultType": "matrix", "result": []}}


async def get_cluster_metrics(user_id: int, cluster_name: str, time_range: str = "1h") -> dict:
    """Return CPU, memory, restarts, and pod status metrics for a cluster."""
    now = time.time()
    range_seconds = {"1h": 3600, "6h": 21600, "24h": 86400, "7d": 604800}.get(time_range, 3600)
    start = now - range_seconds

    cpu_result = await query_range(
        user_id,
        f'sum(rate(container_cpu_usage_seconds_total{{cluster="{cluster_name}"}}[5m])) by (namespace)',
        start, now,
    )
    mem_result = await query_range(
        user_id,
        f'sum(container_memory_working_set_bytes{{cluster="{cluster_name}"}}) by (namespace)',
        start, now,
    )
    restart_result = await query_range(
        user_id,
        f'sum(increase(kube_pod_container_status_restarts_total{{cluster="{cluster_name}"}}[1h])) by (namespace)',
        start, now,
    )
    pod_result = await query_range(
        user_id,
        f'sum(kube_pod_status_phase{{cluster="{cluster_name}"}}) by (phase)',
        start, now,
    )

    return {
        "cpu":        cpu_result.get("data", {}).get("result", []),
        "memory":     mem_result.get("data", {}).get("result", []),
        "restarts":   restart_result.get("data", {}).get("result", []),
        "pod_status": pod_result.get("data", {}).get("result", []),
    }


async def add_cluster(user_id: int, cluster_name: str, prometheus_url: str | None = None) -> None:
    """Register a scrape target (no-op for external Prometheus; tracked internally)."""
    logger.info("Prometheus: add_cluster user=%s cluster=%s", user_id, cluster_name)


async def remove_cluster(user_id: int, cluster_name: str) -> None:
    """De-register a scrape target."""
    logger.info("Prometheus: remove_cluster user=%s cluster=%s", user_id, cluster_name)
