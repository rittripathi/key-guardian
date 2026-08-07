import base64
import hashlib
import os

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from itsdangerous import BadSignature, URLSafeTimedSerializer

from app.config import settings

_hasher = PasswordHasher()
_serializer = URLSafeTimedSerializer(settings.secret_key, salt="keyshort-session")
#passwords / passphrases 

def hash_secret(raw: str) -> str:
    return _hasher.hash(raw)


def verify_secret(hashed: str, raw: str) -> bool:
    try:
        return _hasher.verify(hashed, raw)
    except (VerifyMismatchError, Exception):  # noqa: BLE001 - any argon2 failure means "no"
        return False


# ---------- sessions ----------

def make_session(user_id: int) -> str:
    return _serializer.dumps({"uid": user_id})


def read_session(token: str) -> int | None:
    try:
        data = _serializer.loads(token, max_age=settings.session_max_age)
    except BadSignature:
        return None
    except Exception:  # noqa: BLE001
        return None
    uid = data.get("uid")
    return int(uid) if uid is not None else None


# ---------- provider key encryption (AES-256-GCM) ----------

def _aes_key() -> bytes:
    raw = settings.encryption_key.strip()
    if not raw:
        # Deterministic dev fallback so the app boots; production must set ENCRYPTION_KEY.
        return hashlib.sha256(settings.secret_key.encode()).digest()
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise ValueError("ENCRYPTION_KEY must be base64 of exactly 32 bytes")
    return key


def encrypt_secret(plaintext: str) -> str:
    nonce = os.urandom(12)
    ct = AESGCM(_aes_key()).encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ct).decode()


def decrypt_secret(blob: str) -> str:
    raw = base64.b64decode(blob)
    nonce, ct = raw[:12], raw[12:]
    return AESGCM(_aes_key()).decrypt(nonce, ct, None).decode()


def generate_encryption_key() -> str:
    """Helper for the README: prints a valid ENCRYPTION_KEY."""
    return base64.b64encode(os.urandom(32)).decode()


if __name__ == "__main__":
    print(generate_encryption_key())
