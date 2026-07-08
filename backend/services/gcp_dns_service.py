"""GCP Cloud DNS service — uses the Cloud DNS REST API with service account auth."""
import json
import logging
import time

import httpx

logger = logging.getLogger(__name__)

_GCP_DNS_BASE = "https://dns.googleapis.com/dns/v1"
_GCP_TOKEN_URL = "https://oauth2.googleapis.com/token"


class GcpDnsService:
    def __init__(self, config: dict | None = None):
        self._config = config or {}
        self._project_id = self._config.get("project_id", "")
        self._managed_zone = self._config.get("managed_zone", "")
        raw_sa = self._config.get("service_account_json", "{}")
        try:
            self._sa: dict = json.loads(raw_sa) if isinstance(raw_sa, str) else (raw_sa or {})
        except Exception:
            self._sa = {}

    async def _get_token(self) -> str:
        try:
            import jwt as pyjwt  # type: ignore[import]
        except ImportError:
            raise RuntimeError("PyJWT is not installed — run: pip install PyJWT cryptography")
        now = int(time.time())
        payload = {
            "iss": self._sa.get("client_email"),
            "sub": self._sa.get("client_email"),
            "aud": _GCP_TOKEN_URL,
            "iat": now,
            "exp": now + 3600,
            "scope": "https://www.googleapis.com/auth/cloud-platform",
        }
        private_key = self._sa.get("private_key", "")
        signed = pyjwt.encode(payload, private_key, algorithm="RS256")
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                _GCP_TOKEN_URL,
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion": signed,
                },
            )
            r.raise_for_status()
            return r.json()["access_token"]

    def _zone_url(self) -> str:
        return f"{_GCP_DNS_BASE}/projects/{self._project_id}/managedZones/{self._managed_zone}"

    def _changes_url(self) -> str:
        return f"{self._zone_url()}/changes"

    async def create_dns_record(self, name: str, ip: str) -> dict:
        lines = [f"Creating DNS record: A  {name} → {ip}", f"  Managed Zone: {self._managed_zone}"]
        try:
            token = await self._get_token()
            fqdn = name if name.endswith(".") else name + "."
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.post(
                    self._changes_url(),
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    json={"additions": [{"name": fqdn, "type": "A", "ttl": 60, "rrdatas": [ip]}]},
                )
                data = r.json()
            if r.status_code in (200, 201):
                status = data.get("status", "pending")
                lines += [
                    f"  Change status: {status}",
                    f"✓ DNS change submitted",
                    f"✓ Published at http://{name}",
                ]
                return {"success": True, "output": "\n".join(lines), "url": f"http://{name}"}
            err = data.get("error", {}).get("message", f"HTTP {r.status_code}")
            lines.append(f"✗ GCP DNS error: {err}")
            return {"success": False, "error": err, "output": "\n".join(lines)}
        except RuntimeError as exc:
            lines.append(f"✗ {exc}")
            return {"success": False, "error": str(exc), "output": "\n".join(lines)}
        except Exception as exc:
            lines.append(f"✗ Error: {exc}")
            return {"success": False, "error": str(exc), "output": "\n".join(lines)}

    async def test_connection(self) -> dict:
        try:
            token = await self._get_token()
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(
                    self._zone_url(),
                    headers={"Authorization": f"Bearer {token}"},
                )
                data = r.json()
            if r.status_code == 200:
                return {"success": True, "message": f"Connected — managed zone {self._managed_zone} ({self._project_id})"}
            err = data.get("error", {}).get("message", f"HTTP {r.status_code}")
            return {"success": False, "message": err}
        except RuntimeError as exc:
            return {"success": False, "message": str(exc)}
        except Exception as exc:
            return {"success": False, "message": str(exc)}
