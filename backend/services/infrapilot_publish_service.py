"""InfraPilot-managed *.infrapilot.app subdomain publishing (Scenario 2).

Reads system-level Cloudflare credentials from env vars:
  INFRAPILOT_CF_TOKEN    — Cloudflare API token (needs DNS:Edit on the zone)
  INFRAPILOT_CF_ZONE_ID  — Zone ID for infrapilot.app (or INFRAPILOT_DOMAIN)
  INFRAPILOT_DOMAIN      — defaults to infrapilot.app

If the env vars are not set, the subdomain URL is still returned so it can be
set up manually, and a note is included in the output.
"""
import logging
import os
import re

import httpx

logger = logging.getLogger(__name__)

_CF_BASE = "https://api.cloudflare.com/client/v4"
_CF_TOKEN = os.getenv("INFRAPILOT_CF_TOKEN", "")
_CF_ZONE_ID = os.getenv("INFRAPILOT_CF_ZONE_ID", "")
_IP_DOMAIN = os.getenv("INFRAPILOT_DOMAIN", "infrapilot.app")


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-") or "app"


class InfraPilotPublishService:
    @staticmethod
    def subdomain_for(app_name: str) -> str:
        return f"{_slugify(app_name)}.{_IP_DOMAIN}"

    async def publish(self, app_name: str, lb_ip: str | None = None) -> dict:
        subdomain = self.subdomain_for(app_name)
        lines = [f"Claiming subdomain: {subdomain}"]

        if not _CF_TOKEN or not _CF_ZONE_ID:
            lines += [
                "⚠ INFRAPILOT_CF_TOKEN / INFRAPILOT_CF_ZONE_ID not set on this server",
                f"  Manually create: A  {subdomain} → <LoadBalancer IP>",
                f"✓ Reserved subdomain: https://{subdomain}",
            ]
            return {
                "success": True,
                "output": "\n".join(lines),
                "url": f"https://{subdomain}",
                "subdomain": subdomain,
                "manual": True,
            }

        target_ip = lb_ip or "0.0.0.0"
        headers = {"Authorization": f"Bearer {_CF_TOKEN}", "Content-Type": "application/json"}
        payload = {"type": "A", "name": subdomain, "content": target_ip, "ttl": 1, "proxied": True}

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                # Check for existing record
                search = await client.get(
                    f"{_CF_BASE}/zones/{_CF_ZONE_ID}/dns_records",
                    params={"name": subdomain, "type": "A"},
                    headers=headers,
                )
                existing = search.json().get("result", [])
                if existing:
                    record_id = existing[0]["id"]
                    r = await client.put(
                        f"{_CF_BASE}/zones/{_CF_ZONE_ID}/dns_records/{record_id}",
                        json=payload,
                        headers=headers,
                    )
                    lines.append("  (existing record updated)")
                else:
                    r = await client.post(
                        f"{_CF_BASE}/zones/{_CF_ZONE_ID}/dns_records",
                        json=payload,
                        headers=headers,
                    )
                data = r.json()
        except Exception as exc:
            lines.append(f"✗ Request failed: {exc}")
            return {"success": False, "error": str(exc), "output": "\n".join(lines), "subdomain": subdomain}

        if data.get("success"):
            lines += [
                f"  A record: {subdomain} → {target_ip}",
                "  Proxied through Cloudflare ☁",
                f"✓ Published at https://{subdomain}",
            ]
            return {
                "success": True,
                "output": "\n".join(lines),
                "url": f"https://{subdomain}",
                "subdomain": subdomain,
            }

        errors = "; ".join(e.get("message", "unknown") for e in data.get("errors", []))
        lines.append(f"✗ Cloudflare error: {errors}")
        return {"success": False, "error": errors, "output": "\n".join(lines), "subdomain": subdomain}

    @staticmethod
    def cloudflared_manifest(app_name: str) -> str:
        """Returns a cloudflared Deployment YAML for Cloudflare Tunnel mode."""
        subdomain = InfraPilotPublishService.subdomain_for(app_name)
        slug = _slugify(app_name)
        return f"""\
# Cloudflare Tunnel — routes {subdomain} into the cluster without a LoadBalancer IP.
#
# Setup (one-time):
#   cloudflared tunnel create {slug}
#   cloudflared tunnel route dns {slug} {subdomain}
#   kubectl create secret generic cloudflared-{slug}-secret \\
#     --from-literal=token=<tunnel-token>
#
# Then apply this manifest:
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloudflared-{slug}
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cloudflared-{slug}
  template:
    metadata:
      labels:
        app: cloudflared-{slug}
    spec:
      containers:
      - name: cloudflared
        image: cloudflare/cloudflared:latest
        args: [tunnel, --no-autoupdate, run, --token, $(TUNNEL_TOKEN)]
        env:
        - name: TUNNEL_TOKEN
          valueFrom:
            secretKeyRef:
              name: cloudflared-{slug}-secret
              key: token
"""
