import asyncio
import json as _json
import logging
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)


def _compute_age(timestamp: str) -> str:
    if not timestamp:
        return ""
    try:
        created = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        diff = datetime.now(timezone.utc) - created
        s = int(diff.total_seconds())
        if s < 60:
            return f"{s}s"
        if s < 3600:
            return f"{s // 60}m"
        if s < 86400:
            return f"{s // 3600}h"
        return f"{s // 86400}d"
    except Exception:
        return timestamp

# Safe kubectl command whitelist
KUBECTL_ALLOWED = {
    "get", "describe", "logs", "rollout", "apply", "top", "version", "cluster-info",
}


class KubernetesService:
    def __init__(self, cluster_config: dict):
        self.cluster_name = cluster_config["name"]
        self._cfg = cluster_config
        self._kubeconfig_path: str | None = None

    def _setup_kubeconfig(self) -> str:
        """Write kubeconfig to temp file and return path."""
        if self._kubeconfig_path and Path(self._kubeconfig_path).exists():
            return self._kubeconfig_path

        if self._cfg.get("connection_type") == "kubeconfig":
            raw = self._cfg.get("kubeconfig", "")
            tf = tempfile.NamedTemporaryFile(
                mode="w", suffix=".yaml", delete=False, prefix="infrapilot_"
            )
            tf.write(raw)
            tf.flush()
            tf.close()
            self._kubeconfig_path = tf.name
        elif self._cfg.get("connection_type") == "token":
            api_url = self._cfg["api_url"].rstrip("/")
            token = self._cfg["token"]
            kubeconfig = {
                "apiVersion": "v1",
                "kind": "Config",
                "clusters": [
                    {
                        "name": self.cluster_name,
                        "cluster": {
                            "server": api_url,
                            "insecure-skip-tls-verify": True,
                        },
                    }
                ],
                "users": [
                    {
                        "name": "infrapilot",
                        "user": {"token": token},
                    }
                ],
                "contexts": [
                    {
                        "name": self.cluster_name,
                        "context": {
                            "cluster": self.cluster_name,
                            "user": "infrapilot",
                        },
                    }
                ],
                "current-context": self.cluster_name,
            }
            tf = tempfile.NamedTemporaryFile(
                mode="w", suffix=".yaml", delete=False, prefix="infrapilot_"
            )
            yaml.dump(kubeconfig, tf)
            tf.flush()
            tf.close()
            self._kubeconfig_path = tf.name
        else:
            raise ValueError(f"Unknown connection_type: {self._cfg.get('connection_type')}")

        return self._kubeconfig_path

    async def _kubectl(self, args: list[str], timeout: int = 30) -> dict:
        kubeconfig = self._setup_kubeconfig()
        cmd = ["kubectl", "--kubeconfig", kubeconfig] + args
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=timeout
            )
            return {
                "stdout": stdout.decode(),
                "stderr": stderr.decode(),
                "exit_code": proc.returncode,
            }
        except asyncio.TimeoutError:
            return {"stdout": "", "stderr": f"kubectl timed out after {timeout}s", "exit_code": 1}
        except FileNotFoundError:
            return {"stdout": "", "stderr": "kubectl not found in PATH", "exit_code": 127}

    async def health(self) -> dict:
        try:
            result = await self._kubectl(["version", "-o", "json"], timeout=8)
            if result["exit_code"] == 0:
                nodes_result = await self._kubectl(
                    ["get", "nodes", "--no-headers", "-o", "custom-columns=NAME:.metadata.name"]
                )
                node_count = len(
                    [l for l in nodes_result["stdout"].strip().splitlines() if l]
                )
                version = ""
                try:
                    import json as _json
                    ver_data = _json.loads(result["stdout"])
                    sv = ver_data.get("serverVersion", {})
                    version = sv.get("gitVersion", "")
                except Exception:
                    pass
                return {
                    "healthy": True,
                    "configured": True,
                    "node_count": node_count,
                    "version": version,
                    "cluster_name": self.cluster_name,
                }
            return {
                "healthy": False,
                "configured": True,
                "cluster_name": self.cluster_name,
                "error": result["stderr"][:200],
            }
        except Exception as e:
            return {
                "healthy": False,
                "configured": True,
                "cluster_name": self.cluster_name,
                "error": str(e),
            }

    async def get_namespaces(self) -> list[str]:
        result = await self._kubectl([
            "get", "namespaces", "-o",
            "custom-columns=NAME:.metadata.name", "--no-headers"
        ])
        if result["exit_code"] != 0:
            return ["default"]
        return [l for l in result["stdout"].strip().splitlines() if l]

    async def get_pods(self, namespace: str = "default") -> list[dict]:
        result = await self._kubectl(["get", "pods", "-n", namespace, "-o", "json"])
        if result["exit_code"] != 0:
            return []
        try:
            data = _json.loads(result["stdout"])
            pods = []
            for item in data.get("items", []):
                meta = item.get("metadata", {})
                spec = item.get("spec", {})
                status = item.get("status", {})
                container_statuses = status.get("containerStatuses", [])
                containers = spec.get("containers", [])
                ready_count = sum(1 for cs in container_statuses if cs.get("ready", False))
                total_count = len(containers)
                restarts = sum(cs.get("restartCount", 0) for cs in container_statuses)
                # Determine detailed status (mirrors kubectl logic)
                phase = status.get("phase", "Unknown")
                pod_status = phase
                for cs in container_statuses:
                    st = cs.get("state", {})
                    if "waiting" in st:
                        reason = st["waiting"].get("reason", "")
                        if reason:
                            pod_status = reason
                            break
                    elif "terminated" in st:
                        reason = st["terminated"].get("reason", "")
                        if reason and reason != "Completed":
                            pod_status = reason
                            break
                pods.append({
                    "name": meta.get("name", ""),
                    "namespace": namespace,
                    "ready": f"{ready_count}/{total_count}",
                    "status": pod_status,
                    "restarts": restarts,
                    "age": _compute_age(meta.get("creationTimestamp", "")),
                    "image": containers[0].get("image", "") if containers else "",
                    "node": spec.get("nodeName", ""),
                })
            return pods
        except Exception as e:
            logger.warning("get_pods JSON parse error: %s", e)
            return []

    async def _get_resources_json(self, kind: str, namespace: str) -> list[dict]:
        result = await self._kubectl(["get", kind, "-n", namespace, "-o", "json"])
        if result["exit_code"] != 0:
            return []
        try:
            data = _json.loads(result["stdout"])
            items = []
            for item in data.get("items", []):
                meta = item.get("metadata", {})
                spec = item.get("spec", {})
                status = item.get("status", {})
                kind_name = item.get("kind", "")
                base = {
                    "name": meta.get("name", ""),
                    "namespace": meta.get("namespace", namespace),
                    "age": _compute_age(meta.get("creationTimestamp", "")),
                    "kind": kind_name,
                }
                if kind_name == "Service":
                    ports = []
                    for p in spec.get("ports", []):
                        s = str(p.get("port", ""))
                        if p.get("nodePort"):
                            s += f":{p['nodePort']}"
                        s += f"/{p.get('protocol', 'TCP')}"
                        ports.append(s)
                    ingress = status.get("loadBalancer", {}).get("ingress", [])
                    ext = ingress[0].get("ip") or ingress[0].get("hostname") if ingress else "<none>"
                    base.update({
                        "type": spec.get("type", "ClusterIP"),
                        "cluster_ip": spec.get("clusterIP", "<none>"),
                        "external_ip": ext or "<none>",
                        "ports": ", ".join(ports) or "<none>",
                    })
                elif kind_name == "Deployment":
                    desired = spec.get("replicas", 0)
                    base.update({
                        "ready": f"{status.get('readyReplicas', 0)}/{desired}",
                        "up_to_date": status.get("updatedReplicas", 0),
                        "available": status.get("availableReplicas", 0),
                    })
                elif kind_name == "ReplicaSet":
                    desired = spec.get("replicas", 0)
                    base.update({
                        "desired": desired,
                        "current": status.get("replicas", 0),
                        "ready": status.get("readyReplicas", 0),
                    })
                elif kind_name == "StatefulSet":
                    desired = spec.get("replicas", 0)
                    base.update({
                        "ready": f"{status.get('readyReplicas', 0)}/{desired}",
                    })
                elif kind_name == "DaemonSet":
                    base.update({
                        "desired": status.get("desiredNumberScheduled", 0),
                        "current": status.get("currentNumberScheduled", 0),
                        "ready": status.get("numberReady", 0),
                        "up_to_date": status.get("updatedNumberScheduled", 0),
                        "available": status.get("numberAvailable", 0),
                    })
                items.append(base)
            return items
        except Exception as e:
            logger.warning("_get_resources_json(%s) error: %s", kind, e)
            return []

    async def get_all_resources(self, namespace: str = "default") -> dict:
        """Equivalent of kubectl get all -n namespace."""
        results = await asyncio.gather(
            self._kubectl(["get", "pods", "-n", namespace, "-o", "json"]),
            self._get_resources_json("services", namespace),
            self._get_resources_json("deployments.apps", namespace),
            self._get_resources_json("statefulsets.apps", namespace),
            self._get_resources_json("daemonsets.apps", namespace),
            self._get_resources_json("replicasets.apps", namespace),
            return_exceptions=True,
        )

        def safe(r):
            return r if isinstance(r, list) else []

        # Pods come from raw JSON result (first item)
        pods_raw = results[0]
        pods: list[dict] = []
        if isinstance(pods_raw, dict) and pods_raw.get("exit_code") == 0:
            try:
                parsed = _json.loads(pods_raw["stdout"])
                for item in parsed.get("items", []):
                    meta = item.get("metadata", {})
                    spec = item.get("spec", {})
                    status = item.get("status", {})
                    container_statuses = status.get("containerStatuses", [])
                    containers = spec.get("containers", [])
                    ready_count = sum(1 for cs in container_statuses if cs.get("ready", False))
                    restarts = sum(cs.get("restartCount", 0) for cs in container_statuses)
                    phase = status.get("phase", "Unknown")
                    pod_status = phase
                    for cs in container_statuses:
                        st = cs.get("state", {})
                        if "waiting" in st:
                            reason = st["waiting"].get("reason", "")
                            if reason:
                                pod_status = reason
                                break
                        elif "terminated" in st:
                            reason = st["terminated"].get("reason", "")
                            if reason and reason != "Completed":
                                pod_status = reason
                                break
                    pods.append({
                        "name": meta.get("name", ""),
                        "namespace": namespace,
                        "ready": f"{ready_count}/{len(containers)}",
                        "status": pod_status,
                        "restarts": restarts,
                        "age": _compute_age(meta.get("creationTimestamp", "")),
                        "node": spec.get("nodeName", ""),
                        "kind": "Pod",
                    })
            except Exception:
                pass

        return {
            "pods": pods,
            "services": safe(results[1]),
            "deployments": safe(results[2]),
            "statefulsets": safe(results[3]),
            "daemonsets": safe(results[4]),
            "replicasets": safe(results[5]),
        }

    async def get_node_metrics(self) -> list[dict]:
        """kubectl top nodes — requires metrics-server."""
        result = await self._kubectl(["top", "nodes", "--no-headers"])
        if result["exit_code"] != 0:
            return []
        metrics = []
        for line in result["stdout"].strip().splitlines():
            parts = line.split()
            if len(parts) >= 5:
                metrics.append({
                    "name": parts[0],
                    "cpu_cores": parts[1],
                    "cpu_percent": parts[2].rstrip("%"),
                    "memory_bytes": parts[3],
                    "memory_percent": parts[4].rstrip("%"),
                })
        return metrics

    async def get_pod_logs(self, namespace: str, pod_name: str, lines: int = 200) -> str:
        result = await self._kubectl([
            "logs", pod_name, "-n", namespace,
            f"--tail={lines}", "--timestamps=false"
        ], timeout=15)
        if result["exit_code"] != 0:
            prev_result = await self._kubectl([
                "logs", pod_name, "-n", namespace,
                f"--tail={lines}", "--previous"
            ], timeout=15)
            if prev_result["exit_code"] == 0:
                return f"[Previous container logs]\n{prev_result['stdout']}"
            return result["stderr"] or "No logs available"
        return result["stdout"]

    async def get_pod_events(self, namespace: str, pod_name: str) -> list[dict]:
        result = await self._kubectl([
            "get", "events", "-n", namespace,
            "--field-selector", f"involvedObject.name={pod_name}",
            "--sort-by=.lastTimestamp",
            "-o", "custom-columns="
            "TIME:.lastTimestamp,"
            "TYPE:.type,"
            "REASON:.reason,"
            "MESSAGE:.message",
            "--no-headers",
        ])
        events = []
        for line in result["stdout"].strip().splitlines():
            if not line:
                continue
            parts = line.split(None, 3)
            events.append({
                "time": parts[0] if len(parts) > 0 else "",
                "type": parts[1] if len(parts) > 1 else "",
                "reason": parts[2] if len(parts) > 2 else "",
                "message": parts[3] if len(parts) > 3 else "",
            })
        return events

    async def get_nodes(self) -> list[dict]:
        import json as _json
        result = await self._kubectl([
            "get", "nodes",
            "-o", "json",
        ])
        if result["exit_code"] != 0:
            return []
        try:
            data = _json.loads(result["stdout"])
            nodes = []
            for item in data.get("items", []):
                meta = item.get("metadata", {})
                spec = item.get("spec", {})
                status = item.get("status", {})
                conditions = status.get("conditions", [])
                ready = next(
                    (c["status"] == "True" for c in conditions if c["type"] == "Ready"),
                    False,
                )
                labels = meta.get("labels", {})
                roles = [
                    k.split("/")[1]
                    for k in labels
                    if k.startswith("node-role.kubernetes.io/")
                ]
                capacity = status.get("capacity", {})
                nodes.append({
                    "name": meta.get("name", ""),
                    "status": "Ready" if ready else "NotReady",
                    "roles": roles or ["<none>"],
                    "version": status.get("nodeInfo", {}).get("kubeletVersion", ""),
                    "age": meta.get("creationTimestamp", ""),
                    "cpu_capacity": capacity.get("cpu", ""),
                    "memory_capacity": capacity.get("memory", ""),
                    "os": status.get("nodeInfo", {}).get("osImage", ""),
                })
            return nodes
        except Exception:
            return []

    async def get_events(self, namespace: str = "default") -> list[dict]:
        import json as _json
        result = await self._kubectl([
            "get", "events", "-n", namespace,
            "--sort-by=.lastTimestamp",
            "-o", "json",
        ])
        if result["exit_code"] != 0:
            return []
        try:
            data = _json.loads(result["stdout"])
            events = []
            for item in data.get("items", []):
                meta = item.get("metadata", {})
                involved = item.get("involvedObject", {})
                events.append({
                    "name": meta.get("name", ""),
                    "namespace": meta.get("namespace", namespace),
                    "type": item.get("type", "Normal"),
                    "reason": item.get("reason", ""),
                    "message": item.get("message", ""),
                    "object": f"{involved.get('kind','')}/{involved.get('name','')}",
                    "count": item.get("count", 1),
                    "first_time": item.get("firstTimestamp", ""),
                    "last_time": item.get("lastTimestamp", ""),
                })
            return events
        except Exception:
            return []

    async def get_overview(self) -> dict:
        nodes_result, pods_result, events_result = await asyncio.gather(
            self._kubectl(["get", "nodes", "--no-headers"]),
            self._kubectl(["get", "pods", "-A", "--no-headers"]),
            self._kubectl([
                "get", "events", "-A", "--field-selector", "type=Warning",
                "--sort-by=.lastTimestamp", "--no-headers",
            ]),
        )
        nodes = []
        for line in nodes_result["stdout"].strip().splitlines():
            parts = line.split()
            if parts:
                nodes.append({
                    "name": parts[0],
                    "status": parts[1] if len(parts) > 1 else "Unknown",
                    "roles": parts[2] if len(parts) > 2 else "",
                    "age": parts[3] if len(parts) > 3 else "",
                    "version": parts[4] if len(parts) > 4 else "",
                })

        pod_counts = {"running": 0, "pending": 0, "failed": 0, "total": 0}
        for line in pods_result["stdout"].strip().splitlines():
            parts = line.split()
            if len(parts) > 3:
                status = parts[3].lower()
                pod_counts["total"] += 1
                if "running" in status:
                    pod_counts["running"] += 1
                elif "pending" in status:
                    pod_counts["pending"] += 1
                elif "error" in status or "crash" in status or "fail" in status:
                    pod_counts["failed"] += 1

        warning_events = []
        for line in events_result["stdout"].strip().splitlines()[-20:]:
            parts = line.split(None, 4)
            if parts:
                warning_events.append({
                    "namespace": parts[0] if len(parts) > 0 else "",
                    "reason": parts[2] if len(parts) > 2 else "",
                    "message": parts[4] if len(parts) > 4 else "",
                })

        return {
            "cluster_name": self.cluster_name,
            "nodes": nodes,
            "pod_counts": pod_counts,
            "warning_events": warning_events,
        }

    async def run_kubectl_safe(self, args: list[str]) -> dict:
        """Run kubectl with whitelist enforcement."""
        if not args:
            return {"stdout": "", "stderr": "No command provided", "exit_code": 1}
        sub = args[0].lower()
        if sub not in KUBECTL_ALLOWED:
            return {
                "stdout": "",
                "stderr": f"Command '{sub}' not allowed. Allowed: {', '.join(sorted(KUBECTL_ALLOWED))}",
                "exit_code": 1,
            }
        return await self._kubectl(args)
