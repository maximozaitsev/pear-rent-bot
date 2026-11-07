import { useEffect, useState, type ReactNode } from "react";
import { ApiError, conflictText } from "../api/client";
import type { ChairDay, DaySchedule } from "../api/types";
import { addDays, addMonths, firstOfMonth, formatWeekRange, mondayOf, monthGridWeeks, monthLabelRu } from "../features/schedule/time";

/* ---------- helpers ---------- */
export function haptic(kind: "light" | "success" | "error" = "light") {
  try {
    const h = (window as any).Telegram?.WebApp?.HapticFeedback;
    if (!h) return;
    if (kind === "light") h.impactOccurred("light");
    else h.notificationOccurred(kind);
  } catch { /* ignore */ }
}

export function errorText(e: unknown, fallback = "Ошибка"): string {
  if (e instanceof ApiError) {
    const c = conflictText(e.detail);
    if (c) return c;
    const d = e.detail as any;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((x) => x?.msg).filter(Boolean).join("; ") || e.message;
    if (d && typeof d === "object" && d.message) return String(d.message);
    return e.message;
  }
  return e instanceof Error ? e.message : fallback;
}

type Person = { first_name: string | null; last_name: string | null; username: string | null; telegram_id: number };
export function personName(r?: Person | null, fallback = "—"): string {
  if (!r) return fallback;
  return [r.first_name, r.last_name].filter(Boolean).join(" ") || r.username || String(r.telegram_id);
}
export function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
}

export function todayIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

export function dayParts(iso: string) {
  const d = new Date(iso + "T00:00:00Z");
  return {
    wd: d.toLocaleDateString("ru-RU", { weekday: "short", timeZone: "UTC" }),
    num: d.getUTCDate(),
    mon: d.toLocaleDateString("ru-RU", { month: "short", timeZone: "UTC" }).replace(".", ""),
    long: d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
  };
}

export function dayState(day: DaySchedule): "closed" | "free" | "partial" | "busy" {
  if (!day.working_hours.is_open) return "closed";
  if (!day.chairs.length) return "free";
  if (day.chairs.every((c) => c.is_fully_booked)) return "busy";
  if (day.chairs.some((c) => c.is_fully_booked || c.is_partially_booked || c.bookings.length)) return "partial";
  return "free";
}

export type DotVariant = "admin" | "renter";

function ChairDots({ day, variant, picked, pickedChairId, pickedChairByDate }: { day: DaySchedule; variant?: DotVariant; picked?: boolean; pickedChairId?: string; pickedChairByDate?: Map<string, string> }) {
  if (!day.working_hours.is_open) return <span className="dots"><i className="cdot closed" /></span>;
  const chairs = day.chairs;
  if (!chairs.length) return <span className="dots"><i className="cdot empty" /></span>;
  const resolvedPicked = pickedChairByDate?.get(day.date) ?? (picked && !pickedChairId ? undefined : pickedChairId);
  if (picked && !resolvedPicked) return <span className="dots">{chairs.map((c) => <i key={c.chair_id} className="cdot picked" />)}</span>;
  return (
    <span className="dots">
      {chairs.map((c) => {
        if (picked && resolvedPicked && c.chair_id === resolvedPicked) return <i key={c.chair_id} className="cdot b-ok" />;
        if (variant === "admin") return <i key={c.chair_id} className={adminChairDot(c)} />;
        if (variant === "renter") return <i key={c.chair_id} className={renterChairDot(c)} />;
        return <i key={c.chair_id} className={`cdot fill-${dayState(day)}`} />;
      })}
    </span>
  );
}

function adminChairDot(c: ChairDay): string {
  const hasBookings = c.bookings.length > 0;
  if (!hasBookings) return "cdot empty";
  const border = c.is_fully_booked ? "b-ok" : "b-warn"; // бронь: зел = целый день, оранж = частично
  const paidCount = c.bookings.filter((b) => b.payment_status === "paid").length;
  let fill = "f-none"; // нет оплаты — без заливки
  if (paidCount === c.bookings.length) fill = "f-ok"; // все оплачены — зелёная
  else if (paidCount > 0) fill = "f-warn"; // оплачены частично — оранжевая
  return `cdot ${border} ${fill}`;
}

function renterChairDot(c: ChairDay): string {
  if (c.is_fully_booked) return "cdot empty";
  if (c.is_free_whole_day) return "cdot f-ok b-none";
  return "cdot f-warn b-none";
}

/* ---------- icons ---------- */
const ICONS: Record<string, ReactNode> = {
  calendar: <><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  users: <><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0M17 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6" /></>,
  mail: <><rect x="2" y="4" width="20" height="16" rx="3" /><path d="m2 7 10 7 10-7" /></>,
  settings: <><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  left: <path d="m15 18-6-6 6-6" />,
  right: <path d="m9 18 6-6-6-6" />,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  x: <path d="M18 6 6 18M6 6l12 12" />,
};
export function Icon({ name }: { name: keyof typeof ICONS | string }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>;
}

/* ---------- layout pieces ---------- */
export function TopBar({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="topbar">
      {subtitle && <span className="sub">{subtitle}</span>}
      <div className="row between">
        <h1>{title}</h1>
        {action}
      </div>
    </header>
  );
}

export function TabBar<T extends string>({
  tabs, value, onChange,
}: { tabs: { id: T; label: string; icon: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <nav className="tabbar">
      <div className="tabbar-inner">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${value === t.id ? "active" : ""}`} onClick={() => { haptic(); onChange(t.id); }}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    // Keep page scrollable even if a sheet fails to unmount; backdrop still covers the viewport.
  }, []);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть"><Icon name="x" /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Banner({ kind, children, onRetry }: { kind: "bad" | "ok" | "info"; children: ReactNode; onRetry?: () => void }) {
  return (
    <div className={`banner ${kind}`}>
      <span>{children}</span>
      {onRetry && <button className="link" onClick={onRetry}>Повторить</button>}
    </div>
  );
}

export function Empty({ icon = "🗓", children }: { icon?: string; children: ReactNode }) {
  return <div className="empty"><div className="big">{icon}</div><div>{children}</div></div>;
}

export function Loader() {
  return <div className="spinner" role="status" aria-label="Загрузка" />;
}

import type { PeriodMode } from "../features/schedule/time";
export type { PeriodMode };

export function WeekNav({
  weekStart,
  onChange,
  mode,
  onModeChange,
  actionLabel,
  actionActive,
  actionClassName,
  onAction,
  onSelectToday,
}: {
  weekStart: Date;
  onChange: (d: Date) => void;
  mode?: PeriodMode;
  onModeChange?: (m: PeriodMode) => void;
  actionLabel?: string;
  actionActive?: boolean;
  actionClassName?: string;
  onAction?: () => void;
  /** When provided (admin), "Сегодня" navigates to current period AND selects today's date. */
  onSelectToday?: (today: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentMode = mode ?? "week";
  const showMode = !!onModeChange;

  const prev = () => onChange(currentMode === "month" ? addMonths(weekStart, -1) : addDays(weekStart, -7));
  const next = () => onChange(currentMode === "month" ? addMonths(weekStart, 1) : addDays(weekStart, 7));
  const today = () => {
    if (onSelectToday) {
      const t = todayIso();
      onChange(currentMode === "month" ? firstOfMonth(new Date()) : mondayOf(new Date()));
      onSelectToday(t);
      return;
    }
    onChange(currentMode === "month" ? firstOfMonth(new Date()) : mondayOf(new Date()));
  };
  const label = currentMode === "month" ? `мес: ${monthLabelRu(weekStart)}` : showMode ? `нед: ${formatWeekRange(weekStart)}` : formatWeekRange(weekStart);

  useEffect(() => { if (!open) return; const onDoc = () => setOpen(false); document.addEventListener("click", onDoc); return () => document.removeEventListener("click", onDoc); }, [open]);

  return (
    <div className="weeknav" onClick={(e) => e.stopPropagation()}>
      <button className="icon-btn" onClick={prev} aria-label={currentMode === "month" ? "Предыдущий месяц" : "Предыдущая неделя"}><Icon name="left" /></button>
      {showMode ? (
        <button type="button" className="period-label" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
          <span>{label}</span><span className="caret">▾</span>
        </button>
      ) : (
        <div className="weeknav-label">{label}</div>
      )}
      <button className="icon-btn" onClick={next} aria-label={currentMode === "month" ? "Следующий месяц" : "Следующая неделя"}><Icon name="right" /></button>
      {onAction ? (
        <button type="button" className={`btn btn-sm btn-ghost select-action ${actionActive ? "active" : ""}`} onClick={onAction}>{actionLabel ?? "Выбрать"}</button>
      ) : (
        <button className="btn btn-sm btn-ghost" onClick={today}>Сегодня</button>
      )}
      {showMode && open && onModeChange && (
        <div className="period-menu" role="menu">
          <button type="button" className={currentMode === "week" ? "active" : ""} onClick={() => { onModeChange("week"); setOpen(false); }}>По неделе</button>
          <button type="button" className={currentMode === "month" ? "active" : ""} onClick={() => { onModeChange("month"); setOpen(false); }}>По месяцу</button>
        </div>
      )}
    </div>
  );
}

export function MonthGrid({
  month,
  daysByDate,
  selected,
  onSelect,
  loading,
  pickedDates,
  canPickDate,
  dotVariant,
  pickedChairId,
  pickedChairByDate,
  renterOwn,
  renterOwnDates,
}: {
  month: Date;
  daysByDate: Record<string, DaySchedule | undefined>;
  selected: string;
  onSelect: (d: DaySchedule) => void;
  loading?: boolean;
  pickedDates?: Set<string>;
  canPickDate?: (d: DaySchedule) => boolean;
  dotVariant?: DotVariant;
  pickedChairId?: string;
  pickedChairByDate?: Map<string, string>;
  renterOwn?: (d: DaySchedule) => boolean;
  renterOwnDates?: Set<string>;
}) {
  const today = todayIso();
  const weeks = monthGridWeeks(month);
  const picking = !!pickedDates;
  return (
    <div className="monthgrid">
      {weeks.map((week, wi) => (
        <div key={wi} className="monthrow">
          {week.map((cell) => {
            const d = daysByDate[cell.date];
            const p = dayParts(cell.date);
            const picked = pickedDates?.has(cell.date);
            const own = renterOwnDates ? renterOwnDates.has(cell.date) : !!d && !!renterOwn?.(d);
            const pickable = picking ? !!d && !!cell.inMonth && !own && (!canPickDate || canPickDate(d)) : !!d && cell.inMonth;
            const disabled = !cell.inMonth || !d || !!loading || (picking && !pickable);
            const pickedClass = picking ? (own ? "own picked" : picked ? "picked" : "") : own ? "own" : "";
            return (
              <button
                key={cell.date}
                type="button"
                className={`daycell ${selected === cell.date ? "selected" : ""} ${cell.date === today ? "today" : ""} ${!cell.inMonth ? "outside" : ""} ${pickedClass}`}
                disabled={disabled}
                onClick={() => { if (d && cell.inMonth && !(picking && own)) { haptic(); onSelect(d); } }}
              >
                <span className="wd">{p.wd}</span>
                <span className="num">{p.num}</span>
                {d ? <ChairDots day={d} variant={dotVariant} picked={picked} pickedChairId={pickedChairId} pickedChairByDate={pickedChairByDate} /> : <span className="dots"><i className="cdot closed" /></span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function DayStrip({
  days, selected, onSelect, counts, pickedDates, canPickDate, dotVariant, pickedChairId, pickedChairByDate, renterOwn, renterOwnDates,
}: { days: DaySchedule[]; selected: string; onSelect: (d: DaySchedule) => void; counts?: Record<string, number>; pickedDates?: Set<string>; canPickDate?: (d: DaySchedule) => boolean; dotVariant?: DotVariant; pickedChairId?: string; pickedChairByDate?: Map<string, string>; renterOwn?: (d: DaySchedule) => boolean; renterOwnDates?: Set<string> }) {
  const today = todayIso();
  const picking = !!pickedDates;
  return (
    <div className="daystrip">
      {days.map((d) => {
        const p = dayParts(d.date);
        const n = counts?.[d.date] ?? 0;
        const picked = pickedDates?.has(d.date);
        const own = renterOwnDates ? renterOwnDates.has(d.date) : !!renterOwn?.(d);
        const pickable = picking ? (!own && (!canPickDate || canPickDate(d))) : true;
        const pickedClass = picking ? (own ? "own picked" : picked ? "picked" : "") : own ? "own" : "";
        return (
          <button key={d.date} className={`daypill ${selected === d.date ? "selected" : ""} ${d.date === today ? "today" : ""} ${pickedClass}`} disabled={picking && !pickable} onClick={() => { if (!(picking && own)) { haptic(); onSelect(d); } }}>
            <span className="wd">{p.wd}</span>
            <span className="num">{p.num}</span>
            <ChairDots day={d} variant={dotVariant} picked={picked} pickedChairId={pickedChairId} pickedChairByDate={pickedChairByDate} />
            {!picking && n > 0 && <span className="badge">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}
