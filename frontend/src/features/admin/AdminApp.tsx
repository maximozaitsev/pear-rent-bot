import { useState } from "react";
import { AdminCalendar } from "./AdminCalendar";
import { RentersAdmin } from "./RentersAdmin";
import { InvitationsAdmin } from "./InvitationsAdmin";
import { SettingsAdmin } from "./SettingsAdmin";
import { TabBar, TopBar } from "../../shared/ui";

type Tab = "calendar" | "renters" | "invitations" | "settings";
const TITLES: Record<Tab, string> = { calendar: "Календарь", renters: "Арендаторы", invitations: "Приглашения", settings: "Настройки" };

export function AdminApp() {
  const [tab, setTab] = useState<Tab>("calendar");
  return (
    <>
      <main className="app">
        <TopBar subtitle="Администратор" title={TITLES[tab]} />
        {tab === "calendar" && <AdminCalendar />}
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
    </>
  );
}
