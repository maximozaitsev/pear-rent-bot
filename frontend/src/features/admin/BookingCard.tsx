// Теперь рендерится внутри <Sheet> (без собственной .card-обёртки).
import { useState } from "react";
import { api } from "../../api/client";
import type { Booking } from "../../api/types";
import { formatMoney, formatTime } from "../schedule/time";
import { Banner, dayParts, errorText, haptic, personName } from "../../shared/ui";

export function BookingCard({ booking, related, onChanged, onGroupChange }: { booking: Booking; related: Booking[]; onChanged: () => void; onGroupChange?: (g: { booking: Booking; related: Booking[] }) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allIds = [...new Set([booking.id, ...related.map((b) => b.id)])];
  const allBookings = [booking, ...related.filter((b) => b.id !== booking.id)];
  const allPaid = allBookings.every((b) => b.payment_status === "paid");
  const allActive = allBookings.every((b) => b.status === "active");
  const totalPrice = allBookings.reduce((s, b) => s + (b.price_amount ?? 0), 0);
  const intervals = allBookings
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((b) => `${formatTime(b.starts_at)}–${formatTime(b.ends_at)}`)
    .join(", ");
  const hours = allBookings.reduce((s, b) => s + (b.duration_hours ?? 1), 0);
  const first = allBookings[0];

  async function setPayment(targetPaid: boolean) {
    setBusy(true); setError(null);
    try {
      await Promise.all(allIds.map((id) => api.adminSetPayment(id, targetPaid ? "paid" : "unpaid")));
      const next = { booking: { ...booking, payment_status: targetPaid ? "paid" : "unpaid" }, related: allBookings.map((b) => ({ ...b, payment_status: targetPaid ? "paid" : "unpaid" })) };
      onGroupChange?.(next);
      haptic("success");
      onChanged();
    } catch (e) { haptic("error"); setError(errorText(e)); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (!confirm("Отменить все часы этого дня?")) return;
    setBusy(true); setError(null);
    try {
      await Promise.all(allIds.map((id) => api.cancelBooking(id)));
      const next = { booking: { ...booking, status: "cancelled" }, related: allBookings.map((b) => ({ ...b, status: "cancelled" })) };
      onGroupChange?.(next);
      haptic("success");
      onChanged();
    } catch (e) { haptic("error"); setError(errorText(e)); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="row between">
        <div>
          <h2>{personName(first.renter)}</h2>
          {first.renter?.username && <div className="muted small">@{first.renter.username}</div>}
        </div>
        <span className={`chip ${allActive ? "ok" : "mute"}`}>{allActive ? "активно" : "отменено"}</span>
      </div>

      <dl className="kv" style={{ margin: 0 }}>
        <dt>Дата</dt><dd>{dayParts(first.starts_at.slice(0, 10)).long} ({first.starts_at.slice(0, 10)})</dd>
        <dt>Время</dt><dd>{intervals} · {hours} ч</dd>
        <dt>Стоимость</dt><dd>{formatMoney(totalPrice, first.currency)}</dd>
        <dt>Оплата</dt><dd><span className={`chip ${allPaid ? "ok" : "warn"}`}>{allPaid ? "Оплачено" : "Не оплачено"}</span></dd>
      </dl>

      {error && <Banner kind="bad">{error}</Banner>}
      <div className="stack">
        <button className={`btn btn-block ${allPaid ? "" : "btn-primary"}`} disabled={busy} onClick={() => setPayment(!allPaid)}>{allPaid ? "Снять оплату" : "Отметить оплаченной"}</button>
        {allActive && <button className="btn btn-danger btn-block" disabled={busy} onClick={cancel}>Отменить день</button>}
      </div>
    </>
  );
}
