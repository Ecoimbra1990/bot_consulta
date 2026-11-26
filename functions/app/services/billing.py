import uuid
from datetime import timedelta

from app.core.security import utcnow
from app.db.repositories import Doc, payments_repo, plans_repo, subscriptions_repo, users_repo
from app.models.types import PaymentStatus, SubscriptionStatus, UserStatus
from app.services.audit import log_action
from app.services.mercadopago import create_preference


def _map_status(status: str) -> str:
    if status == "approved":
        return PaymentStatus.paid.value
    if status in {"pending", "in_process"}:
        return PaymentStatus.pending.value
    return PaymentStatus.failed.value


def activate_manual_subscription(*, user_id: str | int, plan_id: str | int | None, days: int, actor_user_id: str | int | None = None, note: str | None = None):
    if days <= 0:
        raise ValueError("days deve ser maior que zero")
    now = utcnow()
    sub = subscriptions_repo.create(
        {
            "user_id": str(user_id),
            "plan_id": str(plan_id) if plan_id else None,
            "source": "manual",
            "status": SubscriptionStatus.active.value,
            "starts_at": now,
            "ends_at": now + timedelta(days=days),
            "external_ref": None,
            "created_at": now,
        }
    )
    users_repo.update(user_id, {"status": UserStatus.active.value})
    payments_repo.create(
        {
            "user_id": str(user_id),
            "subscription_id": sub.id,
            "provider": "manual",
            "amount_cents": 0,
            "status": PaymentStatus.manual.value,
            "external_id": f"manual-{sub.id}",
            "payload_json": {"note": note, "actor_user_id": str(actor_user_id) if actor_user_id else None},
            "created_at": now,
        }
    )
    return sub


def create_checkout(*, user_id: str | int, plan_id: str | int) -> dict:
    plan = plans_repo.get(plan_id)
    if not plan or not plan.get("active", True):
        raise ValueError("Plano não encontrado ou inativo")
    amount_cents = int(plan.get("price_cents") or 0)
    if amount_cents <= 0:
        raise ValueError("Plano sem preço configurado")

    external_reference = f"mp-{uuid.uuid4().hex}"
    now = utcnow()
    payments_repo.create(
        {
            "user_id": str(user_id),
            "plan_id": str(plan.id),
            "provider": "mercadopago",
            "amount_cents": amount_cents,
            "status": PaymentStatus.pending.value,
            "external_id": external_reference,
            "external_reference": external_reference,
            "created_at": now,
            "expires_at": now + timedelta(minutes=30),
        },
        doc_id=external_reference,
    )
    try:
        preference = create_preference(
            external_reference=external_reference,
            title=f"Plano {plan.get('name') or plan.id}",
            amount_cents=amount_cents,
        )
        checkout_url = preference.get("init_point") or preference.get("sandbox_init_point")
        if not checkout_url:
            raise ValueError("Mercado Pago não retornou init_point")
    except Exception as exc:
        payments_repo.update(
            external_reference,
            {"status": PaymentStatus.failed.value, "error": str(exc), "updated_at": utcnow()},
        )
        raise RuntimeError("Não foi possível gerar o link de pagamento") from exc

    payments_repo.update(
        external_reference,
        {
            "preference_id": preference.get("id"),
            "checkout_url": checkout_url,
            "updated_at": utcnow(),
        },
    )
    return {
        "external_reference": external_reference,
        "checkout_url": checkout_url,
        "amount_cents": amount_cents,
    }


def _activate_subscription(*, external_reference: str, user_id: str, plan_id: str | None) -> None:
    existing = subscriptions_repo.find_one(filters=[("external_ref", "==", external_reference)])
    if existing:
        return
    plan = plans_repo.get(plan_id) if plan_id else None
    days = int(plan.get("period_days") or 30) if plan else 30
    now = utcnow()
    users_repo.update(user_id, {"status": UserStatus.active.value})
    subscriptions_repo.create(
        {
            "user_id": user_id,
            "plan_id": plan_id,
            "source": "mercadopago",
            "status": SubscriptionStatus.active.value,
            "starts_at": now,
            "ends_at": now + timedelta(days=days),
            "external_ref": external_reference,
            "payment_id": external_reference,
            "created_at": now,
        }
    )


def process_mercadopago_payment(payment: dict) -> Doc:
    payment_id = str(payment.get("id") or "")
    external_reference = str(payment.get("external_reference") or "")
    checkout = payments_repo.get(external_reference) if external_reference else None
    doc_id = external_reference or f"mp-{payment_id}"
    mapped_status = _map_status(str(payment.get("status") or "pending"))
    data = {
        "provider": "mercadopago",
        "mercadopago_payment_id": payment_id,
        "external_id": external_reference or payment_id,
        "external_reference": external_reference or None,
        "amount_cents": int(float(payment.get("transaction_amount") or 0) * 100),
        "status": mapped_status,
        "payload_json": payment,
        "updated_at": utcnow(),
    }
    if checkout:
        data["user_id"] = checkout.get("user_id")
        data["plan_id"] = checkout.get("plan_id")

    existing = payments_repo.get(doc_id)
    already_processed = bool(existing and existing.get("mercadopago_payment_id") == payment_id and existing.get("status") == mapped_status)
    if existing:
        payments_repo.update(doc_id, data)
    else:
        payments_repo.create(data, doc_id=doc_id)

    if checkout and checkout.get("user_id") and not already_processed:
        if mapped_status == PaymentStatus.paid.value:
            _activate_subscription(
                external_reference=external_reference,
                user_id=str(checkout.get("user_id")),
                plan_id=checkout.get("plan_id"),
            )
        elif mapped_status == PaymentStatus.failed.value:
            sub = subscriptions_repo.find_one(filters=[("external_ref", "==", external_reference)])
            if sub:
                subscriptions_repo.update(sub.id, {"status": SubscriptionStatus.canceled.value})

    log_action(
        actor_user_id=checkout.get("user_id") if checkout else None,
        action="payment.mercadopago.processed",
        target_type="payment",
        target_id=doc_id,
        metadata={"status": mapped_status, "payment_id": payment_id, "external_reference": external_reference},
    )
    updated = payments_repo.get(doc_id)
    if not updated:
        raise RuntimeError("Falha ao persistir pagamento")
    return updated


def expire_subscriptions() -> int:
    now = utcnow()
    count = 0
    cursor: str | None = None
    while True:
        subs = subscriptions_repo.list(
            filters=[("status", "==", SubscriptionStatus.active.value)],
            limit=500,
            start_after=cursor,
        )
        if not subs:
            break
        for sub in subs:
            ends_at = sub.ends_at
            if ends_at and ends_at < now:
                subscriptions_repo.update(sub.id, {"status": SubscriptionStatus.expired.value})
                count += 1
        cursor = subs[-1].id
        if len(subs) < 500:
            break
    return count
