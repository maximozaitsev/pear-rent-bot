import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Booking } from "../../api/types";
import { formatMoney, formatTime } from "../schedule/time";
import { Banner, Empty, dayParts, errorText, haptic } from "../../shared/ui";

export function MyBookings({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setError(null);
    try { setItems(await api.myBookings()); }
    catch (e) { setError(errorText(e, "Ошибка загрузки")); }
  }

  useEffect(() => { load(); }, []);

  async function cancel(id: string) {
    if (!confirm("Отменить бронирование?")) return;
    setBusyId(id);
    try {
      await api.cancelBooking(id);
      haptic("success");
      await load();
      onChanged?.();
    } catch (e) {
      haptic("error");
      setError(errorText(e, "Не удалось отменить"));
    } finally { setBusyId(null); }
  }

  return (
    <>
      {error && <Banner kind="bad" onRetry={load}>{error}</Banner>}
      {!items && !error && <><div className="skeleton" /><div className="skeleton" /></>}
      {items?.length === 0 && <Empty icon="📭">Активных бронирований нет.<br />Выберите время на вкладке «Расписание».</Empty>}
      <ul className="list">
        {items?.map((b) => {
          const p = dayParts(b.starts_at.slice(0, 10));
          return (
            <li key={b.id} className="item">
              <div className="date-badge"><b>{p.num}</b><span>{p.mon}</span></div>
              <div className="grow">
                <div className="title">{formatTime(b.starts_at)}–{formatTime(b.ends_at)}</div>
                <div className="meta">{b.booking_type === "full_day" ? "Весь день" : `${b.duration_hours} ч`} · {formatMoney(b.price_amount, b.currency)}</div>
              </div>
              <button className="btn btn-sm btn-danger" disabled={busyId === b.id} onClick={() => cancel(b.id)}>
                {busyId === b.id ? "..." : "Отменить"}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
