import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import type { Booking } from "../../api/types";
import { addMonths, firstOfMonth, formatMoney, formatTime, monthLabelRu } from "../schedule/time";
import { Banner, Empty, Icon, dayParts, errorText, haptic } from "../../shared/ui";

export function MyBookings({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<Booking[] | null>(null);
  const [month, setMonth] = useState(() => firstOfMonth(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setError(null);
    try { setItems(await api.myBookings()); }
    catch (e) { setError(errorText(e, "Ошибка загрузки")); }
  }

  useEffect(() => { load(); }, []);

  const monthKey = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthItems = useMemo(() => (items ?? []).filter((b) => b.starts_at.slice(0, 7) === monthKey), [items, monthKey]);
  const stats = useMemo(() => {
    const days = new Set(monthItems.map((b) => b.starts_at.slice(0, 10)));
    let toPay = 0, paid = 0;
    for (const b of monthItems) {
      if (b.payment_status === "paid") paid += b.price_amount; else toPay += b.price_amount;
    }
    return { workDays: days.size, toPay, paid };
  }, [monthItems]);

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
      <div className="weeknav">
        <button className="icon-btn" onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Предыдущий месяц"><Icon name="left" /></button>
        <div className="period-label" style={{ cursor: "default" }}><span>{monthLabelRu(month)} {month.getUTCFullYear()}</span></div>
        <button className="icon-btn" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Следующий месяц"><Icon name="right" /></button>
      </div>
      <section className="card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center" }}>
        <div><div className="muted small">Рабочих дней</div><div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{stats.workDays}</div></div>
        <div><div className="muted small">К оплате</div><div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{formatMoney(stats.toPay)}</div></div>
        <div><div className="muted small">Оплачено</div><div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{formatMoney(stats.paid)}</div></div>
      </section>
      {error && <Banner kind="bad" onRetry={load}>{error}</Banner>}
      {!items && !error && <><div className="skeleton" /><div className="skeleton" /></>}
      {items && monthItems.length === 0 && <Empty icon="📭">В этом месяце броней нет.</Empty>}
      <ul className="list">
        {monthItems.map((b) => {
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
