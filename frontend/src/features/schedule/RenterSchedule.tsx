import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import type { ChairDay, DaySchedule, WeekSchedule } from "../../api/types";
import { addDays, firstOfMonth, formatMoney, formatTime, isoDate, mondayOf, monthGridWeeks } from "./time";
import { ChairPicker } from "./ChairPicker";
import { Banner, DayStrip, Empty, Icon, Loader, MonthGrid, Sheet, WeekNav, dayParts, errorText, haptic, todayIso, type PeriodMode } from "../../shared/ui";

function chairStatus(chair: ChairDay): { label: string; tone: "ok" | "warn" | "bad" } {
  if (chair.is_fully_booked) return { label: "Занято", tone: "bad" };
  if (chair.is_partially_booked) return { label: "Частично", tone: "warn" };
  return { label: "Свободно", tone: "ok" };
}

const FULL_DAY_PRICE = 6000;

export function RenterSchedule({ refreshKey }: { refreshKey?: number }) {
  const [mode, setMode] = useState<PeriodMode>("week");
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [monthAnchor, setMonthAnchor] = useState(() => firstOfMonth(new Date()));
  const [week, setWeek] = useState<WeekSchedule | null>(null);
  const [monthDays, setMonthDays] = useState<Record<string, DaySchedule>>({});
  const [selectedDate, setSelectedDate] = useState("");
  const [picker, setPicker] = useState<{ day: DaySchedule; chair: ChairDay } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [targetChairId, setTargetChairId] = useState<string | null>(null);
  const [pickedDates, setPickedDates] = useState<Set<string>>(new Set());
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingReport, setBookingReport] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (mode === "week") {
        const data = await api.scheduleWeekly(isoDate(weekStart));
        setWeek(data);
        setSelectedDate((prev) =>
          data.days.some((d) => d.date === prev) ? prev : data.days.find((d) => d.date === todayIso())?.date ?? data.days[0]?.date ?? "",
        );
      } else {
        const weeks = monthGridWeeks(monthAnchor);
        const from = weeks[0][0].date;
        const to = weeks[weeks.length - 1][6].date;
        // Schedule/availability API supports up to 31 days per request.
        const a = await api.scheduleAvailability(from, addDays(new Date(from + "T00:00:00Z"), 30).toISOString().slice(0, 10));
        const b = await api.scheduleAvailability(addDays(new Date(from + "T00:00:00Z"), 31).toISOString().slice(0, 10), to);
        const map: Record<string, DaySchedule> = {};
        for (const d of [...a.days, ...b.days]) map[d.date] = d;
        setMonthDays(map);
        setSelectedDate((prev) => (map[prev] ? prev : (map[todayIso()] ? todayIso() : Object.keys(map).sort()[0] ?? "")));
      }
    } catch (e) {
      setError(errorText(e, "Не удалось загрузить расписание"));
    } finally { setLoading(false); }
  }, [mode, weekStart, monthAnchor]);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function openChair(day: DaySchedule, chairId: string) {
    setError(null);
    try {
      const fresh = await api.scheduleDay(day.date);
      const chair = fresh.chairs.find((c) => c.chair_id === chairId);
      setPicker(chair ? { day: fresh, chair } : null);
    } catch (e) {
      setError(errorText(e));
    }
  }

  const selectedDay = mode === "week" ? (week?.days.find((d) => d.date === selectedDate) ?? null) : (monthDays[selectedDate] ?? null);
  const daysByDate = useMemo(() => {
    if (mode === "week") {
      const m: Record<string, DaySchedule> = {};
      for (const d of week?.days ?? []) m[d.date] = d;
      return m;
    }
    return monthDays;
  }, [mode, week, monthDays]);
  const allChairs = useMemo(() => {
    const first = Object.values(daysByDate)[0];
    return first?.chairs.map((c) => ({ id: c.chair_id, name: c.name })) ?? [];
  }, [daysByDate]);
  const targetChair = allChairs.find((c) => c.id === targetChairId) ?? null;

  function isDayBookable(d: DaySchedule): boolean {
    if (!d.working_hours.is_open || !targetChairId) return false;
    const chair = d.chairs.find((c) => c.chair_id === targetChairId);
    return !!chair && chair.is_free_whole_day;
  }

  function canPickDate(d: DaySchedule): boolean {
    if (!targetChairId) return !!d.working_hours.is_open;
    return isDayBookable(d);
  }

  function toggleSelectMode() {
    setSelectMode((v) => {
      const next = !v;
      if (next) {
        setTargetChairId((id) => id ?? allChairs[0]?.id ?? null);
        setPickedDates(new Set()); setBookingReport(null); setError(null);
      } else {
        setPickedDates(new Set()); setBookingReport(null);
      }
      return next;
    });
  }

  function onDayPick(d: DaySchedule) {
    if (selectMode) {
      if (!targetChairId) {
        haptic();
        setError("Сначала выберите кресло для бронирования целых дней.");
        return;
      }
      if (!isDayBookable(d)) return;
      haptic();
      setError(null); setBookingReport(null);
      setPickedDates((prev) => {
        const next = new Set(prev);
        if (next.has(d.date)) next.delete(d.date); else next.add(d.date);
        return next;
      });
      return;
    }
    setSelectedDate(d.date);
  }

  async function submitPicked() {
    if (!targetChairId || !targetChair || pickedDates.size === 0) return;
    setBookingBusy(true); setError(null); setBookingReport(null);
    const dates = Array.from(pickedDates).sort();
    const ok: string[] = [];
    const fail: string[] = [];
    try {
      for (const date of dates) {
        const day = daysByDate[date];
        const wh = day?.working_hours;
        if (!day || !wh?.is_open || !wh.open_time || !wh.close_time) { fail.push(date); continue; }
        try {
          await api.createBooking({
            chair_id: targetChairId,
            starts_at: `${date}T${wh.open_time.slice(0, 5)}:00`,
            ends_at: `${date}T${wh.close_time.slice(0, 5)}:00`,
            booking_type: "full_day",
          });
          ok.push(date);
        } catch { fail.push(date); }
      }
      await load();
      setPickedDates(new Set(fail));
      if (ok.length && !fail.length) {
        haptic("success");
        setBookingReport(`Забронировано: ${ok.length} дн. · ${targetChair.name} · ${formatMoney(ok.length * FULL_DAY_PRICE)}.`);
      } else if (ok.length) {
        setBookingReport(`Забронировано: ${ok.length} дн. · ${targetChair.name} · ${formatMoney(ok.length * FULL_DAY_PRICE)}. Не удалось: ${fail.length}.`);
      } else {
        setError("Не удалось создать бронирования. Расписание обновлено.");
      }
    } finally { setBookingBusy(false); }
  }

  const pickedCount = pickedDates.size;

  return (
    <>
      <WeekNav
        weekStart={mode === "month" ? monthAnchor : weekStart}
        mode={mode}
        onModeChange={(m) => {
          setMode(m);
          setPickedDates(new Set()); setBookingReport(null);
          if (m === "week") setWeekStart(mondayOf(new Date()));
          else setMonthAnchor(firstOfMonth(new Date(selectedDate ? selectedDate + "T00:00:00Z" : Date.now())));
        }}
        onChange={(d) => { if (mode === "month") setMonthAnchor(firstOfMonth(d)); else setWeekStart(d); }}
        actionLabel="Выбрать"
        actionActive={selectMode}
        onAction={toggleSelectMode}
      />
      {error && <Banner kind="bad" onRetry={load}>{error}</Banner>}
      {bookingReport && <Banner kind="ok">{bookingReport}</Banner>}
      {loading && ((mode === "week" && !week) || (mode === "month" && Object.keys(monthDays).length === 0)) && <Loader />}

      {mode === "week" && week && (
        <DayStrip
          days={week.days}
          selected={selectedDate}
          onSelect={onDayPick}
          pickedDates={selectMode ? pickedDates : undefined}
          canPickDate={selectMode ? canPickDate : undefined}
          dotVariant="renter"
          pickedChairId={selectMode ? (targetChairId ?? undefined) : undefined}
        />
      )}
      {mode === "month" && (
        <MonthGrid
          month={monthAnchor}
          daysByDate={monthDays}
          selected={selectedDate}
          onSelect={onDayPick}
          loading={loading}
          pickedDates={selectMode ? pickedDates : undefined}
          canPickDate={selectMode ? canPickDate : undefined}
          dotVariant="renter"
          pickedChairId={selectMode ? (targetChairId ?? undefined) : undefined}
        />
      )}

      {selectMode && (
        <section className="card stack">
          <div className="section-label" style={{ padding: 0 }}>Бронирование целых дней (одно кресло)</div>
          <div className="row wrap" style={{ gap: 8 }}>
            {allChairs.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`btn btn-sm ${targetChairId === c.id ? "btn-primary" : "btn-ghost"}`}
                onClick={() => { haptic(); setTargetChairId(c.id); setPickedDates(new Set()); setBookingReport(null); setError(null); }}
              >{c.name}</button>
            ))}
          </div>
          {!targetChairId && <p className="muted small">Сначала выберите кресло, затем отметьте дни в календаре.</p>}
          {targetChairId && <p className="muted small">Отмечайте дни, свободные целиком для «{targetChair?.name}». Недоступные дни нельзя выбрать.</p>}
          <div className="price-line">
            <span className="muted">
              Забронировано: <b>{pickedCount}</b> дн.
              {targetChair && <><br />{targetChair.name}</>}
            </span>
            <b>{pickedCount ? formatMoney(pickedCount * FULL_DAY_PRICE) : "—"}</b>
          </div>
          <button className="btn btn-primary btn-block" disabled={!targetChairId || pickedCount === 0 || bookingBusy} onClick={submitPicked}>
            {bookingBusy ? "Бронирование..." : "Забронировать выбранные дни"}
          </button>
          <p className="muted small">Тариф полного дня: {formatMoney(FULL_DAY_PRICE)}. Итог подтверждает сервер.</p>
        </section>
      )}

      {selectedDay && !selectMode && (
        <>
          <div className="section-label">{dayParts(selectedDay.date).long}</div>
          {!selectedDay.working_hours.is_open ? (
            <Empty icon="🔒">Барбершоп в этот день закрыт</Empty>
          ) : !selectedDay.chairs.length ? (
            <Empty icon="💺">Нет доступных кресел</Empty>
          ) : (
            <ul className="list">
              {selectedDay.chairs.map((chair) => {
                const st = chairStatus(chair);
                const free = chair.free_intervals.map((f) => `${formatTime(f.starts_at)}–${formatTime(f.ends_at)}`).join(", ");
                return (
                  <li key={chair.chair_id}>
                    <button className="item" disabled={chair.is_fully_booked} onClick={() => { haptic(); openChair(selectedDay, chair.chair_id); }}>
                      <div className="grow">
                        <div className="title">{chair.name}</div>
                        <div className="meta">{chair.is_fully_booked ? "Нет свободного времени" : `Свободно: ${free || "—"}`}</div>
                      </div>
                      <span className={`chip ${st.tone}`}>{st.label}</span>
                      {!chair.is_fully_booked && <Icon name="right" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {picker && (
        <ChairPicker
          day={picker.day}
          chair={picker.chair}
          onClose={() => setPicker(null)}
          onBooked={() => { setPicker(null); load(); }}
          onStale={async () => { await Promise.all([load(), openChair(picker.day, picker.chair.chair_id)]); }}
        />
      )}
    </>
  );
}
