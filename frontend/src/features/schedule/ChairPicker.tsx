import { useState } from "react";
import type { ChairDay, DaySchedule } from "../../api/types";
import { api } from "../../api/client";
import { buildHourSlots, calcHourlyPrice, formatMoney, isSlotInFree } from "./time";

function hourRange(iso: string): string {
  return iso.includes("T") ? iso.slice(11, 16) : iso.slice(0, 5);
}

export function ChairPicker({
  day,
  chair,
  onClose,
  onBooked,
}: {
  day: DaySchedule;
  chair: ChairDay;
  onClose: () => void;
  onBooked: () => void;
}) {
  const [mode, setMode] = useState<"full_day" | "hourly">(chair.is_free_whole_day ? "full_day" : "hourly");
  const [startHour, setStartHour] = useState<string | null>(null);
  const [endHour, setEndHour] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const wh = day.working_hours;
  const slots = buildHourSlots(wh.open_time, wh.close_time);

  function selectHour(slot: string) {
    setError(null);
    if (!startHour || (startHour && endHour)) {
      setStartHour(slot);
      setEndHour(null);
      return;
    }
    const [sh] = startHour.split(":").map(Number);
    const [h] = slot.split(":").map(Number);
    if (h < sh) {
      setStartHour(slot);
      setEndHour(null);
      return;
    }
    setEndHour(`${String(h + 1).padStart(2, "0")}:00`);
  }

  const hourlyHours =
    startHour && endHour ? Math.max(0, Number(endHour.slice(0, 2)) - Number(startHour.slice(0, 2))) : 0;
  const hourlyStart = startHour ? `${day.date}T${startHour}:00Z` : null;
  const hourlyEnd = endHour ? `${day.date}T${endHour}:00Z` : null;
  const hourlyValid =
    !!hourlyStart &&
    !!hourlyEnd &&
    hourlyHours >= 1 &&
    isSlotInFree(hourlyStart, hourlyEnd, chair.free_intervals);

  async function submit() {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      if (mode === "full_day") {
        if (!wh.open_time || !wh.close_time) throw new Error("Барбершоп закрыт в этот день");
        await api.createBooking({
          chair_id: chair.chair_id,
          starts_at: `${day.date}T${wh.open_time.slice(0, 5)}:00Z`,
          ends_at: `${day.date}T${wh.close_time.slice(0, 5)}:00Z`,
          booking_type: "full_day",
        });
      } else {
        if (!hourlyValid || !hourlyStart || !hourlyEnd) throw new Error("Выберите свободный непрерывный интервал");
        await api.createBooking({
          chair_id: chair.chair_id,
          starts_at: hourlyStart,
          ends_at: hourlyEnd,
          booking_type: "hourly",
        });
      }
      setOk("Бронирование создано.");
      onBooked();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось создать бронирование";
      setError(msg.includes("409") || msg.includes("conflict") ? `Конфликт: ${msg}. Обновите расписание.` : msg);
      onBooked();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="row between">
        <h2>{chair.name} · {day.date}</h2>
        <button className="link" onClick={onClose}>Закрыть</button>
      </div>
      {!wh.is_open && <p className="muted">Барбершоп закрыт.</p>}
      {wh.is_open && (
        <>
          <div className="segmented">
            <button className={mode === "full_day" ? "active" : ""} disabled={!chair.is_free_whole_day} onClick={() => setMode("full_day")}>Весь день</button>
            <button className={mode === "hourly" ? "active" : ""} disabled={chair.is_fully_booked} onClick={() => setMode("hourly")}>По часам</button>
          </div>

          {mode === "full_day" && (
            <p>Весь рабочий день ({hourRange(wh.open_time!)}–{hourRange(wh.close_time!)}). Стоимость: <strong>{formatMoney(6000)}</strong></p>
          )}

          {mode === "hourly" && (
            <>
              <div className="slots">
                {slots.map((slot) => {
                  const start = `${day.date}T${slot}:00Z`;
                  const h = Number(slot.slice(0, 2));
                  const end = `${day.date}T${String(h + 1).padStart(2, "0")}:00Z`;
                  const free = isSlotInFree(start, end, chair.free_intervals);
                  const selected = startHour && ((endHour && slot >= startHour && slot < endHour) || (!endHour && slot === startHour));
                  return (
                    <button key={slot} className={`slot ${free ? "free" : "busy"} ${selected ? "selected" : ""}`} disabled={!free} onClick={() => selectHour(slot)}>
                      {slot}
                    </button>
                  );
                })}
              </div>
              <p className="muted">Свободные интервалы: {chair.free_intervals.map((f) => `${hourRange(f.starts_at)}–${hourRange(f.ends_at)}`).join(", ") || "нет"}</p>
              <p>
                Выбрано: <strong>{startHour && endHour ? `${startHour}–${endHour} (${hourlyHours} ч)` : "—"}</strong>
                {hourlyHours > 0 && <> · Стоимость: <strong>{formatMoney(calcHourlyPrice(hourlyHours))}</strong></>}
              </p>
              {startHour && endHour && !hourlyValid && <p className="error">Интервал должен быть непрерывным и свободным.</p>}
            </>
          )}

          {error && <p className="error">{error}</p>}
          {ok && <p className="ok">{ok}</p>}
          <button className="primary" disabled={busy || (mode === "hourly" ? !hourlyValid : !chair.is_free_whole_day)} onClick={submit}>
            {busy ? "Создание..." : "Подтвердить бронирование"}
          </button>
        </>
      )}
    </section>
  );
}
