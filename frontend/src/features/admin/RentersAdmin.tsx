import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Renter } from "../../api/types";
import { formatMoney, formatTime } from "../schedule/time";

export function RentersAdmin() {
  const [items, setItems] = useState<Renter[]>([]);
  const [selected, setSelected] = useState<{ renter: Renter; bookings: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    try { setItems(await api.adminRenters()); } catch (e) { setError(e instanceof Error ? e.message : "Ошибка"); }
  }
  useEffect(() => { load(); }, []);

  async function open(id: string) {
    setError(null);
    try { setSelected(await api.adminRenter(id)); } catch (e) { setError(e instanceof Error ? e.message : "Ошибка"); }
  }
  async function toggle(r: Renter) {
    setBusy(true);
    try { await api.adminSetRenterStatus(r.id, !r.is_active); await load(); if (selected?.renter.id === r.id) await open(r.id); }
    catch (e) { setError(e instanceof Error ? e.message : "Ошибка"); }
    finally { setBusy(false); }
  }

  return (
    <section className="card">
      <h2>Арендаторы</h2>
      {error && <p className="error">{error}</p>}
      <ul className="list">{items.map((r) => (
        <li key={r.id} className="list-item"><button className="link" onClick={() => open(r.id)}>{[r.first_name, r.last_name].filter(Boolean).join(" ") || r.username || r.telegram_id}</button><span className={`chip ${r.is_active ? "status-free" : "status-closed"}`}>{r.is_active ? "активен" : "неактивен"}</span></li>
      ))}</ul>
      {selected && (
        <div className="subcard">
          <h3>Карточка</h3>
          <p>{[selected.renter.first_name, selected.renter.last_name].filter(Boolean).join(" ")} {selected.renter.username ? `(@${selected.renter.username})` : ""}</p>
          <p className="muted">Telegram ID: {selected.renter.telegram_id} · Регистрация: {selected.renter.created_at.slice(0, 10)}</p>
          <button disabled={busy} onClick={() => toggle(selected.renter)}>{selected.renter.is_active ? "Деактивировать (запрет новых броней)" : "Активировать"}</button>
          <p className="muted small">Существующие брони при деактивации не отменяются автоматически.</p>
          <h4>Брони</h4>
          <ul className="list">{selected.bookings.map((b) => <li key={b.id} className="small">{b.starts_at.slice(0, 10)} {formatTime(b.starts_at)}–{formatTime(b.ends_at)} · {b.status} · {formatMoney(b.price_amount, b.currency)} · {b.payment_status}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
