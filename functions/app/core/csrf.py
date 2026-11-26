from secrets import token_urlsafe

from itsdangerous import BadSignature, URLSafeTimedSerializer

from app.core.config import settings


def csrf_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.secret_key, salt="admin-csrf")


def new_csrf_token() -> str:
    return csrf_serializer().dumps({"nonce": token_urlsafe(16)})


def verify_csrf_token(token: str | None) -> bool:
    if not token:
        return False
    try:
        data = csrf_serializer().loads(token, max_age=3600)
        return isinstance(data, dict) and bool(data.get("nonce"))
    except BadSignature:
        return False
