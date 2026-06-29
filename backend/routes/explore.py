"""
Data Explorer — discover and inspect data services (Postgres, Redis, Qdrant, MinIO, etc.)
running inside Kubernetes namespaces.
"""
import json
import logging
import re
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config.unified_store import list_clusters

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/explore", tags=["explore"])

# ── Service fingerprinting ─────────────────────────────────────────────────────

SERVICE_FINGERPRINTS: list[dict] = [
    {"type": "postgres",       "icon": "🐘", "label": "PostgreSQL",    "port": 5432,  "patterns": ["postgres", "postgresql", "pgvector"]},
    {"type": "mysql",          "icon": "🐬", "label": "MySQL",         "port": 3306,  "patterns": ["mysql", "mariadb", "percona"]},
    {"type": "mongodb",        "icon": "🍃", "label": "MongoDB",       "port": 27017, "patterns": ["mongo", "mongodb"]},
    {"type": "redis",          "icon": "⚡", "label": "Redis",         "port": 6379,  "patterns": ["redis"]},
    {"type": "qdrant",         "icon": "🔍", "label": "Qdrant",        "port": 6333,  "patterns": ["qdrant"]},
    {"type": "minio",          "icon": "🪣", "label": "MinIO / S3",    "port": 9000,  "patterns": ["minio"]},
    {"type": "elasticsearch",  "icon": "🔎", "label": "Elasticsearch", "port": 9200,  "patterns": ["elasticsearch", "elastic", "opensearch"]},
    {"type": "kafka",          "icon": "📨", "label": "Kafka",         "port": 9092,  "patterns": ["kafka", "redpanda"]},
    {"type": "rabbitmq",       "icon": "🐇", "label": "RabbitMQ",      "port": 5672,  "patterns": ["rabbitmq"]},
    {"type": "cassandra",      "icon": "💎", "label": "Cassandra",     "port": 9042,  "patterns": ["cassandra", "scylladb"]},
    {"type": "clickhouse",     "icon": "🏠", "label": "ClickHouse",    "port": 8123,  "patterns": ["clickhouse"]},
    {"type": "neo4j",          "icon": "🕸️", "label": "Neo4j",         "port": 7687,  "patterns": ["neo4j"]},
    {"type": "influxdb",       "icon": "📈", "label": "InfluxDB",      "port": 8086,  "patterns": ["influxdb", "influx"]},
    {"type": "etcd",           "icon": "🗄️", "label": "etcd",          "port": 2379,  "patterns": ["etcd"]},
]

def _detect_type(image: str, name: str) -> dict | None:
    combined = f"{image} {name}".lower()
    for fp in SERVICE_FINGERPRINTS:
        for p in fp["patterns"]:
            if p in combined:
                return fp
    return None


# ── Safe exec command templates ────────────────────────────────────────────────

SAFE_COMMANDS: dict[str, list[dict]] = {
    "postgres": [
        {"id": "ping",        "label": "Ping",           "cmd": ["pg_isready", "-h", "127.0.0.1"]},
        {"id": "list-dbs",    "label": "List Databases", "cmd": ["psql", "-U", "postgres", "-c", r"\l", "--tuples-only", "-A"]},
        {"id": "list-tables", "label": "List Tables",    "cmd": ["psql", "-U", "postgres", "-c", r"\dt *.*", "--tuples-only", "-A"]},
        {"id": "db-sizes",    "label": "DB Sizes",       "cmd": ["psql", "-U", "postgres", "-c",
            "SELECT datname, pg_size_pretty(pg_database_size(datname)) FROM pg_database ORDER BY pg_database_size(datname) DESC;"]},
        {"id": "table-stats", "label": "Row Counts",     "cmd": ["psql", "-U", "postgres", "-c",
            "SELECT schemaname||'.'||relname AS table, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 20;"]},
    ],
    "mysql": [
        {"id": "ping",        "label": "Ping",           "cmd": ["mysqladmin", "-uroot", "ping"]},
        {"id": "list-dbs",    "label": "List Databases", "cmd": ["mysql", "-uroot", "-e", "SHOW DATABASES;"]},
        {"id": "list-tables", "label": "List Tables",    "cmd": ["mysql", "-uroot", "-e", "SHOW TABLES;"]},
    ],
    "mongodb": [
        {"id": "ping",        "label": "Ping",           "cmd": ["mongosh", "--quiet", "--eval", "db.adminCommand({ping:1})"]},
        {"id": "list-dbs",    "label": "List Databases", "cmd": ["mongosh", "--quiet", "--eval",
            "db.adminCommand({listDatabases:1}).databases.forEach(d=>print(d.name,'|',d.sizeOnDisk,'bytes'))"]},
    ],
    "redis": [
        {"id": "ping",        "label": "Ping",           "cmd": ["redis-cli", "PING"]},
        {"id": "info",        "label": "Key Stats",      "cmd": ["redis-cli", "INFO", "keyspace"]},
        {"id": "dbsize",      "label": "DB Size",        "cmd": ["redis-cli", "DBSIZE"]},
        {"id": "memory",      "label": "Memory Usage",   "cmd": ["redis-cli", "INFO", "memory"]},
    ],
    "qdrant": [
        {"id": "ping",        "label": "Health Check",        "cmd": ["curl", "-s", "http://127.0.0.1:6333/"]},
        {"id": "collections", "label": "List Collections",    "cmd": ["curl", "-s", "http://127.0.0.1:6333/collections"]},
        {"id": "telemetry",   "label": "Telemetry / Stats",   "cmd": ["curl", "-s", "http://127.0.0.1:6333/telemetry"]},
    ],
    "minio": [
        {"id": "ping",        "label": "Health Check",    "cmd": ["curl", "-s", "http://127.0.0.1:9000/minio/health/live"]},
        {"id": "buckets",     "label": "List Buckets",    "cmd": ["curl", "-s", "http://127.0.0.1:9000/"]},
    ],
    "elasticsearch": [
        {"id": "ping",        "label": "Health Check",   "cmd": ["curl", "-s", "http://127.0.0.1:9200/_cluster/health?pretty"]},
        {"id": "indices",     "label": "List Indices",   "cmd": ["curl", "-s", "http://127.0.0.1:9200/_cat/indices?v"]},
        {"id": "stats",       "label": "Node Stats",     "cmd": ["curl", "-s", "http://127.0.0.1:9200/_nodes/stats?pretty"]},
    ],
    "kafka": [
        {"id": "ping",        "label": "Broker Check",   "cmd": ["kafka-topics.sh", "--bootstrap-server", "localhost:9092", "--list"]},
        {"id": "topics",      "label": "List Topics",    "cmd": ["kafka-topics.sh", "--bootstrap-server", "localhost:9092", "--describe"]},
    ],
    "rabbitmq": [
        {"id": "ping",        "label": "Health Check",   "cmd": ["rabbitmqctl", "status"]},
        {"id": "queues",      "label": "List Queues",    "cmd": ["rabbitmqctl", "list_queues", "name", "messages", "consumers"]},
    ],
    "clickhouse": [
        {"id": "ping",        "label": "Ping",           "cmd": ["curl", "-s", "http://127.0.0.1:8123/ping"]},
        {"id": "databases",   "label": "List Databases", "cmd": ["curl", "-s", "http://127.0.0.1:8123/?query=SHOW+DATABASES"]},
        {"id": "tables",      "label": "List Tables",    "cmd": ["curl", "-s", "http://127.0.0.1:8123/?query=SHOW+TABLES"]},
    ],
}


async def _read_pod_env(svc, pod_name: str, namespace: str) -> dict[str, str]:
    """Read env vars from a pod using kubectl get pod -o json (no exec needed)."""
    from services.k8s_service import KubernetesService as _KS
    result = await svc._kubectl(["get", "pod", pod_name, "-n", namespace, "-o", "json"])
    if result["exit_code"] != 0:
        return {}
    try:
        import json as _json
        pod = _json.loads(result["stdout"])
        env: dict[str, str] = {}
        for container in pod.get("spec", {}).get("containers", []):
            for e in container.get("env", []):
                val = e.get("value")
                if val is not None:
                    env[e["name"]] = val
        return env
    except Exception:
        return {}


def _pg_user_from_env(env: dict[str, str]) -> str:
    """Pick the PostgreSQL user from common env var names, fallback to current OS user."""
    for key in ("POSTGRES_USER", "PGUSER", "POSTGRESQL_USERNAME", "DB_USER", "DATABASE_USER"):
        if key in env and env[key]:
            return env[key]
    return ""  # empty = let psql use the OS user (works in official image)


def _pg_db_from_env(env: dict[str, str]) -> str:
    for key in ("POSTGRES_DB", "PGDATABASE", "POSTGRESQL_DATABASE", "DB_NAME", "DATABASE_NAME"):
        if key in env and env[key]:
            return env[key]
    return "postgres"


def _build_command(action: dict, env: dict[str, str], service_type: str) -> list[str]:
    """Substitute detected credentials into a command template."""
    cmd = list(action["cmd"])
    if service_type == "postgres":
        pg_user = _pg_user_from_env(env)
        # Walk the command and replace the value after -U with the detected user,
        # or drop -U <value> entirely when no user was detected.
        out: list[str] = []
        skip_next = False
        for tok in cmd:
            if skip_next:
                skip_next = False
                continue
            if tok == "-U":
                if pg_user:
                    out += ["-U", pg_user]
                # else: omit -U entirely — psql connects as the container OS user
                skip_next = True  # skip the next token (old hardcoded username)
                continue
            out.append(tok)
        return out
    if service_type == "mysql":
        mysql_user = env.get("MYSQL_USER") or env.get("MARIADB_USER") or "root"
        return [t.replace("-uroot", f"-u{mysql_user}") for t in cmd]
    return cmd


async def _resolve_cluster(cluster_name: str | None = None):
    from services.k8s_service import KubernetesService
    clusters = await list_clusters(masked=False)
    if not clusters:
        raise HTTPException(503, "No clusters configured")
    if cluster_name:
        cfg = next((c for c in clusters if c["name"] == cluster_name), None)
        if not cfg:
            raise HTTPException(404, f"Cluster '{cluster_name}' not found")
    else:
        cfg = next((c for c in clusters if c.get("active")), clusters[0])
    return KubernetesService(cfg)


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/namespaces")
async def list_namespaces(cluster: str | None = None):
    svc = await _resolve_cluster(cluster)
    namespaces = await svc.get_namespaces()
    return {"namespaces": namespaces}


@router.get("/scan")
async def scan_namespace(namespace: str = "default", cluster: str | None = None):
    """
    Scan a namespace and return detected data services with pod/service info.
    """
    svc = await _resolve_cluster(cluster)
    pods = await svc.get_pods(namespace)

    detected: list[dict] = []
    seen: set[str] = set()

    for pod in pods:
        image = pod.get("image", "")
        name = pod.get("name", "")
        fp = _detect_type(image, name)
        if not fp:
            continue
        # Deduplicate by type+name-prefix (e.g. two postgres replicas → one entry)
        key = fp["type"] + "-" + re.sub(r"-\d+$", "", name)
        if key in seen:
            continue
        seen.add(key)

        detected.append({
            "id": key,
            "type": fp["type"],
            "icon": fp["icon"],
            "label": fp["label"],
            "port": fp["port"],
            "pod_name": name,
            "namespace": namespace,
            "pod_status": pod.get("status", ""),
            "ready": pod.get("ready", ""),
            "image": image,
            "actions": [{"id": a["id"], "label": a["label"]} for a in SAFE_COMMANDS.get(fp["type"], [])],
        })

    return {"services": detected, "namespace": namespace}


class InspectRequest(BaseModel):
    pod_name: str
    namespace: str
    service_type: str
    action_id: str
    cluster: str | None = None
    confirmed: bool = False


@router.post("/inspect")
async def inspect_service(body: InspectRequest):
    """
    Execute a safe, pre-defined read-only inspection command inside a pod.
    Requires confirmed=True.
    """
    if not body.confirmed:
        return {
            "requires_confirmation": True,
            "message": f"This will run a read-only inspection inside pod '{body.pod_name}' in namespace '{body.namespace}'. Confirm to proceed.",
        }

    cmds = SAFE_COMMANDS.get(body.service_type, [])
    action = next((a for a in cmds if a["id"] == body.action_id), None)
    if not action:
        raise HTTPException(400, f"Unknown action '{body.action_id}' for type '{body.service_type}'")

    svc = await _resolve_cluster(body.cluster)
    env = await _read_pod_env(svc, body.pod_name, body.namespace)
    cmd = _build_command(action, env, body.service_type)
    args = ["exec", body.pod_name, "-n", body.namespace, "--"] + cmd
    result = await svc._kubectl(args, timeout=20)

    # If role error and no user was detected, retry stripping -U entirely
    if result["exit_code"] != 0 and "does not exist" in result.get("stderr", "") and body.service_type == "postgres":
        stripped: list[str] = []
        skip = False
        for tok in cmd:
            if skip:
                skip = False
                continue
            if tok == "-U":
                skip = True
                continue
            stripped.append(tok)
        args2 = ["exec", body.pod_name, "-n", body.namespace, "--"] + stripped
        result2 = await svc._kubectl(args2, timeout=20)
        if result2["exit_code"] == 0:
            result = result2

    return {
        "action": body.action_id,
        "label": action["label"],
        "pod": body.pod_name,
        "exit_code": result["exit_code"],
        "stdout": result["stdout"],
        "stderr": result["stderr"],
        "detected_user": _pg_user_from_env(env) if body.service_type == "postgres" else None,
    }


class AiQueryRequest(BaseModel):
    pod_name: str
    namespace: str
    service_type: str
    service_label: str
    question: str
    cluster: str | None = None
    confirmed: bool = False


@router.post("/ai-query")
async def ai_query(body: AiQueryRequest):
    """
    Given a natural-language question, generate and (if confirmed) execute
    a safe read-only command against the data service.
    """
    available = SAFE_COMMANDS.get(body.service_type, [])
    available_summary = "\n".join(f'- {a["id"]}: runs `{" ".join(a["cmd"])}`' for a in available)

    prompt = f"""You are a senior database/infrastructure engineer helping a user explore a {body.service_label} instance running inside Kubernetes pod '{body.pod_name}' in namespace '{body.namespace}'.

Available safe read-only inspection actions:
{available_summary}

The user asks: "{body.question}"

Respond with a JSON object:
{{
  "action_id": "<one of the available action IDs above, or null if none fits>",
  "explanation": "<1-2 sentence plain English explanation of what this will show>",
  "suggestion": "<optional: what the user should look for in the results>"
}}

Only use action IDs from the list above. If none fit, set action_id to null and explain why."""

    from services.ai_service import ai
    chunks: list[str] = []
    async for chunk in ai.stream_generate("You are a database expert. Always respond with valid JSON only.", prompt, max_tokens=300):
        chunks.append(chunk)
    raw = "".join(chunks).strip()

    try:
        parsed: dict[str, Any] = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        parsed = {"action_id": None, "explanation": str(raw), "suggestion": ""}

    action_id = parsed.get("action_id")
    result: dict = {}

    if action_id and body.confirmed:
        action = next((a for a in available if a["id"] == action_id), None)
        if action:
            svc = await _resolve_cluster(body.cluster)
            env = await _read_pod_env(svc, body.pod_name, body.namespace)
            cmd = _build_command(action, env, body.service_type)
            args = ["exec", body.pod_name, "-n", body.namespace, "--"] + cmd
            r = await svc._kubectl(args, timeout=20)
            result = {"exit_code": r["exit_code"], "stdout": r["stdout"], "stderr": r["stderr"]}
    elif action_id and not body.confirmed:
        result = {"requires_confirmation": True}

    return {
        "action_id": action_id,
        "explanation": parsed.get("explanation", ""),
        "suggestion": parsed.get("suggestion", ""),
        "result": result,
    }
