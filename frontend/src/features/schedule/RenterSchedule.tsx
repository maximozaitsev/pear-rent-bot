import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { ChairDay, DaySchedule, WeekSchedule } from "../../api/types";
import { addDays, formatDateRu, isoDate, mondayOf } from "./time";
import { ChairPicker } from "./ChairPicker";

function chairStatus(chair: ChairDay, closed: boolean): { label: string; cls: string } {
  if (closed) return { label: "Закрыто", cls: "status-closed" };
  if (chair.is_fully_booked) return { label: "Занято", cls: "status-busy" };
  if (chair.is_partially_booked) return { label: "Частично", cls: "status-partial" };
  return { label: "Свободно", cls: "status-free" };
}

export function RenterSchedule({ refreshKey }: { refreshKey?: number }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [week, setWeek] = useState<WeekSchedule | null>(null);
  const [selectedDay, setSelectedDay] = useState<DaySchedule | null>(null);
  const [selectedChair, setSelectedChair] = useState<ChairDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await api.scheduleWeekly(isoDate(weekStart));
      setWeek(data);
      setSelectedDay((prev) => data.days.find((d) => d.date === prev?.date) ?? data.days[0] ?? null);
      setSelectedChair(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить расписание");
    } finally { setLoading(false); }
  }, [weekStart]);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function openChair(day: DaySchedule, chair: ChairDay) {
    setError(null);
    try {
      const fresh = await api.scheduleDay(day.date);
      setSelectedDay(fresh);
      setSelectedChair(fresh.chairs.find((c) => c.chair_id === chair.chair_id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  return (
    <>
      <section className="card">
        <div className="row between wrap">
          <h2>Расписание</h2>
          <div className="row gap">
            <button onClick={() => setWeekStart(addDays(weekStart, -7))}>← Неделя</button>
            <button onClick={() => setWeekStart(mondayOf(new Date()))}>Сегодня</button>
            <button onClick={() => setWeekStart(addDays(weekStart, 7))}>Неделя →</button>
          </div>
        </div>
        {error && <p className="error">{error} <button className="link" onClick={load}>Повторить</button></p>}
        {loading && !week && <p className="muted">Загрузка...</p>}
        {week && (
          <div className="week-grid">
            {week.days.map((day) => (
              <button key={day.date} className={`day-col ${selectedDay?.date === day.date ? "selected" : ""}`} onClick={() => { setSelectedDay(day); setSelectedChair(null); }}>
                <div className="day-title">{formatDateRu(day.date)}</div>
                {!day.working_hours.is_open ? <div className="muted small">Закрыто</div> :
                  day.chairs.map((chair) => {
                    const st = chairStatus(chair, false);
                    return <div key={chair.chair_id} className={`chip ${st.cls}`}>{chair.name}: {st.label}</div>;
                  })}
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedDay && !selectedChair && (
        <section className="card">
          <h2>{formatDateRu(selectedDay.date)}</h2>
          {!selectedDay.working_hours.is_open ? <p className="muted">Барбершоп закрыт.</p> : (
            <div className="list">
              {selectedDay.chairs.map((chair) => {
                const st = chairStatus(chair, false);
                return (
                  <button key={chair.chair_id} className="list-item action" onClick={() => openChair(selectedDay, chair)}>
                    <span>{chair.name}</span>
                    <span className={`chip ${st.cls}`}>{st.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {selectedDay && selectedChair && (
        <ChairPicker day={selectedDay} chair={selectedChair} onClose={() => setSelectedChair(null)} onBooked={load} />
      )}
    </>
  );
}
