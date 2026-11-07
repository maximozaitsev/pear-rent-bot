import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.v1 import router as v1_router
from app.bot.runtime import start_bot_polling, stop_bot
from app.core.config import settings
from app.core.db import SessionLocal
from app.services.seed import seed_initial_data

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    with SessionLocal() as db:
        seed_initial_data(db)
    bot_task: asyncio.Task[None] | None = None
    if settings.telegram_bot_token:
        bot_task = asyncio.create_task(start_bot_polling())
        logger.info("Telegram bot polling task started")
    else:
        logger.info("TELEGRAM_BOT_TOKEN not set; bot polling disabled")
    try:
        yield
    finally:
        if bot_task:
            bot_task.cancel()
            with suppress(asyncio.CancelledError):
                await bot_task
        await stop_bot()


app = FastAPI(title=settings.app_name, debug=settings.debug, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(v1_router, prefix=settings.api_prefix)

