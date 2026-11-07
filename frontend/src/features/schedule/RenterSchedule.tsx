import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import type { ChairDay, DayBooking, DaySchedule } from "../../api/types";
import { addDays, firstOfMonth, formatMoney, formatTime, monthGridWeeks, type PeriodMode } from "./time";
import { ChairPicker } from "./ChairPicker";
import { Banner, DayStrip, Empty, Icon, MonthGrid, Sheet, WeekNav, dayParts, errorText, haptic, todayIso } from "../../shared/ui";

function todayStart(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
}

function chairStatus(chair: ChairDay): { label: string; tone: "ok" | "warn" | "bad" } {
  if (chair.is_fully_booked) return { label: "Занято", tone: "bad" };
  if (chair.is_partially_booked) return { label: "Частично", tone: "warn" };
  return { label: "Свободно", tone: "ok" };
}

type PickedDay = { date: string; chairId: string; chairName: string; isAlt: boolean };

const FULL_DAY_PRICE = 6000;

export function RenterSchedule({ refreshKey, defaultMode }: { refreshKey?: number; defaultMode?: PeriodMode }) {
  const [mode, setMode] = useState<PeriodMode>(defaultMode ?? "week");
  const [weekStart, setWeekStart] = useState(() => todayStart());
  const [monthAnchor, setMonthAnchor] = useState(() => firstOfMonth(new Date()));
  const [weekDays, setWeekDays] = useState<DaySchedule[]>([]);
  const [monthDays, setMonthDays] = useState<Record<string, DaySchedule>>({});
  const [selectedDate, setSelectedDate] = useState("");
  const [picker, setPicker] = useState<{ day: DaySchedule; chair: ChairDay } | null>(null);
  const [mineSheet, setMineSheet] = useState<{ day: DaySchedule; chair: ChairDay; bookings: DayBooking[] } | null>(null);
  const [pickerEditMode, setPickerEditMode] = useState(false);
  const [cancelBusy, setCancelBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [targetChairId, setTargetChairId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Map<string, PickedDay>>(new Map());
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingReport, setBookingReport] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (mode === "week") {
        const from = weekStart.toISOString().slice(0, 10);
        const to = addDays(weekStart, 6).toISOString().slice(0, 10);
        const data = await api.scheduleAvailability(from, to);
        setWeekDays(data.days);
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

  async function openChair(day: DaySchedule, chairId: string, mineBookings?: DayBooking[]) {
    setError(null);
    try {
      const fresh = await api.scheduleDay(day.date);
      const chair = fresh.chairs.find((c) => c.chair_id === chairId);
      if (!chair) return;
      const mine = mineBookings ?? chair.bookings.filter((b) => b.is_mine);
      const hasFullDay = mine.some((b) => b.booking_type === "full_day");
      if (hasFullDay) {
        setMineSheet({ day: fresh, chair, bookings: mine });
        setPicker(null);
        setPickerEditMode(false);
      } else if (mine.length > 0) {
        setMineSheet(null);
        setPickerEditMode(true);
        setPicker({ day: fresh, chair });
      } else {
        setMineSheet(null);
        setPickerEditMode(false);
        setPicker({ day: fresh, chair });
      }
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function cancelMineDay(date: string) {
    if (!confirm("Отменить все часы этого дня?")) return;
    setCancelBusy(date); setError(null);
    try {
      const day = daysByDate[date];
      if (!day) return;
      const ids = day.chairs.flatMap((c) => c.bookings.filter((b) => b.is_mine).map((b) => b.id));
      await Promise.all(ids.map((id) => api.cancelBooking(id)));
      haptic("success");
      setMineSheet(null);
      await load();
    } catch (e) {
      haptic("error");
      setError(errorText(e, "Не удалось отменить"));
    } finally { setCancelBusy(null); }
  }

  const selectedDay = mode === "week" ? (weekDays.find((d) => d.date === selectedDate) ?? null) : (monthDays[selectedDate] ?? null);
  const daysByDate = useMemo(() => {
    if (mode === "week") {
      const m: Record<string, DaySchedule> = {};
      for (const d of weekDays) m[d.date] = d;
      return m;
    }
    return monthDays;
  }, [mode, weekDays, monthDays]);
  const allChairs = useMemo(() => {
    const first = Object.values(daysByDate)[0];
    return first?.chairs.map((c) => ({ id: c.chair_id, name: c.name })) ?? [];
  }, [daysByDate]);
  const targetChair = allChairs.find((c) => c.id === targetChairId) ?? null;

  const today = todayIso();
  const pickedDates = useMemo(() => new Set(picked.keys()), [picked]);
  const pickedChairByDate = useMemo(() => {
    const m = new Map<string, string>();
    for (const [date, item] of picked) m.set(date, item.chairId);
    return m;
  }, [picked]);

  function resolvePick(d: DaySchedule): PickedDay | null {
    if (d.date < today || !d.working_hours.is_open) return null;
    if (myBookedDates.has(d.date)) return null;
    if (targetChairId) {
      const target = d.chairs.find((c) => c.chair_id === targetChairId);
      if ((target?.can_book_full_day ?? target?.is_free_whole_day) && targetChair) return { date: d.date, chairId: targetChairId, chairName: targetChair.name, isAlt: false };
      const alt = d.chairs.find((c) => c.chair_id !== targetChairId && (c.can_book_full_day ?? c.is_free_whole_day));
      if (alt) return { date: d.date, chairId: alt.chair_id, chairName: alt.name, isAlt: true };
      return null;
    }
    const any = d.chairs.find((c) => c.can_book_full_day ?? c.is_free_whole_day);
    return any ? { date: d.date, chairId: any.chair_id, chairName: any.name, isAlt: false } : null;
  }

  function isDayBookable(d: DaySchedule): boolean {
    return !!resolvePick(d);
  }

  function canPickDate(d: DaySchedule): boolean {
    return isDayBookable(d);
  }

  function toggleSelectMode() {
    setSelectMode((v) => {
      const next = !v;
      if (next) {
        setTargetChairId((id) => id ?? allChairs[0]?.id ?? null);
        setPicked(new Map()); setBookingReport(null); setError(null);
        setSelectedDate("");
      } else {
        setPicked(new Map()); setBookingReport(null);
        setSelectedDate(todayIso());
      }
      return next;
    });
  }

  function onDayPick(d: DaySchedule) {
    if (selectMode) {
      const resolved = resolvePick(d);
      if (!resolved) return;
      haptic();
      setError(null); setBookingReport(null);
      setPicked((prev) => {
        const next = new Map(prev);
        if (next.has(d.date)) next.delete(d.date); else next.set(d.date, resolved);
        return next;
      });
      return;
    }
    setSelectedDate(d.date);
  }

  async function submitPicked() {
    if (picked.size === 0) return;
    setBookingBusy(true); setError(null); setBookingReport(null);
    const items = Array.from(picked.values()).sort((a, b) => a.date.localeCompare(b.date));
    try {
      const payload = items.map((item) => {
        const day = daysByDate[item.date];
        const wh = day?.working_hours;
        if (!day || !wh?.is_open || !wh.open_time || !wh.close_time) return null;
        return {
          chair_id: item.chairId,
          starts_at: `${item.date}T${wh.open_time.slice(0, 5)}:00`,
          ends_at: `${item.date}T${wh.close_time.slice(0, 5)}:00`,
          booking_type: "full_day" as const,
          _date: item.date,
          _chairName: item.chairName,
          _isAlt: item.isAlt,
        };
      });
      const valid = payload.filter((p): p is NonNullable<typeof p> => !!p);
      if (valid.length === 0) {
        setError("Нет валидных дней для бронирования.");
        return;
      }
      const res = await api.createBookingsBulk(valid.map(({ chair_id, starts_at, ends_at, booking_type }) => ({ chair_id, starts_at, ends_at, booking_type })));
      await load();
      const okDates = new Set(res.results.filter((r) => r.ok).map((r) => r.date));
      const failedDates = new Set(res.results.filter((r) => !r.ok).map((r) => r.date));
      setPicked(new Map(Array.from(picked.entries()).filter(([d]) => failedDates.has(d))));
      if (res.created_count) {
        haptic(res.failed_count === 0 ? "success" : "light");
        const okItems = valid.filter((v) => okDates.has(v._date));
        const byChair = okItems.reduce<Record<string, number>>((m, i) => ({ ...m, [i._chairName]: (m[i._chairName] ?? 0) + 1 }), {});
        const summary = Object.entries(byChair).map(([n, c]) => `${n}: ${c}`).join(", ");
        setBookingReport(`Забронировано: ${res.created_count} дн. · ${formatMoney(res.total_amount)}${summary ? ` (${summary})` : ""}.${res.failed_count ? ` Не удалось: ${res.failed_count}.` : ""}`);
      } else {
        haptic("error");
        setError(res.results[0]?.error ? `Не удалось создать бронирования: ${res.results[0].error}` : "Не удалось создать бронирования. Расписание обновлено.");
      }
    } catch (e) {
      haptic("error");
      setError(errorText(e, "Не удалось создать бронирования"));
    } finally { setBookingBusy(false); }
  }

  const pickedItems = Array.from(picked.values()).sort((a, b) => a.date.localeCompare(b.date));
  const altItems = pickedItems.filter((i) => i.isAlt);
  const pickedCount = pickedItems.length;
  const myBookedDates = useMemo(() => {
    const s = new Set<string>();
    for (const d of Object.values(daysByDate)) if (d.chairs.some((c) => c.bookings.some((b) => b.is_mine))) s.add(d.date);
    return s;
  }, [daysByDate]);

  return (
    <>
      <WeekNav
        weekStart={mode === "month" ? monthAnchor : weekStart}
        mode={mode}
        onModeChange={(m) => {
          setMode(m);
          setPicked(new Map()); setBookingReport(null);
          if (m === "week") setWeekStart(todayStart());
          else setMonthAnchor(firstOfMonth(new Date(selectedDate ? selectedDate + "T00:00:00Z" : Date.now())));
        }}
        onChange={(d) => { if (mode === "month") setMonthAnchor(firstOfMonth(d)); else setWeekStart(d); }}
        actionLabel="Выбрать"
        actionActive={selectMode}
        onAction={toggleSelectMode}
      />
      {error && <Banner kind="bad" onRetry={load}>{error}</Banner>}
      {bookingReport && <Banner kind="ok">{bookingReport}</Banner>}
      {loading && ((mode === "week" && !weekDays.length) || (mode === "month" && Object.keys(monthDays).length === 0)) && (
        <div className="stack" aria-hidden="true">
          <div className="skeleton" style={{ height: mode === "week" ? 74 : 260 }} />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}

      {mode === "week" && !!weekDays.length && (
        <DayStrip
          days={weekDays}
          selected={selectedDate}
          onSelect={selectMode ? onDayPick : (d) => setSelectedDate(d.date)}
          pickedDates={selectMode ? pickedDates : undefined}
          canPickDate={selectMode ? canPickDate : undefined}
          dotVariant="renter"
          pickedChairByDate={selectMode ? pickedChairByDate : undefined}
          renterOwn={selectMode ? undefined : (d) => d.chairs.some((c) => c.bookings.some((b) => b.is_mine))}
          renterOwnDates={selectMode ? myBookedDates : undefined}
        />
      )}
      {mode === "month" && (
        <MonthGrid
          month={monthAnchor}
          daysByDate={monthDays}
          selected={selectedDate}
          onSelect={selectMode ? onDayPick : (d) => setSelectedDate(d.date)}
          loading={loading}
          pickedDates={selectMode ? pickedDates : undefined}
          canPickDate={selectMode ? canPickDate : undefined}
          dotVariant="renter"
          pickedChairByDate={selectMode ? pickedChairByDate : undefined}
          renterOwn={selectMode ? undefined : (d) => d.chairs.some((c) => c.bookings.some((b) => b.is_mine))}
          renterOwnDates={selectMode ? myBookedDates : undefined}
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
                onClick={() => { haptic(); setTargetChairId(c.id); setPicked(new Map()); setBookingReport(null); setError(null); }}
              >{c.name}</button>
            ))}
          </div>
          {!targetChairId && <p className="muted small">Сначала выберите кресло.</p>}
          {targetChairId && <p className="muted small">Отмечайте дни для «{targetChair?.name}». Если в день свободно только другое кресло, день можно выбрать — в отчёте будет пометка.</p>}
          {!!altItems.length && (() => {
            const months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
            const byKey = altItems.reduce<Record<string, { dates: number[]; chair: string; month: string }>>((m, i) => {
              const d = new Date(i.date + "T00:00:00Z");
              const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${i.chairName}`;
              (m[key] ??= { dates: [], chair: i.chairName, month: months[d.getUTCMonth()] }).dates.push(d.getUTCDate());
              return m;
            }, {});
            return (
              <div className="banner warn stack" style={{ display: "grid", alignItems: "flex-start", gap: 4 }}>
                {Object.values(byKey).map((g) => (
                  <div key={g.month + g.chair} style={{ display: "grid", gap: 1 }}>
                    <div>{g.dates.sort((a, b) => a - b).join(", ")} {g.month} доступно только {g.chair}.</div>
                    <div className="muted small">Нужно именно {targetChair?.name}? Выберите другой день.</div>
                  </div>
                ))}
              </div>
            );
          })()}
          <div className="price-line">
            <span className="muted">
              Забронировано: <b>{pickedCount}</b> дн.
              {targetChair && <><br />{targetChair.name}{altItems.length ? " (часть дат — другое кресло)" : ""}</>}
            </span>
            <b>{pickedCount ? formatMoney(pickedCount * FULL_DAY_PRICE) : "—"}</b>
          </div>
          <button className="btn btn-primary btn-block" disabled={pickedCount === 0 || bookingBusy} onClick={submitPicked}>
            {bookingBusy ? "Бронирование..." : "Забронировать выбранные дни"}
          </button>
          <p className="muted small">Тариф полного дня: {formatMoney(FULL_DAY_PRICE)}.</p>
        </section>
      )}

      {selectedDay && !selectMode && (
        <>
          <div className="section-label">{dayParts(selectedDay.date).long}</div>
          {!selectedDay.working_hours.is_open ? (
            <Empty icon="🔒">Барбершоп в этот день закрыт</Empty>
          ) : selectedDay.date < today ? (
            <Empty icon="📅">Запись на прошедшие дни недоступна</Empty>
          ) : !selectedDay.chairs.length ? (
            <Empty icon="💺">Нет доступных кресел</Empty>
          ) : (
            <ul className="list">
              {(() => {
                const ownChair = selectedDay.chairs.find((c) => c.bookings.some((b) => b.is_mine));
                const ownFullDay = !!ownChair?.bookings.some((b) => b.is_mine && b.booking_type === "full_day");
                return selectedDay.chairs.map((chair) => {
                  const mine = chair.bookings.filter((b) => b.is_mine);
                  const isMine = mine.length > 0;
                  const blockedByOwn = !!ownChair && !isMine;
                  const st = isMine ? { label: "Моё", tone: (mine.some((b) => b.booking_type === "full_day") || chair.is_fully_booked) ? "ok" as const : "warn" as const } : chairStatus(chair);
                  const free = chair.free_intervals.map((f) => `${formatTime(f.starts_at)}–${formatTime(f.ends_at)}`).join(", ");
                  const disabled = isMine ? false : chair.is_fully_booked || (blockedByOwn && (ownFullDay || chair.is_fully_booked));
                  return (
                    <li key={chair.chair_id}>
                      <button className="item" disabled={disabled} onClick={() => { haptic(); openChair(selectedDay, chair.chair_id, mine); }}>
                        <div className="grow">
                          <div className="title">{chair.name}{blockedByOwn && ownChair ? <span className="muted small"> (Уже есть бронь {ownChair.name})</span> : ""}</div>
                          <div className="meta">{isMine ? `Забронировано: ${mine.map((b) => `${formatTime(b.starts_at)}–${formatTime(b.ends_at)}`).join(", ")}` : chair.is_fully_booked ? "Нет свободного времени" : blockedByOwn && !ownFullDay ? `Доступно по часам: ${free || "—"}` : `Свободно: ${free || "—"}`}</div>
                        </div>
                        <span className={`chip ${st.tone}`}>{st.label}</span>
                        {(isMine || !disabled) && <Icon name="right" />}
                      </button>
                    </li>
                  );
                });
              })()}
            </ul>
          )}
        </>
      )}


      {mineSheet && (
        <Sheet title={`${mineSheet.chair.name} · ${dayParts(mineSheet.day.date).long}`} onClose={() => setMineSheet(null)}>
          <Banner kind="ok">Часы забронированы за вами.</Banner>
          <ul className="list">
            <li key={mineSheet.day.date} className="item" style={{ cursor: "default" }}>
              <div className="grow">
                <div className="title">{mineSheet.bookings.map((b) => `${formatTime(b.starts_at)}–${formatTime(b.ends_at)}`).join(", ")}</div>
                <div className="meta">
                  {mineSheet.bookings[0].booking_type === "full_day" ? "Весь день" : `${mineSheet.bookings.reduce((s, b) => s + (b.duration_hours ?? 1), 0)} ч`} ·
                  {formatMoney(mineSheet.bookings.reduce((s, b) => s + (b.price_amount ?? 0), 0), mineSheet.bookings[0].currency)}
                </div>
              </div>
              <button className="btn btn-sm btn-danger" disabled={cancelBusy === mineSheet.day.date} onClick={() => cancelMineDay(mineSheet.day.date)}>
                {cancelBusy === mineSheet.day.date ? "..." : "Отменить день"}
              </button>
            </li>
          </ul>
        </Sheet>
      )}

      {picker && (
        <ChairPicker
          day={picker.day}
          chair={picker.chair}
          onClose={() => setPicker(null)}
          onBooked={() => { setPicker(null); load(); }}
          editMode={pickerEditMode}
          onStale={async () => { await Promise.all([load(), openChair(picker.day, picker.chair.chair_id)]); }}
        />
      )}
    </>
  );
}
