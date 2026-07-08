"""Cloudflare DNS service — uses the Cloudflare v4 REST API."""
import logging

import httpx

logger = logging.getLogger(__name__)

_CF_BASE = "https://api.cloudflare.com/client/v4"


class CloudflareService:
    def __init__(self, config: dict | None = None):
        self._config = config or {}
        self._token = self._config.get("api_token", "")
        self._zone_id = self._config.get("zone_id", "")

    @property
    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

    async def _resolve_zone_id(self, name: str) -> str | None:
        """Return configured zone_id or auto-detect from the domain name."""
        if self._zone_id:
            return self._zone_id
        parts = name.split(".")
        root = ".".join(parts[-2:]) if len(parts) >= 2 else name
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(
                    f"{_CF_BASE}/zones",
                    params={"name": root},
                    headers=self._headers,
                )
                data = r.json()
                if data.get("result"):
                    return data["result"][0]["id"]
        except Exception as exc:
            logger.warning("CF zone lookup failed: %s", exc)
        return None

    async def _find_record(self, zone_id: str, name: str, rtype: str = "A") -> str | None:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(
                    f"{_CF_BASE}/zones/{zone_id}/dns_records",
                    params={"name": name, "type": rtype},
                    headers=self._headers,
                )
                result = r.json().get("result", [])
                if result:
                    return result[0]["id"]
        except Exception as exc:
            logger.warning("CF record lookup failed: %s", exc)
        return None

    async def create_dns_record(self, name: str, ip: str, proxied: bool = True) -> dict:
        lines = [f"Creating DNS record: A  {name} → {ip}"]
        zone_id = await self._resolve_zone_id(name)
        if not zone_id:
            msg = f"Could not resolve Cloudflare zone for {name}"
            lines.append(f"✗ {msg}")
            return {"success": False, "error": msg, "output": "\n".join(lines)}

        lines.append(f"  Zone ID: {zone_id}")
        payload = {"type": "A", "name": name, "content": ip, "ttl": 1, "proxied": proxied}
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                existing_id = await self._find_record(zone_id, name)
                if existing_id:
                    r = await client.put(
                        f"{_CF_BASE}/zones/{zone_id}/dns_records/{existing_id}",
                        json=payload,
                        headers=self._headers,
                    )
                    lines.append("  (existing record updated)")
                else:
                    r = await client.post(
                        f"{_CF_BASE}/zones/{zone_id}/dns_records",
                        json=payload,
                        headers=self._headers,
                    )
                data = r.json()
        except Exception as exc:
            lines.append(f"✗ Request failed: {exc}")
            return {"success": False, "error": str(exc), "output": "\n".join(lines)}

        if data.get("success"):
            record_id = data["result"]["id"]
            lines += [
                f"  Proxied: {'Yes (orange cloud ☁)' if proxied else 'No (grey cloud)'}",
                f"  Record ID: {record_id[:12]}…",
                f"✓ DNS record created — ~2 min to propagate",
                f"✓ Published at https://{name}",
            ]
            return {"success": True, "output": "\n".join(lines), "url": f"https://{name}"}

        errors = "; ".join(e.get("message", "unknown") for e in data.get("errors", []))
        lines.append(f"✗ Cloudflare API error: {errors}")
        return {"success": False, "error": errors, "output": "\n".join(lines)}

    async def update_dns_record(self, name: str, ip: str) -> dict:
        return await self.create_dns_record(name, ip, proxied=True)

    async def test_connection(self) -> dict:
        if not self._token:
            return {"success": False, "message": "No API token configured"}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(
                    f"{_CF_BASE}/user/tokens/verify",
                    headers=self._headers,
                )
                data = r.json()
                if not data.get("success"):
                    return {"success": False, "message": "Token invalid or insufficient permissions"}
                zone_label = "auto-detect"
                if self._zone_id:
                    zr = await client.get(
                        f"{_CF_BASE}/zones/{self._zone_id}",
                        headers=self._headers,
                    )
                    zdata = zr.json()
                    if zdata.get("result"):
                        zone_label = zdata["result"]["name"]
                return {
                    "success": True,
                    "message": f"Connected — zone: {zone_label} (ID: {self._zone_id or 'auto-detect'})",
                }
        except Exception as exc:
            return {"success": False, "message": str(exc)}
