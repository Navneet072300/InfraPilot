import asyncio
import json
import logging
import os
import shutil
import tempfile

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)
router = APIRouter()

ALLOWED_CRED_KEYS = frozenset({
    "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "AWS_DEFAULT_REGION",
    "ARM_SUBSCRIPTION_ID", "ARM_CLIENT_ID", "ARM_CLIENT_SECRET", "ARM_TENANT_ID",
    "GOOGLE_PROJECT", "GOOGLE_CREDENTIALS",
    "KUBECONFIG_CONTENT",
})


def _ev(type_: str, **kwargs) -> str:
    return f"data: {json.dumps({'type': type_, **kwargs})}\n\n"


async def _run(cmd: list[str], cwd: str, env: dict):
    proc = await asyncio.create_subprocess_exec(
        *cmd, cwd=cwd, env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    async for line in proc.stdout:
        yield line.decode("utf-8", errors="replace").rstrip()
    rc = await proc.wait()
    if rc != 0:
        raise RuntimeError(f"`{' '.join(cmd)}` exited with code {rc}")


@router.post("/implement")
async def implement(request: Request):
    body = await request.json()
    files: dict[str, str] = body.get("files", {})
    cloud: str = body.get("cloud", "aws")
    credentials: dict[str, str] = body.get("credentials", {})

    async def stream():
        tmpdir = tempfile.mkdtemp(prefix="ip_impl_")
        try:
            for path, content in files.items():
                full = os.path.join(tmpdir, path)
                d = os.path.dirname(full)
                if d != tmpdir:
                    os.makedirs(d, exist_ok=True)
                with open(full, "w") as f:
                    f.write(content)

            env = {**os.environ}
            for k, v in credentials.items():
                uk = k.upper()
                if uk in ALLOWED_CRED_KEYS and v:
                    env[uk] = v
                    logger.info("Credential injected: %s=***", uk)

            if "KUBECONFIG_CONTENT" in env:
                kc = os.path.join(tmpdir, "kubeconfig.yaml")
                with open(kc, "w") as f:
                    f.write(env.pop("KUBECONFIG_CONTENT"))
                env["KUBECONFIG"] = kc

            yield _ev("start", message="Starting implementation…")

            has_tf = any(p.endswith(".tf") or p.endswith(".hcl") for p in files)
            has_k8s = any(
                (p.endswith(".yaml") or p.endswith(".yml")) and "guideme" not in p
                for p in files
            )

            if has_tf:
                steps = [
                    (["terraform", "init"], "Initializing Terraform…"),
                    (["terraform", "plan", "-out=tfplan"], "Planning infrastructure…"),
                    (["terraform", "apply", "-auto-approve", "tfplan"], "Applying changes…"),
                ]
                for cmd, label in steps:
                    yield _ev("cmd", cmd=" ".join(cmd), label=label)
                    try:
                        async for line in _run(cmd, tmpdir, env):
                            yield _ev("output", text=line)
                    except RuntimeError as e:
                        yield _ev("error", text=str(e))
                        return

            elif has_k8s:
                yield _ev("cmd", cmd="kubectl apply -f .", label="Applying manifests…")
                try:
                    async for line in _run(["kubectl", "apply", "-f", "."], tmpdir, env):
                        yield _ev("output", text=line)
                except RuntimeError as e:
                    yield _ev("error", text=str(e))
                    return

                yield _ev("cmd", cmd="kubectl get all", label="Checking deployed resources…")
                async for line in _run(["kubectl", "get", "all"], tmpdir, env):
                    yield _ev("output", text=line)

            else:
                yield _ev("error", text="No Terraform (.tf) or Kubernetes (.yaml) files found.")
                return

            yield _ev("done", message="Implementation complete! All resources applied successfully.")

        except Exception as e:
            logger.exception("Implement error")
            yield _ev("error", text=str(e))
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
