from flask import Request

from app.core.security import session_serializer, verify_password, verify_session_token
from app.db.repositories import users_repo
from app.models.types import UserRole, UserStatus

SESSION_COOKIE = "admin_session"


def authenticate_admin(email: str, password: str):
    user = users_repo.by_email(email)
    if not user or user.get("role") != UserRole.admin.value:
        return None
    if user.get("status") != UserStatus.active.value or not user.get("password_hash"):
        return None
    if not verify_password(password, user.get("password_hash")):
        return None
    return user


def create_session_cookie(user) -> str:
    return session_serializer().dumps({"uid": user.id, "role": user.get("role")})


def get_admin_user(request: Request):
    token = request.cookies.get(SESSION_COOKIE)
    data = verify_session_token(token) if token else None
    if not data or data.get("role") != UserRole.admin.value:
        return None
    user = users_repo.get(data.get("uid"))
    if not user or user.get("role") != UserRole.admin.value or user.get("status") != UserStatus.active.value:
        return None
    return user
