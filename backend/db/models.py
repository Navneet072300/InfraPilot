from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
import uuid

from .database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(30), unique=True, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255), default="")
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_color: Mapped[str] = mapped_column(String(20), default="#6366f1")
    provider: Mapped[str] = mapped_column(String(20), default="email")
    provider_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    phone_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    plan: Mapped[str] = mapped_column(String(20), default="free")
    role: Mapped[str] = mapped_column(String(20), default="owner")
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    totp_pending_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class OTPCode(Base):
    __tablename__ = "otp_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    contact: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(6), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Cluster(Base):
    __tablename__ = "clusters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    environment: Mapped[str] = mapped_column(String(20), default="dev")
    connection_type: Mapped[str] = mapped_column(String(20), default="token")
    api_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    token: Mapped[str | None] = mapped_column(Text, nullable=True)
    kubeconfig: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)


class PlatformSetting(Base):
    __tablename__ = "platform_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    session_token_hash: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    device_info: Mapped[str] = mapped_column(String(255), default="Unknown device")
    ip_address: Mapped[str] = mapped_column(String(64), default="")
    last_active: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class APIKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    key_prefix: Mapped[str] = mapped_column(String(20), nullable=False)
    key_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    scopes: Mapped[str] = mapped_column(String(255), default="read")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    user_email: Mapped[str] = mapped_column(String(255), default="system")
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    resource: Mapped[str] = mapped_column(String(255), default="")
    ip_address: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(20), default="success")
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)


class TeamMember(Base):
    __tablename__ = "team_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_owner_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), default="")
    role: Mapped[str] = mapped_column(String(20), default="member")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class TeamInvite(Base):
    __tablename__ = "team_invites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_owner_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="member")
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    is_cancelled: Mapped[bool] = mapped_column(Boolean, default=False)


class DeployConfig(Base):
    __tablename__ = "deploy_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    repo_full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    branch: Mapped[str] = mapped_column(String(100), default="main")
    language: Mapped[str] = mapped_column(String(50), default="")
    framework: Mapped[str] = mapped_column(String(100), default="")
    ci_tool: Mapped[str] = mapped_column(String(50), default="")
    registry: Mapped[str] = mapped_column(String(50), default="")
    secrets_manager: Mapped[str] = mapped_column(String(50), default="")
    deploy_target: Mapped[str] = mapped_column(String(50), default="")
    port: Mapped[int] = mapped_column(Integer, default=8080)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)


class GenerateSession(Base):
    __tablename__ = "generate_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), default="")
    prompt: Mapped[str] = mapped_column(Text, default="")
    tools: Mapped[str] = mapped_column(Text, default="[]")       # JSON array
    context: Mapped[str] = mapped_column(Text, default="[]")     # JSON array
    files_json: Mapped[str] = mapped_column(Text, default="[]")  # JSON array of {path, content, language}
    meta_json: Mapped[str] = mapped_column(Text, default="{}")   # elapsed, lines, costEstimate
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)


class UserSettings(Base):
    __tablename__ = "user_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, unique=True, index=True)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    default_environment: Mapped[str] = mapped_column(String(20), default="dev")
    default_iac_tool: Mapped[str] = mapped_column(String(20), default="terraform")
    default_cloud: Mapped[str] = mapped_column(String(20), default="aws")
    default_namespace: Mapped[str] = mapped_column(String(100), default="default")
    code_font_size: Mapped[int] = mapped_column(Integer, default=14)
    avatar_color: Mapped[str] = mapped_column(String(20), default="#6366f1")
    notification_prefs: Mapped[str] = mapped_column(Text, default="{}")
    ai_primary_endpoint: Mapped[str] = mapped_column(Text, default="")
    ai_primary_model: Mapped[str] = mapped_column(String(100), default="gemma4")
    ai_secondary_endpoint: Mapped[str] = mapped_column(Text, default="")
    ai_secondary_model: Mapped[str] = mapped_column(String(100), default="qwen3:32b")
    ai_temperature: Mapped[str] = mapped_column(String(10), default="0.2")
    ai_max_tokens: Mapped[int] = mapped_column(Integer, default=4000)
    ai_streaming: Mapped[bool] = mapped_column(Boolean, default=True)
    ai_system_prompt_addendum: Mapped[str] = mapped_column(Text, default="")
    workspace_name: Mapped[str] = mapped_column(String(100), default="My Workspace")
    require_2fa_team: Mapped[bool] = mapped_column(Boolean, default=False)
    default_member_role: Mapped[str] = mapped_column(String(20), default="member")
    experience_level: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    secrets_json: Mapped[str] = mapped_column(Text, default="[]")
    grafana_org_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    monitoring_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)


class UserSecret(Base):
    __tablename__ = "user_secrets"

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    value_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    secret_type: Mapped[str] = mapped_column(Text, nullable=False, default="other")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)
