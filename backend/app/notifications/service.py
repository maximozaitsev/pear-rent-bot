import asyncio
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.bot.runtime import get_bot
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


def _money(amount_kopeks: int, currency: str) -> str:
    rub = amount_kopeks // 100
    kop = amount_kopeks % 100
    return f"{rub}.{kop:02d} {currency}" if kop else f"{rub} {currency}"


def _fmt_dt(dt: datetime) -> str:
    local = localize_shop(dt)
    return local.strftime("%Y-%m-%d %H:%M")


def _renter_label(user: User) -> str:
    name = " ".join(part for part in [user.first_name, user.last_name] if part).strip()
    if name:
        return name
    if user.username:
        return f"@{user.username}"
    return f"telegram:{user.telegram_id}"


def _booking_details(db: Session, booking: Booking) -> tuple[str, str]:
    chair = db.get(Chair, booking.chair_id)
    renter = db.get(User, booking.renter_id)
    chair_name = chair.name if chair else str(booking.chair_id)
    renter_name = _renter_label(renter) if renter else str(booking.renter_id)
    return chair_name, renter_name


def _build_messages(
    *, event_type: str, booking: Booking, chair_name: str, renter_name: str, actor: User | None
) -> str:
    period = f"{_fmt_dt(booking.starts_at)}–{localize_shop(booking.ends_at).strftime('%H:%M')}"
    amount = _money(booking.price_amount, booking.currency)
    if event_type == EVENT_BOOKING_CREATED_RENTER:
        return (
            "Бронирование создано.\n"
            f"Кресло: {chair_name}\n"
            f"Время: {period}\n"
            f"Сумма: {amount}"
        )
    if event_type == EVENT_BOOKING_CREATED_ADMIN:
        return (
            "Новая бронь арендатора.\n"
            f"Арендатор: {renter_name}\n"
            f"Кресло: {chair_name}\n"
            f"Время: {period}\n"
            f"Сумма: {amount}"
        )
    if event_type == EVENT_BOOKING_CANCELLED_BY_RENTER_ADMIN:
        return (
            "Арендатор отменил бронь.\n"
            f"Арендатор: {renter_name}\n"
            f"Кресло: {chair_name}\n"
            f"Время: {period}"
        )
    if event_type == EVENT_BOOKING_CANCELLED_BY_ADMIN_RENTER:
        return (
            "Администратор отменил бронирование.\n"
            f"Кресло: {chair_name}\n"
            f"Время: {period}"
        )
    return f"Уведомление: {event_type}"


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
            await bot.send_message(chat_id=telegram_id, text=text)
            return True, None
        except Exception as exc:  # noqa: BLE001 - delivery must not crash booking flow
            last_error = f"{type(exc).__name__}: {exc}"[:1000]
            logger.warning(
                "telegram notification failed attempt=%s telegram_id=%s error=%s",
                attempt,
                telegram_id,
                type(exc).__name__,
            )
            if attempt < MAX_ATTEMPTS:
                await asyncio.sleep(RETRY_DELAY_SECONDS * attempt)
    return False, last_error


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
        bot = get_bot()
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
            if bot is None:
                log.status = "failed"
                log.attempts = log.attempts
                log.last_error = "telegram bot not configured"
                db.commit()
                logger.warning("notification skipped: bot not configured event=%s recipient=%s", event_type, recipient_id)
                continue
            ok, err = asyncio.run(_send_with_retries(bot, recipient.telegram_id, text))
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
