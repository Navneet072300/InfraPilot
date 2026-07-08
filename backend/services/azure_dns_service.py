"""Azure DNS service — uses the Azure Resource Manager REST API."""
import logging

import httpx

logger = logging.getLogger(__name__)

_ARM_BASE = "https://management.azure.com"
_TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"


class AzureDnsService:
    def __init__(self, config: dict | None = None):
        self._config = config or {}
        self._client_id = self._config.get("client_id", "")
        self._client_secret = self._config.get("client_secret", "")
        self._tenant_id = self._config.get("tenant_id", "")
        self._subscription_id = self._config.get("subscription_id", "")
        self._resource_group = self._config.get("resource_group", "")
        self._zone_name = self._config.get("zone_name", "")

    async def _get_token(self) -> str:
        url = _TOKEN_URL.format(tenant=self._tenant_id)
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "scope": "https://management.azure.com/.default",
                },
            )
            r.raise_for_status()
            return r.json()["access_token"]

    def _record_url(self, rel_name: str) -> str:
        return (
            f"{_ARM_BASE}/subscriptions/{self._subscription_id}"
            f"/resourceGroups/{self._resource_group}"
            f"/providers/Microsoft.Network/dnsZones/{self._zone_name}"
            f"/A/{rel_name}?api-version=2018-05-01"
        )

    def _zone_url(self) -> str:
        return (
            f"{_ARM_BASE}/subscriptions/{self._subscription_id}"
            f"/resourceGroups/{self._resource_group}"
            f"/providers/Microsoft.Network/dnsZones/{self._zone_name}"
            "?api-version=2018-05-01"
        )

    async def create_dns_record(self, name: str, ip: str) -> dict:
        lines = [f"Creating DNS record: A  {name} → {ip}", f"  Zone: {self._zone_name}"]
        try:
            token = await self._get_token()
            # Relative name: strip zone suffix
            rel = name
            if self._zone_name and name.endswith(f".{self._zone_name}"):
                rel = name[: -(len(self._zone_name) + 1)]
            elif name == self._zone_name:
                rel = "@"
            url = self._record_url(rel)
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.put(
                    url,
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    json={"properties": {"TTL": 60, "ARecords": [{"ipv4Address": ip}]}},
                )
                data = r.json()
            if r.status_code in (200, 201):
                lines += [
                    f"  Relative name: {rel}",
                    f"✓ DNS record created",
                    f"✓ Published at http://{name}",
                ]
                return {"success": True, "output": "\n".join(lines), "url": f"http://{name}"}
            err = data.get("error", {}).get("message", f"HTTP {r.status_code}")
            lines.append(f"✗ Azure DNS error: {err}")
            return {"success": False, "error": err, "output": "\n".join(lines)}
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
                return {"success": True, "message": f"Connected — DNS zone {self._zone_name} ({self._resource_group})"}
            err = data.get("error", {}).get("message", f"HTTP {r.status_code}")
            return {"success": False, "message": err}
        except Exception as exc:
            return {"success": False, "message": str(exc)}
