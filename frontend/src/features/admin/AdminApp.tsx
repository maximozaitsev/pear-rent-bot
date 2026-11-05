import { useState } from "react";
import { AdminCalendar } from "./AdminCalendar";
import { RentersAdmin } from "./RentersAdmin";
import { InvitationsAdmin } from "./InvitationsAdmin";
import { SettingsAdmin } from "./SettingsAdmin";

type Tab = "calendar" | "renters" | "invitations" | "settings";

export function AdminApp() {
  const [tab, setTab] = useState<Tab>("calendar");
  return (
    <main className="app">
      <header className="row between wrap">
        <h1>Администратор</h1>
        <nav className="segmented">
          <button className={tab === "calendar" ? "active" : ""} onClick={() => setTab("calendar")}>Календарь</button>
          <button className={tab === "renters" ? "active" : ""} onClick={() => setTab("renters")}>Арендаторы</button>
          <button className={tab === "invitations" ? "active" : ""} onClick={() => setTab("invitations")}>Приглашения</button>
          <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>Настройки</button>
        </nav>
      </header>
      {tab === "calendar" && <AdminCalendar />}
      {tab === "renters" && <RentersAdmin />}
      {tab === "invitations" && <InvitationsAdmin />}
      {tab === "settings" && <SettingsAdmin />}
    </main>
  );
}
