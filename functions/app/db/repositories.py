from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from google.cloud import firestore

from app.core.security import utcnow
from app.db.firestore import get_db

FilterList = list[tuple[str, str, Any]]


def _dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    return None


@dataclass
class Doc:
    id: str
    data: dict[str, Any]

    def __getattr__(self, item: str) -> Any:
        if item in self.data:
            v = self.data[item]
            if item.endswith("_at") or item in {"starts_at", "ends_at", "fetched_at", "created_at"}:
                return _dt(v) or v
            return v
        raise AttributeError(item)

    def get(self, key: str, default=None):
        return self.data.get(key, default)


class Repository:
    collection: str

    def __init__(self):
        self.db = get_db()

    @property
    def col(self):
        return self.db.collection(self.collection)

    def _doc(self, snap) -> Doc | None:
        if not snap.exists:
            return None
        data = snap.to_dict() or {}
        data["id"] = snap.id
        return Doc(id=snap.id, data=data)

    def get(self, doc_id: str | int | None) -> Doc | None:
        if doc_id is None:
            return None
        snap = self.col.document(str(doc_id)).get()
        return self._doc(snap)

    def create(self, data: dict[str, Any], doc_id: str | None = None) -> Doc:
        payload = dict(data)
        payload.setdefault("created_at", utcnow())
        ref = self.col.document(doc_id) if doc_id else self.col.document()
        ref.set(payload)
        snap = ref.get()
        return self._doc(snap)  # type: ignore

    def set(self, doc_id: str, data: dict[str, Any], merge: bool = True) -> Doc:
        ref = self.col.document(str(doc_id))
        ref.set(data, merge=merge)
        return self._doc(ref.get())  # type: ignore

    def update(self, doc_id: str | int, data: dict[str, Any]) -> Doc | None:
        ref = self.col.document(str(doc_id))
        if not ref.get().exists:
            return None
        ref.set(data, merge=True)
        return self._doc(ref.get())

    def delete(self, doc_id: str | int) -> None:
        self.col.document(str(doc_id)).delete()

    def list(self, *, order_by: str = "created_at", desc: bool = True, limit: int = 200, filters: FilterList | None = None, start_after: str | None = None) -> list[Doc]:
        q = self.col
        for f, op, v in filters or []:
            q = q.where(filter=firestore.FieldFilter(f, op, v))
        direction = firestore.Query.DESCENDING if desc else firestore.Query.ASCENDING
        q = q.order_by(order_by, direction=direction)
        if start_after:
            cursor = self.col.document(str(start_after)).get()
            if cursor.exists:
                q = q.start_after(cursor)
        q = q.limit(limit)
        return [self._doc(s) for s in q.stream() if s.exists]  # type: ignore

    def find_one(self, *, filters: FilterList, order_by: str | None = None, desc: bool = True) -> Doc | None:
        q = self.col
        for f, op, v in filters or []:
            q = q.where(filter=firestore.FieldFilter(f, op, v))
        if order_by:
            direction = firestore.Query.DESCENDING if desc else firestore.Query.ASCENDING
            q = q.order_by(order_by, direction=direction)
        q = q.limit(1)
        docs = list(q.stream())
        return self._doc(docs[0]) if docs else None

    def count(self, filters: FilterList | None = None) -> int:
        # Firestore count aggregation is preferred; fallback to stream for emulator/simple use.
        q = self.col
        for f, op, v in filters or []:
            q = q.where(filter=firestore.FieldFilter(f, op, v))
        try:
            agg = q.count().get()
            return int(agg[0][0].value)
        except Exception:
            return sum(1 for _ in q.stream())


class UsersRepo(Repository):
    collection = "users"

    def by_email(self, email: str) -> Doc | None:
        return self.find_one(filters=[("email", "==", email)])

    def by_telegram_id(self, telegram_id: str) -> Doc | None:
        return self.find_one(filters=[("telegram_id", "==", str(telegram_id))])


class PlansRepo(Repository):
    collection = "plans"


class SubscriptionsRepo(Repository):
    collection = "subscriptions"


class PaymentsRepo(Repository):
    collection = "payments"


class QueriesRepo(Repository):
    collection = "queries"


class QueryResultsRepo(Repository):
    collection = "query_results"


class AuditLogsRepo(Repository):
    collection = "audit_logs"


class BotSessionsRepo(Repository):
    collection = "bot_sessions"


class QueryCacheRepo(Repository):
    collection = "query_cache"


class DsrRequestsRepo(Repository):
    collection = "dsr_requests"


class RateLimitsRepo(Repository):
    collection = "rate_limits"


class AppSettingsRepo(Repository):
    collection = "app_settings"


users_repo = UsersRepo()
plans_repo = PlansRepo()
subscriptions_repo = SubscriptionsRepo()
payments_repo = PaymentsRepo()
queries_repo = QueriesRepo()
query_results_repo = QueryResultsRepo()
audit_logs_repo = AuditLogsRepo()
bot_sessions_repo = BotSessionsRepo()
query_cache_repo = QueryCacheRepo()
dsr_requests_repo = DsrRequestsRepo()
rate_limits_repo = RateLimitsRepo()
app_settings_repo = AppSettingsRepo()
