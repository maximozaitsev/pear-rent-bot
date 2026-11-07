// Примечание: AuthProvider убран отсюда — он уже оборачивает <App/> в main.tsx (раньше был вложенный дубль и двойной вызов авторизации).
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Booking } from "../api/types";
import { useAuth } from "../features/auth/AuthContext";
import { RegisterGate } from "../features/auth/RegisterGate";
import { CompleteRegistration } from "../features/auth/CompleteRegistration";
import { RenterSchedule } from "../features/schedule/RenterSchedule";
import { formatMoney, formatTime, groupByDay, readDefaultPeriod, writeDefaultPeriod, type PeriodMode } from "../features/schedule/time";
import { MyBookings } from "../features/bookings/MyBookings";
import { AdminApp } from "../features/admin/AdminApp";
import { Icon, Loader, Sheet, TabBar, TopBar, dayParts, todayIso } from "../shared/ui";

function relDay(iso: string): { label: string; tone: "accent" | "mute" } {
  const diff = Math.round(
    (Date.parse(iso + "T00:00:00Z") - Date.parse(todayIso() + "T00:00:00Z")) /
      86400000,
  );
  if (diff < 0) return { label: "Прошла", tone: "mute" };
  if (diff === 0) return { label: "Сегодня", tone: "accent" };
  if (diff === 1) return { label: "Завтра", tone: "accent" };
  return { label: `Через ${diff} дн.`, tone: "mute" };
}

function NearestBooking({ refreshKey }: { refreshKey: number }) {
  const [dayBookings, setDayBookings] = useState<Booking[] | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    api
      .myBookings()
      .then((items) => {
        const grouped = groupByDay(items);
        if (alive) setDayBookings(grouped.length ? grouped[0].bookings : null);
      })
      .catch(() => {
        if (alive) setDayBookings(null);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (dayBookings === undefined)
    return <div className="skeleton" style={{ height: 84 }} />;

  if (!dayBookings || dayBookings.length === 0) {
    return (
      <section className="next-card is-empty">
        <div className="grow">
          <div className="next-label">Ближайшая бронь</div>
          <div className="next-time">Пока ничего не запланировано</div>
        </div>
      </section>
    );
  }

  const sorted = [...dayBookings].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const first = sorted[0];
  const date = first.starts_at.slice(0, 10);
  const p = dayParts(date);
  const rel = relDay(date);
  const intervals = sorted.map((b) => `${formatTime(b.starts_at)}–${formatTime(b.ends_at)}`).join(", ");
  const hours = sorted.reduce((s, b) => s + (b.duration_hours ?? 1), 0);
  const price = sorted.reduce((s, b) => s + (b.price_amount ?? 0), 0);
  return (
    <section className="next-card">
      <div className="date-badge">
        <b>{p.num}</b>
        <span>{p.mon}</span>
      </div>
      <div className="grow">
        <div className="next-label">Ближайшая бронь</div>
        <div className="next-time">{intervals}</div>
        <div className="meta">
          {p.long} · {hours} ч · {formatMoney(price, first.currency)}
        </div>
      </div>
      <span className={`chip ${rel.tone}`}>{rel.label}</span>
    </section>
  );
}

function DefaultPeriodSheet({ value, onPick, onClose }: { value: PeriodMode; onPick: (m: PeriodMode) => void; onClose: () => void }) {
  return (
    <Sheet title="Вид календаря по умолчанию" onClose={onClose}>
      <p className="muted small">Выберите, какая раскладка открывается на странице расписания.</p>
      <div className="segmented">
        <button className={value === "week" ? "active" : ""} onClick={() => onPick("week")}>По неделе</button>
        <button className={value === "month" ? "active" : ""} onClick={() => onPick("month")}>По месяцу</button>
      </div>
    </Sheet>
  );
}

function RenterApp() {
  const { state } = useAuth();
  const userId = state.status === "ready" ? state.user.id : "anon";
  const [tab, setTab] = useState<"schedule" | "mine">("schedule");
  const [refreshKey, setRefreshKey] = useState(0);
  const [defaultPeriod, setDefaultPeriod] = useState<PeriodMode>(() => readDefaultPeriod(userId));
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => { setDefaultPeriod(readDefaultPeriod(userId)); }, [userId]);
  function pickDefault(m: PeriodMode) { setDefaultPeriod(m); writeDefaultPeriod(userId, m); setSettingsOpen(false); }

  return (
    <>
      <main className="app">
        <TopBar
          subtitle="Аренда кресла"
          title={tab === "schedule" ? "Расписание" : "Мои брони"}
          action={tab === "schedule" ? <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Настройки календаря"><Icon name="settings" /></button> : undefined}
        />
        {tab === "schedule" ? (
          <>
            <NearestBooking refreshKey={refreshKey} />
            <RenterSchedule key={defaultPeriod} refreshKey={refreshKey} defaultMode={defaultPeriod} />
          </>
        ) : (
          <MyBookings onChanged={() => setRefreshKey((k) => k + 1)} />
        )}
      </main>
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "schedule", label: "Расписание", icon: "calendar" },
          { id: "mine", label: "Мои брони", icon: "list" },
        ]}
      />
      {settingsOpen && <DefaultPeriodSheet value={defaultPeriod} onPick={pickDefault} onClose={() => setSettingsOpen(false)} />}
    </>
  );
}

function Router() {
  const { state } = useAuth();
  if (state.status === "loading")
    return (
      <main className="app no-tabs">
        <Loader />
      </main>
    );
  if (state.status === "anonymous")
    return <RegisterGate reason={state.reason} />;
  if (state.status === "needs_profile")
    return <CompleteRegistration tgFirstName={state.tgFirstName} onDone={() => window.location.reload()} />;
  return state.user.role === "admin" ? <AdminApp /> : <RenterApp />;
}

export function App() {
  return <Router />;
}
