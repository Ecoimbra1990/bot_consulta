import enum


class UserRole(str, enum.Enum):
    admin = "admin"
    user = "user"


class UserStatus(str, enum.Enum):
    active = "active"
    blocked = "blocked"
    pending = "pending"


class SubscriptionStatus(str, enum.Enum):
    active = "active"
    past_due = "past_due"
    canceled = "canceled"
    expired = "expired"


class PaymentStatus(str, enum.Enum):
    pending = "pending"
    paid = "paid"
    failed = "failed"
    manual = "manual"


class QueryStatus(str, enum.Enum):
    pending = "pending"
    completed = "completed"
    failed = "failed"
