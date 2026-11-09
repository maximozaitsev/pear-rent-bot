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
  const [editFirst, setEditFirst] = useState("");
  const [editLast, setEditLast] = useState("");

  function groupBookings(bookings: Booking[]) {
    const byKey = new Map<string, Booking[]>();
    for (const b of bookings) {
      if (b.status !== "active") continue;
      const day = b.starts_at.slice(0, 10);
      const key = `${day}::${b.chair_id}`;
      const arr = byKey.get(key) ?? [];
      arr.push(b);
      byKey.set(key, arr);
    }
    const result: { day: string; chair_id: string; bookings: Booking[]; merged: boolean; totalPrice: number; totalHours: number; start: string; end: string }[] = [];
    for (const [key, bs] of byKey.entries()) {
      const [day, chair_id] = key.split("::");
      const hourly = bs.filter((b) => b.booking_type === "hourly");
      const fullDay = bs.filter((b) => b.booking_type === "full_day");
      for (const b of fullDay) {
        result.push({ day, chair_id, bookings: [b], merged: false, totalPrice: b.price_amount ?? 0, totalHours: b.duration_hours, start: b.starts_at.slice(11, 16), end: b.ends_at.slice(11, 16) });
      }
      if (hourly.length === 0) continue;
      const sorted = [...hourly].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      const totalPrice = sorted.reduce((s, b) => s + (b.price_amount ?? 0), 0);
      const totalHours = sorted.reduce((s, b) => s + b.duration_hours, 0);
      const start = sorted[0].starts_at.slice(11, 16);
      const end = sorted[sorted.length - 1].ends_at.slice(11, 16);
      result.push({ day, chair_id, bookings: sorted, merged: hourly.length > 1, totalPrice, totalHours, start, end });
    }
    return result.sort((a, b) => a.day.localeCompare(b.day) || a.start.localeCompare(b.start));
  }

  async function load() {
    setError(null);
    try { setItems(await api.adminRenters()); } catch (e) { setError(errorText(e)); }
  }
  useEffect(() => { load(); }, []);

  async function open(id: string) {
    setError(null);
    try { setSelected(await api.adminRenter(id)); } catch (e) { setError(errorText(e)); }
  }
  useEffect(() => {
    setEditFirst(selected?.renter.first_name ?? "");
    setEditLast(selected?.renter.last_name ?? "");
  }, [selected?.renter.id]);

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

  async function saveName() {
    if (!selected) return;
    setBusy(true);
    try {
      await api.adminUpdateRenter(selected.renter.id, { first_name: editFirst || null, last_name: editLast || null });
      haptic("success");
      await load();
      await open(selected.renter.id);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  async function remove(r: Renter) {
    if (!window.confirm(`Удалить арендатора "${personName(r)}" вместе со всеми его бронями?`)) return;
    setBusy(true);
    try {
      await api.adminDeleteRenter(r.id);
      haptic("success");
      await load();
      if (selected?.renter.id === r.id) setSelected(null);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
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
            <dt>Имя</dt>
            <dd>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <input className="input" value={editFirst} onChange={(e) => setEditFirst(e.target.value)} placeholder="Имя" />
                <input className="input" value={editLast} onChange={(e) => setEditLast(e.target.value)} placeholder="Фамилия" />
              </div>
              <button className="btn btn-sm" style={{ marginTop: 8 }} disabled={busy} onClick={saveName}>{busy ? "Сохранение..." : "Сохранить имя"}</button>
            </dd>
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
          <div style={{ display: "flex", gap: 8 }}>
            <button className={`btn btn-block ${selected.renter.is_active ? "btn-danger" : "btn-primary"}`} disabled={busy} onClick={() => toggle(selected.renter)}>
              {selected.renter.is_active ? "Деактивировать" : "Активировать"}
            </button>
            <button className="btn btn-block btn-danger" disabled={busy} onClick={() => remove(selected.renter)}>Удалить</button>
          </div>
          <p className="muted small">При удалении арендатор и все его брони удаляются безвозвратно. При деактивации запрещаются новые брони, но существующие не отменяются автоматически.</p>
          <div className="section-label">Будущие бронирования</div>
          {selected.bookings.length === 0 && <p className="muted">Броней нет.</p>}
          <ul className="list">
            {groupBookings(selected.bookings)
              .filter((g) => new Date(`${g.day}T${g.start}`) >= new Date())
              .map((g) => (
              <li key={`${g.day}::${g.chair_id}::${g.start}`} className="item-plain">
                <div>
                  <div style={{ fontWeight: 600 }}>{formatDateDot(g.day)} · {g.start}–{g.end}{g.merged ? ` (${g.totalHours} ч)` : ""}</div>
                  <div className="muted small">{formatMoney(g.totalPrice, selected.bookings[0]?.currency ?? "BYN")} · {g.bookings.map((b) => b.status).join(", ")}{g.merged ? ` · ${g.bookings.length} записи` : ""}</div>
                </div>
                {g.bookings.some((b) => b.payment_status === "paid") && g.bookings.every((b) => b.payment_status === "paid") ? (
                  <span className="chip ok">оплачено</span>
                ) : (
                  <span className="chip warn">не оплачено</span>
                )}
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </>
  );
}
