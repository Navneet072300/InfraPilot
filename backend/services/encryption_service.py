"""Symmetric encryption for sensitive config values (webhook URLs, email addresses, etc.)."""
import base64
import hashlib
import json
import os

from cryptography.fernet import Fernet


def _key() -> bytes:
    raw = os.getenv("ENCRYPTION_KEY") or os.getenv("JWT_SECRET", "dev-only-insecure-default-key-change-in-prod")
    return base64.urlsafe_b64encode(hashlib.sha256(raw.encode()).digest())


def encrypt_str(plaintext: str) -> str:
    return Fernet(_key()).encrypt(plaintext.encode()).decode()


def decrypt_str(ciphertext: str) -> str:
    return Fernet(_key()).decrypt(ciphertext.encode()).decode()


def encrypt_dict(data: dict) -> str:
    return encrypt_str(json.dumps(data))


def decrypt_dict(ciphertext: str) -> dict:
    return json.loads(decrypt_str(ciphertext))
