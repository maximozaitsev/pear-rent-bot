import { useState } from "react";
import { AuthProvider, useAuth } from "../features/auth/AuthContext";
import { RegisterGate } from "../features/auth/RegisterGate";
import { RenterSchedule } from "../features/schedule/RenterSchedule";
import { MyBookings } from "../features/bookings/MyBookings";
import { AdminApp } from "../features/admin/AdminApp";

function RenterApp() {
  const [tab, setTab] = useState<"schedule" | "mine">("schedule");
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <main className="app">
      <header className="row between wrap">
        <h1>Аренда кресла</h1>
        <nav className="segmented">
          <button className={tab === "schedule" ? "active" : ""} onClick={() => setTab("schedule")}>Расписание</button>
          <button className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}>Мои брони</button>
        </nav>
      </header>
      {tab === "schedule" ? (
        <RenterSchedule refreshKey={refreshKey} />
      ) : (
        <MyBookings onChanged={() => setRefreshKey((k) => k + 1)} />
      )}
    </main>
  );
}

function Router() {
  const { state } = useAuth();
  if (state.status === "loading") return <main className="app"><p className="muted">Загрузка...</p></main>;
  if (state.status === "anonymous") return <RegisterGate reason={state.reason} inviteToken={state.inviteToken} />;
  return state.user.role === "admin" ? <AdminApp /> : <RenterApp />;
}

export function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}
