from collections.abc import Mapping
from typing import Any

from aiogram.fsm.state import State
from aiogram.fsm.storage.base import BaseStorage, StorageKey

from app.core.security import utcnow
from app.db.repositories import bot_sessions_repo


class FirestoreStorage(BaseStorage):
    def _doc_id(self, key: StorageKey) -> str:
        return f"{key.bot_id}:{key.chat_id}:{key.user_id}:{key.destiny}"

    async def get_state(self, key: StorageKey) -> str | None:
        doc = bot_sessions_repo.get(self._doc_id(key))
        return doc.get("state") if doc else None

    async def set_state(self, key: StorageKey, state: str | State | None = None) -> None:
        bot_sessions_repo.set(
            self._doc_id(key),
            {"state": str(state) if state else None, "telegram_id": str(key.user_id), "updated_at": utcnow()},
            merge=True,
        )

    async def get_data(self, key: StorageKey) -> dict[str, Any]:
        doc = bot_sessions_repo.get(self._doc_id(key))
        return dict(doc.get("data") or {}) if doc else {}

    async def set_data(self, key: StorageKey, data: Mapping[str, Any]) -> None:
        bot_sessions_repo.set(
            self._doc_id(key),
            {"data": dict(data), "telegram_id": str(key.user_id), "updated_at": utcnow()},
            merge=True,
        )

    async def update_data(self, key: StorageKey, data: Mapping[str, Any]) -> dict[str, Any]:
        current = await self.get_data(key)
        current.update(dict(data))
        await self.set_data(key, current)
        return current

    async def close(self) -> None:
        return None
