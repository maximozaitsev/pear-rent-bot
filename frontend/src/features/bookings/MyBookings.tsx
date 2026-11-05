import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Booking } from "../../api/types";
import { formatMoney, formatTime } from "../schedule/time";

export function MyBookings({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setError(null);
    try { setItems(await api.myBookings()); }
    catch (e) { setError(e instanceof Error ? e.message : "Ошибка загрузки"); }
  }

  useEffect(() => { load(); }, []);

  async function cancel(id: string) {
    if (!confirm("Отменить бронирование?")) return;
    setBusyId(id);
    try {
      await api.cancelBooking(id);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отменить");
    } finally { setBusyId(null); }
  }

  return (
    <section className="card">
      <h2>Мои бронирования</h2>
      {error && <p className="error">{error} <button className="link" onClick={load}>Повторить</button></p>}
      {!items && !error && <p className="muted">Загрузка...</p>}
      {items?.length === 0 && <p className="muted">Активных бронирований нет.</p>}
      <ul className="list">
        {items?.map((b) => (
          <li key={b.id} className="list-item">
            <div>
              <strong>{b.starts_at.slice(0, 10)}</strong> {formatTime(b.starts_at)}–{formatTime(b.ends_at)}
              <div className="muted">{b.booking_type === "full_day" ? "Весь день" : `${b.duration_hours} ч`} · {formatMoney(b.price_amount, b.currency)}</div>
            </div>
            <button className="danger" disabled={busyId === b.id} onClick={() => cancel(b.id)}>
              {busyId === b.id ? "..." : "Отменить"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
