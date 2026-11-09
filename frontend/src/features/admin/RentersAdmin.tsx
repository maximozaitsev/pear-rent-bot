import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Booking, Renter, RenterPaymentStats } from "../../api/types";
import { formatDateDot, formatMoney, formatTime } from "../schedule/time";
import { Banner, Empty, Sheet, initials, errorText, haptic, personName } from "../../shared/ui";
export function RentersAdmin() {
  const [items, setItems] = useState<Renter[] | null>(null);
  const [selected, setSelected] = useState<{ renter: Renter; bookings: Booking[]; stats: RenterPaymentStats } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    try { setItems(await api.adminRenters()); } catch (e) { setError(errorText(e)); }
  }
  useEffect(() => { load(); }, []);

  async function open(id: string) {
    setError(null);
    try { setSelected(await api.adminRenter(id)); } catch (e) { setError(errorText(e)); }
  }
  async function toggle(r: Renter) {
    setBusy(true);
    try { await api.adminSetRenterStatus(r.id, !r.is_active); haptic("success"); await load(); if (selected?.renter.id === r.id) await open(r.id); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  async function setRole(r: Renter, value: string) {
    try { await api.adminSetRenterRole(r.id, value as "permanent" | "temporary"); haptic("success"); await load(); if (selected?.renter.id === r.id) await open(r.id); }
    catch (e) { setError(errorText(e)); }
  }

  return (
    <>
      {error && <Banner kind="bad" onRetry={load}>{error}</Banner>}
      {!items && !error && <><div className="skeleton" /><div className="skeleton" /></>}
      {items?.length === 0 && <Empty icon="👥">Арендаторов пока нет.<br />Создайте приглашение на вкладке «Инвайты».</Empty>}
      <ul className="list">
        {items?.map((r) => {
          const name = personName(r);
          return (
            <li key={r.id}>
              <button className="item" onClick={() => { haptic(); open(r.id); }}>
                <div className="avatar">{initials(name)}</div>
                <div className="grow">
                  <div className="title">{name}</div>
                  <div className="meta">{r.phone ?? "Телефон не указан"}{r.username ? ` · @${r.username}` : ""}</div>
                </div>
                <span className={`chip ${r.is_active ? "ok" : "mute"}`}>{r.is_active ? "активен" : "неактивен"}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {selected && (
        <Sheet title={personName(selected.renter)} onClose={() => setSelected(null)}>
          <dl className="kv" style={{ margin: 0 }}>
            <dt>Телефон</dt><dd>{selected.renter.phone ?? "Не указан"}</dd>
            <dt>Username</dt><dd>{selected.renter.username ? `@${selected.renter.username}` : "—"}</dd>
            <dt>Регистрация</dt><dd>{formatDateDot(selected.renter.created_at)}</dd>
            <dt>Статус</dt><dd><span className={`chip ${selected.renter.is_active ? "ok" : "mute"}`}>{selected.renter.is_active ? "активен" : "неактивен"}</span></dd>
          </dl>
          <section className="card" style={{ display: "grid", gap: 10 }}>
            <div className="section-label" style={{ padding: 0 }}>Права бронирования</div>
            <div className="segmented">
              <button className={(selected.renter.renter_role ?? "permanent") === "permanent" ? "active" : ""} onClick={() => setRole(selected.renter, "permanent")}>Постоянный</button>
              <button className={selected.renter.renter_role === "temporary" ? "active" : ""} onClick={() => setRole(selected.renter, "temporary")}>Временный</button>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              {selected.renter.renter_role === "temporary"
                ? "Текущий месяц; следующий — после 15-го числа текущего."
                : "Текущий и следующий месяц с приоритетом."}
            </p>
          </section>
          <section className="card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center" }}>
            <div><div className="muted small">Долг</div><div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{formatMoney(selected.stats.debt)}</div></div>
            <div><div className="muted small">К оплате</div><div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{formatMoney(selected.stats.to_pay)}</div></div>
            <div><div className="muted small">Оплачено всего</div><div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{formatMoney(selected.stats.paid_total)}</div></div>
          </section>
          <button className={`btn btn-block ${selected.renter.is_active ? "btn-danger" : "btn-primary"}`} disabled={busy} onClick={() => toggle(selected.renter)}>
            {selected.renter.is_active ? "Деактивировать (запрет новых броней)" : "Активировать"}
          </button>
          <p className="muted small">Существующие брони при деактивации не отменяются автоматически.</p>
          <div className="section-label">Брони</div>
          {selected.bookings.length === 0 && <p className="muted">Броней нет.</p>}
          <ul className="list">
            {selected.bookings.map((b) => (
              <li key={b.id} className="item-plain">
                <div>
                  <div style={{ fontWeight: 600 }}>{formatDateDot(b.starts_at)} · {formatTime(b.starts_at)}–{formatTime(b.ends_at)}</div>
                  <div className="muted small">{formatMoney(b.price_amount, b.currency)} · {b.status}</div>
                </div>
                <span className={`chip ${b.payment_status === "paid" ? "ok" : "warn"}`}>{b.payment_status === "paid" ? "оплачено" : "не оплачено"}</span>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </>
  );
}
