import logging

from fastapi import APIRouter
from pydantic import BaseModel

from config import settings
from services.github_service import GitHubService

logger = logging.getLogger(__name__)
router = APIRouter()


class AnalyzeRequest(BaseModel):
    repo_url: str
    pat: str | None = None
    username: str | None = None


class PushRequest(BaseModel):
    repo_url: str
    pat: str | None = None
    username: str | None = None
    files: list[dict]
    commit_message: str
    branch: str = "main"


class ValidateRequest(BaseModel):
    pat: str
    username: str | None = None


def _get_github(pat: str | None = None, username: str | None = None) -> GitHubService:
    cfg = settings.load_config()
    gh_cfg = cfg.get("github", {})
    return GitHubService(
        pat=pat or gh_cfg.get("pat"),
        username=username or gh_cfg.get("username"),
    )


@router.post("/github/analyze")
async def analyze_repo(body: AnalyzeRequest):
    gh = _get_github(body.pat, body.username)
    return gh.analyze_repo(body.repo_url)


@router.post("/github/push")
async def push_files(body: PushRequest):
    gh = _get_github(body.pat, body.username)
    return gh.push_files(
        repo_url=body.repo_url,
        files=body.files,
        commit_message=body.commit_message,
        branch=body.branch,
    )


@router.post("/github/validate")
async def validate_token(body: ValidateRequest):
    gh = GitHubService(pat=body.pat, username=body.username)
    return gh.validate()


@router.get("/github/repos")
async def list_repos(per_page: int = 100, page: int = 1, search: str = "", org: str = ""):
    """List all repos (public + private + org) for the authenticated GitHub user."""
    from config.unified_store import get_platform_setting
    pat = await get_platform_setting("github.pat")
    username = await get_platform_setting("github.username")
    if not pat:
        cfg = settings.load_config()
        gh_cfg = cfg.get("github", {})
        pat = gh_cfg.get("pat")
        username = username or gh_cfg.get("username")
    gh = GitHubService(pat=pat or None, username=username or None)
    return await gh.list_repos_async(per_page=per_page, page=page, search=search, org=org)


@router.get("/github/branches")
async def get_branches(repo: str):
    """List branches for a repo (owner/repo format)."""
    from config.unified_store import get_platform_setting
    pat = await get_platform_setting("github.pat")
    if not pat:
        cfg = settings.load_config()
        pat = cfg.get("github", {}).get("pat")
    gh = GitHubService(pat=pat or None)
    branches = await gh.get_branches(repo)
    return {"branches": branches}


class CreateBranchBody(BaseModel):
    repo: str
    branch_name: str
    from_branch: str = "main"


@router.post("/github/branches")
async def create_branch(body: CreateBranchBody):
    """Create a branch in a repo."""
    from config.unified_store import get_platform_setting
    pat = await get_platform_setting("github.pat")
    if not pat:
        cfg = settings.load_config()
        pat = cfg.get("github", {}).get("pat")
    gh = GitHubService(pat=pat or None)
    return await gh.create_branch(body.repo, body.branch_name, body.from_branch)
