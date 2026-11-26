from datetime import timedelta

from app.core.security import utcnow
from app.db.repositories import Doc
from app.services import dsr


class FakeRepo:
    def __init__(self, docs):
        self.items = {doc.id: doc for doc in docs}
        self.deleted = []

    def list(self, **kwargs):
        return list(self.items.values())

    def delete(self, doc_id):
        self.deleted.append(str(doc_id))
        self.items.pop(str(doc_id), None)


def test_purge_expired_raw_removes_old_results_and_expired_cache(monkeypatch):
    now = utcnow()
    dsr.query_results_repo = FakeRepo(
        [
            Doc("old", {"fetched_at": now - timedelta(days=100)}),
            Doc("new", {"fetched_at": now}),
        ]
    )
    dsr.query_cache_repo = FakeRepo(
        [
            Doc("expired", {"expires_at": now - timedelta(seconds=10)}),
            Doc("valid", {"expires_at": now + timedelta(seconds=10)}),
        ]
    )
    monkeypatch.setattr(dsr, "utcnow", lambda: now)
    purged = dsr.purge_expired_raw(days=90)
    assert purged == 2
    assert dsr.query_results_repo.deleted == ["old"]
    assert dsr.query_cache_repo.deleted == ["expired"]
