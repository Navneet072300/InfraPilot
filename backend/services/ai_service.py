import json
import logging
import os
from typing import AsyncGenerator

import httpx

logger = logging.getLogger(__name__)

DEVOPS_SYSTEM = """You are an expert DevOps engineer with deep knowledge of the full DevOps toolchain: \
Docker, Docker Compose, Kubernetes, Helm, Kustomize, Terraform, Pulumi, CDK, Ansible, \
Jenkins, GitHub Actions, GitLab CI, CircleCI, ArgoCD, Flux, Prometheus, Grafana, \
Nginx, Traefik, HashiCorp Vault, and all major clouds (AWS, GCP, Azure).

Generate production-ready files for WHATEVER the user requests — not limited to cloud infra. \
This includes but is not limited to:
- Docker Compose files (docker-compose.yml)
- Dockerfiles
- Jenkinsfile (declarative or scripted pipeline)
- GitHub Actions workflows (.github/workflows/*.yml)
- GitLab CI (.gitlab-ci.yml)
- CircleCI config (.circleci/config.yml)
- Ansible playbooks and roles
- Terraform / OpenTofu modules
- Kubernetes manifests (Deployment, Service, Ingress, HPA, etc.)
- Helm charts (Chart.yaml, values.yaml, templates/)
- Kustomize overlays
- ArgoCD / Flux GitOps configs
- Makefile automation
- Shell scripts (deploy.sh, setup.sh)
- Nginx / Traefik configs
- Prometheus / Grafana dashboards and alert rules
- Any other DevOps tooling file

Quality rules:
- Use real, complete configurations — no placeholders or TODO comments
- Include version pins where they matter
- Follow tool-specific best practices and conventions
- Add inline comments only for non-obvious choices

Format multi-file output using EXACTLY this separator format (no exceptions):
--- FILE: path/to/filename ---
[file content]
--- FILE: another/file.yml ---
[file content]

REQUIRED: After all generated files, always append a file named 'guideme.md' using the same --- FILE: guideme.md --- separator. Include exactly:
## What Was Generated
[2-3 sentence summary]
## Prerequisites
[exact tool versions required]
## Step-by-Step Implementation
[numbered steps with copy-paste shell commands]
## Verify It Worked
[commands to confirm success]
## Troubleshooting
[3-5 specific error messages and their fixes]"""

SRE_SYSTEM = """You are a senior SRE with expertise in Kubernetes troubleshooting and cloud infrastructure.
Analyze the provided logs and events. Return structured diagnosis using EXACTLY these headers:

## SEVERITY: [critical|high|medium|low]

## ROOT CAUSE
[one paragraph explaining what happened]

## DETAILS
[technical deep-dive, 2-3 paragraphs]

## SUGGESTED FIX
[exact commands to run, step by step]

## BEFORE (problematic config)
```yaml
[before config if manifest change needed]
```

## AFTER (fixed config)
```yaml
[fixed config]
```

## PREVENTION
- [step 1]
- [step 2]
- [step 3]

Be specific, use real Kubernetes commands, reference actual resource names from the logs."""


# ── Provider config helpers ───────────────────────────────────────────────────

def _tf_key() -> str | None:
    return os.environ.get("TF_API_KEY", "").strip() or None

def _tf_model() -> str:
    return os.environ.get("TF_MODEL", "openai/gpt-oss-120b")

def _tf_base() -> str:
    return os.environ.get("TF_BASE_URL", "https://api.tokenfactory.iamsaif.ai/v1")

def _ollama_url() -> str | None:
    return os.environ.get("OLLAMA_URL", "").rstrip("/") or None

def _ollama_model() -> str:
    return os.environ.get("OLLAMA_MODEL", "gemma4:31b")

def _groq_key() -> str | None:
    return os.environ.get("GROQ_API_KEY", "").strip() or None

def _groq_model() -> str:
    return os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")


# ── Shared SSE parser (OpenAI-compatible) ─────────────────────────────────────

async def _parse_openai_sse(resp: httpx.Response) -> AsyncGenerator[str, None]:
    async for line in resp.aiter_lines():
        if not line.startswith("data:"):
            continue
        body = line[5:].strip()
        if body == "[DONE]":
            break
        try:
            data = json.loads(body)
            token = data["choices"][0]["delta"].get("content", "")
            if token:
                yield token
        except (json.JSONDecodeError, KeyError, IndexError):
            continue


class AIService:

    # ── 1. TokenFactory (OpenAI-compatible) ──────────────────────────────────

    async def _stream_tokenfactory(
        self, system: str, prompt: str, max_tokens: int = 4096
    ) -> AsyncGenerator[str, None]:
        api_key = _tf_key()
        if not api_key:
            raise RuntimeError("TF_API_KEY not set")
        payload = {
            "model": _tf_model(),
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "max_tokens": max_tokens,
            "stream": True,
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        timeout = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                f"{_tf_base()}/chat/completions",
                json=payload,
                headers=headers,
            ) as resp:
                resp.raise_for_status()
                async for token in _parse_openai_sse(resp):
                    yield token

    async def _chat_tokenfactory(
        self, system: str, messages: list[dict], max_tokens: int
    ) -> AsyncGenerator[str, None]:
        api_key = _tf_key()
        if not api_key:
            raise RuntimeError("TF_API_KEY not set")
        payload = {
            "model": _tf_model(),
            "messages": [{"role": "system", "content": system}] + messages,
            "max_tokens": max_tokens,
            "stream": True,
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        timeout = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                f"{_tf_base()}/chat/completions",
                json=payload,
                headers=headers,
            ) as resp:
                resp.raise_for_status()
                async for token in _parse_openai_sse(resp):
                    yield token

    # ── 2. Ollama (local) ─────────────────────────────────────────────────────

    async def _stream_ollama(
        self, system: str, prompt: str, max_tokens: int = 4096
    ) -> AsyncGenerator[str, None]:
        base = _ollama_url()
        payload = {
            "model": _ollama_model(),
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "stream": True,
            "options": {"num_predict": max_tokens},
        }
        timeout = httpx.Timeout(connect=8.0, read=120.0, write=30.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", f"{base}/api/chat", json=payload) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        token = data.get("message", {}).get("content", "")
                        if token:
                            yield token
                        if data.get("done"):
                            break
                    except json.JSONDecodeError:
                        continue

    async def _chat_ollama(
        self, system: str, messages: list[dict], max_tokens: int
    ) -> AsyncGenerator[str, None]:
        base = _ollama_url()
        payload = {
            "model": _ollama_model(),
            "messages": [{"role": "system", "content": system}] + messages,
            "stream": True,
            "options": {"num_predict": max_tokens},
        }
        timeout = httpx.Timeout(connect=8.0, read=120.0, write=30.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", f"{base}/api/chat", json=payload) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        token = data.get("message", {}).get("content", "")
                        if token:
                            yield token
                        if data.get("done"):
                            break
                    except json.JSONDecodeError:
                        continue

    # ── 3. Groq (OpenAI-compatible) ───────────────────────────────────────────

    async def _stream_groq(
        self, system: str, prompt: str, max_tokens: int = 4096
    ) -> AsyncGenerator[str, None]:
        api_key = _groq_key()
        if not api_key:
            raise RuntimeError("GROQ_API_KEY not set")
        payload = {
            "model": _groq_model(),
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "max_tokens": max_tokens,
            "stream": True,
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        timeout = httpx.Timeout(connect=8.0, read=120.0, write=30.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                "https://api.groq.com/openai/v1/chat/completions",
                json=payload,
                headers=headers,
            ) as resp:
                resp.raise_for_status()
                async for token in _parse_openai_sse(resp):
                    yield token

    async def _chat_groq(
        self, system: str, messages: list[dict], max_tokens: int
    ) -> AsyncGenerator[str, None]:
        api_key = _groq_key()
        if not api_key:
            raise RuntimeError("GROQ_API_KEY not set")
        payload = {
            "model": _groq_model(),
            "messages": [{"role": "system", "content": system}] + messages,
            "max_tokens": max_tokens,
            "stream": True,
        }
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        timeout = httpx.Timeout(connect=8.0, read=120.0, write=30.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                "https://api.groq.com/openai/v1/chat/completions",
                json=payload,
                headers=headers,
            ) as resp:
                resp.raise_for_status()
                async for token in _parse_openai_sse(resp):
                    yield token

    # ── Unified dispatcher: TokenFactory → Ollama → Groq ─────────────────────

    async def _stream(
        self, system: str, prompt: str, max_tokens: int = 4096
    ) -> AsyncGenerator[str, None]:
        # 1. TokenFactory
        if _tf_key():
            logger.info("AI: using TokenFactory model=%s", _tf_model())
            yielded_any = False
            try:
                async for chunk in self._stream_tokenfactory(system, prompt, max_tokens):
                    yielded_any = True
                    yield chunk
                return
            except httpx.HTTPStatusError as e:
                logger.warning("TokenFactory HTTP %s — trying Ollama", e.response.status_code)
            except (httpx.ConnectError, httpx.ConnectTimeout) as e:
                logger.warning("TokenFactory unreachable (%s) — trying Ollama", e)
            except httpx.ReadTimeout:
                logger.warning("TokenFactory read timeout — trying Ollama")
            except Exception as e:
                logger.warning("TokenFactory error (%s) — trying Ollama", e)
            if yielded_any:
                return

        # 2. Ollama (local gemma4)
        if _ollama_url():
            logger.info("AI: using Ollama model=%s", _ollama_model())
            yielded_any = False
            try:
                async for chunk in self._stream_ollama(system, prompt, max_tokens):
                    yielded_any = True
                    yield chunk
                return
            except httpx.HTTPStatusError as e:
                logger.warning("Ollama HTTP %s — trying Groq", e.response.status_code)
            except (httpx.ConnectError, httpx.ConnectTimeout) as e:
                logger.warning("Ollama unreachable (%s) — trying Groq", e)
            except httpx.ReadTimeout:
                logger.warning("Ollama read timeout — trying Groq")
            except Exception as e:
                logger.warning("Ollama error (%s) — trying Groq", e)
            if yielded_any:
                return

        # 3. Groq
        if _groq_key():
            logger.info("AI: using Groq model=%s", _groq_model())
            try:
                async for chunk in self._stream_groq(system, prompt, max_tokens):
                    yield chunk
                return
            except httpx.HTTPStatusError as e:
                logger.error("Groq HTTP %s", e.response.status_code)
            except Exception as e:
                logger.error("Groq error: %s", e)

        raise RuntimeError("No AI provider available — set TF_API_KEY, OLLAMA_URL, or GROQ_API_KEY")

    async def _chat(
        self, system: str, messages: list[dict], max_tokens: int
    ) -> AsyncGenerator[str, None]:
        # 1. TokenFactory
        if _tf_key():
            yielded_any = False
            try:
                async for chunk in self._chat_tokenfactory(system, messages, max_tokens):
                    yielded_any = True
                    yield chunk
                return
            except Exception as e:
                logger.warning("TokenFactory chat (%s) — trying Ollama", e)
            if yielded_any:
                return

        # 2. Ollama
        if _ollama_url():
            yielded_any = False
            try:
                async for chunk in self._chat_ollama(system, messages, max_tokens):
                    yielded_any = True
                    yield chunk
                return
            except Exception as e:
                logger.warning("Ollama chat (%s) — trying Groq", e)
            if yielded_any:
                return

        # 3. Groq
        if _groq_key():
            try:
                async for chunk in self._chat_groq(system, messages, max_tokens):
                    yield chunk
                return
            except Exception as e:
                logger.error("Groq chat error: %s", e)

        raise RuntimeError("No AI provider available — set TF_API_KEY, OLLAMA_URL, or GROQ_API_KEY")

    # ── Public API ────────────────────────────────────────────────────────────

    async def stream_devops(
        self, prompt: str, tools: list[str] | None = None, context: str = ""
    ) -> AsyncGenerator[str, None]:
        hints: list[str] = []

        if tools:
            hints.append(f"Primary tools for this task: {', '.join(tools)}.")

        ctx_lower = context.lower()
        if "azure" in ctx_lower and "aws" not in ctx_lower and "gcp" not in ctx_lower:
            hints.append("Target cloud: Azure. Use azurerm provider, AKS, Azure Storage, Azure SQL/Cosmos.")
        elif "gcp" in ctx_lower and "aws" not in ctx_lower and "azure" not in ctx_lower:
            hints.append("Target cloud: GCP. Use google provider, GKE, GCS, Cloud SQL.")
        elif "aws" in ctx_lower and "azure" not in ctx_lower and "gcp" not in ctx_lower:
            hints.append("Target cloud: AWS. Use aws provider.")
        elif context:
            hints.append(f"Platform context: {context}.")

        # Infer intent from prompt keywords when no tool selected
        prompt_lower = prompt.lower()
        if not tools or tools == []:
            if any(k in prompt_lower for k in ("docker compose", "compose")):
                hints.append("Generate docker-compose.yml.")
            elif any(k in prompt_lower for k in ("dockerfile", "docker image")):
                hints.append("Generate a Dockerfile.")
            elif any(k in prompt_lower for k in ("jenkins", "jenkinsfile")):
                hints.append("Generate a Jenkinsfile using declarative pipeline syntax.")
            elif any(k in prompt_lower for k in ("github action", "workflow")):
                hints.append("Generate GitHub Actions workflow files under .github/workflows/.")
            elif any(k in prompt_lower for k in ("gitlab", ".gitlab-ci")):
                hints.append("Generate a .gitlab-ci.yml pipeline.")
            elif any(k in prompt_lower for k in ("ansible", "playbook")):
                hints.append("Generate Ansible playbooks and roles.")
            elif any(k in prompt_lower for k in ("helm", "chart")):
                hints.append("Generate a Helm chart with Chart.yaml, values.yaml, and templates/.")

        hint_str = "\n".join(hints) if hints else ""
        system = DEVOPS_SYSTEM + (f"\n\n{hint_str}" if hint_str else "")
        async for chunk in self._stream(system, prompt):
            yield chunk

    async def stream_diagnose(
        self, logs: str, events: str = ""
    ) -> AsyncGenerator[str, None]:
        content = f"Container logs:\n{logs}"
        if events:
            content += f"\n\nKubernetes events:\n{events}"
        async for chunk in self._stream(SRE_SYSTEM, content, 2048):
            yield chunk

    async def stream_pipeline_task(
        self, task_name: str, prompt: str
    ) -> AsyncGenerator[str, None]:
        system = (
            DEVOPS_SYSTEM
            + f"\n\nCurrent task: {task_name}\n"
            "Generate ONLY the files relevant to this specific task. "
            "Be complete — no placeholders, no TODO comments."
        )
        async for chunk in self._stream(system, prompt):
            yield chunk

    async def stream_generate(
        self, system: str, prompt: str, max_tokens: int = 4096
    ) -> AsyncGenerator[str, None]:
        async for chunk in self._stream(system, prompt, max_tokens):
            yield chunk

    async def stream_chat(
        self, system: str, messages: list[dict], max_tokens: int = 1024
    ) -> AsyncGenerator[str, None]:
        async for chunk in self._chat(system, messages, max_tokens):
            yield chunk


ai = AIService()
