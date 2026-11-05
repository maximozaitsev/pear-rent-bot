import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Booking, ChairDay, DaySchedule } from "../../api/types";
import { formatMoney, formatTime, isoDate, mondayOf } from "../schedule/time";
import { BookingCard } from "./BookingCard";
import { Banner, DayStrip, Empty, Loader, Sheet, WeekNav, dayParts, errorText, haptic, personName, todayIso } from "../../shared/ui";

type DB = ChairDay["bookings"][number];

function toHours(t: string): number {
  const s = formatTime(t);
  return Number(s.slice(0, 2)) + Number(s.slice(3, 5)) / 60;
}

function Occupancy({ day, bookings }: { day: DaySchedule; bookings: DB[] }) {
  const o = day.working_hours.open_time ? Number(day.working_hours.open_time.slice(0, 2)) : 9;
  const c = day.working_hours.close_time ? Number(day.working_hours.close_time.slice(0, 2)) : 22;
  const span = Math.max(1, c - o);
  return (
    <div className="occ" aria-hidden="true">
      {bookings.map((b) => {
        const left = ((toHours(b.starts_at) - o) / span) * 100;
        const width = ((toHours(b.ends_at) - toHours(b.starts_at)) / span) * 100;
        return <i key={b.id} className={b.payment_status === "paid" ? "" : "unpaid"} style={{ left: `${left}%`, width: `${width}%` }} />;
      })}
    </div>
  );
}

export function AdminCalendar() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [days, setDays] = useState<DaySchedule[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const week = await api.scheduleWeekly(isoDate(weekStart));
      setDays(week.days);
      setSelectedDate((prev) =>
        week.days.some((d) => d.date === prev) ? prev : week.days.find((d) => d.date === todayIso())?.date ?? week.days[0]?.date ?? "",
      );
    } catch (e) { setError(errorText(e, "Ошибка загрузки")); }
    finally { setLoading(false); }
  }, [weekStart]);

  useEffect(() => { load(); }, [load]);

  async function openBooking(id: string) {
    try {
      const all = await api.adminBookings({});
      const found = all.find((b) => b.id === id);
      if (found) setSelectedBooking(found);
    } catch (e) { setError(errorText(e)); }
  }

  async function refreshAfterChange() {
    await load();
    if (selectedBooking) await openBooking(selectedBooking.id).catch(() => setSelectedBooking(null));
  }

  const chairs = days[0]?.chairs ?? [];
  const selectedDay = days.find((d) => d.date === selectedDate) ?? null;
  const counts: Record<string, number> = {};
  for (const d of days) counts[d.date] = d.chairs.reduce((n, c) => n + c.bookings.length, 0);

  return (
    <>
      <WeekNav weekStart={weekStart} onChange={setWeekStart} />
      {error && <Banner kind="bad" onRetry={load}>{error}</Banner>}
      {loading && !days.length && <Loader />}

      {!!days.length && (
        <>
          <DayStrip days={days} selected={selectedDate} onSelect={(d) => setSelectedDate(d.date)} counts={counts} />

          {selectedDay && (
            <>
              <div className="section-label">{dayParts(selectedDay.date).long}</div>
              {!selectedDay.working_hours.is_open ? (
                <Empty icon="🔒">Барбершоп закрыт</Empty>
              ) : (
                selectedDay.chairs.map((chair) => (
                  <section key={chair.chair_id} className="card">
                    <div className="card-head">
                      <h2>{chair.name}</h2>
                      <span className="muted small">{chair.bookings.length ? `${chair.bookings.length} бр.` : "свободно"}</span>
                    </div>
                    <Occupancy day={selectedDay} bookings={chair.bookings} />
                    {chair.bookings.map((b) => (
                      <button key={b.id} className="item-plain" onClick={() => { haptic(); openBooking(b.id); }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{b.booking_type === "full_day" ? "Весь день" : `${formatTime(b.starts_at)}–${formatTime(b.ends_at)}`} · {personName(b.renter, "Занято")}</div>
                          {!!b.price_amount && <div className="muted small">{formatMoney(b.price_amount, b.currency)}</div>}
                        </div>
                        <span className={`chip ${b.payment_status === "paid" ? "ok" : "warn"}`}>{b.payment_status === "paid" ? "оплачено" : "не оплачено"}</span>
                      </button>
                    ))}
                    <p className="muted small">Свободно: {chair.free_intervals.map((f) => `${formatTime(f.starts_at)}–${formatTime(f.ends_at)}`).join(", ") || "нет"}</p>
                  </section>
                ))
              )}
            </>
          )}

          {chairs.length > 0 && (
            <>
              <div className="section-label">Обзор недели</div>
              <section className="card">
                <div className="matrix-wrap">
                  <table className="matrix">
                    <thead>
                      <tr><th />{days.map((d) => <th key={d.date}>{dayParts(d.date).wd}<br />{dayParts(d.date).num}</th>)}</tr>
                    </thead>
                    <tbody>
                      {chairs.map((chairRef) => (
                        <tr key={chairRef.chair_id}>
                          <th className="rowh">{chairRef.name}</th>
                          {days.map((day) => {
                            const chair = day.chairs.find((c) => c.chair_id === chairRef.chair_id);
                            if (!chair || !day.working_hours.is_open) return <td key={day.date}><button disabled>—</button></td>;
                            const n = chair.bookings.length;
                            const unpaid = chair.bookings.some((b) => b.payment_status !== "paid");
                            return (
                              <td key={day.date}>
                                <button className={`${n ? (unpaid ? "unpaid" : "has") : ""} ${day.date === selectedDate ? "sel" : ""}`} onClick={() => setSelectedDate(day.date)}>
                                  {n || ""}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="legend">
                  <span><i style={{ background: "color-mix(in srgb, var(--ok) 40%, transparent)" }} />оплачено</span>
                  <span><i style={{ background: "color-mix(in srgb, var(--warn) 40%, transparent)" }} />есть неоплаченные</span>
                </div>
              </section>
            </>
          )}
        </>
      )}

      {selectedBooking && (
        <Sheet title="Бронь" onClose={() => setSelectedBooking(null)}>
          <BookingCard booking={selectedBooking} onChanged={refreshAfterChange} />
        </Sheet>
      )}
    </>
  );
}
