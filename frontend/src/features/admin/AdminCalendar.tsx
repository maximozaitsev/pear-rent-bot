import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import type { Booking, ChairDay, DaySchedule } from "../../api/types";
import { addDays, firstOfMonth, formatMoney, formatTime, groupByDay, isoDate, mondayOf, monthGridWeeks } from "../schedule/time";
import { BookingCard } from "./BookingCard";
import { Banner, DayStrip, Empty, MonthGrid, Sheet, WeekNav, dayParts, errorText, haptic, personName, todayIso, type PeriodMode } from "../../shared/ui";

type DB = ChairDay["bookings"][number];

function toHours(t: string): number {
  const s = formatTime(t);
  return Number(s.slice(0, 2)) + Number(s.slice(3, 5)) / 60;
}

interface BookingGroup {
  start: string;
  end: string;
  hours: number;
  price: number;
  renter: { name: string; username: string | null };
  payment_status: string;
  booking_type: string;
  ids: string[];
  intervals: string;
}

function groupBookings(bookings: DB[]): BookingGroup[] {
  const groups: BookingGroup[] = [];
  for (const dayGroup of groupByDay(bookings)) {
    const byRenter: Map<string, DB[]> = new Map();
    for (const b of dayGroup.bookings) {
      const renterId = b.renter?.id ?? "unknown";
      const arr = byRenter.get(renterId) ?? [];
      arr.push(b);
      byRenter.set(renterId, arr);
    }
    for (const items of byRenter.values()) {
      const sorted = [...items].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      const renterName = personName(sorted[0].renter, "Занято");
      const paymentStatus = sorted.every((b) => b.payment_status === "paid") ? "paid" : "unpaid";
      const price = sorted.reduce((s, b) => s + (b.price_amount ?? 0), 0);
      const start = formatTime(sorted[0].starts_at);
      const end = formatTime(sorted[sorted.length - 1].ends_at);
      const hours = sorted.reduce((s, b) => s + (b.duration_hours ?? 1), 0);
      const intervals = sorted.map((b) => `${formatTime(b.starts_at)}–${formatTime(b.ends_at)}`).join(", ");
      groups.push({
        start,
        end,
        hours,
        price,
        renter: { name: renterName, username: sorted[0].renter?.username ?? null },
        payment_status: paymentStatus,
        booking_type: sorted[0].booking_type,
        ids: sorted.map((b) => b.id),
        intervals,
      });
    }
  }
  return groups.sort((a, b) => a.start.localeCompare(b.start));
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

export function AdminCalendar({ defaultMode }: { defaultMode?: PeriodMode }) {
  const [mode, setMode] = useState<PeriodMode>(defaultMode ?? "week");
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [monthAnchor, setMonthAnchor] = useState(() => firstOfMonth(new Date()));
  const [days, setDays] = useState<DaySchedule[]>([]);
  const [monthDays, setMonthDays] = useState<Record<string, DaySchedule>>({});
  const [loadedPeriod, setLoadedPeriod] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedBooking, setSelectedBooking] = useState<{ booking: Booking; related: Booking[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (mode === "week") {
        const week = await api.scheduleWeekly(isoDate(weekStart));
        setDays(week.days);
        setLoadedPeriod(`w:${isoDate(weekStart)}`);
        setSelectedDate((prev) =>
          week.days.some((d) => d.date === prev) ? prev : week.days.find((d) => d.date === todayIso())?.date ?? week.days[0]?.date ?? "",
        );
      } else {
        const weeks = monthGridWeeks(monthAnchor);
        const from = weeks[0][0].date;
        const to = weeks[weeks.length - 1][6].date;
        const a = await api.scheduleAvailability(from, addDays(new Date(from + "T00:00:00Z"), 30).toISOString().slice(0, 10));
        const b = await api.scheduleAvailability(addDays(new Date(from + "T00:00:00Z"), 31).toISOString().slice(0, 10), to);
        const map: Record<string, DaySchedule> = {};
        for (const d of [...a.days, ...b.days]) map[d.date] = d;
        setMonthDays(map);
        setLoadedPeriod(`m:${monthAnchor.getUTCFullYear()}-${monthAnchor.getUTCMonth()}`);
        setSelectedDate((prev) => (map[prev] ? prev : (map[todayIso()] ? todayIso() : Object.keys(map).sort()[0] ?? "")));
      }
    } catch (e) { setError(errorText(e, "Ошибка загрузки")); }
    finally { setLoading(false); }
  }, [mode, weekStart, monthAnchor]);

  useEffect(() => { load(); }, [load]);

  async function openBooking(id: string) {
    const daysToSearch = mode === "week" ? days : Object.values(monthDays);
    for (const day of daysToSearch) {
      for (const chair of day.chairs) {
        const found = chair.bookings.find((b) => b.id === id);
        if (found) {
          const related = chair.bookings.filter((b) => b.id !== id && b.renter?.id === found.renter?.id);
          setSelectedBooking({ booking: found as unknown as Booking, related: related as unknown as Booking[] });
          return;
        }
      }
    }
    try {
      const all = await api.adminBookings({});
      const found = all.find((b) => b.id === id);
      if (!found) return;
      const date = found.starts_at.slice(0, 10);
      const day = mode === "week" ? days.find((d) => d.date === date) : monthDays[date];
      const chair = day?.chairs.find((c) => c.chair_id === found.chair_id);
      const related = chair?.bookings.filter((b) => b.id !== id && b.renter?.id === found.renter?.id) ?? [];
      setSelectedBooking({ booking: found, related: related as unknown as Booking[] });
    } catch (e) { setError(errorText(e)); }
  }

  async function refreshAfterChange() {
    await load();
  }

  const activeDays = mode === "week" ? days : Object.values(monthDays).sort((a, b) => a.date.localeCompare(b.date));
  const chairs = days[0]?.chairs ?? Object.values(monthDays)[0]?.chairs ?? [];
  const selectedDay = mode === "week" ? (days.find((d) => d.date === selectedDate) ?? null) : (monthDays[selectedDate] ?? null);
  const counts: Record<string, number> = {};
  for (const d of activeDays) counts[d.date] = d.chairs.reduce((n, c) => n + c.bookings.length, 0);

  const periodStats = useMemo(() => {
    const periodDays = mode === "week"
      ? days
      : Object.values(monthDays).filter((d) => {
          const y = monthAnchor.getUTCFullYear(), m = monthAnchor.getUTCMonth() + 1;
          return d.date.startsWith(`${y}-${String(m).padStart(2, "0")}-`);
        });
    let freeSlots = 0, toPay = 0, paid = 0;
    for (const d of periodDays) {
      if (!d.working_hours.is_open) continue;
      for (const c of d.chairs) {
        if (c.is_free_whole_day) freeSlots++;
        for (const b of c.bookings) {
          const amount = b.price_amount ?? 0;
          if (b.payment_status === "paid") paid += amount; else toPay += amount;
        }
      }
    }
    return { freeSlots, toPay, paid };
  }, [mode, days, monthDays, monthAnchor]);

  return (
    <>
      <WeekNav
        weekStart={mode === "month" ? monthAnchor : weekStart}
        mode={mode}
        onModeChange={(m) => {
          setMode(m);
          if (m === "week") setWeekStart(mondayOf(new Date()));
          else setMonthAnchor(firstOfMonth(new Date(selectedDate ? selectedDate + "T00:00:00Z" : Date.now())));
        }}
        onChange={(d) => { if (mode === "month") setMonthAnchor(firstOfMonth(d)); else setWeekStart(d); }}
        onSelectToday={setSelectedDate}
      />
      {error && <Banner kind="bad" onRetry={load}>{error}</Banner>}
      {(() => {
        const currentPeriod = mode === "week" ? `w:${isoDate(weekStart)}` : `m:${monthAnchor.getUTCFullYear()}-${monthAnchor.getUTCMonth()}`;
        const statsReady = loadedPeriod === currentPeriod;
        return !statsReady ? (
          <div className="skeleton" style={{ height: 62 }} aria-hidden="true" />
        ) : (
          <section className="card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center" }}>
            <div><div className="muted small">Свободно мест</div><div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{periodStats.freeSlots}</div></div>
            <div><div className="muted small">Ждут оплаты</div><div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{formatMoney(periodStats.toPay)}</div></div>
            <div><div className="muted small">Оплачено</div><div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{formatMoney(periodStats.paid)}</div></div>
          </section>
        );
      })()}
      {loading && ((mode === "week" && !days.length) || (mode === "month" && Object.keys(monthDays).length === 0)) && (
        <div className="stack" aria-hidden="true">
          <div className="skeleton" style={{ height: mode === "week" ? 74 : 260 }} />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}

      {(mode === "week" ? !!days.length : Object.keys(monthDays).length > 0 || !loading) && (
        <>
          {mode === "week" ? (
            <DayStrip days={days} selected={selectedDate} onSelect={(d) => setSelectedDate(d.date)} counts={counts} dotVariant="admin" />
          ) : (
            <MonthGrid month={monthAnchor} daysByDate={monthDays} selected={selectedDate} onSelect={(d) => setSelectedDate(d.date)} loading={loading} dotVariant="admin" />
          )}

          {selectedDay && (
            <>
              <div className="section-label">{dayParts(selectedDay.date).long}</div>
              {!selectedDay.working_hours.is_open ? (
                <Empty icon="🔒">Барбершоп закрыт</Empty>
              ) : (
                selectedDay.chairs.map((chair) => {
                  const grouped = groupBookings(chair.bookings);
                  return (
                    <section key={chair.chair_id} className="card">
                      <div className="card-head">
                        <h2>{chair.name}</h2>
                        <span className="muted small">{grouped.length ? `${grouped.length} бр.` : "свободно"}</span>
                      </div>
                      <Occupancy day={selectedDay} bookings={chair.bookings} />
                      {grouped.map((g) => (
                        <button key={g.ids.join(",")} className="item-plain" onClick={() => { haptic(); openBooking(g.ids[0]); }}>
                            <div>
                              <div style={{ fontWeight: 600 }}>{g.booking_type === "full_day" ? "Весь день" : g.intervals} · {g.renter.name}</div>
                              {!!g.price && <div className="muted small">{formatMoney(g.price, chair.bookings[0]?.currency ?? "BYN")}</div>}
                            </div>
                            <span className={`chip ${g.payment_status === "paid" ? "ok" : "warn"}`}>{g.payment_status === "paid" ? "оплачено" : "не оплачено"}</span>
                          </button>
                        ))}
                      <p className="muted small">Свободно: {chair.free_intervals.map((f) => `${formatTime(f.starts_at)}–${formatTime(f.ends_at)}`).join(", ") || "нет"}</p>
                    </section>
                  );
                })
              )}
            </>
          )}

          {mode === "week" && chairs.length > 0 && (
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
          <BookingCard booking={selectedBooking.booking} related={selectedBooking.related} onChanged={refreshAfterChange} onGroupChange={(g) => setSelectedBooking(g)} />
        </Sheet>
      )}
    </>
  );
}
