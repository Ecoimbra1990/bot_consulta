import base64
import hashlib
from datetime import UTC, datetime, timedelta

from cryptography.fernet import Fernet, InvalidToken
from itsdangerous import BadSignature, URLSafeTimedSerializer
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def _as_key(value: str) -> bytes:
    raw = value.encode("utf-8") if isinstance(value, str) else value
    try:
        Fernet(raw)
        return raw
    except Exception:
        return base64.urlsafe_b64encode(hashlib.sha256(raw).digest())


def _current_key() -> bytes:
    if settings.fernet_key:
        return _as_key(settings.fernet_key)
    return base64.urlsafe_b64encode(hashlib.sha256(settings.secret_key.encode("utf-8")).digest())


def _all_keys() -> list[bytes]:
    keys = [_current_key()]
    for item in settings.fernet_previous_keys.split(","):
        if item.strip():
            keys.append(_as_key(item.strip()))
    unique: list[bytes] = []
    for key in keys:
        if key not in unique:
            unique.append(key)
    return unique


def encrypt_text(value: str) -> str:
    return Fernet(_current_key()).encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_text(value: str) -> str:
    for key in _all_keys():
        try:
            return Fernet(key).decrypt(value.encode("utf-8")).decode("utf-8")
        except InvalidToken:
            continue
    return ""


def session_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.secret_key, salt="admin-session")


def mask_cpf(value: str) -> str:
    digits = "".join(ch for ch in value if ch.isdigit())
    if len(digits) != 11:
        return "***"
    return f"***.{digits[3:6]}.{digits[6:9]}-**"


def mask_cnpj(value: str) -> str:
    digits = "".join(ch for ch in value if ch.isdigit())
    if len(digits) != 14:
        return "***"
    return f"**.***.***/{digits[8:12]}-**"


def mask_phone(value: str) -> str:
    digits = "".join(ch for ch in value if ch.isdigit())
    if len(digits) < 10:
        return "***"
    return f"({digits[:2]}) ****-{digits[-4:]}"


def mask_plate(value: str) -> str:
    v = "".join(ch for ch in value if ch.isalnum()).upper()
    if len(v) < 4:
        return "***"
    return f"{v[:3]}***{v[-1]}"


def utcnow() -> datetime:
    return datetime.now(UTC)


def expires_in(days: int) -> datetime:
    return utcnow() + timedelta(days=days)


def verify_session_token(token: str, max_age: int = 60 * 60 * 12) -> dict | None:
    try:
        return session_serializer().loads(token, max_age=max_age)
    except BadSignature:
        return None
