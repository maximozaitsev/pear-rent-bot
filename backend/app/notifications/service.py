import asyncio
import html
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.bot.runtime import get_bot
from app.core.config import settings
from app.core.db import SessionLocal
from app.models import Booking, Chair, NotificationLog, User, UserRole
from app.services.schedule import localize_shop

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 1.0

EVENT_BOOKING_CREATED_RENTER = "booking_created_renter"
EVENT_BOOKING_CREATED_ADMIN = "booking_created_admin"
EVENT_BOOKING_CANCELLED_BY_RENTER_ADMIN = "booking_cancelled_by_renter_admin"
EVENT_BOOKING_CANCELLED_BY_ADMIN_RENTER = "booking_cancelled_by_admin_renter"
EVENT_BOOKING_CREATED_BULK_RENTER = "booking_created_bulk_renter"
EVENT_BOOKING_CREATED_BULK_ADMIN = "booking_created_bulk_admin"


def _money(amount_kopeks: int, currency: str) -> str:
    rub = amount_kopeks // 100
    kop = amount_kopeks % 100
    cur = "₽" if currency.upper() in {"RUB", "RUR"} else "BYN" if currency.upper() == "BYN" else currency
    return f"{rub}.{kop:02d} {cur}" if kop else f"{rub} {cur}"


def _fmt_date(dt: datetime) -> str:
    return localize_shop(dt).strftime("%d.%m.%Y")


def _fmt_time(dt: datetime) -> str:
    return localize_shop(dt).strftime("%H:%M")


def _fmt_dt(dt: datetime) -> str:
    local = localize_shop(dt)
    return f"{local.strftime('%d.%m.%Y')} {local.strftime('%H:%M')}"


def _renter_label(user: User) -> str:
    name = " ".join(part for part in [user.first_name, user.last_name] if part).strip()
    if name:
        return name
    if user.username:
        return f"@{user.username}"
    return f"telegram:{user.telegram_id}"


def _esc(value: object) -> str:
    return html.escape(str(value), quote=False)


def _booking_details(db: Session, booking: Booking) -> tuple[str, str]:
    chair = db.get(Chair, booking.chair_id)
    renter = db.get(User, booking.renter_id)
    chair_name = chair.name if chair else str(booking.chair_id)
    renter_name = _renter_label(renter) if renter else str(booking.renter_id)
    return chair_name, renter_name


def _build_messages(
    *, event_type: str, booking: Booking, chair_name: str, renter_name: str, actor: User | None
) -> str:
    period = f"{_fmt_dt(booking.starts_at)} – {_fmt_time(booking.ends_at)}"
    amount = _money(booking.price_amount, booking.currency)
    chair = _esc(chair_name)
    renter = _esc(renter_name)
    if event_type == EVENT_BOOKING_CREATED_RENTER:
        return (
            "✅ <b>Бронирование подтверждено</b>\n\n"
            f"💺 <b>Кресло:</b> {chair}\n"
            f"🗓 <b>Время:</b> {period}\n"
            f"💳 <b>Сумма:</b> <b>{amount}</b>"
        )
    if event_type == EVENT_BOOKING_CREATED_ADMIN:
        return (
            "🆕 <b>Новая бронь</b>\n\n"
            f"👤 <b>Арендатор:</b> {renter}\n"
            f"💺 <b>Кресло:</b> {chair}\n"
            f"🗓 <b>Время:</b> {period}\n"
            f"💳 <b>Сумма:</b> <b>{amount}</b>"
        )
    if event_type == EVENT_BOOKING_CANCELLED_BY_RENTER_ADMIN:
        return (
            "❌ <b>Бронь отменена арендатором</b>\n\n"
            f"👤 <b>Арендатор:</b> {renter}\n"
            f"💺 <b>Кресло:</b> {chair}\n"
            f"🗓 <b>Время:</b> {period}"
        )
    if event_type == EVENT_BOOKING_CANCELLED_BY_ADMIN_RENTER:
        return (
            "❌ <b>Бронирование отменено администратором</b>\n\n"
            f"💺 <b>Кресло:</b> {chair}\n"
            f"🗓 <b>Время:</b> {period}"
        )
    return f"ℹ️ Уведомление: {_esc(event_type)}"


def _admin_recipients(db: Session) -> list[User]:
    return list(
        db.scalars(select(User).where(User.role == UserRole.admin, User.is_active.is_(True)))
    )


def _get_or_create_log(
    db: Session, *, event_type: str, booking_id: uuid.UUID, recipient_user_id: uuid.UUID
) -> NotificationLog | None:
    existing = db.scalar(
        select(NotificationLog).where(
            NotificationLog.event_type == event_type,
            NotificationLog.booking_id == booking_id,
            NotificationLog.recipient_user_id == recipient_user_id,
        )
    )
    if existing is not None:
        return existing
    row = NotificationLog(
        event_type=event_type,
        booking_id=booking_id,
        recipient_user_id=recipient_user_id,
        status="pending",
        attempts=0,
    )
    db.add(row)
    try:
        db.commit()
        db.refresh(row)
        return row
    except IntegrityError:
        db.rollback()
        return db.scalar(
            select(NotificationLog).where(
                NotificationLog.event_type == event_type,
                NotificationLog.booking_id == booking_id,
                NotificationLog.recipient_user_id == recipient_user_id,
            )
        )


async def _send_with_retries(bot, telegram_id: int, text: str) -> tuple[bool, str | None]:
    last_error: str | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            await bot.send_message(chat_id=telegram_id, text=text, parse_mode="HTML")
            return True, None
        except Exception as exc:  # noqa: BLE001 - delivery must not crash booking flow
            last_error = f"{type(exc).__name__}: {exc}"[:1000]
            logger.warning(
                "telegram notification failed attempt=%s telegram_id=%s error=%s",
                attempt,
                telegram_id,
                last_error,
            )
            if attempt < MAX_ATTEMPTS:
                await asyncio.sleep(RETRY_DELAY_SECONDS * attempt)
    return False, last_error


def _send_notification(telegram_id: int, text: str) -> tuple[bool, str | None]:
    """Send from sync context. Uses injected/mock bot in tests; fresh Bot in runtime."""
    bot = get_bot()
    # Preserve test hooks (AsyncMock/mocks). In production, avoid reusing polling-loop Bot.
    if bot is not None and type(bot).__module__.startswith("unittest.mock"):
        return asyncio.run(_send_with_retries(bot, telegram_id, text))

    if not settings.telegram_bot_token:
        return False, "telegram bot not configured"

    async def _run() -> tuple[bool, str | None]:
        from aiogram import Bot

        async with Bot(token=settings.telegram_bot_token) as fresh:
            return await _send_with_retries(fresh, telegram_id, text)

    try:
        return asyncio.run(_run())
    except RuntimeError as exc:
        if "event loop" not in str(exc).lower():
            return False, f"RuntimeError: {exc}"[:1000]
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            return ex.submit(lambda: asyncio.run(_run())).result(timeout=60)


def _dispatch_events(
    *, booking_id: uuid.UUID, event_type: str, recipient_ids: list[uuid.UUID], actor_id: uuid.UUID | None
) -> None:
    """Send notifications in a fresh DB session. Never raises to callers."""
    try:
        db = SessionLocal()
    except Exception:
        logger.exception("notification dispatch could not open db session")
        return
    try:
        booking = db.get(Booking, booking_id)
        if booking is None:
            return
        chair_name, renter_name = _booking_details(db, booking)
        actor = db.get(User, actor_id) if actor_id else None
        text = _build_messages(event_type=event_type, booking=booking, chair_name=chair_name, renter_name=renter_name, actor=actor)
        for recipient_id in recipient_ids:
            log = _get_or_create_log(db, event_type=event_type, booking_id=booking_id, recipient_user_id=recipient_id)
            if log is None or log.status == "sent":
                continue
            recipient = db.get(User, recipient_id)
            if recipient is None or not recipient.is_active:
                log.status = "skipped"
                log.last_error = "recipient missing or inactive"
                db.commit()
                continue
            if not settings.telegram_bot_token and not (get_bot() and type(get_bot()).__module__.startswith("unittest.mock")):
                log.status = "failed"
                log.attempts = log.attempts
                log.last_error = "telegram bot not configured"
                db.commit()
                logger.warning("notification skipped: bot not configured event=%s recipient=%s", event_type, recipient_id)
                continue
            ok, err = _send_notification(recipient.telegram_id, text)
            log.attempts = MAX_ATTEMPTS if not ok else max(log.attempts, 1)
            if ok:
                log.status = "sent"
                log.sent_at = datetime.now(UTC)
                log.last_error = None
            else:
                log.status = "failed"
                log.last_error = err
            db.commit()
    except Exception:
        logger.exception("notification dispatch failed event=%s booking=%s", event_type, booking_id)
    finally:
        db.close()


def _build_bulk_created_messages(
    *, recipient: str, bookings: list[Booking], chair_names: dict[uuid.UUID, str], renter_name: str
) -> str:
    by_day_chair: dict[tuple[str, uuid.UUID], list[Booking]] = {}
    for b in sorted(bookings, key=lambda x: (x.starts_at, x.id)):
        key = (_fmt_date(b.starts_at), b.chair_id)
        by_day_chair.setdefault(key, []).append(b)
    lines: list[str] = []
    total = 0
    currency = bookings[0].currency if bookings else "BYN"
    for (day, _chair_id), items in by_day_chair.items():
        day_total = sum(i.price_amount for i in items)
        total += day_total
        chairs = ", ".join(sorted({_esc(chair_names.get(i.chair_id, str(i.chair_id))) for i in items}))
        intervals = ", ".join(
            f"{_fmt_time(i.starts_at)}-{_fmt_time(i.ends_at)}" for i in sorted(items, key=lambda x: x.starts_at)
        )
        lines.append(f"• <b>{day}</b> — {chairs} · {intervals} · <b>{_money(day_total, currency)}</b>")
    summary = "\n".join(lines)
    total_s = _money(total, currency)
    if recipient == "renter":
        return (
            "✅ <b>Бронирования подтверждены</b>\n\n"
            f"📦 <b>Количество:</b> {len(by_day_chair)}\n"
            f"{summary}\n\n"
            f"💳 <b>Итого к оплате:</b> <b>{total_s}</b>"
        )
    return (
        "🆕 <b>Новые бронирования</b> <i>(массовый выбор)</i>\n\n"
        f"👤 <b>Арендатор:</b> {_esc(renter_name)}\n"
        f"📦 <b>Количество:</b> {len(by_day_chair)}\n"
        f"{summary}\n\n"
        f"💳 <b>Итого:</b> <b>{total_s}</b>"
    )


def notify_bulk_bookings_created(*, booking_ids: list[uuid.UUID], actor_id: uuid.UUID) -> None:
    """Single aggregated notification per recipient for a bulk selection. Never raises."""
    if not booking_ids:
        return
    try:
        db = SessionLocal()
        try:
            bookings = list(db.scalars(select(Booking).where(Booking.id.in_(booking_ids))))
            if not bookings:
                return
            renter = db.get(User, bookings[0].renter_id)
            admins = _admin_recipients(db)
            renter_id = renter.id if renter else None
            admin_ids = [a.id for a in admins if a.id != bookings[0].renter_id]
            chair_ids = {b.chair_id for b in bookings}
            chairs = list(db.scalars(select(Chair).where(Chair.id.in_(chair_ids)))) if chair_ids else []
            chair_names = {c.id: c.name for c in chairs}
            renter_name = _renter_label(renter) if renter else str(bookings[0].renter_id)
        finally:
            db.close()

        anchor = bookings[0].id
        if renter_id is not None:
            text = _build_bulk_created_messages(
                recipient="renter", bookings=bookings, chair_names=chair_names, renter_name=renter_name
            )
            _dispatch_text_event(
                event_type=EVENT_BOOKING_CREATED_BULK_RENTER, booking_id=anchor, recipient_ids=[renter_id], text=text
            )
        if admin_ids:
            text = _build_bulk_created_messages(
                recipient="admin", bookings=bookings, chair_names=chair_names, renter_name=renter_name
            )
            _dispatch_text_event(
                event_type=EVENT_BOOKING_CREATED_BULK_ADMIN, booking_id=anchor, recipient_ids=admin_ids, text=text
            )
    except Exception:
        logger.exception("notify_bulk_bookings_created failed count=%s", len(booking_ids))


def _dispatch_text_event(*, event_type: str, booking_id: uuid.UUID, recipient_ids: list[uuid.UUID], text: str) -> None:
    """Send a prebuilt text (used for aggregated bulk notifications)."""
    try:
        db = SessionLocal()
    except Exception:
        logger.exception("notification dispatch could not open db session")
        return
    try:
        for recipient_id in recipient_ids:
            log = _get_or_create_log(db, event_type=event_type, booking_id=booking_id, recipient_user_id=recipient_id)
            if log is None or log.status == "sent":
                continue
            recipient = db.get(User, recipient_id)
            if recipient is None or not recipient.is_active:
                log.status = "skipped"
                log.last_error = "recipient missing or inactive"
                db.commit()
                continue
            if not settings.telegram_bot_token and not (get_bot() and type(get_bot()).__module__.startswith("unittest.mock")):
                log.status = "failed"
                log.last_error = "telegram bot not configured"
                db.commit()
                logger.warning("notification skipped: bot not configured event=%s recipient=%s", event_type, recipient_id)
                continue
            ok, err = _send_notification(recipient.telegram_id, text)
            log.attempts = MAX_ATTEMPTS if not ok else max(log.attempts, 1)
            if ok:
                log.status = "sent"
                log.sent_at = datetime.now(UTC)
                log.last_error = None
            else:
                log.status = "failed"
                log.last_error = err
            db.commit()
    except Exception:
        logger.exception("notification dispatch failed event=%s booking=%s", event_type, booking_id)
    finally:
        db.close()


def notify_booking_created(*, booking_id: uuid.UUID, actor_id: uuid.UUID) -> None:
    try:
        db = SessionLocal()
        try:
            booking = db.get(Booking, booking_id)
            if booking is None:
                return
            renter = db.get(User, booking.renter_id)
            admins = _admin_recipients(db)
            admin_ids = [a.id for a in admins if a.id != booking.renter_id]
            renter_id = renter.id if renter else None
        finally:
            db.close()
        if renter_id is not None:
            _dispatch_events(
                booking_id=booking_id,
                event_type=EVENT_BOOKING_CREATED_RENTER,
                recipient_ids=[renter_id],
                actor_id=actor_id,
            )
        if admin_ids:
            _dispatch_events(
                booking_id=booking_id,
                event_type=EVENT_BOOKING_CREATED_ADMIN,
                recipient_ids=admin_ids,
                actor_id=actor_id,
            )
    except Exception:
        logger.exception("notify_booking_created failed booking=%s", booking_id)


def notify_booking_cancelled(*, booking_id: uuid.UUID, actor_id: uuid.UUID) -> None:
    try:
        db = SessionLocal()
        try:
            booking = db.get(Booking, booking_id)
            actor = db.get(User, actor_id)
            if booking is None or actor is None:
                return
            renter = db.get(User, booking.renter_id)
            admins = _admin_recipients(db)
            renter_id = renter.id if renter else None
            admin_ids = [a.id for a in admins]
        finally:
            db.close()

        if actor.role == UserRole.renter:
            _dispatch_events(
                booking_id=booking_id,
                event_type=EVENT_BOOKING_CANCELLED_BY_RENTER_ADMIN,
                recipient_ids=[a for a in admin_ids if a != actor_id],
                actor_id=actor_id,
            )
        elif actor.role == UserRole.admin and renter_id is not None and renter_id != actor_id:
            _dispatch_events(
                booking_id=booking_id,
                event_type=EVENT_BOOKING_CANCELLED_BY_ADMIN_RENTER,
                recipient_ids=[renter_id],
                actor_id=actor_id,
            )
    except Exception:
        logger.exception("notify_booking_cancelled failed booking=%s", booking_id)
