import { useState } from "react";
import { api } from "../../api/client";
import { Banner, errorText, haptic } from "../../shared/ui";

const PHONE_RE = /^\+375 \(\d{2}\) \d{3}-\d{2}-\d{2}$/;

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  let d = digits;
  if (d.startsWith("375")) d = d.slice(3);
  if (d.length <= 2) return `+375 (${d}`;
  if (d.length <= 5) return `+375 (${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 8) return `+375 (${d.slice(0, 2)}) ${d.slice(2, 5)}-${d.slice(5)}`;
  if (d.length <= 10) return `+375 (${d.slice(0, 2)}) ${d.slice(2, 5)}-${d.slice(5, 7)}-${d.slice(7)}`;
  return `+375 (${d.slice(0, 2)}) ${d.slice(2, 5)}-${d.slice(5, 7)}-${d.slice(7, 9)}`;
}

function digitsOf(formatted: string): string {
  return formatted.replace(/\D/g, "").replace(/^375/, "");
}

export function CompleteRegistration({
  tgFirstName,
  onDone,
}: {
  tgFirstName: string | null;
  onDone: () => void;
}) {
  const [firstName, setFirstName] = useState(tgFirstName ?? "");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!firstName.trim()) { setError("Введите имя."); return; }
    if (!PHONE_RE.test(phone)) { setError("Введите телефон в формате +375 (xx) xxx-xx-xx."); return; }
    setBusy(true); setError(null);
    try {
      await api.completeRegistration({
        first_name: firstName.trim(),
        last_name: lastName.trim() || null,
        phone: formatPhone(phone),
      });
      haptic("success");
      onDone();
    } catch (e) {
      haptic("error");
      setError(errorText(e, "Не удалось сохранить данные"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app no-tabs" style={{ justifyContent: "center" }}>
      <div className="center stack" style={{ justifyItems: "center" }}>
        <div style={{ fontSize: "3.2rem" }}>🍐</div>
        <h1>Pear Rent</h1>
        <p className="muted">Аренда кресел в барбершопе</p>
      </div>
      <section className="card">
        <h2>Завершите регистрацию</h2>
        <p className="muted">Заполните данные для профиля. Имя предзаполнено из Telegram.</p>
        <label className="field">
          <span>Имя</span>
          <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Имя" autoFocus />
        </label>
        <label className="field" style={{ marginTop: 8 }}>
          <span>Отчество / фамилия (необязательно)</span>
          <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Фамилия" />
        </label>
        <label className="field" style={{ marginTop: 8 }}>
          <span>Телефон</span>
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            placeholder="+375 (xx) xxx-xx-xx"
            inputMode="tel"
            autoFocus={false}
          />
          <span className="muted small">Формат: +375 (29) 123-45-67</span>
        </label>
        {error && <Banner kind="bad">{error}</Banner>}
        <button className="btn btn-primary btn-block" disabled={busy} onClick={submit}>{busy ? "Сохранение..." : "Сохранить и войти"}</button>
      </section>
    </main>
  );
}