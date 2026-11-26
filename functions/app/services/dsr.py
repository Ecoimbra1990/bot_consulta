import json
from datetime import timedelta

from app.core.runtime_settings import get_runtime_settings
from app.core.security import decrypt_text, utcnow
from app.db.repositories import (
    audit_logs_repo,
    bot_sessions_repo,
    dsr_requests_repo,
    payments_repo,
    queries_repo,
    query_cache_repo,
    query_results_repo,
    subscriptions_repo,
    users_repo,
)
from app.models.types import UserStatus


def has_consent(user) -> bool:
    if not user or getattr(user, "status", None) == UserStatus.blocked.value:
        return False
    return user.get("consent_version") == get_runtime_settings()["consent_version"]


def accept_consent(user_id: str | int) -> None:
    version = get_runtime_settings()["consent_version"]
    users_repo.update(
        user_id,
        {
            "consent_version": version,
            "consent_at": utcnow(),
            "legal_basis": "contract",
        },
    )
    audit_logs_repo.create(
        {
            "actor_user_id": str(user_id),
            "action": "consent.accepted",
            "target_type": "user",
            "target_id": str(user_id),
            "metadata_json": {"version": version, "legal_basis": "contract"},
            "created_at": utcnow(),
        }
    )


def export_user_data(user_id: str | int) -> dict:
    user = users_repo.get(user_id)
    if not user:
        raise ValueError("Usuário não encontrado")
    queries = queries_repo.list(filters=[("user_id", "==", str(user_id))], limit=200)
    details = []
    for query in queries:
        result = query_results_repo.get(query.id)
        raw = None
        if result and result.get("raw_encrypted_json"):
            try:
                raw = json.loads(decrypt_text(result.get("raw_encrypted_json")))
            except Exception:
                raw = None
        details.append({"query": query.data, "result": result.data if result else None, "raw": raw})
    return {
        "user": user.data,
        "subscriptions": [item.data for item in subscriptions_repo.list(filters=[("user_id", "==", str(user_id))], limit=200)],
        "payments": [item.data for item in payments_repo.list(filters=[("user_id", "==", str(user_id))], limit=200)],
        "queries": details,
        "audit": [item.data for item in audit_logs_repo.list(filters=[("actor_user_id", "==", str(user_id))], limit=200)],
    }


def request_deletion(user_id: str | int) -> dict:
    request = dsr_requests_repo.create(
        {
            "user_id": str(user_id),
            "status": "pending",
            "created_at": utcnow(),
        }
    )
    audit_logs_repo.create(
        {
            "actor_user_id": str(user_id),
            "action": "dsr.deletion_requested",
            "target_type": "dsr_request",
            "target_id": request.id,
            "metadata_json": {},
            "created_at": utcnow(),
        }
    )
    return request.data


def list_pending_requests() -> list:
    return dsr_requests_repo.list(filters=[("status", "==", "pending")], limit=100)


def resolve_deletion(*, request_id: str, actor_user_id: str | int, approve: bool) -> dict:
    request = dsr_requests_repo.get(request_id)
    if not request:
        raise ValueError("Solicitação não encontrada")
    if request.get("status") != "pending":
        raise ValueError("Solicitação já resolvida")

    if approve:
        user_id = str(request.get("user_id"))
        user = users_repo.get(user_id)
        telegram_id = user.get("telegram_id") if user else None
        for query in queries_repo.list(filters=[("user_id", "==", user_id)], limit=500):
            query_results_repo.delete(query.id)
            queries_repo.update(query.id, {"key_hash": "deleted", "key_masked": "***"})
        for sub in subscriptions_repo.list(filters=[("user_id", "==", user_id)], limit=500):
            subscriptions_repo.update(sub.id, {"user_id": f"deleted:{user_id}"})
        for payment in payments_repo.list(filters=[("user_id", "==", user_id)], limit=500):
            payments_repo.update(payment.id, {"user_id": f"deleted:{user_id}"})
        if user:
            users_repo.update(
                user_id,
                {
                    "name": None,
                    "username": None,
                    "telegram_id": None,
                    "email": None,
                    "password_hash": None,
                    "consent_version": None,
                    "status": UserStatus.blocked.value,
                    "anonymized_at": utcnow(),
                },
            )
        if telegram_id:
            for session in bot_sessions_repo.list(limit=500):
                if session.get("telegram_id") == str(telegram_id):
                    bot_sessions_repo.delete(session.id)
        status = "done"
    else:
        status = "rejected"

    dsr_requests_repo.update(request_id, {"status": status, "resolved_at": utcnow(), "resolved_by": str(actor_user_id)})
    audit_logs_repo.create(
        {
            "actor_user_id": str(actor_user_id),
            "action": "dsr.deletion_resolved",
            "target_type": "dsr_request",
            "target_id": request_id,
            "metadata_json": {"status": status},
            "created_at": utcnow(),
        }
    )
    updated = dsr_requests_repo.get(request_id)
    return updated.data if updated else {}


def purge_expired_raw(days: int | None = None) -> int:
    retention_days = days if days is not None else get_runtime_settings()["raw_retention_days"]
    cutoff = utcnow() - timedelta(days=retention_days)
    count = 0
    cursor: str | None = None
    while True:
        results = query_results_repo.list(order_by="fetched_at", desc=False, limit=500, start_after=cursor)
        if not results:
            break
        for result in results:
            fetched_at = result.fetched_at
            if fetched_at and fetched_at < cutoff:
                query_results_repo.delete(result.id)
                count += 1
        cursor = results[-1].id
        if len(results) < 500:
            break

    cursor = None
    while True:
        cached = query_cache_repo.list(order_by="expires_at", desc=False, limit=500, start_after=cursor)
        if not cached:
            break
        now = utcnow()
        for item in cached:
            expires_at = item.expires_at
            if expires_at and expires_at < now:
                query_cache_repo.delete(item.id)
                count += 1
        cursor = cached[-1].id
        if len(cached) < 500:
            break
    return count
