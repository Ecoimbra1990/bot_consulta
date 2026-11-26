from email_validator import EmailNotValidError, validate_email
from flask import Blueprint, abort, make_response, redirect, render_template, request, url_for

from app.admin.auth import SESSION_COOKIE, authenticate_admin, create_session_cookie, get_admin_user
from app.core.config import settings
from app.core.csrf import new_csrf_token, verify_csrf_token
from app.core.runtime_settings import get_runtime_settings, update_runtime_settings
from app.core.security import hash_password, utcnow
from app.db.repositories import (
    payments_repo,
    plans_repo,
    queries_repo,
    subscriptions_repo,
    users_repo,
)
from app.models.types import UserRole, UserStatus
from app.services.audit import log_action
from app.services.billing import activate_manual_subscription
from app.services.dsr import list_pending_requests, resolve_deletion
from app.services.rate_limit import check_rate_limit

admin_bp = Blueprint("admin", __name__, template_folder="templates", static_folder="static", url_prefix="/admin")


@admin_bp.before_request
def csrf_protection():
    if request.method == "POST" and not verify_csrf_token(request.form.get("csrf_token")):
        abort(400, description="Token CSRF inválido")


@admin_bp.context_processor
def inject_csrf():
    return {"csrf_token": new_csrf_token()}


def require_admin():
    user = get_admin_user(request)
    if not user:
        return None, redirect(url_for("admin.login_page"), code=303)
    return user, None


def _page(repo, *, limit: int = 50):
    cursor = request.args.get("cursor")
    docs = repo.list(limit=limit, start_after=cursor)
    return docs, docs[-1].id if len(docs) == limit else None


def _choice(value: str, allowed: set[str], default: str) -> str:
    return value if value in allowed else default


@admin_bp.get("/login")
def login_page():
    return render_template("login.html", error=None)


@admin_bp.post("/login")
def login():
    email = request.form.get("email", "").strip()
    password = request.form.get("password", "")
    if not check_rate_limit("admin_login", request.remote_addr or email, limit=5):
        return render_template("login.html", error="Muitas tentativas. Tente novamente em instantes."), 429
    user = authenticate_admin(email, password)
    if not user:
        return render_template("login.html", error="Credenciais inválidas"), 401
    resp = make_response(redirect(url_for("admin.dashboard"), code=303))
    resp.set_cookie(
        SESSION_COOKIE,
        create_session_cookie(user),
        httponly=True,
        samesite="Strict",
        secure=settings.is_production,
        max_age=60 * 60 * 12,
    )
    log_action(actor_user_id=user.id, action="admin.login", target_type="user", target_id=user.id)
    return resp


@admin_bp.post("/logout")
def logout():
    admin, redir = require_admin()
    if redir:
        return redir
    log_action(actor_user_id=admin.id, action="admin.logout", target_type="user", target_id=admin.id)
    resp = make_response(redirect(url_for("admin.login_page"), code=303))
    resp.delete_cookie(SESSION_COOKIE)
    return resp


@admin_bp.get("/")
@admin_bp.get("")
def dashboard():
    admin, redir = require_admin()
    if redir:
        return redir
    stats = {
        "users": users_repo.count(),
        "active_subs": sum(
            1
            for s in subscriptions_repo.list(filters=[("status", "==", "active")], limit=500)
            if s.ends_at and s.ends_at >= utcnow()
        ),
        "queries": queries_repo.count(),
        "payments": payments_repo.count(),
    }
    recent_queries = queries_repo.list(order_by="created_at", desc=True, limit=20)
    return render_template("dashboard.html", admin=admin, stats=stats, recent_queries=recent_queries)


@admin_bp.get("/users")
def users_page():
    admin, redir = require_admin()
    if redir:
        return redir
    users, next_cursor = _page(users_repo)
    return render_template("users.html", admin=admin, users=users, next_cursor=next_cursor)


@admin_bp.post("/users/<user_id>/status")
def update_user_status(user_id: str):
    admin, redir = require_admin()
    if redir:
        return redir
    status = _choice(request.form.get("status", ""), {item.value for item in UserStatus}, UserStatus.pending.value)
    users_repo.update(user_id, {"status": status})
    log_action(actor_user_id=admin.id, action="user.status.update", target_type="user", target_id=user_id, metadata={"status": status})
    return redirect(url_for("admin.users_page"), code=303)


@admin_bp.post("/users/create")
def create_user():
    admin, redir = require_admin()
    if redir:
        return redir
    name = request.form.get("name") or None
    telegram_id = request.form.get("telegram_id") or None
    email = request.form.get("email") or None
    password = request.form.get("password") or ""
    if email:
        try:
            email = validate_email(email, check_deliverability=False).normalized
        except EmailNotValidError:
            return redirect(url_for("admin.users_page"), code=303)
    if password and len(password) < 12:
        return redirect(url_for("admin.users_page"), code=303)
    role = _choice(request.form.get("role", ""), {item.value for item in UserRole}, UserRole.user.value)
    status = _choice(request.form.get("status", ""), {item.value for item in UserStatus}, UserStatus.pending.value)
    user = users_repo.create(
        {
            "name": name,
            "telegram_id": str(telegram_id) if telegram_id else None,
            "email": email,
            "password_hash": hash_password(password) if password else None,
            "role": role,
            "status": status,
        }
    )
    log_action(actor_user_id=admin.id, action="user.create", target_type="user", target_id=user.id)
    return redirect(url_for("admin.users_page"), code=303)


@admin_bp.get("/subscriptions")
def subscriptions_page():
    admin, redir = require_admin()
    if redir:
        return redir
    subs, next_cursor = _page(subscriptions_repo)
    users = users_repo.list(order_by="created_at", desc=True, limit=200)
    plans = plans_repo.list(order_by="created_at", desc=False, limit=100)
    return render_template("subscriptions.html", admin=admin, subs=subs, users=users, plans=plans, next_cursor=next_cursor)


@admin_bp.post("/subscriptions/manual")
def manual_subscription():
    admin, redir = require_admin()
    if redir:
        return redir
    user_id = request.form.get("user_id")
    if not user_id:
        abort(400, description="Usuário obrigatório")
    plan_id = request.form.get("plan_id") or None
    try:
        days = int(request.form.get("days", "30"))
        sub = activate_manual_subscription(user_id=user_id, plan_id=plan_id, days=days, actor_user_id=admin.id, note=request.form.get("note"))
    except (TypeError, ValueError):
        abort(400, description="Dados de assinatura inválidos")
    log_action(actor_user_id=admin.id, action="subscription.manual.activate", target_type="subscription", target_id=sub.id, metadata={"user_id": user_id, "days": days})
    return redirect(url_for("admin.subscriptions_page"), code=303)


@admin_bp.post("/plans/create")
def create_plan():
    admin, redir = require_admin()
    if redir:
        return redir
    name = (request.form.get("name") or "").strip()
    try:
        price_cents = int(request.form.get("price_cents", "0"))
        period_days = int(request.form.get("period_days", "30"))
    except (TypeError, ValueError):
        abort(400, description="Plano inválido")
    if not name or price_cents <= 0 or period_days <= 0:
        abort(400, description="Plano inválido")
    plan = plans_repo.create(
        {
            "name": name,
            "price_cents": price_cents,
            "period_days": period_days,
            "active": request.form.get("active") == "on",
            "limits": {"queries_per_day": 100},
        }
    )
    log_action(actor_user_id=admin.id, action="plan.create", target_type="plan", target_id=plan.id)
    return redirect(url_for("admin.subscriptions_page"), code=303)


@admin_bp.get("/payments")
def payments_page():
    admin, redir = require_admin()
    if redir:
        return redir
    payments, next_cursor = _page(payments_repo)
    return render_template("payments.html", admin=admin, payments=payments, next_cursor=next_cursor)


@admin_bp.get("/queries")
def queries_page():
    admin, redir = require_admin()
    if redir:
        return redir
    queries, next_cursor = _page(queries_repo)
    return render_template("queries.html", admin=admin, queries=queries, next_cursor=next_cursor)


@admin_bp.get("/dsr")
def dsr_page():
    admin, redir = require_admin()
    if redir:
        return redir
    return render_template("dsr.html", admin=admin, requests=list_pending_requests())


@admin_bp.post("/dsr/<request_id>/resolve")
def resolve_dsr(request_id: str):
    admin, redir = require_admin()
    if redir:
        return redir
    decision = request.form.get("decision")
    if decision not in {"approve", "reject"}:
        abort(400, description="Decisão inválida")
    try:
        resolve_deletion(request_id=request_id, actor_user_id=admin.id, approve=decision == "approve")
    except ValueError:
        abort(400, description="Solicitação inválida")
    return redirect(url_for("admin.dsr_page"), code=303)


@admin_bp.get("/settings")
def settings_page():
    admin, redir = require_admin()
    if redir:
        return redir
    return render_template("settings.html", admin=admin, values=get_runtime_settings())


@admin_bp.post("/settings")
def save_settings():
    admin, redir = require_admin()
    if redir:
        return redir
    values = update_runtime_settings(
        {
            "query_cache_ttl_seconds": request.form.get("query_cache_ttl_seconds"),
            "raw_retention_days": request.form.get("raw_retention_days"),
            "queries_per_minute": request.form.get("queries_per_minute"),
            "consent_version": request.form.get("consent_version"),
        }
    )
    log_action(actor_user_id=admin.id, action="admin.settings.update", target_type="app_settings", metadata=values)
    return redirect(url_for("admin.settings_page"), code=303)
