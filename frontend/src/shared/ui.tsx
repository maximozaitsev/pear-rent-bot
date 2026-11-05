import { useEffect, type ReactNode } from "react";
import { ApiError, conflictText } from "../api/client";
import type { DaySchedule } from "../api/types";
import { addDays, mondayOf } from "../features/schedule/time";

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

/* ---------- icons ---------- */
const ICONS: Record<string, ReactNode> = {
  calendar: <><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  users: <><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0M17 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6" /></>,
  mail: <><rect x="2" y="4" width="20" height="16" rx="3" /><path d="m2 7 10 7 10-7" /></>,
  settings: <><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  left: <path d="m15 18-6-6 6-6" />,
  right: <path d="m9 18 6-6-6-6" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
};
export function Icon({ name }: { name: keyof typeof ICONS | string }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>;
}

/* ---------- layout pieces ---------- */
export function TopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="topbar">
      {subtitle && <span className="sub">{subtitle}</span>}
      <h1>{title}</h1>
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
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
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

export function WeekNav({ weekStart, onChange }: { weekStart: Date; onChange: (d: Date) => void }) {
  const f = (d: Date) => d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <div className="weeknav">
      <button className="icon-btn" onClick={() => onChange(addDays(weekStart, -7))} aria-label="Предыдущая неделя"><Icon name="left" /></button>
      <div className="weeknav-label">{f(weekStart)} – {f(addDays(weekStart, 6))}</div>
      <button className="icon-btn" onClick={() => onChange(addDays(weekStart, 7))} aria-label="Следующая неделя"><Icon name="right" /></button>
      <button className="btn btn-sm btn-ghost" onClick={() => onChange(mondayOf(new Date()))}>Сегодня</button>
    </div>
  );
}

export function DayStrip({
  days, selected, onSelect, counts,
}: { days: DaySchedule[]; selected: string; onSelect: (d: DaySchedule) => void; counts?: Record<string, number> }) {
  const today = todayIso();
  return (
    <div className="daystrip">
      {days.map((d) => {
        const p = dayParts(d.date);
        const n = counts?.[d.date] ?? 0;
        return (
          <button key={d.date} className={`daypill ${selected === d.date ? "selected" : ""} ${d.date === today ? "today" : ""}`} onClick={() => { haptic(); onSelect(d); }}>
            <span className="wd">{p.wd}</span>
            <span className="num">{p.num}</span>
            <span className={`dot ${dayState(d)}`} />
            {n > 0 && <span className="badge">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}
