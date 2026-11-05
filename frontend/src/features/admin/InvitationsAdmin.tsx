import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Invitation } from "../../api/types";
import { Banner, Empty, errorText, haptic } from "../../shared/ui";

const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "ожидает", tone: "warn" },
  used: { label: "использовано", tone: "ok" },
  revoked: { label: "отозвано", tone: "mute" },
};

export function InvitationsAdmin() {
  const [items, setItems] = useState<Invitation[] | null>(null);
  const [created, setCreated] = useState<Invitation | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setItems(await api.adminInvitations()); } catch (e) { setError(errorText(e)); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setBusy(true); setError(null); setCopied(false);
    try { const inv = await api.adminCreateInvitation(); setCreated(inv); haptic("success"); await load(); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    try { await api.adminRevokeInvitation(id); await load(); } catch (e) { setError(errorText(e)); }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(true); haptic("success"); } catch { /* ignore */ }
  }

  return (
    <>
      {error && <Banner kind="bad">{error}</Banner>}
      <button className="btn btn-primary btn-block" disabled={busy} onClick={create}>{busy ? "Создание..." : "+ Создать приглашение"}</button>

      {created?.invite_link && (
        <section className="card">
          <h2>Новая ссылка</h2>
          <p className="muted small">Показывается один раз — скопируйте и отправьте арендатору.</p>
          <div className="code">{created.invite_link}</div>
          <button className="btn btn-block" onClick={() => copy(created.invite_link!)}>{copied ? "Скопировано ✓" : "Скопировать ссылку"}</button>
        </section>
      )}

      <div className="section-label">История</div>
      {items?.length === 0 && <Empty icon="✉️">Приглашений пока нет.</Empty>}
      <ul className="list">
        {items?.map((i) => {
          const st = STATUS[i.status] ?? { label: i.status, tone: "mute" };
          return (
            <li key={i.id} className="item">
              <div className="grow">
                <span className={`chip ${st.tone}`}>{st.label}</span>
                <div className="meta" style={{ marginTop: 4 }}>{i.created_at.slice(0, 16).replace("T", " ")}</div>
              </div>
              {i.status === "pending" && <button className="btn btn-sm btn-danger" onClick={() => revoke(i.id)}>Отозвать</button>}
            </li>
          );
        })}
      </ul>
    </>
  );
}
