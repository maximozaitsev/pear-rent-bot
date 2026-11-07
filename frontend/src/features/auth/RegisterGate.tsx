import { useState } from "react";
import { api, authLog, getTelegramWebApp, setToken } from "../../api/client";
import { useAuth } from "./AuthContext";
import { AuthDebugPanel } from "../../shared/AuthDebugPanel";
import { Banner, errorText, haptic } from "../../shared/ui";

export function RegisterGate({ reason }: { reason: string }) {
  const { initData: ctxInitData, refresh } = useAuth();
  const [code, setCode] = useState("");
  const [devTgId, setDevTgId] = useState("");
  const [devOpen, setDevOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(override?: string) {
    const tg = getTelegramWebApp();
    let initData = ctxInitData || tg?.initData || "";
    if (!initData) {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const qs = new URLSearchParams(window.location.search);
      initData = hash.get("tgWebAppData") || qs.get("tgWebAppData") || "";
      if (initData) try { initData = decodeURIComponent(initData); } catch { /* keep */ }
    }
    const clean = (override ?? code).replace(/\s/g, "");
    authLog("register_submit", { hasInitData: !!initData, codeLen: clean.length, hasUnsafeUser: !!tg?.initDataUnsafe?.user, devOpen });
    if (!/^\d{6}$/.test(clean)) { setError("Введите 6-значный код приглашения."); return; }
    setBusy(true); setError(null);
    try {
      const unsafeUser = tg?.initDataUnsafe?.user;
      let auth;
      if (initData) {
        auth = await api.register(initData, clean);
      } else if (unsafeUser?.id) {
        auth = await api.devBypass({ init_data: "dev", code: clean, dev_user: unsafeUser });
      } else if (devTgId.trim() && /^\d+$/.test(devTgId.trim())) {
        auth = await api.devBypass({ init_data: "dev", code: clean, dev_user: { id: Number(devTgId.trim()) } });
      } else {
        throw new Error("Telegram не передал данные пользователя. Откройте приложение из Telegram.");
      }
      authLog("register_ok", { userId: auth.user.id, role: auth.user.role });
      setToken(auth.access_token);
      haptic("success");
      refresh();
    } catch (e) {
      authLog("register_catch", { err: e instanceof Error ? e.message : String(e), status: (e as any)?.status, detail: (e as any)?.detail, requestId: (e as any)?.requestId });
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
        <details className="field" style={{ marginTop: 8 }} open={devOpen} onChange={(e) => setDevOpen(e.currentTarget.open)}>
          <summary style={{ cursor: "pointer", listStyle: "none" }}>
            <span>Локальная отладка (только для разработчиков)</span>
            <span style={{ float: "right" }}>{devOpen ? "▲" : "▾"}</span>
          </summary>
          <input className="input" value={devTgId} onChange={(e) => setDevTgId(e.target.value)} placeholder="Telegram ID (только при DEV_INSECURE_AUTH_BYPASS=1)" inputMode="numeric" style={{ marginTop: 8 }} />
          <span className="muted small">Нужно только если Telegram не передал данные, при `DEV_INSECURE_AUTH_BYPASS=1`.</span>
        </details>
        {error && <Banner kind="bad">{error}</Banner>}
        <button className="btn btn-primary btn-block" disabled={busy} onClick={() => submit()}>{busy ? "Регистрация..." : "Зарегистрироваться"}</button>
        <AuthDebugPanel />
      </section>
    </main>
  );
}
