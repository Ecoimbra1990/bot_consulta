from app.core.security import utcnow
from app.db.repositories import subscriptions_repo
from app.models.types import SubscriptionStatus, UserStatus


def get_active_subscription(user_id: str | int):
    now = utcnow()
    subs = subscriptions_repo.list(
        filters=[
            ("user_id", "==", str(user_id)),
            ("status", "==", SubscriptionStatus.active.value),
        ],
        order_by="ends_at",
        desc=True,
        limit=20,
    )
    for sub in subs:
        ends_at = sub.ends_at
        if ends_at and ends_at >= now:
            return sub
    return None


def is_entitled(user) -> bool:
    status = getattr(user, "status", None) or user.get("status")
    if status != UserStatus.active.value and status != UserStatus.active:
        return False
    return get_active_subscription(user.id) is not None
