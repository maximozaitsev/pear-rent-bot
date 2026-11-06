import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { AdminCalendar } from "./AdminCalendar";
import { RentersAdmin } from "./RentersAdmin";
import { InvitationsAdmin } from "./InvitationsAdmin";
import { SettingsAdmin } from "./SettingsAdmin";
import { readDefaultPeriod, writeDefaultPeriod, type PeriodMode } from "../schedule/time";
import { Icon, Sheet, TabBar, TopBar } from "../../shared/ui";

type Tab = "calendar" | "renters" | "invitations" | "settings";
const TITLES: Record<Tab, string> = { calendar: "Календарь", renters: "Арендаторы", invitations: "Приглашения", settings: "Настройки" };

export function AdminApp() {
  const { state } = useAuth();
  const userId = state.status === "ready" ? state.user.id : "anon";
  const [tab, setTab] = useState<Tab>("calendar");
  const [defaultPeriod, setDefaultPeriod] = useState<PeriodMode>(() => readDefaultPeriod(userId));
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => { setDefaultPeriod(readDefaultPeriod(userId)); }, [userId]);
  function pickDefault(m: PeriodMode) { setDefaultPeriod(m); writeDefaultPeriod(userId, m); setSettingsOpen(false); }

  return (
    <>
      <main className="app">
        <TopBar
          subtitle="Администратор"
          title={TITLES[tab]}
          action={tab === "calendar" ? <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Настройки календаря"><Icon name="settings" /></button> : undefined}
        />
        {tab === "calendar" && <AdminCalendar key={defaultPeriod} defaultMode={defaultPeriod} />}
        {tab === "renters" && <RentersAdmin />}
        {tab === "invitations" && <InvitationsAdmin />}
        {tab === "settings" && <SettingsAdmin />}
      </main>
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "calendar", label: "Календарь", icon: "calendar" },
          { id: "renters", label: "Люди", icon: "users" },
          { id: "invitations", label: "Инвайты", icon: "mail" },
          { id: "settings", label: "Настройки", icon: "settings" },
        ]}
      />
      {settingsOpen && (
        <Sheet title="Вид календаря по умолчанию" onClose={() => setSettingsOpen(false)}>
          <p className="muted small">Выберите, какая раскладка открывается на странице календаря.</p>
          <div className="segmented">
            <button className={defaultPeriod === "week" ? "active" : ""} onClick={() => pickDefault("week")}>По неделе</button>
            <button className={defaultPeriod === "month" ? "active" : ""} onClick={() => pickDefault("month")}>По месяцу</button>
          </div>
        </Sheet>
      )}
    </>
  );
}
