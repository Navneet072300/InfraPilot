"""
Z-score anomaly detection for cluster metrics.
Uses a 7-day rolling window stored in metric_history table.

Rules:
- Minimum 20 data points required before firing (grace period for new resources).
- One anomaly incident per resource+metric per 4-hour window (deduplication).
- Z-score threshold: 2.5
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timezone

import sqlalchemy

from db.database import get_session, is_db_available

logger = logging.getLogger(__name__)

Z_THRESHOLD = 2.5
MIN_POINTS = 20
DEDUP_HOURS = 4


async def record_metric(
    cluster_name: str,
    resource_name: str,
    namespace: str,
    metric_name: str,
    value: float,
) -> None:
    """Insert a new metric data point. Old rows (>7 days) are cleaned up periodically."""
    if not is_db_available():
        return
    try:
        async with get_session() as db:
            await db.execute(
                sqlalchemy.text(
                    "INSERT INTO metric_history (cluster_name, resource_name, namespace, metric_name, value) "
                    "VALUES (:cluster, :resource, :ns, :metric, :value)"
                ),
                {
                    "cluster": cluster_name,
                    "resource": resource_name,
                    "ns": namespace,
                    "metric": metric_name,
                    "value": value,
                },
            )
            await db.commit()
    except Exception as e:
        logger.debug("record_metric error: %s", e)


async def check_anomaly(
    cluster_name: str,
    resource_name: str,
    namespace: str,
    metric_name: str,
    current_value: float,
) -> dict | None:
    """
    Returns anomaly dict if current_value is anomalous, else None.
    Dict: {cluster, resource, namespace, metric, value, z_score, mean, stddev}
    """
    if not is_db_available():
        return None
    try:
        async with get_session() as db:
            rows = (await db.execute(
                sqlalchemy.text(
                    "SELECT value FROM metric_history "
                    "WHERE cluster_name = :cluster AND resource_name = :resource "
                    "AND namespace = :ns AND metric_name = :metric "
                    "AND recorded_at > NOW() - INTERVAL '7 days' "
                    "ORDER BY recorded_at DESC LIMIT 1000"
                ),
                {
                    "cluster": cluster_name,
                    "resource": resource_name,
                    "ns": namespace,
                    "metric": metric_name,
                },
            )).fetchall()

        values = [r[0] for r in rows]
        if len(values) < MIN_POINTS:
            return None

        mean = sum(values) / len(values)
        variance = sum((v - mean) ** 2 for v in values) / len(values)
        stddev = math.sqrt(variance)

        if stddev < 1e-9:
            return None  # constant metric — no meaningful z-score

        z = abs(current_value - mean) / stddev
        if z < Z_THRESHOLD:
            return None

        return {
            "cluster": cluster_name,
            "resource": resource_name,
            "namespace": namespace,
            "metric": metric_name,
            "value": current_value,
            "z_score": round(z, 2),
            "mean": round(mean, 2),
            "stddev": round(stddev, 2),
            "n_points": len(values),
        }
    except Exception as e:
        logger.debug("check_anomaly error: %s", e)
        return None


async def cleanup_old_metrics() -> None:
    """Hourly cleanup: delete metric_history rows older than 7 days."""
    if not is_db_available():
        return
    try:
        async with get_session() as db:
            result = await db.execute(
                sqlalchemy.text(
                    "DELETE FROM metric_history WHERE recorded_at < NOW() - INTERVAL '7 days'"
                )
            )
            await db.commit()
            if result.rowcount:
                logger.info("Anomaly detector: pruned %d old metric rows", result.rowcount)
    except Exception as e:
        logger.debug("cleanup_old_metrics error: %s", e)
