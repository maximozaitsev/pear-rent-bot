// Логика выбора слотов и формат datetime (БЕЗ "Z", Europe/Minsk) сохранены без изменений.
import { useEffect, useState } from "react";
import type { ChairDay, DaySchedule } from "../../api/types";
import { api } from "../../api/client";
import { buildHourSlots, calcHourlyPrice, formatMoney } from "./time";
import { Banner, Sheet, dayParts, errorText, haptic } from "../../shared/ui";

function hourRange(iso: string): string {
  return iso.includes("T") ? iso.slice(11, 16) : iso.slice(0, 5);
}

function slotCovers(startLocal: string, endLocal: string, free: { starts_at: string; ends_at: string }[]): boolean {
  const s = startLocal.slice(11, 16);
  const e = endLocal.slice(11, 16);
  return free.some((f) => s >= hourRange(f.starts_at) && e <= hourRange(f.ends_at));
}

export function ChairPicker({
  day, chair, onClose, onBooked, onStale,
}: {
  day: DaySchedule;
  chair: ChairDay;
  onClose: () => void;
  onBooked: () => void;
  onStale: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<"full_day" | "hourly">(chair.is_free_whole_day ? "full_day" : "hourly");
  const [startHour, setStartHour] = useState<string | null>(null);
  const [endHour, setEndHour] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // расписание обновилось (например, после конфликта) — сбрасываем выбор
  useEffect(() => { setStartHour(null); setEndHour(null); }, [chair]);

  const wh = day.working_hours;
  const slots = buildHourSlots(wh.open_time, wh.close_time);

  function selectHour(slot: string) {
    haptic();
    setError(null);
    if (!startHour || (startHour && endHour)) { setStartHour(slot); setEndHour(null); return; }
    const [sh] = startHour.split(":").map(Number);
    const [h] = slot.split(":").map(Number);
    if (h < sh) { setStartHour(slot); setEndHour(null); return; }
    setEndHour(`${String(h + 1).padStart(2, "0")}:00`);
  }

  const hourlyHours = startHour && endHour ? Math.max(0, Number(endHour.slice(0, 2)) - Number(startHour.slice(0, 2))) : 0;
  const hourlyStart = startHour ? `${day.date}T${startHour}:00` : null;
  const hourlyEnd = endHour ? `${day.date}T${endHour}:00` : null;
  const hourlyValid = !!hourlyStart && !!hourlyEnd && hourlyHours >= 1 && slotCovers(hourlyStart, hourlyEnd, chair.free_intervals);

  const price = mode === "full_day" ? 6000 : hourlyHours > 0 ? calcHourlyPrice(hourlyHours) : 0;
  const canSubmit = !busy && (mode === "hourly" ? hourlyValid : chair.is_free_whole_day);

  async function submit() {
    setBusy(true); setError(null);
    try {
      if (mode === "full_day") {
        if (!wh.open_time || !wh.close_time) throw new Error("Барбершоп закрыт в этот день");
        await api.createBooking({
          chair_id: chair.chair_id,
          starts_at: `${day.date}T${wh.open_time.slice(0, 5)}:00`,
          ends_at: `${day.date}T${wh.close_time.slice(0, 5)}:00`,
          booking_type: "full_day",
        });
      } else {
        if (!hourlyValid || !hourlyStart || !hourlyEnd) throw new Error("Выберите свободный непрерывный интервал");
        await api.createBooking({ chair_id: chair.chair_id, starts_at: hourlyStart, ends_at: hourlyEnd, booking_type: "hourly" });
      }
      haptic("success");
      onBooked();
    } catch (e) {
      haptic("error");
      setError(`${errorText(e, "Не удалось создать бронирование")} Расписание обновлено.`);
      await onStale();
    } finally {
      setBusy(false);
    }
  }

  const footer = wh.is_open ? (
    <>
      {error && <Banner kind="bad">{error}</Banner>}
      <div className="price-line">
        <span className="muted">
          {mode === "full_day" ? "Весь день" : startHour && endHour ? `${startHour}–${endHour} · ${hourlyHours} ч` : startHour ? "Выберите последний час" : "Выберите время"}
        </span>
        <b>{price ? formatMoney(price) : "—"}</b>
      </div>
      <button className="btn btn-primary btn-block" disabled={!canSubmit} onClick={submit}>
        {busy ? "Создание..." : "Подтвердить бронирование"}
      </button>
    </>
  ) : undefined;

  return (
    <Sheet title={`${chair.name} · ${dayParts(day.date).long}`} onClose={onClose} footer={footer}>
      {!wh.is_open ? (
        <p className="muted">Барбершоп закрыт.</p>
      ) : (
        <>
          <div className="segmented">
            <button className={mode === "full_day" ? "active" : ""} disabled={!chair.is_free_whole_day} onClick={() => setMode("full_day")}>Весь день</button>
            <button className={mode === "hourly" ? "active" : ""} disabled={chair.is_fully_booked} onClick={() => setMode("hourly")}>По часам</button>
          </div>

          {mode === "full_day" && (
            <div className="stack">
              <p>Весь рабочий день: <b>{hourRange(wh.open_time!)}–{hourRange(wh.close_time!)}</b></p>
              <p className="muted small">Кресло будет полностью закреплено за вами на этот день.</p>
            </div>
          )}

          {mode === "hourly" && (
            <div className="stack">
              <p className="muted small">Нажмите на первый час, затем на последний — выберется интервал.</p>
              <div className="slots">
                {slots.map((slot) => {
                  const start = `${day.date}T${slot}:00`;
                  const h = Number(slot.slice(0, 2));
                  const end = `${day.date}T${String(h + 1).padStart(2, "0")}:00`;
                  const free = slotCovers(start, end, chair.free_intervals);
                  const selected = startHour && ((endHour && slot >= startHour && slot < endHour) || (!endHour && slot === startHour));
                  return (
                    <button key={slot} className={`slot ${free ? "" : "busy"} ${selected ? "selected" : ""}`} disabled={!free} onClick={() => selectHour(slot)}>
                      {slot}
                    </button>
                  );
                })}
              </div>
              <div className="legend">
                <span><i style={{ background: "color-mix(in srgb, var(--ok) 35%, transparent)" }} />свободно</span>
                <span><i style={{ background: "var(--soft)" }} />занято</span>
                <span><i style={{ background: "var(--accent)" }} />выбрано</span>
              </div>
              {startHour && endHour && !hourlyValid && <Banner kind="bad">Интервал должен быть непрерывным и свободным.</Banner>}
              <p className="muted small">Тариф: 1-й час 10 BYN, каждый следующий +5 BYN. Итог подтверждает сервер.</p>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
