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

    async def list_repos_async(self, per_page: int = 50, page: int = 1) -> dict:
        """List repos using async httpx — avoids blocking the event loop."""
        if not self._pat:
            return {"repos": [], "auth_required": True, "error": "No GitHub token configured. Go to Settings → GitHub and add a Personal Access Token."}
        headers = {
            "Authorization": f"Bearer {self._pat}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        import httpx
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(
                    "https://api.github.com/user/repos",
                    headers=headers,
                    params={"per_page": per_page, "page": page, "sort": "updated", "direction": "desc", "affiliation": "owner,collaborator,organization_member"},
                )
            if resp.status_code == 401:
                return {"repos": [], "auth_required": True, "error": "GitHub token is expired or missing repo scope. Add a new PAT in Settings → GitHub."}
            if resp.status_code != 200:
                return {"repos": [], "error": f"GitHub API error {resp.status_code}: {resp.text[:200]}"}
            raw = resp.json()
            result = [
                {
                    "id": r["id"],
                    "name": r["name"],
                    "full_name": r["full_name"],
                    "description": r.get("description") or "",
                    "private": r["private"],
                    "url": r["html_url"],
                    "clone_url": r["clone_url"],
                    "default_branch": r.get("default_branch", "main"),
                    "language": r.get("language") or "",
                    "stars": r.get("stargazers_count", 0),
                    "forks": r.get("forks_count", 0),
                    "updated_at": r.get("updated_at", ""),
                    "topics": r.get("topics", []),
                }
                for r in raw
            ]
            return {"repos": result, "page": page, "has_more": len(raw) == per_page}
        except Exception as e:
            logger.error("list_repos error: %s", e)
            return {"repos": [], "error": str(e)}

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

    async def get_branches(self, repo_full_name: str) -> list[str]:
        """Return branch names for the given repo (owner/repo)."""
        if not self._pat:
            return []
        headers = {
            "Authorization": f"Bearer {self._pat}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        import httpx
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(
                    f"https://api.github.com/repos/{repo_full_name}/branches",
                    headers=headers,
                    params={"per_page": 100},
                )
            if resp.status_code != 200:
                return []
            return [b["name"] for b in resp.json()]
        except Exception as e:
            logger.error("get_branches error: %s", e)
            return []

    async def create_branch(self, repo_full_name: str, branch_name: str, from_branch: str = "main") -> dict:
        """Create a new branch from the tip of from_branch."""
        if not self._pat:
            return {"created": False, "error": "No GitHub token configured"}
        headers = {
            "Authorization": f"Bearer {self._pat}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        import httpx
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                # Get the SHA of from_branch
                ref_resp = await client.get(
                    f"https://api.github.com/repos/{repo_full_name}/git/ref/heads/{from_branch}",
                    headers=headers,
                )
                if ref_resp.status_code != 200:
                    return {"created": False, "error": f"Source branch '{from_branch}' not found"}
                sha = ref_resp.json()["object"]["sha"]

                # Create new branch ref
                create_resp = await client.post(
                    f"https://api.github.com/repos/{repo_full_name}/git/refs",
                    headers=headers,
                    json={"ref": f"refs/heads/{branch_name}", "sha": sha},
                )
                if create_resp.status_code == 201:
                    return {"created": True, "branch": branch_name, "sha": sha}
                if create_resp.status_code == 422:
                    return {"created": False, "error": f"Branch '{branch_name}' already exists"}
                return {"created": False, "error": f"GitHub API error {create_resp.status_code}"}
        except Exception as e:
            logger.error("create_branch error: %s", e)
            return {"created": False, "error": str(e)}

    async def list_repos_async(self, per_page: int = 50, page: int = 1, search: str = "", org: str = "") -> dict:
        """List repos grouped by owner with org detection."""
        if not self._pat:
            return {"repos": [], "orgs": [], "auth_required": True, "error": "No GitHub token configured. Go to Settings → GitHub and add a Personal Access Token."}
        headers = {
            "Authorization": f"Bearer {self._pat}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        import httpx
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(
                    "https://api.github.com/user/repos",
                    headers=headers,
                    params={
                        "per_page": per_page, "page": page,
                        "sort": "updated", "direction": "desc",
                        "type": "all",
                    },
                )
            if resp.status_code == 401:
                return {"repos": [], "orgs": [], "auth_required": True, "error": "GitHub token is expired or missing repo scope."}
            if resp.status_code != 200:
                return {"repos": [], "orgs": [], "error": f"GitHub API error {resp.status_code}"}
            raw = resp.json()

            orgs_seen: set[str] = set()
            result = []
            for r in raw:
                owner = r["owner"]["login"]
                owner_type = r["owner"]["type"]  # "User" or "Organization"
                is_org = owner_type == "Organization"
                if is_org:
                    orgs_seen.add(owner)
                item = {
                    "id": r["id"],
                    "name": r["name"],
                    "full_name": r["full_name"],
                    "description": r.get("description") or "",
                    "private": r["private"],
                    "url": r["html_url"],
                    "clone_url": r["clone_url"],
                    "default_branch": r.get("default_branch", "main"),
                    "language": r.get("language") or "",
                    "stars": r.get("stargazers_count", 0),
                    "forks": r.get("forks_count", 0),
                    "updated_at": r.get("updated_at", ""),
                    "topics": r.get("topics", []),
                    "owner": owner,
                    "is_org": is_org,
                    "org": owner if is_org else None,
                }
                result.append(item)

            # Apply filters
            if search:
                q = search.lower()
                result = [r for r in result if q in r["name"].lower() or q in r["full_name"].lower()]
            if org:
                result = [r for r in result if r.get("owner") == org]

            # Sort: org repos first (by owner), then personal, each group by updated_at desc
            result.sort(key=lambda r: (0 if r["is_org"] else 1, r["updated_at"]), reverse=False)

            return {
                "repos": result,
                "orgs": sorted(orgs_seen),
                "page": page,
                "has_more": len(raw) == per_page,
            }
        except Exception as e:
            logger.error("list_repos error: %s", e)
            return {"repos": [], "orgs": [], "error": str(e)}

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

    async def create_pull_request(
        self,
        repo_full_name: str,
        title: str,
        body: str,
        branch_name: str,
        base_branch: str,
        files: list[dict],
    ) -> dict:
        """Create a branch, push files, then open a PR. All async via httpx."""
        if not self._pat:
            return {"success": False, "error": "No GitHub token configured"}
        import httpx
        headers = {
            "Authorization": f"Bearer {self._pat}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        GH = "https://api.github.com"
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                # 1. Get base branch SHA
                ref_resp = await client.get(
                    f"{GH}/repos/{repo_full_name}/git/ref/heads/{base_branch}",
                    headers=headers,
                )
                if ref_resp.status_code != 200:
                    return {"success": False, "error": f"Base branch '{base_branch}' not found"}
                base_sha = ref_resp.json()["object"]["sha"]

                # 2. Create branch (ok if already exists)
                br_resp = await client.post(
                    f"{GH}/repos/{repo_full_name}/git/refs",
                    headers=headers,
                    json={"ref": f"refs/heads/{branch_name}", "sha": base_sha},
                )
                if br_resp.status_code not in (201, 422):
                    return {"success": False, "error": f"Cannot create branch: {br_resp.status_code}"}

                # 3. Commit each file
                for f in files:
                    # Check for existing blob SHA (needed for updates)
                    contents_resp = await client.get(
                        f"{GH}/repos/{repo_full_name}/contents/{f['path']}",
                        headers=headers,
                        params={"ref": branch_name},
                    )
                    payload: dict = {
                        "message": f"fix: update {f['path']}",
                        "content": base64.b64encode(f["content"].encode()).decode(),
                        "branch": branch_name,
                    }
                    if contents_resp.status_code == 200:
                        payload["sha"] = contents_resp.json().get("sha", "")
                    put_resp = await client.put(
                        f"{GH}/repos/{repo_full_name}/contents/{f['path']}",
                        headers=headers,
                        json=payload,
                    )
                    if put_resp.status_code not in (200, 201):
                        return {"success": False, "error": f"Failed to push {f['path']}: {put_resp.status_code}"}

                # 4. Open the PR
                pr_resp = await client.post(
                    f"{GH}/repos/{repo_full_name}/pulls",
                    headers=headers,
                    json={
                        "title": title,
                        "body": body,
                        "head": branch_name,
                        "base": base_branch,
                        "draft": False,
                    },
                )
                if pr_resp.status_code not in (200, 201):
                    err = pr_resp.json().get("errors", [{}])
                    msg = err[0].get("message", pr_resp.text[:200]) if err else pr_resp.text[:200]
                    return {"success": False, "error": f"PR creation failed: {msg}"}

                pr = pr_resp.json()
                return {
                    "success": True,
                    "pr_number": pr["number"],
                    "pr_url": pr["html_url"],
                    "pr_branch": branch_name,
                    "pr_state": pr["state"],
                }
        except Exception as e:
            logger.error("create_pull_request error: %s", e)
            return {"success": False, "error": str(e)}

    async def get_pr_status(self, repo_full_name: str, pr_number: int) -> dict:
        """Fetch current PR state + CI check status."""
        if not self._pat:
            return {"success": False, "error": "No GitHub token"}
        import httpx
        headers = {
            "Authorization": f"Bearer {self._pat}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        GH = "https://api.github.com"
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                pr_resp = await client.get(
                    f"{GH}/repos/{repo_full_name}/pulls/{pr_number}",
                    headers=headers,
                )
                if pr_resp.status_code != 200:
                    return {"success": False, "error": f"PR not found: {pr_resp.status_code}"}
                pr = pr_resp.json()

                # Get combined CI status
                sha = pr["head"]["sha"]
                checks_resp = await client.get(
                    f"{GH}/repos/{repo_full_name}/commits/{sha}/check-runs",
                    headers=headers,
                )
                checks = checks_resp.json().get("check_runs", []) if checks_resp.status_code == 200 else []
                ci_status = "pending"
                if checks:
                    statuses = {c["conclusion"] for c in checks if c.get("conclusion")}
                    if "failure" in statuses or "cancelled" in statuses:
                        ci_status = "failure"
                    elif all(c.get("conclusion") == "success" for c in checks):
                        ci_status = "success"
                    else:
                        ci_status = "pending"

                return {
                    "success": True,
                    "pr_number": pr["number"],
                    "pr_url": pr["html_url"],
                    "pr_state": pr["state"],
                    "pr_merged": pr.get("merged", False),
                    "pr_mergeable": pr.get("mergeable"),
                    "ci_status": ci_status,
                    "checks": [{"name": c["name"], "status": c["status"], "conclusion": c.get("conclusion")} for c in checks],
                }
        except Exception as e:
            logger.error("get_pr_status error: %s", e)
            return {"success": False, "error": str(e)}
