from app.core.config import settings
from app.core.security import hash_password
from app.db.repositories import plans_repo, users_repo
from app.models.types import UserRole, UserStatus


def ensure_bootstrap() -> None:
    settings.validate_runtime()
    admin = users_repo.by_email(settings.admin_email)
    if not admin:
        users_repo.create(
            {
                "email": settings.admin_email,
                "name": "Admin",
                "password_hash": hash_password(settings.admin_password),
                "role": UserRole.admin.value,
                "status": UserStatus.active.value,
            }
        )
    plans = plans_repo.list(limit=1)
    if not plans:
        plans_repo.create(
            {
                "name": "Mensal",
                "price_cents": 4990,
                "period_days": 30,
                "active": True,
                "limits": {"queries_per_day": 100},
            }
        )
