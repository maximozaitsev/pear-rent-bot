import logging

from aiogram import Bot, Dispatcher, Router
from aiogram.filters import CommandStart
from aiogram.types import KeyboardButton, Message, WebAppInfo
from aiogram.utils.keyboard import ReplyKeyboardBuilder

from app.core.config import settings

logger = logging.getLogger(__name__)

router = Router(name="start")
_bot: Bot | None = None
_dispatcher: Dispatcher | None = None


@router.message(CommandStart())
async def handle_start(message: Message) -> None:
    builder = ReplyKeyboardBuilder()
    mini_app_url = (settings.telegram_mini_app_url or "").rstrip("/")
    can_open = mini_app_url.startswith("https://") and "example.com" not in mini_app_url
    if can_open:
        builder.row(KeyboardButton(text="Открыть приложение", web_app=WebAppInfo(url=mini_app_url)))
    elif mini_app_url:
        logger.info("Mini App URL is not a valid HTTPS Telegram WebApp URL; sending /start without button")

    text = (
        "Pear Rent Bot.\n\n"
        "Если вы уже зарегистрированы — откройте приложение.\n"
        "Если доступа нет — попросите администратора код приглашения, "
        "затем откройте приложение и введите код."
    )
    markup = builder.as_markup(resize_keyboard=True) if builder.export() else None
    await message.answer(text, reply_markup=markup)


def get_dispatcher() -> Dispatcher:
    global _dispatcher
    if _dispatcher is None:
        _dispatcher = Dispatcher()
        _dispatcher.include_router(router)
    return _dispatcher


def get_bot() -> Bot | None:
    global _bot
    if not settings.telegram_bot_token:
        return None
    if _bot is None:
        _bot = Bot(token=settings.telegram_bot_token)
    return _bot


async def start_bot_polling() -> None:
    bot = get_bot()
    if bot is None:
        return
    dp = get_dispatcher()
    logger.info("Starting Telegram bot polling")
    await dp.start_polling(bot, handle_signals=False)


async def stop_bot() -> None:
    global _bot
    if _bot is not None:
        await _bot.session.close()
        _bot = None
