import logging

from aiogram import Bot, Dispatcher, Router
from aiogram.filters import CommandObject, CommandStart
from aiogram.types import KeyboardButton, Message, WebAppInfo
from aiogram.utils.keyboard import ReplyKeyboardBuilder

from app.core.config import settings
from app.services.invitations import extract_invite_token

logger = logging.getLogger(__name__)

router = Router(name="start")
_bot: Bot | None = None
_dispatcher: Dispatcher | None = None


@router.message(CommandStart())
async def handle_start(message: Message, command: CommandObject) -> None:
    # Stage 2: start + deep-link routing. Business auth/registration is enforced by backend API.
    start_param = command.args
    invite_token = extract_invite_token(start_param)
    builder = ReplyKeyboardBuilder()
    mini_app_url = (settings.telegram_mini_app_url or "").rstrip("/")
    # Telegram requires HTTPS for WebApp keyboard buttons; localhost HTTP is invalid.
    can_open = mini_app_url.startswith("https://") and "example.com" not in mini_app_url
    if can_open:
        url = mini_app_url
        if invite_token:
            # Mini App can read start_param via Telegram WebApp; also passed as query fallback.
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}invite_token={invite_token}"
        builder.row(KeyboardButton(text="Открыть приложение", web_app=WebAppInfo(url=url)))
    elif mini_app_url and not can_open:
        logger.info(
            "Mini App URL is not a valid HTTPS Telegram WebApp URL; sending /start without button"
        )

    if invite_token:
        text = (
            "Вы открыли пригласительную ссылку.\n\n"
            "Нажмите «Открыть приложение», чтобы завершить регистрацию. "
            "Ссылка одноразовая и привязывается к вашему Telegram-аккаунту при регистрации."
        )
    else:
        text = (
            "Pear Rent Bot.\n\n"
            "Если вы уже зарегистрированы — откройте приложение. "
            "Если доступа нет — попросите администратора выдать приглашение."
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
