import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.v1 import router as v1_router
from app.bot.runtime import start_bot_polling, stop_bot
from app.core.config import settings
from app.core.db import SessionLocal
from app.services.seed import seed_initial_data

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
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


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    request.state.request_id = request_id
    start = time.perf_counter()
    path = request.url.path
    method = request.method
    has_auth = "authorization" in {k.lower() for k in request.headers.keys()}
    ua = (request.headers.get("user-agent") or "")[:120]
    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        logger.exception(
            "http_error request_id=%s method=%s path=%s auth=%s elapsed_ms=%s ua=%r",
            request_id, method, path, has_auth, elapsed_ms, ua,
        )
        raise
    elapsed_ms = int((time.perf_counter() - start) * 1000)
    response.headers["x-request-id"] = request_id
    level = logging.INFO
    if response.status_code >= 500:
        level = logging.ERROR
    elif response.status_code >= 400:
        level = logging.WARNING
    logger.log(
        level,
        "http request_id=%s method=%s path=%s status=%s auth=%s elapsed_ms=%s",
        request_id, method, path, response.status_code, has_auth, elapsed_ms,
    )
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(v1_router, prefix=settings.api_prefix)

