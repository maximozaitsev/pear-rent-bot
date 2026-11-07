import logging

from aiogram import Bot, Dispatcher, Router
from aiogram.filters import CommandStart
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, MenuButtonWebApp, Message, WebAppInfo

from app.core.config import settings

logger = logging.getLogger(__name__)

router = Router(name="start")
_bot: Bot | None = None
_dispatcher: Dispatcher | None = None
_menu_button_configured = False


def _mini_app_url() -> str | None:
    url = (settings.telegram_mini_app_url or "").rstrip("/")
    if not url or not url.startswith("https://") or "example.com" in url:
        return None
    return url


def _open_markup(url: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Открыть приложение", web_app=WebAppInfo(url=url))]
        ]
    )


@router.message(CommandStart())
async def handle_start(message: Message) -> None:
    mini_app_url = _mini_app_url()
    text = (
        "🍐 <b>Pear Rent</b>\n\n"
        "Аренда кресел в барбершопе — быстро и удобно.\n\n"
        "Уже есть доступ — откройте приложение.\n"
        "Если доступа нет — попросите администратора код приглашения и введите его в приложении."
    )
    if mini_app_url:
        await message.answer(text, reply_markup=_open_markup(mini_app_url), parse_mode="HTML")
    else:
        await message.answer(text, parse_mode="HTML")


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
    except Exception:
        logger.exception("Failed to set Telegram chat menu button")


async def start_bot_polling() -> None:
    bot = get_bot()
    if bot is None:
        return
    await _ensure_menu_button(bot)
    dp = get_dispatcher()
    await dp.start_polling(bot, handle_signals=False)


async def stop_bot() -> None:
    global _bot, _menu_button_configured
    if _bot is not None:
        await _bot.session.close()
        _bot = None
        _menu_button_configured = False
