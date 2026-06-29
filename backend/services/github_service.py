import base64
import logging
import re
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


def _parse_repo(url: str) -> tuple[str, str]:
    """Extract (owner, repo) from a GitHub URL."""
    url = url.rstrip("/").removesuffix(".git")
    parts = urlparse(url).path.strip("/").split("/")
    if len(parts) < 2:
        raise ValueError(f"Cannot parse GitHub repo from URL: {url}")
    return parts[0], parts[1]


class GitHubService:
    def __init__(self, pat: str | None = None, username: str | None = None):
        self._pat = pat
        self._username = username
        self._gh = None

    def _client(self):
        if self._gh is None:
            from github import Github, Auth
            if self._pat:
                self._gh = Github(auth=Auth.Token(self._pat))
            else:
                self._gh = Github()  # unauthenticated (rate-limited)
        return self._gh

    def validate(self) -> dict:
        try:
            user = self._client().get_user()
            return {
                "success": True,
                "username": user.login,
                "name": user.name or user.login,
                "avatar": user.avatar_url,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def list_repos(self, per_page: int = 100, page: int = 1) -> dict:
        """List all repos (public + private) the authenticated user can access."""
        if not self._pat:
            return {"repos": [], "auth_required": True, "error": "No GitHub token configured. Go to Settings → GitHub and add a Personal Access Token."}
        try:
            client = self._client()
            user = client.get_user()
            repos = user.get_repos(sort="updated", direction="desc")
            result = []
            start = (page - 1) * per_page
            for i, repo in enumerate(repos):
                if i < start:
                    continue
                if len(result) >= per_page:
                    break
                result.append({
                    "id": repo.id,
                    "name": repo.name,
                    "full_name": repo.full_name,
                    "description": repo.description or "",
                    "private": repo.private,
                    "url": repo.html_url,
                    "clone_url": repo.clone_url,
                    "default_branch": repo.default_branch,
                    "language": repo.language or "",
                    "stars": repo.stargazers_count,
                    "forks": repo.forks_count,
                    "updated_at": repo.updated_at.isoformat() if repo.updated_at else "",
                    "topics": repo.get_topics(),
                })
            return {"repos": result, "page": page, "has_more": len(result) == per_page}
        except Exception as e:
            logger.error("list_repos error: %s", e)
            msg = str(e)
            # 401 means token is expired, revoked, or missing repo scope
            if "401" in msg or "Bad credentials" in msg or "Requires authentication" in msg:
                return {"repos": [], "auth_required": True, "error": "GitHub token is expired or missing repo scope. Sign out and sign back in, or add a new PAT in Settings → GitHub."}
            return {"repos": [], "error": msg}

    def analyze_repo(self, repo_url: str) -> dict:
        """Inspect a repo via GitHub API to detect language, Dockerfile, manifests, etc."""
        try:
            owner, repo_name = _parse_repo(repo_url)
            repo = self._client().get_repo(f"{owner}/{repo_name}")
            contents = {c.path: c for c in repo.get_git_tree(repo.default_branch, recursive=True).tree}

            paths = set(contents.keys())

            has_dockerfile = any("dockerfile" in p.lower() for p in paths)
            has_manifests = any(
                p.endswith((".yaml", ".yml")) and ("k8s" in p or "deploy" in p or "manifest" in p)
                for p in paths
            )
            has_cicd = any(".github/workflows" in p for p in paths)

            # Language detection
            language = "Unknown"
            lang_map = {
                "package.json": "Node.js",
                "requirements.txt": "Python",
                "Gemfile": "Ruby",
                "go.mod": "Go",
                "pom.xml": "Java",
                "Cargo.toml": "Rust",
                "composer.json": "PHP",
            }
            for indicator, lang in lang_map.items():
                if indicator in paths:
                    language = lang
                    break

            # Port detection from Dockerfile
            port = None
            if has_dockerfile:
                try:
                    df_path = next(p for p in paths if "dockerfile" in p.lower())
                    df_content = repo.get_contents(df_path).decoded_content.decode()
                    expose_match = re.search(r"EXPOSE\s+(\d+)", df_content, re.IGNORECASE)
                    if expose_match:
                        port = int(expose_match.group(1))
                except Exception:
                    pass

            if port is None:
                defaults = {"Node.js": 3000, "Python": 8000, "Ruby": 3000, "Go": 8080, "Java": 8080}
                port = defaults.get(language, 8080)

            # Common secrets to look for
            secrets = self._detect_secrets(paths, language)

            return {
                "success": True,
                "language": language,
                "has_dockerfile": has_dockerfile,
                "port": port,
                "has_manifests": has_manifests,
                "has_cicd": has_cicd,
                "secrets": secrets,
                "default_branch": repo.default_branch,
                "private": repo.private,
                "description": repo.description or "",
            }
        except Exception as e:
            logger.error("GitHub analyze error: %s", e)
            return {
                "success": False,
                "error": str(e),
                "language": "Unknown",
                "has_dockerfile": False,
                "port": 8080,
                "has_manifests": False,
                "has_cicd": False,
                "secrets": [],
            }

    def _detect_secrets(self, paths: set, language: str) -> list[str]:
        secrets = []
        common = ["DATABASE_URL", "REDIS_URL", "SECRET_KEY", "JWT_SECRET"]
        if language == "Node.js":
            secrets = common + ["PORT", "NODE_ENV"]
        elif language == "Python":
            secrets = common + ["DJANGO_SECRET_KEY", "CELERY_BROKER_URL"]
        else:
            secrets = common
        return secrets

    def push_files(
        self,
        repo_url: str,
        files: list[dict],
        commit_message: str,
        branch: str = "main",
    ) -> dict:
        """Create or update files in a repo via GitHub Contents API."""
        try:
            owner, repo_name = _parse_repo(repo_url)
            repo = self._client().get_repo(f"{owner}/{repo_name}")

            pushed = []
            for f in files:
                path = f["path"]
                content = f["content"]
                try:
                    existing = repo.get_contents(path, ref=branch)
                    result = repo.update_file(
                        path=path,
                        message=f"{commit_message}: update {path}",
                        content=content,
                        sha=existing.sha,
                        branch=branch,
                    )
                except Exception:
                    result = repo.create_file(
                        path=path,
                        message=f"{commit_message}: add {path}",
                        content=content,
                        branch=branch,
                    )
                pushed.append({
                    "path": path,
                    "sha": result["commit"].sha,
                    "url": result["content"].html_url,
                })

            return {"success": True, "files": pushed, "commit": pushed[0]["sha"] if pushed else ""}
        except Exception as e:
            logger.error("GitHub push error: %s", e)
            return {"success": False, "error": str(e)}
