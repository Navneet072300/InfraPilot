"""Stubbed Cloudflare service. Returns realistic responses without real API calls."""
import asyncio
import logging

logger = logging.getLogger(__name__)


class CloudflareService:
    def __init__(self, config: dict | None = None):
        self._config = config or {}
        self.stubbed = True
        self.zone_id = self._config.get("zone_id", "abc123")

    async def create_dns_record(
        self, name: str, ip: str, proxied: bool = True
    ) -> dict:
        await asyncio.sleep(1.2)
        lines = [
            f"Creating DNS record: A  {name} → {ip}",
            f"  Proxied: {'Yes (orange cloud)' if proxied else 'No (grey cloud)'}",
            f"  TTL: Auto",
            f"  Zone: {self.zone_id}",
            "✓ DNS record created successfully",
            f"  Record ID: rec_{ip.replace('.', '')}",
            f"  Estimated propagation: ~2 minutes",
            f"✓ Published at https://{name}",
        ]
        return {
            "success": True,
            "output": "\n".join(lines),
            "url": f"https://{name}",
            "stubbed": True,
        }

    async def update_dns_record(self, name: str, ip: str) -> dict:
        await asyncio.sleep(0.8)
        lines = [
            f"Updating DNS record: A  {name} → {ip}",
            "✓ DNS record updated",
            "  Cloudflare cache purged for zone",
        ]
        return {"success": True, "output": "\n".join(lines), "stubbed": True}

    async def test_connection(self) -> dict:
        await asyncio.sleep(0.4)
        return {
            "success": True,
            "message": "Connected — zone example.com found (ID: abc123efgh)",
            "stubbed": True,
        }
