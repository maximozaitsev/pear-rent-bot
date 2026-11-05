// Примечание: AuthProvider убран отсюда — он уже оборачивает <App/> в main.tsx (раньше был вложенный дубль и двойной вызов авторизации).
import { useState } from "react";
import { useAuth } from "../features/auth/AuthContext";
import { RegisterGate } from "../features/auth/RegisterGate";
import { RenterSchedule } from "../features/schedule/RenterSchedule";
import { MyBookings } from "../features/bookings/MyBookings";
import { AdminApp } from "../features/admin/AdminApp";
import { Loader, TabBar, TopBar } from "../shared/ui";

function RenterApp() {
  const [tab, setTab] = useState<"schedule" | "mine">("schedule");
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <>
      <main className="app">
        <TopBar subtitle="Аренда кресла" title={tab === "schedule" ? "Расписание" : "Мои брони"} />
        {tab === "schedule" ? (
          <RenterSchedule refreshKey={refreshKey} />
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
  if (state.status === "loading") return <main className="app no-tabs"><Loader /></main>;
  if (state.status === "anonymous") return <RegisterGate reason={state.reason} inviteToken={state.inviteToken} />;
  return state.user.role === "admin" ? <AdminApp /> : <RenterApp />;
}

export function App() {
  return <Router />;
}
