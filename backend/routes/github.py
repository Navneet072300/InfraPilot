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
