import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Invitation } from "../../api/types";
import { formatDateTimeDot } from "../schedule/time";
import { Banner, Empty, errorText, haptic } from "../../shared/ui";

const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "ожидает", tone: "warn" },
  used: { label: "использован", tone: "ok" },
  revoked: { label: "отозван", tone: "mute" },
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

  function message(code: string) {
    const bot = ((import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined) || "pear_chair_rental_bot").replace(/^@/, "");
    return `Привет! Приглашаю тебя в Pear Rent — тут можно бронировать кресло.

1) Открой бота: @${bot}
2) Нажми «Запустить» /start
3) Открой мини-приложение через кнопку меню
4) Введи код приглашения: ${code}

Код одноразовый.`;
  }

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
      <button className="btn btn-primary btn-block" disabled={busy} onClick={create}>{busy ? "Создание..." : "+ Создать код приглашения"}</button>

      {created?.code && (
        <section className="card">
          <h2>Код приглашения</h2>
          <p className="muted small">Код одноразовый — скопируй и отправь арендатору.</p>
          <button
            type="button"
            className="code"
            title="Нажми, чтобы скопировать код"
            onClick={() => copy(created.code!)}
            style={{ width: "100%", textAlign: "center", fontWeight: 700, fontSize: 18, letterSpacing: "0.08em", cursor: "pointer", marginBottom: 8 }}
          >
            {created.code}
          </button>
          <div className="code" style={{ whiteSpace: "pre-wrap" }}>{message(created.code)}</div>
          <div className="stack" style={{ marginTop: 8 }}>
            <button className="btn btn-block" onClick={() => copy(message(created.code!))}>{copied ? "Скопировано ✓" : "Скопировать сообщение"}</button>
          </div>
        </section>
      )}

      <div className="section-label">История</div>
      {items?.length === 0 && <Empty icon="✉️">Кодов пока нет.</Empty>}
      <ul className="list">
        {items?.map((i) => {
          const st = STATUS[i.status] ?? { label: i.status, tone: "mute" };
          return (
            <li key={i.id} className="item">
              <div className="grow">
                <span className={`chip ${st.tone}`}>{st.label}</span>
                {i.code && <div className="code" style={{ marginTop: 4, fontWeight: 600 }}>{i.code}</div>}
                <div className="meta" style={{ marginTop: 4 }}>{formatDateTimeDot(i.created_at)}</div>
              </div>
              <div className="stack" style={{ gap: 4 }}>
                {i.status === "pending" && i.code && <button className="btn btn-sm" onClick={() => copy(i.code!)}>Копировать код</button>}
                {i.status === "pending" && <button className="btn btn-sm btn-danger" onClick={() => revoke(i.id)}>Отозвать</button>}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
