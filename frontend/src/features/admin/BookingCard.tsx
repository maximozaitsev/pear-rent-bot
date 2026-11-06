// Теперь рендерится внутри <Sheet> (без собственной .card-обёртки).
import { useState } from "react";
import { api } from "../../api/client";
import type { Booking } from "../../api/types";
import { formatDateDot, formatDateTimeDot, formatMoney, formatTime } from "../schedule/time";
import { Banner, dayParts, errorText, haptic, personName } from "../../shared/ui";

export function BookingCard({ booking, onChanged }: { booking: Booking; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paid = booking.payment_status === "paid";
  const active = booking.status === "active";

  async function togglePayment() {
    setBusy(true); setError(null);
    try {
      await api.adminSetPayment(booking.id, paid ? "unpaid" : "paid");
      haptic("success");
      onChanged();
    } catch (e) { haptic("error"); setError(errorText(e)); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (!confirm("Отменить бронирование?")) return;
    setBusy(true); setError(null);
    try { await api.cancelBooking(booking.id, "Отменено администратором"); haptic("success"); onChanged(); }
    catch (e) { haptic("error"); setError(errorText(e)); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="row between">
        <div>
          <h2>{personName(booking.renter)}</h2>
          {booking.renter?.username && <div className="muted small">@{booking.renter.username}</div>}
        </div>
        <span className={`chip ${active ? "ok" : "mute"}`}>{active ? "активна" : booking.status === "cancelled" ? "отменена" : booking.status}</span>
      </div>

      <dl className="kv" style={{ margin: 0 }}>
        <dt>Дата</dt><dd>{dayParts(booking.starts_at.slice(0, 10)).long} ({formatDateDot(booking.starts_at)})</dd>
        <dt>Время</dt><dd>{formatTime(booking.starts_at)}–{formatTime(booking.ends_at)} · {booking.booking_type === "full_day" ? "весь день" : `${booking.duration_hours} ч`}</dd>
        <dt>Стоимость</dt><dd>{formatMoney(booking.price_amount, booking.currency)}</dd>
        <dt>Оплата</dt><dd><span className={`chip ${paid ? "ok" : "warn"}`}>{paid ? "Оплачено" : "Не оплачено"}</span></dd>
        {booking.cancelled_at && <><dt>Отмена</dt><dd>{formatDateTimeDot(booking.cancelled_at)}{booking.cancellation_reason ? ` · ${booking.cancellation_reason}` : ""}</dd></>}
      </dl>

      {error && <Banner kind="bad">{error}</Banner>}
      <div className="stack">
        <button className={`btn btn-block ${paid ? "" : "btn-primary"}`} disabled={busy} onClick={togglePayment}>{paid ? "Снять оплату" : "Отметить оплаченной"}</button>
        {active && <button className="btn btn-danger btn-block" disabled={busy} onClick={cancel}>Отменить бронь</button>}
      </div>
    </>
  );
}
