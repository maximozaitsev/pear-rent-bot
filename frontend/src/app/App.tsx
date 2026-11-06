// Примечание: AuthProvider убран отсюда — он уже оборачивает <App/> в main.tsx (раньше был вложенный дубль и двойной вызов авторизации).
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Booking } from "../api/types";
import { useAuth } from "../features/auth/AuthContext";
import { RegisterGate } from "../features/auth/RegisterGate";
import { RenterSchedule } from "../features/schedule/RenterSchedule";
import { formatMoney, formatTime } from "../features/schedule/time";
import { MyBookings } from "../features/bookings/MyBookings";
import { AdminApp } from "../features/admin/AdminApp";
import { Loader, TabBar, TopBar, dayParts, todayIso } from "../shared/ui";

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
  const [booking, setBooking] = useState<Booking | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    api
      .myBookings()
      .then((items) => {
        const sorted = [...items].sort((a, b) =>
          a.starts_at.localeCompare(b.starts_at),
        );
        if (alive) setBooking(sorted[0] ?? null);
      })
      .catch(() => {
        if (alive) setBooking(null);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (booking === undefined)
    return <div className="skeleton" style={{ height: 84 }} />;

  if (!booking) {
    return (
      <section className="next-card is-empty">
        <div className="grow">
          <div className="next-label">Ближайшая бронь</div>
          <div className="next-time">Пока ничего не запланировано</div>
        </div>
      </section>
    );
  }

  const date = booking.starts_at.slice(0, 10);
  const p = dayParts(date);
  const rel = relDay(date);
  return (
    <section className="next-card">
      <div className="date-badge">
        <b>{p.num}</b>
        <span>{p.mon}</span>
      </div>
      <div className="grow">
        <div className="next-label">Ближайшая бронь</div>
        <div className="next-time">
          {formatTime(booking.starts_at)}–{formatTime(booking.ends_at)}
        </div>
        <div className="meta">
          {p.long} · {formatMoney(booking.price_amount, booking.currency)}
        </div>
      </div>
      <span className={`chip ${rel.tone}`}>{rel.label}</span>
    </section>
  );
}

function RenterApp() {
  const [tab, setTab] = useState<"schedule" | "mine">("schedule");
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <>
      <main className="app">
        <TopBar
          subtitle="Аренда кресла"
          title={tab === "schedule" ? "Расписание" : "Мои брони"}
        />
        {tab === "schedule" ? (
          <>
            <NearestBooking refreshKey={refreshKey} />
            <RenterSchedule refreshKey={refreshKey} />
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
    return (
      <RegisterGate reason={state.reason} inviteToken={state.inviteToken} />
    );
  return state.user.role === "admin" ? <AdminApp /> : <RenterApp />;
}

export function App() {
  return <Router />;
}
