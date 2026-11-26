from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import Update

from app.bot.handlers import router as handlers_router
from app.bot.storage import FirestoreStorage
from app.core.config import settings

_bot: Bot | None = None
_dp: Dispatcher | None = None


def get_bot_dp() -> tuple[Bot, Dispatcher] | tuple[None, None]:
    global _bot, _dp
    if not settings.telegram_bot_token:
        return None, None
    if _bot is None or _dp is None:
        _bot = Bot(settings.telegram_bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
        _dp = Dispatcher(storage=FirestoreStorage())
        _dp.include_router(handlers_router)
    return _bot, _dp


async def process_telegram_update(payload: dict) -> dict:
    bot, dp = get_bot_dp()
    if not bot or not dp:
        return {"ok": False, "error": "Telegram bot não configurado"}
    update = Update.model_validate(payload)
    await dp.feed_update(bot, update)
    return {"ok": True}
