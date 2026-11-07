import { useState } from "react";
import { api, getTelegramInitData, getTelegramWebApp, setToken } from "../../api/client";
import { useAuth } from "./AuthContext";
import { Banner, errorText, haptic } from "../../shared/ui";

export function RegisterGate({ reason }: { reason: string }) {
  const { initData: ctxInitData, refresh } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(override?: string) {
    const initData = ctxInitData || getTelegramInitData();
    const clean = (override ?? code).replace(/\s/g, "");
    if (!/^\d{6}$/.test(clean)) { setError("Введите 6-значный код приглашения."); return; }
    setBusy(true); setError(null);
    try {
      if (!initData) {
        throw new Error("Не удалось получить данные Telegram. Нажмите «Повторить вход» или откройте приложение через меню бота.");
      }
      const auth = await api.register(initData, clean);
      setToken(auth.access_token);
      haptic("success");
      refresh();
    } catch (e) {
      haptic("error");
      setError(errorText(e, "Не удалось зарегистрироваться"));
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
        <h2>Доступ по коду</h2>
        <p className="muted">{reason}</p>
        <label className="field">
          <span>Код приглашения</span>
          <input className="input" value={code} onChange={(e) => { const v = e.target.value; setCode(v); if (v.replace(/\s/g, "").length === 6) submit(v); }} placeholder="6 цифр" inputMode="numeric" maxLength={6} autoCapitalize="off" autoCorrect="off" />
        </label>
        {error && <Banner kind="bad">{error}</Banner>}
        <button className="btn btn-primary btn-block" disabled={busy} onClick={() => submit()}>{busy ? "Регистрация..." : "Войти"}</button>
      </section>
    </main>
  );
}
