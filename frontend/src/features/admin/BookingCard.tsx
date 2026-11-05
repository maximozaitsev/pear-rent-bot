import { useState } from "react";
import { ApiError, api, conflictText } from "../../api/client";
import type { Booking } from "../../api/types";
import { formatMoney, formatTime } from "../schedule/time";

function renterName(b: Booking): string {
  const r = b.renter;
  if (!r) return "—";
  return [r.first_name, r.last_name].filter(Boolean).join(" ") || r.username || String(r.telegram_id);
}

export function BookingCard({ booking, onChanged }: { booking: Booking; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function togglePayment() {
    setBusy(true); setError(null);
    try {
      await api.adminSetPayment(booking.id, booking.payment_status === "paid" ? "unpaid" : "paid");
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка"); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (!confirm("Отменить бронирование?")) return;
    setBusy(true); setError(null);
    try { await api.cancelBooking(booking.id, "Отменено администратором"); onChanged(); }
    catch (e) {
      if (e instanceof ApiError) setError(conflictText(e.detail) || e.message);
      else setError(e instanceof Error ? e.message : "Ошибка");
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h2>Бронь</h2>
      <p><strong>{renterName(booking)}</strong> {booking.renter?.username ? `(@${booking.renter.username})` : ""}</p>
      <p>{booking.starts_at.slice(0, 10)} {formatTime(booking.starts_at)}–{formatTime(booking.ends_at)} · {booking.booking_type === "full_day" ? "весь день" : `${booking.duration_hours} ч`}</p>
      <p>{formatMoney(booking.price_amount, booking.currency)} · статус: {booking.status}</p>
      <p>Оплата: <strong>{booking.payment_status === "paid" ? "Оплачено" : "Не оплачено"}</strong></p>
      {booking.cancelled_at && <p className="muted">Отменено: {booking.cancelled_at.slice(0, 16)} {booking.cancellation_reason ? `(${booking.cancellation_reason})` : ""}</p>}
      {error && <p className="error">{error}</p>}
      <div className="row gap wrap">
        <button disabled={busy} onClick={togglePayment}>{booking.payment_status === "paid" ? "Снять оплату" : "Отметить оплачено"}</button>
        {booking.status === "active" && <button className="danger" disabled={busy} onClick={cancel}>Отменить бронь</button>}
      </div>
    </div>
  );
}
