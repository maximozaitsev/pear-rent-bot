import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Invitation } from "../../api/types";

export function InvitationsAdmin() {
  const [items, setItems] = useState<Invitation[]>([]);
  const [created, setCreated] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setItems(await api.adminInvitations()); } catch (e) { setError(e instanceof Error ? e.message : "Ошибка"); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setBusy(true); setError(null);
    try { const inv = await api.adminCreateInvitation(); setCreated(inv); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Ошибка"); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    try { await api.adminRevokeInvitation(id); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Ошибка"); }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); } catch {}
  }

  return (
    <section className="card">
      <h2>Приглашения</h2>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy} onClick={create}>{busy ? "Создание..." : "Создать приглашение"}</button>
      {created?.invite_link && (
        <div className="subcard">
          <p><strong>Ссылка (показывается один раз):</strong></p>
          <p className="small" style={{ wordBreak: "break-all" }}>{created.invite_link}</p>
          <button onClick={() => copy(created.invite_link!)}>Скопировать ссылку</button>
        </div>
      )}
      <ul className="list">{items.map((i) => (
        <li key={i.id} className="list-item">
          <div><span className={`chip ${i.status === "pending" ? "status-partial" : i.status === "used" ? "status-free" : "status-closed"}`}>{i.status === "pending" ? "ожидает" : i.status === "used" ? "использовано" : "отозвано"}</span><div className="small muted">{i.created_at.slice(0, 16)}</div></div>
          {i.status === "pending" && <button className="danger" onClick={() => revoke(i.id)}>Отозвать</button>}
        </li>
      ))}</ul>
    </section>
  );
}
