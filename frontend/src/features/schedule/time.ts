export function mondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  if (day !== 1) d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function firstOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

export function monthLabelRu(date: Date): string {
  return date.toLocaleDateString("ru-RU", { month: "long", timeZone: "UTC" });
}

export function formatWeekRange(weekStart: Date): string {
  const f = (d: Date) => d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${f(weekStart)} – ${f(addDays(weekStart, 6))}`;
}

export type MonthCell = { date: string; inMonth: boolean };

export function monthGridWeeks(month: Date): MonthCell[][] {
  const first = firstOfMonth(month);
  const year = first.getUTCFullYear();
  const m = first.getUTCMonth();
  const start = mondayOf(first);
  const weeks: MonthCell[][] = [];
  let cur = start;
  for (let w = 0; w < 6; w++) {
    const week: MonthCell[] = [];
    for (let i = 0; i < 7; i++) {
      const iso = isoDate(cur);
      week.push({ date: iso, inMonth: cur.getUTCMonth() === m && cur.getUTCFullYear() === year });
      cur = addDays(cur, 1);
    }
    weeks.push(week);
    if (cur.getUTCMonth() !== m && cur.getUTCFullYear() >= year && !(m === 11 && cur.getUTCFullYear() === year)) break;
    if (cur.getUTCMonth() !== m && (cur.getUTCFullYear() > year || (cur.getUTCFullYear() === year && cur.getUTCMonth() > m))) break;
  }
  // Always 4-6 rows: if first day of month was Monday and month fits in 4 weeks rare; trim trailing week only if entirely next month (shouldn't happen with logic) — keep computed weeks.
  return weeks;
}

export function formatDateRu(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function formatTime(iso: string): string {
  return iso.includes("T") ? iso.slice(11, 16) : iso.slice(0, 5);
}

export function formatMoney(kopeks: number, currency = "BYN"): string {
  return `${(kopeks / 100).toFixed(kopeks % 100 === 0 ? 0 : 2)} ${currency}`;
}

export function calcHourlyPrice(hours: number): number {
  if (hours < 1) return 0;
  return 1000 + 500 * (hours - 1);
}

export function buildHourSlots(openTime: string | null, closeTime: string | null): string[] {
  if (!openTime || !closeTime) return [];
  const [oh] = openTime.split(":").map(Number);
  const [ch] = closeTime.split(":").map(Number);
  const slots: string[] = [];
  for (let h = oh; h < ch; h++) slots.push(`${String(h).padStart(2, "0")}:00`);
  return slots;
}

export function isSlotBusy(startsAt: string, endsAt: string, busy: { starts_at: string; ends_at: string }[]): boolean {
  return busy.some((b) => startsAt < b.ends_at && endsAt > b.starts_at);
}

export type PeriodMode = "week" | "month";

export function readDefaultPeriod(userId: string): PeriodMode {
  try {
    const v = localStorage.getItem(`pear_rent_period_${userId}`);
    return v === "month" ? "month" : "week";
  } catch { return "week"; }
}

export function writeDefaultPeriod(userId: string, mode: PeriodMode): void {
  try { localStorage.setItem(`pear_rent_period_${userId}`, mode); } catch { /* ignore */ }
}
