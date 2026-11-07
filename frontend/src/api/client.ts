import type {
  AuthResponse,
  AvailabilitySchedule,
  Booking,
  Chair,
  DateOverride,
  DaySchedule,
  Invitation,
  Renter,
  RenterPaymentStats,
  User,
  WeekSchedule,
  WeeklyScheduleItem,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api/v1";
const TOKEN_KEY = "pear_rent_token";

export class ApiError extends Error {
  status: number;
  detail: unknown;
  requestId: string | null;
  constructor(status: number, detail: unknown, message?: string, requestId?: string | null) {
    super(message ?? `Request failed (${status})`);
    this.status = status;
    this.detail = detail;
    this.requestId = requestId ?? null;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export type AuthLogEntry = { ts: string; event: string; payload?: Record<string, unknown> };
const AUTH_LOG_MAX = 200;
let authLogBuf: AuthLogEntry[] = [];
const authLogListeners = new Set<() => void>();

function notifyAuthLog() {
  for (const fn of authLogListeners) try { fn(); } catch { /* ignore */ }
}

export function subscribeAuthLog(fn: () => void): () => void {
  authLogListeners.add(fn);
  return () => authLogListeners.delete(fn);
}

export function getAuthLogs(): AuthLogEntry[] {
  return authLogBuf;
}

export function clearAuthLogs(): void {
  authLogBuf = [];
  notifyAuthLog();
}

export function isAuthDebugEnabled(): boolean {
  try {
    const qs = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
    if (qs.get("debug") === "1" || hash.get("debug") === "1") return true;
    return localStorage.getItem("pear_auth_debug") === "1" || (import.meta.env.VITE_AUTH_DEBUG as string | undefined) === "1";
  } catch {
    return false;
  }
}

export function setAuthDebugEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem("pear_auth_debug", "1");
    else localStorage.removeItem("pear_auth_debug");
  } catch { /* ignore */ }
  notifyAuthLog();
}

export function authLog(event: string, payload?: Record<string, unknown>): void {
  const entry: AuthLogEntry = { ts: new Date().toISOString(), event, ...(payload ? { payload } : {}) };
  try {
    // Always buffer (capped) so logs survive "enable debug after boot" flows in Mini App.
    authLogBuf = [...authLogBuf, entry].slice(-AUTH_LOG_MAX);
    notifyAuthLog();
    if (isAuthDebugEnabled()) console.info("[pear-auth]", entry);
    else console.debug("[pear-auth]", entry);
  } catch { /* ignore */ }
}

export function readInitDataFromLocation(): string {
  try {
    const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
    const qs = new URLSearchParams(window.location.search || "");
    let v = hash.get("tgWebAppData") || qs.get("tgWebAppData") || "";
    if (v) try { v = decodeURIComponent(v); } catch { /* keep */ }
    return v;
  } catch {
    return "";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const url = `${API_BASE}${path}`;
  const method = (init?.method ?? "GET").toUpperCase();
  authLog("request_start", { method, path, hasToken: !!token });
  const res = await fetch(url, { ...init, headers });
  const requestId = res.headers.get("x-request-id");
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const detail = (data && typeof data === "object" && "detail" in data ? (data as { detail: unknown }).detail : data) ?? res.statusText;
    authLog("request_error", { method, path, status: res.status, requestId, detail });
    throw new ApiError(res.status, detail, typeof detail === "string" ? detail : JSON.stringify(detail), requestId);
  }
  authLog("request_ok", { method, path, status: res.status, requestId });
  return data as T;
}

export function conflictText(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as { message?: string; conflicts?: Array<{ starts_at?: string; ends_at?: string }> };
  if (!d.conflicts?.length) return null;
  const items = d.conflicts.map((c) => `${c.starts_at?.slice(0, 16) ?? "?"}–${c.ends_at?.slice(11, 16) ?? "?"}`).join(", ");
  return `${d.message ?? "Конфликт"}: ${items}`;
}

export const api = {
  authTelegram: (initData: string) =>
    request<AuthResponse>("/auth/telegram", {
      method: "POST",
      body: JSON.stringify({ init_data: initData }),
    }),
  register: (initData: string, code: string) =>
    request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ init_data: initData, code: code.trim() }),
    }),
  devBypass: (payload: { init_data: string; code?: string; dev_user?: unknown }) =>
    request<AuthResponse>("/auth/dev-bypass", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  completeRegistration: (payload: { first_name: string; last_name?: string | null; phone: string }) =>
    request<AuthResponse>("/auth/complete-registration", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  me: () => request<User>("/auth/me"),
  scheduleDay: (date: string) => request<DaySchedule>(`/schedule/day?date=${encodeURIComponent(date)}`),
  scheduleWeekly: (week: string) => request<WeekSchedule>(`/schedule/weekly?week=${encodeURIComponent(week)}`),
  scheduleAvailability: (from: string, to: string) =>
    request<AvailabilitySchedule>(`/schedule/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  createBooking: (payload: {
    chair_id: string;
    starts_at: string;
    ends_at: string;
    booking_type: "hourly" | "full_day";
  }) => request<Booking>("/bookings", { method: "POST", body: JSON.stringify(payload) }),
  myBookings: () => request<Booking[]>("/bookings/my"),
  cancelBooking: (id: string, reason?: string) =>
    request<Booking>(`/bookings/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }),

  adminBookings: (params: Record<string, string | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    const qs = q.toString();
    return request<Booking[]>(`/admin/bookings${qs ? `?${qs}` : ""}`);
  },
  adminSetPayment: (id: string, payment_status: "paid" | "unpaid") =>
    request<Booking>(`/admin/bookings/${id}/payment`, { method: "PATCH", body: JSON.stringify({ payment_status }) }),

  adminRenters: () => request<Renter[]>("/admin/renters"),
  adminRenter: (id: string) => request<{ renter: Renter; bookings: Booking[]; stats: RenterPaymentStats }>(`/admin/renters/${id}`),
  adminSetRenterStatus: (id: string, is_active: boolean) =>
    request<Renter>(`/admin/renters/${id}/status`, { method: "PATCH", body: JSON.stringify({ is_active }) }),

  adminInvitations: () => request<Invitation[]>("/admin/invitations"),
  adminCreateInvitation: () => request<Invitation>("/admin/invitations", { method: "POST" }),
  adminRevokeInvitation: (id: string) => request<Invitation>(`/admin/invitations/${id}/revoke`, { method: "POST" }),

  chairs: (includeArchived = false) => request<Chair[]>(`/chairs?include_archived=${includeArchived}`),
  adminCreateChair: (name: string) => request<Chair>("/admin/chairs", { method: "POST", body: JSON.stringify({ name }) }),
  adminUpdateChair: (id: string, payload: { name?: string; is_active?: boolean }) =>
    request<Chair>(`/admin/chairs/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  adminArchiveChair: (id: string) => request<Chair>(`/admin/chairs/${id}/archive`, { method: "POST" }),

  adminWeeklySchedule: () => request<WeeklyScheduleItem[]>("/admin/schedule/weekly"),
  adminPutWeeklySchedule: (items: WeeklyScheduleItem[]) =>
    request<WeeklyScheduleItem[]>("/admin/schedule/weekly", { method: "PUT", body: JSON.stringify({ items }) }),
  adminExceptions: () => request<DateOverride[]>("/admin/schedule/exceptions"),
  adminPutException: (day: string, payload: { is_open: boolean; open_time?: string | null; close_time?: string | null; reason?: string | null }) =>
    request<DateOverride>(`/admin/schedule/exceptions/${day}`, { method: "PUT", body: JSON.stringify(payload) }),
  adminDeleteException: (day: string) =>
    request<void>(`/admin/schedule/exceptions/${day}`, { method: "DELETE" }),
};

export function getTelegramWebApp() {
  return window.Telegram?.WebApp;
}
