import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Booking, DaySchedule } from "../../api/types";
import { addDays, formatDateRu, formatMoney, formatTime, isoDate, mondayOf } from "../schedule/time";
import { BookingCard } from "./BookingCard";

function renterName(b: NonNullable<DaySchedule["chairs"][number]["bookings"][number]>): string {
  const r = b.renter;
  if (!r) return "Занято";
  return [r.first_name, r.last_name].filter(Boolean).join(" ") || r.username || String(r.telegram_id);
}

export function AdminCalendar() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [days, setDays] = useState<DaySchedule[]>([]);
  const [selectedDay, setSelectedDay] = useState<DaySchedule | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const week = await api.scheduleWeekly(isoDate(weekStart));
      setDays(week.days);
      if (selectedDay) {
        const freshDay = week.days.find((d) => d.date === selectedDay.date) ?? null;
        setSelectedDay(freshDay);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка загрузки"); }
    finally { setLoading(false); }
  }, [weekStart, selectedDay?.date]);

  useEffect(() => { load(); }, [weekStart]);

  async function openBooking(id: string) {
    try {
      const all = await api.adminBookings({});
      const found = all.find((b) => b.id === id);
      if (found) setSelectedBooking(found);
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка"); }
  }

  async function refreshAfterChange() {
    await load();
    if (selectedBooking) await openBooking(selectedBooking.id).catch(() => setSelectedBooking(null));
  }

  const chairs = days[0]?.chairs ?? [];

  return (
    <>
      <section className="card">
        <div className="row between wrap">
          <h2>Календарь (кресла × даты)</h2>
          <div className="row gap">
            <button onClick={() => setWeekStart(addDays(weekStart, -7))}>← Неделя</button>
            <button onClick={() => setWeekStart(mondayOf(new Date()))}>Сегодня</button>
            <button onClick={() => setWeekStart(addDays(weekStart, 7))}>Неделя →</button>
          </div>
        </div>
        {error && <p className="error">{error} <button className="link" onClick={load}>Повторить</button></p>}
        {loading && !days.length && <p className="muted">Загрузка...</p>}
        {!!days.length && (
          <div style={{ overflowX: "auto" }}>
            <table className="admin-grid">
              <thead><tr><th>Кресло</th>{days.map((d) => <th key={d.date}><button className="link" onClick={() => setSelectedDay(d)}>{formatDateRu(d.date)}</button></th>)}</tr></thead>
              <tbody>
                {chairs.map((chairRef) => (
                  <tr key={chairRef.chair_id}>
                    <th>{chairRef.name}</th>
                    {days.map((day) => {
                      const chair = day.chairs.find((c) => c.chair_id === chairRef.chair_id);
                      if (!chair) return <td key={day.date}>—</td>;
                      if (!day.working_hours.is_open) return <td key={day.date}><span className="chip status-closed">Закрыто</span></td>;
                      if (!chair.bookings.length) return <td key={day.date}><span className="chip status-free">Свободно</span></td>;
                      return (
                        <td key={day.date}>
                          {chair.bookings.map((b) => (
                            <button key={b.id} className={`cell-booking ${b.payment_status === "paid" ? "paid" : "unpaid"}`} onClick={() => openBooking(b.id)}>
                              <div>{renterName(b)}</div>
                              <div className="small">{b.booking_type === "full_day" ? "весь день" : `${formatTime(b.starts_at)}–${formatTime(b.ends_at)}`}</div>
                              <div className="small">{b.payment_status === "paid" ? "оплачено" : "не оплачено"} {b.price_amount ? `· ${formatMoney(b.price_amount, b.currency)}` : ""}</div>
                            </button>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedDay && (
        <section className="card">
          <div className="row between"><h2>День: {formatDateRu(selectedDay.date)}</h2><button className="link" onClick={() => setSelectedDay(null)}>Закрыть</button></div>
          {!selectedDay.working_hours.is_open ? <p className="muted">Барбершоп закрыт.</p> : selectedDay.chairs.map((chair) => (
            <div key={chair.chair_id} className="subcard">
              <strong>{chair.name}</strong>
              <p className="muted small">Свободно: {chair.free_intervals.map((f) => `${formatTime(f.starts_at)}–${formatTime(f.ends_at)}`).join(", ") || "нет"}</p>
              {chair.bookings.map((b) => (
                <button key={b.id} className="list-item action" onClick={() => openBooking(b.id)}>
                  <span>{formatTime(b.starts_at)}–{formatTime(b.ends_at)} · {renterName(b)}</span>
                  <span className={`chip ${b.payment_status === "paid" ? "status-free" : "status-partial"}`}>{b.payment_status === "paid" ? "оплачено" : "не оплачено"}</span>
                </button>
              ))}
            </div>
          ))}
        </section>
      )}

      {selectedBooking && (
        <>
          <BookingCard booking={selectedBooking} onChanged={refreshAfterChange} />
          <button className="link" onClick={() => setSelectedBooking(null)}>Закрыть карточку брони</button>
        </>
      )}
    </>
  );
}
