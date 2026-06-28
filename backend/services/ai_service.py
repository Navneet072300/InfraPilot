import json
import logging
import os
from typing import AsyncGenerator

import httpx

logger = logging.getLogger(__name__)

DEVOPS_SYSTEM = """You are an expert DevOps engineer and infrastructure architect with deep knowledge of \
Kubernetes, Terraform, GitHub Actions, ArgoCD, HashiCorp Vault, Kustomize, and Helm.
Generate production-ready infrastructure code. Include:
- Proper resource limits and requests
- Health checks and readiness probes
- Security contexts where appropriate
- Meaningful comments explaining non-obvious choices
- Best practices for the specified cloud/tool

Format multi-file output using EXACTLY this separator format:
--- FILE: path/to/file.yaml ---
[content]
--- FILE: path/to/other.tf ---
[content]

Use real, complete configurations — not placeholders.

REQUIRED: After all infrastructure files, always append a file named 'guideme.md' using the same --- FILE: guideme.md --- separator. Include exactly these sections:
## What Was Generated
[2-3 sentence summary of what this infrastructure does]
## Prerequisites
[exact tools + versions: terraform >= x.y, kubectl >= x.y, aws-cli, etc.]
## Step-by-Step Implementation
[numbered steps with exact shell commands the user can copy-paste]
## Verify It Worked
[commands to confirm the deployment succeeded]
## Troubleshooting
[3-5 specific error messages and their fixes for this exact configuration]"""

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


def _ollama_url() -> str | None:
    return os.environ.get("OLLAMA_URL", "").rstrip("/") or None


def _ollama_model() -> str:
    return os.environ.get("OLLAMA_MODEL", "gemma4:31b")


def _groq_key() -> str | None:
    return os.environ.get("GROQ_API_KEY", "").strip() or None


class AIService:
    # ── Ollama streaming ──────────────────────────────────────────────────────

    async def _stream_ollama(
        self, system: str, prompt: str, max_tokens: int = 4096
    ) -> AsyncGenerator[str, None]:
        base = _ollama_url()
        model = _ollama_model()
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "stream": True,
            "options": {"num_predict": max_tokens},
        }
        # Short connect timeout so pod restarts fail fast; long read for generation
        timeout = httpx.Timeout(connect=8.0, read=120.0, write=30.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                f"{base}/api/chat",
                json=payload,
            ) as resp:
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

    # ── Groq streaming (OpenAI-compatible) ───────────────────────────────────

    async def _stream_groq(
        self, system: str, prompt: str, max_tokens: int = 4096
    ) -> AsyncGenerator[str, None]:
        api_key = _groq_key()
        if not api_key:
            raise RuntimeError("GROQ_API_KEY not set")
        model = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
        payload = {
            "model": model,
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

    # ── Anthropic streaming (final fallback) ─────────────────────────────────

    async def _stream_anthropic(
        self, system: str, prompt: str, max_tokens: int = 4096
    ) -> AsyncGenerator[str, None]:
        try:
            import anthropic
        except ImportError:
            raise RuntimeError("anthropic package not installed")

        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("No AI provider available: set OLLAMA_URL, GROQ_API_KEY, or ANTHROPIC_API_KEY")

        client = anthropic.Anthropic(api_key=api_key)
        model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")
        with client.messages.stream(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            for text in stream.text_stream:
                yield text

    # ── Unified dispatcher: Ollama → Groq → Anthropic ────────────────────────

    async def _stream(
        self, system: str, prompt: str, max_tokens: int = 4096
    ) -> AsyncGenerator[str, None]:
        # 1. Try Ollama
        if _ollama_url():
            logger.info("AI: trying Ollama model=%s", _ollama_model())
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
                return  # don't mix providers mid-response

        # 2. Try Groq
        if _groq_key():
            logger.info("AI: using Groq model=%s", os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile"))
            yielded_any = False
            try:
                async for chunk in self._stream_groq(system, prompt, max_tokens):
                    yielded_any = True
                    yield chunk
                return
            except httpx.HTTPStatusError as e:
                logger.warning("Groq HTTP %s — trying Anthropic", e.response.status_code)
                if e.response.status_code == 401:
                    logger.error("Groq 401: check GROQ_API_KEY in .env")
            except Exception as e:
                logger.warning("Groq error (%s) — trying Anthropic", e)
            if yielded_any:
                return

        # 3. Anthropic final fallback
        logger.info("AI: using Anthropic")
        async for chunk in self._stream_anthropic(system, prompt, max_tokens):
            yield chunk

    # ── Public API ────────────────────────────────────────────────────────────

    async def stream_devops(
        self, prompt: str, tools: list[str] | None = None, context: str = ""
    ) -> AsyncGenerator[str, None]:
        tools_str = ", ".join(tools) if tools else "Kubernetes, Terraform"

        # Detect target cloud from context pills; default to multi-cloud if ambiguous
        ctx_lower = context.lower()
        if "azure" in ctx_lower and "aws" not in ctx_lower and "gcp" not in ctx_lower:
            cloud_hint = "Target cloud: Azure. Use azurerm provider. AKS instead of EKS, Azure Storage instead of S3, Azure SQL/Cosmos instead of RDS."
        elif "gcp" in ctx_lower and "aws" not in ctx_lower and "azure" not in ctx_lower:
            cloud_hint = "Target cloud: GCP. Use google provider. GKE instead of EKS, GCS instead of S3, Cloud SQL instead of RDS."
        elif "aws" in ctx_lower and "azure" not in ctx_lower and "gcp" not in ctx_lower:
            cloud_hint = "Target cloud: AWS. Use aws provider."
        elif context:
            cloud_hint = f"Platform context: {context}. Match the Terraform provider and resource names to the specified cloud(s). If multiple clouds are selected, generate provider blocks for each."
        else:
            cloud_hint = "Default to AWS provider unless the prompt specifies otherwise."

        system = DEVOPS_SYSTEM + f"\n\nPrimary tools for this task: {tools_str}.\n{cloud_hint}"
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

    # ── Multi-turn chat ───────────────────────────────────────────────────────

    async def _chat_ollama(
        self, system: str, messages: list[dict], max_tokens: int
    ) -> AsyncGenerator[str, None]:
        base = _ollama_url()
        model = _ollama_model()
        payload = {
            "model": model,
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

    async def _chat_groq(
        self, system: str, messages: list[dict], max_tokens: int
    ) -> AsyncGenerator[str, None]:
        api_key = _groq_key()
        if not api_key:
            raise RuntimeError("GROQ_API_KEY not set")
        model = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
        payload = {
            "model": model,
            "messages": [{"role": "system", "content": system}] + messages,
            "max_tokens": max_tokens,
            "stream": True,
        }
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        timeout = httpx.Timeout(connect=8.0, read=120.0, write=30.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", "https://api.groq.com/openai/v1/chat/completions", json=payload, headers=headers) as resp:
                resp.raise_for_status()
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

    async def stream_chat(
        self, system: str, messages: list[dict], max_tokens: int = 1024
    ) -> AsyncGenerator[str, None]:
        """Multi-turn chat with full message history. Ollama → Groq → Anthropic."""
        if _ollama_url():
            yielded_any = False
            try:
                async for chunk in self._chat_ollama(system, messages, max_tokens):
                    yielded_any = True
                    yield chunk
                return
            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout, httpx.HTTPStatusError) as e:
                logger.warning("Ollama chat (%s) — trying Groq", e)
            except Exception as e:
                logger.warning("Ollama chat (%s) — trying Groq", e)
            if yielded_any:
                return

        if _groq_key():
            yielded_any = False
            try:
                async for chunk in self._chat_groq(system, messages, max_tokens):
                    yielded_any = True
                    yield chunk
                return
            except Exception as e:
                logger.warning("Groq chat (%s) — trying Anthropic", e)
            if yielded_any:
                return

        try:
            import anthropic
            api_key = os.environ.get("ANTHROPIC_API_KEY")
            if api_key:
                client = anthropic.Anthropic(api_key=api_key)
                model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")
                with client.messages.stream(model=model, max_tokens=max_tokens, system=system, messages=messages) as stream:
                    for text in stream.text_stream:
                        yield text
                return
        except Exception as e:
            logger.error("Anthropic chat error: %s", e)

        raise RuntimeError("No AI provider available")


ai = AIService()
