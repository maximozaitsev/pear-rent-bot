import { useEffect, useState } from "react";
import { ApiError, api, conflictText } from "../../api/client";
import type { Chair, DateOverride, WeeklyScheduleItem } from "../../api/types";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

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
    setError(null);
    try {
      const [c, w, e] = await Promise.all([api.chairs(true), api.adminWeeklySchedule(), api.adminExceptions()]);
      setChairs(c); setWeekly(w.sort((a, b) => a.weekday - b.weekday)); setExceptions(e);
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка"); }
  }
  useEffect(() => { load(); }, []);

  async function createChair() {
    if (!newChair.trim()) return;
    try { await api.adminCreateChair(newChair.trim()); setNewChair(""); await load(); } catch (e) { showErr(e); }
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
  function showErr(e: unknown) {
    if (e instanceof ApiError) setError(conflictText(e.detail) || e.message); else setError(e instanceof Error ? e.message : "Ошибка");
  }
  async function saveWeekly() {
    setError(null); setOk(null);
    try { await api.adminPutWeeklySchedule(weekly); setOk("Недельное расписание сохранено."); await load(); }
    catch (e) { showErr(e); }
  }
  async function saveException() {
    if (!excDate) return;
    setError(null); setOk(null);
    try {
      await api.adminPutException(excDate, { is_open: excOpen, open_time: excOpen ? excOpenTime : null, close_time: excOpen ? excCloseTime : null, reason: excReason || null });
      setOk("Исключение сохранено."); setExcReason(""); await load();
    } catch (e) { showErr(e); }
  }
  async function deleteException(day: string) {
    try { await api.adminDeleteException(day); await load(); } catch (e) { showErr(e); }
  }

  return (
    <>
      <section className="card">
        <h2>Кресла</h2>
        <div className="row gap"><input value={newChair} onChange={(e) => setNewChair(e.target.value)} placeholder="Название кресла" /><button onClick={createChair}>Добавить</button></div>
        <ul className="list">{chairs.map((c) => (
          <li key={c.id} className="list-item">
            <span>{c.name} {c.archived_at ? "(архив)" : ""}</span>
            {!c.archived_at && <span className="row gap"><button onClick={() => renameChair(c)}>Переименовать</button><button onClick={() => toggleChair(c)}>{c.is_active ? "Отключить" : "Включить"}</button><button className="danger" onClick={() => archiveChair(c)}>Архив</button></span>}
          </li>
        ))}</ul>
      </section>
      <section className="card">
        <h2>Недельное расписание</h2>
        <p className="muted small">При конфликте с будущими активными бронями сохранение отклоняется с предупреждением.</p>
        {weekly.map((item, idx) => (
          <div key={item.weekday} className="row gap wrap subrow">
            <strong style={{ width: 32 }}>{WEEKDAYS[item.weekday]}</strong>
            <label><input type="checkbox" checked={item.is_open} onChange={(e) => { const next = [...weekly]; next[idx] = { ...item, is_open: e.target.checked }; setWeekly(next); }} /> открыт</label>
            <input disabled={!item.is_open} value={item.open_time?.slice(0,5) ?? ""} onChange={(e) => { const next = [...weekly]; next[idx] = { ...item, open_time: e.target.value ? e.target.value + ":00" : null }; setWeekly(next); }} placeholder="09:00" />
            <input disabled={!item.is_open} value={item.close_time?.slice(0,5) ?? ""} onChange={(e) => { const next = [...weekly]; next[idx] = { ...item, close_time: e.target.value ? e.target.value + ":00" : null }; setWeekly(next); }} placeholder="22:00" />
          </div>
        ))}
        <button className="primary" onClick={saveWeekly}>Сохранить недельное расписание</button>
      </section>
      <section className="card">
        <h2>Исключения дат</h2>
        <div className="row gap wrap">
          <input type="date" value={excDate} onChange={(e) => setExcDate(e.target.value)} />
          <label><input type="checkbox" checked={excOpen} onChange={(e) => setExcOpen(e.target.checked)} /> открыт</label>
          <input disabled={!excOpen} value={excOpenTime.slice(0,5)} onChange={(e) => setExcOpenTime(e.target.value + ":00")} placeholder="09:00" />
          <input disabled={!excOpen} value={excCloseTime.slice(0,5)} onChange={(e) => setExcCloseTime(e.target.value + ":00")} placeholder="22:00" />
          <input value={excReason} onChange={(e) => setExcReason(e.target.value)} placeholder="Причина (необязательно)" />
          <button onClick={saveException}>Сохранить исключение</button>
        </div>
        <ul className="list">{exceptions.map((e) => (
          <li key={e.date} className="list-item"><span>{e.date}: {e.is_open ? `${e.open_time?.slice(0,5)}–${e.close_time?.slice(0,5)}` : "закрыто"} {e.reason ? `(${e.reason})` : ""}</span><button className="danger" onClick={() => deleteException(e.date)}>Удалить</button></li>
        ))}</ul>
      </section>
      <section className="card"><h2>Тарифы (MVP, справочно)</h2><p>Весь день — 60 BYN. Первый час — 10 BYN, каждый следующий в той же брони — 5 BYN. Редактирование тарифов не входит в MVP.</p></section>
      {error && <p className="error">{error}</p>}
      {ok && <p className="ok">{ok}</p>}
    </>
  );
}
