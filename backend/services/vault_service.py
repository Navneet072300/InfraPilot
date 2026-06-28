"""Stubbed Vault service. Returns realistic responses without real API calls."""
import asyncio
import logging

logger = logging.getLogger(__name__)


class VaultService:
    def __init__(self, config: dict | None = None):
        self._config = config or {}
        self.stubbed = True
        self.address = self._config.get("address", "https://vault.example.com")

    async def write_secret(self, path: str, data: dict) -> dict:
        await asyncio.sleep(0.8)
        keys = list(data.keys())
        output_lines = [
            f"$ vault kv put {path} " + " ".join(f"{k}=***" for k in keys),
            "Key              Value",
            "---              -----",
            "created_time     2024-01-15T10:30:00.000Z",
            "deletion_time    n/a",
            "destroyed        false",
            "version          1",
            f"Success! Data written to: {path}",
        ]
        return {
            "success": True,
            "output": "\n".join(output_lines),
            "stubbed": True,
        }

    async def write_policy(self, name: str, policy_hcl: str) -> dict:
        await asyncio.sleep(0.5)
        output_lines = [
            f"$ vault policy write {name} -",
            f"Success! Uploaded policy: {name}",
        ]
        return {
            "success": True,
            "output": "\n".join(output_lines),
            "stubbed": True,
        }

    async def enable_k8s_auth(self, cluster: str, namespace: str) -> dict:
        await asyncio.sleep(0.6)
        lines = [
            f"$ vault auth enable -path=kubernetes-{cluster} kubernetes",
            f"Success! Enabled kubernetes auth method at: kubernetes-{cluster}/",
            f"$ vault write auth/kubernetes-{cluster}/config ...",
            "Success! Configured Kubernetes auth backend.",
            f"$ vault write auth/kubernetes-{cluster}/role/{namespace} ...",
            f"Success! Data written to: auth/kubernetes-{cluster}/role/{namespace}",
        ]
        return {"success": True, "output": "\n".join(lines), "stubbed": True}

    async def read_secret(self, path: str) -> dict:
        await asyncio.sleep(0.3)
        return {
            "exists": False,
            "output": f"$ vault kv get {path}\nNo value found at {path}",
            "stubbed": True,
        }

    async def test_connection(self) -> dict:
        await asyncio.sleep(0.3)
        return {
            "success": True,
            "message": f"Connected to Vault v1.15.2 at {self.address}",
            "stubbed": True,
        }
