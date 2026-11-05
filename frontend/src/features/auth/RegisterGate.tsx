import { useState } from "react";
import { api, getTelegramWebApp, setToken } from "../../api/client";
import { useAuth } from "./AuthContext";

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
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось зарегистрироваться");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app">
      <h1>Доступ</h1>
      <section className="card">
        <p>{reason}</p>
        {inviteToken ? (
          <p className="muted">Найдена пригласительная ссылка. Подтвердите регистрацию.</p>
        ) : (
          <>
            <label className="field">
              <span>Пригласительный токен</span>
              <input value={token} onChange={(e) => setTokenValue(e.target.value)} placeholder="invite token" />
            </label>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy} onClick={submit}>{busy ? "Регистрация..." : "Зарегистрироваться"}</button>
      </section>
    </main>
  );
}
