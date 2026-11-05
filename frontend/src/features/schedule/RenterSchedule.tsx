import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { ChairDay, DaySchedule, WeekSchedule } from "../../api/types";
import { addDays, formatTime, isoDate, mondayOf } from "./time";
import { ChairPicker } from "./ChairPicker";
import { Banner, DayStrip, Empty, Icon, Loader, WeekNav, dayParts, errorText, haptic, todayIso } from "../../shared/ui";

function chairStatus(chair: ChairDay): { label: string; tone: "ok" | "warn" | "bad" } {
  if (chair.is_fully_booked) return { label: "Занято", tone: "bad" };
  if (chair.is_partially_booked) return { label: "Частично", tone: "warn" };
  return { label: "Свободно", tone: "ok" };
}

export function RenterSchedule({ refreshKey }: { refreshKey?: number }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [week, setWeek] = useState<WeekSchedule | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [picker, setPicker] = useState<{ day: DaySchedule; chair: ChairDay } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await api.scheduleWeekly(isoDate(weekStart));
      setWeek(data);
      setSelectedDate((prev) =>
        data.days.some((d) => d.date === prev) ? prev : data.days.find((d) => d.date === todayIso())?.date ?? data.days[0]?.date ?? "",
      );
    } catch (e) {
      setError(errorText(e, "Не удалось загрузить расписание"));
    } finally { setLoading(false); }
  }, [weekStart]);

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

  const selectedDay = week?.days.find((d) => d.date === selectedDate) ?? null;

  return (
    <>
      <WeekNav weekStart={weekStart} onChange={setWeekStart} />
      {error && <Banner kind="bad" onRetry={load}>{error}</Banner>}
      {loading && !week && <Loader />}
      {week && <DayStrip days={week.days} selected={selectedDate} onSelect={(d) => setSelectedDate(d.date)} />}

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
