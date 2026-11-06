import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { ChairDay, DaySchedule, WeekSchedule } from "../../api/types";
import { addDays, firstOfMonth, formatTime, isoDate, mondayOf, monthGridWeeks } from "./time";
import { ChairPicker } from "./ChairPicker";
import { Banner, DayStrip, Empty, Icon, Loader, MonthGrid, WeekNav, dayParts, errorText, haptic, todayIso, type PeriodMode } from "../../shared/ui";

function chairStatus(chair: ChairDay): { label: string; tone: "ok" | "warn" | "bad" } {
  if (chair.is_fully_booked) return { label: "Занято", tone: "bad" };
  if (chair.is_partially_booked) return { label: "Частично", tone: "warn" };
  return { label: "Свободно", tone: "ok" };
}

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
      />
      {error && <Banner kind="bad" onRetry={load}>{error}</Banner>}
      {loading && ((mode === "week" && !week) || (mode === "month" && Object.keys(monthDays).length === 0)) && <Loader />}
      {mode === "week" && week && <DayStrip days={week.days} selected={selectedDate} onSelect={(d) => setSelectedDate(d.date)} />}
      {mode === "month" && <MonthGrid month={monthAnchor} daysByDate={monthDays} selected={selectedDate} onSelect={(d) => setSelectedDate(d.date)} loading={loading} />}

      {selectedDay && (
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
