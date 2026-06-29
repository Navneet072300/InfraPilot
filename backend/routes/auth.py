import hashlib
import logging
import os
import random
import secrets
import string
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Cookie, Header, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select

from core.security import create_access_token, decode_token, hash_password, verify_password
from db.database import get_session, is_db_available
from db.models import APIKey, OTPCode, User, UserSession, UserSettings
from services import audit_service

limiter = Limiter(key_func=get_remote_address)

SESSION_COOKIE = "ip_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 7  # 7 days

logger = logging.getLogger(__name__)
router = APIRouter()

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", f"{FRONTEND_URL}/api/auth/google/callback")
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "")
GITHUB_REDIRECT_URI = os.getenv("GITHUB_REDIRECT_URI", f"{FRONTEND_URL}/api/auth/github/callback")
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE, value=token, httponly=True,
        max_age=SESSION_MAX_AGE, samesite="lax", secure=False, path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=SESSION_COOKIE, path="/")


def _gen_otp() -> str:
    return "".join(random.choices(string.digits, k=6))


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _parse_ua(ua: str) -> str:
    ua = ua or ""
    if "Chrome" in ua and "Edg" not in ua:
        browser = "Chrome"
    elif "Safari" in ua and "Chrome" not in ua:
        browser = "Safari"
    elif "Firefox" in ua:
        browser = "Firefox"
    elif "Edg" in ua:
        browser = "Edge"
    else:
        browser = "Browser"

    if "Windows" in ua:
        os_name = "Windows"
    elif "Mac" in ua:
        os_name = "macOS"
    elif "Linux" in ua:
        os_name = "Linux"
    elif "iPhone" in ua or "iPad" in ua:
        os_name = "iOS"
    elif "Android" in ua:
        os_name = "Android"
    else:
        os_name = "Unknown OS"

    return f"{browser} on {os_name}"


def _user_to_dict(u: User) -> dict:
    return {
        "id": u.id,
        "name": u.name,
        "email": u.email,
        "phone": u.phone,
        "avatar_url": u.avatar_url,
        "avatar_color": u.avatar_color,
        "plan": u.plan,
        "role": u.role,
        "provider": u.provider,
        "email_verified": u.email_verified,
        "phone_verified": u.phone_verified,
        "totp_enabled": u.totp_enabled,
    }


async def _record_session(user_id: int, token: str, request: Request | None = None) -> None:
    if not is_db_available():
        return
    try:
        ua = ""
        ip = ""
        if request:
            ua = request.headers.get("user-agent", "")
            ip = request.client.host if request.client else ""
        async with get_session() as session:
            sess = UserSession(
                user_id=user_id,
                session_token_hash=_hash_token(token),
                device_info=_parse_ua(ua),
                ip_address=ip,
            )
            session.add(sess)
            await session.commit()
    except Exception as e:
        logger.error("Failed to record session: %s", e)


async def _send_email_otp(email: str, code: str) -> bool:
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — OTP: %s", code)
        return True
    try:
        import resend
        resend.api_key = RESEND_API_KEY
        resend.Emails.send({
            "from": "InfraPilot <noreply@infrapilot.dev>",
            "to": [email],
            "subject": f"Your InfraPilot verification code: {code}",
            "html": f"""
                <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0d1117;color:#e6edf3;border-radius:12px">
                    <h2>Verification code</h2>
                    <div style="font-size:36px;font-weight:800;letter-spacing:0.2em;color:#58a6ff">{code}</div>
                    <p style="color:#8b949e;font-size:13px">Expires in 10 minutes.</p>
                </div>
            """,
        })
        return True
    except Exception as e:
        logger.error("Resend error: %s", e)
        return False


async def _store_otp(contact: str, code: str) -> None:
    if not is_db_available():
        return
    async with get_session() as session:
        otp = OTPCode(
            contact=contact,
            code=code,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        )
        session.add(otp)
        await session.commit()


async def _verify_otp(contact: str, code: str) -> bool:
    if not is_db_available():
        return False
    async with get_session() as session:
        result = await session.execute(
            select(OTPCode)
            .where(OTPCode.contact == contact, OTPCode.code == code, OTPCode.used == False)
            .order_by(OTPCode.created_at.desc())
            .limit(1)
        )
        otp = result.scalar_one_or_none()
        if not otp:
            return False
        if otp.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
            return False
        otp.used = True
        await session.commit()
        return True


# ── Email / Password ──────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    name: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/auth/signup")
@limiter.limit("3/minute")
async def signup(request: Request, req: SignupRequest):
    if not is_db_available():
        raise HTTPException(503, "Database unavailable")
    async with get_session() as session:
        exists = await session.execute(select(User).where(User.email == req.email))
        if exists.scalar_one_or_none():
            raise HTTPException(409, "Email already registered")
        user = User(
            name=req.name, email=req.email,
            hashed_password=hash_password(req.password), provider="email",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

    code = _gen_otp()
    await _store_otp(req.email, code)
    await _send_email_otp(req.email, code)
    logger.info("Signup: email=%s", req.email)
    return {"message": "OTP sent to your email — check your inbox"}


@router.post("/auth/login")
@limiter.limit("5/minute")
async def login(request: Request, req: LoginRequest, response: Response):
    if not is_db_available():
        raise HTTPException(503, "Database unavailable")
    async with get_session() as session:
        result = await session.execute(select(User).where(User.email == req.email))
        user = result.scalar_one_or_none()
    if not user or not user.hashed_password or not verify_password(req.password, user.hashed_password):
        await audit_service.log(None, req.email, "login", "email", request.client.host if request.client else "", "failed")
        raise HTTPException(401, "Invalid email or password")
    token = create_access_token({"sub": str(user.id)})
    _set_session_cookie(response, token)
    await _record_session(user.id, token, request)
    await audit_service.log(user.id, user.email or "", "login", "email", request.client.host if request.client else "")
    logger.info("Login: email=%s", req.email)
    return {"user": _user_to_dict(user)}


# ── OTP ───────────────────────────────────────────────────────────────────────

class OTPSendRequest(BaseModel):
    contact: str


class OTPVerifyRequest(BaseModel):
    contact: str
    code: str
    name: str = ""


@router.post("/auth/otp/send")
@limiter.limit("3/hour", key_func=lambda r: r.query_params.get("contact", get_remote_address(r)))
async def otp_send(request: Request, req: OTPSendRequest):
    code = _gen_otp()
    await _store_otp(req.contact, code)
    ok = await _send_email_otp(req.contact, code)
    if not ok:
        raise HTTPException(500, "Failed to send OTP")
    logger.info("OTP sent: email=%s", req.contact)
    return {"message": "OTP sent to your email"}


@router.post("/auth/otp/verify")
async def otp_verify(req: OTPVerifyRequest, response: Response, request: Request):
    valid = await _verify_otp(req.contact, req.code)
    if not valid:
        raise HTTPException(400, "Invalid or expired OTP")
    if not is_db_available():
        raise HTTPException(503, "Database unavailable")
    async with get_session() as session:
        result = await session.execute(select(User).where(User.email == req.contact))
        user = result.scalar_one_or_none()
        if not user:
            user = User(
                name=req.name or req.contact.split("@")[0],
                email=req.contact, provider="email", email_verified=True,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
        else:
            user.email_verified = True
            await session.commit()
            await session.refresh(user)
    token = create_access_token({"sub": str(user.id)})
    _set_session_cookie(response, token)
    await _record_session(user.id, token, request)
    await audit_service.log(user.id, user.email or "", "login", "otp", request.client.host if request.client else "")
    logger.info("OTP verified: contact=%s", req.contact)
    return {"user": _user_to_dict(user)}


# ── Google OAuth ──────────────────────────────────────────────────────────────

@router.get("/auth/google")
async def google_auth():
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(501, "Google OAuth not configured")
    state = secrets.token_urlsafe(16)
    url = (
        "https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={GOOGLE_CLIENT_ID}&redirect_uri={GOOGLE_REDIRECT_URI}"
        "&response_type=code&scope=openid%20email%20profile"
        f"&state={state}&access_type=offline&prompt=consent"
    )
    return RedirectResponse(url)


@router.get("/auth/google/callback")
async def google_callback(code: str, state: str = "", request: Request = None):
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            token_resp = await client.post(
                "https://oauth2.googleapis.com/token",
                data={"code": code, "client_id": GOOGLE_CLIENT_ID, "client_secret": GOOGLE_CLIENT_SECRET,
                      "redirect_uri": GOOGLE_REDIRECT_URI, "grant_type": "authorization_code"},
            )
            if token_resp.status_code != 200:
                logger.warning("Google token exchange failed: %s %s", token_resp.status_code, token_resp.text[:200])
                return RedirectResponse(f"{FRONTEND_URL}/login?error=google_failed")
            token_data = token_resp.json()
            access_token = token_data.get("access_token")
            if not access_token:
                logger.warning("Google token response missing access_token: %s", token_data)
                return RedirectResponse(f"{FRONTEND_URL}/login?error=google_failed")

            info_resp = await client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if info_resp.status_code != 200:
                logger.warning("Google userinfo failed: %s", info_resp.status_code)
                return RedirectResponse(f"{FRONTEND_URL}/login?error=google_failed")
            info = info_resp.json()

        email = info.get("email", "")
        name = info.get("name", "") or email.split("@")[0]
        avatar = info.get("picture", "")
        provider_id = str(info.get("id", ""))

        if not email:
            logger.warning("Google OAuth: no email in userinfo response")
            return RedirectResponse(f"{FRONTEND_URL}/login?error=google_failed")

        if not is_db_available():
            return RedirectResponse(f"{FRONTEND_URL}/login?error=db_unavailable")

        async with get_session() as session:
            result = await session.execute(select(User).where(User.email == email))
            user = result.scalar_one_or_none()
            if not user:
                user = User(name=name, email=email, avatar_url=avatar, provider="google",
                            provider_id=provider_id, email_verified=True)
                session.add(user)
                await session.commit()
                await session.refresh(user)
            else:
                user.avatar_url = user.avatar_url or avatar
                user.name = user.name or name
                await session.commit()
                await session.refresh(user)

        token = create_access_token({"sub": str(user.id)})
        await _record_session(user.id, token, request)
        await audit_service.log(user.id, email, "login", "google")
        logger.info("Google OAuth login: email=%s", email)
        redirect = RedirectResponse(f"{FRONTEND_URL}/auth/callback", status_code=302)
        _set_session_cookie(redirect, token)
        return redirect

    except Exception as exc:
        logger.exception("Google OAuth callback error: %s", exc)
        return RedirectResponse(f"{FRONTEND_URL}/login?error=google_failed")


# ── GitHub OAuth ──────────────────────────────────────────────────────────────

@router.get("/auth/github")
async def github_auth():
    if not GITHUB_CLIENT_ID:
        raise HTTPException(501, "GitHub OAuth not configured")
    state = secrets.token_urlsafe(16)
    url = (
        "https://github.com/login/oauth/authorize"
        f"?client_id={GITHUB_CLIENT_ID}&redirect_uri={GITHUB_REDIRECT_URI}"
        f"&scope=user:email,repo&state={state}"
    )
    return RedirectResponse(url)


@router.get("/auth/github/callback")
async def github_callback(code: str, state: str = "", request: Request = None):
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            token_resp = await client.post(
                "https://github.com/login/oauth/access_token",
                data={"client_id": GITHUB_CLIENT_ID, "client_secret": GITHUB_CLIENT_SECRET,
                      "code": code, "redirect_uri": GITHUB_REDIRECT_URI},
                headers={"Accept": "application/json"},
            )
            if token_resp.status_code != 200:
                logger.warning("GitHub token exchange failed: %s", token_resp.status_code)
                return RedirectResponse(f"{FRONTEND_URL}/login?error=github_failed")
            token_data = token_resp.json()
            access_token = token_data.get("access_token")
            if not access_token:
                # GitHub returns {"error": "bad_verification_code"} with status 200 on failure
                logger.warning("GitHub token response missing access_token: %s", token_data.get("error", token_data))
                return RedirectResponse(f"{FRONTEND_URL}/login?error=github_failed")

            user_resp = await client.get(
                "https://api.github.com/user",
                headers={"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"},
            )
            email_resp = await client.get(
                "https://api.github.com/user/emails",
                headers={"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"},
            )

        if user_resp.status_code != 200:
            logger.warning("GitHub /user request failed: %s", user_resp.status_code)
            return RedirectResponse(f"{FRONTEND_URL}/login?error=github_failed")

        gh_user = user_resp.json()
        emails = email_resp.json() if email_resp.status_code == 200 else []
        primary_email = next((e["email"] for e in emails if isinstance(e, dict) and e.get("primary")), None)
        if not primary_email:
            primary_email = gh_user.get("email", "")
        name = gh_user.get("name") or gh_user.get("login", "")
        avatar = gh_user.get("avatar_url", "")
        provider_id = str(gh_user.get("id", ""))

        if not primary_email:
            logger.warning("GitHub OAuth: could not determine primary email for user %s", gh_user.get("login"))
            return RedirectResponse(f"{FRONTEND_URL}/login?error=github_no_email")

        if not is_db_available():
            return RedirectResponse(f"{FRONTEND_URL}/login?error=db_unavailable")

        async with get_session() as session:
            result = await session.execute(select(User).where(User.email == primary_email))
            user = result.scalar_one_or_none()
            if not user:
                user = User(name=name, email=primary_email, avatar_url=avatar, provider="github",
                            provider_id=provider_id, email_verified=True)
                session.add(user)
                await session.commit()
                await session.refresh(user)
            else:
                user.avatar_url = user.avatar_url or avatar
                user.name = user.name or name
                await session.commit()
                await session.refresh(user)

        # Persist the GitHub access token so the app can list repos
        try:
            from config import unified_store as _us
            from routes.settings import _fetch_pat_expiry
            await _us.set_platform_setting("github.pat", access_token)
            await _us.set_platform_setting("github.username", gh_user.get("login", ""))
            expiry = await _fetch_pat_expiry(access_token)
            await _us.set_platform_setting("github.pat_expires_at", expiry or "")
        except Exception as _e:
            logger.warning("Could not persist GitHub token: %s", _e)

        token = create_access_token({"sub": str(user.id)})
        await _record_session(user.id, token, request)
        await audit_service.log(user.id, primary_email, "login", "github")
        logger.info("GitHub OAuth login: email=%s user=%s", primary_email, gh_user.get("login"))
        redirect = RedirectResponse(f"{FRONTEND_URL}/auth/callback", status_code=302)
        _set_session_cookie(redirect, token)
        return redirect

    except Exception as exc:
        logger.exception("GitHub OAuth callback error: %s", exc)
        return RedirectResponse(f"{FRONTEND_URL}/login?error=github_failed")


# ── Me / Logout ───────────────────────────────────────────────────────────────

@router.get("/auth/me")
async def me(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    token = ip_session or authorization.removeprefix("Bearer ").strip()
    payload = decode_token(token)
    if not payload:
        raise HTTPException(401, "Not authenticated")
    user_id = int(payload.get("sub", 0))
    if not is_db_available():
        raise HTTPException(503, "Database unavailable")
    async with get_session() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(404, "User not found")
        settings_result = await session.execute(select(UserSettings).where(UserSettings.user_id == user_id))
        settings = settings_result.scalar_one_or_none()
    d = _user_to_dict(user)
    d["experience_level"] = settings.experience_level if settings else None
    return d


@router.post("/auth/logout")
async def logout(
    response: Response,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    token = ip_session or authorization.removeprefix("Bearer ").strip()
    _clear_session_cookie(response)
    if token and is_db_available():
        token_hash = _hash_token(token)
        async with get_session() as session:
            result = await session.execute(
                select(UserSession).where(UserSession.session_token_hash == token_hash)
            )
            sess = result.scalar_one_or_none()
            if sess:
                sess.is_revoked = True
                await session.commit()
    return {"message": "Logged out"}


# ── Change Password ───────────────────────────────────────────────────────────

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/auth/change-password")
async def change_password(
    req: ChangePasswordRequest,
    request: Request,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    token = ip_session or authorization.removeprefix("Bearer ").strip()
    payload = decode_token(token)
    if not payload:
        raise HTTPException(401, "Not authenticated")
    user_id = int(payload.get("sub", 0))
    if not is_db_available():
        raise HTTPException(503, "Database unavailable")

    async with get_session() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(404, "User not found")
        if not user.hashed_password or not verify_password(req.current_password, user.hashed_password):
            raise HTTPException(401, "Current password is incorrect")
        if len(req.new_password) < 8:
            raise HTTPException(400, "New password must be at least 8 characters")
        user.hashed_password = hash_password(req.new_password)
        await session.commit()

    await audit_service.log(user_id, user.email or "", "password.changed", "account",
                            request.client.host if request.client else "")
    return {"message": "Password updated successfully"}


# ── Active Sessions ───────────────────────────────────────────────────────────

@router.get("/auth/sessions")
async def list_sessions(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    token = ip_session or authorization.removeprefix("Bearer ").strip()
    payload = decode_token(token)
    if not payload:
        raise HTTPException(401, "Not authenticated")
    user_id = int(payload.get("sub", 0))
    current_hash = _hash_token(token) if token else ""

    if not is_db_available():
        return {"sessions": []}

    async with get_session() as session:
        result = await session.execute(
            select(UserSession).where(
                UserSession.user_id == user_id,
                UserSession.is_revoked == False,
            ).order_by(UserSession.last_active.desc())
        )
        sessions = result.scalars().all()

    return {
        "sessions": [
            {
                "id": s.id,
                "device_info": s.device_info,
                "ip_address": s.ip_address,
                "last_active": s.last_active.isoformat(),
                "created_at": s.created_at.isoformat(),
                "is_current": s.session_token_hash == current_hash,
            }
            for s in sessions
        ]
    }


@router.delete("/auth/sessions/{session_id}", status_code=204)
async def revoke_session(
    session_id: int,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    token = ip_session or authorization.removeprefix("Bearer ").strip()
    payload = decode_token(token)
    if not payload:
        raise HTTPException(401, "Not authenticated")
    user_id = int(payload.get("sub", 0))

    if not is_db_available():
        return

    async with get_session() as session:
        result = await session.execute(
            select(UserSession).where(UserSession.id == session_id, UserSession.user_id == user_id)
        )
        sess = result.scalar_one_or_none()
        if not sess:
            raise HTTPException(404, "Session not found")
        sess.is_revoked = True
        await session.commit()


@router.delete("/auth/sessions", status_code=204)
async def revoke_all_other_sessions(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    token = ip_session or authorization.removeprefix("Bearer ").strip()
    payload = decode_token(token)
    if not payload:
        raise HTTPException(401, "Not authenticated")
    user_id = int(payload.get("sub", 0))
    current_hash = _hash_token(token) if token else ""

    if not is_db_available():
        return

    async with get_session() as session:
        result = await session.execute(
            select(UserSession).where(
                UserSession.user_id == user_id,
                UserSession.is_revoked == False,
                UserSession.session_token_hash != current_hash,
            )
        )
        for sess in result.scalars().all():
            sess.is_revoked = True
        await session.commit()


# ── 2FA / TOTP ────────────────────────────────────────────────────────────────

@router.get("/auth/2fa/setup")
async def setup_2fa(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    token = ip_session or authorization.removeprefix("Bearer ").strip()
    payload = decode_token(token)
    if not payload:
        raise HTTPException(401, "Not authenticated")
    user_id = int(payload.get("sub", 0))
    if not is_db_available():
        raise HTTPException(503, "Database unavailable")

    try:
        import pyotp
    except ImportError:
        raise HTTPException(501, "pyotp library not installed")

    async with get_session() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(404, "User not found")
        totp_secret = pyotp.random_base32()
        user.totp_pending_secret = totp_secret
        await session.commit()

    totp = pyotp.TOTP(totp_secret)
    provisioning_uri = totp.provisioning_uri(
        name=user.email or f"user_{user_id}",
        issuer_name="InfraPilot",
    )
    return {
        "secret": totp_secret,
        "otpauth_uri": provisioning_uri,
    }


class TOTPVerifyRequest(BaseModel):
    code: str


@router.post("/auth/2fa/enable")
async def enable_2fa(
    req: TOTPVerifyRequest,
    request: Request,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    token = ip_session or authorization.removeprefix("Bearer ").strip()
    payload = decode_token(token)
    if not payload:
        raise HTTPException(401, "Not authenticated")
    user_id = int(payload.get("sub", 0))
    if not is_db_available():
        raise HTTPException(503, "Database unavailable")

    try:
        import pyotp
    except ImportError:
        raise HTTPException(501, "pyotp library not installed")

    async with get_session() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user or not user.totp_pending_secret:
            raise HTTPException(400, "No pending 2FA setup — call /auth/2fa/setup first")
        totp = pyotp.TOTP(user.totp_pending_secret)
        if not totp.verify(req.code, valid_window=1):
            raise HTTPException(400, "Invalid TOTP code")
        user.totp_secret = user.totp_pending_secret
        user.totp_pending_secret = None
        user.totp_enabled = True
        await session.commit()

    backup_codes = [secrets.token_hex(4).upper() for _ in range(8)]
    await audit_service.log(user_id, user.email or "", "2fa.enabled", "account",
                            request.client.host if request.client else "")
    return {"message": "2FA enabled", "backup_codes": backup_codes}


@router.post("/auth/2fa/disable")
async def disable_2fa(
    req: TOTPVerifyRequest,
    request: Request,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    token = ip_session or authorization.removeprefix("Bearer ").strip()
    payload = decode_token(token)
    if not payload:
        raise HTTPException(401, "Not authenticated")
    user_id = int(payload.get("sub", 0))
    if not is_db_available():
        raise HTTPException(503, "Database unavailable")

    try:
        import pyotp
    except ImportError:
        raise HTTPException(501, "pyotp library not installed")

    async with get_session() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user or not user.totp_enabled or not user.totp_secret:
            raise HTTPException(400, "2FA is not enabled")
        totp = pyotp.TOTP(user.totp_secret)
        if not totp.verify(req.code, valid_window=1):
            raise HTTPException(400, "Invalid TOTP code")
        user.totp_secret = None
        user.totp_enabled = False
        await session.commit()

    await audit_service.log(user_id, user.email or "", "2fa.disabled", "account",
                            request.client.host if request.client else "")
    return {"message": "2FA disabled"}


# ── API Keys ──────────────────────────────────────────────────────────────────

class APIKeyCreateRequest(BaseModel):
    name: str
    scopes: list[str] = ["read"]
    expiry_days: int | None = 90


@router.get("/auth/api-keys")
async def list_api_keys(
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    token = ip_session or authorization.removeprefix("Bearer ").strip()
    payload = decode_token(token)
    if not payload:
        raise HTTPException(401, "Not authenticated")
    user_id = int(payload.get("sub", 0))

    if not is_db_available():
        return {"keys": []}

    async with get_session() as session:
        result = await session.execute(
            select(APIKey).where(APIKey.user_id == user_id, APIKey.is_revoked == False)
            .order_by(APIKey.created_at.desc())
        )
        keys = result.scalars().all()

    return {
        "keys": [
            {
                "id": k.id,
                "name": k.name,
                "key_prefix": k.key_prefix + "****" + k.key_hash[-4:],
                "scopes": k.scopes.split(","),
                "expires_at": k.expires_at.isoformat() if k.expires_at else None,
                "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None,
                "created_at": k.created_at.isoformat(),
            }
            for k in keys
        ]
    }


@router.post("/auth/api-keys", status_code=201)
async def create_api_key(
    req: APIKeyCreateRequest,
    request: Request,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    token = ip_session or authorization.removeprefix("Bearer ").strip()
    payload = decode_token(token)
    if not payload:
        raise HTTPException(401, "Not authenticated")
    user_id = int(payload.get("sub", 0))

    raw_key = "sk-ip-" + secrets.token_urlsafe(32)
    prefix = raw_key[:12]
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    expires_at = (
        datetime.now(timezone.utc) + timedelta(days=req.expiry_days)
        if req.expiry_days else None
    )

    if not is_db_available():
        raise HTTPException(503, "Database unavailable")

    async with get_session() as session:
        api_key = APIKey(
            user_id=user_id,
            name=req.name,
            key_prefix=prefix,
            key_hash=key_hash,
            scopes=",".join(req.scopes),
            expires_at=expires_at,
        )
        session.add(api_key)
        await session.commit()
        await session.refresh(api_key)

    await audit_service.log(user_id, "", "api_key.created", req.name,
                            request.client.host if request.client else "")
    return {
        "id": api_key.id,
        "name": api_key.name,
        "key": raw_key,
        "scopes": req.scopes,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "created_at": api_key.created_at.isoformat(),
    }


@router.delete("/auth/api-keys/{key_id}", status_code=204)
async def revoke_api_key(
    key_id: int,
    request: Request,
    ip_session: str = Cookie(default=""),
    authorization: str = Header(default=""),
):
    token = ip_session or authorization.removeprefix("Bearer ").strip()
    payload = decode_token(token)
    if not payload:
        raise HTTPException(401, "Not authenticated")
    user_id = int(payload.get("sub", 0))

    if not is_db_available():
        return

    async with get_session() as session:
        result = await session.execute(
            select(APIKey).where(APIKey.id == key_id, APIKey.user_id == user_id)
        )
        key = result.scalar_one_or_none()
        if not key:
            raise HTTPException(404, "API key not found")
        key.is_revoked = True
        await session.commit()

    await audit_service.log(user_id, "", "api_key.revoked", str(key_id),
                            request.client.host if request.client else "")
