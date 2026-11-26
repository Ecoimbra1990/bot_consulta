from app.db.repositories import Doc
from app.services import billing


class FakeRepo:
    def __init__(self):
        self.items: dict[str, Doc] = {}

    def create(self, data, doc_id=None):
        doc_id = str(doc_id or len(self.items) + 1)
        payload = dict(data)
        payload["id"] = doc_id
        self.items[doc_id] = Doc(doc_id, payload)
        return self.items[doc_id]

    def set(self, doc_id, data, merge=True):
        return self.create(data, doc_id=str(doc_id))

    def update(self, doc_id, data):
        doc = self.items.get(str(doc_id))
        if not doc:
            return None
        doc.data.update(data)
        return doc

    def get(self, doc_id):
        return self.items.get(str(doc_id))

    def list(self, filters=None, limit=200, **kwargs):
        docs = list(self.items.values())
        for field, op, value in filters or []:
            docs = [doc for doc in docs if doc.get(field) == value]
        return docs[:limit]

    def find_one(self, filters, **kwargs):
        matches = self.list(filters=filters, limit=1)
        return matches[0] if matches else None


def _setup(monkeypatch):
    billing.payments_repo = FakeRepo()
    billing.plans_repo = FakeRepo()
    billing.subscriptions_repo = FakeRepo()
    billing.users_repo = FakeRepo()
    billing.plans_repo.create({"name": "Mensal", "price_cents": 4990, "period_days": 30, "active": True}, doc_id="p1")
    billing.users_repo.create({"id": "u1", "status": "pending"}, doc_id="u1")
    monkeypatch.setattr(billing, "log_action", lambda **kwargs: None)
    monkeypatch.setattr(
        billing,
        "create_preference",
        lambda **kwargs: {"id": "pref-1", "init_point": "https://example.test/checkout"},
    )


def test_create_checkout_stores_pending_payment(monkeypatch):
    _setup(monkeypatch)
    checkout = billing.create_checkout(user_id="u1", plan_id="p1")
    payment = billing.payments_repo.get(checkout["external_reference"])
    assert payment.status == "pending"
    assert payment.user_id == "u1"
    assert checkout["checkout_url"] == "https://example.test/checkout"
    assert payment.checkout_url == checkout["checkout_url"]


def test_approved_payment_activates_subscription_once(monkeypatch):
    _setup(monkeypatch)
    billing.payments_repo.create(
        {"user_id": "u1", "plan_id": "p1", "status": "pending", "provider": "mercadopago"},
        doc_id="mp-1",
    )
    payload = {"id": 99, "external_reference": "mp-1", "status": "approved", "transaction_amount": 49.9}
    billing.process_mercadopago_payment(payload)
    billing.process_mercadopago_payment(payload)
    assert billing.payments_repo.get("mp-1").status == "paid"
    assert len(billing.subscriptions_repo.items) == 1
    subscription = next(iter(billing.subscriptions_repo.items.values()))
    assert subscription.status == "active"
    assert subscription.external_ref == "mp-1"
    assert billing.users_repo.get("u1").status == "active"
