// Логика выбора слотов и формат datetime (БЕЗ "Z", Europe/Minsk) сохранены без изменений.
import { useEffect, useMemo, useState } from "react";
import type { ChairDay, DaySchedule } from "../../api/types";
import { api } from "../../api/client";
import { buildHourSlots, calcHourlyPrice, formatMoney } from "./time";
import { Banner, Sheet, dayParts, errorText, haptic, todayIso } from "../../shared/ui";

function hourRange(iso: string): string {
  return iso.includes("T") ? iso.slice(11, 16) : iso.slice(0, 5);
}

function slotFree(startLocal: string, endLocal: string, free: { starts_at: string; ends_at: string }[]): boolean {
  const s = startLocal.slice(11, 16);
  const e = endLocal.slice(11, 16);
  return free.some((f) => s >= hourRange(f.starts_at) && e <= hourRange(f.ends_at));
}

interface HourGroup { start: string; end: string; hours: number; slots: string[] }

function groupHourIntervals(hours: string[]): HourGroup[] {
  if (hours.length === 0) return [];
  const sorted = [...hours].sort((a, b) => a.localeCompare(b));
  const groups: HourGroup[] = [];
  let cur: string[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const h = sorted[i];
    if (Number(h.slice(0, 2)) === Number(prev.slice(0, 2)) + 1) {
      cur.push(h);
    } else {
      groups.push({ start: cur[0], end: `${String(Number(cur[cur.length - 1].slice(0, 2)) + 1).padStart(2, "0")}:00`, hours: cur.length, slots: [...cur] });
      cur = [h];
    }
  }
  groups.push({ start: cur[0], end: `${String(Number(cur[cur.length - 1].slice(0, 2)) + 1).padStart(2, "0")}:00`, hours: cur.length, slots: [...cur] });
  return groups;
}

function subtractIntervals(free: { starts_at: string; ends_at: string }[], busy: { starts_at: string; ends_at: string }[]): { starts_at: string; ends_at: string }[] {
  let res = free.map((f) => ({ starts_at: hourRange(f.starts_at), ends_at: hourRange(f.ends_at) }));
  for (const b of busy) {
    const bs = hourRange(b.starts_at), be = hourRange(b.ends_at);
    const next: { starts_at: string; ends_at: string }[] = [];
    for (const f of res) {
      if (be <= f.starts_at || bs >= f.ends_at) { next.push(f); continue; }
      if (bs > f.starts_at) next.push({ starts_at: f.starts_at, ends_at: bs });
      if (be < f.ends_at) next.push({ starts_at: be, ends_at: f.ends_at });
    }
    res = next;
  }
  return res.filter((f) => f.starts_at < f.ends_at);
}

export function ChairPicker({
  day, chair, onClose, onBooked, onStale, editMode = false, adminMode = false, renters = [], allowPast = false,
}: {
  day: DaySchedule;
  chair: ChairDay;
  onClose: () => void;
  onBooked: () => void;
  onStale: () => void | Promise<void>;
  editMode?: boolean;
  adminMode?: boolean;
  renters?: { id: string; first_name: string | null; last_name: string | null; username: string | null }[];
  allowPast?: boolean;
}) {
  const ownedIntervals = useMemo(
    () => chair.bookings.filter((b) => b.is_mine).map((b) => ({ starts_at: b.starts_at, ends_at: b.ends_at })),
    [chair],
  );
  const globalOwnIntervals = useMemo(
    () => day.chairs.flatMap((c) => c.bookings.filter((b) => b.is_mine).map((b) => ({ starts_at: b.starts_at, ends_at: b.ends_at }))),
    [day],
  );
  const hasOwnPartial = globalOwnIntervals.length > 0;
  const effectiveFree = useMemo(() => {
    if (adminMode) return chair.free_intervals;
    if (editMode) return [...chair.free_intervals, ...ownedIntervals];
    if (!hasOwnPartial) return chair.free_intervals;
    return subtractIntervals(chair.free_intervals, globalOwnIntervals);
  }, [chair.free_intervals, ownedIntervals, globalOwnIntervals, hasOwnPartial, editMode, adminMode]);

  const [mode, setMode] = useState<"full_day" | "hourly">(adminMode ? (chair.is_free_whole_day ? "full_day" : "hourly") : (hasOwnPartial ? "hourly" : chair.is_free_whole_day ? "full_day" : "hourly"));
  const [selectedHours, setSelectedHours] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminRenterOpen, setAdminRenterOpen] = useState(false);
  const [adminRenterId, setAdminRenterId] = useState("");
  const [adminRenterName, setAdminRenterName] = useState("");
  const [adminBookingBusy, setAdminBookingBusy] = useState(false);

  useEffect(() => {
    if (editMode) {
      const ownedSlots: string[] = [];
      for (const b of chair.bookings.filter((x) => x.is_mine)) {
        const startH = Number(b.starts_at.slice(11, 13));
        const endH = Number(b.ends_at.slice(11, 13));
        for (let h = startH; h < endH; h++) ownedSlots.push(`${String(h).padStart(2, "0")}:00`);
      }
      setSelectedHours(ownedSlots);
    } else {
      setSelectedHours([]);
    }
  }, [chair, editMode]);

  const wh = day.working_hours;
  const slots = buildHourSlots(wh.open_time, wh.close_time);
  const selectedSet = new Set(selectedHours);

  function toggleHour(slot: string) {
    haptic();
    setError(null);
    const start = `${day.date}T${slot}:00`;
    const h = Number(slot.slice(0, 2));
    const end = `${day.date}T${String(h + 1).padStart(2, "0")}:00`;
    if (!slotFree(start, end, effectiveFree)) return;
    setSelectedHours((prev) => (prev.includes(slot) ? prev.filter((x) => x !== slot) : [...prev, slot]));
  }

  const isPast = day.date < todayIso();
  const hasOwnBooking = day.chairs.some((c) => c.bookings.some((b) => b.is_mine));
  const canFullDay = !!chair.is_free_whole_day && !hasOwnBooking;
  const allFree = selectedHours.length > 0 && selectedHours.every((slot) => {
    const start = `${day.date}T${slot}:00`;
    const h = Number(slot.slice(0, 2));
    const end = `${day.date}T${String(h + 1).padStart(2, "0")}:00`;
    return slotFree(start, end, effectiveFree);
  });
  const originalSlots = useMemo(() => {
    if (!editMode) return [];
    const slots: string[] = [];
    for (const b of chair.bookings.filter((x) => x.is_mine)) {
      const startH = Number(b.starts_at.slice(11, 13));
      const endH = Number(b.ends_at.slice(11, 13));
      for (let h = startH; h < endH; h++) slots.push(`${String(h).padStart(2, "0")}:00`);
    }
    return slots;
  }, [chair, editMode]);
  const hasChanges = !editMode || mode !== "hourly" || selectedHours.length !== originalSlots.length || selectedHours.some((s) => !originalSlots.includes(s));
  const groups = useMemo(() => groupHourIntervals(selectedHours), [selectedHours]);
  // Existing active hourly bookings by this renter on this chair/day, so the
  // "first hour" is charged only once per day (mirrors the server-side calc).
  const ownedHourly = useMemo(() => {
    let hours = 0;
    let price = 0;
    for (const b of chair.bookings) {
      if (b.is_mine && b.status === "active" && b.booking_type === "hourly") {
        hours += b.duration_hours;
        price += b.price_amount ?? 0;
      }
    }
    return { hours, price };
  }, [chair.bookings]);
  const newHours = selectedHours.length;
  const price = mode === "full_day" ? 6000 : Math.max(0, calcHourlyPrice(ownedHourly.hours + newHours) - ownedHourly.price);
  const canSubmit = (allowPast || !isPast) && !busy && (mode === "hourly" ? (allFree || selectedHours.length === 0) && hasChanges : canFullDay) && (!editMode || hasChanges);

  async function submit() {
    if (isPast) { setError("Нельзя записаться на прошедший день"); return; }
    const oldIds = editMode ? chair.bookings.filter((b) => b.is_mine).map((b) => b.id) : [];
    const oldSlots = editMode ? ownedIntervals.map((i) => i.starts_at.slice(11, 16)) : [];
    setBusy(true); setError(null);
    try {
      if (editMode && oldIds.length) {
        await Promise.all(oldIds.map((id) => api.cancelBooking(id)));
      }
      if (mode === "full_day") {
        if (!wh.open_time || !wh.close_time) throw new Error("Барбершоп закрыт в этот день");
        await api.createBooking({
          chair_id: chair.chair_id,
          starts_at: `${day.date}T${wh.open_time.slice(0, 5)}:00`,
          ends_at: `${day.date}T${wh.close_time.slice(0, 5)}:00`,
          booking_type: "full_day",
        });
        haptic("success");
        onBooked();
      } else {
        if (editMode ? (selectedHours.length > 0 && !allFree) : (!selectedHours.length || !allFree)) throw new Error("Выберите свободные часы");
        const items = groups.map((g) => ({
          chair_id: chair.chair_id,
          starts_at: `${day.date}T${g.start}`,
          ends_at: `${day.date}T${g.end}`,
          booking_type: "hourly" as const,
        }));
        if (items.length) {
          const res = await api.createBookingsBulk(items);
          if (res.created_count === 0) throw new Error(res.results[0]?.error || "Не удалось создать бронирования");
        }
        haptic("success");
        onBooked();
      }
    } catch (e) {
      if (editMode && oldSlots.length) {
        try {
          const restoreItems = groupHourIntervals(oldSlots).map((g) => ({
            chair_id: chair.chair_id,
            starts_at: `${day.date}T${g.start}`,
            ends_at: `${day.date}T${g.end}`,
            booking_type: "hourly" as const,
          }));
          await api.createBookingsBulk(restoreItems);
        } catch { /* ignore restore errors */ }
      }
      haptic("error");
      setError(`${errorText(e, "Не удалось создать бронирование")} Расписание обновлено.`);
      await onStale();
    } finally {
      setBusy(false);
    }
  }

  const footer = wh.is_open ? (
    <>
      {isPast && <Banner kind="info">Запись на прошедший день недоступна.</Banner>}
      {error && <Banner kind="bad">{error}</Banner>}
      <div className="price-line">
        <span className="muted">
          {mode === "full_day" ? "Весь день" : selectedHours.length ? `${groups.map((g) => `${g.start.slice(0, 5)}-${g.end}`).join(", ")} · ${selectedHours.length} ч` : "Выберите часы"}
        </span>
        <b>{price ? formatMoney(price) : "—"}</b>
      </div>
      <button className="btn btn-primary btn-block" disabled={!canSubmit} onClick={() => { if (adminMode) setAdminRenterOpen(true); else submit(); }}>
        {busy ? "Создание..." : adminMode ? "Выбрать арендатора" : "Подтвердить бронирование"}
      </button>
    </>
  ) : undefined;

  async function adminCreateBooking() {
    if (!adminMode) return;
    if (!adminRenterId && !adminRenterName.trim()) {
      setError("Выберите или введите арендатора");
      return;
    }
    setAdminBookingBusy(true); setError(null);
    try {
      const renterPayload = adminRenterId ? { renter_id: adminRenterId } : { renter_name: adminRenterName.trim() };
      if (mode === "full_day") {
        await api.adminCreateBooking({
          chair_id: chair.chair_id,
          starts_at: `${day.date}T${wh.open_time!.slice(0, 5)}:00`,
          ends_at: `${day.date}T${wh.close_time!.slice(0, 5)}:00`,
          booking_type: "full_day",
          ...renterPayload,
        });
      } else {
        if (!selectedHours.length || !allFree) throw new Error("Выберите свободные часы");
        const items = groups.map((g) => ({
          chair_id: chair.chair_id,
          starts_at: `${day.date}T${g.start}`,
          ends_at: `${day.date}T${g.end}`,
          booking_type: "hourly" as const,
        }));
        await api.adminCreateBookingsBulk({ items, ...renterPayload });
      }
      haptic("success");
      setAdminRenterOpen(false);
      onBooked();
    } catch (e) {
      haptic("error");
      setError(errorText(e, "Не удалось создать бронирование"));
      await onStale();
    } finally {
      setAdminBookingBusy(false);
      setAdminRenterOpen(false);
    }
  }

  return (
    <>
      <Sheet title={`${chair.name} · ${dayParts(day.date).long}`} onClose={onClose} footer={footer}>
        {!wh.is_open ? (
          <p className="muted">Барбершоп закрыт.</p>
        ) : (
          <>
            <div className="segmented">
              <button className={mode === "full_day" ? "active" : ""} disabled={!canFullDay} onClick={() => setMode("full_day")}>Весь день</button>
              <button className={mode === "hourly" ? "active" : ""} disabled={chair.is_fully_booked} onClick={() => setMode("hourly")}>По часам</button>
            </div>
            {hasOwnBooking && !canFullDay && <p className="muted small">В этот день у вас уже есть запись — бронирование на весь день недоступно.</p>}

            {mode === "full_day" && (
              <div className="stack">
                <p>Весь рабочий день: <b>{hourRange(wh.open_time!)}–{hourRange(wh.close_time!)}</b></p>
                <p className="muted small">Кресло будет полностью закреплено за вами на этот день.</p>
              </div>
            )}

            {mode === "hourly" && (
              <div className="stack">
                <p className="muted small">Выберите часы (можно не подряд). Каждый час — отдельная запись.</p>
                <div className="slots">
                  {slots.map((slot) => {
                    const start = `${day.date}T${slot}:00`;
                    const h = Number(slot.slice(0, 2));
                    const end = `${day.date}T${String(h + 1).padStart(2, "0")}:00`;
                    const free = slotFree(start, end, effectiveFree);
                    const selected = selectedSet.has(slot);
                    return (
                      <button key={slot} className={`slot ${free ? "" : "busy"} ${selected ? "selected" : ""}`} disabled={!free} onClick={() => toggleHour(slot)}>
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
                {selectedHours.length > 0 && !allFree && <Banner kind="bad">Оставьте только свободные часы.</Banner>}
                <p className="muted small">Тариф: первый час 10 BYN, каждый следующий +5 BYN (внутри одного дня)</p>
              </div>
            )}
          </>
        )}
      </Sheet>
      {adminMode && adminRenterOpen && (
        <Sheet title="Арендатор" onClose={() => setAdminRenterOpen(false)}>
          {error && <Banner kind="bad">{error}</Banner>}
          <div className="stack">
            <label className="muted small">Существующий арендатор</label>
            <select className="input" value={adminRenterId} onChange={(e) => { setAdminRenterId(e.target.value); if (e.target.value) setAdminRenterName(""); }}>
              <option value="">— выбрать —</option>
              {renters.map((r) => (
                <option key={r.id} value={r.id}>{[r.first_name, r.last_name].filter(Boolean).join(" ") || r.username || r.id}</option>
              ))}
            </select>
            <label className="muted small">Или новое имя</label>
            <input className="input" value={adminRenterName} onChange={(e) => { setAdminRenterName(e.target.value); if (e.target.value) setAdminRenterId(""); }} placeholder="Имя арендатора" />
            <button className="btn btn-primary btn-block" disabled={adminBookingBusy || (!adminRenterId && !adminRenterName.trim())} onClick={adminCreateBooking}>
              {adminBookingBusy ? "Создание..." : "Забронировать"}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
