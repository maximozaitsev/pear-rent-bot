import { useState } from "react";
import { api, getTelegramWebApp, setToken } from "../../api/client";
import { useAuth } from "./AuthContext";
import { Banner, errorText, haptic } from "../../shared/ui";

export function RegisterGate({ reason, inviteToken }: { reason: string; inviteToken: string | null }) {
  const { refresh } = useAuth();
  const [token, setTokenValue] = useState(inviteToken ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const initData = getTelegramWebApp()?.initData;
    if (!initData) { setError("Откройте Mini App внутри Telegram."); return; }
    if (!token.trim()) { setError("Введите пригласительный токен."); return; }
    setBusy(true); setError(null);
    try {
      const auth = await api.register(initData, token.trim());
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
        <h2>Доступ по приглашению</h2>
        <p className="muted">{reason}</p>
        {inviteToken ? (
          <Banner kind="ok">Пригласительная ссылка найдена. Подтвердите регистрацию.</Banner>
        ) : (
          <label className="field">
            <span>Пригласительный токен</span>
            <input className="input" value={token} onChange={(e) => setTokenValue(e.target.value)} placeholder="Вставьте токен" autoCapitalize="off" autoCorrect="off" />
          </label>
        )}
        {error && <Banner kind="bad">{error}</Banner>}
        <button className="btn btn-primary btn-block" disabled={busy} onClick={submit}>{busy ? "Регистрация..." : "Зарегистрироваться"}</button>
      </section>
    </main>
  );
}
