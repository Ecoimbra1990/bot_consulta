from datetime import timedelta

from app.core.runtime_settings import get_runtime_settings
from app.core.security import utcnow
from app.db.repositories import rate_limits_repo


def check_rate_limit(scope: str, identity: str, limit: int | None = None) -> bool:
    now = utcnow()
    bucket = now.strftime("%Y%m%d%H%M")
    doc_id = f"{scope}:{identity}:{bucket}"
    doc = rate_limits_repo.get(doc_id)
    if doc and doc.expires_at and doc.expires_at < now:
        rate_limits_repo.delete(doc_id)
        doc = None
    count = int(doc.get("count", 0)) if doc else 0
    max_requests = limit or get_runtime_settings()["queries_per_minute"]
    if count >= max_requests:
        return False
    rate_limits_repo.set(
        doc_id,
        {"count": count + 1, "scope": scope, "identity": identity, "expires_at": now + timedelta(minutes=2)},
        merge=True,
    )
    return True
