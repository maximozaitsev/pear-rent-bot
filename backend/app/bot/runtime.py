import logging

from aiogram import Bot, Dispatcher, Router
from aiogram.filters import CommandStart
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    MenuButtonWebApp,
    Message,
    WebAppInfo,
)
from aiogram.utils.keyboard import ReplyKeyboardBuilder

from app.core.config import settings

logger = logging.getLogger(__name__)

router = Router(name="start")
_bot: Bot | None = None
_dispatcher: Dispatcher | None = None
_menu_button_configured = False


def _mini_app_url() -> str | None:
    url = (settings.telegram_mini_app_url or "").rstrip("/")
    if not url:
        return None
    if not url.startswith("https://"):
        logger.warning("Telegram Mini App URL must be https; got %r", url)
        return None
    if "example.com" in url:
        logger.warning("Telegram Mini App URL is placeholder (example.com); bot buttons disabled")
        return None
    return url


def _direct_link(url: str) -> str:
    username = (settings.telegram_bot_username or "").strip().lstrip("@")
    if username:
        return f"https://t.me/{username}/app"
    # Fallback: open the web app URL directly (no initData context is guaranteed outside TG;
    # frontend will show a clear recovery state). Prefer setting TELEGRAM_BOT_USERNAME.
    return url


def _open_markup(url: str) -> InlineKeyboardMarkup:
    # Inline web_app buttons reliably provide initData in Telegram clients.
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Открыть приложение", web_app=WebAppInfo(url=url))]
        ]
    )


@router.message(CommandStart())
async def handle_start(message: Message) -> None:
    mini_app_url = _mini_app_url()
    text = (
        "Pear Rent Bot.\n\n"
        "Если вы уже зарегистрированы — откройте приложение.\n"
        "Если доступа нет — попросите администратора код приглашения, "
        "затем откройте приложение и введите код.\n\n"
        "Важно: открывайте через кнопку ниже или Menu Button бота (так Telegram передаёт данные для входа)."
    )
    if mini_app_url:
        await message.answer(text, reply_markup=_open_markup(mini_app_url))
    else:
        logger.info("Mini App URL unavailable; sending /start without button")
        await message.answer(text)


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


async def _ensure_menu_button(bot: Bot) -> None:
    global _menu_button_configured
    if _menu_button_configured:
        return
    mini_app_url = _mini_app_url()
    if not mini_app_url:
        return
    try:
        await bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(text="Открыть", web_app=WebAppInfo(url=mini_app_url))
        )
        _menu_button_configured = True
        logger.info("Telegram chat menu button configured for Mini App %s", mini_app_url)
    except Exception:
        logger.exception("Failed to set Telegram chat menu button")


async def start_bot_polling() -> None:
    bot = get_bot()
    if bot is None:
        return
    await _ensure_menu_button(bot)
    dp = get_dispatcher()
    logger.info("Starting Telegram bot polling")
    await dp.start_polling(bot, handle_signals=False)


async def stop_bot() -> None:
    global _bot, _menu_button_configured
    if _bot is not None:
        await _bot.session.close()
        _bot = None
        _menu_button_configured = False
