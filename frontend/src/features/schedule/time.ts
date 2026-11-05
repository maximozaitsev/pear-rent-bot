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

export function isSlotInFree(startsAt: string, endsAt: string, free: { starts_at: string; ends_at: string }[]): boolean {
  return free.some((f) => startsAt >= f.starts_at && endsAt <= f.ends_at);
}
