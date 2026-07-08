"""AWS Route 53 DNS service. Requires boto3: pip install boto3"""
import asyncio
import logging

logger = logging.getLogger(__name__)


class Route53Service:
    def __init__(self, config: dict | None = None):
        self._config = config or {}
        self._access_key = self._config.get("access_key_id", "")
        self._secret_key = self._config.get("secret_access_key", "")
        self._zone_id = self._config.get("hosted_zone_id", "")
        self._region = self._config.get("region", "us-east-1")

    def _client(self):
        try:
            import boto3  # type: ignore[import]
        except ImportError:
            raise RuntimeError("boto3 is not installed — run: pip install boto3")
        session = boto3.Session(
            aws_access_key_id=self._access_key,
            aws_secret_access_key=self._secret_key,
            region_name=self._region,
        )
        return session.client("route53")

    async def create_dns_record(self, name: str, ip: str) -> dict:
        lines = [f"Creating DNS record: A  {name} → {ip}", f"  Hosted Zone: {self._zone_id}"]
        try:
            client = self._client()
            fqdn = name if name.endswith(".") else name + "."
            response = await asyncio.to_thread(
                client.change_resource_record_sets,
                HostedZoneId=self._zone_id,
                ChangeBatch={
                    "Comment": "Created by InfraPilot",
                    "Changes": [{
                        "Action": "UPSERT",
                        "ResourceRecordSet": {
                            "Name": fqdn,
                            "Type": "A",
                            "TTL": 60,
                            "ResourceRecords": [{"Value": ip}],
                        },
                    }],
                },
            )
            change_id = response["ChangeInfo"]["Id"].split("/")[-1]
            status = response["ChangeInfo"]["Status"]
            lines += [
                f"  Change ID: {change_id}",
                f"  Status: {status}",
                f"✓ DNS UPSERT submitted — propagation ~60 s",
                f"✓ Published at http://{name}",
            ]
            return {"success": True, "output": "\n".join(lines), "url": f"http://{name}"}
        except RuntimeError as exc:
            lines.append(f"✗ {exc}")
            return {"success": False, "error": str(exc), "output": "\n".join(lines)}
        except Exception as exc:
            lines.append(f"✗ Route 53 error: {exc}")
            return {"success": False, "error": str(exc), "output": "\n".join(lines)}

    async def test_connection(self) -> dict:
        try:
            client = self._client()
            result = await asyncio.to_thread(client.get_hosted_zone, Id=self._zone_id)
            zone_name = result["HostedZone"]["Name"]
            return {"success": True, "message": f"Connected — hosted zone {zone_name} ({self._zone_id})"}
        except RuntimeError as exc:
            return {"success": False, "message": str(exc)}
        except Exception as exc:
            return {"success": False, "message": str(exc)}
