from app.core.security import utcnow
from app.db.repositories import audit_logs_repo


def log_action(*, actor_user_id: str | int | None, action: str, target_type: str | None = None, target_id: str | int | None = None, metadata: dict | None = None) -> None:
    audit_logs_repo.create(
        {
            "actor_user_id": str(actor_user_id) if actor_user_id is not None else None,
            "action": action,
            "target_type": target_type,
            "target_id": str(target_id) if target_id is not None else None,
            "metadata_json": metadata or {},
            "created_at": utcnow(),
        }
    )
