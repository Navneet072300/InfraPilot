"""
Optional Pixie eBPF telemetry integration.
If pxapi is not installed or Pixie is not deployed, everything degrades gracefully.
Never raises — returns empty data or is_available=False.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def _pxapi_available() -> bool:
    try:
        import pxapi  # noqa: F401
        return True
    except ImportError:
        return False


class PixieService:
    def __init__(self, api_key: str | None = None, cluster_id: str | None = None):
        self._api_key = api_key
        self._cluster_id = cluster_id

    @property
    def is_available(self) -> bool:
        return bool(_pxapi_available() and self._api_key and self._cluster_id)

    async def get_pod_traces(
        self,
        namespace: str,
        pod_name: str,
        duration_seconds: int = 120,
    ) -> dict[str, Any]:
        """Return eBPF trace summary for a pod. Empty dict if Pixie unavailable."""
        if not self.is_available:
            return {}
        try:
            import asyncio
            return await asyncio.to_thread(self._fetch_traces, namespace, pod_name, duration_seconds)
        except Exception as e:
            logger.debug("Pixie get_pod_traces error: %s", e)
            return {}

    def _fetch_traces(self, namespace: str, pod_name: str, duration_seconds: int) -> dict:
        try:
            import pxapi
            px = pxapi.Client(api_key=self._api_key)
            conn = px.connect_to_cluster(self._cluster_id)

            script = f"""
import px
df = px.DataFrame(table='http_events', start_time='-{duration_seconds}s')
df = df[df.ctx['pod'] == '{namespace}/{pod_name}']
df.latency_ms = df.latency / 1e6
df = df.groupby(['req_path', 'resp_status']).agg(
    count=('latency_ms', px.count),
    p50_ms=('latency_ms', px.quantiles(0.5)),
    p99_ms=('latency_ms', px.quantiles(0.99)),
    error_rate=('resp_status', lambda s: px.mean(s >= 400))
)
px.display(df, 'http_summary')
"""
            results = conn.run_script(script, pxapi.TableSub("http_summary"))
            rows = []
            for table in results:
                for row in table:
                    rows.append({
                        "path": row["req_path"],
                        "status": row["resp_status"],
                        "count": row["count"],
                        "p50_ms": round(row["p50_ms"], 1),
                        "p99_ms": round(row["p99_ms"], 1),
                        "error_rate": round(row["error_rate"], 3),
                    })

            # TCP error summary
            tcp_script = f"""
import px
df = px.DataFrame(table='tcp_events', start_time='-{duration_seconds}s')
df = df[df.ctx['pod'] == '{namespace}/{pod_name}']
df = df.groupby(['remote_addr']).agg(retransmits=('retransmits', px.sum))
df = df[df.retransmits > 0]
px.display(df, 'tcp_errors')
"""
            tcp_rows = []
            try:
                tcp_results = conn.run_script(tcp_script, pxapi.TableSub("tcp_errors"))
                for table in tcp_results:
                    for row in table:
                        tcp_rows.append({"remote": row["remote_addr"], "retransmits": row["retransmits"]})
            except Exception:
                pass

            return {
                "http_summary": rows,
                "tcp_errors": tcp_rows,
                "pod": pod_name,
                "namespace": namespace,
                "duration_seconds": duration_seconds,
            }
        except Exception as e:
            logger.debug("Pixie _fetch_traces error: %s", e)
            return {}

    def format_for_prompt(self, traces: dict) -> str:
        """Convert trace data to a compact text block for the AI diagnosis prompt."""
        if not traces:
            return ""
        lines = ["--- eBPF Telemetry (Pixie) ---"]
        for row in (traces.get("http_summary") or [])[:10]:
            lines.append(
                f"  {row.get('path', '?')} status={row.get('status', '?')} "
                f"count={row.get('count', 0)} p99={row.get('p99_ms', 0)}ms "
                f"err_rate={row.get('error_rate', 0):.1%}"
            )
        for row in (traces.get("tcp_errors") or [])[:5]:
            lines.append(f"  TCP retransmits to {row.get('remote', '?')}: {row.get('retransmits', 0)}")
        lines.append("--- End eBPF Telemetry ---")
        return "\n".join(lines)
