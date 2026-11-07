import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Chair, DateOverride, WeeklyScheduleItem } from "../../api/types";
import { Banner, errorText, haptic } from "../../shared/ui";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      {label && <span>{label}</span>}
    </label>
  );
}

export function SettingsAdmin() {
  const [chairs, setChairs] = useState<Chair[]>([]);
  const [weekly, setWeekly] = useState<WeeklyScheduleItem[]>([]);
  const [exceptions, setExceptions] = useState<DateOverride[]>([]);
  const [newChair, setNewChair] = useState("");
  const [excDate, setExcDate] = useState("");
  const [excOpen, setExcOpen] = useState(true);
  const [excOpenTime, setExcOpenTime] = useState("09:00:00");
  const [excCloseTime, setExcCloseTime] = useState("22:00:00");
  const [excReason, setExcReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function load() {
    try {
      const [c, w, e] = await Promise.all([api.chairs(), api.adminWeeklySchedule(), api.adminExceptions()]);
      setChairs(c); setWeekly(w.sort((a, b) => a.weekday - b.weekday)); setExceptions(e);
    } catch (e) { setError(errorText(e)); }
  }
  useEffect(() => { load(); }, []);

  function showErr(e: unknown) { haptic("error"); setOk(null); setError(errorText(e)); }
  function success(msg: string) { haptic("success"); setError(null); setOk(msg); }

  async function createChair() {
    if (!newChair.trim()) return;
    try { await api.adminCreateChair(newChair.trim()); setNewChair(""); await load(); success("Кресло добавлено."); } catch (e) { showErr(e); }
  }
  async function renameChair(c: Chair) {
    const name = prompt("Новое название", c.name);
    if (!name || name === c.name) return;
    try { await api.adminUpdateChair(c.id, { name }); await load(); } catch (e) { showErr(e); }
  }
  async function toggleChair(c: Chair) {
    try { await api.adminUpdateChair(c.id, { is_active: !c.is_active }); await load(); } catch (e) { showErr(e); }
  }
  async function archiveChair(c: Chair) {
    if (!confirm("Архивировать кресло? При будущих активных бронях операция будет отклонена.")) return;
    try { await api.adminArchiveChair(c.id); await load(); } catch (e) { showErr(e); }
  }
  async function saveWeekly() {
    setError(null); setOk(null);
    try { await api.adminPutWeeklySchedule(weekly); await load(); success("Недельное расписание сохранено."); }
    catch (e) { showErr(e); }
  }
  async function saveException() {
    if (!excDate) return;
    setError(null); setOk(null);
    try {
      await api.adminPutException(excDate, { is_open: excOpen, open_time: excOpen ? excOpenTime : null, close_time: excOpen ? excCloseTime : null, reason: excReason || null });
      setExcReason(""); await load(); success("Исключение сохранено.");
    } catch (e) { showErr(e); }
  }
  async function deleteException(day: string) {
    try { await api.adminDeleteException(day); await load(); } catch (e) { showErr(e); }
  }
  function patchDay(idx: number, patch: Partial<WeeklyScheduleItem>) {
    setWeekly((w) => w.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  const toApiTime = (v: string) => (v ? v + ":00" : null);

  return (
    <>
      {error && <Banner kind="bad">{error}</Banner>}
      {ok && <Banner kind="ok">{ok}</Banner>}

      <div className="section-label">Кресла</div>
      <section className="card">
        <div className="row">
          <input className="input" value={newChair} onChange={(e) => setNewChair(e.target.value)} placeholder="Название нового кресла" />
          <button className="btn btn-primary" onClick={createChair}>Добавить</button>
        </div>
        <ul className="list">
          {chairs.map((c) => (
            <li key={c.id} className="item-plain" style={{ flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 600 }}>{c.name}</div>
                <span className={`chip ${c.is_active ? "ok" : "warn"}`}>{c.is_active ? "активно" : "отключено"}</span>
              </div>
              <div className="row wrap">
                <button className="btn btn-sm" onClick={() => renameChair(c)}>Имя</button>
                <button className="btn btn-sm" onClick={() => toggleChair(c)}>{c.is_active ? "Отключить" : "Включить"}</button>
                <button className="btn btn-sm btn-danger" onClick={() => archiveChair(c)}>Архив</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="section-label">Недельное расписание</div>
      <section className="card">
        <p className="muted small">При конфликте с будущими активными бронями сохранение будет отклонено с предупреждением.</p>
        {weekly.map((item, idx) => (
          <div key={item.weekday} className="weekrow">
            <b>{WEEKDAYS[item.weekday]}</b>
            <Switch checked={item.is_open} onChange={(v) => patchDay(idx, { is_open: v })} />
            <input className="input" style={{ minWidth: 0, width: "100%", maxWidth: "100%" }} type="time" disabled={!item.is_open} value={item.open_time?.slice(0, 5) ?? ""} onChange={(e) => patchDay(idx, { open_time: toApiTime(e.target.value) })} />
            <input className="input" style={{ minWidth: 0, width: "100%", maxWidth: "100%" }} type="time" disabled={!item.is_open} value={item.close_time?.slice(0, 5) ?? ""} onChange={(e) => patchDay(idx, { close_time: toApiTime(e.target.value) })} />
          </div>
        ))}
        <button className="btn btn-primary btn-block" onClick={saveWeekly}>Сохранить расписание</button>
      </section>

      <div className="section-label">Исключения дат</div>
      <section className="card">
        <label className="field"><span>Дата</span><input className="input" style={{ minWidth: 0, width: "100%", maxWidth: "100%" }} type="date" value={excDate} onChange={(e) => setExcDate(e.target.value)} /></label>
        <Switch checked={excOpen} onChange={setExcOpen} label={excOpen ? "Открыто" : "Закрыто"} />
        {excOpen && (
          <div className="row">
            <input className="input" style={{ minWidth: 0, width: "100%", maxWidth: "100%" }} type="time" value={excOpenTime.slice(0, 5)} onChange={(e) => setExcOpenTime(e.target.value + ":00")} />
            <span className="muted">–</span>
            <input className="input" style={{ minWidth: 0, width: "100%", maxWidth: "100%" }} type="time" value={excCloseTime.slice(0, 5)} onChange={(e) => setExcCloseTime(e.target.value + ":00")} />
          </div>
        )}
        <input className="input" value={excReason} onChange={(e) => setExcReason(e.target.value)} placeholder="Причина (необязательно)" />
        <button className="btn btn-primary btn-block" disabled={!excDate} onClick={saveException}>Сохранить исключение</button>
        <ul className="list">
          {exceptions.map((e) => (
            <li key={e.date} className="item-plain">
              <div>
                <div style={{ fontWeight: 600 }}>{e.date}</div>
                <div className="muted small">{e.is_open ? `${e.open_time?.slice(0, 5)}–${e.close_time?.slice(0, 5)}` : "закрыто"}{e.reason ? ` · ${e.reason}` : ""}</div>
              </div>
              <button className="btn btn-sm btn-danger" onClick={() => deleteException(e.date)}>Удалить</button>
            </li>
          ))}
        </ul>
      </section>

      <div className="section-label">Тарифы (справочно)</div>
      <section className="card">
        <div className="row between"><span>Весь день</span><b>60 BYN</b></div>
        <div className="row between"><span>1-й час</span><b>10 BYN</b></div>
        <div className="row between"><span>Каждый следующий час</span><b>+5 BYN</b></div>
      </section>
    </>
  );
}
